// Одно событие — один раз в ход, текстом или числом (граф nks-dev: #6563, #5842, решение
// стюарда #931): копия, чьё событие вошло текстом, не предлагается и не считается — в
// пачках моста, в стопке своей сессии OpenCode, в свёртке pi. Чужую сессию OpenCode кадр
// инбокса не трогает. Исходники импортируются напрямую (Node снимает типы).
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Backlog } from "../bridge/backlog.ts";
import { marksOf, redundantCopy } from "../bridge/fanout.ts";
import { RoomBatch } from "../bridge/roomstack.ts";
import { StaleBurst } from "../bridge/stale.ts";
import { deliveryKeys } from "../shared/seen.ts";
import { graphPosed, progress } from "./room-frames.mjs";

process.env.ISKRON_OPENCODE_BATCH_MS = "50";
process.env.ISKRON_PI_ASIDE_MS = "50";
const { setupChannel: opencodeChannel } = await import("../opencode/channel.ts");
const { setupChannel: piChannel } = await import("../extension/channel.ts");

const caseCopy = () => ({ ...progress(60), event_id: 5 });
const inbox = () => graphPosed("g-5", 5);
const frameEv = (f) => ({ data: { kind: "frame", frame: f, raw: JSON.stringify(f) } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const door = () => {
  const d = {
    ring: [],
    seen: new Set(),
    seenPath: join(mkdtempSync(join(tmpdir(), "iskron-evcopy-")), "x.seen"),
  };
  const has = marksOf(d.seen, d.seenPath);
  return { ...d, stale: new StaleBurst(has), roomBatch: new RoomBatch(has) };
};
const none = () => false;

// Копия инбокса, ждущая в пачке лежалых, ещё не вошла текстом: копия дела идёт своим
// путём и не считается, когда текст события уже помечен внёсшим его (решение стюарда #931).
test("a live case copy beside a waiting stale inbox copy goes on, and is not counted once the inbox copy is marked shown", () => {
  const d = door();
  const stale = { ...inbox(), stale: true };
  assert.equal(redundantCopy(stale, d), false);
  d.stale.note(stale, () => {});
  const copy = caseCopy();
  assert.equal(redundantCopy(copy, d), false);
  const out = [];
  d.roomBatch.add(JSON.stringify(copy), copy, (ev) => out.push(ev));
  for (const k of deliveryKeys(stale)) d.seen.add(k); // сторож напечатал пачку лежалых
  d.roomBatch.flushNow();
  assert.deepEqual(out, [], "the case copy of a shown event was counted");
  d.stale.drop();
});

test("a live case copy dies after the stale inbox copy of its event was shown in a burst, not after it was counted", () => {
  const shown = door();
  for (const k of deliveryKeys({ ...inbox(), stale: true })) shown.seen.add(k);
  assert.equal(redundantCopy(caseCopy(), shown), true);
  assert.equal(redundantCopy(inbox(), shown), false, "a live inbox copy still wakes");
  const counted = door();
  for (const k of deliveryKeys({ ...inbox(), stale: true }, true)) counted.seen.add(k);
  assert.equal(
    redundantCopy(caseCopy(), counted),
    false,
    "a counted inbox copy keeps the case copy",
  );
  assert.equal(redundantCopy({ ...inbox(), id: "g-6", stale: true }, counted), true);
});

const opencode = () =>
  opencodeChannel(
    { session: { get: async () => ({}), prompt: async () => ({ id: "in-1" }) } },
    () => {},
    () => "A",
  );

test("OpenCode: an inbox frame of another session leaves this session's case copy counted", async () => {
  const ch = opencode();
  ch.onEvent("A", frameEv(caseCopy()));
  ch.onEvent("B", frameEv(inbox()));
  await pause(300);
  assert.match(ch.ride("A") ?? "", /записей 1/);
});

for (const kind of ["backlog", "stale"])
  test(`OpenCode: an inbox frame inside a ${kind} batch takes its case copy out of the pile`, async () => {
    const ch = opencode();
    ch.onEvent("A", frameEv(caseCopy()));
    const frames = [inbox()];
    ch.onEvent("A", { data: { kind, text: "пачка", frames, marks: deliveryKeys(inbox()) } });
    await pause(300);
    assert.equal(ch.ride("A"), null);
  });

// Слово человека в деле входит текстом — и его событие тоже: копия инбокса того же
// события второй раз текстом не входит (находка второго круга, №1).
test("a case record that went in as text marks its event: the inbox copy of it is not offered", () => {
  const d = door();
  const c = caseCopy();
  const word = { ...c, provenance: { ...c.provenance, as_person: true } };
  for (const k of deliveryKeys(word)) d.seen.add(k);
  assert.equal(redundantCopy(inbox(), d), true);
});

// Копия дела за пределом показанных, чья копия инбокса показана пачкой текстом, — не в
// «не вошло»: событие делатель уже прочёл, а шапка послала бы его в history за ним.
const pastCut = (extra = {}) => [
  { ...inbox(), ...extra },
  ...Array.from({ length: 19 }, (_, i) => ({ ...graphPosed(`o-${i}`, 100 + i), ...extra })),
  { ...caseCopy(), ...extra },
];

test("a wake-up batch does not count past its cut a case copy whose inbox copy it shows", () => {
  const b = new Backlog(none);
  let text = "";
  b.open(0, (ev) => (text = ev.text));
  for (const f of pastCut()) b.note(f);
  b.flushNow();
  assert.match(text, /Побудка: кадров 20/, text);
  assert.doesNotMatch(text, /не вошло/, text);
});

test("a stale burst does not count past its cut a case copy whose inbox copy it shows", async () => {
  const s = new StaleBurst(none);
  let got = null;
  for (const f of pastCut({ stale: true })) s.note(f, (ev) => (got = ev));
  await pause(1700);
  assert.ok(got, "the burst went out");
  assert.match(got.text, /Лежалых кадров: 20/, got.text);
  assert.doesNotMatch(got.text, /не вошло/, got.text);
  assert.ok(got.marks?.includes("room-msg-60"), "the absorbed copy is still marked handed out");
});

// «кадров N» — событий, дошедших текстом или числом, каждое один раз: копия дела, чьё
// событие пачка показала текстом, кадром не считается и внутри показанных.
test("a wake-up batch with an inbox frame and its case copy says one frame", () => {
  const b = new Backlog(none);
  let text = "";
  b.open(0, (ev) => (text = ev.text));
  b.note(inbox());
  b.note(caseCopy());
  b.flushNow();
  assert.match(text, /Побудка: кадров 1 /, text);
});

test("a stale burst with an inbox frame and its case copy says one frame", async () => {
  const s = new StaleBurst(none);
  let got = null;
  for (const f of [
    { ...inbox(), stale: true },
    { ...caseCopy(), stale: true },
  ])
    s.note(f, (ev) => (got = ev));
  await pause(1700);
  assert.match(got?.text ?? "", /Лежалых кадров: 1 /, got?.text);
  assert.ok(got.marks?.includes("room-msg-60"), "the absorbed copy is marked handed out");
});

// Поглощённая копия освобождает место показанного: двадцатым входит следующий кадр.
test("a wake-up batch shows twenty frames past the case copies it absorbs", () => {
  const b = new Backlog(none);
  let ev = null;
  b.open(0, (e) => (ev = e));
  b.note(inbox());
  b.note(caseCopy());
  for (let i = 0; i < 19; i++) b.note(graphPosed(`o-${i}`, 100 + i));
  b.flushNow();
  assert.equal(ev.frames.length, 20);
  assert.match(ev.text, /Побудка: кадров 20 /, ev.text);
  assert.doesNotMatch(ev.text, /не вошло/, ev.text);
});

test("pi: an inbox frame inside a backlog batch takes its case copy out of the aside", async () => {
  const sent = [];
  const deliver = piChannel({ on: () => {}, sendMessage: (m) => sent.push(m.content) });
  deliver(frameEv(caseCopy()));
  deliver({
    data: { kind: "backlog", text: "пачка", frames: [inbox()], marks: deliveryKeys(inbox()) },
  });
  await pause(300);
  assert.deepEqual(sent, ["пачка"]);
});
