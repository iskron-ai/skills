// Выходы под пробой — dev-сборка этой рабочей копии: make build-js кладёт её в
// dist/dev (вне индекса). Закоммиченные выходы — сборка выпуска, их пишет только джоб
// выпуска (#6650; #147 [140]); пробы гонят то, что собрано из js/ сейчас.
// ISKRON_BUILT_DIR — корень с закоммиченными выходами (релизный PR, #4309): та же
// раскладка, канал — выпуск.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Корень рабочей копии: в dev-дереве нет SKILL.md — набор скиллов пробы берут отсюда. */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BUILT = process.env.ISKRON_BUILT_DIR || join(REPO, "dist", "dev");
export const BUILT_CHANNEL = process.env.ISKRON_BUILT_DIR ? "release" : "dev";
export const BUILT_BRIDGE = join(BUILT, "skills", "establish-mcp", "scripts", "iskron.mjs");
export const BUILT_PLUGIN = join(BUILT, "skills", "establish-mcp", "scripts", "opencode-plugin.js");
export const BUILT_EXTENSION = join(BUILT, "extensions", "iskron.js");
export const BUILT_TEMPLATE = join(
  BUILT,
  "skills",
  "product-roadmap",
  "references",
  "roadmap-template.html",
);
