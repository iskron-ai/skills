// A stand-in dsh session for the dsh plugin's turn probes (graph @nks/nks-dev, node #11071): a
// working directory with a live standing socket, the plugin applied over a stand-in Cordis ctx,
// and its root agent hearing the seat.
//
// The session events' form is NOT observed live. Source: the types of the installed
// @deepseek-ai/dsh-session 0.2.2-rc.1 — SessionEvent {type, seq, time, data} and SessionEventMap
// in dsh-session/lib/types/types.d.ts: turn/start {turn}, turn/end {turn, reason: {kind}},
// user/message (a UserMessage {id, role, content, source}), assistant/message {message: {content
// with text and tool-call {id, name, arguments} blocks}}, tool/result {message: {toolCallId,
// isError}}; ContentBlock in dsh-llm/lib/types/types.d.ts; the event names besides by the docs
// (#10657). That a message the plugin sent comes back as user/message with the same id and content
// is assumed, not observed. The MCP tool name prefix mcp__iskron__ is observed (#10657).
// Paths below without a package are of @deepseek-ai/dsh-agent-loop 0.2.2-rc.1.
//
// ISKRON_DSH_PLUGIN points the probes at any copy (a past revision) so they can be shown red
// before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const PLUGIN = (await import(`${SOURCE}?session`)).apply;

process.env.ISKRON_BRIDGE_LANG = "ru";

const KEY = "proba--931--r5";
const SESSION = { id: "session-dsh-turn" };
export const LONG = `${"Отчёт о сделанном, который никто не прочтёт в консоли. ".repeat(8)}Что дальше?`;
export const until = async (fn, ms = 4000) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fn();
};
export const text = (t) => ({ type: "text", text: t });
export const isWake = (m) => m.content[0].text === TURN.ru.wake();

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

/**
 * The stand-in root agent. Its maintenance is the form of lib/index.js:586-609 (contract
 * dsh-agent/lib/types/runtime-types.d.ts:192-201): one task at a time, else a synchronous throw;
 * the task gets an AbortSignal; a followup while it runs is latched and opens the next turn only
 * once it settles (index.js:634-639, 656-662) — observed live as turn 2, final completed, exit 0.
 * abortAtStart — the task's signal aborts at once (a SIGTERM cancel). inTask — the messages
 * followed up while a task ran.
 */
function standInAgent(sent, { abortAtStart = false } = {}) {
  const jobs = [];
  const inTask = new Set();
  let running = null;
  const agent = {
    session: SESSION,
    followup: (m) => {
      if (running) inTask.add(m);
      sent.push(m);
    },
    runMaintenance(job) {
      if (running) throw new Error('agent "root" already has active work');
      const rec = { ac: new AbortController(), settled: false };
      jobs.push((running = rec));
      const p = (async () => {
        try {
          return await job(rec.ac.signal);
        } finally {
          running = null;
          rec.settled = true;
        }
      })();
      if (abortAtStart) rec.ac.abort({ kind: "cancel" });
      return p;
    },
  };
  return { agent, jobs, inTask };
}

/** The plugin over a stand-in dsh, its root agent hearing the seat; sent — what reached it. */
export async function hearingSession(t, cover, extra = {}, opts = {}) {
  const box = await sandbox(t, cover);
  const handlers = new Map();
  const logs = [];
  const sent = [];
  const { agent, jobs, inTask } = standInAgent(sent, opts);
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
  // agent/status {agent, status} on a running↔idle change only (index.js:558-563): a task's phase
  // reads idle, so entering and leaving it emits nothing.
  const status = (s) => handlers.get("agent/status")?.({ agent, status: s });
  return {
    sent,
    jobs,
    inTask,
    /** The root's turn driver retired: agent/status idle. */
    idle: () => status("idle"),
    /** A frame of the hearing: laid into the session as one message. */
    async frame(id) {
      const f = directWord(id);
      const before = sent.length;
      box.send({ kind: "frame", frame: f, raw: JSON.stringify(f) });
      assert(await until(() => sent.length === before + 1));
      return sent[before];
    },
    /** One turn: what entered it, the steps' assistant messages and results, how it ended. */
    async turn({ entered = [], steps = [], end = "completed", idle = true }) {
      const n = ++turnNo;
      status("running");
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
      // turn/end is appended inside the turn; the driver goes idle after the turn returns, with
      // no macrotask between (index.js:818-829, 650-662).
      event("turn/end", { turn: n, reason: { kind: end } });
      if (idle) status("idle");
      await new Promise((r) => setTimeout(r, 80)); // the wake word goes after the publish cycle
    },
  };
}
