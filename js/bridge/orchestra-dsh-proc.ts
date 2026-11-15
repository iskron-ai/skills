// What a run's own dsh process says and whether it lives (graph @nks/nks-dev, node #10777):
// its NDJSON event file, its exit, its end by its own process group — never another's pid.
import { readFileSync } from "node:fs";

import type { Run } from "./orchestra-runs.ts";

/** Exits this process saw, by pid: a restarted daemon finds the pid gone instead. */
export const exits = new Map<number, string>();

/** What the event file said so far: the first session id and the final reason. */
export function dshEvents(path: string): { session?: string; final?: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {};
  }
  const out: { session?: string; final?: string } = {};
  for (const line of text.split("\n")) {
    let e: { type?: unknown; sessionId?: unknown; reason?: { kind?: unknown } };
    try {
      e = JSON.parse(line) as typeof e;
    } catch {
      continue;
    }
    const id = typeof e.sessionId === "string" && e.sessionId ? e.sessionId.slice(0, 128) : "";
    if (e.type === "session" && id && !out.session) out.session = id;
    if (e.type === "final")
      out.final = typeof e.reason?.kind === "string" ? e.reason.kind.slice(0, 64) : "unknown";
  }
  return out;
}

/** The exit of the run's own process, or undefined while it lives. */
export function dshExit(r: Run): string | undefined {
  if (!r.dsh) return undefined;
  const seen = exits.get(r.dsh.pid);
  if (seen) return seen;
  try {
    process.kill(r.dsh.pid, 0);
    return undefined;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM" ? undefined : "unknown";
  }
}

/** End the run's own process group — only while its exit is unseen. */
export function dshTerminate(r: Run, why: string): void {
  if (!r.dsh || r.dsh.terminated || dshExit(r)) return;
  try {
    process.kill(-r.dsh.pid, "SIGTERM");
    r.dsh.terminated = why;
  } catch {
    /* gone meanwhile — the exit decides */
  }
}

/** One observation of a live dsh run: events read, a confirmed stop ends its own process; true
 * when its exit is newly seen — the caller records it as the client's exit. */
export function observeDsh(r: Run): boolean {
  if (!r.dsh || r.dsh.exit) return false;
  const seen = dshEvents(r.dsh.events);
  if (seen.session && !r.dsh.session) r.dsh.session = seen.session;
  if (seen.final) r.dsh.final = seen.final;
  if (r.stop_outcome === "stopped") dshTerminate(r, "stopped");
  const exit = dshExit(r);
  if (!exit) return false;
  r.dsh.exit = exit;
  return true;
}

/** Our dsh process exited and the tape, read after it, shows no seat: the run ends, nothing
 * to stop (#10777). True — ended here. */
export function endDshUnseated(r: Run, live: boolean): boolean {
  if (!r.dsh?.exit || !r.tree?.exit || r.standing_id || !live) return false;
  r.state = "ended";
  r.why = `dsh_ended_${r.dsh.final ?? "no_final"}`;
  return true;
}
