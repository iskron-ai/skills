// The delivery's session rituals (graph @nks/nks-dev, node #9319, section RITUALS): the hooks of
// the Claude Code plugin (hooks/hooks.json → hooks/rituals.mjs) and the rituals module of the
// OpenCode plugin speak by the cover of the session's repository — the start word, the push and
// merge words by outcome, in OpenCode the memory guard — and keep silent on a kind the repository
// holds itself. Temporary repositories only; no network, no model (rites-kit.mjs, which also
// names the variables that point the probe at a past release).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  bash,
  COVER,
  memory,
  opencode,
  PUSHED,
  repo,
  ritesOf,
  shellCall,
  start,
} from "./rites-kit.mjs";

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

// Case №2720 [6]: in homelab a push to main is the release, and the push word called it no shipping.
test("claude code: a push to the trunk says the merge word (#8362), a branch's push the push word", () => {
  const dir = repo();
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  const toMain = "To github.com:o/r.git\n   a1b2c3d..e4f5a6b  main -> main";
  for (const [command, out] of [
    ["git push origin main", toMain],
    ["git push origin main", ""],
    ["git push", ""],
    ["git push -u origin HEAD", ""],
    ["git push origin HEAD:refs/heads/master", ""],
    ["git push origin feat/x:main", ""],
  ]) {
    const said = bash(dir, command, out)?.additionalContext ?? "";
    assert.match(said, /мерж — .*контур #12/, `${command} | ${out}`);
    assert.doesNotMatch(said, /пуш — не отгрузка/, `${command} | ${out}`);
  }
  for (const command of ["git push origin feat/x", "git push origin main:feat/x"]) {
    const said = bash(dir, command, "")?.additionalContext ?? "";
    assert.match(said, /пуш — не отгрузка/, command);
    assert.doesNotMatch(said, /мерж —/, command);
  }
  const branch = bash(dir, "git push", PUSHED)?.additionalContext ?? "";
  assert.match(branch, /пуш — не отгрузка/, "git's report names the branch it went to");
});

// Review of case №2730: a quiet push prints no report; git's state says it landed on the trunk.
/** A repository on main whose HEAD equals its push ref — a quiet push there has landed. */
function onTrunk() {
  const dir = repo();
  const origin = mkdtempSync(join(tmpdir(), "rites-origin-"));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  g("init", "-q", "-b", "main");
  g("-c", "user.email=p@x", "-c", "user.name=p", "commit", "-q", "--allow-empty", "-m", "a");
  g("remote", "add", "origin", origin);
  g("push", "-q", "-u", "origin", "main");
  return dir;
}

test("claude code: a quiet push to the trunk says the merge word (#8362)", () => {
  const said =
    bash(onTrunk(), "git push -q origin main 2>&1 | tail -1", "")?.additionalContext ?? "";
  assert.match(said, /мерж — .*контур #12/);
  assert.doesNotMatch(said, /пуш — не отгрузка/);
});

// Case №2777 [6]: a quiet push with a known non-zero exit was refused — equal refs do not outvote it.
test("claude code: a quiet push that exited non-zero says nothing (#6919)", () => {
  const dir = onTrunk();
  for (const cmd of ["git push -q origin main", "git push -q origin feat/x"])
    assert.equal(bash(dir, cmd, "", 1), null, cmd);
  assert.match(bash(dir, "git push -q origin main | tail", "", 1)?.additionalContext ?? "", /мерж —/);
});

// The session's folder sits on main while the push ran from another work tree: a quiet push names no
// target and prints none, so the folder's branch says nothing about where it went — a branch's word.
test("claude code: a quiet push naming no trunk from a folder on main is no trunk push (#8362)", () => {
  for (const cmd of ["git push -q", "git push -q 2>&1 | tail -1"]) {
    const said = bash(onTrunk(), cmd, "")?.additionalContext ?? "";
    assert.doesNotMatch(said, /мерж —/, cmd);
  }
});

// #9351: in nks-mcp the words named template sections its AGENTS.md does not have.
const HEADED = `${COVER}\n## Правила персистентности\n\n## Самопроверка этапа\n\n## Мерж → граф\n`;
const FENCED = `${COVER}\n\`\`\`md\n## Самопроверка этапа\n## Мерж → граф\n\`\`\`\n`;

test("claude code: the words cite the repository's own sections, none it lacks (#9351)", () => {
  const headed = repo({ agents: HEADED });
  const push = bash(headed, "git push origin HEAD", PUSHED).additionalContext;
  assert.match(push, /\(AGENTS\.md, «Самопроверка этапа» и раздел о ревью\)/);
  const merge = bash(headed, "gh pr merge 12 --squash").additionalContext;
  assert.match(merge, /акты после мержа AGENTS\.md \(«Мерж → граф»\):/);
  for (const bare of [repo(), repo({ agents: FENCED })]) {
    assert.match(
      bash(bare, "git push origin HEAD", PUSHED).additionalContext,
      /PR; ревью — раз на готовую пачку \(AGENTS\.md\)\./,
    );
    const m = bash(bare, "gh pr merge 12 --squash").additionalContext;
    assert.match(m, /акты после мержа AGENTS\.md: протки/);
    assert.doesNotMatch(m, /«/);
  }
});

// Case №2720 [9]: homelab's AGENTS.md heads its after-push acts «Пуш в main → граф», no merge section.
const TRUNKED = `${COVER}\n## Жизненный цикл сессии\n\n## Пуш в main → граф\n`;

test("a push to the trunk cites the trunk push section, the merge sections otherwise (#9351)", async () => {
  const dir = repo({ agents: TRUNKED });
  const trunk = bash(dir, "git push origin main", "")?.additionalContext ?? "";
  assert.match(trunk, /акты после мержа AGENTS\.md \(«Пуш в main → граф»\):/);
  const merge = bash(dir, "gh pr merge 3")?.additionalContext ?? "";
  assert.match(merge, /AGENTS\.md \(«Жизненный цикл сессии»\):/, "a merge keeps the merge's");
  const headed = bash(repo({ agents: HEADED }), "git push origin main", "")?.additionalContext;
  assert.match(headed ?? "", /AGENTS\.md \(«Мерж → граф»\):/, "no trunk section: the merge's");
  const { rec, run } = await opencode(repo({ agents: TRUNKED }));
  try {
    const p = shellCall("t1-trunked", "git push origin main", "");
    await run("execute.after", p);
    assert.match(String(p.result.content), /AGENTS\.md \(«Пуш в main → граф»\):/);
  } finally {
    await rec.stop();
  }
});

test("opencode: the words and the guard cite the repository's own sections, none it lacks (#9351)", async () => {
  for (const [agents, push, merge, guard] of [
    [
      HEADED,
      /«Самопроверка этапа»/,
      /AGENTS\.md \(«Мерж → граф»\):/,
      /\(AGENTS\.md, «Правила персистентности»\)/,
    ],
    [COVER, /пачку \(AGENTS\.md\)\./, /AGENTS\.md: протки/, /по директории \(AGENTS\.md\)\./],
  ]) {
    const { rec, run } = await opencode(repo({ agents }));
    const id = (n) => `s${n}-${agents.length}`; // a call id is told once per process
    try {
      const p = shellCall(id(1), "git push origin HEAD", PUSHED);
      await run("execute.after", p);
      assert.match(String(p.result.content), push);
      const m = shellCall(id(2), "gh pr merge 5 --squash", "");
      await run("execute.after", m);
      assert.match(String(m.result.content), merge);
      await assert.rejects(
        run("execute.before", { tool: "write", id: id(3), input: { path: memory } }),
        guard,
      );
    } finally {
      await rec.stop();
    }
  }
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
    const trunk = shellCall("c4", "git push origin main", "");
    await run("execute.after", trunk);
    assert.match(String(trunk.result.content), /мерж — .*#12/, "a push to the trunk (#8362)");
    assert.doesNotMatch(String(trunk.result.content), /пуш — не отгрузка/);
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
