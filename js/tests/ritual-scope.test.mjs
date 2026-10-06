// Probe for the scope of OpenCode rituals plugins (graph @nks/nks-dev, nodes
// #6686, #5048). ctx.event.subscribe is one stream for the whole OpenCode
// server of a machine: a project plugin sees session.created of every
// directory, and a session of another directory must get no write from it.
// Tool hooks wake only for calls in the instance's own directory (observed on
// 2.0.24): they are run in its own session and judged only for breaking. The
// instance's directory is handed in through a symlink while events carry the
// real path — /tmp and /private/tmp differ so live — so a raw string compare
// loses its own session.
//
// Judged by the bridge's `check-rituals` (js/cli/rituals.ts, the dev build):
//   • every OpenCode plugin sample in the skills' markdown (a ```js block with
//     a default export and setup(ctx)) staged as <own>/.opencode/plugins/*.js —
//     no hole, and in its own session it greets and wakes after a push;
//   • the revizor itself, on small leaky and scoped plugins.
//
// ISKRON_RITUAL_SAMPLES (path-delimited markdown files) points the probe at any
// copy (a past revision) so it can be shown red before a fix; ISKRON_BRIDGE_PATH
// does the same for the revizor.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { after, test } from "node:test";

import { BUILT_BRIDGE, REPO } from "./built.mjs";

const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;

const skills = join(REPO, "skills");
const sources =
  process.env.ISKRON_RITUAL_SAMPLES?.split(delimiter) ??
  readdirSync(skills, { recursive: true })
    .filter((p) => p.endsWith(".md"))
    .map((p) => join(skills, p));

const pluginSamples = (md) =>
  [...md.matchAll(/```js\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((b) => /export default/.test(b) && /setup\s*\(\s*ctx\s*\)/.test(b));

// A sample is run exactly as written: a name it leaves undefined is its failure,
// never filled in here.
const samples = sources.flatMap((path) =>
  pluginSamples(readFileSync(path, "utf8")).map((source, i) => ({ path, i, source })),
);

const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

function repoWith(source) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "ritual-scope-")));
  made.push(repo);
  mkdirSync(join(repo, ".opencode", "plugins"), { recursive: true });
  writeFileSync(join(repo, ".opencode", "plugins", "rituals.js"), source);
  return repo;
}

function check(repo, json = true) {
  const r = spawnSync(
    process.execPath,
    [BRIDGE, "check-rituals", ...(json ? ["--json"] : []), repo],
    {
      encoding: "utf8",
      env: { ...process.env, ISKRON_BRIDGE_LANG: "ru" },
    },
  );
  return {
    status: r.status,
    out: r.stdout,
    err: r.stderr,
    verdicts: json ? JSON.parse(r.stdout) : null,
  };
}

test("opencode plugin samples are found", () => {
  assert.ok(samples.length > 0, `no OpenCode plugin sample in ${sources.length} markdown files`);
});

for (const { path, i, source } of samples) {
  test(`opencode plugin sample touches only its own directory: ${relative(REPO, path)} #${i}`, () => {
    const { status, verdicts, err } = check(repoWith(source));
    const [v] = verdicts;
    const sample = `${relative(REPO, path)} #${i}`;
    assert.equal(v.error, undefined, `${sample}: ${err}`);
    assert.deepEqual(v.scope.broken, [], `${sample}: a hook breaks when run as written`);
    assert.equal(v.scope.writes.theirs, 0, "a session of another directory was written to");
    assert.ok(
      v.scope.writes.mine > 0,
      "the session of its own directory got no greeting (directories compared uncanonicalised?)",
    );
    assert.ok(v.scope.ownBefore, "the guard let a memory write through in its own session");
    assert.ok(v.scope.ownAfter, "a push in its own session woke nothing");
    assert.equal(status, 0);
  });
}

// how: "none" — no directory check, "raw" — strings compared as they come,
// "canon" — both sides through realpath.
const greet = (how) => `import { realpathSync } from "node:fs";
const canon = (p) => { try { return realpathSync(p); } catch { return p; } };
export default { id: "p", async setup(ctx) {
  const same = (a, b) => ${JSON.stringify(how)} === "none" || (${JSON.stringify(how)} === "raw" ? a === b : canon(a) === canon(b));
  (async () => { for await (const ev of await ctx.event.subscribe({})) {
    if (ev.type !== "session.created") continue;
    if (!same(ev.data?.location?.directory, ctx.location.directory)) continue;
    await ctx.session.synthetic({ sessionID: ev.data.sessionID, text: "hi" });
  } })();
} };`;

// No directory check: tool hooks wake only for calls in the instance's own
// directory (observed on OpenCode 2.0.24), so this guard is not a hole.
const guard = `export default { id: "g", async setup(ctx) {
  await ctx.tool.hook("execute.before", async (input) => {
    if (String(input.input?.filePath).includes("/memory/")) throw new Error("no");
  });
} };`;

test("check-rituals: a greeting without a directory check is a hole, with the fix named", () => {
  const { status, out } = check(repoWith(greet("none")), false);
  assert.equal(status, 1);
  assert.match(out, /ДЫРА .*rituals\.js/);
  assert.match(out, /пишет в сессию чужого каталога: 1/);
  assert.match(out, /realpath.*iskronify, Шаг 4/);
});

