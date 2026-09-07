#!/usr/bin/env node
// Сборка отгружаемого JS из единого исходника js/ (граф nks-dev: крия #4219).
//
//   node scripts/build-js.mjs          собрать выходы и положить их на место
//   node scripts/build-js.mjs --check  собрать во временную память и сверить с
//                                      закоммиченными байтами; расхождение — 1
//
// Выходы — производные артефакты, как зипы .skill: правь js/, не их.
// Детерминизм держится тем, что esbuild закреплён лок-файлом, пути в выходе
// относительны absWorkingDir, карт исходников нет и минификации нет: файл,
// который потребитель откроет глазами, должен читаться, а хеш его байт
// различает сборки между релизами.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const common = {
  bundle: true,
  write: false,
  absWorkingDir: ROOT,
  legalComments: "none",
  sourcemap: false,
  minify: false,
  charset: "utf8",
  logLevel: "silent",
};

async function bundleNode(entry, banner) {
  const r = await esbuild.build({
    ...common,
    entryPoints: [entry],
    platform: "node",
    format: "esm",
    target: "node22",
    banner: banner ? { js: banner } : undefined,
    external: ["@earendil-works/pi-coding-agent"],
    outfile: "out.mjs",
  });
  return r.outputFiles[0].text;
}

async function bundleBrowser(entry) {
  const r = await esbuild.build({
    ...common,
    entryPoints: [entry],
    platform: "browser",
    format: "iife",
    target: "es2022",
    outfile: "out.js",
  });
  return r.outputFiles[0].text;
}

const RENDER_MARK = "/*@@RENDER@@*/";

async function produce() {
  const outputs = new Map();

  // Один исполняемый файл на три node-процесса и doctor — в оба скилла, которым
  // он нужен: каждый скилл ставится и порознь, и тем же файлом.
  const cli = await bundleNode("js/cli/iskron.ts", "#!/usr/bin/env node");
  outputs.set("skills/establish-mcp/scripts/iskron.mjs", cli);
  outputs.set("skills/standing/scripts/iskron.mjs", cli);

  // Расширение pi — ESM-модуль с default-экспортом; pi грузит .js из extensions/.
  outputs.set("extensions/iskron.js", await bundleNode("js/extension/iskron.ts"));

  // Рендер роадмапа инлайнится в html-шаблон на месте метки; data-объект
  // ROADMAP остаётся отдельным <script> — его и только его заменяет скилл.
  const template = readFileSync(join(ROOT, "js/roadmap/template.html"), "utf8");
  if (!template.includes(RENDER_MARK))
    throw new Error(`js/roadmap/template.html: нет метки ${RENDER_MARK}`);
  const render = await bundleBrowser("js/roadmap/main.ts");
  outputs.set(
    "skills/product-roadmap/references/roadmap-template.html",
    template.replace(RENDER_MARK, () => render.trimEnd()),
  );
  return outputs;
}

const outputs = await produce();
let bad = 0;
for (const [rel, text] of outputs) {
  const path = join(ROOT, rel);
  if (CHECK) {
    const have = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (have !== text) {
      bad++;
      console.error(
        `✗ ${rel}: ${have === null ? "отсутствует" : "расходится с пересборкой из js/"} — прогони 'make build-js' и закоммить`,
      );
    }
  } else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
}
if (CHECK) {
  if (bad) process.exit(1);
  process.stdout.write(`✓ ${outputs.size} выходов отгружаемого JS побайтово равны сборке из js/\n`);
} else {
  process.stdout.write(`Built: ${[...outputs.keys()].join(" ")}\n`);
}
