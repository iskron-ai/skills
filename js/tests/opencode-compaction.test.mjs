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
import { fileURLToPath, pathToFileURL } from "node:url";

import { BUILT_PLUGIN } from "./built.mjs";
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

// Expose the unminified bundle's real factory on a sandbox copy. Only the doors are
// substituted: the production slice catches network errors, so rejection needs this seam.
const factoryCopy = join(SANDBOX, "compaction-doors.mjs");
writeFileSync(
  factoryCopy,
  readFileSync(process.env.ISKRON_OPENCODE_PLUGIN || BUILT_PLUGIN, "utf8") +
    "\nexport { createCompaction };\n",
);
const { createCompaction } = await import(pathToFileURL(factoryCopy).href);
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function recovery(slice = () => null) {
  const state = { place: PLACE, closed: false, said: [] };
  const c = createCompaction({
    placeOf: () => state.place,
    closed: () => state.closed,
    slice,
    say: (text) => state.said.push(text),
  });
  const req = () => ({ sessionID: "recovery", system: [] });
  c.instruct(req());
  return { c, state, req, text: (r) => r.system.map((p) => p.text).join("\n") };
}

test("pending recovery survives a temporarily missing seat", async () => {
  const { c, state, req, text } = recovery();
  state.place = null;
  const missing = req();
  await c.tell(missing);
  assert.equal(text(missing), "");
  state.place = PLACE;
  const back = req();
  await c.tell(back);
  assert.equal(words(text(back)), 1);
  const again = req();
  await c.tell(again);
  assert.equal(text(again), "");
});

test("a rejected slice leaves no partial system and retries with a fresh read", async () => {
  const first = deferred();
  let reads = 0;
  const { c, req, text } = recovery(() =>
    ++reads === 1 ? first.promise : Promise.resolve("RULES"),
  );
  const failed = req();
  const attempt = c.tell(failed);
  first.reject(new Error("slice refused"));
  await assert.rejects(attempt, /slice refused/);
  assert.equal(text(failed), "");
  const retry = req();
  await c.tell(retry);
  assert.equal(reads, 2);
  assert.equal(words(text(retry)), 1);
  assert.match(text(retry), /RULES/);
  const again = req();
  await c.tell(again);
  assert.equal(text(again), "");
});

for (const cancel of ["failed", "forget", "stop"]) {
  test(`${cancel} during slice wait cancels the pending generation`, async () => {
    const rules = deferred();
    const { c, state, req, text } = recovery(() => rules.promise);
    const waiting = req();
    const attempt = c.tell(waiting);
    if (cancel === "failed")
      c.onEvent({ type: "session.compaction.failed", data: { sessionID: "recovery" } });
    else if (cancel === "forget") c.forget("recovery");
    else state.closed = true;
    rules.resolve("RULES");
    await attempt;
    assert.equal(text(waiting), "");
    assert.deepEqual(state.said, []);
    state.closed = false;
    const again = req();
    await c.tell(again);
    assert.equal(text(again), "");
  });
}

test("concurrent contexts commit a complete role and slice once", async () => {
  const rules = deferred();
  const { c, req, text } = recovery(() => rules.promise);
  const a = req();
  const b = req();
  const attempts = [c.tell(a), c.tell(b)];
  assert.equal(text(a), "", "no partial role while the slice is pending");
  assert.equal(text(b), "");
  rules.resolve("RULES");
  await Promise.all(attempts);
  assert.equal(words(text(a)) + words(text(b)), 1);
  assert.match(text(a) || text(b), /RULES/);
  const again = req();
  await c.tell(again);
  assert.equal(text(again), "");
});

test("seat loss during slice wait defers the complete return", async () => {
  const rules = deferred();
  const { c, state, req, text } = recovery(() => rules.promise);
  const waiting = req();
  const attempt = c.tell(waiting);
  state.place = null;
  rules.resolve("RULES");
  await attempt;
  assert.equal(text(waiting), "");
  state.place = PLACE;
  const retry = req();
  await c.tell(retry);
  assert.equal(words(text(retry)), 1);
  assert.match(text(retry), /RULES/);
});

