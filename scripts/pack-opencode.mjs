#!/usr/bin/env node
// Additional release asset, not an npm publication (graph @nks/nks-dev, #4901).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function packOpencode({ root = ROOT, built = root, out, tag }) {
  const version = JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8")).version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(tag, `v${version}`, "tag must equal the checked-out delivery version");
  const source = readFileSync(join(root, "js/delivery/version.ts"), "utf8");
  assert.ok(source.includes(`export const VERSION = "${version}";`), "delivery version mismatch");
  mkdirSync(out, { recursive: true });
  const target = join(out, `iskron-opencode-${version}.tgz`);
  assert.ok(!existsSync(target), `refusing to replace ${target}`);
  const stage = mkdtempSync(join(out, ".opencode-pack-"));
  try {
    const files = { "index.js": "opencode-plugin.js", "iskron.mjs": "iskron.mjs" };
    for (const [to, from] of Object.entries(files)) {
      const file = join(built, "skills/establish-mcp/scripts", from);
      const bytes = readFileSync(file);
      assert.match(bytes.toString(), new RegExp(`(?:var|let|const) VERSION = "${version.replaceAll(".", "\\.")}";`), `${from}: built version mismatch`);
      copyFileSync(file, join(stage, to));
    }
    writeFileSync(join(stage, "package.json"), JSON.stringify({
      name: "@iskron/opencode", version, type: "module", main: "./index.js",
      exports: { ".": "./index.js" }, files: ["index.js", "iskron.mjs"],
    }, null, 2) + "\n");
    const [packed] = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--offline"], {
      cwd: stage, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }));
    assert.deepEqual(packed.files.map((f) => f.path).sort(), ["index.js", "iskron.mjs", "package.json"]);
    renameSync(join(stage, packed.filename), target);
    return target;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tag, out, built] = process.argv.slice(2);
  assert.ok(tag && out, "usage: node scripts/pack-opencode.mjs vX.Y.Z output-dir [built-root]");
  console.log(packOpencode({ tag, out: resolve(out), ...(built ? { built: resolve(built) } : {}) }));
}
