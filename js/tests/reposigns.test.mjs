// The repository's alignment signs (shared/reposigns.ts) and the Claude Code SessionStart hook
// built from them (hooks/onboard.mjs): temporary directories only; no network, no model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ONBOARD_START } from "../delivery/index.ts";
import { repoRoot, repoSigns } from "../shared/reposigns.ts";
import { BUILT_ONBOARD_HOOK, REPO } from "./built.mjs";

const COVER = "---\n'Граф': '@tester/work (r1)'\n'Роль агента': '#7 «агент»'\n---\n";
const STAMP = "*(iskronify: контракт `27`, штамп `2026-10-16` — …)*\n";
const START = {
  hooks: {
    SessionStart: [
      { hooks: [{ type: "command", command: "echo 'read the iskron door Start section'" }] },
    ],
  },
};

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

const CASES = [
  { name: "outside a repository", spec: {}, verdict: "outside" },
  { name: "fresh repository", spec: { git: "dir" }, verdict: "invite" },
  { name: "worktree .git file", spec: { git: "file" }, verdict: "invite" },
  {
    name: "aligned: cover, Claude Code hook, stamp",
    spec: { git: "dir", agents: COVER + STAMP, settings: JSON.stringify(START) },
    verdict: "aligned",
  },
  {
    name: "aligned: cover, OpenCode rituals, stamp",
    spec: { git: "dir", agents: COVER + STAMP, rituals: true },
    verdict: "aligned",
  },
  { name: "partial: cover only", spec: { git: "dir", agents: COVER }, verdict: "partial" },
  {
    name: "partial: stamp only",
    spec: { git: "dir", agents: `# x\n${STAMP}` },
    verdict: "partial",
  },
  {
    name: "partial: start hook only",
    spec: { git: "dir", settings: JSON.stringify(START) },
    verdict: "partial",
  },
  { name: "partial: rituals only", spec: { git: "dir", rituals: true }, verdict: "partial" },
  {
    name: "broken front matter is no cover",
    spec: { git: "dir", agents: "---\n'Граф': '@tester/work'\n# never closed\n" },
    verdict: "invite",
  },
  {
    name: "front matter without the delivery's keys is no cover",
    spec: { git: "dir", agents: "---\ntitle: notes\n---\n" },
    verdict: "invite",
  },
  {
    name: "AGENTS.md without cover or stamp",
    spec: { git: "dir", agents: "# agents\n" },
    verdict: "invite",
  },
  {
    name: "foreign SessionStart hook is no sign",
    spec: {
      git: "dir",
      settings: JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }] },
      }),
    },
    verdict: "invite",
  },
  {
    name: "unparsable settings is no sign",
    spec: { git: "dir", settings: "{" },
    verdict: "invite",
  },
];

for (const c of CASES)
  test(`repo signs: ${c.name}`, (t) => {
    const dir = lay(t, c.spec);
    assert.equal(repoSigns(dir).verdict, c.verdict);
  });

test("repo signs: the root is the nearest .git upward, read from a subdirectory", (t) => {
  const dir = lay(t, { git: "dir", agents: COVER + STAMP, rituals: true });
  const sub = join(dir, "a", "b");
  mkdirSync(sub, { recursive: true });
  assert.equal(repoRoot(sub), dir);
  assert.deepEqual(repoSigns(sub), {
    root: dir,
    cover: true,
    hook: true,
    stamp: true,
    verdict: "aligned",
  });
  const inner = join(dir, "a");
  mkdirSync(join(inner, ".git"));
  assert.equal(repoSigns(sub).verdict, "invite", "a nested repository has its own signs");
});

test("repo signs: the stamp of this repository's own AGENTS.md is recognised", () => {
  assert.equal(repoSigns(REPO).stamp, true);
  assert.equal(repoSigns(REPO).cover, true);
});

/** The built hook, as Claude Code runs it: hook input on stdin, the harness's variables. */
function hook(input, opts = {}) {
  const r = spawnSync(process.execPath, [BUILT_ONBOARD_HOOK], {
    input: input === undefined ? "" : typeof input === "string" ? input : JSON.stringify(input),
    cwd: opts.cwd ?? tmpdir(),
    env: {
      ...process.env,
      ISKRON_BRIDGE_LANG: opts.lang ?? "ru",
      CLAUDE_PROJECT_DIR: opts.project ?? "",
    },
    encoding: "utf8",
    timeout: 5000,
  });
  return r;
}

const startInput = (cwd) => ({
  session_id: "s",
  transcript_path: "/dev/null",
  cwd,
  hook_event_name: "SessionStart",
  source: "startup",
});

for (const c of CASES.filter(
  (x) =>
    ["outside a repository", "fresh repository", "worktree .git file"].includes(x.name) ||
    x.verdict !== "invite",
))
  test(`claude code hook: ${c.name}`, (t) => {
    const dir = lay(t, c.spec);
    const started = Date.now();
    const r = hook(startInput(dir));
    const elapsed = Date.now() - started;
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.equal(r.stdout, c.verdict === "invite" ? `${ONBOARD_START.ru.start()}\n` : "");
    assert.ok(elapsed < 1000, `fractions of a second: ${elapsed}ms`);
  });

test("claude code hook: English line, one line", (t) => {
  const r = hook(startInput(lay(t, { git: "dir" })), { lang: "en" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `${ONBOARD_START.en.start()}\n`);
  assert.equal(r.stdout.trimEnd().split("\n").length, 1);
});

test("claude code hook: without input — the project variable, then its own directory", (t) => {
  const fresh = lay(t, { git: "dir" });
  assert.equal(hook(undefined, { project: fresh }).stdout, `${ONBOARD_START.ru.start()}\n`);
  assert.equal(hook("not json", { cwd: fresh }).stdout, `${ONBOARD_START.ru.start()}\n`);
  assert.equal(hook(undefined, { cwd: lay(t) }).stdout, "", "outside — silence");
});

test("claude code hook: unreadable files and a missing directory do not fail the start", (t) => {
  const dir = lay(t, { git: "dir", agents: COVER + STAMP, rituals: true });
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    chmodSync(join(dir, "AGENTS.md"), 0o000);
    const r = hook(startInput(dir));
    chmodSync(join(dir, "AGENTS.md"), 0o644);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "", "the rituals plugin still counts: partial, silent");
  }
  const gone = hook(startInput(join(dir, "no", "such")));
  assert.equal(gone.status, 0, gone.stderr);
  assert.equal(gone.stdout, "", "a path inside an aligned repository: its root's signs");
});

test("claude code hook: the plugin declares it on SessionStart by the built path", () => {
  const hooks = JSON.parse(readFileSync(join(REPO, "hooks", "hooks.json"), "utf8"));
  const commands = hooks.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
  assert.deepEqual(commands, ['node "${CLAUDE_PLUGIN_ROOT}/hooks/onboard.mjs"']);
});