test("check-rituals: a raw string compare losing its own session under another spelling is a hole", () => {
  const { status, out } = check(repoWith(greet("raw")), false);
  assert.equal(status, 1, out);
  assert.match(out, /своя сессия под другим написанием каталога без приветствия/);
  assert.match(out, /realpath.*iskronify, Шаг 4/);
});

// @opencode/client promise/client.d.ts: event.subscribe(options) → AsyncIterable.
// A plugin taking it as such — no await, its iterator by hand — is not red.
test("check-rituals: a subscriber that does not await subscribe() is judged as written", () => {
  const source = `import { realpathSync } from "node:fs";
  const canon = (p) => { try { return realpathSync(p); } catch { return p; } };
  export default { id: "n", async setup(ctx) {
    const it = ctx.event.subscribe({})[Symbol.asyncIterator]();
    (async () => { for (;;) { const { value: ev, done } = await it.next(); if (done) break;
      if (canon(ev.data?.location?.directory) !== canon(ctx.location.directory)) continue;
      await ctx.session.prompt({ sessionID: ev.data.sessionID, text: "hi" });
    } })();
  } };`;
  const { status, verdicts } = check(repoWith(source));
  assert.equal(status, 0, JSON.stringify(verdicts));
  assert.equal(verdicts[0].scope.writes.mine, 1);
});

test("check-rituals: the temp folder is as it was after a run", () => {
  const tmp = mkdtempSync(join(tmpdir(), "ritual-scope-tmp-"));
  made.push(tmp);
  const repo = repoWith(greet("canon"));
  writeFileSync(join(repo, ".opencode", "plugins", "second.js"), guard);
  const r = spawnSync(process.execPath, [BRIDGE, "check-rituals", "--json", repo], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readdirSync(tmp), []);
});

test("check-rituals: a tool hook without a directory check is not a hole", () => {
  const { status, verdicts } = check(repoWith(guard));
  assert.equal(status, 0, JSON.stringify(verdicts));
  assert.ok(verdicts[0].scope.ownBefore);
});

test("check-rituals: a hook calling an undefined name is broken, the name said", () => {
  const source = `export default { id: "u", async setup(ctx) {
    await ctx.tool.hook("execute.before", async (input) => {
      if (isLocalMemoryPath(input.input?.filePath)) throw new Error("no");
    });
  } };`;
  const { status, out } = check(repoWith(source), false);
  assert.equal(status, 1);
  assert.match(out, /хук тула сломан .*ReferenceError: isLocalMemoryPath is not defined/);
});

test("check-rituals: a greeting scoped by canonical directories — clean, its own session greeted", () => {
  const { status, verdicts } = check(repoWith(greet("canon")));
  assert.equal(status, 0, JSON.stringify(verdicts));
  assert.equal(verdicts[0].scope.writes.mine, 1);
});

// A plugin may say a word once per process (globalThis), as one live server runs
// every instance in one process; the revizor runs plugins in one process too, so
// each run starts clean and with its own session and call ids.
test("check-rituals: two plugins with a word-once set on globalThis are judged apart", () => {
  const once = `import { realpathSync } from "node:fs";
  const canon = (p) => { try { return realpathSync(p); } catch { return p; } };
  export default { id: "o", async setup(ctx) {
    const said = (globalThis.__probeOnce ??= new Set());
    const own = canon(ctx.location.directory);
    (async () => { for await (const ev of await ctx.event.subscribe({})) {
      if (canon(ev.data?.location?.directory) !== own) continue;
      if (said.has(ev.data.sessionID)) continue;
      said.add(ev.data.sessionID);
      await ctx.session.prompt({ sessionID: ev.data.sessionID, text: "hi" });
    } })();
    await ctx.tool.hook("execute.after", async (input) => {
      if (said.has(input.id)) return;
      said.add(input.id);
      input.result = { ...input.result, content: "noted" };
    });
  } };`;
  const repo = repoWith(once);
  writeFileSync(join(repo, ".opencode", "plugins", "second.js"), once);
  const { status, verdicts } = check(repo);
  assert.equal(status, 0, JSON.stringify(verdicts));
  for (const v of verdicts) {
    assert.equal(v.scope.writes.mine, 1, `${v.file}: its own session greeted`);
    assert.ok(v.scope.ownAfter, `${v.file}: its own push woke`);
  }
});

test("check-rituals: a plugin that does not load is not passed", () => {
  const { status, verdicts } = check(repoWith("export const x = 1;"));
  assert.equal(status, 1);
  assert.match(verdicts[0].error, /setup/);
});

const call = (...args) =>
  spawnSync(process.execPath, [BRIDGE, "check-rituals", ...args], {
    encoding: "utf8",
    env: { ...process.env, ISKRON_BRIDGE_LANG: "ru" },
  });

for (const flag of ["--help", "-h"])
  test(`check-rituals ${flag}: the usage, code 0`, () => {
    const r = call(flag);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /check-rituals \[репо\.\.\.\] \[--json\]/);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  });

test("check-rituals: an unknown flag — said, code 2, no stack", () => {
  const r = call("--frob");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /неизвестный флаг --frob/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test("check-rituals: a missing repo — said, code 2, no stack", () => {
  const missing = join(tmpdir(), "ritual-scope-no-such-repo");
  const r = call(missing);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(`нет такого каталога: ${missing}`));
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});
