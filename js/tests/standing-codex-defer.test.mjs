// Дверь Codex: слово с defer и вопрос месту — после идущего хода, не в него (дело №5825; граф
// nks-dev: #11433, #11421, #4294). turn/start в занятый тред — steer, а сигнала хода треда у
// подключения сторожа нет: отложенное ждёт прежнего окна пачки (та же ручка) или едет со
// следующим прерывающим кадром одним ходом. Прерывающее слово — сразу, как прежде.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ask, ME, ME_ID, roomFrame } from "./room-frames.mjs";

process.env.ISKRON_STANDING_PART = "codex-defer"; // свод регистрирует свои пробы только в своих частях
const { codexDoor, connected, runClient, sendRoom, waitFor } = await import("./standing.suite.mjs");

const WINDOW_MS = 3000;
const SOON_MS = 1000;
const WINDOW = { ISKRON_BRIDGE_ROOM_BATCH_MS: String(WINDOW_MS) };
const MY_SEAT = { id: ME_ID, standing: ME, name: "proba" };

const word = (entry_id, stack) => {
  const f = roomFrame("said", { entry_id, key: "said", stack, body: `СЛОВО-${entry_id}` });
  f.line.fields = { kind: "text", to: MY_SEAT };
  return f;
};

const turns = (log) =>
  readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.method === "turn/start");

async function codexSeat(t) {
  const { fake, dir, key } = await connected(t, { env: WINDOW });
  await waitFor(() => fake.state.ws.size === 1, "the socket");
  const door = await codexDoor(t);
  const log = join(door.CODEX_HOME, "door.log");
  const arm = () => {
    const wd = runClient("watchdog-codex", dir, key, 30_000, { ...door, ...WINDOW });
    t.after(() => wd.proc.kill("SIGKILL"));
    return wd;
  };
  const wd = arm();
  await waitFor(() => wd.err.includes("слушаю стояние"), "the watchdog to attach");
  return { fake, log, wd, arm };
}

const deferredOnes = [
  ["a said with defer", () => word(91, "defer"), /СЛОВО-91/],
  ["an ask to the seat", () => ask(92), /Выкатывать сегодня\?/],
];

for (const [name, make, text] of deferredOnes)
  test(`watchdog-codex: ${name} does not go into the running turn — one turn/start after the window`, async (t) => {
    const { fake, log, wd } = await codexSeat(t);
    await sendRoom(fake, make());
    await new Promise((r) => setTimeout(r, SOON_MS + 500));
    assert.equal(turns(log).length, 0, `went into the running turn at once:\n${wd.err}`);
    await waitFor(() => turns(log).length > 0, "the deferred frame after the window", 8000);
    assert.match(turns(log)[0].params.input[0].text, text);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(turns(log).length, 1, "one turn for the deferred frame");
  });

test("watchdog-codex: a word to the seat without defer goes into the thread at once", async (t) => {
  const { fake, log } = await codexSeat(t);
  const sent = Date.now();
  await sendRoom(fake, word(93, "interrupt"));
  await waitFor(() => turns(log).length > 0, "the word in the thread", 5000);
  assert.ok(Date.now() - sent < SOON_MS + 500, `came ${Date.now() - sent} ms late`);
  assert.match(turns(log)[0].params.input[0].text, /СЛОВО-93/);
});

test("watchdog-codex: a held deferred word goes with the next interrupting word, one turn, before the window", async (t) => {
  const { fake, log } = await codexSeat(t);
  await sendRoom(fake, word(94, "defer"));
  await new Promise((r) => setTimeout(r, 300));
  const sent = Date.now();
  await sendRoom(fake, word(95, "interrupt"));
  await waitFor(() => turns(log).length > 0, "the words in the thread", 5000);
  assert.ok(Date.now() - sent < SOON_MS + 500, `came ${Date.now() - sent} ms late`);
  const got = turns(log)[0].params.input[0].text;
  assert.match(got, /СЛОВО-94[\s\S]*СЛОВО-95/, "the held word first, the interrupting one after");
  await new Promise((r) => setTimeout(r, WINDOW_MS + 500));
  assert.equal(turns(log).length, 1, "the held word went once, not again by the window");
});

test("watchdog-codex: a held deferred word is not lost when the watchdog dies — the next arming puts it", async (t) => {
  const { fake, log, wd, arm } = await codexSeat(t);
  await sendRoom(fake, word(96, "defer"));
  await waitFor(() => wd.err.includes("отложен"), "the word held");
  wd.proc.kill("SIGKILL");
  await wd.done;
  assert.equal(turns(log).length, 0, "nothing in the thread yet");
  const again = arm();
  await waitFor(() => turns(log).length > 0, "the held word from the ring", 10_000);
  assert.match(turns(log)[0].params.input[0].text, /СЛОВО-96/);
  assert.match(again.err, /отложен/, "the ring copy waits out the turn too");
});
