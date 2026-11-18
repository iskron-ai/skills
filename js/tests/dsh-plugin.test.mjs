// Behavioural probe for the dsh hearing plugin shipped in
// skills/establish-mcp/references/dsh-plugin/index.js (graph @nks/nks-dev, node #10776):
// the bundle is an ordinary module exporting apply(ctx); the probe drives it with a
// stand-in dsh context and a stand-in standing socket — the same NDJSON a bridge door
// serves a local client. The seam is the environment the plugin resolves at apply time
// (the auth dir with its standings), so each test gets its own sandbox.
//
// The seat rule (stage 3, the review of 6719db4a): only the hold record the MCP bridge
// of THIS session wrote — dsh's handshake client name, this working directory, `at` no
// earlier than the plugin's start, not left. Another session's seat (the machine's only
// key, a same-cwd record of another harness) is not taken; the own seat is waited for
// within the attach window.
//
// ISKRON_DSH_PLUGIN points the probe at any copy (a past revision, a broken one) so it
// can be shown red before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { CLIENTS } from "../delivery/index.ts";
import { FRAME_MARK } from "../delivery/protocol.ts";
import {
  holdFilePathOf,
  keyFilePathOf,
  seenFilePathOf,
  socketPathOf,
} from "../shared/standings.ts";
import { BUILT } from "./built.mjs";
import { addressed, directWord } from "./room-frames.mjs";

const SOURCE =
  process.env.ISKRON_DSH_PLUGIN ||
  join(BUILT, "skills", "establish-mcp", "references", "dsh-plugin", "index.js");
const PLUGIN = (await import(`${SOURCE}?probe`)).apply;

process.env.ISKRON_BRIDGE_LANG = "ru";

// What dsh puts into clientInfo.name of its MCP initialize handshake — observed live
// on 0.2.2-rc.1 (case 5251, stage 3); the bridge writes it as the hold record's
// `client`. The probe holds it here so it names the surface, not the source tree.
const DSH_MCP_CLIENT = "dsh-mcp-client";

const KEY = "proba--931--r5";
const OTHER = "sosed--48--r5";
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return fn();
};
/** A short attach window, so a deaf outcome does not wait a minute. */
const shortWindow = (t, ms = "400") => {
  const was = process.env.ISKRON_WATCHDOG_ATTACH_MS;
  process.env.ISKRON_WATCHDOG_ATTACH_MS = ms;
  t.after(() => {
    if (was === undefined) delete process.env.ISKRON_WATCHDOG_ATTACH_MS;
    else process.env.ISKRON_WATCHDOG_ATTACH_MS = was;
  });
};

/**
 * A hold record as the session's own bridge writes it: the dsh MCP handshake client
 * name, this working directory, written now. `over` spoofs another harness's or an
 * earlier session's record.
 */
const holdRecord = (over = {}) =>
  JSON.stringify({
    realm: "@nks/nks-dev",
    karta: 931,
    name: "proba",
    url: "https://example.invalid/",
    at: Date.now(),
    cwd: process.cwd(),
    client: DSH_MCP_CLIENT,
    ...over,
  });

/**
 * A sandbox with its own grant directory, standing key files and a live socket door of
 * KEY. Hold records are written by the tests themselves after apply: a record written
 * before the plugin started is another session's.
 */
