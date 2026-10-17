// Whether a repository was ever aligned for the agent, read locally and only locally: no
// network, no platform call, no seat. Three signs the bootstrap leaves in the repository —
// the cover's front matter, the start hook, the stamp; the files and marks are the delivery's
// (REPO_SIGNS, COVER). The repository is the nearest directory upward with a .git entry
// (a directory, or the file of a worktree); none — "outside", and nothing is said.
// All three absent — "invite"; all present — "aligned"; some — "partial", which the door's
// alignment leads, not an invitation.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { COVER, REPO_SIGNS } from "../delivery/index.ts";
import { type CoverKeys, frontMatter } from "./cover.ts";

export type RepoVerdict = "invite" | "aligned" | "partial" | "outside";

export interface RepoSigns {
  root: string | null;
  cover: boolean;
  hook: boolean;
  stamp: boolean;
  verdict: RepoVerdict;
}

export interface SignKeys {
  readonly settings: string;
  readonly startMark: RegExp;
  readonly rituals: string;
  readonly stamp: RegExp;
}

const exists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

const text = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** The nearest directory upward holding .git; none — null. */
export function repoRoot(dir: string): string | null {
  let at = resolve(dir);
  for (;;) {
    if (exists(join(at, ".git"))) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
  }
}

/** A SessionStart entry whose command carries the delivery's mark. */
function startHook(settings: string | null, mark: RegExp): boolean {
  if (settings === null) return false;
  try {
    const entries = (JSON.parse(settings) as { hooks?: { SessionStart?: unknown } })?.hooks
      ?.SessionStart;
    if (!Array.isArray(entries)) return false;
    return entries.some(
      (e) =>
        Array.isArray((e as { hooks?: unknown })?.hooks) &&
        (e as { hooks: unknown[] }).hooks.some((h) => {
          const command = (h as { command?: unknown })?.command;
          return typeof command === "string" && mark.test(command);
        }),
    );
  } catch {
    return false;
  }
}

/** The three signs of the repository holding dir, and what they call for. */
export function repoSigns(
  dir: string,
  keys: SignKeys = REPO_SIGNS,
  cover: CoverKeys = COVER,
): RepoSigns {
  const root = repoRoot(dir);
  if (root === null) return { root, cover: false, hook: false, stamp: false, verdict: "outside" };
  const agents = text(join(root, cover.file));
  const pairs = agents === null ? null : frontMatter(agents);
  const signs = {
    cover: !!pairs && (pairs.has(cover.graph) || pairs.has(cover.role)),
    hook:
      startHook(text(join(root, keys.settings)), keys.startMark) ||
      exists(join(root, keys.rituals)),
    stamp: agents !== null && keys.stamp.test(agents),
  };
  const count = Number(signs.cover) + Number(signs.hook) + Number(signs.stamp);
  const verdict = count === 0 ? "invite" : count === 3 ? "aligned" : "partial";
  return { root, ...signs, verdict };
}
