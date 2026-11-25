// How this instance's stop reads (graph @nks/nks-dev, nodes #6593, #11359). `opencode run
// --standalone` of a new session serves exactly that run from its own "serve --stdio": the
// instance's stop is the run's end — the agent's end, `end`, its seat finished by its own bridge
// at once, not left to the hearing watchdog. A run resuming a session (--session, -s,
// --continue, -c) ends while the session lives on: an absence, `away`, as a reload is. The
// shared service never learns a run's end — a default-shape run records none (README).
import { execFileSync } from "node:child_process";

import { standaloneClient } from "./client.ts";
import type { PutDown } from "./putdown.ts";

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
 * The word the instance's stop puts its root seats down with — read at start, while the run
 * that started this instance is alive. A run whose line is not readable is not called ended.
 */
export function stopWordOfRun(): PutDown {
  const run = standaloneClient();
  const line = run === null ? null : commandOf(run);
  return line !== null && !RESUMES.test(line) ? "end" : "away";
}
