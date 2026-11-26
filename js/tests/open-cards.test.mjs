import assert from "node:assert/strict";
import { test } from "node:test";

import { build } from "esbuild";

import { batchText, frameToText } from "../shared/frame-text.ts";
import { setLang } from "../shared/lang.ts";
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
const times = (text, value) => text.split(value).length - 1;
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

// The envelope names the open cards next to its count (#11342): the case, the entry, the key and
// who asked, as the server lists them (room, entry_id, key, asked_at, asker). The list is context
// like the count — printed with it, never a wake-up of its own.
const OLDEST = "2026-11-10T12:00:00Z";
const CARDS = [
  {
    room: { id: "case-id", number: 7, realm: "@o/s" },
    entry_id: 41,
    key: "ask:one",
    asked_at: OLDEST,
    asker: { standing_id: "seat-id", standing: "@h:aleksei", karta_seq: 9 },
  },
  {
    room: { id: "case-id-2", number: 4330, realm: "@o/s" },
    entry_id: 42,
    key: "ask:two",
    asked_at: "2026-11-10T12:05:00Z",
    asker: { standing_id: null, standing: null, karta_seq: 163 },
  },
];
const LIST =
  "дело №7 [41], ключ: ask:one, спросил: @h:aleksei; дело №4330 [42], ключ: ask:two, спросил: роль 163";
const withItems = (items, count = 2) => ({ count, oldest_at: OLDEST, items });

test("the card envelope lists the cards the server names: case, entry, key, asker", () => {
  assert.deepEqual(openCards(withItems(CARDS)), withItems(CARDS));
  const line = openCardsText({ my_open_cards: withItems(CARDS) });
  assert.equal(line, `карточек без ответа: 2; старшая с ${OLDEST} — ${LIST}`);
  // No list from the server — the count line as before; an empty list adds nothing.
  assert.equal(
    openCardsText({ my_open_cards: { count: 2, oldest_at: OLDEST } }),
    `карточек без ответа: 2; старшая с ${OLDEST}`,
  );
  assert.deepEqual(openCards(withItems([])), withItems([]));
  assert.equal(
    openCardsText({ my_open_cards: withItems([]) }),
    `карточек без ответа: 2; старшая с ${OLDEST}`,
  );
});

test("at most five cards are listed, as the server sends them, the rest behind the count", () => {
  const many = Array.from({ length: 7 }, (_, n) => ({ ...CARDS[0], entry_id: 100 + n }));
  assert.deepEqual(openCards(withItems(many, 7)).items, many.slice(0, 5));
  const line = openCardsText({ my_open_cards: withItems(many, 7) });
  assert.equal(times(line, "спросил:"), 5);
  assert.doesNotMatch(line, /\[10[5-6]\]/);
});

test("an item that is not an object makes the envelope unknown, like a broken count", () => {
  // A null list is no list — the count stands as before —; a broken one hides it with the count.
  assert.deepEqual(openCards(withItems(null)), { count: 2, oldest_at: OLDEST });
  for (const items of ["SECRET", {}, 5, [null], ["SECRET"], [[1]], [true]])
    assert.equal(openCards(withItems(items)), null, JSON.stringify(items) ?? String(items));
  for (const items of [undefined, [{}], [{ ...CARDS[0], extra: "SECRET" }]])
    assert.equal(openCardsText({ my_open_cards: withItems(items) }).includes("SECRET"), false);
});

test("a field of an unknown shape is unknown in its place, never echoed raw", () => {
  const secret = { secret: "SECRET" };
  const broken = { room: secret, entry_id: secret, key: secret, asked_at: "SECRET", asker: secret };
  const line = openCardsText({ my_open_cards: withItems([broken], 1) });
  assert.equal(
    line,
    `карточек без ответа: 1; старшая с ${OLDEST} — дело №неизвестно [неизвестно], ключ: неизвестно, спросил: неизвестно`,
  );
  assert.doesNotMatch(line, /SECRET|\[object Object\]/);
  // An asker that is a role without a seat is the role; a room is its number.
  assert.equal(
    openCardsText({ my_open_cards: withItems([CARDS[1]], 1) }),
    `карточек без ответа: 1; старшая с ${OLDEST} — дело №4330 [42], ключ: ask:two, спросил: роль 163`,
  );
});

test("the list is stripped from details like the rest of the envelope, without mutating the frame", () => {
  const raw = {
    type: "message",
    id: "cards-items",
    body: "cards-items-body",
    my_open_cards: withItems([{ ...CARDS[0], extra: "SECRET" }]),
  };
  assert.deepEqual(cardFrame(raw).my_open_cards, withItems([CARDS[0]]));
  assert.equal(raw.my_open_cards.items[0].extra, "SECRET", "do not mutate another reader's frame");
});

test("the list with its count is context by itself and disguises no addressed body", () => {
  const secret = { secret: "SECRET" };
  for (const items of [CARDS, [{ ...CARDS[0], key: "a;b [c], спросил: x" }], [secret]])
    for (const count of [0, 2, undefined]) {
      const my_open_cards = count === undefined ? undefined : withItems(items, count);
      const line = openCardsText({ my_open_cards });
      assert.equal(quiet(line), true, line);
      assert.equal(quiet(`addressed word\n${line}`), false, line);
    }
});

test("a direct frame and a batch print the list of the last envelope once, with its count", () => {
  const a = roomFrame("said", {
    entry_id: 901,
    body: "first",
    envelope: { addressee: ME, my_open_cards: { count: 2, oldest_at: OLDEST } },
  });
  const b = roomFrame("said", {
    entry_id: 902,
    body: "second",
    envelope: { addressee: ME, my_open_cards: withItems(CARDS) },
  });
  const expected = new RegExp(`— ${LIST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  assert.match(frameToText(b, ""), expected);
  for (const text of [
    batchText([a, b]),
    batchBodyText([a, b], { head: "selected", shown: [1], incomplete: true }, []),
  ]) {
    assert.match(text, /first|second/);
    assert.equal(text.split("карточек без ответа").length - 1, 1, text);
    assert.match(text, expected);
  }
  assert.doesNotMatch(batchText([b, a]), /спросил:/);
});

test("the English card list names the same facts and is context by itself", () => {
  setLang("en");
  try {
    const line = openCardsText({ my_open_cards: withItems(CARDS) });
    assert.equal(
      line,
      `unanswered cards: 2; oldest since ${OLDEST} — case №7 [41], key: ask:one, asked by: @h:aleksei; case №4330 [42], key: ask:two, asked by: role 163`,
    );
    assert.equal(quiet(line), true, line);
  } finally {
    setLang("ru");
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
