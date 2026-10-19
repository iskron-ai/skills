// Behavioural probe for the OpenCode plugin: a compacted session keeps its role (compaction.ts).
// The "compaction" hook's system gets the summary's order, the event session.compaction.ended
// lays one word into the session — only for a session whose bridge holds a seat, once per
// compaction, none for a stopped one; a failed delivery is a log line. Fake bridge, stand-in
// context (opencode-kit.mjs); ISKRON_OPENCODE_PLUGIN aims it at any copy.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { delay, plugin, SANDBOX, until } from "./opencode-kit.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");
const PLACE = { realm: "@nks/nks-dev", karta: "931", name: "host.repo.opus-5" };
const ROLE_WORD = /контекст сжат/;

const event = (kind, extra) =>
  JSON.stringify({ kind, ...(kind === "held" ? { automatic: false } : {}), ...extra }) + "\n";

/** The plugin over the fake bridge; `sessions` call connect, each on its own bridge. */
async function standUp(name, sessions) {
  const log = join(SANDBOX, `${name}.log`);
  const events = join(SANDBOX, `${name}.events`);
  const reply = join(SANDBOX, `${name}.reply`);
  for (const f of [log, events, reply]) writeFileSync(f, "");
  const rec = await plugin({
    ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
    FB_LOG: log,
    FB_REPLY: reply,
    FB_EVENTS: events,
  });
  await until(() => rec.tools().size === 3, "the server's tools", 8000);
  for (const s of sessions) await rec.call("iskron_channel", { action: "connect" }, s);
  const pids = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((l) => Number(l.split(/\s+/)[1]));
  return { rec, events, pids };
}

/** The session's bridge said «held» with its seat. */
async function holds(rec, events, pid, key) {
  appendFileSync(`${events}.${pid}`, event("held", { key, place: PLACE }));
  await until(() => rec.said().includes(`мост держит стояние ${key}`), `held ${key}`);
}

/** The compaction request as OpenCode's "compaction" hook gets it; returns its system text. */
async function compactionSystem(rec, sessionID) {
  const req = { sessionID, system: [], messages: [], tools: {}, options: {} };
  for (const cb of rec.hooks.compaction ?? []) await cb(req);
  return req.system.map((p) => p.text).join("\n");
}

const ended = (sessionID, id, seq) => ({
  type: "session.compaction.ended",
  id,
  data: { sessionID, text: "summary", reason: "auto", recent: "" },
  durable: { aggregateID: sessionID, seq, version: 1 },
});

const roleWords = (rec, s) =>
  rec.synthetics.filter((x) => x.sessionID === s && ROLE_WORD.test(x.text));

test("a seated session: the compaction keeps the role, one word at its end, none on a repeat, one on the next", async () => {
  const { rec, events, pids } = await standUp("compact-seated", ["s-c"]);
  try {
    await holds(rec, events, pids[0], "k-c");
    const system = await compactionSystem(rec, "s-c");
    assert.match(system, /сводка этого сжатия обязана сохранить роль агента #931/, system);
    assert.match(system, /host\.repo\.opus-5/);
    assert.match(system, /живые дела/);
    assert.match(system, /перечитать дверь/);
    rec.emit(ended("s-c", "evt-1", 10));
    await until(() => roleWords(rec, "s-c").length === 1, "the role word after the compaction");
    const [w] = roleWords(rec, "s-c");
    assert.match(w.text, /роль #931 в графе @nks\/nks-dev, место host\.repo\.opus-5/);
    assert.match(w.text, /До первого содержательного хода загрузи дверь/);
    assert.equal(w.delivery, "steer");
    assert.equal(w.resume, false, "the word wakes no turn of its own");
    // (b) the same compaction's event again — no second word.
    rec.emit(ended("s-c", "evt-1", 10));
    await delay(200);
    assert.equal(roleWords(rec, "s-c").length, 1, "a repeat of the same compaction says nothing");
    // (c) a new compaction — one more word.
    rec.emit(ended("s-c", "evt-2", 20));
    await until(() => roleWords(rec, "s-c").length === 2, "the word after the second compaction");
  } finally {
    await rec.stop();
  }
});

test("a session without a seat gets neither the order nor the word; a seated one beside it does", async () => {
  const { rec, events, pids } = await standUp("compact-unseated", ["s-seat", "s-bare"]);
  try {
    await holds(rec, events, pids[0], "k-seat");
    assert.equal(await compactionSystem(rec, "s-bare"), "", "no seat — no order");
    rec.emit(ended("s-bare", "evt-b", 1));
    rec.emit(ended("s-seat", "evt-s", 1));
    await until(() => roleWords(rec, "s-seat").length === 1, "the seated session's word");
    await delay(200);
    assert.deepEqual(roleWords(rec, "s-bare"), [], "no seat — no word");
  } finally {
    await rec.stop();
  }
});

test("a session stopped by its owner gets neither the order nor the word after its stop", async () => {
  const { rec, events, pids } = await standUp("compact-stopped", ["s-stop"]);
  try {
    await holds(rec, events, pids[0], "k-stop");
    rec.emit(ended("s-stop", "evt-before", 1));
    await until(() => roleWords(rec, "s-stop").length === 1, "the word before the stop");
    const text = "место proba снято (человеком) — ты остановлен: работу кончи, место не занимай";
    appendFileSync(`${events}.${pids[0]}`, event("stopped", { code: 4001, key: "k-stop", text }));
    await until(() => rec.interrupts.length === 1, "the stop's interrupt");
    assert.doesNotMatch(await compactionSystem(rec, "s-stop"), /сводка этого сжатия/);
    rec.emit(ended("s-stop", "evt-after", 2));
    await delay(300);
    assert.equal(roleWords(rec, "s-stop").length, 1, "a stopped session gets no word");
  } finally {
    await rec.stop();
  }
});

test("a failed delivery is one log line — no throw, no retry", async () => {
  const { rec, events, pids } = await standUp("compact-fail", ["s-f"]);
  try {
    await holds(rec, events, pids[0], "k-f");
    let tries = 0;
    rec.ctx.session.synthetic = async () => {
      tries++;
      throw new Error("inbox refused");
    };
    rec.emit(ended("s-f", "evt-f", 1));
    await until(() => /не вложилось в s-f: inbox refused/.test(rec.said()), "the failure line");
    rec.emit(ended("s-f", "evt-f", 1));
    await delay(300);
    assert.equal(tries, 1, "one try, no retry");
    assert.equal(rec.said().match(/слово о роли после сжатия не вложилось/g).length, 1);
  } finally {
    await rec.stop();
  }
});
