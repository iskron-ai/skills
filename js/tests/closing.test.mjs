// Строка закрытия моего вопроса чужой записью (граф nks-dev: #6867, #6574) решается
// самим запросом, а не порядком вызовов: closes_mine ставит решение об адресе, и
// closedQuestion выносит его явно — читатель в любом порядке получает то же.
import assert from "node:assert/strict";
import { test } from "node:test";

import { closedQuestion } from "../shared/addressed.ts";
import { batchHead } from "../shared/frame-text.ts";
import { answer, ask, BORIS } from "./room-frames.mjs";

test("the closing line of my question closed by another's answer does not depend on what was asked first", () => {
  const mine = ask(90);
  const theirs = answer(91, 90, BORIS);
  // The question to me first, as on the wire; then the closer is asked about directly,
  // before any count or addressing call has looked at it.
  assert.equal(closedQuestion(mine), "");
  assert.equal(closedQuestion(theirs), "90");
  assert.equal(closedQuestion(theirs), "90", "asked again, the same");
  // A fresh copy of the same record (nothing set on it yet) straight into the count.
  const head = batchHead([answer(91, 90, BORIS)]);
  assert.match(head, /тебе 0; вопрос \[90\] к тебе закрыт: ответил Дмитрий/);
  assert.doesNotMatch(head, /после обеда/, "the answer's text stays in history");
});
