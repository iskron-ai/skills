// Слово и вопрос месту — на сыром сокете места сразу, не через окно пачки (дело №5825;
// граф nks-dev: #6574, #6655, #11421). Сервер прислал stack "defer" — «не прерывать
// идущий ход», выбор очереди у харнеса, а не минута ожидания: метка доезжает до
// сокета нетронутой. Вопрос соседу и неадресованное — в пачке числом, как прежде.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { test } from "node:test";

import { ask, ME, ME_ID, roomFrame, SIB } from "./room-frames.mjs";

process.env.ISKRON_STANDING_PART = "at-once"; // свод регистрирует свои пробы только в своих частях
const { connected, sendRoom, waitFor } = await import("./standing.suite.mjs");

const WINDOW_MS = 3000;
const SOON_MS = 1000;

/** Сырой сокет места (standings/<hash>.sock) — его читают сторожа; каждое событие с временем прихода. */
async function rawSocket(t, standings) {
  let file = "";
  await waitFor(
    () => (file = readdirSync(standings).find((f) => f.endsWith(".sock")) ?? ""),
    "the seat's raw socket",
  );
  const sock = connect(join(standings, file));
  t.after(() => sock.destroy());
  const events = [];
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (c) => {
    const at = Date.now();
    const lines = (buf + c).split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) if (l.trim()) events.push({ at, ev: JSON.parse(l) });
  });
  await new Promise((r) => sock.once("connect", r));
  return events;
}

const frameOf = (ev) => ev.frame ?? (typeof ev.raw === "string" ? JSON.parse(ev.raw) : null);
const entryIn = (events, entry) =>
  events.find(({ ev }) => ev.kind === "frame" && frameOf(ev)?.entry_id === entry);

async function seat(t) {
  const env = { ISKRON_BRIDGE_ROOM_BATCH_MS: String(WINDOW_MS) };
  const { fake, standings } = await connected(t, { env });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const events = await rawSocket(t, standings);
  return { fake, events };
}

/** Кадр пришёл на сокет за SOON_MS после отправки, сам по себе — не строкой пачки. */
async function atOnce(t, frame) {
  const { fake, events } = await seat(t);
  const sent = Date.now();
  await sendRoom(fake, frame);
  await waitFor(() => entryIn(events, frame.entry_id), `[${frame.entry_id}] on the socket`, 5000);
  const got = entryIn(events, frame.entry_id);
  assert.ok(got.at - sent < SOON_MS, `[${frame.entry_id}] came ${got.at - sent} ms late`);
  assert.equal(got.ev.batch, undefined, `[${frame.entry_id}] went in a batch`);
  return frameOf(got.ev);
}

/** Кадр не пришёл раньше окна и пришёл строкой пачки. */
async function batched(t, frame) {
  const { fake, events } = await seat(t);
  await sendRoom(fake, frame);
  await new Promise((r) => setTimeout(r, SOON_MS + 500));
  assert.equal(entryIn(events, frame.entry_id), undefined, `[${frame.entry_id}] did not wait`);
  await waitFor(() => entryIn(events, frame.entry_id), `[${frame.entry_id}] in the batch`, 8000);
  assert.ok(entryIn(events, frame.entry_id).ev.batch, `[${frame.entry_id}] not as a batch line`);
}

const MY_SEAT = { id: ME_ID, standing: ME, name: "proba" };
const word = (entry_id, to) => {
  const f = roomFrame("said", { entry_id, key: "said", stack: "defer", body: `СЛОВО-${entry_id}` });
  if (to) f.line.fields = { kind: "text", to };
  return f;
};

test("a deferred said addressed to the seat reaches its raw socket at once, its defer mark kept", async (t) => {
  const got = await atOnce(t, word(91, MY_SEAT));
  assert.equal(got.stack, "defer", "the server's defer reaches the client unchanged");
});

test("an ask addressed to the seat reaches its raw socket at once", async (t) => {
  await atOnce(t, ask(92));
});

test("an ask to a sibling seat of the same role stays in the batch", async (t) => {
  const toSib = ask(93);
  toSib.line.fields.to.standing = SIB;
  await batched(t, toSib);
});

test("a said not addressed to the seat stays in the batch", async (t) => {
  await batched(t, word(94));
});
