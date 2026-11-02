// Запись обложки без модели (shared/coverblock.ts; #9316 — форма, #9319 — подготовка репо шагом
// моста): блок корневого ключа поставки ставится на место, прочее во фронтматтере и теле не
// трогается, повтор ничего не меняет, записанное читается тем же разбором.
import assert from "node:assert/strict";
import { test } from "node:test";

import { COVER } from "../delivery/index.ts";
import { coverBlock, coverBlocks, writeCover } from "../shared/coverblock.ts";

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

test("пустые поля не пишутся; CRLF и BOM сохраняются", () => {
  const text = writeCover("\uFEFF---\r\nx: 1\r\n---\r\n# y\r\n", "iskron", {
    graph: "r5",
    holon: "",
  });
  assert.equal(text, "\uFEFF---\r\niskron:\r\n  graph: r5\r\nx: 1\r\n---\r\n# y\r\n");
  assert.deepEqual([...coverBlocks(text).keys()], ["iskron"]);
});
