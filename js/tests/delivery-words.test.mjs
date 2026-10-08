// Словари слоя поставки (граф @nks/nks-dev: #6806, #6809): каждый словарь под
// js/delivery/words несёт каждый язык LANGS одним набором ключей, и каждое слово —
// функция: ядро зовёт слово выбранного языка, не проверяя, есть ли оно.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { LANGS } from "../delivery/lang.ts";
import { REPO } from "./built.mjs";

const DIR = join(REPO, "js", "delivery", "words");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

test("the delivery layer has word dictionaries", () => {
  assert.ok(FILES.length > 0, `no dictionaries under ${DIR}`);
});

for (const file of FILES) {
  test(`${file}: every dictionary has the same keys in every language, and every word is a function`, async () => {
    const mod = await import(pathToFileURL(join(DIR, file)).href);
    const dicts = Object.entries(mod);
    assert.ok(dicts.length > 0, `${file} exports no dictionary`);
    for (const [name, dict] of dicts) {
      assert.deepEqual(
        Object.keys(dict).sort(),
        [...LANGS].sort(),
        `${file} ${name}: languages are not exactly LANGS`,
      );
      const [first, ...rest] = LANGS;
      const keys = Object.keys(dict[first]).sort();
      assert.ok(keys.length > 0, `${file} ${name}.${first} is empty`);
      for (const l of rest)
        assert.deepEqual(
          Object.keys(dict[l]).sort(),
          keys,
          `${file} ${name}: ${l} keys differ from ${first}`,
        );
      for (const l of LANGS)
        for (const k of keys)
          assert.equal(
            typeof dict[l][k],
            "function",
            `${file} ${name}.${l}.${k} is not a function`,
          );
      // An English word speaks no Russian (graph @nks/nks-dev, node #6633): every
      // word called with Latin placeholders gives no Cyrillic.
      if (!LANGS.includes("en")) continue;
      for (const k of keys) {
        const fn = dict.en[k];
        const out = String(fn(...Array.from({ length: fn.length }, (_, i) => `x${i}`)));
        assert.doesNotMatch(out, /\p{Script=Cyrillic}/u, `${file} ${name}.en.${k}: ${out}`);
      }
    }
  });
}