test("a cancelled generation cannot consume a new compaction's return", async () => {
  const old = deferred();
  let reads = 0;
  const { c, req, text } = recovery(() => (++reads === 1 ? old.promise : Promise.resolve("NEW")));
  const waiting = req();
  const attempt = c.tell(waiting);
  c.forget("recovery");
  c.instruct(req());
  old.resolve("OLD");
  await attempt;
  assert.equal(text(waiting), "");
  const next = req();
  await c.tell(next);
  assert.equal(words(text(next)), 1);
  assert.match(text(next), /NEW/);
  assert.doesNotMatch(text(next), /OLD/);
});

test("a seated session: the first request after the compaction carries one word in its system, the compaction request none", async () => {
  const { rec, events, pids } = await standUp("compact-seated", ["s-c"]);
  try {
    await holds(rec, events, pids[0], "k-c");
    assert.equal(words(await system(rec, "context", "s-c")), 0, "no compaction — no word");
    const order = await system(rec, "compaction", "s-c");
    assert.match(order, /сохрани в сводке роль #931/, order);
    assert.match(order, /host\.repo\.opus-5/);
    assert.match(order, /номера живых дел, ожидания/);
    assert.match(order, /наказ на первый ход: загрузить iskron и названные им скиллы роли/);
    assert.equal(words(order), 0, "the compaction request itself gets no role word");
    // The compaction request may be retried (an unfilled template): still one word.
    await system(rec, "compaction", "s-c");
    rec.emit(compactionEvent("session.compaction.ended", "s-c", "evt-1", 10));
    const first = await system(rec, "context", "s-c");
    assert.equal(words(first), 1, first);
    assert.match(first, /Роль #931, граф @nks\/nks-dev, место host\.repo\.opus-5/);
    assert.match(first, /держит мост — заново не занимай/);
    assert.match(first, /До работы загрузи iskron и названные им скиллы роли/);
    assert.match(
      first,
      /факты-основания сводки перечитай в графе через recall/,
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

test("stop then held before context cancels only the stopped session's generation", async () => {
  const { rec, events, pids } = await standUp("compact-stop-return", ["s-return", "s-live"]);
  try {
    await holds(rec, events, pids[0], "k-return");
    await holds(rec, events, pids[1], "k-live");
    await system(rec, "compaction", "s-return");
    await system(rec, "compaction", "s-live");
    appendFileSync(
      `${events}.${pids[0]}`,
      event("stopped", { code: 4001, key: "k-return", text: "STOP_RECOVERY" }),
    );
    await until(() => rec.interrupts.length === 1, "the stop's interrupt");
    await holds(rec, events, pids[0], "k-return-again");
    assert.equal(
      words(await system(rec, "context", "s-return")),
      0,
      "old generation stays cancelled",
    );
    assert.equal(
      words(await system(rec, "context", "s-live")),
      1,
      "the live neighbour keeps its return",
    );
    await system(rec, "compaction", "s-return");
    assert.equal(words(await system(rec, "context", "s-return")), 1, "a new generation can return");
  } finally {
    await rec.stop();
  }
});

test("the stop callback is safe before the compaction factory is initialized", async () => {
  const copy = join(SANDBOX, "iskron.js");
  const original = readFileSync(copy, "utf8");
  const at = "const compaction = createCompaction({";
  assert.ok(original.includes(at), "the unminified bundle retains the initialization seam");
  // Invoke the real registered cancellation closure at its earliest active initialization gap.
  // No other production statement changes; the sandbox copy is restored before the next test.
  writeFileSync(copy, original.replace(at, `cancelContext();\n  ${at}`));
  let rec;
  try {
    ({ rec } = await standUp("compact-early-stop", []));
    assert.ok(rec.hooks.context?.length, "setup reached context registration without a TDZ error");
    assert.doesNotMatch(rec.said(), /before initialization|ReferenceError/);
  } finally {
    await rec?.stop();
    writeFileSync(copy, original);
  }
});
