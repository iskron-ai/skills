// The Orca adapter of the orchestrator (graph @nks/nks-dev, nodes #9966, #9971, #9968, #9969):
// the installed CLI's version and declared schema are read first; the launch is one argv array
// through execFile, never a shell; an ambiguous outcome is not retried with a second agent.
// `orca` is found on the daemon's PATH.
import { execFile } from "node:child_process";

/** The version whose surface was observed (#9966); any other — nothing is launched. */
export const ORCA_VERSION = "1.4.242";
const FLAGS = ["agent", "worktree", "model", "prompt", "json"];

function run(args: string[], timeoutMs: number): Promise<{ code: number | string; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "orca",
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const code = !e
          ? 0
          : e.killed
            ? "timeout"
            : typeof e.code === "number"
              ? e.code
              : (e.code ?? 1);
        resolve({ code, out: String(stdout ?? "") });
      },
    );
  });
}

/** The installed surface is the observed one; a code when it is not. */
export async function orcaReady(): Promise<string | null> {
  const v = await run(["--version"], 10_000);
  if (v.code !== 0) return v.code === "ENOENT" ? "orca_missing" : "orca_unreadable";
  if (v.out.trim() !== ORCA_VERSION) return "orca_version_unverified";
  const ctx = await run(["agent-context", "--json"], 10_000);
  try {
    const schema = JSON.parse(ctx.out) as {
      commands?: { command?: string; flags?: string[] }[];
    };
    const launch = schema.commands?.find((c) => c.command === "agent launch");
    if (ctx.code === 0 && launch && FLAGS.every((f) => launch.flags?.includes(f))) return null;
  } catch {
    /* below */
  }
  return "orca_schema_unverified";
}

export function launchArgv(
  agent: string,
  worktree: string,
  model: string,
  prompt: string,
): string[] {
  return [
    "agent",
    "launch",
    "--agent",
    agent,
    "--worktree",
    `path:${worktree}`,
    "--model",
    model,
    "--prompt",
    prompt,
    "--json",
  ];
}

/** ok — the harness was started (not yet a seat); ambiguous — do not launch again. */
export async function orcaLaunch(
  argv: string[],
): Promise<{ outcome: "ok" | "ambiguous" | "failed"; why?: string }> {
  const r = await run(argv, 120_000);
  if (r.code === 0) return { outcome: "ok" };
  if (r.code === "timeout") return { outcome: "ambiguous", why: "launch_timeout" };
  return { outcome: "failed", why: `launch_exit_${r.code}` };
}
