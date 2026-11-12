// Behavioural probe for the turn's end on a watch in the OpenCode plugin (turnend.ts, graph
// @nks/nks-dev, node #9342): a turn a frame of the channel started, with no human word, that
// ended with text and no ask, say or send, gets one wake word queued into the session; the turn
// that word wakes does not get it again; a turn that spoke, a human's turn and a child's turn get
// none. Fake bridge, stand-in context (opencode-kit.mjs); ISKRON_OPENCODE_PLUGIN aims it at any copy.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { staleBatch } from "../shared/stalebatch.ts";
import { delay, plugin, SANDBOX, until } from "./opencode-kit.mjs";
import { COVER, repo } from "./rites-kit.mjs";
import { ask, progress, said as roomSaid } from "./room-frames.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");
const WAKE = /человека в консоли нет/;

const event = (kind, extra) =>
  JSON.stringify({ kind, ...(kind === "held" ? { automatic: false } : {}), ...extra }) + "\n";
const frame = (body) => ({
  type: "message",
  id: `msg-${body}`,
  body,
  provenance: { from_standing: "@alari:telegram-bot", from_karta_seq: 1226, auth: "pat" },
});

/** The plugin over the fake bridge, session `s` seated; `say(body)` lays a frame and waits for its prompt. */
async function seated(name, s, ctxOpts = {}, dir = "/work/t") {
  const log = join(SANDBOX, `${name}.log`);
  const events = join(SANDBOX, `${name}.events`);
  const reply = join(SANDBOX, `${name}.reply`);
  for (const f of [log, events, reply]) writeFileSync(f, "");
  const rec = await plugin(
    { ISKRON_BRIDGE_PATH: FAKE_BRIDGE, FB_LOG: log, FB_REPLY: reply, FB_EVENTS: events },
    { sessions: [{ id: s, location: { directory: dir } }], ...ctxOpts },
  );
  await until(() => rec.tools().size === 3, "the server's tools", 8000);
  await rec.call("iskron_channel", { action: "connect" }, s);
  const pid = Number(readFileSync(log, "utf8").trim().split("\n")[0].split(/\s+/)[1]);
  const mine = `${events}.${pid}`;
  appendFileSync(mine, event("held", { key: `${name}--931--nks-dev` }));
  await until(() => rec.said().includes(`мост держит место ${name}--931--nks-dev`), "held");
  const say = async (body) => {
    const n = rec.prompts.length;
    appendFileSync(mine, event("frame", { frame: frame(body), raw: "" }));
    await until(() => rec.prompts.length > n, `the frame ${body} prompted`);
  };
  return { rec, say, lay: (line) => appendFileSync(mine, line) };
}

const emit = (rec, type, sessionID, data = {}) => rec.emit({ type, data: { sessionID, ...data } });
/** A turn: started, the inbox items it takes, a call per `calls` (tool hook), its text, succeeded. */
async function turn(
  rec,
  s,
  { take = [], calls = [], text = "отчёт?", end = "session.execution.succeeded" } = {},
) {
  emit(rec, "session.execution.started", s);
  for (const inboxID of take) emit(rec, "session.inbox.delivered", s, { inboxID });
  for (const [tool, input] of calls)
    for (const cb of rec.hooks["tool.execute.after"] ?? [])
      await cb({ tool, sessionID: s, id: `c-${tool}`, status: "completed", input, result: {} });
  if (text) emit(rec, "session.text.ended", s, { text });
  emit(rec, end, s);
  await delay(150);
}
const wakes = (rec, s) => rec.prompts.filter((p) => p.sessionID === s && WAKE.test(p.text));

