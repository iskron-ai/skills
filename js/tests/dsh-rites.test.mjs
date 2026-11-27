// Behavioural probe for the push and merge lines of the dsh plugin (graph @nks/nks-dev, node
// #11071): after a call of dsh's shell tool that pushed or merged, the line OpenCode and Claude
// Code get from the delivery reaches the live session as one next-turn message — by the same
// outcome rule (a visible refusal vetoes, a quiet push is judged by git's state, a push of tags
// only says nothing; a repeated push into an open PR gets one line, #11443). The waterfall's
// decision passes through unchanged.
//
// The form of the mocks is NOT observed live. Source: the types and code of the installed
// @deepseek-ai/dsh 0.2.2-rc.1 — `tools/post-execute(exec, result, next)` in
// dsh-tools/lib/types/events.d.ts (a waterfall: the listener returns next()'s decision),
// ToolExecution and ToolExecutionResult in dsh-tools/lib/types/contracts.d.ts, the bash tool's
// name "bash", its arguments.command and its foreground value (kind, cwd, exitCode, stdout.text,
// stderr.text) in dsh-tool-bash/lib/index.js (canonicalBashResult); the event names besides by the
// docs (#10657). agent.send(message, "next-turn", true) is the surface observed on 0.2.2-rc.1 (#10776).
//
// ISKRON_DSH_PLUGIN points the probe at any copy (a past revision) so it can be shown red
// before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { FRAME_MARK } from "../delivery/index.ts";
import { BUILT } from "./built.mjs";

const SOURCE =
  process.env.ISKRON_DSH_PLUGIN ||
  join(BUILT, "skills", "establish-mcp", "references", "dsh-plugin", "index.js");
const PLUGIN = (await import(`${SOURCE}?rites`)).apply;

process.env.ISKRON_BRIDGE_LANG = "ru";

const COVER =
  "---\niskron:\n  graph: r7\n  holon: 12\n  agent_role: 34\n  contract: 44\n---\n# x\n";
/** git's report of a first push (the branch is new on the remote) — and of a repeated one. */
const PUSHED = "To github.com:o/r.git\n * [new branch]      feat/x -> feat/x";
const AGAIN = "To github.com:o/r.git\n   a1b2c3d..e4f5a6b  feat/x -> feat/x";
const PUSH_WORD = /пуш — не отгрузка\. Исполни/;
const AGAIN_WORD = /повторный пуш — не отгрузка: по дельте — самопроверка и ревью по AGENTS\.md\./;
const MERGE_WORD = /мерж: .*контур #12/;

/** A repository with the cover (null — none), the process standing in it; git — a real one on
 * main whose HEAD equals its push ref, so a quiet push there has landed. */
