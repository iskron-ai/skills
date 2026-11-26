// The snapshot's cards (graph @nks/nks-dev, #11419): `items` of my_open_cards since wire
// 0.181.0 survive the bridge's check in the known form, each named in the turn text; a
// malformed entry is left out and said, never echoed. On a92c9428 the check dropped `items`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { batchText, frameToText } from "../shared/frame-text.ts";
import { cardFrame, openCards, openCardsText } from "../shared/open-cards.ts";
import { quiet } from "../shared/quietframe.ts";
import { card, FIVE, snapshot } from "./open-cards-fixture.mjs";
import { ME, roomFrame } from "./room-frames.mjs";

const lineOf = (text, c) => text.split("\n").find((l) => l.includes(`№${c.room.number} `));

test("five cards pass the check as sent and each is named in the text", () => {
  const raw = { type: "hello", my_open_cards: snapshot() };
  const checked = cardFrame(raw);
  assert.deepEqual(checked.my_open_cards.items, FIVE, "the same five, in the server's order");
  assert.deepEqual(
    openCards(checked.my_open_cards),
    checked.my_open_cards,
    "a second check keeps them",
  );
  const text = openCardsText(checked);
  assert.match(text.split("\n")[0], /^карточек без ответа: 7; старшая с 2026-11-11T12:00:00Z$/);
  for (const c of FIVE) {
    const line = lineOf(text, c);
    assert.ok(line, `card №${c.room.number} named: ${text}`);
    for (const fact of [`[${c.entry_id}]`, c.key, c.asked_at]) assert.ok(line.includes(fact), line);
  }
  assert.match(lineOf(text, FIVE[0]), /спросил @asker:seat-1 \(роль 901\)/);
  assert.match(lineOf(text, FIVE[2]), /спросил роль 903,/);
  assert.match(lineOf(text, FIVE[4]), /спросил @asker:seat-5,/);
  assert.equal(quiet(text), true, "the snapshot with its cards is context, not a wake-up");
  assert.equal(quiet(`addressed word\n${text}`), false);
});

test("a malformed card is left out and said; the rest and the count stay", () => {
  const bad = [
    { ...card(6), key: "SECRET\nline" },
    { ...card(7), room: { id: "x", number: "SECRET", realm: "r" } },
    { ...card(8), asked_at: "SECRET" },
    { ...card(9), asker: "SECRET" },
    { ...card(9), asker: { standing: 5 } },
  ];
  const checked = cardFrame({
    type: "message",
    id: "m",
    my_open_cards: snapshot([FIVE[0], ...bad]),
  });
  assert.deepEqual(checked.my_open_cards.items, [FIVE[0]]);
  assert.equal(checked.my_open_cards.malformed_items, 5);
  const text = openCardsText(checked);
  assert.match(text, /карточек неверной формы не показано: 5/);
  assert.doesNotMatch(text + JSON.stringify(checked), /SECRET/);
  const notList = cardFrame({ type: "hello", my_open_cards: { ...snapshot(), items: "SECRET" } });
  assert.deepEqual(notList.my_open_cards, { ...snapshot([]), malformed_items: 1 });
  assert.match(openCardsText(notList), /^карточек без ответа: 7;.*\n.*не показано: 1/);
  const six = cardFrame({ type: "hello", my_open_cards: snapshot([...FIVE, card(6)]) });
  assert.deepEqual(six.my_open_cards.items, FIVE, "the wire names five at most");
  assert.equal(six.my_open_cards.malformed_items, 1);
  assert.equal(quiet(openCardsText(six)), true);
  const old = cardFrame({
    type: "hello",
    my_open_cards: { count: 2, oldest_at: "2026-11-10T12:00:00Z" },
  });
  assert.deepEqual(
    old.my_open_cards,
    { count: 2, oldest_at: "2026-11-10T12:00:00Z" },
    "an older server sends none",
  );
});

test("a carried snapshot names its cards once in a direct and a batched turn", () => {
  const a = roomFrame("said", {
    entry_id: 901,
    body: "first",
    envelope: { addressee: ME, my_open_cards: snapshot() },
  });
  const b = roomFrame("said", {
    entry_id: 902,
    body: "second",
    envelope: { addressee: ME, my_open_cards: snapshot() },
  });
  for (const text of [frameToText(cardFrame(a), ""), batchText([cardFrame(a), cardFrame(b)])]) {
    assert.equal(text.split("карточек без ответа").length - 1, 1, text);
    for (const c of FIVE) assert.equal(text.split(`№${c.room.number} [`).length - 1, 1, text);
  }
});