async function sandbox(keys = [KEY]) {
  const dir = mkdtempSync(join(tmpdir(), "iskron-dsh-"));
  const authDir = join(dir, "auth");
  mkdirSync(join(authDir, "standings"), { recursive: true });
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  for (const k of keys) writeFileSync(keyFilePathOf(authDir, k), k + "\n");
  const server = createServer();
  const conns = new Set();
  server.on("connection", (sock) => {
    conns.add(sock);
    sock.on("close", () => conns.delete(sock));
  });
  await new Promise((r) => server.listen(socketPathOf(authDir, KEY), r));
  return {
    authDir,
    conns,
    send: (ev) => {
      for (const s of conns) s.write(JSON.stringify(ev) + "\n");
    },
    writeHold: (key = KEY, over = {}) =>
      writeFileSync(holdFilePathOf(authDir, key), holdRecord(over) + "\n"),
    async close() {
      for (const s of conns) s.destroy();
      await new Promise((r) => server.close(r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// The stand-in dsh context: a registry of listeners, a logger line store, one agent.
function dsh(logs, sent, reenterFirst = 0) {
  const handlers = new Map();
  let calls = 0;
  const agent = {
    session: { id: "session-dsh-1" },
    followup: (m) => {
      // The live dsh store rejects an append fired from inside a publish cycle.
      if (calls++ < reenterFirst) {
        throw new Error("session append cannot reenter while another append is being published");
      }
      sent.push(m);
      return undefined;
    },
  };
  return {
    agent,
    emit: (name, ...args) => handlers.get(name)?.(...args),
    ctx: {
      on: (name, fn) => handlers.set(name, fn),
      logger: { info: (t) => logs.push(String(t)) },
    },
  };
}

test("an addressed frame reaches the session as exactly one next-turn message", async (t) => {
  const box = await sandbox();
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  box.writeHold();
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => box.conns.size === 1));
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  assert(await until(() => logs.some((l) => l.includes("слушаю стояние"))));
  const frame = directWord("direct-1");
  box.send({ kind: "frame", frame, raw: JSON.stringify(frame) });
  assert(await until(() => sent.length === 1));
  const m = sent[0];
  assert.equal(m.role, "user");
  assert.equal(m.source.kind, "dsh-iskron");
  assert.match(String(m.id), /^[\da-f-]{36}$/);
  assert.ok(m.content[0].text.startsWith(FRAME_MARK));
  assert.ok(m.content[0].text.includes("прямое слово соседа"));
  // A repeat of the delivered frame and a word addressed to another seat wake no turn.
  box.send({ kind: "frame", frame, raw: JSON.stringify(frame) });
  const away = addressed(31);
  box.send({ kind: "frame", frame: away, raw: JSON.stringify(away) });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sent.length, 1);
  const seen = readFileSync(seenFilePathOf(box.authDir, KEY), "utf8").split("\n");
  assert.ok(seen.includes("direct-1"));
});

test("a disposed session detaches and nothing more is sent", async (t) => {
  const box = await sandbox();
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  box.writeHold();
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => box.conns.size === 1));
  d.emit("session/disposed");
  assert(await until(() => box.conns.size === 0));
  box.send({ kind: "frame", frame: directWord("late-1"), raw: "{}" }); // nobody listens
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.length, 0);
});

test("another harness's only seat on the machine is not this session's", async (t) => {
  shortWindow(t);
  const box = await sandbox();
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  // The only key on the machine, alive, in this directory — but another client's.
  box.writeHold(KEY, { client: CLIENTS.opencode });
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("не встало"))));
  box.send({ kind: "frame", frame: directWord("alien-1"), raw: "{}" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 0); // its frames are not this session's
  assert.equal(box.conns.size, 0);
});

test("a record written before the plugin started is not this session's", async (t) => {
  shortWindow(t);
  const box = await sandbox();
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  box.writeHold(KEY, { at: Date.now() - 60_000 }); // an earlier session of any client
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("не встало"))));
  box.send({ kind: "frame", frame: directWord("old-1"), raw: "{}" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 0);
  assert.equal(box.conns.size, 0);
});

test("a left seat of this directory and client is not taken", async (t) => {
  shortWindow(t);
  const box = await sandbox();
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  box.writeHold(KEY, { left: true });
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("не встало"))));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 0);
  assert.equal(box.conns.size, 0);
});

test("no own seat appears in the window: one loud line, no hearing", async (t) => {
  shortWindow(t);
  const box = await sandbox([]); // not one standing on the machine
  await box.close();
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("не встало"))));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.length, 0);
});

test("the own seat stands after the window: said once, still picked up, frames flow", async (t) => {
  // The model takes the seat on its own first turn — often later than the window.
  shortWindow(t);
  const box = await sandbox([]);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("не встало"))));
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(keyFilePathOf(box.authDir, KEY), KEY + "\n");
  box.writeHold();
  assert(await until(() => box.conns.size === 1, 12000));
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  box.send({ kind: "frame", frame: directWord("after-window-1"), raw: "{}" });
  assert(await until(() => sent.length === 1, 8000));
  assert.equal(logs.filter((l) => l.includes("не встало")).length, 1);
});

test("the own seat appears after agent/created: the window picks it up, frames flow", async (t) => {
  // The bridge of this session takes its place later than agent/created (the review of
  // 6719db4a): until then there is not even a key file to mistake for an own seat.
  const box = await sandbox([]);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(box.conns.size, 0); // deaf while the seat is not there
  writeFileSync(keyFilePathOf(box.authDir, KEY), KEY + "\n");
  box.writeHold();
  assert(await until(() => box.conns.size === 1, 8000));
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  box.send({ kind: "frame", frame: directWord("late-seat-1"), raw: "{}" });
  assert(await until(() => sent.length === 1, 8000));
  assert.ok(sent[0].content[0].text.includes("прямое слово соседа"));
});

