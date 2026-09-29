#!/usr/bin/env node
// Render skills/widgets/SKILL.md from fixtures/widgets.json — the widget
// contract as the graph holds it (graph nks-dev: #6146, #6190). The head of the
// skill is written here; each widget's section is built from its node's body
// (КОГДА СТАВИТЬ, ФОРМА, Пример, ЧТО ВИДИТ ЧЕЛОВЕК), so a widget added or
// changed in the graph reaches the skill by `make widgets`, never by hand.
//
//   node scripts/render-widgets.mjs          write the skill
//   node scripts/render-widgets.mjs --check  fail when the committed skill differs
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { root } from "./bridge-stdio.mjs";

const snap = JSON.parse(readFileSync(join(root, "fixtures/widgets.json"), "utf8"));
const out = join(root, "skills/widgets/SKILL.md");

/** One widget node's body, cut into the parts the skill prints. */
function parse(w) {
  // Граф в примерах узлов — конкретный (r5); у читателя скилла граф свой: rN.
  const body = w.body.replace(/\r/g, "").replace(/\br\d+\b/g, "rN");
  const id = /Виджет `([^`]+)`/.exec(body)?.[1];
  const title = /Виджет `[^`]+` — ([^\n.]+)/.exec(body)?.[1];
  const when = /КОГДА СТАВИТЬ:\s*([\s\S]*?)\n\n/.exec(body)?.[1];
  const form = /ФОРМА[^\n]*:\n`([^`]+)`/.exec(body)?.[1];
  const params = [...(/ФОРМА[^\n]*:\n`[^`]+`\n((?:— .*\n)+)/.exec(body)?.[1] ?? "").matchAll(/— (.*)/g)].map(
    (m) => m[1],
  );
  const example = /Пример: `([^`]+)`/.exec(body)?.[1];
  const sees = /ЧТО ВИДИТ ЧЕЛОВЕК:\s*([\s\S]*?)\s*$/.exec(body)?.[1];
  const missing = Object.entries({ id, title, when, form, example, sees })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`widget node #${w.seq}: body lacks ${missing.join(", ")}`);
  return { id, title, when, form, params, example, sees };
}

const fence = "```";
const section = (p) =>
  [
    `## \`${p.id}\` — ${p.title}`,
    "",
    `**Когда:** ${p.when}`,
    "",
    `**Форма:** \`${p.form}\``,
    ...p.params.map((x) => `- ${x}`),
    "",
    "Пример:",
    "",
    `${fence}iskron`,
    p.example,
    fence,
    "",
    `**Человек увидит:** ${p.sees}`,
    "",
  ].join("\n");

const widgets = snap.widgets.map(parse);
const names = widgets.map((w) => w.id).join(", ");

const skill = `---
name: widgets
slash: true
description: "Живые виджеты окна Искрона вместо пересказа — только там, где ответ рисует окно Искрона: агент дома, окно графа. Триггеры: «покажи дела графа», «какие дела открыты», «дела этого узла», «карточка дела №N», «где сейчас стоит дело», «кто из агентов активен», «кто сейчас работает в графе», «чем заняты агенты», «что в работе». Ставит один из виджетов ${names} блоком с меткой iskron и параметром realm. В Claude Code, телеграме и прочих, где блок покажется кодом, — не грузить."
---

# Виджеты окна Искрона

Виджет — огороженный блок кода с меткой \`iskron\`. Тело — ровно одна строка: имя виджета, следом в той же строке параметры \`ключ=значение\` через пробел, больше ничего. Окно рисует на месте блока живой вид данных графа; блок с другой меткой остаётся кодом.

- **Граф — всегда явно:** \`realm=rN\`, короткий id графа, тот же, что в ссылках «rN#N»; \`realm=@owner/slug\` — только если другой формы ты не видел. Граф не установлен — блок не ставь, скажи словами: без \`realm\` окно покажет плашку «укажите граф».
- **Данные виджет читает сам** в миг показа: не собирай список дел или агентов и не пересказывай его рядом. Что в деле затык и почему — пишется словами рядом с виджетом.
- **Канонические формы** — \`case №N\`, \`node=#N\`: окно терпит и \`case N\`, \`node=N\`, но пиши канон.
- **Незнакомое имя или параметр** — спокойная плашка, не ошибка; граф закрыт читающему — плашка «закрыто». Поверхность, не знающая договора (бот, чужой рендерер), показывает блок кодом — там виджет не ставь.

Пример блока:

${fence}iskron
${widgets[0].example}
${fence}

${widgets.map(section).join("\n")}`;

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(out, "utf8");
  } catch {}
  if (committed !== skill) {
    console.error(
      "skills/widgets/SKILL.md differs from fixtures/widgets.json — run `node scripts/render-widgets.mjs` (after `make widgets` when the graph moved)",
    );
    process.exit(1);
  }
  console.log(`widgets skill matches the snapshot: ${names}`);
} else {
  writeFileSync(out, skill);
  console.log(`wrote ${out}: ${names}`);
}
