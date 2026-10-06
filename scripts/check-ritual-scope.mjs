#!/usr/bin/env node
// Ревизор области плагинов ритуалов OpenCode этой рабочей копии: та же
// подкоманда моста `check-rituals` (js/cli/rituals.ts), из dev-сборки dist/dev.
//
//   node scripts/check-ritual-scope.mjs [репо...] [--json]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bridge = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
  "dev",
  "skills",
  "establish-mcp",
  "scripts",
  "iskron.mjs",
);
if (!existsSync(bridge)) {
  console.error(`нет dev-сборки моста (${bridge}) — сперва make build-js`);
  process.exit(2);
}
const r = spawnSync(
  process.execPath,
  [bridge, "check-rituals", ...process.argv.slice(2)],
  {
    stdio: "inherit",
  },
);
process.exit(r.status ?? 1);
