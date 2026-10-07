// Копия дела события (via=room, event_id конверта; граф nks-dev: #6563) гаснет только
// перед копией инбокса того же события, вошедшей в ход текстом (#5842, решение стюарда
// #931): в пачках моста, в стопке своей сессии OpenCode, в свёртке pi — живым кадром или
// показанным кадром пачки побудки и лежалых. Чужую сессию OpenCode кадр инбокса не трогает.
// Исходники импортируются напрямую (Node снимает типы); старую копию — правкой импорта.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { Backlog } from "../bridge/backlog.ts";
import { batchHandedOut, redundantCopy, takeShownCopies } from "../bridge/fanout.ts";
import { RoomBatch } from "../bridge/roomstack.ts";
import { StaleBurst } from "../bridge/stale.ts";
import { countedKeys, deliveredKeys } from "../shared/seen.ts";
import { graphPosed, progress } from "./room-frames.mjs";

process.env.ISKRON_OPENCODE_BATCH_MS = "50";
process.env.ISKRON_PI_ASIDE_MS = "50";
const { setupChannel: opencodeChannel } = await import("../opencode/channel.ts");
const { setupChannel: piChannel } = await import("../extension/channel.ts");

const caseCopy = () => ({ ...progress(60), event_id: 5 });
const inbox = () => graphPosed("g-5", 5);
const frameEv = (f) => ({ data: { kind: "frame", frame: f, raw: JSON.stringify(f) } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const door = () => ({
  ring: [],
  seen: new Set(),
  seenPath: join(mkdtempSync(join(tmpdir(), "iskron-evcopy-")), "x.seen"),
  stale: new StaleBurst(),
  backlog: new Backlog(),
  roomBatch: new RoomBatch(),
  textEvents: new Set(),
  clients: new Set(),
});

// Копия инбокса, ждущая в пачке лежалых, ещё не вошла текстом: копия дела идёт своим
// путём и гаснет, когда пачка покажет копию инбокса (решение стюарда #931).
test("a live case copy beside a waiting stale inbox copy goes on, and the burst showing it takes it out", () => {
  const d = door();
  const stale = { ...inbox(), stale: true };
  assert.equal(redundantCopy(stale, d), false);
  d.stale.note(stale, () => {});
  const copy = caseCopy();
  assert.equal(redundantCopy(copy, d), false);
  d.roomBatch.add(JSON.stringify(copy), copy, () => {});
  takeShownCopies(d, [stale]);
  assert.equal(d.roomBatch.holds(copy), false, "the shown inbox copy took the case copy out");
  assert.ok(d.seen.has(copy.id), "the taken case copy is marked delivered");
  d.stale.drop();
  d.roomBatch.flushNow();
});

test("a live case copy dies after the stale inbox copy of its event was shown in a burst, not after it was counted", () => {
  const shown = door();
  for (const k of deliveredKeys({ ...inbox(), stale: true })) shown.seen.add(k);
  assert.equal(redundantCopy(caseCopy(), shown), true);
  assert.equal(redundantCopy(inbox(), shown), false, "a live inbox copy still wakes");
  const counted = door();
  for (const k of countedKeys({ ...inbox(), stale: true })) counted.seen.add(k);
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
    ch.onEvent("A", { data: { kind, text: "пачка", frames: [inbox()] } });
    await pause(300);
    assert.equal(ch.ride("A"), null);
  });

// Пачка лежалых ушла сторожам: метку ставит сторож после печати, а мост уже помнит, что
// событие отдано текстом. При пустом локальном сокете текст не дошёл ни до кого.
test("a stale burst handed to listening watchdogs kills a later case copy; one handed to nobody does not", () => {
  const heard = door();
  heard.clients.add({});
  batchHandedOut(heard, [{ ...inbox(), stale: true }], null);
  assert.equal(redundantCopy(caseCopy(), heard), true);
  const deaf = door();
  batchHandedOut(deaf, [{ ...inbox(), stale: true }], null);
  assert.equal(redundantCopy(caseCopy(), deaf), false);
});

// Копия дела за пределом показанных, чья копия инбокса показана пачкой текстом, — не в
// «не вошло»: событие делатель уже прочёл, а шапка послала бы его в history за ним.
const pastCut = (extra = {}) => [
  { ...inbox(), ...extra },
  ...Array.from({ length: 19 }, (_, i) => ({ ...graphPosed(`o-${i}`, 100 + i), ...extra })),
  { ...caseCopy(), ...extra },
];

test("a wake-up batch does not count past its cut a case copy whose inbox copy it shows", () => {
  const b = new Backlog();
  let text = "";
  b.open(0, (ev) => (text = ev.text));
  for (const f of pastCut()) b.note(f);
  b.flushNow();
  assert.match(text, /Побудка: кадров 20/, text);
  assert.doesNotMatch(text, /не вошло/, text);
});

test("a stale burst does not count past its cut a case copy whose inbox copy it shows", async () => {
  const s = new StaleBurst();
  let got = null;
  for (const f of pastCut({ stale: true })) s.note(f, (ev) => (got = ev));
  await pause(1700);
  assert.ok(got, "the burst went out");
  assert.match(got.text, /Лежалых кадров: 20/, got.text);
  assert.doesNotMatch(got.text, /не вошло/, got.text);
  assert.ok(got.unshown?.includes("room-msg-60"), "the absorbed copy is still marked handed out");
});

test("pi: an inbox frame inside a backlog batch takes its case copy out of the aside", async () => {
  const sent = [];
  const deliver = piChannel({ on: () => {}, sendMessage: (m) => sent.push(m.content) });
  deliver(frameEv(caseCopy()));
  deliver({ data: { kind: "backlog", text: "пачка", frames: [inbox()] } });
  await pause(300);
  assert.deepEqual(sent, ["пачка"]);
});
