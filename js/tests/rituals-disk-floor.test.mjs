// The Claude Code plugin denies heavy work on a nearly full volume (graph @nks/nks-dev, node
// #11288): its PreToolUse hook on Task, Agent and Bash (hooks/hooks.json → hooks/rituals.mjs)
// answers deny with the word naming the cleanup for a subagent and a build command, cover or not;
// cleanup and other commands are allowed. The floor is moved by its variable — above the real
// free space denies, 0 allows; the real disk is never filled. ISKRON_RITUALS_HOOK points the
// probe at a past release (rites-kit.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";

import { claudeRaw, repo, ritesOf } from "./rites-kit.mjs";

const VAR = "ISKRON_DISK_FLOOR_PCT";
const WORD =
  /на томе \S+ свободно [\d.]+ ГБ из \d+ \([\d.]+%\) — ниже пола 100%: .*Сначала убери своё: target\/ и node_modules своих слитых деревьев, git worktree remove слитых; чужое не трогай\. Затем повтори\./;

const pre = (dir, tool_name, tool_input) =>
  claudeRaw(dir, { hook_event_name: "PreToolUse", tool_name, tool_input })?.hookSpecificOutput ??
  null;

test("hooks.json: the rituals entry before Task, Agent and Bash", () => {
  assert.deepEqual(
    ritesOf("PreToolUse").map((e) => e.matcher),
    ["Task|Agent|Bash"],
  );
});

test("claude code: below the floor a subagent and a build are denied with the word, cover or not", (t) => {
  process.env[VAR] = "100";
  t.after(() => delete process.env[VAR]);
  for (const dir of [repo(), repo({ agents: null })]) {
    for (const [tool, input, move] of [
      ["Task", { prompt: "x" }, /субагент не запущен/],
      ["Agent", { prompt: "x" }, /субагент не запущен/],
      ["Bash", { command: "cargo test -p x" }, /сборка «cargo test -p x» не запущена/],
      ["Bash", { command: "git status && make check" }, /сборка «make check» не запущена/],
    ]) {
      const said = pre(dir, tool, input);
      assert.equal(said?.hookEventName, "PreToolUse", `${tool} ${JSON.stringify(input)}`);
      assert.equal(said.permissionDecision, "deny");
      assert.match(said.permissionDecisionReason, WORD);
      assert.match(said.permissionDecisionReason, move);
    }
    for (const command of [
      "cargo clean",
      "rm -rf node_modules",
      "git worktree remove .worktrees/x",
      "du -sh target",
      "df -h .",
      "ls",
    ])
      assert.equal(pre(dir, "Bash", { command }), null, command);
  }
});

test("claude code: with the floor at 0 nothing is denied", (t) => {
  process.env[VAR] = "0";
  t.after(() => delete process.env[VAR]);
  const dir = repo();
  assert.equal(pre(dir, "Task", { prompt: "x" }), null);
  assert.equal(pre(dir, "Bash", { command: "cargo build" }), null);
});

// The hook stands before every Bash: a call it lets pass prints nothing at all — neither a
// decision nor a word — and leaves at once, above the floor and below it alike.
test("claude code: a Bash it lets pass prints nothing and leaves fast", (t) => {
  t.after(() => delete process.env[VAR]);
  const dir = repo();
  const calls = [
    ["0", "cargo build"],
    ["0", "git status"],
    ["100", "git status"],
    ["100", "ls -la && du -sh ."],
  ];
  for (const [floor, command] of calls) {
    process.env[VAR] = floor;
    const at = Date.now();
    const raw = claudeRaw(dir, {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command },
    });
    const ms = Date.now() - at;
    assert.equal(raw, null, `floor ${floor}, ${command}: ${JSON.stringify(raw)}`);
    assert.ok(ms < 3000, `floor ${floor}, ${command}: ${ms} ms`);
  }
});
