// Behavioural probe for the turn's end of the dsh plugin (graph @nks/nks-dev, nodes #9342, #9345,
// #11071), the pattern of opencode-turnend.test.mjs: a turn a frame of the hearing entered, with
// no human word, that ended with a long text and laid no word where the human sees it, gets the
// wake word as one next-turn message; the turn the wake word itself entered does not repeat it.
//
// The session events' form is NOT observed live. Source: the types of the installed
// @deepseek-ai/dsh-session 0.2.2-rc.1 — SessionEvent {type, seq, time, data} and SessionEventMap
// in dsh-session/lib/types/types.d.ts: turn/start {turn}, turn/end {turn, reason: {kind}},
// user/message (a UserMessage {id, role, content, source}), assistant/message {message: {content
// with text and tool-call {id, name, arguments} blocks}}, tool/result {message: {toolCallId,
// isError}}; ContentBlock in dsh-llm/lib/types/types.d.ts; the event names besides by the docs
// (#10657). That a message the plugin sent comes back as user/message with the same id and content
// is assumed, not observed. The MCP tool name prefix mcp__iskron__ is observed (#10657).
//
// ISKRON_DSH_PLUGIN points the probe at any copy (a past revision) so it can be shown red
// before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { TURN } from "../delivery/index.ts";
import {
  holdFilePathOf,
  keyFilePathOf,
  seenFilePathOf,
  socketPathOf,
} from "../shared/standings.ts";
import { BUILT } from "./built.mjs";
import { directWord } from "./room-frames.mjs";

const SOURCE =
  process.env.ISKRON_DSH_PLUGIN ||
  join(BUILT, "skills", "establish-mcp", "references", "dsh-plugin", "index.js");
const PLUGIN = (await import(`${SOURCE}?turnend`)).apply;

process.env.ISKRON_BRIDGE_LANG = "ru";

const KEY = "proba--931--r5";
const SESSION = { id: "session-dsh-turn" };
const LONG = `${"Отчёт о сделанном, который никто не прочтёт в консоли. ".repeat(8)}Что дальше?`;
const until = async (fn, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fn();
};

/** A working directory (cover — its AGENTS.md in a repository) and a live standing socket. */
async function sandbox(t, cover) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "iskron-dsh-turn-")));
  const authDir = join(dir, "auth");
  mkdirSync(join(authDir, "standings"), { recursive: true });
  if (cover) {
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, "AGENTS.md"), cover);
  }
  const was = { cwd: process.cwd(), auth: process.env.ISKRON_BRIDGE_AUTH_DIR };
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  process.chdir(dir);
  writeFileSync(keyFilePathOf(authDir, KEY), KEY + "\n");
  const conns = new Set();
  const server = createServer((sock) => {
    conns.add(sock);
    sock.on("close", () => conns.delete(sock));
  });
  await new Promise((r) => server.listen(socketPathOf(authDir, KEY), r));
  t.after(async () => {
    for (const s of conns) s.destroy();
    await new Promise((r) => server.close(r));
    process.chdir(was.cwd);
    if (was.auth === undefined) delete process.env.ISKRON_BRIDGE_AUTH_DIR;
    else process.env.ISKRON_BRIDGE_AUTH_DIR = was.auth;
    rmSync(dir, { recursive: true, force: true });
  });
  return { authDir, conns, send: (ev) => conns.forEach((s) => s.write(JSON.stringify(ev) + "\n")) };
}

/** The plugin over a stand-in dsh, its root agent hearing the seat; sent — what reached it. */
async function hearingSession(t, cover, extra = {}) {
  const box = await sandbox(t, cover);
  const handlers = new Map();
  const logs = [];
  const sent = [];
  const agent = { session: SESSION, followup: (m) => void sent.push(m) };
  PLUGIN({
    on: (n, fn) => handlers.set(n, fn),
    logger: { info: (l) => logs.push(String(l)) },
    ...extra,
  });
  t.after(() => handlers.get("session/disposed")?.(SESSION));
  writeFileSync(
    holdFilePathOf(box.authDir, KEY),
    JSON.stringify({
      realm: "@nks/nks-dev",
      karta: 931,
      name: "proba",
      url: "https://example.invalid/",
      at: Date.now(),
      cwd: process.cwd(),
      client: "dsh-mcp-client",
    }) + "\n",
  );
  handlers.get("agent/created")?.({ agent, source: "startup" });
  assert(await until(() => box.conns.size === 1));
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  assert(await until(() => logs.some((l) => l.includes("слушаю стояние"))));
  let seq = 0;
  let turnNo = 0;
  const event = (type, data) =>
    handlers.get("session/event")?.(SESSION, { type, seq: ++seq, time: Date.now(), data });
  return {
    sent,
    /** A frame of the hearing: laid into the session as one message. */
    async frame(id) {
      const f = directWord(id);
      const before = sent.length;
      box.send({ kind: "frame", frame: f, raw: JSON.stringify(f) });
      assert(await until(() => sent.length === before + 1));
      return sent[before];
    },
    /** One turn: what entered it, the steps' assistant messages and results, how it ended. */
    async turn({ entered = [], steps = [], end = "completed" }) {
      const n = ++turnNo;
      event("turn/start", { turn: n });
      for (const m of entered) event("user/message", m);
      for (const s of steps) {
        // A step is the assistant message's blocks; an object — a tool call's result.
        if (!Array.isArray(s)) event("tool/result", { turn: n, step: 1, message: s });
        else
          event("assistant/message", {
            turn: n,
            step: 1,
            message: { role: "assistant", content: s },
          });
      }
      event("turn/end", { turn: n, reason: { kind: end } });
      await new Promise((r) => setTimeout(r, 80)); // the wake word goes after the publish cycle
    },
  };
}

