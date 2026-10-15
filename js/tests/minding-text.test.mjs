// Text-contract checks, not an LLM simulation (graph r5, #2109, #2115–2119, #7707).
// Synthetic contrasts name why an anchor matters; no personal graph is read.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { clauses } from "./minding-clauses.mjs";
import { mutants } from "./minding-mutants.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const paths = {
  mind: "skills/minding/SKILL.md",
  personal: "skills/minding/references/personal-realm.md",
  door: "skills/iskron/SKILL.md",
  phrases: "skills/iskron/references/phrasebook.md",
  align: "skills/iskronify/SKILL.md",
  template: "skills/iskronify/references/agents-template.md",
  agents: "AGENTS.md",
};
const texts = Object.fromEntries(
  Object.entries(paths).map(([name, path]) => [
    name,
    process.env.MINDING_TEXT_REF
      ? execFileSync("git", ["show", `${process.env.MINDING_TEXT_REF}:${path}`], {
          cwd: root,
          encoding: "utf8",
        })
      : readFileSync(new URL(path, `file://${root}`), "utf8"),
  ]),
);

function checkClause(text, pattern, label) {
  assert.match(text, pattern, label);
}

for (const [label, file, pattern] of clauses) {
  test(`delivered text: ${label}`, () => {
    checkClause(texts[file], pattern, label);
  });
}

test("independent mutations of real instructions are rejected", () => {
  for (const [file, before, after] of mutants) {
    const changed = texts[file].replaceAll(before, after);
    assert.notEqual(changed, texts[file], `mutation was applied: ${before}`);
    const candidate = { ...texts, [file]: changed };
    assert.throws(
      () => {
        for (const [label, source, pattern] of clauses)
          checkClause(candidate[source], pattern, label);
      },
      assert.AssertionError,
      `reject changed condition: ${before}`,
    );
  }
});

const oldBlankets = [
  /влияющее на процесс и результат(?: разработки)?\s*—\s*(?:это )?(?:`?AGENTS\.md|сюда|этот файл)/iu,
  /промах\s*—\s*это ответ/iu,
  /этого в памяти нет/iu,
  /«всегда показывай план»[^\n]+влияет на процесс разработки: AGENTS\.md/iu,
];
function rejectBlankets(text) {
  for (const pattern of oldBlankets) assert.doesNotMatch(text, pattern);
}

test("all delivery routes reject old blanket formulas", () => {
  for (const text of Object.values(texts)) rejectBlankets(text);
  for (const old of [
    "влияющее на процесс и результат разработки — AGENTS.md репо",
    "промах — это ответ: этого в памяти нет",
  ]) {
    assert.throws(() => rejectBlankets(`${texts.mind}\n${old}`), assert.AssertionError);
  }
});

test("injected and bootstrap routes retain personal/project distinction", () => {
  for (const key of ["align", "template", "agents"]) {
    assert.match(texts[key], /Личное|Личн[а-я]+/u);
    assert.match(texts[key], /даже на тему разработки/u);
    assert.match(texts[key], /полномочи/u);
    assert.match(texts[key], /чисто проектная работа[^\n]+mind/u);
  }
  assert.match(texts.phrases, /личное рабочее предпочтение[^\n]+правило проекта/u);
});

test("minding description keeps recall triggers inside the delivery limit", () => {
  const description = texts.mind.split("\n").find((line) => line.startsWith("description:"));
  for (const trigger of [
    "вспомни",
    "что ты знаешь обо мне",
    "как в прошлый раз",
    "что на мне",
    "заведи мне память",
    "do you remember",
    "машины",
    "сроки",
    "люди",
    "Серверы, долги и факты проектов",
  ]) {
    assert.ok(description.includes(trigger), trigger);
  }
  assert.ok(Buffer.byteLength(description) < 900);
});