function repo(t, { cover = COVER, git = false } = {}) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "iskron-dsh-rites-")));
  const g = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "ignore" });
  if (git) {
    const origin = join(dir, "..", `${dir.split("/").pop()}-origin`);
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
    g("init", "-q", "-b", "main");
    g("-c", "user.email=p@x", "-c", "user.name=p", "commit", "-q", "--allow-empty", "-m", "a");
    g("remote", "add", "origin", origin);
    g("push", "-q", "-u", "origin", "main");
    t.after(() => rmSync(origin, { recursive: true, force: true }));
  } else mkdirSync(join(dir, ".git"));
  if (cover) writeFileSync(join(dir, "AGENTS.md"), cover);
  mkdirSync(join(dir, "auth", "standings"), { recursive: true });
  const was = { cwd: process.cwd(), auth: process.env.ISKRON_BRIDGE_AUTH_DIR };
  process.env.ISKRON_BRIDGE_AUTH_DIR = join(dir, "auth");
  process.chdir(dir);
  t.after(() => {
    process.chdir(was.cwd);
    if (was.auth === undefined) delete process.env.ISKRON_BRIDGE_AUTH_DIR;
    else process.env.ISKRON_BRIDGE_AUTH_DIR = was.auth;
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** The stand-in dsh: listeners, one agent recording what was sent to it and how. */
function dsh(t) {
  const handlers = new Map();
  const sent = [];
  const agent = {
    session: { id: "session-dsh-rites" },
    send: (m, target, wakeup) => void sent.push({ m, target, wakeup }),
    ctx: { systemPrompt: { section: () => {} } },
  };
  PLUGIN({ on: (name, fn) => handlers.set(name, fn), logger: { info: () => {} } });
  t.after(() => handlers.get("session/disposed")?.());
  handlers.get("agent/created")?.({ agent, source: "startup" });
  /** One finished bash call through the waterfall; returns the decision it passed on. */
  const call = async (
    command,
    { stderr = "", stdout = "", exitCode = 0, name = "bash", isError = false } = {},
  ) => {
    const exec = { callId: "c1", rootCallId: "c1", name, arguments: { command }, agent };
    const text = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`;
    const result = {
      isError,
      value: {
        kind: "foreground",
        cwd: process.cwd(),
        exitCode,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: 120000,
        stdout: { text: stdout, truncated: false },
        stderr: { text: stderr, truncated: false },
      },
      content: [{ type: "text", text }],
    };
    const decision = { kind: "accept" };
    const fn = handlers.get("tools/post-execute");
    const out = fn ? await fn(exec, result, async () => decision) : decision;
    await new Promise((r) => setTimeout(r, 60)); // the line goes after the publish cycle
    return out;
  };
  return { sent, call };
}

const texts = (sent) => sent.map((s) => s.m.content[0].text);

test("a branch's push: the push line as one next-turn message; the decision passes", async (t) => {
  repo(t);
  const d = dsh(t);
  const decision = await d.call("git push -u origin feat/x", { stderr: PUSHED });
  assert.deepEqual(decision, { kind: "accept" });
  assert.equal(d.sent.length, 1);
  assert.equal(d.sent[0].target, "next-turn");
  const [text] = texts(d.sent);
  // Exactly one mark: the line starts with the mark and a word, not with the mark twice
  // (observed live on LAB: «[iskron] [iskron] пуш…», #11071).
  assert.ok(text.startsWith(`${FRAME_MARK} `), text);
  assert.ok(!text.slice(FRAME_MARK.length).trimStart().startsWith(FRAME_MARK), text);
  assert.match(text, PUSH_WORD);
  assert.doesNotMatch(text, MERGE_WORD);
});

test("a repeated push into an open PR: one line, not the full push word", async (t) => {
  repo(t);
  const d = dsh(t);
  await d.call("git push origin feat/x", { stderr: AGAIN });
  assert.equal(d.sent.length, 1);
  const [text] = texts(d.sent);
  assert.ok(text.startsWith(`${FRAME_MARK} `), text);
  assert.match(text, AGAIN_WORD);
  assert.doesNotMatch(text, /Исполни самопроверку/);
  assert.doesNotMatch(text, MERGE_WORD);
});

test("a forge's merge by its outcome: the merge line", async (t) => {
  repo(t);
  const d = dsh(t);
  await d.call("gh pr merge 7 --squash", { stdout: "✓ Squashed and merged pull request #7" });
  assert.equal(d.sent.length, 1);
  assert.match(texts(d.sent)[0], MERGE_WORD);
  assert.equal(texts(d.sent)[0].split(FRAME_MARK).length, 2, "one mark");
});

test("a quiet push to the trunk is judged by git's state: the merge line", async (t) => {
  repo(t, { git: true });
  const d = dsh(t);
  await d.call("git push -q origin main");
  assert.equal(d.sent.length, 1);
  assert.match(texts(d.sent)[0], MERGE_WORD);
});

test("a visible refusal, a push of tags only, help and --auto wake nothing", async (t) => {
  repo(t);
  const d = dsh(t);
  await d.call("git push origin feat/x", {
    stderr: "To github.com:o/r.git\n ! [rejected]        feat/x -> feat/x (fetch first)",
    exitCode: 1,
  });
  await d.call("git push origin v1.0", {
    stderr: "To github.com:o/r.git\n * [new tag]         v1.0 -> v1.0",
  });
  await d.call("gh pr merge --help", { stdout: "Usage: gh pr merge" });
  await d.call("gh pr merge 7 --auto --squash", { stdout: "Pull request will be merged" });
  assert.deepEqual(texts(d.sent), []);
});

test("no cover — silence", async (t) => {
  repo(t, { cover: null });
  const bare = dsh(t);
  await bare.call("git push -u origin feat/x", { stderr: PUSHED });
  assert.equal(bare.sent.length, 0);
});

test("another tool and a failed call — silence", async (t) => {
  repo(t);
  const d = dsh(t);
  await d.call("git push -u origin feat/x", { stderr: PUSHED, name: "read_file" });
  await d.call("git push -u origin feat/x", { stderr: PUSHED, isError: true });
  assert.equal(d.sent.length, 0);
});
