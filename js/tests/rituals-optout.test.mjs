// The delivery's rituals switched by the cover (graph @nks/nks-dev, node #9341; the field — #9316):
// the rituals: field of the iskron: block lists the rituals switched on; no field — every one,
// empty — none. A ritual left out keeps silent in Claude Code and OpenCode, those listed speak.
// Temporary repositories only (rites-kit.mjs names the variables pointing the probe at a past
// release).
import assert from "node:assert/strict";
import { test } from "node:test";

import { bash, COVER, memory, opencode, PUSHED, repo, shellCall, start } from "./rites-kit.mjs";

const switched = (rituals) => COVER.replace("  stamp:", `  rituals:${rituals}\n  stamp:`);

test("claude code: only the rituals the field lists speak", () => {
  const off = repo({ agents: switched(" merge") });
  assert.equal(start(off), null, "start left out");
  assert.equal(bash(off, "git push origin HEAD", PUSHED), null, "push left out");
  assert.match(bash(off, "gh pr merge 12 --squash")?.additionalContext ?? "", /мерж/);
  const on = repo({ agents: switched(" start push") });
  assert.ok(start(on)?.additionalContext.includes("#34"));
  assert.match(bash(on, "git push origin HEAD", PUSHED)?.additionalContext ?? "", /пуш/);
  assert.equal(bash(on, "gh pr merge 12 --squash"), null, "merge left out");
});

test("claude code: an empty field keeps every ritual silent", () => {
  const none = repo({ agents: switched("") });
  assert.equal(start(none), null);
  assert.equal(bash(none, "git push origin HEAD", PUSHED), null);
  assert.equal(bash(none, "gh pr merge 12 --squash"), null);
});

test("opencode: a start and a guard left out keep silent, push and merge listed speak", async () => {
  const { rec, run } = await opencode(repo({ agents: switched(" push merge") }));
  try {
    assert.ok(!(await rec.prompt("root", "hello")).includes("#34"), "start left out");
    await run("execute.before", { tool: "write", id: "o1", input: { path: memory } });
    const p = shellCall("o2", "git push origin HEAD", PUSHED);
    await run("execute.after", p);
    assert.match(String(p.result.content), /пуш — не отгрузка/);
    const m = shellCall("o3", "gh pr merge 5 --squash", "");
    await run("execute.after", m);
    assert.match(String(m.result.content), /мерж/);
  } finally {
    await rec.stop();
  }
});

test("opencode: start and guard listed speak, push and merge left out keep silent", async () => {
  const { rec, run } = await opencode(repo({ agents: switched(" start guard turn") }));
  try {
    assert.ok((await rec.prompt("root", "hello")).includes("#34"));
    await assert.rejects(
      run("execute.before", { tool: "write", id: "o4", input: { path: memory } }),
      /BLOCKED/,
    );
    const p = shellCall("o5", "git push origin HEAD", PUSHED);
    await run("execute.after", p);
    assert.equal(p.result.content, PUSHED);
    const m = shellCall("o6", "gh pr merge 5 --squash", "");
    await run("execute.after", m);
    assert.equal(m.result.content, "");
  } finally {
    await rec.stop();
  }
});
