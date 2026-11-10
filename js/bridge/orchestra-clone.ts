// The clone of a repository Orca does not know (graph @nks/nks-dev, nodes #10078, #9966, #4518;
// case №4206): only when the human's launcher description says clone, names clone_root and
// lists the call's host/org in allow. The url is https of the invite's repository host/org/repo;
// the folder is <clone_root>/<org>/<repo> and is never overwritten; the clone is Orca's own
// `project setup-clone`, one argv array, the machine's git credentials — the bridge holds none.
// It runs in the daemon's background, not inside the tact (orchestra-cloning.ts).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

import { run } from "./orchestra-orca.ts";

export interface ClonePolicy {
  root: string;
  /** host/org, the host in lower case. */
  allow: string[];
}

const ALLOW = /^[^\s/:@]+\/[^\s/:@]+$/;
const SEGMENT = /^[A-Za-z0-9._-]+$/;

const hostLower = (hostOrg: string): string => {
  const [host, org] = hostOrg.split("/");
  return `${host.toLowerCase()}/${org}`;
};

/** The description's clone fields; null — no clone; a code when they cannot stand. */
export function parseClone(d: Record<string, unknown>): ClonePolicy | null | { code: string } {
  if (d.clone === undefined || d.clone === false) return null;
  if (d.clone !== true) return { code: "clone_invalid" };
  const raw = typeof d.clone_root === "string" ? d.clone_root.trim() : "";
  const root = raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
  if (!root || !isAbsolute(root)) return { code: "clone_root_invalid" };
  const allow = d.allow;
  if (
    !Array.isArray(allow) ||
    !allow.length ||
    !allow.every((a) => typeof a === "string" && ALLOW.test(a.trim()))
  )
    return { code: "allow_invalid" };
  return { root, allow: (allow as string[]).map((a) => hostLower(a.trim())) };
}

/** Where and from what the repository would be cloned, or why not. */
export function cloneTarget(
  policy: ClonePolicy,
  repository: string,
): { url: string; destination: string } | { code: string } {
  const parts = repository.split("/");
  if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p) && p !== "." && p !== ".."))
    return { code: "clone_refused (repository_form)" };
  const [host, org, repo] = parts;
  if (!policy.allow.includes(hostLower(`${host}/${org}`)))
    return { code: "clone_refused (not_allowed)" };
  const destination = join(policy.root, org, repo);
  if (existsSync(destination)) return { code: "clone_refused (destination_exists)" };
  return { url: `https://${host}/${org}/${repo}.git`, destination };
}

/** The installed Orca declares setup-clone with the flags used (#9966). */
export async function cloneDeclared(): Promise<boolean> {
  const ctx = await run(["agent-context", "--json"], 10_000);
  try {
    const schema = JSON.parse(ctx.out) as {
      commands?: { command?: string; flags?: string[] }[];
    };
    const c = schema.commands?.find((x) => x.command === "project setup-clone");
    return ctx.code === 0 && !!c && ["url", "destination"].every((f) => c.flags?.includes(f));
  } catch {
    return false;
  }
}

export function cloneArgv(url: string, destination: string): string[] {
  return ["project", "setup-clone", "--url", url, "--destination", destination];
}
