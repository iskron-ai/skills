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
// ISKRON_HOOKS_SETTINGS / ISKRON_HOOKS_SURFACES / ISKRON_HOOKS_TEMPLATE point
// the probe at any copy (a past revision) so it can be shown red before a fix.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { ritualSample, standServer } from "./opencode-stand.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settingsPath = process.env.ISKRON_HOOKS_SETTINGS ?? join(root, ".claude", "settings.json");
const surfacesPath =
  process.env.ISKRON_HOOKS_SURFACES ??
  join(root, "skills", "iskronify", "references", "harness-surfaces.md");
const templatePath =
  process.env.ISKRON_HOOKS_TEMPLATE ?? join(root, "skills", "iskronify", "references", "hooks.md");

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
  // a push that moved only tags ships a release mark, not a branch to review
  [
    "git push origin iskron-0.21.1",
    "To github.com:o/r.git\n * [new tag]         iskron-0.21.1 -> iskron-0.21.1",
    false,
    false,
  ],
  [
    "git push origin iskron-0.21.1 2>&1 | tail -3",
    "To github.com:o/r.git\n * [new tag]         iskron-0.21.1 -> iskron-0.21.1",
    false,
    false,
  ],
  // a forced tag looks like a forced branch in push output (short names): it wakes, a known gap
  [
    "git push --force origin v1 2>&1 | tail -3",
    "To github.com:o/r.git\n + 61ff2af...930b18f v1 -> v1 (forced update)",
    true,
    false,
  ],
  [
    "git push origin :refs/tags/v1 2>&1 | tail -3",
    "To github.com:o/r.git\n - [deleted]         v1",
    true,
    false,
  ],
  // …but a branch riding along with the tag still wakes
  [
    "git push --follow-tags 2>&1 | tail -3",
    "To github.com:o/r.git\n   1234567..89abcde  feat/x -> feat/x\n * [new tag]         v2 -> v2",
    true,
    false,
  ],
  [
    "git push origin feat/y v2",
    "To github.com:o/r.git\n * [new tag]         v2 -> v2\n * [new branch]      feat/y -> feat/y",
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

// Memory-guard: every writing tool of Claude Code, its path where the tool keeps
// it — file_path, and notebook_path for NotebookEdit (Agent SDK NotebookEditInput).
// Judged in this repo's settings and in the hooks.md template that ships.
const guardOf = (groups, tool) =>
  groups
    .filter((g) =>
      (g.matcher ?? "")
        .split(/[|,]/)
        .map((s) => s.trim())
        .includes(tool),
    )
    .flatMap((g) => g.hooks);
const templateGuard = () => {
  const md = readFileSync(templatePath, "utf8");
  const block = md.split("## Memory-guard")[1].match(/```json\n([\s\S]*?)```/)[1];
  return [JSON.parse(block)];
};
const memory = join(homedir(), ".claude", "projects", "-x", "memory");
// a memory folder of its own under a temp root, and a link to it — the guard
// judges the path, not the string (a link, `/./`, `//` do not get past)
const fake = mkdtempSync(join(tmpdir(), "guard-link-"));
mkdirSync(join(fake, ".claude", "projects", "p", "memory"), { recursive: true });
symlinkSync(join(fake, ".claude", "projects", "p", "memory"), join(fake, "link"), "dir");
after(() => rmSync(fake, { recursive: true, force: true }));
// links under a home of its own: the path is resolved component by component,
// as realpath -m — a dangling link by its target, `..` in a link's target after
// the link before it; past 40 hops or a cycle the guard blocks (closed on failure)
// physical, so that a hop is a hop of the chain (/tmp, /var are links on macOS)
const home = realpathSync(mkdtempSync(join(tmpdir(), "guard-home-")));
mkdirSync(join(home, ".claude", "projects", "x", "memory", "sub"), { recursive: true });
mkdirSync(join(home, "safe", "sub"), { recursive: true });
after(() => rmSync(home, { recursive: true, force: true }));
const chain = (name, n, target) => {
  const dir = join(home, "chains", name);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++)
    symlinkSync(i === n - 1 ? target : join(dir, `l${i + 1}`), join(dir, `l${i}`));
  return join(dir, "l0");
};
const cycle = join(home, "chains", "cycle");
mkdirSync(cycle, { recursive: true });
symlinkSync(join(cycle, "b"), join(cycle, "a"));
symlinkSync(join(cycle, "a"), join(cycle, "b"));
const memoryFile = join(home, ".claude", "projects", "x", "memory", "f");
// alias.md → jump/../note.md, jump → <dir>/sub: the target is <dir>/note.md
const dotdot = (name, dir) => {
  const at = join(home, "dotdot", name);
  mkdirSync(at, { recursive: true });
  symlinkSync(join(dir, "sub"), join(at, "jump"));
  symlinkSync("jump/../note.md", join(at, "alias.md"));
  return join(at, "alias.md");
};
const guardCases = [
  ["Write", { file_path: join(memory, "MEMORY.md") }, 2],
  ["Write", { file_path: `${join(fake, "link")}/MEMORY.md` }, 2],
  ["Write", { file_path: `${homedir()}/.claude/./projects/-x/memory/MEMORY.md` }, 2],
  ["Edit", { file_path: `${homedir()}/.claude//projects/-x/memory/MEMORY.md` }, 2],
  ["NotebookEdit", { notebook_path: join(memory, "n.ipynb"), new_source: "x" }, 2],
  ["NotebookEdit", { notebook_path: join(tmpdir(), "n.ipynb"), new_source: "x" }, 0],
  ["Write", { file_path: join(tmpdir(), "a.md") }, 0],
  ["Write", { file_path: chain("nine", 9, memoryFile) }, 2, home],
  ["Write", { file_path: chain("eight", 8, memoryFile) }, 2, home],
  ["Write", { file_path: chain("safe", 3, join(home, "safe", "f")) }, 0, home],
  ["Write", { file_path: join(cycle, "a") }, 2, home],
  ["Write", { file_path: chain("dangling", 1, join(dirname(memoryFile), "new.md")) }, 2, home],
  ["Write", { file_path: dotdot("memory", dirname(memoryFile)) }, 2, home],
  ["Write", { file_path: dotdot("safe", join(home, "safe")) }, 0, home],
  ["Write", { file_path: `${join(home, "safe", "a")}/../b.md` }, 0, home],
  ["Write", { file_path: chain("forty", 40, join(home, "safe", "f")) }, 0, home],
  ["Write", { file_path: chain("forty-one", 41, join(home, "safe", "f")) }, 2, home],
  // a case-insensitive disk (APFS, Windows) takes any spelling for the same folder
  ["Write", { file_path: join(home, ".claude", "projects", "x", "MEMORY", "f") }, 2, home],
  ["Write", { file_path: join(home, ".Claude", "projects", "x", "memory", "f") }, 2, home],
  ["Write", { file_path: join(home, ".claude", "PROJECTS", "x", "memory", "f") }, 2, home],
  ["Write", { file_path: join(home, "notes", "Memory", "f") }, 0, home],
];
for (const [where, groups] of [
  ["settings", () => settings.hooks.PreToolUse ?? []],
  ["hooks.md", templateGuard],
]) {
  for (const [tool, toolInput, code, HOME] of guardCases) {
    test(`memory-guard (${where}): ${tool} ${Object.values(toolInput)[0]} → ${code}`, () => {
      const hooks = guardOf(groups(), tool);
      assert.ok(hooks.length, `a PreToolUse hook matches ${tool}`);
      const payload = JSON.stringify({ tool_name: tool, tool_input: toolInput });
      const env = HOME ? { ...process.env, HOME } : process.env;
      // POSIX sh too: dash on Linux, bash in posix mode on macOS
      for (const shell of ["bash", "sh"]) {
        const codes = hooks.map(
          (h) =>
            spawnSync(shell, ["-c", h.command], { input: payload, encoding: "utf8", env }).status,
        );
        assert.ok(
          codes.includes(code) && codes.every((c) => c === 0 || c === code),
          `${shell} exit codes: ${codes}`,
        );
      }
    });
  }
}