test("a frame's turn ending with text and no word laid: one wake word, none for the turn it wakes", async () => {
  const { rec, say } = await seated("turn-lost", "s-t");
  try {
    await say("вопрос владельцу");
    await turn(rec, "s-t");
    const w = wakes(rec, "s-t");
    assert.equal(w.length, 1, JSON.stringify(rec.prompts));
    assert.equal(w[0].marked, true, "under the delivery's mark");
    assert.equal(w[0].delivery, "queue");
    assert.match(w[0].text, /ask/);
    assert.match(w[0].text, /iskron_case line/);
    assert.match(w[0].text, /say с to/);
    await turn(rec, "s-t", { text: "всё ещё в консоль?" });
    assert.equal(wakes(rec, "s-t").length, 1, "the woken turn is not woken again");
    emit(rec, "session.idle", "s-t");
    await delay(100);
    assert.equal(wakes(rec, "s-t").length, 1, "the deprecated idle after the end adds none");
    await say("ещё кадр");
    await turn(rec, "s-t");
    assert.equal(wakes(rec, "s-t").length, 2, "the next frame's turn is judged afresh");
  } finally {
    await rec.stop();
  }
});

test("a frame taken by its inbox item: judged by session.inbox.delivered", async () => {
  const { rec, say } = await seated("turn-inbox", "s-i", { inboxIds: true });
  try {
    emit(rec, "session.execution.started", "s-i");
    await say("кадр");
    emit(rec, "session.execution.succeeded", "s-i");
    await delay(100);
    assert.equal(wakes(rec, "s-i").length, 0, "a frame not yet taken is no frame's turn");
    emit(rec, "session.inbox.delivered", "s-i", { inboxID: "inbox-1" });
    await turn(rec, "s-i");
    assert.equal(wakes(rec, "s-i").length, 1);
  } finally {
    await rec.stop();
  }
});

test("a frame taken before its prompt's answer named the item is still the turn's frame", async () => {
  let answer = null;
  const promptWait = (id) => (answer ? undefined : new Promise((r) => (answer = { id, r })));
  const { rec, say } = await seated("turn-early", "s-e", {
    inboxIds: true,
    faults: { promptWait },
  });
  try {
    emit(rec, "session.execution.started", "s-e");
    await say("кадр");
    emit(rec, "session.inbox.delivered", "s-e", { inboxID: answer.id });
    await delay(50);
    answer.r();
    await delay(50);
    emit(rec, "session.text.ended", "s-e", { text: "в консоль?" });
    emit(rec, "session.execution.succeeded", "s-e");
    await delay(150);
    assert.equal(wakes(rec, "s-e").length, 1, JSON.stringify(rec.prompts));
  } finally {
    await rec.stop();
  }
});

test("the turn the wake word's own item starts is exempt, not the next one: a waiting frame is woken", async () => {
  const { rec, say } = await seated("turn-own", "s-o", { inboxIds: true });
  const idOf = (p) => `inbox-${rec.prompts.indexOf(p) + 1}`;
  try {
    emit(rec, "session.execution.started", "s-o");
    await say("кадр A");
    emit(rec, "session.inbox.delivered", "s-o", { inboxID: "inbox-1" });
    await say("кадр B"); // queued behind A's turn, before the wake word
    emit(rec, "session.text.ended", "s-o", { text: "A в консоль?" });
    emit(rec, "session.execution.succeeded", "s-o");
    await delay(150);
    const [first] = wakes(rec, "s-o");
    assert.ok(first, "A's turn is woken");
    await turn(rec, "s-o", { take: ["inbox-2"], text: "B в консоль?" });
    const w = wakes(rec, "s-o");
    assert.equal(w.length, 2, "B's turn, taken before the wake word, is judged and woken");
    await say("кадр C");
    const c = `inbox-${rec.prompts.length}`;
    await turn(rec, "s-o", { take: [idOf(first), c], text: "всё ещё в консоль?" });
    assert.equal(wakes(rec, "s-o").length, 2, "the turn A's wake word started is exempt");
    await turn(rec, "s-o", { take: [idOf(w[1])], text: "и снова?" });
    assert.equal(wakes(rec, "s-o").length, 2, "B's wake word's turn wakes none");
  } finally {
    await rec.stop();
  }
});

