// Reading the delivery's own skill files outside the working copy (graph nks-dev:
// risk #6847, owner's measure; surface #5048). OpenCode closes reads outside the
// session's directory with the external_directory rule, and the installed skill
// set lies outside it: SKILL.md comes through the skill tool, its references/*.md
// do not. The plugin lifts that ask for reading only, and only inside the
// directory of a delivery skill — one of the installed set that carries the delivery's
// bridge, told by its root and by the install lock's source beside it (no readable lock —
// nothing); a glob or grep, only in a skill no symlink of which leads out; an ask, only
// for a call of its own session.
//
// Observed on OpenCode 2.0.24 (isolated --standalone): the permission "evaluate" hook
// sees {action: "external_directory", resources: ["<dir of the path>/*"], effect: "ask",
// source: {type: "tool", id: <call id>}} with the path as the tool got it (no realpath);
// setting effect to "allow" passes the call. The hook carries no tool name, and a
// write passes the same ask before its own "edit" check (allowed by default) — so the
// tool is taken from the tool hook "execute.before", which fires first with the same
// call id. ctx.skill.list() holds only the built-in skills during setup; the installed
// ones come with skill.updated, with realpath'd paths — so the list is read at the ask.
/* eslint-disable @typescript-eslint/no-explicit-any -- hook payloads without a schema */
import { type Dirent, existsSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { BRIDGE_FILE, BRIDGE_SKILL } from "../shared/clients.ts";
import { skillLock } from "../shared/skilllock.ts";
import type { Context } from "./plugin.ts";

/** Tools that only read; any other tool keeps OpenCode's own ask. */
const READERS = new Set(["read", "glob", "grep"]);
/** Calls remembered between execute.before and the ask — the oldest drop first. */
const CALLS = 256;
/** Entries a skill directory is walked for symlinks; a bigger one is not opened to glob or grep. */
const WALK = 4096;

interface Call {
  tool: string;
  input: any;
  session: unknown;
}

const canon = (p: string): string | null => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/** The directory an external_directory resource names ("<dir>/*"); a wider pattern — null. */
export function resourceDir(resource: string): string | null {
  const dir = resource.replace(/[\\/]\*$/, "");
  return /[*?[\]{}]/.test(dir) ? null : dir;
}

/** p lies in root or under it, both already canonical. */
export function within(p: string, root: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Canonical directories of the delivery skills OpenCode has loaded. */
async function skillDirs(ctx: Context): Promise<string[]> {
  const res: any = await ctx.skill.list();
  const list: any[] = Array.isArray(res) ? res : (res?.data ?? []);
  // A skill's own directory bears its id, as an install lays it out: a SKILL.md that
  // lies in a wider directory (a repository root) opens nothing.
  const listed: { id: string; dir: string }[] = [];
  for (const s of list) {
    const path = typeof s?.path === "string" ? s.path : null;
    if (!path || !isAbsolute(path)) continue;
    const dir = canon(dirname(path));
    const id = String(s?.id ?? "");
    if (dir && basename(dir) === id) listed.push({ id, dir });
  }
  // The delivery's sets: roots whose bridge skill carries the bridge. A skill is the set's
  // only when the install lock beside the root names it with the bridge skill's source:
  // a root shares its directory with any other set. No lock proves nothing, and a lock
  // that does not parse is a refusal — either root opens nothing.
  const sets = new Map<string, ReturnType<typeof skillLock>>();
  for (const { id, dir } of listed)
    if (id === BRIDGE_SKILL && existsSync(join(dir, "scripts", BRIDGE_FILE)))
      sets.set(dirname(dir), skillLock(dirname(dir)));
  return listed
    .filter(({ id, dir }) => {
      const lock = sets.get(dirname(dir));
      if (!lock) return false;
      const source = lock[BRIDGE_SKILL]?.source;
      return typeof source === "string" && lock[id]?.source === source;
    })
    .map(({ dir }) => dir);
}

/** A symlink under dir (canonical) whose target leaves it or is gone; too big to walk — true. */
function leadsOut(dir: string): boolean {
  const stack = [dir];
  let seen = 0;
  while (stack.length) {
    const d = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const e of entries) {
      if (++seen > WALK) return true;
      const p = join(d, e.name);
      if (e.isSymbolicLink()) {
        const c = canon(p);
        if (!c || !within(c, dir)) return true;
      } else if (e.isDirectory()) stack.push(p);
    }
  }
  return false;
}

/**
 * A path as OpenCode 2.0.24 resolves a tool's path (FileAccess.resolve): "~" and "~/…"
 * from the home, a relative one from the session's directory; no base — null.
 */
export function absolute(p: string, base: string | null): string | null {
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(1));
  if (isAbsolute(p)) return p;
  return base ? resolve(base, p) : null;
}

