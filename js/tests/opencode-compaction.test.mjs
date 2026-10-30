// Behavioural probe for the OpenCode plugin: a compacted session keeps its role (compaction.ts).
// The "compaction" hook's system gets the summary's order; the FIRST "context" request after it
// gets one word about the role in its system — not the compaction request, not an inbox word,
// once per compaction, none after session.compaction.failed, only for a session whose bridge
// holds a seat, none for a stopped one. Fake bridge, stand-in context (opencode-kit.mjs);
// ISKRON_OPENCODE_PLUGIN aims it at any copy.
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

/** A request as OpenCode's `hook` gets it ("compaction" or "context"); returns its system text. */
async function system(rec, hook, sessionID) {
  const req = { sessionID, system: [], messages: [], tools: {}, options: {} };
  for (const cb of rec.hooks[hook] ?? []) await cb(req);
  return req.system.map((p) => p.text).join("\n");
}

const compactionEvent = (type, sessionID, id, seq) => ({
  type,
  id,
  data: { sessionID, text: "summary", reason: "auto", recent: "" },
  durable: { aggregateID: sessionID, seq, version: 1 },
});

const words = (text) => text.split("контекст сжат").length - 1;
const inboxWords = (rec, s) =>
  rec.synthetics.filter((x) => x.sessionID === s && ROLE_WORD.test(x.text));

test("a seated session: the first request after the compaction carries one word in its system, the compaction request none", async () => {
  const { rec, events, pids } = await standUp("compact-seated", ["s-c"]);
  try {
    await holds(rec, events, pids[0], "k-c");
    assert.equal(words(await system(rec, "context", "s-c")), 0, "no compaction — no word");
    const order = await system(rec, "compaction", "s-c");
    assert.match(order, /сводка этого сжатия обязана сохранить роль агента #931/, order);
    assert.match(order, /host\.repo\.opus-5/);
    assert.match(order, /живые дела/);
    assert.match(order, /перечитать дверь/);
    assert.equal(words(order), 0, "the compaction request itself gets no role word");
    // The compaction request may be retried (an unfilled template): still one word.
    await system(rec, "compaction", "s-c");
    rec.emit(compactionEvent("session.compaction.ended", "s-c", "evt-1", 10));
    const first = await system(rec, "context", "s-c");
    assert.equal(words(first), 1, first);
    assert.match(first, /роль #931 в графе @nks\/nks-dev, место host\.repo\.opus-5/);
    assert.match(first, /До первого содержательного хода загрузи дверь/);
    assert.match(
      first,
      /Сводка — указатель, не запись.*recall/,
      "the summary is not a source: recall",
    );
    assert.equal(
      words(await system(rec, "context", "s-c")),
      0,
      "the next request — no second word",
    );
    await delay(200);
    assert.deepEqual(inboxWords(rec, "s-c"), [], "no inbox word: it would arrive a step late");
    // A new compaction — one more word.
    await system(rec, "compaction", "s-c");
    assert.equal(
      words(await system(rec, "context", "s-c")),
      1,
      "the word after the second compaction",
    );
  } finally {
    await rec.stop();
  }
});

test("a failed compaction leaves no word for the next request", async () => {
  const { rec, events, pids } = await standUp("compact-failed", ["s-f"]);
  try {
    await holds(rec, events, pids[0], "k-f");
    await system(rec, "compaction", "s-f");
    rec.emit(compactionEvent("session.compaction.failed", "s-f", "evt-f", 5));
    await delay(200);
    assert.equal(words(await system(rec, "context", "s-f")), 0, "failed — no word");
  } finally {
    await rec.stop();
  }
});

test("a session without a seat gets neither the order nor the word; a seated one beside it does", async () => {
  const { rec, events, pids } = await standUp("compact-unseated", ["s-seat", "s-bare"]);
  try {
    await holds(rec, events, pids[0], "k-seat");
    assert.equal(await system(rec, "compaction", "s-bare"), "", "no seat — no order");
    await system(rec, "compaction", "s-seat");
    assert.equal(words(await system(rec, "context", "s-bare")), 0, "no seat — no word");
    assert.equal(words(await system(rec, "context", "s-seat")), 1, "the seated session's word");
  } finally {
    await rec.stop();
  }
});

test("a session stopped by its owner gets neither the order nor the word after its stop", async () => {
  const { rec, events, pids } = await standUp("compact-stopped", ["s-stop"]);
  try {
    await holds(rec, events, pids[0], "k-stop");
    await system(rec, "compaction", "s-stop");
    const text = "место proba снято (человеком) — ты остановлен: работу кончи, место не занимай";
    appendFileSync(`${events}.${pids[0]}`, event("stopped", { code: 4001, key: "k-stop", text }));
    await until(() => rec.interrupts.length === 1, "the stop's interrupt");
    assert.equal(
      words(await system(rec, "context", "s-stop")),
      0,
      "stopped between compaction and request — no word",
    );
    assert.doesNotMatch(await system(rec, "compaction", "s-stop"), /сводка этого сжатия/);
    assert.equal(
      words(await system(rec, "context", "s-stop")),
      0,
      "a stopped session gets no word",
    );
  } finally {
    await rec.stop();
  }
});
