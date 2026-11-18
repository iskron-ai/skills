// The hearing of a dsh session (graph @nks/nks-dev, node #10776): the machine bridge
// holds the standing, and this local client attaches to the standing's socket the way
// the watchdogs do (watchdog/client.ts). Each frame addressed to the seat becomes ONE
// message of the live session (where it goes — steer.ts); the rest — hello, status, unaddressed case
// records — passes by. No bridge and no tools of its own live here.
import { randomUUID } from "node:crypto";

import { type ChannelEvent } from "../bridge/hold.ts";
import { CLIENTS, DSH } from "../delivery/index.ts";
import { addressedToMine } from "../shared/addressed.ts";
import { frameToText, markFrame } from "../shared/frame-text.ts";
import { words } from "../shared/lang.ts";
import { deliveryKeys, noteSeen, seenIds } from "../shared/seen.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { adoptSeenPath, attach, staleOf } from "../watchdog/client.ts";
import { awaitSeat, type Seat } from "./seat.ts";

export interface DshAgent {
  /** One next-turn message of the live session; returns its landing or a promise of it. */
  followup(message: unknown): unknown;
}

export interface Hearing {
  /** The standing this hearing attached to; null while unknown or deaf. */
  key(): string | null;
  /** Attached or still waiting for its seat — not stopped. */
  live(): boolean;
  /** The session ended: detach and send nothing more into it. */
  stop(): void;
}

/** One next-turn message of the dsh session (the plugin message form, #10776 stage 1). */
export function turnMessage(text: string): Record<string, unknown> {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: CLIENTS.dsh },
  };
}

/**
 * Attach and deliver: each addressed frame is one message, marked seen after its send.
 * The own seat is waited for within the attach window (seat.ts): the session's bridge
 * takes its place after agent/created, so the hearing starts deaf and attaches the
 * moment exactly one own hold record stands.
 */
export function startHearing(
  agent: () => DshAgent | null,
  log: (text: string) => void,
  startedAt = Date.now(),
): Hearing {
  const W = () => words(DSH);
  const state = { key: null as string | null };
  let detach: (() => void) | null = null;
  let cancelWait: (() => void) | null = null;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    cancelWait?.();
    cancelWait = null;
    detach?.();
    detach = null;
  };

  const listen = (target: Seat): void => {
    let seenPath = seenFilePathOf(target.authDir, target.key);
    const seen = seenIds(seenPath);
    const sending = new Set<string>(); // delivery keys of a send that has not landed yet
    const known = (k: string): boolean => seen.has(k) || sending.has(k);

    const send = (text: string, keys: string[]): void => {
      const a = agent();
      if (!a) return log(W().notDelivered("no live agent"));
      for (const k of keys) sending.add(k);
      let res: unknown;
      try {
        res = a.followup(turnMessage(markFrame(text)));
      } catch (e) {
        for (const k of keys) sending.delete(k);
        return log(W().notDelivered((e as Error).message));
      }
      void Promise.resolve(res).then(
        () => {
          for (const k of keys) {
            noteSeen(seenPath, k, seen);
            sending.delete(k);
          }
        },
        (e: Error) => {
          for (const k of keys) sending.delete(k);
          log(W().notDelivered(e.message));
        },
      );
    };

    detach = attach(target.path, {
      onEvent: (ev: ChannelEvent) => {
        switch (ev.kind) {
          case "attached":
            seenPath = adoptSeenPath(ev.seen, seenPath, seen);
            state.key = ev.key ?? target.key;
            return log(W().listening(state.key));
          case "frame": {
            const f = ev.frame;
            if (f?.type !== "message") return; // hello and service proofs are not for the turn
            const keys = deliveryKeys(f);
            if (keys.some(known)) return; // a repeat of a delivered frame (#5831)
            if (!addressedToMine(f)) return; // a case record of another seat stays a count (#6574)
            return send(frameToText(f, ev.raw ?? ""), keys);
          }
          case "stale":
          case "backlog": {
            const b = staleOf(ev, known);
            if (b.text) return send(b.text, b.keys);
            return void b.keys.forEach((k) => noteSeen(seenPath, k, seen)); // nothing to wake
          }
          case "dead":
          case "evicted":
          case "stopped":
            log(W().seatGone(ev.text ?? ev.kind));
            return stop();
          case "released":
            if (!ev.own) log(W().gone(ev.text ?? ev.kind));
            return stop();
          default:
            return; // notes and service words stay out of the turn
        }
      },
      onGone: (why) => {
        log(W().gone(why));
        stop();
      },
    });
  };

  cancelWait = awaitSeat(startedAt, listen, log);
  return {
    key: () => state.key,
    live: () => !stopped,
    stop,
  };
}
