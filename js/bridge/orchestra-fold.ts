// The raised tape folded into the registry (graph @nks/nks-dev, nodes #5042, #6010, #11099):
// which of OUR launches sat down (its spawned_for), its composition at the greatest n — the
// count and the case ids — and when the daemon last heard of the seat.
import { signalRun } from "./orchestra-dsh-reinvite.ts";
import type { Run } from "./orchestra-runs.ts";

type Signal = Record<string, unknown>;

export const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && v) return v;
  const id = (v as { id?: unknown } | null)?.id;
  return typeof id === "string" && id ? id : null;
};

/** The run a signal speaks of: its spawned_for names our invite in our case. */
function runOf(realm: string, s: Signal, runs: Record<string, Run>): Run | null {
  const sf = (s.spawned_for ?? {}) as { invite?: unknown; room?: unknown };
  const invite = Number(sf.invite);
  const room = idOf(sf.room) ?? idOf(s.room);
  if (!Number.isSafeInteger(invite) || !room) return null;
  return signalRun(realm, room, invite, runs);
}

/** Fold one realm's tape into the registry: seats found, compositions at their greatest n. */
export function foldTape(
  realm: string,
  tape: Signal[],
  runs: Record<string, Run>,
  now = Date.now(),
): void {
  for (const s of tape) {
    const run = runOf(realm, s, runs);
    if (!run || run.state === "ended") continue;
    const seat = idOf(s.standing) ?? idOf(s.standing_id);
    if (seat) run.standing_id = seat;
    // A seat with our spawned_for is ours, whatever the launch's own outcome said.
    if (run.state === "launched" || run.state === "no_seat" || run.state === "refused")
      run.state = "raised";
    const n = Number(s.n);
    const idle = s.cause === "idle_due" || s.cause === "idle_warned";
    if (Number.isFinite(n) && run.n !== undefined && n < run.n) continue;
    run.signal_at = new Date(now).toISOString();
    // Any signal after idle_due — a membership or a fresh warning — means the count restarted.
    if (s.cause === "idle_due") run.idle_due = true;
    else delete run.idle_due;
    if (!Number.isFinite(n)) continue;
    run.n = n;
    if (idle) {
      // Idleness is an empty composition: a seat seen first by it has no rooms.
      run.rooms ??= 0;
      continue;
    }
    const rooms = Array.isArray(s.rooms) ? s.rooms : [];
    run.rooms = rooms.length;
    run.cases = rooms.map(idOf).filter((id): id is string => !!id);
    if (run.rooms > 0) run.sat = true;
  }
}