// One rule in both carriers: this repo's guard is the template's, but for the
// words it says.
test(
  "memory-guard: this repo runs the template's guard",
  { skip: !!(process.env.ISKRON_HOOKS_SETTINGS || process.env.ISKRON_HOOKS_TEMPLATE) },
  () => {
    const logic = (groups) =>
      guardOf(groups, "Write").map((h) => h.command.replace(/echo '.*' >&2/, "echo … >&2"));
    assert.deepEqual(logic(settings.hooks.PreToolUse ?? []), logic(templateGuard()));
  },
);

// The guard refuses with a route, not a bare "forbidden": the project graph by
// name, the persistence section as the repo's AGENTS.md calls it, the personal
// graph. The template carries the first two as slots; this repo — filled.
const refusal = (groups) => {
  const payload = JSON.stringify({
    tool_name: "Write",
    tool_input: { file_path: join(memory, "MEMORY.md") },
  });
  return guardOf(groups, "Write")
    .map((h) => spawnSync("sh", ["-c", h.command], { input: payload, encoding: "utf8" }).stderr)
    .join("\n");
};
test("memory-guard (hooks.md): the refusal routes through the slots", () => {
  const said = refusal(templateGuard());
  for (const slot of ["<Граф>", "<Раздел персистентности>", "@handle/mind"])
    assert.ok(said.includes(slot), `the refusal names ${slot}: ${said}`);
});
test("memory-guard (settings): the refusal names this repo's graph and section", () => {
  const said = refusal(settings.hooks.PreToolUse ?? []);
  const agents = readFileSync(join(root, "AGENTS.md"), "utf8");
  const graph = /^'Граф': '(@[^ ']+)/m.exec(agents)?.[1];
  const headings = new Set([...agents.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()));
  assert.ok(graph && said.includes(graph), `the refusal names the graph ${graph}: ${said}`);
  assert.ok(
    [...said.matchAll(/«([^»]+)»/g)].some((m) => headings.has(m[1])),
    `the refusal names a section of AGENTS.md as it is titled: ${said}`,
  );
  assert.ok(said.includes("@handle/mind"), `the refusal names the personal graph: ${said}`);
  assert.doesNotMatch(said, /<[^>\s]+>/, "no slot is left unfilled");
});

