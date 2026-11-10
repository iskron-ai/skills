// The clone's run (graph @nks/nks-dev, node #10078, its retry-and-time paragraph; case №4206): the tact
// starts it in the daemon's background with a registry row `cloning` and goes on — quenching
// and expiry never wait for git; a later tact finds the outcome and raises. A failed clone is
// kept by repository and not tried again until the launcher description changes. Git never
// asks (GIT_TERMINAL_PROMPT=0, GCM_INTERACTIVE=never); a timeout kills the clone's whole
// process group; its output is never read. A clone left by a former daemon is no clone: its
// half-written folder, if any, refuses as destination_exists — the human sorts it.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { envName } from "../delivery/index.ts";
import { cloneArgv, cloneDeclared, type ClonePolicy, cloneTarget } from "./orchestra-clone.ts";
import { readClones, writeClone } from "./orchestra-runs.ts";

/** A clone takes longer than a launch: a large repository over a slow line. */
const CLONE_MS = Number(process.env[envName("ORCHESTRA_CLONE_MS")]) || 600_000;

/** The launcher description a clone ran under: its failure stands until this changes. */
export const specOf = (launcher: unknown): string =>
  createHash("sha256").update(JSON.stringify(launcher)).digest("hex").slice(0, 16);

/** The clone as one process group, its output unread; a timeout kills the whole group. */
function cloneRun(argv: string[], ms: number): Promise<number | string> {
  return new Promise((resolve) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
    const group = process.platform !== "win32";
    const child = spawn("orca", argv, { detached: group, stdio: "ignore", windowsHide: true, env });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (group && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, ms);
    const done = (code: number | string): void => {
      clearTimeout(timer);
      resolve(timedOut ? "timeout" : code);
    };
    child.once("error", (e: NodeJS.ErrnoException) => done(e.code ?? 1));
    child.once("exit", (code, signal) => done(code ?? signal ?? 1));
  });
}

/** Clones this daemon runs now: a cloning row without one here is a former daemon's. */
const inflight = new Set<string>();

/**
 * One tact's turn of the clone: "cloned" — look for the checkout again; "gone" — the caller
 * left before the start (#8202); any other word is said for the row: cloning (started now or
 * still running), a refusal, a failure — once as clone_failed, then clone_failed_before.
 */
export async function cloneTurn(
  authDir: string,
  policy: ClonePolicy,
  spec: string,
  repository: string,
  gone?: { gone: boolean },
): Promise<string> {
  const row = readClones(authDir)[repository];
  if (row?.state === "cloning" && inflight.has(repository)) return "cloning";
  if (row?.state === "cloned") return "cloned";
  if (row?.state === "failed" && row.spec === spec) {
    if (row.told) return `clone_failed_before (${row.why})`;
    writeClone(authDir, repository, { ...row, told: true });
    return `clone_failed (${row.why})`;
  }
  if (row) writeClone(authDir, repository, null);
  const target = cloneTarget(policy, repository);
  if ("code" in target) return target.code;
  if (!(await cloneDeclared())) return "clone_failed (orca_schema_unverified)";
  try {
    mkdirSync(dirname(target.destination), { recursive: true });
  } catch {
    return "clone_failed (clone_root_unwritable)";
  }
  if (gone?.gone) return "gone";
  inflight.add(repository);
  writeClone(authDir, repository, { state: "cloning", at: new Date().toISOString(), spec });
  void cloneRun(cloneArgv(target.url, target.destination), CLONE_MS).then((code) => {
    inflight.delete(repository);
    const why =
      code === 0 ? undefined : code === "timeout" ? "clone_timeout" : `clone_exit_${code}`;
    const at = new Date().toISOString();
    try {
      writeClone(
        authDir,
        repository,
        why ? { state: "failed", at, spec, why } : { state: "cloned", at, spec },
      );
    } catch {
      /* the registry unwritable: the row stays cloning with no clone in flight — tried again */
    }
  });
  return "cloning";
}

/** The cloned repository found as Orca's checkout — its row is done; not found — kept failed. */
export function cloneTaken(
  authDir: string,
  repository: string,
  spec: string,
  found: boolean,
): string | null {
  if (found) {
    writeClone(authDir, repository, null);
    return null;
  }
  const at = new Date().toISOString();
  const why = "clone_unregistered";
  writeClone(authDir, repository, { state: "failed", at, spec, why, told: true });
  return `clone_failed (${why})`;
}
