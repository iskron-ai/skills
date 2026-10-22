// Слот «Граф» обложки (#8066, shared/graphslot.ts через seatOfPairs): рабочий граф — голова в
// начале значения, вторая форма того же графа — только в скобках сразу за ней. Проза после
// головы (методология, «не используется») — не кандидат; всё, что слот называет вне прозы, —
// одна пара (slug, rN); сомнение — неоднозначность или отказ, не первый граф.
import assert from "node:assert/strict";
import { test } from "node:test";

import { frontMatter, seatOfPairs } from "../shared/cover.ts";

const EN = {
  file: "AGENTS.md",
  forms: { en: { graph: "Graph", role: "Agent role", roleQuotes: ['"', '"'], stamp: /\(x:/ } },
  stampShape: /\(x:/,
};
const yaml = (v) => `'${v.replace(/'/g, "''")}'`;
/** raw — значение слота как стоит в YAML, со своими кавычками и строками продолжения. */
const ruRaw = (raw) =>
  seatOfPairs(frontMatter(`---\n'Граф': ${raw}\n'Роль агента': '#931 «dev»'\n---\n`));
const ru = (graph) => ruRaw(yaml(graph));
const en = (graph) =>
  seatOfPairs(frontMatter(`---\n'Graph': ${yaml(graph)}\n'Agent role': '#931 "dev"'\n---\n`), EN);
const at = (realm) => ({ realm, karta: "931" });
const none = (r, g) => assert.ok("why" in r, `${g} → ${JSON.stringify(r)}`);

test("#8066: методология и «не используется» за рабочим графом — одна посадка", () => {
  const cases = [
    [
      "`@nks/nks-dev` (`r5`); методология — `@alari/methodology` (`r4`); общий `@nks/feedback` не используется",
      "@nks/nks-dev",
    ],
    ["@nks/nks-dev (r5) — рабочий; методология @alari/methodology (r4)", "@nks/nks-dev"],
    ["r5 — рабочий; @alari/methodology (r4) — канон", "r5"],
    ["r5 (@nks/nks-dev)", "@nks/nks-dev"],
    ["@a/x (r5), @a/x (r5)", "@a/x"],
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
    none(ru(g), g);
});

test("P2: нераспознанное с другим адресом — неоднозначность", () => {
  for (const g of [
    "`@a/x` (`r5`); **`@b/y` (`r7`)**",
    "`@a/x` (`r5`); _`@b/y`_",
    "`@a/x`; «@b/y»",
    "@a/x; ~~@b/y~~",
    "@a/x; **@b/y**",
    "@a/x [@b/y]",
    "@a/x <@b/y>",
    "`@nks/nks-dev` (**r5**); методология — **`@alari/methodology`**",
  ])
    none(ru(g), g);
});

test("Δ1: обрамление *, _, ~ — не обрамление: адрес не начинает слот, хвост в адрес не входит", () => {
  for (const g of ["_@a/x_", "**@a/x**", "~~@a/x~~", "`_@a/x_`", "**`@nks/nks-dev`** (`r5`)"])
    none(ru(g), g);
});

test("Δ2: голова — пара (slug, rN): разные rN при одном slug в скобках — неоднозначность", () => {
  for (const g of ["r5 (@a/x), r7 (@a/x)", "@a/x (r5), @a/x (r7)", "r5 (@a/x); r7 (@b/y)"])
    none(ru(g), g);
});

test("Δ3: строка продолжения YAML с адресом — неоднозначность; без адреса — как одна строка", () => {
  for (const raw of [
    "'**@a/x**,\n  @b/y'",
    "'@a/x,\n  @b/y'",
    "'@a/x (r5); методология\n  @alari/methodology'",
    "@a/x\n  r7",
  ])
    none(ruRaw(raw), raw);
  assert.deepEqual(ruRaw("'@a/x (r5); методология —\n  общий канон'"), at("@a/x"));
});

test("Δ4: адрес нераспознанного хвоста не выбирает граф и не дополняет пару", () => {
  for (const g of ["r5 [@b/y]", "@a/x [r5]", "@a/x (**r5**)", "r5 <@b/y>", "@a/x; **r7**"])
    none(ru(g), g);
  assert.deepEqual(ru("r5 [r5]"), at("r5"), "тот же адрес в хвосте — посадка, как на main");
  assert.deepEqual(ru("`@a/x` (`r5`) [@a/x]"), at("@a/x"));
});

test("Δ5: YAML-комментарии и пустые строки не продолжают значение", () => {
  const cover = (graph, role) =>
    seatOfPairs(frontMatter(`---\n'Граф': ${graph}\n'Роль агента': ${role}\n---\n`));
  assert.deepEqual(cover("'@a/x'", "'#931 «dev»'\n  #844 «соседняя роль»"), at("@a/x"));
  assert.deepEqual(cover("'@a/x'\n  # @b/y — прежний граф\n\n", "'#931 «dev»'"), at("@a/x"));
  assert.deepEqual(cover("'@a/x'\n    #r7", "'#931 «dev»'"), at("@a/x"));
});

test("Δ6: конечные точка и дефис не входят в slug", () => {
  for (const g of ["@a/x.", "@a/x-", "@a/x.-", "`@a/x.`", "@a/x (r5)."])
    assert.deepEqual(ru(g).realm, "@a/x", g);
  assert.deepEqual(ru("@a/x-y.").realm, "@a/x-y");
  none(ru("@a/x. @b/y"), "@a/x. @b/y");
});

test("EN-форма без слов-связок: разделители перечисляют так же", () => {
  none(en("@nks/nks-dev, @nks/drugoy"), "EN");
  none(en("`@a/x` (`r5`); **`@b/y`**"), "EN");
  assert.deepEqual(en("@nks/nks-dev (r5); methodology — @alari/methodology"), at("@nks/nks-dev"));
});