// every `jq -e '<filter>'` a hook command runs (the push hook runs two)
const filtersOf = (command) => [...command.matchAll(/jq -e '([^']+)'/g)].map((m) => m[1]);

function claudeWakes(command, output, cwd = process.cwd()) {
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_response: { stdout: output, stderr: "", exit_code: 0 },
  });
  const said = bashHooks.map((h) =>
    execFileSync("bash", ["-c", h.command], { input: payload, encoding: "utf8", cwd }),
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
    for (const filter of filtersOf(h.command)) {
      const r = spawnSync("jq", ["-e", filter], { input: payload, encoding: "utf8" });
      assert.equal(r.stderr, "", filter.slice(-60));
      assert.equal(r.status, 1, filter.slice(-60));
    }
  }
});

// The sample runs on the stand-in server (opencode-stand.mjs) as an instance
// with ctx.location of its own folder. `dirs` maps a session id to its working
// directory, as OpenCode hands it out: ctx.session.get({ sessionID })
// .location.directory (the plugin's own process directory is the server's);
// the instance stands in the folder of s1 when there is one, else in the
// stand's own. A call without a sessionID is made in a session of that folder.
async function loadPlugin(dirs = {}) {
  const s = await standServer(ritualSample(surfacesPath));
  const home = dirs.s1 ?? s.own;
  const plugin = await s.instance(home);
  s.sessions.set("mine", { dir: home });
  for (const [id, dir] of Object.entries(dirs)) s.sessions.set(id, { dir });
  return async (input) => {
    input.sessionID ??= "mine";
    await plugin.call("execute.after", input);
  };
}

// The template keeps one word per process across its instances, keyed by the
// call's id — every call here gets its own.
let calls = 0;
const callID = () => `call-${++calls}`;

test("opencode rituals template: wakes by outcome", async () => {
  const after = await loadPlugin();
  for (const [command, output, push, merge] of cases) {
    const input = {
      tool: "bash",
      id: callID(),
      status: "completed",
      input: { command },
      result: { content: output, metadata: { exit: 0 } },
    };
    await after(input);
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
      id: callID(),
      status: "completed",
      input: { command: "git checkout main && git pull" },
      result: { content: "fatal: unable to access 'https://github.com/o/r/'", metadata: { exit } },
    };
    await after(input);
    assert.equal(String(input.result.content).includes("мерж"), merge, `exit ${exit}`);
  }
});

