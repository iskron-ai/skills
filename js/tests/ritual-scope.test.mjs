// Probe for the scope of OpenCode rituals plugins (graph @nks/nks-dev, node
// #6686). ctx.event.subscribe and ctx.tool.hook are one for the whole OpenCode
// server of a machine: a project plugin sees session.created and tool calls of
// every directory. A session of another directory must get no write, no throw
// and no edited result from it; the tool hook's input carries no directory, so
// the stand-in gives it only through ctx.session.get(sessionID).
//
// Judged by the bridge's `check-rituals` (js/cli/rituals.ts, the dev build):
//   • every OpenCode plugin sample in the skills' markdown (a ```js block with
//     a default export and setup(ctx)) staged as <own>/.opencode/plugins/*.js —
//     no hole, and in its own session it greets and wakes after a push;
//   • the revizor itself, on small leaky and scoped plugins.
//
// ISKRON_RITUAL_SAMPLES (path-delimited markdown files) points the probe at any
// copy (a past revision) so it can be shown red before a fix.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE, REPO } from "./built.mjs";

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

function repoWith(source) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "ritual-scope-")));
  mkdirSync(join(repo, ".opencode", "plugins"), { recursive: true });
  writeFileSync(join(repo, ".opencode", "plugins", "rituals.js"), source);
  return repo;
}

function check(repo, json = true) {
  const r = spawnSync(
    process.execPath,
    [BUILT_BRIDGE, "check-rituals", ...(json ? ["--json"] : []), repo],
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
    assert.deepEqual(
      v.scope.foreign,
      [],
      "a tool hook threw or edited a call in another directory",
    );
    assert.ok(v.scope.writes.mine > 0, "the session of its own directory got no greeting");
    assert.ok(v.scope.ownBefore, "the guard let a memory write through in its own session");
    assert.ok(v.scope.ownAfter, "a push in its own session woke nothing");
    assert.equal(status, 0);
  });
}

const greet = (scoped) => `export default { id: "p", async setup(ctx) {
  (async () => { for await (const ev of await ctx.event.subscribe({})) {
    if (ev.type !== "session.created") continue;
    if (${scoped} && ev.data?.location?.directory !== ctx.location.directory) continue;
    await ctx.session.synthetic({ sessionID: ev.data.sessionID, text: "hi" });
  } })();
} };`;

const guard = (scoped) => `export default { id: "g", async setup(ctx) {
  await ctx.tool.hook("execute.before", async (input) => {
    if (${scoped}) {
      const info = await ctx.session.get({ sessionID: input.sessionID });
      if (info?.location?.directory !== ctx.location.directory) return;
    }
    if (String(input.input?.filePath).includes("/memory/")) throw new Error("no");
  });
} };`;

test("check-rituals: a greeting without a directory check is a hole, with the fix named", () => {
  const { status, out } = check(repoWith(greet(false)), false);
  assert.equal(status, 1);
  assert.match(out, /ДЫРА .*rituals\.js/);
  assert.match(out, /пишет в сессию чужого каталога: 1/);
  assert.match(out, /ctx\.location\.directory.*iskronify, Шаг 4/);
});

test("check-rituals: a guard that blocks every directory is a hole", () => {
  const { status, verdicts } = check(repoWith(guard(false)));
  assert.equal(status, 1);
  assert.ok(verdicts[0].scope.foreign.includes("execute.before write: throw (Error: no)"));
  assert.deepEqual(verdicts[0].scope.broken, []);
});

test("check-rituals: a hook calling an undefined name is broken, the name said", () => {
  const source = `export default { id: "u", async setup(ctx) {
    await ctx.tool.hook("execute.before", async (input) => {
      const info = await ctx.session.get({ sessionID: input.sessionID });
      if (info?.location?.directory !== ctx.location.directory) return;
      if (isLocalMemoryPath(input.input?.filePath)) throw new Error("no");
    });
  } };`;
  const { status, out } = check(repoWith(source), false);
  assert.equal(status, 1);
  assert.match(out, /хук сломан .*ReferenceError: isLocalMemoryPath is not defined/);
});

test("check-rituals: a hook that writes a reminder into a foreign session is a hole", () => {
  const source = `export default { id: "w", async setup(ctx) {
    await ctx.tool.hook("execute.after", async (input) => {
      await ctx.session.synthetic({ sessionID: input.sessionID, text: "pushed" });
    });
  } };`;
  const { status, verdicts } = check(repoWith(source));
  assert.equal(status, 1);
  assert.equal(verdicts[0].scope.writes.theirs, 0);
  assert.ok(verdicts[0].scope.foreign.includes("hooks wrote into the session: 2"));
});

test("check-rituals: scoped by the event and by ctx.session.get — clean", () => {
  for (const source of [greet(true), guard(true)]) {
    const { status, verdicts } = check(repoWith(source));
    assert.equal(status, 0, JSON.stringify(verdicts));
  }
});

test("check-rituals: a plugin that does not load is not passed", () => {
  const { status, verdicts } = check(repoWith("export const x = 1;"));
  assert.equal(status, 1);
  assert.match(verdicts[0].error, /setup/);
});
