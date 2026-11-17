// The dormancy of a raised dsh run (graph @nks/nks-dev, node #10995): a clean exit — final
// completed, exit 0, a session in hand — with the call's case still open does not end the run.
// It sleeps: the tree and the dsh session stay, the slot frees, and the tact watches the case
// journal until a word wakes the continuation `dsh --session-id` (orchestra-dsh-run.ts) or the
// sleep ends — a closed case, a revoked seat, a stop order on the seat, the window. The seat's
// own stop at the exit is not touched: the sleep arms only where the run would end anyway.
import { type CaseEntry,readCaseHistory, readCaseStatus } from "./orchestra-case-read.ts";
import type { Run } from "./orchestra-runs.ts";

/** A dsh exit that can sleep: final completed, exit 0, a session to continue. */
export const dshSleepable = (r: Run): boolean =>
  r.dsh?.final === "completed" && r.dsh.exit === "0" && !!r.dsh.session;

/**
 * Arm the sleep on a run whose end was already decided: the case must still be open, and the
 * journal is read whole once — the cursor takes its last number, the wake keeps the seat ids
 * (the row's own and every earlier one), the invite entry's role uuid and the seat's own asks.
 * True — the row sleeps; false — the end stands as it was decided. A failed read keeps the
 * end: nothing is slept on a guess.
 */
export async function goDormant(base: string, token: string, r: Run): Promise<boolean> {
  if (!dshSleepable(r) || r.tree?.state !== "ready") return false;
  let read: { entries: CaseEntry[]; cursor: number };
  try {
    if ((await readCaseStatus(base, token, r.room)) !== "open") return false;
    read = await readCaseHistory(base, token, r.room);
  } catch {
    return false;
  }
  const seats = [...new Set([...(r.dormant?.seats ?? []), r.standing_id].filter((s): s is string => !!s))];
  const asks: Record<string, string> = {};
  for (const e of read.entries)
    if (e.kind === "ask" && e.author_standing_id && seats.includes(e.author_standing_id))
      asks[e.n] = e.author_standing_id;
  const karta = read.entries.find((e) => e.n === r.invite)?.to_karta_node_id;
  r.state = "dormant";
  r.dormant = {
    since: new Date().toISOString(),
    cursor: read.cursor,
    seats,
    ...(karta ? { karta } : {}),
    asks,
  };
  return true;
}

/** The tact's ended dsh rows sleep too (#10995) — except a stop ordered elsewhere, which is a
 * wind-down: its end stays an end. Called where a tact settles stops into ends synchronously. */
export async function dormantFromEnds(
  base: string,
  token: string,
  runs: Record<string, Run>,
): Promise<void> {
  for (const r of Object.values(runs))
    if (r.state === "ended" && !r.why?.endsWith("_elsewhere") && r.tree?.state === "ready")
      await goDormant(base, token, r);
}
