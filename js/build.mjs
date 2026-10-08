#!/usr/bin/env node
// Сборка отгружаемого JS из единого исходника js/ (граф nks-dev: крия #4219).
//
//   node js/build.mjs          dev-сборка в dist/dev/ (вне индекса) — пробам и прогонам
//   ISKRON_BUILD_CHANNEL=release node js/build.mjs
//                              сборка выпуска на закоммиченные места — только джоб выпуска
//   node js/build.mjs --check  закоммиченные выходы — сборка выпуска; иначе — 1
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
/** Выходы сборки — пути от корня репо (закоммиченные) и от dist/dev (dev). */
const OUTPUTS = [
  "skills/establish-mcp/scripts/iskron.mjs",
  "extensions/iskron.js",
  "skills/establish-mcp/scripts/opencode-plugin.js",
  "skills/product-roadmap/references/roadmap-template.html",
];

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

async function bundleNode(entry, banner, external = []) {
  const r = await esbuild.build({
    ...common,
    entryPoints: [entry],
    platform: "node",
    format: "esm",
    target: "node22",
    banner: banner ? { js: banner } : undefined,
    external: ["@earendil-works/pi-coding-agent", ...external],
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

  // Один исполняемый файл на три node-процесса и doctor, в одном месте: путь
  // к нему печатает сам мост в ответе connect, и второй копии никто не называет.
  outputs.set(
    "skills/establish-mcp/scripts/iskron.mjs",
    await bundleNode("js/cli/main.ts", "#!/usr/bin/env node"),
  );

  // Расширение pi — ESM-модуль с default-экспортом; pi грузит .js из extensions/.
  outputs.set("extensions/iskron.js", await bundleNode("js/extension/main.ts"));

  // Плагин OpenCode — ESM-модуль формы OpenCode 2 без единого импорта: типы
  // @opencode/plugin стираются сборкой. Едет в establish-mcp, потому что
  // ставится тем же шагом, что и мост.
  outputs.set(
    "skills/establish-mcp/scripts/opencode-plugin.js",
    await bundleNode("js/opencode/plugin.ts"),
  );

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

// Канал сборки (граф nks-dev: #6650; #147 [140]): все каналы установки ставят main,
// значит закоммиченные выходы — всегда сборка выпуска; их пишет только джоб выпуска
// (bundle-sync: ISKRON_BUILD_CHANNEL=release). Рабочая копия собирает dev в DEV_DIR вне
// индекса — ею гонятся пробы и живые прогоны, и такой мост дом машины не освежает.
// Сверка: в закоммиченных байтах нет метки dev, у моста — метка выпуска.
// Метка — одним источником в слое поставки (js/delivery/version.ts, граф nks-dev: #6809).
const MARK_SOURCE = "js/delivery/version.ts";
const markDev = /^export const CHANNEL_MARK: string = "([^"]+:dev)";$/m.exec(
  readFileSync(join(ROOT, MARK_SOURCE), "utf8"),
)?.[1];
if (!markDev) throw new Error(`${MARK_SOURCE}: нет строки CHANNEL_MARK с меткой :dev`);
const DEV_MARK = `"${markDev}"`;
const RELEASE_MARK = `"${markDev.replace(/:dev$/, ":release")}"`;
const RELEASE = process.env.ISKRON_BUILD_CHANNEL === "release";
const DEV_DIR = join(ROOT, "dist", "dev");
const BRIDGE = "skills/establish-mcp/scripts/iskron.mjs";

// Наследие выпуска (#147 [145]): выпуски по 7.2.7 метки не несли, а main до первого
// выпуска с меткой несёт байты, закоммиченные прежним правилом (у моста — метка dev).
// Мост этой версии и старше — наследие: метки не судятся, судит только замок CI.
const LAST_UNMARKED = [7, 2, 7];
const versionOf = (text) =>
  /^(?:const|let|var)\s+VERSION\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m
    .exec(text ?? "")
    ?.slice(1)
    .map(Number);
const legacyBytes = (v) =>
  !!v && (v[0] - LAST_UNMARKED[0] || v[1] - LAST_UNMARKED[1] || v[2] - LAST_UNMARKED[2]) <= 0;

if (CHECK) {
  let bad = 0;
  const bridge = existsSync(join(ROOT, BRIDGE)) ? readFileSync(join(ROOT, BRIDGE), "utf8") : null;
  const legacy = legacyBytes(versionOf(bridge));
  for (const rel of OUTPUTS) {
    const path = join(ROOT, rel);
    const have = existsSync(path) ? readFileSync(path, "utf8") : null;
    const why =
      have === null
        ? "отсутствует"
        : legacy
          ? null
          : have.includes(DEV_MARK)
            ? "несёт метку dev"
            : rel === BRIDGE && !have.includes(RELEASE_MARK)
              ? "без метки выпуска"
              : null;
    if (why) {
      bad++;
      console.error(`✗ ${rel}: ${why} — его пишет make build-release (джоб выпуска)`);
    }
  }
  if (bad) process.exit(1);
  process.stdout.write(
    legacy
      ? `✓ ${OUTPUTS.length} закоммиченных выходов JS — наследие выпуска до меток (мост v${versionOf(bridge).join(".")})\n`
      : `✓ ${OUTPUTS.length} закоммиченных выходов JS — сборка выпуска, метки dev нет\n`,
  );
} else {
  const outputs = await produce();
  if ([...outputs.keys()].join() !== OUTPUTS.join())
    throw new Error(
      `выходы сборки разошлись со списком OUTPUTS: ${[...outputs.keys()].join(", ")}`,
    );
  if (!outputs.get(BRIDGE).includes(DEV_MARK))
    throw new Error(`iskron.mjs: нет метки канала ${DEV_MARK} (${MARK_SOURCE})`);
  const base = RELEASE ? ROOT : DEV_DIR;
  for (const [rel, built] of outputs) {
    const path = join(base, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, RELEASE ? built.replaceAll(DEV_MARK, RELEASE_MARK) : built);
  }
  process.stdout.write(
    `Built (${RELEASE ? "release, committed paths" : `dev, ${DEV_DIR}`}): ${[...outputs.keys()].join(" ")}\n`,
  );
}
