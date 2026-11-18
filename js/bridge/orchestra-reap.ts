// The daemon closes its own OpenCode launch's terminal when nobody else will (graph
// @nks/nks-dev, #11099, #7519, #9256): the stop order expired or failed, its window passed, the
// launch never sat, or the row ended without an observed client exit. The close is the agent
// bridge's own — orcaCloseObserved with the same proof of ours (terminal, runtime, incarnation,
// tree path, runIdentity); a proof that does not hold leaves the terminal untouched, said.
import { ORCHESTRA } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { orcaCloseObserved, ownClient } from "./orca-stop.ts";
import { readRuns, type Run, runIdentity } from "./orchestra-runs.ts";
import { stopLapsed } from "./orchestra-window.ts";

const w = () => words(ORCHESTRA);
const NO_SEAT = new Set(["tree_no_seat_unverified", "exec_no_seat_unverified"]);
type Close = typeof orcaCloseObserved;

/** Why the daemon must close this run's terminal itself; null — not its turn, or tried. */
export function reapCause(r: Run, now = Date.now()): string | null {
  if (r.harness !== "opencode" || r.dsh || !(r.tree || r.exec) || !r.terminal || !r.runtime)
    return null;
  if (r.reaped || r.closed === "client_exited" || r.exec?.exit || r.tree?.exit) return null;
  if (r.state === "stopping") {
    if (r.stop_outcome === "expired" || r.stop_outcome === "failed")
      return `stop_${r.stop_outcome}`;
    return stopLapsed(r, now) ? `stop_${r.stop_outcome ?? "unanswered"}` : null;
  }
  if (r.state === "ended") return "ended";
  return r.state === "ambiguity" && NO_SEAT.has(r.why ?? "") ? "no_seat" : null;
}

/** Close what is due once per row; a closed client ends the row for the tree cleanup. */
export async function reapOwn(
  authDir: string,
  runs: Record<string, Run>,
  gone?: { gone: boolean },
  close: Close = orcaCloseObserved,
  now = Date.now(),
): Promise<string[]> {
  const said: string[] = [];
  for (const [key, r] of Object.entries(runs)) {
    const cause = reapCause(r, now);
    if (!cause) continue;
    if (gone?.gone) break;
    const expected = ownClient(r);
    const identity = runIdentity(r);
    const current = (): boolean => {
      const latest = readRuns(authDir)[key];
      return !!latest && runIdentity(latest) === identity && latest.closed !== "client_exited";
    };
    const outcome = expected
      ? await close(r.terminal!, r.runtime!, current, expected)
      : "client_unbound";
    r.reaped = outcome ?? "client_exited";
    if (outcome === null) {
      const at = new Date(now).toISOString();
      r.closed = "client_exited";
      if (r.exec) r.exec.exit = at;
      if (r.tree) r.tree.exit = at;
      r.state = "ended";
    }
    said.push(w().leadRow(r.realm, r.room, r.invite, `${cause}, ${r.reaped}`));
  }
  return said;
}
