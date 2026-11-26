// Which run this instance's stop may be the end of (graph @nks/nks-dev, nodes #6593, #11359).
// `opencode run --standalone` of a new session serves exactly that run from its own "serve
// --stdio". The instance's stop is no proof the run is over — a plugin reload inside a live run
// stops it too, and that session must keep its seat. So every stop is an absence (`away`, the
// return marker written), and the bridge is told the run's pid: the daemon ends the seats only
// if that run is gone within the death window, not left to the hearing watchdog (runend.ts). A
// run resuming a session (--session, -s, --continue, -c) ends while the session lives on: a
// plain absence. The shared service never learns a run's end — a default-shape run records none.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { standaloneClient } from "./client.ts";

/**
 * `opencode run` options that take a value (`opencode run --help`, OpenCode 2.2.x): the element
 * after one of them is its value, not an option.
 */
const VALUED = new Set([
  "--session",
  "-s",
  "--model",
  "-m",
  "--agent",
  "--format",
  "--file",
  "-f",
  "--title",
  "--completions",
  "--log-level",
  "--server",
]);
const CONTINUES = new Set(["--session", "-s", "--continue", "-c"]);

/**
 * The run's argv elements: exact on Linux (/proc, NUL-separated); elsewhere `ps` joins them with
 * spaces and they are split back on whitespace — an element with spaces inside comes back as
 * several. null — not readable (no ps, the run gone).
 */
function argvOf(pid: number): string[] | null {
  try {
    const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
    if (raw) return raw.replace(/\0$/, "").split("\0");
  } catch {
    /* not Linux, or gone — ps below */
  }
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
    return out ? out.split(/\s+/) : null;
  } catch {
    return null;
  }
}

/**
 * The run continues a session: an option element among those after `run` — exactly `--session`,
 * `--session=…`, `-s`, `--continue` or `-c`. A value that follows an option taking one is no
 * option; the options end at the first positional element (the message) or at `--`: a prompt
 * that mentions «--session» never counts. No `run` element — not judged a new run.
 */
export function continuesSession(argv: string[]): boolean {
  const at = argv.findIndex(
    (x, i) => x === "run" && i > 0 && /opencode(?:\.exe)?$/.test(argv[i - 1] ?? ""),
  );
  if (at < 0) return true;
  for (let i = at + 1; i < argv.length; i++) {
    const x = argv[i] ?? "";
    if (x === "--" || !x.startsWith("-")) return false;
    const name = x.split("=", 1)[0] ?? x;
    if (CONTINUES.has(name)) return true;
    if (VALUED.has(x)) i++; // its value
  }
  return false;
}

/**
 * The standalone run of a new session this instance serves — read at start, while it is alive;
 * null — no such run (the shared service, a resumed session, a line not readable).
 */
export function runOfInstance(): number | null {
  const run = standaloneClient();
  const argv = run === null ? null : argvOf(run);
  return run !== null && argv !== null && !continuesSession(argv) ? run : null;
}