test("two seats claim the session: one loud line, no guessing", async (t) => {
  shortWindow(t);
  const box = await sandbox([KEY, OTHER]);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  box.writeHold(KEY);
  writeFileSync(
    holdFilePathOf(box.authDir, OTHER),
    holdRecord({ karta: 48, name: "sosed" }) + "\n",
  );
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("слуха нет") && l.includes(","))));
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 0);
  assert.equal(box.conns.size, 0);
});

test("compaction/end returns the role by the hold record, bare without one", async (t) => {
  const box = await sandbox([KEY]);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent, 1); // the first word meets the store mid-publish (live: reenter)
  PLUGIN(d.ctx);
  box.writeHold();
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => box.conns.size === 1));
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  assert(await until(() => logs.some((l) => l.includes("слушаю стояние"))));
  d.emit("session/event", { id: "session-dsh-1" }, { type: "compaction/end", turn: 3 });
  assert(await until(() => sent.length === 1));
  const word = sent[0].content[0].text;
  assert.ok(word.includes("контекст сжат"));
  assert.ok(word.includes("#931"));
  assert.ok(word.includes("proba"));
  // A failed compaction kept the context: no word.
  d.emit(
    "session/event",
    { id: "session-dsh-1" },
    { type: "compaction/end", turn: 4, error: "window" },
  );
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.length, 1);
});

test("compaction without a hold record returns the bare word", async (t) => {
  const box = await sandbox([KEY]);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  box.writeHold();
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => box.conns.size === 1));
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  assert(await until(() => logs.some((l) => l.includes("слушаю стояние"))));
  // The record is gone by compaction time: the word is bare.
  rmSync(holdFilePathOf(box.authDir, KEY), { force: true });
  d.emit("session/event", { id: "session-dsh-1" }, { type: "compaction/end", turn: 2 });
  assert(await until(() => sent.length === 1));
  const word = sent[0].content[0].text;
  assert.ok(word.includes("контекст сжат"));
  assert.ok(!word.includes("#931"));
});

// dsh's subagent tool spawns the child inside the same process, and the plugin hears its
// agent/created (observed live on LAB, dsh 0.2.2-rc.1, #11071). The child's payload form is NOT
// observed: its session header — parentSession, origin "subagent", delegationDepth — is read from
// the types of the installed @deepseek-ai/dsh-session 0.2.2-rc.1 (SessionHeader in types.d.ts);
// source "startup" for the child is assumed (SessionStartSource, dsh-agent runtime-types.d.ts).
// The header-less variant stands for a child whose header says nothing.
const SUBAGENT_HEADER = { parentSession: "session-dsh-1", origin: "subagent", delegationDepth: 1 };
for (const [name, header] of [
  ["its session header names the parent", SUBAGENT_HEADER],
  ["a fresh agent while the root lives", undefined],
])
  test(`a subagent spawned in the process does not take the root's hearing: ${name}`, async (t) => {
    const box = await sandbox();
    t.after(() => box.close());
    const logs = [];
    const sent = [];
    const d = dsh(logs, sent);
    PLUGIN(d.ctx);
    box.writeHold();
    d.emit("agent/created", { agent: d.agent, source: "startup" });
    assert(await until(() => box.conns.size === 1));
    box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
    assert(await until(() => logs.some((l) => l.includes("слушаю стояние"))));
    const toSub = [];
    const sub = {
      session: { id: "session-dsh-sub", ...(header ? { header } : {}) },
      followup: (m) => void toSub.push(m),
    };
    d.emit("agent/created", { agent: sub, source: "startup" });
    const frame = directWord("direct-sub");
    box.send({ kind: "frame", frame, raw: JSON.stringify(frame) });
    assert(await until(() => sent.length === 1), "the frame reaches the root");
    assert.equal(toSub.length, 0, "the subagent hears nothing of the root's seat");
    // The subagent's session ends; the root's lives on and still hears.
    d.emit("session/disposed", sub.session);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(box.conns.size, 1, "the root's hearing stays attached");
    const next = directWord("direct-after");
    box.send({ kind: "frame", frame: next, raw: JSON.stringify(next) });
    assert(await until(() => sent.length === 2));
    assert.equal(toSub.length, 0);
  });
