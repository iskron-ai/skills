// A compacted session keeps its role: the compaction request's system tells the summary to keep
// the role, the seat and the live cases; the end of the compaction (event session.compaction.ended,
// @opencode/plugin 2.0.4 — graph @nks/nks-dev, node #5048) lays ONE word into the session the way
// a lead's word goes (leaddoors.ts teller: synthetic, steer, no new turn). Only a session whose
// bridge holds a seat; a stopped or ended one gets nothing.
/* eslint-disable @typescript-eslint/no-explicit-any -- SDK events without a schema */
import { COMPACTION } from "../delivery/index.ts";
import { markFrame } from "../shared/frame-text.ts";
import { words } from "../shared/lang.ts";
import type { Context } from "./plugin.ts";
import type { Place } from "./satellite.ts";
import type { Say } from "./tools.ts";

const ENDED = "session.compaction.ended";

export interface CompactionDoors {
  /** The seat the session's own bridge holds; none — null. */
  placeOf(session: string): Place | null;
  /** Stopped by the owner or an ended lead: no word (halts.ts, #7505). */
  closed(session: string): boolean;
  say: Say;
}

/** One compaction: the event's id, else its place in the durable log. */
function keyOf(ev: any): string | null {
  if (typeof ev?.id === "string" && ev.id) return ev.id;
  const d = ev?.durable;
  return d?.seq != null ? `${String(d.aggregateID)}:${String(d.seq)}` : null;
}

export function createCompaction(ctx: Context, doors: CompactionDoors) {
  const W = () => words(COMPACTION);
  const done = new Map<string, Set<string>>();
  const seated = (s: string): Place | null => (doors.closed(s) ? null : doors.placeOf(s));

  // A failed delivery is one line in the log: no throw out, no retry.
  async function tell(sessionID: string, text: string): Promise<void> {
    const s: any = ctx.session;
    const o = { sessionID, text: markFrame(text), delivery: "steer", resume: false };
    try {
      if (typeof s.synthetic === "function") await s.synthetic(o);
      else await s.prompt(o);
      doors.say(W().returned(sessionID), "info");
    } catch (e) {
      doors.say(W().returnFailed(sessionID, String((e as Error)?.message ?? e)), "warning");
    }
  }

  return {
    /** The "compaction" hook: what the summary must keep. */
    instruct(req: { sessionID: unknown; system: any[] }): void {
      const p = seated(String(req.sessionID));
      if (p) req.system.push({ type: "text", text: W().keep(p.karta, p.name, p.realm) });
    },
    onEvent(ev: any): void {
      if (ev?.type !== ENDED) return;
      const s: unknown = ev.data?.sessionID;
      const key = keyOf(ev);
      if (typeof s !== "string" || !key) return;
      const p = seated(s);
      if (!p) return; // a session without a seat keeps no keys
      const seen = done.get(s) ?? new Set<string>();
      if (seen.has(key)) return;
      seen.add(key);
      done.set(s, seen);
      void tell(s, W().back(p.karta, p.name, p.realm));
    },
    forget: (session: string): void => void done.delete(session),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
