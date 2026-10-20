// Слот «Граф» обложки (#8066, shared/graphslot.ts через seatOfPairs): рабочий граф — голова в
// начале значения, вторая форма того же графа — только в скобках сразу за ней. Проза после
// головы (методология, «не используется») — не кандидат; перечисленные головы равноправны
// при любой форме адреса; сомнение в перечислении — неоднозначность, не первый граф.
import assert from "node:assert/strict";
import { test } from "node:test";

import { frontMatter, seatOfPairs } from "../shared/cover.ts";

const EN = { file: "AGENTS.md", graph: "Graph", role: "Agent role", roleQuotes: ['"', '"'] };
const yaml = (v) => `'${v.replace(/'/g, "''")}'`;
const ru = (graph) =>
  seatOfPairs(frontMatter(`---\n'Граф': ${yaml(graph)}\n'Роль агента': '#931 «dev»'\n---\n`));
const en = (graph) =>
  seatOfPairs(frontMatter(`---\n'Graph': ${yaml(graph)}\n'Agent role': '#931 "dev"'\n---\n`), EN);
const at = (realm) => ({ realm, karta: "931" });

test("#8066: методология и «не используется» за рабочим графом — одна посадка", () => {
  const cases = [
    [
      "`@nks/nks-dev` (`r5`); методология — `@alari/methodology` (`r4`); общий `@nks/feedback` не используется",
      "@nks/nks-dev",
    ],
    ["@nks/nks-dev (r5) — рабочий; методология @alari/methodology (r4)", "@nks/nks-dev"],
    ["r5 — рабочий; @alari/methodology (r4) — канон", "r5"],
    ["r5 (@nks/nks-dev)", "@nks/nks-dev"],
    ["**`@nks/nks-dev`** (`r5`)", "@nks/nks-dev"],
    ["`@nks/nks-dev` (**r5**); методология — **`@alari/methodology`**", "@nks/nks-dev"],
  ];
  for (const [g, realm] of cases) assert.deepEqual(ru(g), at(realm), g);
});

test("P1: отдельные головы — кандидаты при любой форме; «одно и то же» — только в скобках", () => {
  for (const g of [
    "r5 или @a/x",
    "@a/x или r5",
    "r5, @a/x",
    "@a/x; r5",
    "@nks/nks-dev (r7) и r5",
    "@nks/nks-dev (r5) или @nks/drugoy (r7)",
    "@nks/nks-dev или @nks/drugoy",
    "@nks/nks-dev (@nks/drugoy)",
    "r5 (r7)",
  ])
    assert.ok("why" in ru(g), `${g} → ${JSON.stringify(ru(g))}`);
});

test("P2: обрамление прозрачно, нераспознанное с адресом — неоднозначность", () => {
  for (const g of [
    "`@a/x` (`r5`); **`@b/y` (`r7`)**",
    "`@a/x` (`r5`); _`@b/y`_",
    "`@a/x`; «@b/y»",
    "@a/x; ~~@b/y~~",
    "@a/x; **@b/y**",
    "@a/x [@b/y]",
    "@a/x; r7]",
    "@a/x <@b/y>",
  ])
    assert.ok("why" in ru(g), `${g} → ${JSON.stringify(ru(g))}`);
});

test("EN-форма без слов-связок: разделители и обрамление перечисляют так же", () => {
  assert.ok("why" in en("@nks/nks-dev, @nks/drugoy"));
  assert.ok("why" in en("`@a/x` (`r5`); **`@b/y`**"));
  assert.deepEqual(en("@nks/nks-dev (r5); methodology — @alari/methodology"), at("@nks/nks-dev"));
});
