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

/** A remote url in the repository form of #4518: host/org/repo, no scheme, user or .git. */
export function remoteKey(url: string): string {
  let u = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
  u = u.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^[^@/]+@/, "");
  if (!scheme) u = u.replace(/^([^/:]+):/, "$1/");
  return u.replace(/\/+$/, "").replace(/\.git$/, "");
}

/** The checkout of a repository by Orca's own projects: exactly one ready local setup. */
export type CheckoutOf = (repository: string) => { path: string } | { code: string };

/** Orca's projects and setups as 1.4.242 prints them (case №4050 [8]); a code when unreadable. */
export async function orcaCheckouts(): Promise<CheckoutOf | string> {
  const list = await run(["project", "list", "--json"], 10_000);
  const setups = await run(["project", "setups", "--json"], 10_000);
  type Project = {
    id?: unknown;
    gitRemoteIdentity?: { canonicalKey?: unknown; remoteUrl?: unknown };
  };
  type Setup = { projectId?: unknown; path?: unknown; setupState?: unknown; hostId?: unknown };
  let projects: Project[];
  let ready: Setup[];
  try {
    if (list.code !== 0 || setups.code !== 0) throw new Error();
    projects = (JSON.parse(list.out) as { result: { projects: Project[] } }).result.projects;
    ready = (JSON.parse(setups.out) as { result: { setups: Setup[] } }).result.setups;
    if (!Array.isArray(projects) || !Array.isArray(ready)) throw new Error();
  } catch {
    return "orca_projects_unreadable";
  }
  return (repository) => {
    const ids = new Set(
      projects
        .filter((p) => {
          const g = p.gitRemoteIdentity ?? {};
          return (
            g.canonicalKey === repository ||
            (typeof g.remoteUrl === "string" && remoteKey(g.remoteUrl) === repository)
          );
        })
        .map((p) => p.id),
    );
    const paths = [
      ...new Set(
        ready
          .filter(
            (s) =>
              ids.has(s.projectId) &&
              s.setupState === "ready" &&
              s.hostId === "local" &&
              typeof s.path === "string" &&
              s.path,
          )
          .map((s) => s.path as string),
      ),
    ];
    if (!paths.length) return { code: "no_checkout" };
    if (paths.length > 1) return { code: "ambiguous_checkout" };
    return { path: paths[0] };
  };
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