// The server makes one plugin instance per spelling of a directory (/tmp/… and
// /private/tmp/…); after canonicalising both own the session — so the greeting
// (by session) and the reminder (by call) are said once per process, children
// get no greeting, and the shell tool is `shell` as observed on 2.0.24.
test("opencode rituals template: two instances of one directory speak once", async () => {
  const s = await standServer(ritualSample(surfacesPath));
  const one = await s.instance(s.own);
  const two = await s.instance(`${s.own}/`);
  await s.create("root-1", s.own);
  await s.create("child-1", s.own, "root-1");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.greeted("root-1"), 1);
  assert.equal(s.greeted("child-1"), 0);
  s.sessions.set("s1", { dir: s.own });
  const input = {
    tool: "shell",
    id: callID(),
    sessionID: "s1",
    status: "completed",
    input: { command: "gh pr merge 12 --squash" },
    result: { content: "✓ Squashed and merged pull request #12", metadata: { exit: 0 } },
  };
  await one.call("execute.after", input);
  await two.call("execute.after", input);
  await s.stop();
  assert.equal(String(input.result.content).split("[iskron] мерж").length - 1, 1);
});

// Without a call id there is no key to be once by: each instance of the
// directory speaks for itself — two words, not silence.
test("opencode rituals template: two instances, a call without an id, each speak", async () => {
  const s = await standServer(ritualSample(surfacesPath));
  const one = await s.instance(s.own);
  const two = await s.instance(`${s.own}/`);
  s.sessions.set("s1", { dir: s.own });
  const input = {
    tool: "shell",
    id: undefined,
    sessionID: "s1",
    status: "completed",
    input: { command: "gh pr merge 12 --squash" },
    result: { content: "✓ Squashed and merged pull request #12", metadata: { exit: 0 } },
  };
  await one.call("execute.after", input);
  await two.call("execute.after", input);
  await s.stop();
  assert.equal(String(input.result.content).split("[iskron] мерж").length - 1, 2);
});

// A call without an id has nothing to be once by: the first such call must not
// take the key `undefined` and silence every later reminder.
test("opencode rituals template: calls without an id each get the reminder", async () => {
  const after = await loadPlugin();
  for (const n of [1, 2]) {
    const input = {
      tool: "shell",
      id: undefined,
      status: "completed",
      input: { command: "git push" },
      result: {
        content: "To github.com:o/r.git\n * [new branch]      b -> b",
        metadata: { exit: 0 },
      },
    };
    await after(input);
    assert.ok(String(input.result.content).includes("[iskron] пуш"), `call ${n}`);
  }
});

// A quiet push prints no `To <remote>`, and a cut tail (`| tail -1`, `| head -1`)
// makes its output indistinguishable from a refusal — so the state of git speaks:
// after the call HEAD equals @{push} only when the remote took the push. The
// commands below really run against a local bare repository; their real output
// is what the hooks are shown.
const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sh = (cwd, command) => {
  const r = spawnSync("bash", ["-c", command], { cwd, encoding: "utf8" });
  return `${r.stdout}${r.stderr}`;
};

function quietRepos() {
  const dir = mkdtempSync(join(tmpdir(), "quiet-push-"));
  const origin = join(dir, "origin.git");
  git(dir, "init", "-q", "--bare", "-b", "main", origin);
  const clone = (name) => {
    const p = join(dir, name);
    git(dir, "clone", "-q", origin, p);
    git(p, "config", "user.email", "t@t");
    git(p, "config", "user.name", "t");
    return p;
  };
  const a = clone("a");
  git(a, "commit", "-q", "--allow-empty", "-m", "base");
  git(a, "push", "-q", "origin", "main");
  git(a, "checkout", "-q", "-b", "feat/x");
  git(a, "push", "-q", "-u", "origin", "feat/x");
  const b = clone("b");
  git(b, "checkout", "-q", "feat/x");
  return { dir, a, b, origin };
}

// [name, setup(a, b) → command, wakes]
const quietCases = [
  ["a clean quiet push wakes", () => "git push -q origin feat/x 2>&1 | tail -3", true, true],
  [
    "…with --quiet and a head cut",
    () => "git push --quiet origin feat/x 2>&1 | head -1",
    true,
    true,
  ],
  ["…before a `;`", () => "git push -q origin feat/x; echo done", true, true],
  [
    "…after a chain",
    () => "git status -sb && git push -q origin feat/x 2>&1 | tail -1",
    true,
    true,
  ],
  [
    "a non-fast-forward refusal stays silent (tail -3)",
    () => "git push -q origin feat/x 2>&1 | tail -3",
    false,
    false,
  ],
  ["…(tail -1)", () => "git push -q origin feat/x 2>&1 | tail -1", false, false],
  ["…(head -1)", () => "git push -q origin feat/x 2>&1 | head -1", false, false],
  ["…(whole output)", () => "git push -q origin feat/x 2>&1 | cat", false, false],
  [
    "a missing remote stays silent (tail -1)",
    () => "git push -q file:///nonexistent/x.git feat/x 2>&1 | tail -1",
    false,
    false,
  ],
  ["…(tail -3)", () => "git push -q file:///nonexistent/x.git feat/x 2>&1 | tail -3", false, false],
];

