// Место без хэндла (граф @nks/nks-dev, #11011, #7917): место человека без хэндла и места
// его агентов печатаются и принимаются голым именем — без «@», хэндла и двоеточия; мост
// принимает оба вида. Сквозные пробы стояния — в stand.test.mjs («bare seat»).
import assert from "node:assert/strict";
import { test } from "node:test";

import { nameOf, parseBoard, readBoard } from "../bridge/board.ts";
import { frameToText } from "../shared/frame-text.ts";
import { parseLaunch } from "../shared/launch.ts";
import { addresseeOf, seatIs } from "../shared/room-fields.ts";

const BARE = "16-m3.skills";

test("a board line with a bare seat is read beside @-seats", () => {
  const text = [
    "Каналы (2):",
    "  #1 👑 Человек 主 · @alari:16-m3.skills — живой · слушает",
    `  #931 👨‍💻 Роль 能 · ${BARE}.opus — живой · слушает`,
  ].join("\n");
  assert.deepEqual(
    parseBoard(text).map((e) => [e.karta, e.address]),
    [
      ["1", "@alari:16-m3.skills"],
      ["931", `${BARE}.opus`],
    ],
  );
});

// The unnamed seat of a human without a handle (LAB, MCP 0.159.0): no address at all.
test("a seat line without an address is an entry with address null; 📥 and id hang on it; headers are no seats", () => {
  const text = [
    "Каналы #1 (3):",
    "  #1 👤 Человек 主 — живой · приёмник",
    "     📥 https://lab.example/api/channel/in/cap1",
    "     id 9499a342-4b74-486f-848c-b7236b36384d",
    "  #1 👑 Человек 主 · @alari:16-m3.skills — живой · слушает",
    `  #3 👨‍💻 Роль 能 · ${BARE}.opus — живой · слушает`,
  ].join("\n");
  assert.deepEqual(
    parseBoard(text).map((e) => [e.karta, e.address, e.rest, e.incoming, e.id]),
    [
      [
        "1",
        null,
        "живой · приёмник",
        "https://lab.example/api/channel/in/cap1",
        "9499a342-4b74-486f-848c-b7236b36384d",
      ],
      ["1", "@alari:16-m3.skills", "живой · слушает", null, null],
      ["3", `${BARE}.opus`, "живой · слушает", null, null],
    ],
  );
});

test("board fields: a seat without the standing key (or with an empty one) is an entry with address null", () => {
  const seat = (over) => ({
    seat_id: "s",
    karta_seq: 1,
    listening: true,
    state: "active",
    ...over,
  });
  const board = readBoard({
    text: "",
    structured: {
      action: "list",
      seats: [seat({}), seat({ standing: "" }), seat({ karta_seq: 3, standing: `${BARE}.opus` })],
    },
  });
  assert.equal(board.recognized, true);
  assert.deepEqual(
    board.entries.map((e) => e.address),
    [null, null, `${BARE}.opus`],
  );
  assert.equal(nameOf(null), null);
});

test("the launch line's «from» tail takes a bare seat as well as @handle:name", () => {
  assert.equal(parseLaunch(`start @nks/nks-dev #931 дело №5 от ${BARE}`)?.of, BARE);
  assert.equal(parseLaunch("start @nks/nks-dev #931 case #5 from @alari:x")?.of, "@alari:x");
});

test("a seat object without a handle is addressed by its bare name", () => {
  assert.deepEqual(addresseeOf({ id: "s-1", name: BARE }), { addr: [BARE, "s-1"], label: BARE });
  assert.equal(addresseeOf({ id: "b-1", handle: "boris", name: "probe" }).label, "@boris:probe");
});

test("seatIs compares a bare address with mine; only the object's id is not an address", () => {
  const frame = { to_standing: BARE };
  assert.equal(seatIs(frame, BARE), true);
  assert.equal(seatIs(frame, "other"), false);
  assert.equal(seatIs(frame, { id: "s-9", name: BARE }), true);
  assert.equal(seatIs(frame, { id: "s-9", name: "other" }), false);
  assert.equal(seatIs({ to_standing: "@a:x" }, { id: "s-9" }), false);
});

test("a human's account: «@» only before a handle", () => {
  const said = (user) =>
    frameToText(
      {
        type: "message",
        id: "m-1",
        body: "слово",
        provenance: { auth: "oidc", user, from_person: true },
      },
      "",
      false,
    );
  assert.match(said("alari"), /человек @alari/, said("alari"));
  assert.match(said("@alari"), /человек @alari/, said("@alari"));
  const id = "9499a342-4b74-486f-848c-b7236b36384d";
  assert.match(said(id), new RegExp(`человек ${id}`), said(id));
  assert.doesNotMatch(said(id), /@/, said(id));
});

// LAB, live run 8.15.0: «человек @x (@x)» — the unnamed seat of a human repeats the account;
// each fact once (REALITY.md). A seat with a name is printed beside as before.
test("a human's word: the seat in brackets only when it says more than the account", () => {
  const said = (user, from_standing) =>
    frameToText(
      {
        type: "message",
        id: "m-2",
        body: "слово",
        provenance: { auth: "oidc", user, from_standing, from_person: true },
      },
      "",
      false,
    ).split("\n")[0];
  assert.equal(said("x", "@x"), "человек @x");
  assert.equal(said("@x", "@x"), "человек @x");
  assert.equal(said("x", "@x:window"), "человек @x (@x:window)");
  assert.equal(said("x", "window"), "человек @x (window)");
});
