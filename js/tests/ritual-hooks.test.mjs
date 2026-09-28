// Probe for the push and merge ritual hooks — the one-line reminders that wake
// an agent after `git push` (the push shipped nothing: self-review, cold review)
// and after a merge (the four acts of AGENTS.md). Two carriers are judged:
//
//   • this repo's own .claude/settings.json — the PostToolUse/Bash commands are
//     run as they are, by bash, with a hook payload on stdin;
//   • the OpenCode rituals plugin template in
//     skills/iskronify/references/harness-surfaces.md — its js block is loaded
//     as a module and its execute.after hook is called with a stand-in ctx.
//
// The rule both keep: a hook wakes on the OUTCOME, not on the command's form.
// Help (`-h`, `--help`) and `--auto` never wake; the exit status speaks for the
// command only when it is last in the chain or stands before `&&` (a pipe or
// `;` after it hands the status to someone else) — otherwise only a printed
// confirmation does. The iskronify template (SKILL.md) must carry the very
// filters this repo runs, so the projection cannot drift from its source.
//
// ISKRON_HOOKS_SETTINGS / ISKRON_HOOKS_SURFACES point the probe at any copy (a
// past revision) so it can be shown red before a fix.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settingsPath = process.env.ISKRON_HOOKS_SETTINGS ?? join(root, ".claude", "settings.json");
const surfacesPath =
  process.env.ISKRON_HOOKS_SURFACES ??
  join(root, "skills", "iskronify", "references", "harness-surfaces.md");

// [command, output, wakes push?, wakes merge?]
const cases = [
  // the defect: help exits 0 and used to wake the merge ritual
  ["git status; gh pr merge --help | head -25; git log -1", "Usage: gh pr merge", false, false],
  ["gh pr merge -h", "Usage: gh pr merge", false, false],
  ["gh pr merge 12 --auto --squash", "", false, false],
  // gh prints nothing on success off a TTY: the exit status is the outcome
  ["gh pr merge 12 --squash --delete-branch", "", false, true],
  ["gh pr merge 12 --squash 2>&1 && git checkout main && git pull", "", false, true],
  // a pipe takes the status away — only a printed confirmation speaks then
  ["gh pr merge 12 --squash | tail -3", "", false, false],
  [
    "gh pr merge 12 --squash 2>&1 | tail -3",
    "✓ Squashed and merged pull request o/r#12 (t)",
    false,
    true,
  ],
  ["gh pr merge 12 --squash\necho done", "done", false, false],
  ["git checkout main && git pull", "", false, true],
  ["echo gh pr merge", "gh pr merge", false, false],
  // push: the same rule
  ["git add -A && git commit -m x && git push -u origin feat/x", "", true, false],
  ["git -C /tmp/r push", "", true, false],
  ["git push --help | head", "GIT-PUSH(1)", false, false],
  ["git push -h", "usage: git push", false, false],
  [
    "git push 2>&1 | tail -3",
    "To github.com:o/r.git\n   1234567..89abcde  feat/x -> feat/x",
    true,
    false,
  ],
  ["git push | tail -3", "", false, false],
  ['grep "git push" AGENTS.md', "git push", false, false],
];

const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const bashHooks = settings.hooks.PostToolUse.filter((g) => g.matcher === "Bash").flatMap(
  (g) => g.hooks,
);

function claudeWakes(command, output) {
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout: output, stderr: "", exit_code: 0 },
  });
  const said = bashHooks.map((h) =>
    execFileSync("bash", ["-c", h.command], { input: payload, encoding: "utf8" }),
  );
  const joined = said.join("");
  return { push: joined.includes("Пуш"), merge: joined.includes("Мерж") };
}

for (const [command, output, push, merge] of cases) {
  test(`claude hooks: ${command}`, () => {
    assert.deepEqual(claudeWakes(command, output), { push, merge });
  });
}

async function loadPlugin() {
  const md = readFileSync(surfacesPath, "utf8");
  const block = [...md.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .find((b) => b.includes("iskron-rituals"));
  assert.ok(block, "rituals plugin block present in harness-surfaces.md");
  const mod = await import(`data:text/javascript,${encodeURIComponent(block)}`);
  const hooks = {};
  await mod.default.setup({
    tool: { hook: async (name, fn) => void (hooks[name] = fn) },
    event: { subscribe: async () => (async function* () {})() },
    session: { prompt: async () => {} },
  });
  return hooks["execute.after"];
}

test("opencode rituals template: wakes by outcome", async () => {
  const after = await loadPlugin();
  for (const [command, output, push, merge] of cases) {
    const input = {
      tool: "bash",
      status: "completed",
      input: { command },
      result: { content: output, metadata: { exit: 0 } },
    };
    after(input);
    const text = String(input.result.content);
    assert.deepEqual(
      { push: text.includes("пуш"), merge: text.includes("мерж") },
      { push, merge },
      command,
    );
  }
});

test(
  "iskronify template carries the filters this repo runs",
  { skip: !!process.env.ISKRON_HOOKS_SETTINGS },
  () => {
    const skill = readFileSync(join(root, "skills", "iskronify", "SKILL.md"), "utf8");
    for (const h of bashHooks) {
      const filter = /^jq -e '([^']+)'/.exec(h.command)?.[1];
      assert.ok(filter, `hook runs a jq -e filter: ${h.command.slice(0, 60)}`);
      assert.ok(skill.includes(filter), `SKILL.md carries the filter: ${filter.slice(0, 60)}…`);
    }
  },
);
