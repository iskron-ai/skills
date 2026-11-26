// The launcher's revoke of its lead subagent's seat (graph @nks/nks-dev, nodes #7505, #6593, #7599):
// the plugin ends the child first (leads.ts — the outcome to the parent, the child's bridge
// leaves its cases, revokes and goes down), then the launcher's own revoke goes to the platform
// by the launcher's bridge, the seat's role filled in. One word of the launcher takes the seat
// off the board whatever the child's bridge managed; a seat the child's bridge revoked itself is
// not revoked twice — the second call met only "no such seat" (#7599); the same seat is the same
// canonical graph, role and name — a short spelling as the launcher's bridge resolves it (#8191),
// a graph not known in that form is no match (№664); a seat
// already gone counts as taken off, any other refusal is a loud refusal of the launcher's call,
// not a quiet "released".
// The bridge that speaks is chosen here too (launcherRevokes): the launcher's own revoke out of
// its tool call (tools.ts), and a lead that ended with no bridge of its own — its satellite seat
// is stopped by the same bridge by the child's own socket's token, as the plugin's own move
// (leads.ts, bridge stopseat.ts, #7621): never a revoke by name.
import { refusalOf, seatAlreadyOff } from "../bridge/refusal.ts";
import type { JsonRpcMessage } from "../bridge/types.ts";
import { method, PRODUCT } from "../delivery/index.ts";
import type { Released, StopName } from "./leaddoors.ts";
import { W } from "./leadwords.ts";
import { type Place } from "./satellite.ts";
import type { Slot } from "./slot.ts";

/**
 * The seat is already off only by the api's refusal data (tools.ts carries it on the throw),
 * read as the bridge's end-of-run revoke reads it (refusal.ts seatAlreadyOff). A missing role
 * or graph, a refusal without data, any prose — the seat is NOT taken off.
 */
const seatGone = (e: unknown): boolean =>
  seatAlreadyOff(refusalOf({ result: (e as { result?: unknown }).result } as JsonRpcMessage));

/**
 * The refusal's first line without the calls it suggests: the platform may list the role's
 * other seats with a revoke for each — the launcher's own seat among them (#7599).
 */
/** The deferred stop's answer — no longer than this. */
const STOP_MS = 10_000;

const reason = (message: string): string =>
  (message.split("\n").find((s) => s.trim()) ?? "").replace(/\b\w+\([^()]*\)/g, "…").trim();

export async function revokeAsLauncher(
  freed: Released,
  args: Record<string, unknown>,
  call: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<string> {
  if (freed.off) return freed.word;
  const p = freed.place;
  const full = {
    ...args,
    ...(args.realm == null && p?.realm ? { realm: p.realm } : {}),
    ...(args.karta == null && p?.karta ? { karta: p.karta } : {}),
  };
  try {
    await call(full);
    return freed.word;
  } catch (e) {
    if (seatGone(e)) return freed.word;
    const why = reason((e as Error).message);
    throw new Error(W().unreleased(p?.name ?? String(args.standing ?? ""), why), { cause: e });
  }
}

/** What a revoke by the launcher's bridge needs from the "tools" half (tools.ts). */
interface Doors {
  /** A child's launcher. */
  rootOf(session: string): Promise<string>;
  /** The launcher's bridge held in this process by another folder's instance (moves.ts). */
  farRoot(root: string): Promise<Slot | "foreign" | null>;
  /** A root's bridge; seatless — the root sits in a folder no instance of this process serves. */
  slotFor(session: string, touch?: boolean, seatless?: boolean): Promise<Slot>;
  /** One tool call through the slot's bridge; service — the plugin's own move, not the agent's work. */
  callThrough(
    slot: Slot,
    name: string,
    input: unknown,
    session: string,
    service: boolean,
  ): Promise<unknown>;
  /** The call's graph as the bridge names it (rootseat-by.ts). */
  canonOf(slot: Slot, realm: string): Promise<string>;
}

/**
 * The revokes the plugin sends in a launcher's name, each by the launcher's bridge with the
 * slot's busy count held for the call — the reaper takes no bridge mid-call (tools.ts).
 */
export function launcherRevokes(d: Doors) {
  /**
   * The bridge that speaks in the launcher's name: one held in this process by another
   * folder's instance — that very slot (two folders, №1237); a launcher in a folder no
   * instance of the process serves — a local bridge that returns no seat here (#6626);
   * otherwise the launcher's own, its seat returning from disk as before any of its calls.
   */
  async function launcherSlot(root: string): Promise<Slot> {
    const far = await d.farRoot(root);
    return far && far !== "foreign" ? far : d.slotFor(root, true, far === "foreign");
  }

  async function byLauncher(
    slot: Promise<Slot>,
    name: string,
    args: Record<string, unknown>,
    session: string,
    service: boolean,
  ): Promise<unknown> {
    const s = await slot;
    s.busy++;
    try {
      return await d.callThrough(s, name, args, session, service);
    } finally {
      s.busy--;
    }
  }

  return {
    /** The call's graph as the launcher's bridge names it; no bridge — as given. */
    canon:
      (caller: string) =>
      (realm: string): Promise<string> =>
        d.slotFor(caller).then(
          (slot) => d.canonOf(slot, realm),
          () => realm,
        ),
    /** The launcher's own revoke out of its tool call. */
    own(
      freed: Released,
      name: string,
      args: Record<string, unknown>,
      caller: string,
    ): Promise<string> {
      return revokeAsLauncher(freed, args, (full) =>
        byLauncher(d.slotFor(caller), name, full, caller, false),
      );
    },
    /**
     * The satellite seat of a lead that ended with no bridge of its own is taken off (leads.ts):
     * a cleanup of the plugin, not the agent's work — a service call. Nothing here throws: no
     * bridge to raise, a launcher stopped or deleted, the transport, a sign-in, the platform's
     * refusal — all come back as the loud word that says the seat is not off. `still` is asked
     * right before the revoke leaves: the child stood again while its launcher was being found —
     * the seat is its own now, nothing is revoked and nothing is said (null).
     */
    async off(
      child: string,
      place: Place,
      taken: string,
      still: () => boolean,
      stop: StopName | null,
    ): Promise<string | null> {
      // By the child's own socket's token (bridge stopseat.ts, #7621): it ends only seats that
      // socket still holds, and only of the child's own incarnation — a holder who re-took the
      // name or the seat key meanwhile keeps its seat. No key or incarnation known (an older
      // marker) — no revoke by name: the seat lapses by its term.
      if (!stop) {
        process.stderr.write(`[${PRODUCT}] ${W().noStopToken(place.name)}\n`);
        return W().noStopToken(place.name);
      }
      try {
        const root = await d.rootOf(child);
        const slot = await launcherSlot(root);
        if (!still()) return null;
        slot.busy++;
        const got = (await slot.bridge
          .request(method("stopseat"), { ...stop }, { service: true, timeoutMs: STOP_MS })
          .finally(() => slot.busy--)) as { how?: string; why?: string } | null;
        if (got?.how === "stopped") return taken;
        if (got?.how === "moved") return W().heldByOther(place.name);
        if (got?.how === "none") return W().noStopToken(place.name);
        return W().unreleased(place.name, reason(String(got?.why ?? got?.how ?? "")));
      } catch (e) {
        return W().unreleased(place.name, reason(String((e as Error)?.message ?? e)));
      }
    },
  };
}
