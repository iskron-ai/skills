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
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { REPO } from "./built.mjs";
import { memoryPath, ritualSample, settle, standServer, toolCall } from "./opencode-stand.mjs";

const sources = process.env.ISKRON_RITUAL_SAMPLES?.split(delimiter) ?? [
  join(REPO, "skills", "iskronify", "references", "harness-surfaces.md"),
];

const pushed = "To github.com:o/r.git\n   1234567..89abcde  feat/x -> feat/x";

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
