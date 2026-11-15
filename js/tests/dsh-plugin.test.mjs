// Behavioural probe for the dsh hearing plugin shipped in
// skills/establish-mcp/references/dsh-plugin/index.js (graph @nks/nks-dev, node #10776):
// the bundle is an ordinary module exporting apply(ctx); the probe drives it with a
// stand-in dsh context and a stand-in standing socket — the same NDJSON a bridge door
// serves a local client. The seam is the environment the plugin resolves at apply time
// (the auth dir with its standings), so each test gets its own sandbox.
//
// ISKRON_DSH_PLUGIN points the probe at any copy (a past revision, a broken one) so it
// can be shown red before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

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

/** A live hold record of this working directory, at the key's own path. */
const holdRecord = () =>
  JSON.stringify({
    realm: "@nks/nks-dev",
    karta: 931,
    name: "proba",
    url: "https://example.invalid/",
    at: Date.now(),
    cwd: process.cwd(),
  });

/** A sandbox with its own grant directory, standing key files and a live socket door of KEY. */
async function sandbox(keys = [KEY], hold = false) {
  const dir = mkdtempSync(join(tmpdir(), "iskron-dsh-"));
  const authDir = join(dir, "auth");
  mkdirSync(join(authDir, "standings"), { recursive: true });
  process.env.ISKRON_BRIDGE_AUTH_DIR = authDir;
  for (const k of keys) writeFileSync(keyFilePathOf(authDir, k), k + "\n");
  if (hold) writeFileSync(holdFilePathOf(authDir, KEY), holdRecord() + "\n");
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
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => box.conns.size === 1));
  d.emit("session/disposed");
  assert(await until(() => box.conns.size === 0));
  box.send({ kind: "frame", frame: directWord("late-1"), raw: "{}" }); // nobody listens
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.length, 0);
});

test("no standing held: one loud line, no hearing", async () => {
  const box = await sandbox([]);
  await box.close();
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("слуха нет"))));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.length, 0);
});

test("several standings: the hold record of this directory names the one", async (t) => {
  const box = await sandbox([KEY, OTHER], true);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => box.conns.size === 1)); // the socket of KEY, not OTHER
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  box.send({ kind: "frame", frame: directWord("multi-1"), raw: "{}" });
  assert(await until(() => sent.length === 1));
  assert.ok(sent[0].content[0].text.includes("прямое слово соседа"));
});

test("several standings and none of this directory: one loud line, no hearing", async (t) => {
  const box = await sandbox([KEY, OTHER]);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent);
  PLUGIN(d.ctx);
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => logs.some((l) => l.includes("слуха нет") && l.includes(","))));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sent.length, 0);
  assert.equal(box.conns.size, 0);
});

test("compaction/end returns the role by the hold record, bare without one", async (t) => {
  const box = await sandbox([KEY], true);
  t.after(() => box.close());
  const logs = [];
  const sent = [];
  const d = dsh(logs, sent, 1); // the first word meets the store mid-publish (live: reenter)
  PLUGIN(d.ctx);
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
  d.emit("agent/created", { agent: d.agent, source: "startup" });
  assert(await until(() => box.conns.size === 1));
  box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
  assert(await until(() => logs.some((l) => l.includes("слушаю стояние"))));
  d.emit("session/event", { id: "session-dsh-1" }, { type: "compaction/end", turn: 2 });
  assert(await until(() => sent.length === 1));
  const word = sent[0].content[0].text;
  assert.ok(word.includes("контекст сжат"));
  assert.ok(!word.includes("#931"));
});
