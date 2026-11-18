// Место без хэндла (граф @nks/nks-dev, #11011, #7917): место человека без хэндла и места
// его агентов печатаются и принимаются голым именем — без «@», хэндла и двоеточия; мост
// принимает оба вида. Сквозные пробы стояния — в stand.test.mjs («bare seat»).
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBoard } from "../bridge/board.ts";
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