/** Paths a reading call reaches; null — a call that names more than paths. */
function reached(call: Call, resources: readonly string[], base: string | null): string[] | null {
  const out: string[] = [];
  for (const r of resources) {
    const dir = resourceDir(String(r));
    if (!dir) return null;
    out.push(dir);
  }
  const input = call.input ?? {};
  for (const key of ["path", "filePath"]) {
    const p = input[key];
    if (p === undefined) continue;
    const abs = typeof p === "string" ? absolute(p, base) : null;
    if (!abs) return null;
    out.push(abs);
  }
  // A file pattern (glob's pattern, grep's include) stays under the path: no root, no
  // home, no ".." anywhere — braces could spell a climb a segment check would miss.
  for (const key of ["pattern", "include"]) {
    if (call.tool === "grep" && key === "pattern") continue;
    const pat = input[key];
    if (pat === undefined) continue;
    if (typeof pat !== "string" || isAbsolute(pat) || pat.startsWith("~") || pat.includes(".."))
      return null;
  }
  return out.length ? out : null;
}

/** False — this OpenCode has no permission or tool hooks, and the reads keep their ask. */
export async function setupSkillReads(ctx: Context): Promise<boolean> {
  const { permission, tool } = ctx as Partial<Pick<Context, "permission" | "tool">>;
  if (typeof permission?.hook !== "function" || typeof tool?.hook !== "function") return false;

  const calls = new Map<string, Call>();
  await tool.hook("execute.before", (t) => {
    if (typeof t?.id !== "string" || typeof t?.tool !== "string") return;
    // One id met for two calls — the ask cannot tell which it is for: it opens nothing.
    const was = calls.get(t.id);
    const clash = was && (was.tool !== t.tool || was.session !== t.sessionID);
    calls.set(t.id, { tool: clash ? "" : t.tool, input: t.input, session: t.sessionID });
    while (calls.size > CALLS) calls.delete(calls.keys().next().value as string);
  });

  // A relative path is the session's, and a session's hooks fire only in the instance
  // whose directory it is (#5048) — so this instance's directory is the session's.
  const loc = (ctx as { location?: { directory?: unknown } }).location;
  const base = typeof loc?.directory === "string" && loc.directory ? loc.directory : null;

  // Only an ask is lifted: an explicit deny of the user's config stays a deny. The
  // evaluation does not tell a configured ask from the default one — both are lifted.
  await permission.hook("evaluate", async (e) => {
    if (e?.action !== "external_directory" || e.effect !== "ask") return;
    const id = e.source?.type === "tool" ? e.source.id : null;
    const call = typeof id === "string" ? calls.get(id) : undefined;
    // The call is the ask's only when it is of the same session: an id is not unique across them.
    if (!call || !READERS.has(call.tool) || typeof e.sessionID !== "string") return;
    if (e.sessionID !== call.session) return;
    const paths = reached(call, Array.isArray(e.resources) ? e.resources : [], base);
    if (!paths) return;
    const roots = await skillDirs(ctx);
    const walked = new Set<string>();
    for (const p of paths) {
      const c = canon(p);
      const root = c ? roots.find((r) => within(c, r)) : undefined;
      if (!root) return;
      walked.add(root);
    }
    // A read is judged by its realpath above; a glob or grep descends and follows what it meets.
    if (call.tool !== "read" && [...walked].some(leadsOut)) return;
    e.effect = "allow";
  });
  return true;
}
