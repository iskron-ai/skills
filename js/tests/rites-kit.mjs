// The kit of the delivery's ritual probes (rituals-delivery.test.mjs, rituals-early.test.mjs):
// temporary repositories with a cover, the Claude Code plugin's declared rituals command run as
// the harness runs it, and the OpenCode plugin on a stand-in context. No network, no model.
//
// ISKRON_RITUALS_HOOK and ISKRON_OPENCODE_PLUGIN point the probes at any copy (a past release) so
// they can be shown red before the change.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

import { BUILT_RITUALS_HOOK, REPO } from "./built.mjs";
import { plugin, SANDBOX } from "./opencode-kit.mjs";

process.env.ISKRON_ROOT_SEAT = "0";
const HOOK = process.env.ISKRON_RITUALS_HOOK || BUILT_RITUALS_HOOK;
const scratch = mkdtempSync(join(tmpdir(), "rites-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

export const COVER =
  "---\niskron:\n  graph: r7\n  holon: 12\n  agent_role: 34\n  contract: 39\n  stamp: 2026-11-03\n---\n# x\n";
export const PUSHED = "To github.com:o/r.git\n   a1b2c3d..e4f5a6b  feat/x -> feat/x";
let n = 0;
export function repo({ agents = COVER, settings, rituals } = {}) {
  const dir = join(scratch, `r${n++}`);
  mkdirSync(join(dir, ".git"), { recursive: true });
  if (agents) writeFileSync(join(dir, "AGENTS.md"), agents);
  if (settings) {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(settings));
  }
  if (rituals) {
    mkdirSync(join(dir, ".opencode", "plugins"), { recursive: true });
    const file = typeof rituals === "string" ? rituals : "iskron-rituals.js";
    writeFileSync(join(dir, ".opencode", "plugins", file), "export default {};\n");
  }
  return dir;
}

// ── Claude Code: the plugin's declared command, run as the harness runs it ──────────────────

const declared = JSON.parse(readFileSync(join(REPO, "hooks", "hooks.json"), "utf8")).hooks;
export const ritesOf = (event) =>
  (declared[event] ?? []).filter((e) => e.hooks.some((h) => h.command.includes("'rituals.mjs'")));

const root = join(scratch, "plugin");
mkdirSync(join(root, "hooks"), { recursive: true });
if (existsSync(HOOK)) copyFileSync(HOOK, join(root, "hooks", "rituals.mjs"));

/** The hook's whole answer: the parsed JSON it printed, or null for none. */
export function claudeRaw(dir, input) {
  const command = ritesOf(input.hook_event_name)[0]?.hooks[0].command ?? "true";
  const env = { ...process.env, CLAUDE_PLUGIN_ROOT: root, ISKRON_BRIDGE_LANG: "ru" };
  const r = spawnSync(command, {
    shell: true,
    cwd: dir,
    env,
    encoding: "utf8",
    input: JSON.stringify({ cwd: dir, ...input }),
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
export const claude = (dir, input) => claudeRaw(dir, input)?.hookSpecificOutput ?? null;
export const start = (dir, source = "startup") =>
  claude(dir, { hook_event_name: "SessionStart", source });
export const bash = (dir, command, stdout = "", exit_code) =>
  claude(dir, {
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout, stderr: "", ...(exit_code === undefined ? {} : { exit_code }) },
  });

// ── OpenCode: the delivery plugin on a stand-in context ──────────────────────────────────────

export async function opencode(dir) {
  const rec = await plugin(
    {},
    { location: { directory: dir }, sessions: [{ id: "root", location: { directory: dir } }] },
  );
  const run = async (name, input) => {
    // The hook replaces the call's result on the input itself: the same object is handed on.
    Object.assign(input, { sessionID: "root", agent: "build", messageID: "m" });
    for (const cb of rec.hooks[`tool.${name}`] ?? []) await cb(input);
  };
  return { rec, run };
}
export const memory = join(SANDBOX, ".claude", "projects", "-x", "memory", "f.md");

/** A completed shell call carrying its output, as the OpenCode tool hook hands it on. */
export const shellCall = (id, command, content) => ({
  tool: "shell",
  id,
  status: "completed",
  input: { command },
  result: { content, metadata: { exit: 0 } },
});
