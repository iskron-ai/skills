// The delivery's rituals by what the cover file holds (graph @nks/nks-dev, nodes #9319, #8018):
// a cover naming only the graph — the first-graph step of the onboarding — gets the early start
// word that sends the next start on along the onboarding; the words speak the language of the
// file's body (its lifecycle section), not the server's; the merge word asks for feedback
// reflection only where AGENTS.md calls for it. Both harnesses (rites-kit.mjs).
import assert from "node:assert/strict";
import { test } from "node:test";

import { bash, COVER, memory, opencode, PUSHED, repo, shellCall, start } from "./rites-kit.mjs";

const EARLY = "---\niskron:\n  graph: r7\n---\n# x\n";
const EN = `${COVER}\n## Session lifecycle\n- rules\n`;
const RU = `${COVER}\n## Жизненный цикл сессии\n- правила\n`;

test("claude code: a cover with only the graph — the early word, on to the onboarding", () => {
  const said = start(repo({ agents: EARLY }))?.additionalContext ?? "";
  assert.match(said, /r7/);
  assert.match(said, /«Первый граф» скилла iskronify/);
  assert.doesNotMatch(said, /iskron_stand/, "not the full start word");
  assert.equal(start(repo({ agents: EARLY }), "compact"), null);
  const own = {
    hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo iskron" }] }] },
  };
  assert.equal(start(repo({ agents: EARLY, settings: own })), null, "an own start hook holds it");
});

test("opencode: a cover with only the graph — the early word on the root's first prompt", async () => {
  const { rec } = await opencode(repo({ agents: EARLY }));
  try {
    const first = await rec.prompt("root", "hello");
    assert.match(first, /r7/);
    assert.match(first, /«Первый граф» скилла iskronify/);
  } finally {
    await rec.stop();
  }
});

test("claude code: an English AGENTS.md on a Russian server hears English words", () => {
  const dir = repo({ agents: EN });
  assert.match(start(dir)?.additionalContext ?? "", /^Read the Start section/);
  assert.match(bash(dir, "git push origin HEAD", PUSHED)?.additionalContext ?? "", /push ships/);
  assert.match(bash(dir, "gh pr merge 3")?.additionalContext ?? "", /«Session lifecycle»/);
  assert.match(start(repo({ agents: RU }))?.additionalContext ?? "", /^Прочти раздел/);
});

test("opencode: an English AGENTS.md on a Russian server hears English words", async () => {
  const { rec, run } = await opencode(repo({ agents: EN }));
  try {
    assert.match(await rec.prompt("root", "hello"), /Read the Start section/);
    await assert.rejects(
      run("execute.before", { tool: "write", id: "e1", input: { path: memory } }),
      /BLOCKED: local agent memory/,
    );
    const m = shellCall("e2", "gh pr merge 5 --squash", "");
    await run("execute.after", m);
    // The file's own lifecycle heading, not the template's merge one it lacks (#9351).
    assert.match(String(m.result.content), /AGENTS\.md \(«Session lifecycle»\):/);
  } finally {
    await rec.stop();
  }
});

test("the merge word asks for feedback reflection only where AGENTS.md calls for it", async () => {
  const said = bash(repo(), "gh pr merge 3")?.additionalContext ?? "";
  assert.match(said, /фидбэк-рефлексия — если её велит AGENTS\.md/);
  const { rec, run } = await opencode(repo({ agents: EN }));
  try {
    const m = shellCall("f1", "gh pr merge 6 --squash", "");
    await run("execute.after", m);
    assert.match(String(m.result.content), /feedback reflection — if AGENTS\.md calls for it/);
  } finally {
    await rec.stop();
  }
});