const say = (id, action = "say") => ({
  type: "tool-call",
  id,
  name: "mcp__iskron__iskron_case",
  arguments: JSON.stringify({ action, room: "1" }),
});
const text = (t) => ({ type: "text", text: t });
const isWake = (m) => m.content[0].text === TURN.ru.wake();
const human = (t) => ({ id: "h1", role: "user", content: [text(t)], source: { kind: "user" } });

test("a frame's turn that lost its word in the console gets the wake word, once", async (t) => {
  const s = await hearingSession(t);
  const laid = await s.frame("turn-1");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.sent.length, 2);
  const wake = s.sent[1];
  assert.ok(isWake(wake), wake.content[0].text);
  // The turn the wake word itself entered ends with text too: no second word.
  await s.turn({ entered: [wake], steps: [[text(LONG)]] });
  assert.equal(s.sent.length, 2);
});

test("a word laid by a speaking call, a human's word, a receipt — no wake", async (t) => {
  const s = await hearingSession(t);
  let laid = await s.frame("turn-2");
  await s.turn({
    entered: [laid],
    steps: [[text("иду"), say("c1")], { toolCallId: "c1", isError: false }, [text(LONG)]],
  });
  laid = await s.frame("turn-3");
  await s.turn({ entered: [laid, human("как дела?")], steps: [[text(LONG)]] });
  laid = await s.frame("turn-3r");
  await s.turn({ entered: [laid], steps: [[text("готово")]] });
  assert.equal(s.sent.filter(isWake).length, 0);
});

test("a failed speaking call, an aborted turn, a turn without a frame", async (t) => {
  const s = await hearingSession(t);
  let laid = await s.frame("turn-4");
  await s.turn({
    entered: [laid],
    steps: [[say("c2")], { toolCallId: "c2", isError: true }, [text(LONG)]],
  });
  assert.equal(s.sent.filter(isWake).length, 1, "a speaking call that failed laid no word");
  laid = await s.frame("turn-5");
  await s.turn({ entered: [laid], steps: [[text(LONG)]], end: "aborted" });
  await s.turn({ steps: [[text(LONG)]] });
  assert.equal(s.sent.filter(isWake).length, 1);
});

test("a cover whose rituals leave the turn out keeps it silent", async (t) => {
  const cover =
    "---\niskron:\n  graph: r7\n  holon: 12\n  agent_role: 34\n  contract: 44\n  rituals: start push merge\n---\n# x\n";
  const s = await hearingSession(t, cover);
  const laid = await s.frame("turn-6");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.sent.filter(isWake).length, 0);
});

// A headless run has no human at the console by construction; the word after its turn is the
// orchestrator's continuation (#10995). Observed live on LAB (dsh 0.2.2-rc.1): a wake word after
// turn/end completed starts a turn the run disposes, and headless exits 1 (#11071). Its signs:
// the headless app's service `headlessStartup` through ctx.get(name, strict) — the form from the
// types of the installed @deepseek-ai/dsh-headless 0.2.2-rc.1 (startup.d.ts) and cordis
// (reflect.d.ts), NOT observed from a plugin; and the launcher profile in argv (`dsh headless …`,
// the orchestrator's own argv, bridge/orchestra-dsh.ts dshArgv; `--profile headless`).
const HEADLESS_SERVICE = { task: "brief", sessionId: undefined, json: true };
test("headless by its startup service: no send at all on turn/end", async (t) => {
  const s = await hearingSession(t, null, {
    get: (name) => (name === "headlessStartup" ? HEADLESS_SERVICE : undefined),
  });
  const laid = await s.frame("turn-7");
  const before = s.sent.length;
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.sent.length, before);
});

for (const argv of [
  ["headless", "--patch", "p.yml", "--json", "brief"],
  ["--patch", "p.yml", "--profile", "headless", "brief"],
])
  test(`headless by the launcher's profile in argv (${argv.join(" ")}): no send on turn/end`, async (t) => {
    const was = process.argv;
    process.argv = [was[0], "/opt/dsh/lib/bin.js", ...argv];
    t.after(() => (process.argv = was));
    const s = await hearingSession(t);
    const laid = await s.frame("turn-8");
    const before = s.sent.length;
    await s.turn({ entered: [laid], steps: [[text(LONG)]] });
    assert.equal(s.sent.length, before);
  });

test("another profile (web) keeps the wake word", async (t) => {
  const was = process.argv;
  process.argv = [was[0], "/opt/dsh/lib/bin.js", "web", "--port", "1"];
  t.after(() => (process.argv = was));
  const s = await hearingSession(t);
  const laid = await s.frame("turn-9");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.sent.filter(isWake).length, 1);
});
