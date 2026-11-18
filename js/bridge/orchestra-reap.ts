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
/** The proof of ours did not hold: the terminal is never touched again. */
const NOT_OURS = new Set(["terminal_binding_changed", "client_unbound"]);
/** Tacts a transient refusal (Orca unreachable, an exit not seen) is tried before it is said
 * exhausted. */
const REAP_TRIES = 3;
/** The daemon's observed close of a client nothing else waits on — the tree cleanup's proof. */
export const REAPED_OVER = "client_exited_over";

/** Why the daemon must close this run's terminal itself; null — not its turn, or settled. */
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

/** Close what is due; the closed client's exit is recorded on the row. */
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
    said.push(w().leadRow(r.realm, r.room, r.invite, `${cause}, ${settle(r, outcome, now)}`));
    // A launch that never sat has no wakes to stop: its observed exit ends it (#11099).
    if (outcome === null && cause === "no_seat") {
      r.state = "ended";
      r.reaped = REAPED_OVER;
    }
  }
  return said;
}

/** Final: the observed exit, or a proof of ours that did not hold. Anything else is tried
 * again on later tacts — the count lies in the registry, so a restart keeps it. */
function settle(r: Run, outcome: string | null, now: number): string {
  if (outcome === null) {
    // The observed exit is a fact, not an end: the run ends by the path #9256 asks for — the
    // order confirmed, or one stop for the exit answered (exec-exit.ts finishExits).
    const at = new Date(now).toISOString();
    r.closed = "client_exited";
    if (r.exec) r.exec.exit = at;
    if (r.tree) r.tree.exit = at;
    delete r.reap_tries;
    return (r.reaped = "client_exited");
  }
  if (NOT_OURS.has(outcome)) return (r.reaped = outcome);
  r.reap_tries = (r.reap_tries ?? 0) + 1;
  if (r.reap_tries < REAP_TRIES) return outcome;
  r.reaped = "reap_exhausted";
  return `reap_exhausted (${outcome})`;
}
