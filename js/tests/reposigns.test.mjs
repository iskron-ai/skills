// The repository's alignment signs (shared/reposigns.ts) and the Claude Code SessionStart hook
// built from them (hooks/onboard.mjs): temporary directories only; no network, no model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import { ONBOARD_START } from "../delivery/index.ts";
import { repoRoot, repoSigns } from "../shared/reposigns.ts";
import { BUILT_ONBOARD_HOOK, REPO } from "./built.mjs";

const COVER = "---\n'Граф': '@tester/work (r1)'\n'Роль агента': '#7 «агент»'\n---\n";
const STAMP = "*(iskronify: контракт `27`, штамп `2026-10-16` — …)*\n";
// The English form of the same cover (#8497); the neighbouring delivery shares its keys.
const COVER_EN = "---\n'Graph': '@tester/work (r1)'\n'Agent role': '#7 \"agent\"'\n---\n";
const STAMP_EN = "*(iskronify: contract `29`, stamp `2026-10-22` — …)*\n";
const STAMP_FOREIGN = "*(verstak align: contract 4, stamped 2026-10-16)*\n";
const session = (command) =>
  JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } });
// Start hooks as iskronify projects them: the template's English form and Russian projections.
const STARTS = [
  `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"read the iskron door's Start section first"}}'`,
  `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Прочти раздел «Старт» скилла-двери iskron до действий"}}'`,
  `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Старт: до действий прочитай раздел «Старт» двери iskron."}}'`,
];
const START = session(STARTS[0]);

