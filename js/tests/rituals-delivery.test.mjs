// The delivery's session rituals (graph @nks/nks-dev, node #9319, section RITUALS): the hooks of
// the Claude Code plugin (hooks/hooks.json → hooks/rituals.mjs) and the rituals module of the
// OpenCode plugin speak by the cover of the session's repository — the start word, the push and
// merge words by outcome, in OpenCode the memory guard — and keep silent on a kind the repository
// holds itself. Temporary repositories only; no network, no model (rites-kit.mjs, which also
// names the variables that point the probe at a past release).
import assert from "node:assert/strict";
import { test } from "node:test";

import { bash, memory, opencode, PUSHED, repo, ritesOf, shellCall, start } from "./rites-kit.mjs";

test("hooks.json: the rituals entry on start (not compact) and after Bash", () => {
  assert.deepEqual(
    ritesOf("SessionStart").map((e) => e.matcher),
    ["startup|resume|clear"],
  );
  assert.deepEqual(
    ritesOf("PostToolUse").map((e) => e.matcher),
    ["Bash"],
  );
});

test("claude code: the start word by the cover, once per start, none after a compaction", () => {
  const dir = repo();
  const said = start(dir);
  assert.equal(said?.hookEventName, "SessionStart");
  for (const s of ["r7", "#12", "#34", "iskron_stand"])
    assert.ok(said.additionalContext.includes(s), s);
  assert.equal(start(dir, "compact"), null);
  assert.equal(start(repo({ agents: "# no cover\n" })), null);
});

test("claude code: push and merge by outcome, the holon in the merge word", () => {
  const dir = repo();
  const push = bash(dir, "git push origin HEAD", PUSHED);
  assert.match(push.additionalContext, /пуш — не отгрузка/);
  assert.doesNotMatch(push.additionalContext, /мерж —/);
  const merge = bash(dir, "gh pr merge 12 --squash");
  assert.match(merge.additionalContext, /мерж — .*контур #12/);
  assert.equal(bash(dir, "gh pr merge --help", "Usage: gh pr merge"), null);
  assert.equal(bash(repo({ agents: "# x\n" }), "git push origin HEAD", PUSHED), null);
});

test("claude code: a kind the repository holds itself keeps the delivery silent", () => {
  const own = (event, command, matcher) => ({
    hooks: {
      [event]: [{ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command }] }],
    },
  });
  const started = repo({ settings: own("SessionStart", "echo 'read the iskron door Start'") });
  assert.equal(start(started), null);
  const pushHook = "jq -e 'git(?: -C [^ ]+)* push' >/dev/null && echo x || true";
  const pushing = repo({ settings: own("PostToolUse", pushHook, "Bash") });
  assert.equal(bash(pushing, "git push origin HEAD", PUSHED), null);
  assert.ok(start(pushing), "the start word stays: only the held kind is silent");
  assert.match(bash(pushing, "gh pr merge 3").additionalContext, /мерж/);
  const resumed = repo({ settings: own("SessionStart", "echo iskron", "resume") });
  assert.equal(start(resumed, "resume"), null, "held on the source its matcher names");
  assert.ok(start(resumed), "and only there");
});

test("claude code: an own hook on another matcher does not silence the delivery", () => {
  const own = (event, command, matcher) => ({
    hooks: { [event]: [{ matcher, hooks: [{ type: "command", command }] }] },
  });
  assert.ok(start(repo({ settings: own("SessionStart", "echo iskron compact", "compact") })));
  const pushHook = "jq -e 'git(?: -C [^ ]+)* push' >/dev/null && echo x || true";
  const writing = repo({ settings: own("PostToolUse", pushHook, "Write") });
  assert.match(bash(writing, "git push origin HEAD", PUSHED)?.additionalContext ?? "", /пуш/);
  const merging = repo({ settings: own("PostToolUse", "echo 'gh pr merge'", "Edit|Write") });
  assert.match(bash(merging, "gh pr merge 3")?.additionalContext ?? "", /мерж/);
});

test("opencode: the start word on the root's first prompt, once", async () => {
  const { rec } = await opencode(repo());
  try {
    const first = await rec.prompt("root", "hello");
    for (const s of ["r7", "#12", "#34"]) assert.ok(first.includes(s), s);
    assert.ok(!(await rec.prompt("root", "again")).includes("#34"));
  } finally {
    await rec.stop();
  }
});

test("opencode: the memory guard refuses a write into local memory, names the graph", async () => {
  const { rec, run } = await opencode(repo());
  try {
    await assert.rejects(
      run("execute.before", { tool: "write", id: "w1", input: { path: memory } }),
      /BLOCKED.*граф r7/,
    );
    await run("execute.before", { tool: "write", id: "w2", input: { path: "src/x.ts" } });
  } finally {
    await rec.stop();
  }
});

test("opencode: push and merge words after a shell call, once per call id", async () => {
  const { rec, run } = await opencode(repo());
  try {
    const p = shellCall("c1", "git push origin HEAD", PUSHED);
    await run("execute.after", p);
    assert.match(String(p.result.content), /пуш — не отгрузка/);
    const m = shellCall("c2", "gh pr merge 5 --squash", "");
    await run("execute.after", m);
    assert.match(String(m.result.content), /мерж — .*#12/);
    const again = shellCall("c2", "gh pr merge 5 --squash", "");
    await run("execute.after", again);
    assert.equal(again.result.content, "", "the same call is told once");
  } finally {
    await rec.stop();
  }
});

test("opencode: a rituals plugin of the repository's own keeps the delivery silent", async () => {
  const { rec, run } = await opencode(repo({ rituals: true }));
  try {
    assert.ok(!(await rec.prompt("root", "hello")).includes("#34"));
    await run("execute.before", { tool: "write", id: "w3", input: { path: memory } });
    const p = {
      tool: "shell",
      id: "c3",
      status: "completed",
      input: { command: "git push origin HEAD" },
      result: { content: PUSHED },
    };
    await run("execute.after", p);
    assert.equal(p.result.content, PUSHED);
  } finally {
    await rec.stop();
  }
});

test("opencode: a plugin of other kinds left by the transition does not silence it", async () => {
  const { rec } = await opencode(repo({ rituals: "merge-gate.js" }));
  try {
    assert.ok((await rec.prompt("root", "hello")).includes("#34"));
  } finally {
    await rec.stop();
  }
});