test("the cover's rituals field without `turn` keeps the word silent; with it, it speaks", async () => {
  const field = (rituals) => COVER.replace("  stamp:", `  rituals:${rituals}\n  stamp:`);
  for (const [rituals, n] of [
    [" start push", 0],
    [" start turn", 1],
  ]) {
    const dir = repo({ agents: field(rituals) });
    const { rec, say } = await seated(`turn-field-${n}`, `s-f${n}`, {}, dir);
    try {
      await say("кадр");
      await turn(rec, `s-f${n}`);
      assert.equal(wakes(rec, `s-f${n}`).length, n, rituals);
    } finally {
      await rec.stop();
    }
  }
});

test("no wake word: the turn spoke, a human spoke, it ended without text or failed", async () => {
  const { rec, say } = await seated("turn-quiet", "s-q");
  try {
    for (const input of [
      { action: "ask", room: "1" },
      { action: "say", room: "1" },
      { action: "answer", room: "1" },
      { action: "line", room: "1", key: "probe", done: "Проверил", verdict: "ok" },
    ]) {
      await say(`кадр ${input.action}`);
      await turn(rec, "s-q", { calls: [["iskron_case", input]] });
    }
    await say("кадр send");
    await turn(rec, "s-q", { calls: [["iskron_channel", { action: "send", karta: "1226" }]] });
    await say("побудка о живости");
    await turn(rec, "s-q", { calls: [["iskron_stand", { realm: "r5", status: "жду ревью" }]] });
    await say("кадр без текста");
    await turn(rec, "s-q", { text: "" });
    await say("кадр, текст до вызова");
    emit(rec, "session.execution.started", "s-q");
    emit(rec, "session.text.ended", "s-q", { text: "смотрю" });
    await delay(50); // the text is streamed before the call it precedes is made
    for (const cb of rec.hooks["tool.execute.after"] ?? [])
      await cb({ tool: "read", sessionID: "s-q", id: "r", status: "completed", input: {} });
    emit(rec, "session.execution.succeeded", "s-q");
    await delay(100);
    await say("кадр, ход прерван");
    await turn(rec, "s-q", { end: "session.execution.interrupted" });
    await say("кадр, read не говорит");
    await turn(rec, "s-q", { calls: [["iskron_case", { action: "read", room: "1" }]] });
    assert.equal(wakes(rec, "s-q").length, 1, "only the turn whose case call laid no word");
    await say("кадр человеку");
    await rec.promptRaw("s-q", "а что у тебя?");
    await turn(rec, "s-q");
    assert.equal(wakes(rec, "s-q").length, 1, "a human's word in the turn");
  } finally {
    await rec.stop();
  }
});

// Case №2730 [6]: a console the owner sits at, woken after every service frame answered by a line.
test("no wake word (#9345): a human wrote lately, a short line with no question, counts only", async () => {
  const { rec, say, lay } = await seated("turn-calm", "s-c");
  const stale = async (frames) => {
    const n = rec.prompts.length;
    const { text, keys } = staleBatch(frames, () => false);
    lay(event("stale", { frames, marks: keys, text }));
    await until(() => rec.prompts.length > n, "the stale batch prompted");
  };
  try {
    await say("кадр, квитанция");
    await turn(rec, "s-c", { text: "принял, жду CI" });
    assert.equal(wakes(rec, "s-c").length, 0, "a short line with no question");
    await say("кадр, длинный отчёт");
    await turn(rec, "s-c", { text: `Отчёт: ${"сделано, проверено. ".repeat(20)}` });
    assert.equal(wakes(rec, "s-c").length, 1, "past 280 characters it is a lost word");
    await stale([roomSaid("defer", 61), progress(62)]);
    await turn(rec, "s-c");
    assert.equal(wakes(rec, "s-c").length, 1, "a stale batch of counts only");
    await stale([roomSaid("defer", 63), ask(80)]);
    await turn(rec, "s-c");
    assert.equal(wakes(rec, "s-c").length, 2, "a stale batch with a question to the seat");
    await rec.promptRaw("s-c", "я тут");
    await turn(rec, "s-c", { text: "" });
    await say("кадр после слова человека");
    await turn(rec, "s-c");
    assert.equal(wakes(rec, "s-c").length, 2, "a human wrote in the session minutes ago");
  } finally {
    await rec.stop();
  }
});
