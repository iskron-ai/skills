import assert from "node:assert/strict";
import { test } from "node:test";

import { batchText, frameToText } from "../shared/frame-text.ts";
import { cardFrame, openCards, openCardsText } from "../shared/open-cards.ts";
import { quiet } from "../shared/quietframe.ts";
import { ME, roomFrame } from "./room-frames.mjs";

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