for (const [name, command, wakes, lands] of quietCases) {
  test(`quiet push: ${name}`, async () => {
    const { a, b } = quietRepos();
    if (!lands) {
      // someone else pushed first: the local push is refused
      git(b, "commit", "-q", "--allow-empty", "-m", "theirs");
      git(b, "push", "-q", "origin", "feat/x");
    }
    git(a, "commit", "-q", "--allow-empty", "-m", "mine");
    const cmd = command();
    const output = sh(a, cmd);
    assert.equal(claudeWakes(cmd, output, a).push, wakes, `claude: ${cmd}`);
    const after = await loadPlugin({ s1: a });
    const input = {
      tool: "bash",
      id: callID(),
      sessionID: "s1",
      status: "completed",
      input: { command: cmd },
      result: { content: output, metadata: { exit: 0 } },
    };
    await after(input);
    assert.equal(String(input.result.content).includes("пуш"), wakes, `opencode: ${cmd}`);
  });
}

// Equal refs are the state of the repository, not the outcome of this push: they
// may hold before the call, and a refusal leaves them as they were. A refusal
// git did print (`fatal:`, `error:`, ` ! [rejected]`, ` ! [remote rejected]` at
// a line start) vetoes the fallback; a quiet success still wakes.
// [name, command, output (null — run it for real), wakes]
const quietVeto = [
  [
    "a refusal before `;` stays silent",
    "git push -q nonexistent-remote; echo finished",
    null,
    false,
  ],
  [
    "a fatal after progress lines stays silent",
    "git push -q origin feat/x 2>&1 | tail -4",
    "Enumerating objects: 3, done.\nCounting objects: 100% (3/3), done.\nWriting objects: 100% (2/2), 230 bytes | 230.00 KiB/s, done.\nfatal: the remote end hung up unexpectedly\n",
    false,
  ],
  [
    "a remote rejection stays silent",
    "git push -q origin feat/x 2>&1 | tail -2",
    " ! [remote rejected] feat/x -> feat/x (pre-receive hook declined)\nerror: failed to push some refs to 'origin'\n",
    false,
  ],
  [
    "a rejection stays silent",
    "git push -q origin feat/x 2>&1 | head -1",
    " ! [rejected]        feat/x -> feat/x (fetch first)\n",
    false,
  ],
  [
    "an error line alone stays silent",
    "git push -q origin feat/x; echo done",
    "error: src refspec feat/y does not match any\ndone\n",
    false,
  ],
  [
    "a quiet success with remote chatter wakes",
    "git push -q origin feat/x 2>&1 | tail -3",
    "remote: \nremote: Create a pull request for 'feat/x' on GitHub by visiting:\nremote:      https://example.org/pull/new/feat/x\n",
    true,
  ],
  ["a quiet success without output wakes", "git push -q origin feat/x; echo done", "done\n", true],
];

for (const [name, cmd, given, wakes] of quietVeto) {
  test(`quiet push, refs already equal: ${name}`, async () => {
    const { a } = quietRepos(); // HEAD equals @{push} before the call
    const output = given ?? sh(a, cmd);
    assert.equal(claudeWakes(cmd, output, a).push, wakes, `claude: ${cmd}`);
    const after = await loadPlugin({ s1: a });
    const input = {
      tool: "bash",
      id: callID(),
      sessionID: "s1",
      status: "completed",
      input: { command: cmd },
      result: { content: output, metadata: { exit: 0 } },
    };
    await after(input);
    assert.equal(String(input.result.content).includes("пуш"), wakes, `opencode: ${cmd}`);
  });
}

// Claude Code hands the streams apart: the refusal arrives in stderr.
test("quiet push, refs already equal: a refusal in stderr stays silent (claude)", () => {
  const { a } = quietRepos();
  const cmd = "git push -q nonexistent-remote; echo finished";
  const r = spawnSync("bash", ["-c", cmd], { cwd: a, encoding: "utf8" });
  assert.match(r.stderr, /^fatal:/);
  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: cmd },
    tool_response: { stdout: r.stdout, stderr: r.stderr, exit_code: 0 },
  });
  const said = bashHooks
    .map((h) =>
      execFileSync("bash", ["-c", h.command], { input: payload, encoding: "utf8", cwd: a }),
    )
    .join("");
  assert.equal(said.includes("Пуш"), false);
});

