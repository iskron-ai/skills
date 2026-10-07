// Probe for the behaviour of the OpenCode rituals plugin sample of iskronify
// on a stand-in server (opencode-stand.mjs) with two folders — its own and
// another — as observed on OpenCode 2.0.24 (graph @nks/nks-dev, nodes #6686,
// #5048): the event stream is one for the server; a folder gets an instance of
// the plugin per spelling; the shell tool is called `shell`; write carries
// `path`.
//
// ISKRON_RITUAL_SAMPLES (path-delimited markdown files) points the probe at any
// copy (a past revision) so it can be shown red before a fix.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { REPO } from "./built.mjs";
import { memoryPath, ritualSample, settle, standServer, toolCall } from "./opencode-stand.mjs";

const sources = process.env.ISKRON_RITUAL_SAMPLES?.split(delimiter) ?? [
  join(REPO, "skills", "iskronify", "references", "harness-surfaces.md"),
];

const pushed = "To github.com:o/r.git\n   1234567..89abcde  feat/x -> feat/x";

// The stand hands out event.subscribe as the types do (an AsyncIterable, not a
// Promise): a plugin that does not await it is not red here.
test("opencode stand: a subscriber that does not await subscribe() is greeted", async () => {
  const s = await standServer(`export default { id: "n", async setup(ctx) {
    const it = ctx.event.subscribe({})[Symbol.asyncIterator]();
    (async () => { for (;;) { const { value: ev, done } = await it.next(); if (done) break;
      await ctx.session.prompt({ sessionID: ev.data.sessionID, text: "hi" });
    } })();
  } };`);
  await s.instance(s.own);
  await s.create("mine", s.own);
  assert.equal(s.greeted("mine"), 1);
});

