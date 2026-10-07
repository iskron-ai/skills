// Копия дела события (via=room, event_id конверта; граф nks-dev: #6563) гаснет перед
// копией инбокса того же события, где бы она ни ждала (#5842): в пачке лежалых моста,
// в стопке своей сессии OpenCode, в свёртке pi — и в пачках побудки и лежалых,
// несущих событие текстом. Чужую сессию OpenCode кадр инбокса не трогает.
// Исходники импортируются напрямую (Node снимает типы); старую копию — правкой импорта.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { redundantCopy } from "../bridge/fanout.ts";
import { RoomBatch } from "../bridge/roomstack.ts";
import { StaleBurst } from "../bridge/stale.ts";
import { graphPosed, progress } from "./room-frames.mjs";

process.env.ISKRON_OPENCODE_BATCH_MS = "50";
process.env.ISKRON_PI_ASIDE_MS = "50";
const { setupChannel: opencodeChannel } = await import("../opencode/channel.ts");
const { setupChannel: piChannel } = await import("../extension/channel.ts");

const caseCopy = () => ({ ...progress(60), event_id: 5 });
const inbox = () => graphPosed("g-5", 5);
const frameEv = (f) => ({ data: { kind: "frame", frame: f, raw: JSON.stringify(f) } });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("a live case copy dies before a stale inbox copy of its event waiting in the burst", () => {
  const d = {
    ring: [],
    seen: new Set(),
    seenPath: join(mkdtempSync(join(tmpdir(), "iskron-evcopy-")), "x.seen"),
    stale: new StaleBurst(),
    roomBatch: new RoomBatch(),
  };
  const stale = { ...inbox(), stale: true };
  assert.equal(redundantCopy(stale, d), false);
  d.stale.note(stale, () => {});
  assert.equal(redundantCopy(caseCopy(), d), true);
  d.stale.drop();
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

test("pi: an inbox frame inside a backlog batch takes its case copy out of the aside", async () => {
  const sent = [];
  const deliver = piChannel({ on: () => {}, sendMessage: (m) => sent.push(m.content) });
  deliver(frameEv(caseCopy()));
  deliver({ data: { kind: "backlog", text: "пачка", frames: [inbox()] } });
  await pause(300);
  assert.deepEqual(sent, ["пачка"]);
});
