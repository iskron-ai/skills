import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { packOpencode } from "../../scripts/pack-opencode.mjs";
import { BUILT, BUILT_BRIDGE, BUILT_PLUGIN, REPO } from "./built.mjs";

test("release archive: exactly three npm-pack files with exact built bytes and delivery version", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-pack-"));
  const version = JSON.parse(readFileSync(join(REPO, ".claude-plugin/plugin.json"))).version;
  try {
    const opts = { built: BUILT, out: dir, tag: `v${version}` };
    assert.throws(() => packOpencode({ ...opts, tag: "v0.0.0" }), /tag must equal/);
    const archive = packOpencode(opts);
    assert.ok(archive.endsWith(`iskron-opencode-${version}.tgz`));
    assert.deepEqual(
      execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n").sort(),
      ["package/index.js", "package/iskron.mjs", "package/package.json"],
    );
    const unpack = join(dir, "unpack");
    mkdirSync(unpack);
    execFileSync("tar", ["-xzf", archive, "-C", unpack]);
    assert.deepEqual(readFileSync(join(unpack, "package/index.js")), readFileSync(BUILT_PLUGIN));
    assert.deepEqual(readFileSync(join(unpack, "package/iskron.mjs")), readFileSync(BUILT_BRIDGE));
    assert.deepEqual(JSON.parse(readFileSync(join(unpack, "package/package.json"))), {
      name: "@iskron/opencode",
      version,
      type: "module",
      main: "./index.js",
      exports: { ".": "./index.js" },
      files: ["index.js", "iskron.mjs"],
    });
    assert.throws(() => packOpencode(opts), /refusing to replace/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("release archive refuses stale built bytes before producing an asset", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-pack-stale-"));
  const version = JSON.parse(readFileSync(join(REPO, ".claude-plugin/plugin.json"))).version;
  const built = join(dir, "built");
  const scripts = join(built, "skills/establish-mcp/scripts");
  mkdirSync(scripts, { recursive: true });
  try {
    copyFileSync(BUILT_BRIDGE, join(scripts, "iskron.mjs"));
    const stale = readFileSync(BUILT_PLUGIN, "utf8").replace(
      `VERSION = "${version}";`,
      'VERSION = "0.0.0";',
    );
    writeFileSync(join(scripts, "opencode-plugin.js"), stale);
    assert.throws(
      () => packOpencode({ built, out: dir, tag: `v${version}` }),
      /built version mismatch/,
    );
    assert.equal(existsSync(join(dir, `iskron-opencode-${version}.tgz`)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
