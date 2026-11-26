// The plugin hands over the server's frames and generates no turn of its own (graph
// @nks/nks-dev, nodes #11359, #6574): a stale or wake-up batch of counts only waits in the case
// pile for a passing prompt, as live counts do; one record is counted once however many copies
// came; a direct word steers the running turn, a batch with a word to the seat is queued after
// it. Fake bridge, stand-in context; ISKRON_OPENCODE_PLUGIN aims it at any copy (red before).
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { staleBatch } from "../shared/stalebatch.ts";
import { BATCH_MS, delay, plugin, SANDBOX, until } from "./opencode-kit.mjs";
import { ME, progress, roomFrame } from "./room-frames.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");
const event = (kind, extra) => JSON.stringify({ kind, ...extra }) + "\n";
const count = (n, id = `c-${n}`) => ({ ...progress(n, `key-${n}`), id });
const word = (n) =>
  roomFrame("said", {
    entry_id: n,
    stack: "defer",
    envelope: { addressee: ME },
    body: `СЛОВО-${n}`,
  });
const stale = (frames) => {
  const s = frames.map((f) => ({ ...f, stale: true }));
  const { text, keys, body } = staleBatch(s, () => false);
  return event("stale", { frames: s, marks: keys, text, body });
};

async function seated(name, s) {
  const log = join(SANDBOX, `${name}.log`);
  const events = join(SANDBOX, `${name}.events`);
  const reply = join(SANDBOX, `${name}.reply`);
  for (const f of [log, events, reply]) writeFileSync(f, "");
  const rec = await plugin(
    { ISKRON_BRIDGE_PATH: FAKE_BRIDGE, FB_LOG: log, FB_REPLY: reply, FB_EVENTS: events },
    { sessions: [{ id: s, location: { directory: "/work/record-once" } }] },
  );
  await until(() => rec.tools().size === 3, "the server's tools", 8000);
  await rec.call("iskron_channel", { action: "connect" }, s);
  const pid = Number(readFileSync(log, "utf8").trim().split("\n")[0].split(/\s+/)[1]);
  const send = (line) => appendFileSync(`${events}.${pid}`, line);
  const frame = (f) => event("frame", { frame: f, raw: JSON.stringify(f) });
  return { rec, send, frame };
}

test("a stale batch of counts only opens no turn: its counts ride the next prompt, once", async () => {
  const { rec, send, frame } = await seated("ro-stale", "s-ro-stale");
  try {
    send(stale([count(12), count(13), count(14)]));
    await delay(BATCH_MS * 6);
    assert.deepEqual(
      rec.prompts.map((p) => p.text),
      [],
      "no prompt for counts nobody addressed to the seat",
    );
    send(frame(word(20)));
    await until(() => rec.prompts.length === 1, "the word's prompt");
    await delay(BATCH_MS * 3);
    assert.equal(rec.prompts.length, 1, "one prompt");
    assert.match(rec.prompts[0].text, /СЛОВО-20/);
    assert.match(rec.prompts[0].text, /записей 4, тебе 1/, rec.prompts[0].text);
  } finally {
    await rec.stop();
  }
});

test("100 copies of one record and 100 of one frame id, while busy, are one count each", async () => {
  const { rec, send, frame } = await seated("ro-busy", "s-ro-busy");
  try {
    rec.emit({
      type: "session.status",
      data: { sessionID: "s-ro-busy", status: { type: "busy" } },
    });
    let lines = "";
    for (let i = 0; i < 100; i++) lines += frame(count(31, `copy-${i}`));
    for (let i = 0; i < 100; i++) lines += frame(count(32, "same-id"));
    send(lines);
    await delay(BATCH_MS * 6);
    send(frame(word(40)));
    await until(() => rec.prompts.length === 1, "the word's prompt");
    assert.match(rec.prompts[0].text, /записей 3, тебе 1/, rec.prompts[0].text);
    assert.doesNotMatch(rec.prompts[0].text, /сменённых/, "copies are not superseded lines");
  } finally {
    await rec.stop();
  }
});

test("steer and queue stay: a direct word steers, a batch with a word to the seat is queued", async () => {
  const { rec, send, frame } = await seated("ro-lanes", "s-ro-lanes");
  try {
    const direct = { type: "message", id: "direct-1", body: "ПРЯМОЕ", provenance: {} };
    send(frame(direct));
    await until(() => rec.prompts.length === 1, "the direct word");
    assert.equal(rec.prompts[0].delivery, "steer", rec.prompts[0].text);
    send(stale([count(50), word(51)]));
    await until(() => rec.prompts.length === 2, "the batch with a word to the seat");
    assert.equal(rec.prompts[1].delivery, "queue");
    assert.match(rec.prompts[1].text, /СЛОВО-51/);
  } finally {
    await rec.stop();
  }
});
