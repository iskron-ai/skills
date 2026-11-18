// When our raised seat's composition ends it (graph @nks/nks-dev, #6010, #9970, #10955,
// #11099): the platform's idle_due; no join within the raise window; and for OpenCode, as the
// dsh sleep reads its case, every case of the composition closed or abandoned, or an empty
// composition with no signal of the seat for the idle window. A refused case read decides
// nothing; a 409 at n holds our own reading until a newer signal.
import { readCaseStatus } from "./orchestra-case-read.ts";
import type { Run } from "./orchestra-runs.ts";
import { DORMANT_WINDOW_MS, RAISE_WINDOW_MS } from "./orchestra-window.ts";

export type EndWhy = "idle_due" | "no_join" | "composition_closed" | "idle_window";

const live = (r: Run): boolean =>
  r.state === "raised" && !r.exec?.exit && !r.tree?.exit && !!r.standing_id;
/** Our own reading may end only an OpenCode seat the platform did not just call live. */
const ours = (r: Run): boolean =>
  r.harness === "opencode" && !r.dsh && !(r.live_n !== undefined && r.live_n === r.n);

export function endWhy(r: Run, closed: ReadonlySet<string>, now: number): EndWhy | null {
  if (!live(r)) return null;
  if (r.rooms === 0 && r.idle_due) return "idle_due";
  if (r.rooms === 0 && !r.sat && now - Date.parse(r.at) > RAISE_WINDOW_MS) return "no_join";
  if (!ours(r)) return null;
  if (r.cases?.length && r.cases.every((c) => closed.has(c))) return "composition_closed";
  if (r.rooms === 0 && now - Date.parse(r.signal_at ?? r.at) > DORMANT_WINDOW_MS)
    return "idle_window";
  return null;
}

/** The composition cases of our live OpenCode seats that answered closed or abandoned. */
export async function closedCases(
  base: string,
  token: string,
  runs: Record<string, Run>,
): Promise<Set<string>> {
  const closed = new Set<string>(),
    read = new Set<string>();
  for (const r of Object.values(runs)) {
    if (!live(r) || !ours(r)) continue;
    for (const room of r.cases ?? []) {
      if (read.has(room)) continue;
      read.add(room);
      try {
        if ((await readCaseStatus(base, token, room)) === "closed") closed.add(room);
      } catch {
        /* a refused read names neither open nor closed */
      }
    }
  }
  return closed;
}
