// The OpenCode plugin refuses heavy work on a nearly full volume (graph @nks/nks-dev, node
// #11288): a subagent (subagent, task) and a shell build command throw the word naming the cleanup before
// they run; cleanup and other commands pass. The floor is moved by its variable — above the real
// free space refuses, 0 lets everything pass; the real disk is never filled. The plugin is the
// built copy (opencode-kit.mjs; ISKRON_OPENCODE_PLUGIN points it at a past release).
import assert from "node:assert/strict";
import { test } from "node:test";

import { opencode, repo } from "./rites-kit.mjs";

const VAR = "ISKRON_DISK_FLOOR_PCT";
const WORD =
  /на томе \S+ свободно [\d.]+ ГБ из \d+ \([\d.]+%\) — ниже пола 100%: .*Сначала убери своё: target\/ и node_modules своих слитых деревьев, git worktree remove слитых; чужое не трогай\. Затем повтори\./;

const call = (tool, input) => ({ tool, id: `c-${tool}-${Math.random()}`, input });

async function refusal(run, tool, input) {
  try {
    await run("execute.before", call(tool, input));
    return null;
  } catch (e) {
    return e.message;
  }
}

test("opencode: below the floor a subagent and a build are refused, cleanup and the rest are not", async (t) => {
  process.env[VAR] = "100";
  process.env.ISKRON_BRIDGE_LANG = "ru";
  t.after(() => delete process.env[VAR]);
  const { rec, run } = await opencode(repo());
  t.after(() => rec.stop());
  // OpenCode 2's subagent tool is `subagent` (its tool renderer on this machine); `task` before.
  for (const tool of ["subagent", "task"]) {
    const said = await refusal(run, tool, { description: "x", prompt: "y" });
    assert.match(said ?? "", WORD, `${tool}: ${said}`);
    assert.match(said, /субагент не запущен/);
  }
  const build = await refusal(run, "shell", { command: "cd js && cargo build --release" });
  assert.match(build ?? "", WORD, String(build));
  assert.match(build, /сборка «cargo build --release» не запущена/);
  for (const command of [
    "make test",
    "npm ci",
    "pnpm run build",
    "go test ./...",
    "docker build .",
    "RUSTFLAGS=-Dwarnings env CI=1 cargo clippy",
    "npm --prefix js ci",
  ])
    assert.match((await refusal(run, "shell", { command })) ?? "", WORD, command);
  for (const command of [
    "cargo clean",
    "ls -la",
    "rm -rf target",
    "git worktree remove .worktrees/x",
    "du -sh .",
    "df -h",
    "make clean",
    "npm view x",
  ])
    assert.equal(await refusal(run, "shell", { command }), null, command);
  assert.equal(await refusal(run, "read", { path: "x" }), null);
});

test("opencode: with the floor at 0 nothing is refused", async (t) => {
  process.env[VAR] = "0";
  t.after(() => delete process.env[VAR]);
  const { rec, run } = await opencode(repo());
  t.after(() => rec.stop());
  for (const tool of ["subagent", "task"])
    assert.equal(await refusal(run, tool, { prompt: "y" }), null, tool);
  assert.equal(await refusal(run, "shell", { command: "cargo build" }), null);
});
