// Проба языка поставки (граф nks-dev: #6080, дело №155): всё, что мост, сторожа и
// cli печатают агенту или человеку, говорит через L() (shared/lang.ts) — русский
// литерал вне L() в js/bridge, js/shared, js/watchdog, js/cli есть дефект. Литерал
// вправе остаться, когда он сверяется с прозой сервера (регулярное выражение,
// includes) или лежит в словаре, который по языку не выбирают: строка или строка
// над ней несёт пометку `// ru:server`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIRS = ["bridge", "shared", "watchdog", "cli"];
const CYRILLIC = /[А-Яа-яЁё]/;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(join(dir, e.name))
      : e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")
        ? [join(dir, e.name)]
        : [],
  );
}

function underL(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && p.expression.text === "L")
      return true;
    if (ts.isNewExpression(p) && p.expression.getText() === "RegExp") return true;
  }
  return false;
}

function strays(file) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  // Файл-словарь: русская таблица с английской рядом, язык выбирают снаружи.
  if (/^\/\/ ru:dict\b/m.test(text)) return [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const visit = (node) => {
    const literal =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (literal && CYRILLIC.test(node.text) && !underL(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line;
      const marked = (i) => /\/\/ ru:server/.test(lines[i] ?? "");
      if (!marked(line) && !marked(line - 1)) found.push(`${relative(ROOT, file)}:${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

test("no Russian literal outside L() in the bridge, shared, watchdog and cli sources", () => {
  const found = DIRS.flatMap((d) => files(join(ROOT, d))).flatMap(strays);
  assert.equal(
    found.length,
    0,
    `${found.length} Russian literals outside L():\n${found.join("\n")}`,
  );
});