/** A temporary directory laid out by spec; removed after the test. */
function lay(t, spec = {}) {
  const dir = mkdtempSync(join(tmpdir(), "reposigns-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (spec.git === "dir") mkdirSync(join(dir, ".git"));
  if (spec.git === "file")
    writeFileSync(join(dir, ".git"), "gitdir: /elsewhere/.git/worktrees/w\n");
  if (spec.agents !== undefined) writeFileSync(join(dir, "AGENTS.md"), spec.agents);
  if (spec.settings !== undefined) {
    mkdirSync(join(dir, ".claude"));
    writeFileSync(join(dir, ".claude", "settings.json"), spec.settings);
  }
  if (spec.rituals) {
    mkdirSync(join(dir, ".opencode", "plugins"), { recursive: true });
    writeFileSync(join(dir, ".opencode", "plugins", "iskron-rituals.js"), "export default {};\n");
  }
  return dir;
}

const all = (v) => ({ "claude-code": v, opencode: v, other: v });
const CASES = [
  { name: "outside a repository", spec: {}, verdicts: all("outside") },
  { name: "fresh repository", spec: { git: "dir" }, verdicts: all("invite") },
  { name: "worktree .git file", spec: { git: "file" }, verdicts: all("invite") },
  {
    name: "cover, stamp, both start hooks",
    spec: { git: "dir", agents: COVER + STAMP, settings: START, rituals: true },
    verdicts: all("aligned"),
  },
  {
    name: "cover, stamp, Claude Code hook",
    spec: { git: "dir", agents: COVER + STAMP, settings: START },
    verdicts: { "claude-code": "aligned", opencode: "partial", other: "aligned" },
  },
  {
    name: "cover, stamp, OpenCode rituals",
    spec: { git: "dir", agents: COVER + STAMP, rituals: true },
    verdicts: { "claude-code": "partial", opencode: "aligned", other: "aligned" },
  },
  {
    // Codex and pi get no start hook from iskronify: a repository aligned for them has none.
    name: "cover and stamp without start hooks",
    spec: { git: "dir", agents: COVER + STAMP },
    verdicts: { "claude-code": "partial", opencode: "partial", other: "aligned" },
  },
  { name: "cover only", spec: { git: "dir", agents: COVER }, verdicts: all("partial") },
  {
    name: "English cover, stamp, both start hooks",
    spec: { git: "dir", agents: COVER_EN + STAMP_EN, settings: START, rituals: true },
    verdicts: all("aligned"),
  },
  { name: "English cover only", spec: { git: "dir", agents: COVER_EN }, verdicts: all("partial") },
  {
    name: "another delivery's stamp under the shared English keys",
    spec: { git: "dir", agents: COVER_EN + STAMP_FOREIGN },
    verdicts: all("foreign"),
  },
  {
    name: "another delivery's stamp without a cover",
    spec: { git: "dir", agents: `# x\n${STAMP_FOREIGN}` },
    verdicts: all("foreign"),
  },
  {
    name: "another delivery's stamp beside this delivery's start hook",
    spec: { git: "dir", agents: COVER_EN + STAMP_FOREIGN, settings: START },
    verdicts: all("partial"),
  },
  { name: "stamp only", spec: { git: "dir", agents: `# x\n${STAMP}` }, verdicts: all("partial") },
  { name: "start hook only", spec: { git: "dir", settings: START }, verdicts: all("partial") },
  { name: "rituals only", spec: { git: "dir", rituals: true }, verdicts: all("partial") },
  {
    name: "broken front matter is no cover",
    spec: { git: "dir", agents: "---\n'Граф': '@tester/work'\n# never closed\n" },
    verdicts: all("invite"),
  },
  {
    name: "front matter without the delivery's keys is no cover",
    spec: { git: "dir", agents: "---\ntitle: notes\n---\n" },
    verdicts: all("invite"),
  },
  {
    name: "AGENTS.md without cover or stamp",
    spec: { git: "dir", agents: "# agents\n" },
    verdicts: all("invite"),
  },
  {
    name: "foreign SessionStart hook is no sign",
    spec: { git: "dir", settings: session("echo hi") },
    verdicts: all("invite"),
  },
  {
    name: "the product name alone is no start mark",
    spec: { git: "dir", settings: session(`echo 'iskron_orient(realm="r5") before acting'`) },
    verdicts: all("invite"),
  },
  {
    name: "unparsable settings is no sign",
    spec: { git: "dir", settings: "{" },
    verdicts: all("invite"),
  },
];

for (const c of CASES)
  for (const [harness, verdict] of Object.entries(c.verdicts))
    test(`repo signs: ${c.name} — ${harness}`, (t) => {
      const dir = lay(t, c.spec);
      assert.equal(repoSigns(dir, harness === "other" ? null : harness).verdict, verdict);
    });

test("repo signs: each projection of iskronify's start hook carries the mark", (t) => {
  for (const command of STARTS) {
    const dir = lay(t, { git: "dir", settings: session(command) });
    assert.equal(repoSigns(dir, "claude-code").hooks["claude-code"], true, command);
  }
});

test("repo signs: the root is the nearest .git upward, read from a subdirectory", (t) => {
  const dir = lay(t, { git: "dir", agents: COVER + STAMP, rituals: true });
  const sub = join(dir, "a", "b");
  mkdirSync(sub, { recursive: true });
  assert.equal(repoRoot(sub), dir);
  assert.deepEqual(repoSigns(sub, "opencode"), {
    root: dir,
    cover: true,
    stamp: true,
    hooks: { "claude-code": false, opencode: true },
    verdict: "aligned",
  });
  mkdirSync(join(dir, "a", ".git"));
  assert.equal(
    repoSigns(sub, "opencode").verdict,
    "invite",
    "a nested repository has its own signs",
  );
});

test("repo signs: this repository is aligned for Claude Code and OpenCode", () => {
  assert.equal(repoSigns(REPO, "claude-code").verdict, "aligned");
  assert.equal(repoSigns(REPO, "opencode").verdict, "aligned");
});

/** The plugin's declared command, as Claude Code runs it: through a shell, the plugin root in env. */
const COMMAND = JSON.parse(readFileSync(join(REPO, "hooks", "hooks.json"), "utf8")).hooks
  .SessionStart[0].hooks[0].command;

/** A plugin root holding the built hook (or not), like the installed copy. */
function pluginRoot(t, withHook = true) {
  const root = mkdtempSync(join(tmpdir(), "reposigns-plugin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (withHook) {
    mkdirSync(join(root, "hooks"));
    copyFileSync(BUILT_ONBOARD_HOOK, join(root, "hooks", "onboard.mjs"));
  }
  return root;
}

function hook(t, input, opts = {}) {
  return spawnSync(COMMAND, {
    shell: true,
    input: input === undefined ? "" : typeof input === "string" ? input : JSON.stringify(input),
    cwd: opts.cwd ?? tmpdir(),
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH}`,
      CLAUDE_PLUGIN_ROOT: opts.root ?? pluginRoot(t),
      ISKRON_BRIDGE_LANG: opts.lang ?? "ru",
      CLAUDE_PROJECT_DIR: opts.project ?? "",
    },
    encoding: "utf8",
    timeout: 5000,
  });
}

const startInput = (cwd) => ({
  session_id: "s",
  transcript_path: "/dev/null",
  cwd,
  hook_event_name: "SessionStart",
  source: "startup",
});

for (const c of CASES)
  test(`claude code hook: ${c.name}`, (t) => {
    const dir = lay(t, c.spec);
    const started = Date.now();
    const r = hook(t, startInput(dir));
    const elapsed = Date.now() - started;
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    const invite = c.verdicts["claude-code"] === "invite";
    assert.equal(r.stdout, invite ? `${ONBOARD_START.ru.start()}\n` : "");
    assert.ok(elapsed < 1000, `fractions of a second: ${elapsed}ms`);
  });

test("claude code hook: the built file absent — silence, exit 0, no error", (t) => {
  const r = hook(t, startInput(lay(t, { git: "dir" })), { root: pluginRoot(t, false) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("claude code hook: English line, one line", (t) => {
  const r = hook(t, startInput(lay(t, { git: "dir" })), { lang: "en" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${ONBOARD_START.en.start()}\n`);
  assert.equal(r.stdout.trimEnd().split("\n").length, 1);
});

test("claude code hook: without input — the project variable, then its own directory", (t) => {
  const fresh = lay(t, { git: "dir" });
  assert.equal(hook(t, undefined, { project: fresh }).stdout, `${ONBOARD_START.ru.start()}\n`);
  assert.equal(hook(t, "not json", { cwd: fresh }).stdout, `${ONBOARD_START.ru.start()}\n`);
  assert.equal(hook(t, undefined, { cwd: lay(t) }).stdout, "", "outside — silence");
});

test("claude code hook: unreadable files and a missing directory do not fail the start", (t) => {
  const dir = lay(t, { git: "dir", agents: COVER + STAMP, settings: START });
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    chmodSync(join(dir, "AGENTS.md"), 0o000);
    const r = hook(t, startInput(dir));
    chmodSync(join(dir, "AGENTS.md"), 0o644);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "the start hook still counts: partial, silent");
  }
  const gone = hook(t, startInput(join(dir, "no", "such")));
  assert.equal(gone.status, 0, gone.stderr);
  assert.equal(gone.stdout, "", "a path inside an aligned repository: its root's signs");
});

test("claude code hook: declared on startup only", () => {
  const hooks = JSON.parse(readFileSync(join(REPO, "hooks", "hooks.json"), "utf8"));
  assert.deepEqual(
    hooks.hooks.SessionStart.map((e) => e.matcher),
    ["startup"],
  );
  assert.equal(hooks.hooks.SessionStart[0].hooks.length, 1);
});
