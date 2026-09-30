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
// confirmation does. The iskronify template (references/hooks.md, the copy
// that ships to other repos) must carry the very filters this repo runs, so
// the projection cannot drift from its source.
//
// ISKRON_HOOKS_SETTINGS / ISKRON_HOOKS_SURFACES point the probe at any copy (a
// past revision) so it can be shown red before a fix.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settingsPath = process.env.ISKRON_HOOKS_SETTINGS ?? join(root, ".claude", "settings.json");
const surfacesPath =
  process.env.ISKRON_HOOKS_SURFACES ??
  join(root, "skills", "iskronify", "references", "harness-surfaces.md");
const templatePath = join(root, "skills", "iskronify", "references", "hooks.md");

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
  // a quiet push prints no `To <remote>`: -q/--quiet wakes it before a pipe or `;`
  ["git push -q origin feat/x 2>&1 | tail -3", "", true, false],
  ["git push --quiet | tail", "", true, false],
  ["git push -q; echo done", "done", true, false],
  ["git push -q origin feat/x 2>&1 | tail -3", " ! [rejected] a -> a (fetch first)", false, false],
  ["git push -q 2>&1 | tail", "error: failed to push some refs", false, false],
  ["git push -q -h | tail", "usage: git push", false, false],
  ["echo git push -q | tail", "", false, false],
  ['grep "git push" AGENTS.md', "git push", false, false],
  // a rejected ref is not an updated one — only an updated ref line wakes
  [
    "git push 2>&1 | tail -3",
    "To github.com:o/r.git\n ! [rejected]        feat/x -> feat/x (non-fast-forward)\nerror: failed to push some refs",
    false,
    false,
  ],
  [
    "git push 2>&1 | tail -3",
    "To github.com:o/r.git\n + 1234567...89abcde feat/x -> feat/x (forced update)",
    true,
    false,
  ],
  [
    "git push origin a b 2>&1 | tail -3",
    "To github.com:o/r.git\n ! [rejected]        a -> a (fetch first)\n   1234567..89abcde  b -> b",
    true,
    false,
  ],
  // the trunk is a name with a boundary, not a prefix
  ["git checkout main-foo && git pull", "", false, false],
  ["git switch master-fix && git pull", "", false, false],
  ["git checkout main -q && git pull", "", false, true],
  // the trunk pull is a command, not a mention, and `;` chains it as `&&` does
  ['echo "git checkout main && git pull"', "", false, false],
  ['echo "git checkout main && git pull --ff-only"', "", false, false],
  ["echo git checkout main && git pull", "", false, false],
  ["echo 'git checkout main; git pull'", "", false, false],
  ["git checkout main; git pull", "", false, true],
  ["git checkout main -q; git pull", "", false, true],
  ["git checkout main-foo; git pull", "", false, false],
  // commands may stand between; a newline chains as `;` does; env may lead
  ["git checkout main && git fetch origin && git pull", "", false, true],
  ["git checkout main\ngit pull", "", false, true],
  ["GIT_TERMINAL_PROMPT=0 git checkout main && git pull", "", false, true],
  ["git checkout main && echo git pull", "", false, false],
  [`git checkout main${" ".repeat(5000)}`, "", false, false],
  // a help flag is looked for outside quotes: inside them it is text
  ['gh pr merge 12 --squash --subject "fix -h parsing"', "", false, true],
  [
    "gh pr merge 12 --squash -t 'drop --auto flag' | tail -1",
    "✓ Merged pull request o/r#12 (t)",
    false,
    true,
  ],
  // …and outside them it is still seen, after a quoted argument too
  ['gh pr merge 12 --squash --subject "x" --help', "Usage: gh pr merge", false, false],
  ['gh pr merge 5 -b "x" --auto', "", false, false],
  ['git push -o "x" -h', "usage: git push", false, false],
  ["git push -o 'note -h here' origin feat/x", "", true, false],
  ['gh pr merge 12 --squash -t "a && b" | tail -1', "", false, false],
  // an escaped quote outside quotes opens no string
  ["gh pr merge 12 --squash -t don\\'t", "", false, true],
  ['gh pr merge 12 --squash -t say\\"hi', "", false, true],
  ["gh pr merge 12 --squash -t don\\'t --help", "Usage: gh pr merge", false, false],
  // a remote with a space in its path still confirms
  [
    "git push /tmp/my\\ repo x 2>&1 | tail -3",
    "To /tmp/my repo\n * [new branch]      x -> x",
    true,
    false,
  ],
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

