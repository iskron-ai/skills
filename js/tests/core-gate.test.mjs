// Проба гейта границы ядра (scripts/check-core.mjs; граф @nks/nks-dev, узлы #6806,
// #6809): каждое дерево fixtures/core-gate/<случай> несёт одно нарушение в ядре —
// гейт обязан упасть, назвав файл; в слое поставки и пробах то же самое законно.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import { REPO } from "./built.mjs";

const GATE = join(REPO, "scripts", "check-core.mjs");
const FIXTURES = join(REPO, "js", "tests", "fixtures", "core-gate");

const gate = (root) =>
  spawnSync(process.execPath, [GATE, ...(root ? ["--root", root] : [])], { encoding: "utf8" });

const RED = {
  string: "js/bridge/a.ts:1: product name",
  template: "js/bridge/a.ts:2: product name",
  identifier: "js/opencode/a.ts:1: product name",
  "cyrillic-regex": "js/watchdog/a.ts:1: Cyrillic letter",
  "russian-comment": "js/extension/a.ts:1: Cyrillic letter",
  "l-call": "js/shared/a.ts:2: call L(",
  filename: "js/cli/iskron.ts:0: product name",
  nested: "js/shared/deep/inner/x.ts:1: product name",
};

for (const [name, line] of Object.entries(RED)) {
  test(`core gate refuses: ${name}`, () => {
    const r = gate(join(FIXTURES, name));
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stderr.includes(line), `expected «${line}» in:\n${r.stderr}`);
  });
}

test("core gate passes the same strings in js/delivery and js/tests", () => {
  const r = gate(join(FIXTURES, "outside-core"));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^✓ check-core/);
});

test("core gate passes the real repo", () => {
  const r = gate();
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
