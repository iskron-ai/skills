import assert from "node:assert/strict";
import { test } from "node:test";

import { CONTRACT_SUPPORT } from "../delivery/contract.ts";
import { contractOf, contractWarning } from "../shared/covercontract.ts";

test("the role-routing template correction targets contract 41 without dropping 39", () => {
  assert.deepEqual(CONTRACT_SUPPORT, { minimum: 39, target: 41 });
  assert.match(contractWarning({ kind: "known", contract: 38 }), /до 41;/);
});

const block = (fields) => `---\niskron:\n${fields}\n---\n# x\n`;
test("contract diagnosis never guesses a supported baseline", () => {
  for (const n of [0, 11, 38, 39, 40, 41]) {
    assert.deepEqual(contractOf(block(`  contract: ${n}`)), { kind: "known", contract: n });
    assert.equal(!!contractWarning(contractOf(block(`  contract: ${n}`))), n < 39);
  }
  for (const text of ["# no cover", block("  graph: r7")])
    assert.deepEqual(contractOf(text), { kind: "missing" });
  for (const v of ["", "what", "38.5", "-1", "2026-11-09", "99999999999999999999999"])
    assert.deepEqual(contractOf(block(`  contract: ${v}`)), { kind: "invalid" }, v);
  for (const text of [
    block("  contract: 38\n  contract: 39"),
    block("  contract: 38\niskron:\n  contract: 39"),
    block("  contract: 38") + "*(iskronify: контракт 39, штамп 2026-11-09)*",
    "---\nГраф: r7\nGraph: r7\n---\n*(iskronify: контракт 38, штамп 2026-11-09)*",
    "---\niskron:\n  contract: 38\nGraph: r7\n---",
  ])
    assert.deepEqual(contractOf(text), { kind: "ambiguous" }, text);
  const foreign = "---\nother:\n  contract: 11\n  graph: r7\n---\n";
  assert.deepEqual(contractOf(foreign), { kind: "foreign" });
  assert.equal(contractWarning(contractOf(foreign)), null);
});

test("numeric legacy stamps use the delivery forms; date stamps are not contract numbers", () => {
  for (const stamp of [
    "*(iskronify: контракт `5` — перезапусти)*",
    "*(iskronify: contract `29`, stamp `2026-10-20`)*",
    "*(iskronify: контракт 38, штамп 2026-11-09)*",
  ])
    assert.ok(contractWarning(contractOf(stamp)), stamp);
  assert.deepEqual(contractOf("*(iskronify: contract `2026-08-30` — re-run)*"), {
    kind: "missing",
  });
});
