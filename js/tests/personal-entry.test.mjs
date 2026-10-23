// Text contract, not an API or model run (graph @nks/nks-dev, node #8200).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO } from "./built.mjs";

const root = process.env.MINDING_ENTRY_ROOT || REPO;
const files = {
  mind: "skills/minding/SKILL.md",
  reference: "skills/minding/references/personal-realm.md",
  onboarding: "skills/onboarding/SKILL.md",
};
const texts = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(join(root, path), "utf8")]),
);
const cases = [
  ["personal mind is always addressed as mind", "mind", 'Пиши `realm="mind"` во всех вызовах'],
  ["no handle, no constructed address", "onboarding", "Адрес личного графа — всегда `mind`"],
  [
    "refusal is not absence",
    "mind",
    "Отказ доступа, транспорта или неоднозначная ошибка не подтверждают отсутствие",
  ],
  ["missing role is not missing realm", "reference", "нехватка карт означает существующий граф"],
  [
    "repeat create rereads after conflict",
    "reference",
    "Конфликт 409, таймаут или неизвестный исход → перечитай readiness прежде повторения",
  ],
  [
    "repeat role provisioning reuses",
    "reference",
    "прочти и переиспользуй подходящую, не заводи вторую",
  ],
  [
    "no persistent locator",
    "mind",
    "не читай, не записывай и не сохраняй специальные properties/attrs профиля, узлов или графов, конфиг, агентскую память либо перенаправляющий узел",
  ],
  [
    "no progress marker",
    "onboarding",
    "Признаки прохождения не читаются и не записываются в свойства и атрибуты",
  ],
  [
    "structural facts need no receipt",
    "onboarding",
    "Структурному признаку достаточно существования предмета с нужной принадлежностью или связью: отдельная квитанция поверх этого не нужна",
  ],
  [
    "another member cannot confer progress",
    "onboarding",
    "чужая роль или квитанция не засчитываются текущему человеку",
  ],
  [
    "persona is not a progress predicate",
    "onboarding",
    "Действующая роль ассистента в сессии не входит в признаки прохождения онбординга",
  ],
  [
    "operational persona is preserved",
    "reference",
    "`persona=companion` различает действующую роль для приёма и цикла ассистента",
  ],
  [
    "cleanup requires provenance",
    "reference",
    "история создания которой доказывает служебный локатор или маркер прогресса",
  ],
];

function checkClause(text, key, clause) {
  assert.ok(text.includes(clause), `${files[key]}: ${clause}`);
}

// Negative control: MINDING_ENTRY_ROOT on old copies of the sources (REALITY.md).
for (const [name, key, clause] of cases) {
  test(`personal entry text: ${name}`, () => {
    checkClause(texts[key], key, clause);
  });
}

const stale = /@<?handle>?\/mind|\*\*стаб на|\b(?:features\.)?items\[key=personal_mind\]/;
function checkRecipes(text, key) {
  assert.doesNotMatch(text, stale, key);
}
test("sources carry no constructed address, redirect recipe or assumed envelope", () => {
  for (const [key, text] of Object.entries(texts)) checkRecipes(text, key);
});
test("negative controls reject the old address and redirect recipe", () => {
  checkRecipes(texts.mind, "mind");
  for (const recipe of [
    'realm="@<handle>/mind"',
    "оставь **стаб на личном адресе",
    "features.items[key=personal_mind]",
  ])
    assert.throws(() => checkRecipes(texts.mind + recipe, "mind"), { code: "ERR_ASSERTION" });
});
