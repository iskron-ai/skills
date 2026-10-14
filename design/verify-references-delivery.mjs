#!/usr/bin/env node
// Соответствие механической правки доставки references (граф @nks/nks-dev, #7597) прежнему
// тексту: части, склеенные без строки-указателя, и перенесённые строки, склеенные по переносам,
// дают побайтно текст базовой ревизии. Запуск из корня репо: node design/verify-references-delivery.mjs [база]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "0f58444a";
const old = (rel) => execFileSync("git", ["show", `${base}:${rel}`], { encoding: "utf8" });
const now = (rel) => readFileSync(rel, "utf8");
const problems = [];
const report = [];

// Части: у каждой первая строка — указатель, затем дословный кусок и один завершающий перевод строки.
function joinParts(rels) {
  return rels.map((r) => now(r).split("\n").slice(1).join("\n").replace(/\n$/, "")).join("\n");
}

// Склейка переносов: продолжение — строка новой версии с отступом пункта, склеенная пробелом.
function unwrapAgainst(oldText, newText, rel) {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  let j = 0;
  let wrapped = 0;
  for (let i = 0; i < a.length; i++) {
    if (b[j] === a[i]) {
      j++;
      continue;
    }
    const ind = (/^(\s*)([-*+] |\d+[.)] )/.exec(b[j] ?? "")?.[0] ?? "").replace(/./g, " ");
    let acc = b[j++] ?? "";
    while (acc.length < a[i].length && j < b.length && b[j].startsWith(ind)) {
      acc += " " + b[j++].slice(ind.length);
      if (acc === a[i]) break;
    }
    if (acc !== a[i]) {
      problems.push(`${rel}: строка ${i + 1} базы не восстанавливается из новой версии`);
      return;
    }
    wrapped++;
  }
  if (j !== b.length) problems.push(`${rel}: в новой версии лишние строки после ${j}`);
  const long = b.filter((l) => l.length > 2000).length;
  if (long) problems.push(`${rel}: строк длиннее 2000 знаков — ${long}`);
  report.push(`${rel}: перенесено строк базы ${wrapped}, строк длиннее 2000 — ${long}`);
}

for (const [rel, parts] of [
  ["skills/iskronify/references/delegation.md", ["skills/iskronify/references/delegation-1.md", "skills/iskronify/references/delegation-2.md"]],
  ["skills/standing/references/channel.md", ["skills/standing/references/channel-1.md", "skills/standing/references/channel-2.md"]],
]) {
  unwrapAgainst(old(rel), joinParts(parts), `${rel} ← ${parts.length} части`);
}
for (const rel of ["skills/iskron/references/cases.md", "skills/iskronify/references/hooks.md"]) {
  unwrapAgainst(old(rel), now(rel), rel);
}

// Фильтр пуша в собственных хуках репо несёт тот же перенос, что шаблон hooks.md (jq пробелы
// между определениями не различает): прочие команды побайтно прежние.
const cmds = (t) => JSON.stringify(JSON.parse(t), null, 0).match(/"command":"(?:[^"\\]|\\.)*"/g).map((x) => JSON.parse(x.slice(10)));
const before = cmds(old(".claude/settings.json"));
const after = cmds(now(".claude/settings.json"));
if (before.length !== after.length) problems.push(".claude/settings.json: число команд хуков изменилось");
let changed = 0;
before.forEach((c, i) => {
  if (after[i] === c) return;
  changed++;
  if (after[i].replace(";\ndef ", "; def ") !== c) problems.push(`.claude/settings.json: команда ${i + 1} изменилась не только переносом`);
});
report.push(`.claude/settings.json: команд с переносом ${changed}`);

for (const r of report) console.log(r);
if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(`✓ соответствие базе ${base}`);
