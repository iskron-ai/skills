// Lifetime of service root seats: cancellation keeps only an in-flight bridge until revoke.
import { readFileSync } from "node:fs";

import { ROOT_SEAT, tool } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { holdFilePathOf } from "../shared/standings.ts";
import { textOf } from "./bridge-io.ts";
import { writeLostMarker } from "./marker.ts";
import type { Home } from "./records.ts";
import { seatBy, type SeatDoors } from "./rootseat-by.ts";
import { heldPlace, type Place } from "./satellite.ts";
import type { Slot } from "./slot.ts";

interface Doors extends Pick<SeatDoors, "slotFor" | "awaitReady" | "callThrough" | "modelOf"> {
  stopped(): boolean;
  slots: Map<string, Slot>;
  authDir(): string;
  forgot(session: string): void;
  stood(slot: Slot): void;
  failed(word: string): void;
}

export function createSeatLife(d: Doors) {
  const deleted = new Set<string>();
  const attempts = new Map<
    string,
    { cancelled: () => boolean; slot?: Slot; cancelledHere: boolean; failure?: string }
  >();
  const cancelled = (s: string) =>
    d.stopped() ||
    deleted.has(s) ||
    attempts.get(s)?.cancelledHere === true ||
    attempts.get(s)?.cancelled() === true;
  const provisional = (slot: Slot, session: string): boolean => {
    if (!slot.key) return false;
    try {
      const rec = JSON.parse(readFileSync(holdFilePathOf(d.authDir(), slot.key), "utf8"));
      return rec.provisional === true && rec.session === session && rec.key === slot.key;
    } catch {
      return false;
    }
  };
  const cancel = (s: string) => {
    deleted.add(s);
    const a = attempts.get(s);
    if (a) a.cancelledHere = true;
  };
  const drop = (s: string, slot: Slot) => {
    d.forgot(s);
    if (d.slots.get(s) === slot) d.slots.delete(s);
  };
  return {
    guard(s: string) {
      if (cancelled(s)) throw new Error(words(ROOT_SEAT).cancelled());
    },
    observe(
      slot: Slot,
      kind: string | null,
      data?: { key?: unknown; place?: Partial<Place>; frame?: { type?: string } },
    ) {
      // Holding follows the bridge's held/hello event, never a tool's apparent success.
      if (kind === "held" || kind === "attached" || data?.frame?.type === "hello") d.stood(slot);
      if ((kind === "held" || kind === "released") && typeof data?.key === "string")
        slot.key = data.key;
      if (kind === "held") slot.place = heldPlace(data) ?? slot.place;
      if (kind === "released" || kind === "dead" || kind === "evicted" || kind === "stopped")
        slot.holding = false;
      return (
        kind === "held" &&
        (attempts.has(slot.session ?? "") || provisional(slot, slot.session ?? ""))
      );
    },
    cancel,
    forget(s: string) {
      const slot = d.slots.get(s);
      if (!slot) return;
      const a = attempts.get(s);
      if (a) {
        a.cancelledHere = true;
        return;
      }
      slot.ownStop = true;
      slot.bridge.stop();
      drop(s, slot);
    },
    stopSlots(home: Home | null, spare: Slot | null) {
      const slots = [...d.slots.values()];
      const left = writeLostMarker(
        d.authDir(),
        slots.filter((slot) => !slot.session || !attempts.has(slot.session)),
        home,
      );
      if (spare) {
        spare.ownStop = true;
        spare.bridge.stop();
      }
      for (const slot of slots) {
        if (slot.session && attempts.has(slot.session)) continue;
        slot.ownStop = true;
        slot.bridge.stop();
      }
      d.slots.clear();
      return left;
    },
    half: {
      async seatRoot(s: string, realm: string, karta: string, isCancelled: () => boolean) {
        if (cancelled(s) || isCancelled()) return { cancelled: true } as const;
        const attempt: {
          cancelled: () => boolean;
          cancelledHere: boolean;
          slot?: Slot;
          failure?: string;
        } = {
          cancelled: isCancelled,
          cancelledHere: false,
          slot: undefined as Slot | undefined,
        };
        attempts.set(s, attempt);
        return seatBy(
          {
            slotFor: async (root) => {
              const slot = await d.slotFor(root);
              attempt.slot = slot;
              return slot;
            },
            awaitReady: d.awaitReady,
            callThrough: async (...args) => {
              try {
                return await d.callThrough(...args);
              } catch (e) {
                attempt.failure = (e as Error).message;
                throw e;
              }
            },
            modelOf: d.modelOf,
            cancelled,
            provisional,
          },
          s,
          realm,
          karta,
        );
      },
      cancelSeat: cancel,
      async releaseSeat(s: string) {
        const slot = attempts.get(s)?.slot;
        if (!slot) return;
        slot.ownStop = true;
        try {
          const failure = attempts.get(s)?.failure;
          if (!slot.holding && failure) throw new Error(failure);
          if (slot.holding && slot.place) {
            const p = slot.place;
            const result = await slot.bridge.request(
              "tools/call",
              {
                name: tool("channel"),
                arguments: { action: "revoke", realm: p.realm, karta: p.karta, standing: p.name },
              },
              { service: true, timeoutMs: 10_000 },
            );
            if (result?.isError) throw new Error(textOf(result));
          }
        } catch (e) {
          d.failed(words(ROOT_SEAT).cleanupFailed(slot.key ?? s, (e as Error).message));
        } finally {
          slot.bridge.stop();
          drop(s, slot);
        }
      },
      finishSeat(s: string) {
        attempts.delete(s);
      },
    },
  };
}
