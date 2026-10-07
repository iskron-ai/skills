// Свёртка строк ключа (js/shared/keyfold.ts, граф nks-dev: #6718): сменённая — строка
// progress с меньшим entry_id при том же (room.id, line.key). Исходник импортируется
// напрямую (Node снимает типы); старую копию подставляй правкой импорта.
import assert from "node:assert/strict";
import { test } from "node:test";

import { superseded } from "../shared/keyfold.ts";
import { ME, progress, roomFrame } from "./room-frames.mjs";

const ids = (set) => [...set].map((f) => f.entry_id).sort((a, b) => a - b);

test("the last line of a key wins by entry_id, not by arrival; other keys and rooms are apart", () => {
  const other = { ...progress(50), room: { id: "r-2", seq: 8, zachin: "Другое" } };
  const keyB = roomFrame("progress", { entry_id: 51, key: "build" });
  const frames = [progress(46), progress(44), progress(45), other, keyB];
  assert.deepEqual(ids(superseded(frames)), [44, 45]);
});

test("bad, a line addressed to the seat and what is not progress neither fold nor supersede", () => {
  const bad = roomFrame("progress", { entry_id: 47, key: "tests", line: { verdict: "bad" } });
  const mine = { ...progress(48), addressee: ME };
  const joined = roomFrame("joined", { entry_id: 49, key: "tests" });
  assert.deepEqual(ids(superseded([progress(44), bad, mine, joined])), []);
});
