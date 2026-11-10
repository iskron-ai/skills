import assert from "node:assert/strict";
import { test } from "node:test";

import { build } from "esbuild";

import { batchText, frameToText } from "../shared/frame-text.ts";
import { cardFrame, cardRepeatText, openCards, openCardsText } from "../shared/open-cards.ts";
import { quiet } from "../shared/quietframe.ts";
import { ME, roomFrame } from "./room-frames.mjs";

// Exercise the canonical batch door bundled as in the pi/OpenCode artifacts.
const { outputFiles } = await build({
  entryPoints: [new URL("../shared/stalebatch.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { staleBatch, batchBodyText } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

test("clipped batches use only the last input snapshot, not shown bodies or riders", () => {
  for (const last of [{ count: 0, oldest_at: null }, undefined, { count: "SECRET" }]) {
    const frames = Array.from({ length: 21 }, (_, i) => ({
      type: "message",
      id: `snapshot-${i}`,
      body: `body-${i}-end`,
      my_open_cards: i === 20 ? last : { count: 2, oldest_at: "2026-11-10T12:00:00Z" },
    }));
    const expected = openCardsText(frames[20]);
    const result = staleBatch(frames, () => false);
    assert.deepEqual(
      result.body.shown,
      Array.from({ length: 20 }, (_, i) => i),
    );
    assert.equal(result.body.incomplete, true);
    assert.equal(result.keys.length, 21, "receipts still cover the entire input");
    const rider = roomFrame("progress", {
      envelope: { my_open_cards: { count: 9, oldest_at: "2026-11-10T12:00:00Z" } },
    });
    for (const text of [
      result.text,
      batchBodyText(frames, { head: "selected", shown: [3, 1], incomplete: true }, [rider]),
    ]) {
      assert.equal(text.split("карточек без ответа").length - 1, 1, text);
      assert.ok(text.endsWith(expected), text);
      assert.doesNotMatch(text, /SECRET|body-20-end/);
    }
    const selected = batchBodyText(
      frames,
      {
        head: "selected",
        shown: [3, 1],
        incomplete: true,
      },
      [rider],
    );
    assert.ok(selected.indexOf("body-3-end") < selected.indexOf("body-1-end"));
    assert.doesNotMatch(selected, /body-0-end/);
    assert.match(selected, /№7/);
    assert.match(selected, /action="mine"/);
  }
});

test("batch snapshot suppression keeps notice facts, ordinary bodies and case counts", () => {
  const snapshot = { count: 2, oldest_at: "2026-11-10T12:00:00Z" };
  const ordinary = {
    type: "message",
    id: "ordinary",
    body: "ordinary-body",
    my_open_cards: snapshot,
  };
  const notice = {
    type: "message",
    id: "notice",
    my_open_cards: snapshot,
    provenance: {
      via: "platform",
      auth: "none",
      notice: "line_due",
      notice_data: {
        room: { id: "r-1", number: 7, realm: "nks-dev" },
        key: "notice-key",
        due_at: "2026-11-10T12:00:00Z",
        escalated: false,
        holder: { standing: ME, karta_seq: 931 },
      },
    },
  };
  const record = roomFrame("said", {
    body: "case-body",
    envelope: { addressee: ME, my_open_cards: snapshot },
  });
  const last = {
    type: "message",
    id: "hidden",
    body: "hidden-body",
    my_open_cards: { count: 0, oldest_at: null },
  };
  const text = batchBodyText(
    [ordinary, notice, record, last],
    {
      head: "selected",
      shown: [0, 1, 2],
      incomplete: true,
    },
    [roomFrame("progress")],
  );
  assert.match(text, /ordinary-body/);
  assert.match(text, /notice-key/);
  assert.match(text, /case-body/);
  assert.match(text, /записей 2/);
  assert.doesNotMatch(text, /hidden-body/);
  assert.equal(text.split("карточек без ответа").length - 1, 1, text);
  assert.ok(text.endsWith(openCardsText(last)), text);
});

test("server card counts require a coherent count and timestamp, not coercion or raw text", () => {
  const raw = {
    type: "message",
    id: "same-id",
    body: "same-body",
    my_open_cards: { count: "SECRET", oldest_at: "SECRET" },
  };
  assert.deepEqual(cardFrame(raw), { ...raw, my_open_cards: null });
  assert.equal(raw.my_open_cards.count, "SECRET", "do not mutate another reader's frame");
  for (const value of [
    undefined,
    null,
    [],
    "SECRET",
    {},
    { count: -1, oldest_at: null },
    { count: 1.5, oldest_at: null },
    { count: NaN, oldest_at: null },
    { count: Infinity, oldest_at: null },
    { count: true, oldest_at: null },
    { count: Number.MAX_SAFE_INTEGER + 1, oldest_at: null },
    { count: "0", oldest_at: null },
    { count: 0 },
    { count: 0, oldest_at: "2026-11-10T12:00:00Z" },
    { count: 1, oldest_at: null },
    ...[
      "SECRET",
      "2026-02-31T00:00:00Z",
      "2026-11-10",
      "2026-11-10T25:00:00Z",
      "2026-11-10T12:00:00Z\nSECRET",
    ].map((oldest_at) => ({ count: 1, oldest_at })),
  ]) {
    assert.equal(openCards(value), null);
    assert.equal(
      openCardsText({ my_open_cards: value }),
      `карточек без ответа: неизвестно${value === undefined ? "" : " (неверное my_open_cards)"}`,
    );
  }
  for (const oldest_at of ["2026-11-10T12:00:00Z", "2026-11-10T12:00:00.123+03:00"]) {
    const value = { count: 2, oldest_at };
    assert.deepEqual(openCards({ ...value, extra: "SECRET" }), value);
    assert.match(
      openCardsText({ my_open_cards: value }),
      new RegExp(oldest_at.replace(/[.+]/g, "\\$&")),
    );
  }
  assert.deepEqual(openCards({ count: 0, oldest_at: null }), { count: 0, oldest_at: null });
  const max = { count: Number.MAX_SAFE_INTEGER, oldest_at: "2026-11-10T12:00:00Z" };
  assert.deepEqual(openCards(max), max);
});

test("common direct and batched render preserve bodies and use the last server envelope once", () => {
  const a = roomFrame("said", {
    entry_id: 901,
    body: "first",
    envelope: { addressee: ME, my_open_cards: { count: 2, oldest_at: "2026-11-10T12:00:00Z" } },
  });
  const b = roomFrame("said", {
    entry_id: 902,
    body: "second",
    envelope: { addressee: ME, my_open_cards: { count: 0, oldest_at: null } },
  });
  assert.match(frameToText(a, ""), /карточек без ответа: 2/);
  const text = batchText([a, b]);
  assert.match(text, /first/);
  assert.match(text, /second/);
  assert.equal(text.split("карточек без ответа").length - 1, 1);
  assert.match(text, /карточек без ответа: 0/);
  assert.match(batchText([a, b], [a]), /карточек без ответа: 0/);
  assert.match(
    batchText([a, { ...b, my_open_cards: undefined }]),
    /карточек без ответа: неизвестно/,
  );
});

test("card context is quiet by itself and does not disguise an addressed body", () => {
  for (const my_open_cards of [
    undefined,
    null,
    { count: 0, oldest_at: null },
    { count: 2, oldest_at: "2026-11-10T12:00:00Z" },
  ]) {
    const line = openCardsText({ my_open_cards });
    assert.equal(quiet(line), true, line);
    assert.equal(quiet(`addressed word\n${line}`), false);
  }
});

test("repeat numbers come only from the server and invalid values never reach text or details", () => {
  assert.equal(cardRepeatText({}), "");
  assert.equal(cardRepeatText({ repeat: false, repeat_n: 1 }), "");
  assert.equal(cardRepeatText({ repeat: true, repeat_n: 1 }), "повтор карточки: 1");
  for (const repeat_n of [undefined, null, 0, -1, 1.5, "SECRET", {}, Number.MAX_SAFE_INTEGER + 1]) {
    const f = { repeat: true, repeat_n };
    assert.equal(cardRepeatText(f), "повтор карточки: номер неизвестен");
    assert.equal(cardFrame(f).repeat_n, null);
    assert.doesNotMatch(JSON.stringify(cardFrame(f)), /SECRET/);
  }
});
