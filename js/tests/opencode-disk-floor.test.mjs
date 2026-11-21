// The OpenCode plugin refuses heavy work on a nearly full volume (graph @nks/nks-dev, node
// #11288): a subagent (subagent, task) and a shell build command throw the word naming the cleanup before
// they run; cleanup and other commands pass. The floor is moved by its variable — above the real
// free space refuses, 0 lets everything pass; the real disk is never filled. The plugin is the
// built copy (opencode-kit.mjs; ISKRON_OPENCODE_PLUGIN points it at a past release).
import assert from "node:assert/strict";
import { test } from "node:test";

import { PASSED, REFUSED } from "./buildcmd-cases.mjs";
import { fullVolume } from "./full-volume.mjs";
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
  // The table (buildcmd-cases.mjs): every line that misjudges is named at once.
  const wrong = [];
  for (const [command, named] of REFUSED) {
    const said = await refusal(run, "shell", { command });
    if (!WORD.test(said ?? "") || !said.includes(`сборка «${named}» не запущена`))
      wrong.push(`refused? ${command} → ${said}`);
  }
  for (const command of PASSED) {
    const said = await refusal(run, "shell", { command });
    if (said !== null) wrong.push(`passed? ${command} → ${said.slice(0, 120)}`);
  }
  assert.deepEqual(wrong, []);
  assert.equal(await refusal(run, "read", { path: "x" }), null);
});

// Off until the owner accepts it (#11288): without the variable a real volume below any floor
// (full-volume.mjs) refuses nothing.
test("opencode: without the variable a full volume refuses nothing", async (t) => {
  delete process.env[VAR];
  const dir = fullVolume();
  if (!dir) return t.skip("no real volume below 10% free on this machine");
  const { rec, run } = await opencode(dir);
  t.after(() => rec.stop());
  for (const tool of ["subagent", "task"])
    assert.equal(await refusal(run, tool, { prompt: "y" }), null, tool);
  assert.equal(await refusal(run, "shell", { command: "cargo build" }), null);
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
