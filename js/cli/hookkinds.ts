// The ritual hooks a repository's Claude Code settings carry of its own (graph @nks/nks-dev,
// node #9319, section RITUALS): each kind known in any form — inline or a script (#9331). The
// delivery's hooks keep silent on a kind the repository holds itself, and prepare names it for
// the transition; the settings file and its local twin are both read.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { type PrepareLeft, PRODUCT } from "../delivery/index.ts";
import { knownHook, runsOn } from "./preparescripts.ts";

export type RiteKind = Extract<
  PrepareLeft,
  "hook.start" | "hook.guard" | "hook.push" | "hook.merge"
>;

export interface Hook {
  type?: string;
  command?: string;
}
export interface Entry {
  matcher?: string;
  hooks?: Hook[];
}
export type Settings = { hooks?: Record<string, Entry[]> } & Record<string, unknown>;

/** Each kind: its event, how a command of it is known, the matchers it runs on. */
export const KNOWN: Record<
  RiteKind,
  { event: string; known: (c: string) => boolean; on?: (matcher?: string) => boolean }
> = {
  "hook.start": { event: "SessionStart", known: (c) => c.toLowerCase().includes(PRODUCT) },
  "hook.guard": {
    event: "PreToolUse",
    known: (c) => /\.claude\W{0,4}projects/.test(c) && /memory/i.test(c),
    on: (m) => !m || m === "*" || ["Write", "Edit"].every((t) => runsOn(m, t)),
  },
  "hook.push": { event: "PostToolUse", known: (c) => c.includes("git(?: -C [^ ]+)* push") },
  "hook.merge": { event: "PostToolUse", known: (c) => c.includes("gh pr merge") },
};

export const hooksOf = (s: Settings, event: string, on = (_?: string) => true): Hook[] =>
  (s.hooks?.[event] ?? []).filter((e) => on(e.matcher)).flatMap((e) => e.hooks ?? []);
export const cmd = (h: Hook): string => h.command ?? "";

/** The hooks of this kind in the settings that read as it, inline or by their script. */
export const knownOf = (root: string, s: Settings, kind: RiteKind): Hook[] => {
  const k = KNOWN[kind];
  return hooksOf(s, k.event, k.on).filter((h) => knownHook(root, cmd(h), k.known));
};

function read(path: string): Settings {
  try {
    const s: unknown = JSON.parse(readFileSync(path, "utf8"));
    return s && typeof s === "object" && !Array.isArray(s) ? (s as Settings) : {};
  } catch {
    return {};
  }
}

/** The ritual kinds the repository's own settings hold. */
export function standingRites(root: string): Set<RiteKind> {
  const files = ["settings.json", "settings.local.json"].map((f) => read(join(root, ".claude", f)));
  const kinds = Object.keys(KNOWN) as RiteKind[];
  return new Set(kinds.filter((k) => files.some((s) => knownOf(root, s, k).length > 0)));
}
