// Which run this instance's stop may be the end of (graph @nks/nks-dev, nodes #6593, #11359).
// `opencode run --standalone` of a new session serves exactly that run from its own "serve
// --stdio". The instance's stop is no proof the run is over — a plugin reload inside a live run
// stops it too, and that session must keep its seat. So every stop is an absence (`away`, the
// return marker written), and the bridge is told the run's pid: the daemon ends the seats only
// if that run is gone within the death window, not left to the hearing watchdog (runend.ts). A
// run resuming a session (--session, -s, --continue, -c) ends while the session lives on: a
// plain absence. The shared service never learns a run's end — a default-shape run records none.
import { execFileSync } from "node:child_process";

import { standaloneClient } from "./client.ts";

const RESUMES = /(?:^|\s)(?:--session|-s|--continue|-c)(?:=|\s|$)/;

/** The run's command line; null — not readable (no ps, the run gone). */
function commandOf(pid: number): string | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The standalone run of a new session this instance serves — read at start, while it is alive;
 * null — no such run (the shared service, a resumed session, a line not readable).
 */
export function runOfInstance(): number | null {
  const run = standaloneClient();
  const line = run === null ? null : commandOf(run);
  return run !== null && line !== null && !RESUMES.test(line) ? run : null;
}