test("opencode stand: the temp folder is as it was after the process", () => {
  const tmp = mkdtempSync(join(tmpdir(), "opencode-stand-tmp-"));
  const stand = pathToFileURL(join(REPO, "js", "tests", "opencode-stand.mjs")).href;
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { standServer } = await import(${JSON.stringify(stand)});
       const s = await standServer('export default { id: "x", async setup() {} };');
       await s.instance(s.own); await s.stop();`,
    ],
    { encoding: "utf8", env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp } },
  );
  assert.equal(r.status, 0, r.stderr);
  try {
    assert.deepEqual(readdirSync(tmp), []);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

for (const md of sources) {
  const source = ritualSample(md);
  const name = (what) => `opencode rituals sample: ${what}${sources.length > 1 ? ` (${md})` : ""}`;

  test(name("(а) a root session of another folder gets no greeting"), async () => {
    const s = await standServer(source);
    await s.instance(s.own);
    await s.create("theirs", s.foreign);
    await s.create("mine", s.own);
    await s.stop();
    assert.equal(s.greeted("theirs"), 0);
    assert.equal(s.greeted("mine"), 1, "its own root session is greeted");
  });

  // iskronify fills the greeting from the AGENTS.md frontmatter: the sample shows
  // which slots, as an explicit template, not a stub.
  test(name("the greeting is a template of the AGENTS.md frontmatter addresses"), async () => {
    const s = await standServer(source);
    await s.instance(s.own);
    await s.create("mine", s.own);
    await s.stop();
    const [text = ""] = s.words("mine");
    for (const slot of ["<Граф>", "<Фокус-контур>", "<Роль агента>", "<Роль владельца>"])
      assert.ok(text.includes(slot), `the greeting names ${slot}: ${text}`);
    assert.match(text, /«Старт»/);
  });

  test(name("(б) its own folder under another spelling is greeted"), async () => {
    const s = await standServer(source);
    await s.instance(s.own);
    await s.create("mine", s.alias);
    await s.stop();
    assert.equal(s.greeted("mine"), 1);
  });

  test(name("(в) a child session (parentID) gets no greeting"), async () => {
    const s = await standServer(source);
    await s.instance(s.own);
    await s.create("root", s.own);
    await s.create("child", s.own, "root");
    await s.stop();
    assert.equal(s.greeted("child"), 0);
    assert.equal(s.greeted("root"), 1);
  });

  test(name("(г) a prompt that throws leaves the loop alive"), async () => {
    const s = await standServer(source);
    await s.instance(s.own);
    s.failing.add("gone");
    await s.create("gone", s.own);
    await s.create("next", s.own);
    await s.stop();
    assert.equal(s.greeted("next"), 1);
  });

  test(
    name("(д) guard: own memory refused, own file passes, a foreign session untouched"),
    async () => {
      const s = await standServer(source);
      const p = await s.instance(s.own);
      s.sessions.set("mine", { dir: s.own });
      s.sessions.set("theirs", { dir: s.foreign });
      await assert.rejects(
        p.call("execute.before", toolCall("write", "mine", { filePath: memoryPath, content: "x" })),
        (e) => !["ReferenceError", "TypeError"].includes(e?.name),
      );
      await p.call("execute.before", toolCall("write", "mine", { filePath: join(s.own, "a.md") }));
      await p.call("execute.before", toolCall("write", "theirs", { filePath: memoryPath }));
      await s.stop();
    },
  );

  // patch (2.0.24) carries its paths inside patchText, one header per file.
  test(
    name("guard reads patch: own memory refused, own file passes, a foreign session untouched"),
    async () => {
      const s = await standServer(source);
      const p = await s.instance(s.own);
      s.sessions.set("mine", { dir: s.own });
      s.sessions.set("theirs", { dir: s.foreign });
      const patch = (...headers) => ({
        patchText: ["*** Begin Patch", ...headers.flatMap((h) => [h, "+x"]), "*** End Patch"].join(
          "\n",
        ),
      });
      const intoMemory = [
        patch(`*** Add File: ${memoryPath}`),
        patch(`*** Update File: ${join(s.own, "a.md")}`, `*** Update File: ${memoryPath}`),
        patch(`*** Delete File: ${memoryPath}`),
        patch(`*** Update File: ${join(s.own, "a.md")}\n*** Move to: ${memoryPath}`),
      ];
      for (const tool of ["patch", "apply_patch"])
        for (const input of intoMemory)
          await assert.rejects(
            p.call("execute.before", toolCall(tool, "mine", input)),
            (e) => !["ReferenceError", "TypeError"].includes(e?.name),
            `${tool}: ${input.patchText}`,
          );
      await p.call(
        "execute.before",
        toolCall("patch", "mine", patch(`*** Add File: ${join(s.own, "a.md")}`)),
      );
      for (const input of intoMemory)
        await p.call("execute.before", toolCall("patch", "theirs", input));
      await s.stop();
    },
  );

  // The guard judges the path, not the string: a link to a memory folder,
  // `/./` and `//` in the path do not get past it.
  test(name("guard sees through a link, /./ and //"), async () => {
    const s = await standServer(source);
    const p = await s.instance(s.own);
    s.sessions.set("mine", { dir: s.own });
    const mem = join(s.own, ".claude", "projects", "p", "memory");
    mkdirSync(mem, { recursive: true });
    symlinkSync(mem, join(s.own, "link"), "dir");
    for (const path of [
      `${join(s.own, "link")}/MEMORY.md`,
      `${homedir()}/.claude/./projects/-stand/memory/MEMORY.md`,
      `${homedir()}/.claude//projects/-stand/memory/MEMORY.md`,
      "link/MEMORY.md",
    ])
      await assert.rejects(
        p.call("execute.before", toolCall("write", "mine", { path, content: "x" })),
        (e) => !["ReferenceError", "TypeError"].includes(e?.name),
        path,
      );
    await p.call("execute.before", toolCall("write", "mine", { path: "notes.md", content: "x" }));
    await s.stop();
  });

  // A link to a file not yet written is judged by its target; a chain past 8
  // hops or a cycle is not resolved — the guard refuses (closed on failure).
  test(name("guard follows a dangling link; a long chain or a cycle is refused"), async () => {
    const s = await standServer(source);
    const p = await s.instance(s.own);
    s.sessions.set("mine", { dir: s.own });
    const mem = join(s.own, ".claude", "projects", "x", "memory");
    mkdirSync(mem, { recursive: true });
    const at = (...names) => join(s.own, "links", ...names);
    mkdirSync(at(), { recursive: true });
    symlinkSync(join(mem, "new.md"), at("dangling"));
    symlinkSync(join(mem, "sub"), at("dangling-dir"));
    for (let i = 0; i < 9; i++)
      symlinkSync(i === 8 ? join(mem, "new.md") : at(`l${i + 1}`), at(`l${i}`));
    symlinkSync(at("b"), at("a"));
    symlinkSync(at("a"), at("b"));
    symlinkSync(join(s.own, "safe", "new.md"), at("safe"));
    const passed = [];
    for (const path of [at("dangling"), at("dangling-dir", "f.md"), at("l0"), at("a")])
      await p.call("execute.before", toolCall("write", "mine", { path, content: "x" })).then(
        () => passed.push(path),
        (e) => assert.ok(!["ReferenceError", "TypeError"].includes(e?.name), e),
      );
    assert.deepEqual(passed, [], "each is refused");
    await p.call("execute.before", toolCall("write", "mine", { path: at("safe"), content: "x" }));
    await s.stop();
  });

  test(name("(е) two instances of one folder under two spellings greet once"), async () => {
    const s = await standServer(source);
    await s.instance(s.own);
    await s.instance(s.alias);
    await s.create("mine", s.own);
    await settle(100);
    await s.stop();
    assert.equal(s.greeted("mine"), 1);
  });

  test(name("(ж) the push reminder wakes on `shell`; the guard reads write's `path`"), async () => {
    const s = await standServer(source);
    const p = await s.instance(s.own);
    s.sessions.set("mine", { dir: s.own });
    const input = toolCall(
      "shell",
      "mine",
      { command: "git push -u origin feat/x" },
      { content: pushed, metadata: { exit: 0 } },
    );
    await p.call("execute.after", input);
    assert.match(String(input.result.content), /пуш/);
    await assert.rejects(
      p.call("execute.before", toolCall("write", "mine", { path: memoryPath, content: "x" })),
      (e) => !["ReferenceError", "TypeError"].includes(e?.name),
    );
    await s.stop();
  });
}