// `|| true` hides a jq that failed to run: a regex that overruns the match
// retry limit is silence forever, not a verdict — the exit status is judged.
test("claude hooks: jq judges a long run of spaces without an error", () => {
  const payload = JSON.stringify({
    tool_input: { command: `git checkout main${" ".repeat(5000)}` },
    tool_response: { stdout: "", stderr: "" },
  });
  for (const h of bashHooks) {
    const filter = /^jq -e '([^']+)'/.exec(h.command)?.[1];
    if (!filter) continue;
    const r = spawnSync("jq", ["-e", filter], { input: payload, encoding: "utf8" });
    assert.equal(r.stderr, "", filter.slice(-60));
    assert.equal(r.status, 1, filter.slice(-60));
  }
});

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

// A trunk pull that failed brought nothing in: the exit status speaks for it,
// so a refused pull does not wake the merge ritual.
test("opencode rituals template: a failed trunk pull does not wake", async () => {
  const after = await loadPlugin();
  for (const [exit, merge] of [
    [1, false],
    [0, true],
  ]) {
    const input = {
      tool: "bash",
      status: "completed",
      input: { command: "git checkout main && git pull" },
      result: { content: "fatal: unable to access 'https://github.com/o/r/'", metadata: { exit } },
    };
    after(input);
    assert.equal(String(input.result.content).includes("мерж"), merge, `exit ${exit}`);
  }
});

// Another forge's merge rides the same defs with its own head and confirmation
// (hooks.md names fj): the defs are taken from the template itself, so the copy
// that ships to other repos is judged, not this repo's projection.
test("iskronify template defs judge another forge's merge by outcome", () => {
  const skill = readFileSync(templatePath, "utf8");
  const push = skill.split("\n").find((l) => l.startsWith("def a:") && l.includes(' push"'));
  assert.ok(push, "push filter line present in hooks.md");
  const defs = push.slice(0, push.lastIndexOf("; ran(") + 2);
  const filter = defs + 'ran("fj pr merge"; "-h|--help"; "Merged PR #")';
  const fj = [
    ['fj pr merge 12 -m "fix -h parsing"', "", true],
    ["fj pr merge 12 --method squash", "", true],
    ["fj pr merge 1 | tail", "Merged PR #1", true],
    ["fj pr merge 1 | tail", "", false],
    ["fj pr merge --help", "", false],
    ['fj pr merge 12 -m "x" -h', "", false],
    ['fj pr merge 12 -m "x" --help', "", false],
  ];
  for (const [command, output, wakes] of fj) {
    const payload = JSON.stringify({ tool_input: { command }, tool_response: { stdout: output } });
    let ran = true;
    try {
      execFileSync("jq", ["-e", filter], { input: payload, stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      ran = false;
    }
    assert.equal(ran, wakes, command);
  }
});

test(
  "iskronify template carries the filters this repo runs",
  { skip: !!process.env.ISKRON_HOOKS_SETTINGS },
  () => {
    const skill = readFileSync(templatePath, "utf8");
    for (const h of bashHooks) {
      const filter = /^jq -e '([^']+)'/.exec(h.command)?.[1];
      assert.ok(filter, `hook runs a jq -e filter: ${h.command.slice(0, 60)}`);
      assert.ok(skill.includes(filter), `hooks.md carries the filter: ${filter.slice(0, 60)}…`);
    }
  },
);
