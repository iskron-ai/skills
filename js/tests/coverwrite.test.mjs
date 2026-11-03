// Запись обложки без модели (shared/coverwrite.ts, разбор — shared/coverblock.ts; #9316 — форма,
// #9319 — подготовка репо шагом моста): блок корневого ключа поставки ставится на место, прочее
// во фронтматтере и теле и поле rituals: не трогается, повтор ничего не меняет, записанное
// читается тем же разбором.
import assert from "node:assert/strict";
import { test } from "node:test";

import { COVER } from "../delivery/index.ts";
import { coverBlock, coverBlocks, repeatedKeys, ritualsOf } from "../shared/coverblock.ts";
import { writeCover } from "../shared/coverwrite.ts";

const DATA = { graph: "r5", holon: 1506, agent_role: 931, contract: 38, stamp: "2026-11-02" };
const BLOCK =
  "iskron:\n  graph: r5\n  holon: 1506\n  agent_role: 931\n  contract: 38\n  stamp: 2026-11-02\n";

test("ключ поставки — iskron", () => {
  assert.equal(COVER.root, "iskron");
});

test("нет файла или фронтматтера — фронтматтер заводится блоком, тело остаётся", () => {
  assert.equal(writeCover(null, "iskron", DATA), `---\n${BLOCK}---\n`);
  assert.equal(writeCover("# x\n", "iskron", DATA), `---\n${BLOCK}---\n# x\n`);
});

test("свой блок заменяется на месте; чужие ключи и тело — байт в байт", () => {
  const before = `---\ntitle: notes\niskron:\n  graph: r1\n  agent_role: 7\n\nother:\n  contract: 4\n---\n# x\n`;
  const after = writeCover(before, "iskron", DATA);
  assert.equal(after, `---\ntitle: notes\n${BLOCK}\nother:\n  contract: 4\n---\n# x\n`);
  assert.equal(writeCover(after, "iskron", DATA), after, "повтор ничего не меняет");
});

test("блока нет — он встаёт первым во фронтматтере, прежние ключи остаются", () => {
  const before = "---\n'Граф': '@nks/nks-dev (r5)'\n---\n# x\n";
  assert.equal(
    writeCover(before, "iskron", DATA),
    `---\n${BLOCK}'Граф': '@nks/nks-dev (r5)'\n---\n# x\n`,
  );
});

test("записанное читается тем же разбором; адрес с @ — в кавычках YAML", () => {
  const text = writeCover(null, "iskron", { ...DATA, graph: "@nks/nks-dev" });
  assert.match(text, /^ {2}graph: '@nks\/nks-dev'$/m);
  assert.deepEqual(Object.fromEntries(coverBlock(text, "iskron")), {
    graph: "@nks/nks-dev",
    holon: "1506",
    agent_role: "931",
    contract: "38",
    stamp: "2026-11-02",
  });
});

test("комментарий на строке корня — блок узнаётся и заменяется на месте, строка корня цела", () => {
  const before = "---\niskron: # repo addresses\n  graph: r1\n---\n# x\n";
  assert.deepEqual(Object.fromEntries(coverBlock(before, "iskron")), { graph: "r1" });
  const after = writeCover(before, "iskron", DATA);
  assert.equal(after, `---\n${BLOCK.replace("iskron:", "iskron: # repo addresses")}---\n# x\n`);
  assert.equal(writeCover(after, "iskron", DATA), after, "повтор ничего не меняет");
  assert.equal(
    coverBlock("---\niskron:#x\n  graph: r1\n---\n", "iskron"),
    null,
    "без пробела — не комментарий",
  );
});

test("повтор ключа верхнего уровня и поля в блоке распознаётся; вложенное и списки — не повтор", () => {
  assert.deepEqual(repeatedKeys("---\n'Граф': a\nx: 1\nГраф: b\n---\n"), ["Граф"]);
  assert.deepEqual(repeatedKeys("---\niskron:\n  graph: r1\n  graph: r2\n---\n"), ["iskron.graph"]);
  assert.deepEqual(repeatedKeys(`---\n${BLOCK}x: |\n  a: 1\n  a: 2\n---\n# a: 1\n# a: 1\n`), []);
  const nested = "---\nm:\n  a:\n    k: 1\n  b:\n    k: 2\nl:\n  - k: 1\n  - k: 2\n---\n";
  assert.deepEqual(repeatedKeys(nested), []);
});

test("пустые поля не пишутся; CRLF и BOM сохраняются", () => {
  const text = writeCover("\uFEFF---\r\nx: 1\r\n---\r\n# y\r\n", "iskron", {
    graph: "r5",
    holon: "",
  });
  assert.equal(text, "\uFEFF---\r\niskron:\r\n  graph: r5\r\nx: 1\r\n---\r\n# y\r\n");
  assert.deepEqual([...coverBlocks(text).keys()], ["iskron"]);
});

test("поле rituals: запись его не трогает — ни список, ни пустое, ни кавычки", () => {
  for (const line of ["  rituals: start merge", "  rituals:", "  rituals: 'push' # c"]) {
    const before = `---\niskron:\n  graph: r1\n${line}\n  stamp: 2026-01-01\n---\n# x\n`;
    const after = writeCover(before, "iskron", DATA);
    assert.equal(after, `---\n${BLOCK}${line}\n---\n# x\n`, line);
    assert.equal(writeCover(after, "iskron", DATA), after, "повтор ничего не меняет");
  }
});

test("ritualsOf: нет поля — все; пустое — ни одного; список — эти; чужое имя — названо", () => {
  const of = (text) => ritualsOf(coverBlock(text, "iskron"));
  const all = ["start", "push", "merge", "guard", "turn"];
  assert.deepEqual([...of(`---\n${BLOCK}---\n`).on], all);
  assert.deepEqual([...ritualsOf(null).on], all);
  assert.deepEqual([...of(`---\n${BLOCK}  rituals:\n---\n`).on], []);
  assert.deepEqual([...of(`---\n${BLOCK}  rituals: ''\n---\n`).on], []);
  const some = of(`---\n${BLOCK}  rituals: start  merge pushh # c\n---\n`);
  assert.deepEqual([...some.on], ["start", "merge"]);
  assert.deepEqual(some.unknown, ["pushh"]);
  // A quoted value with a comment after it: the comment is not part of the list.
  const quoted = of(`---\n${BLOCK}  rituals: 'push merge' # c\n---\n`);
  assert.deepEqual([...quoted.on], ["push", "merge"]);
  assert.deepEqual(quoted.unknown, []);
});