// text is not a command, whatever the state of git says
for (const cmd of [
  'echo "note; git push -q origin x"',
  'gh pr create --title t --body "fixes; git push -q origin x here"',
  "git commit -m \"$(cat <<'EOF'\nfix: x\n\ngit push -q origin y\nEOF\n)\"",
  "cat <<EOF\ngit push -q origin y\nEOF",
  "git push -q -h | tail",
  "echo git push -q | tail",
]) {
  test(`quiet push: text never wakes: ${cmd.split("\n")[0]}`, () => {
    const { a } = quietRepos(); // HEAD equals @{push} here
    assert.equal(claudeWakes(cmd, "", a).push, false);
  });
}

for (const trunk of ["main", "master"]) {
  test(`quiet push: the trunk never wakes (${trunk})`, async () => {
    const { a } = quietRepos();
    if (trunk !== "main") {
      git(a, "checkout", "-q", "-b", trunk, "main");
      git(a, "push", "-q", "-u", "origin", trunk);
    } else git(a, "checkout", "-q", "main");
    git(a, "commit", "-q", "--allow-empty", "-m", "on trunk");
    const cmd = `git push -q origin ${trunk} 2>&1 | tail -1`;
    const output = sh(a, cmd);
    assert.equal(claudeWakes(cmd, output, a).push, false);
    const after = await loadPlugin({ s1: a });
    const input = {
      tool: "bash",
      id: callID(),
      sessionID: "s1",
      status: "completed",
      input: { command: cmd },
      result: { content: output, metadata: { exit: 0 } },
    };
    await after(input);
    assert.equal(String(input.result.content).includes("пуш"), false);
  });
}

test("quiet push: a session without a known directory stays silent", async () => {
  const { a } = quietRepos();
  const cmd = "git push -q origin feat/x 2>&1 | tail -1";
  const after = await loadPlugin({});
  const input = {
    tool: "bash",
    id: callID(),
    sessionID: "unknown",
    status: "completed",
    input: { command: cmd },
    result: { content: "", metadata: { exit: 0 } },
  };
  await after(input);
  assert.equal(String(input.result.content).includes("пуш"), false, a);
});

// Another forge's merge rides the same defs with its own head and confirmation
// (hooks.md names fj): the defs are taken from the template itself, so the copy
// that ships to other repos is judged, not this repo's projection.
const fj = [
  ['fj pr merge 12 -m "fix -h parsing"', "", true],
  ["fj pr merge 12 --method squash", "", true],
  ["fj pr merge 1 | tail", "Merged PR #1", true],
  ["fj pr merge 1 | tail", "", false],
  ["fj pr merge --help", "", false],
  ['fj pr merge 12 -m "x" -h', "", false],
  ['fj pr merge 12 -m "x" --help', "", false],
];

test("iskronify template defs judge another forge's merge by outcome", () => {
  const skill = readFileSync(templatePath, "utf8");
  const push = skill.split("\n").find((l) => l.startsWith("def a:") && l.includes(' push"'));
  assert.ok(push, "push filter line present in hooks.md");
  const defs = push.slice(0, push.lastIndexOf("; ran(") + 2);
  const filter = defs + 'ran("fj pr merge"; "-h|--help"; "Merged PR #")';
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

// The OpenCode sample knows the same forges as hooks.md: fj by its outcome too.
test("opencode rituals template: another forge's merge (fj) wakes by outcome", async () => {
  const after = await loadPlugin();
  for (const [command, output, wakes] of fj) {
    const input = {
      tool: "shell",
      status: "completed",
      input: { command },
      result: { content: output, metadata: { exit: 0 } },
    };
    await after(input);
    assert.equal(String(input.result.content).includes("мерж"), wakes, command);
  }
});

test(
  "iskronify template carries the filters this repo runs",
  { skip: !!(process.env.ISKRON_HOOKS_SETTINGS || process.env.ISKRON_HOOKS_TEMPLATE) },
  () => {
    const skill = readFileSync(templatePath, "utf8");
    for (const h of bashHooks) {
      const filters = filtersOf(h.command);
      assert.ok(filters.length, `hook runs a jq -e filter: ${h.command.slice(0, 60)}`);
      for (const filter of filters)
        assert.ok(skill.includes(filter), `hooks.md carries the filter: ${filter.slice(0, 60)}…`);
    }
  },
);
