// Exercise the shipped plugin in an npm-shaped directory, with no home install.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { startFakeNks } from "./fake-nks.mjs";

register("./opencode-loader.mjs", import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE =
  process.env.ISKRON_OPENCODE_PLUGIN ||
  join(HERE, "../../skills/establish-mcp/scripts/opencode-plugin.js");

test("npm plugin uses its bundled bridge, keeps updates child-local, and adds bundled skills once", async () => {
  const root = mkdtempSync(join(tmpdir(), "iskron-npm-"));
  const home = join(root, "home");
  const pkg = join(root, "package");
  const scripts = join(pkg, "skills/establish-mcp/scripts");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(home, ".iskron-bridge"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "@iskron/opencode", type: "module" }),
  );
  copyFileSync(SOURCE, join(scripts, "opencode-plugin.js"));
  const log = join(root, "child-env.json");
  writeFileSync(
    join(scripts, "iskron.mjs"),
    `import {writeFileSync} from 'node:fs';\n` +
      `writeFileSync(${JSON.stringify(log)}, JSON.stringify({noUpdate: process.env.ISKRON_BRIDGE_NO_UPDATE}));\n` +
      readFileSync(join(HERE, "fake-bridge.mjs"), "utf8").replace(/^#!.*\n/, ""),
  );
  writeFileSync(join(home, ".iskron-bridge/iskron-bridge.mjs"), "process.exit(99)");
  const keys = ["HOME", "ISKRON_BRIDGE_PATH", "ISKRON_BRIDGE_AUTH_DIR", "ISKRON_BRIDGE_NO_UPDATE"];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  process.env.ISKRON_BRIDGE_AUTH_DIR = join(home, "auth");
  delete process.env.ISKRON_BRIDGE_PATH;
  delete process.env.ISKRON_BRIDGE_NO_UPDATE;
  let hooks;
  try {
    const factory = (await import(pathToFileURL(join(scripts, "opencode-plugin.js")))).default;
    hooks = await factory({ client: { tui: { showToast: async () => ({}) } } });
    assert.ok(hooks.tool.iskron_orient, "tools must load without a separately installed bridge");
    assert.deepEqual(JSON.parse(readFileSync(log)), { noUpdate: "1" });
    assert.equal(
      process.env.ISKRON_BRIDGE_NO_UPDATE,
      undefined,
      "do not change OpenCode's environment",
    );
    const config = { skills: { paths: ["/existing"], urls: ["https://example.org/skills"] } };
    await hooks.config(config);
    await hooks.config(config);
    assert.deepEqual(config.skills.paths, ["/existing", realpathSync(join(pkg, "skills"))]);
    assert.deepEqual(config.skills.urls, ["https://example.org/skills"]);
  } finally {
    await hooks?.dispose?.();
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("npm pack contains the bridge and skills, not development or install scripts", async () => {
  const root = join(HERE, "../..");
  const release = JSON.parse(
    readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"),
  ).version;
  const version = `${release}-test.pack.${process.pid}`;
  execFileSync(process.execPath, [join(root, "js/pack-opencode.mjs"), version], { cwd: root });
  const archive = join(root, `dist/iskron-opencode-${version}.tgz`);
  try {
    const files = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
    for (const required of [
      "package.json",
      "skills/iskron/SKILL.md",
      "skills/establish-mcp/scripts/iskron.mjs",
      "skills/establish-mcp/scripts/opencode-plugin.js",
    ])
      assert.ok(files.includes(`package/${required}`), required);
    assert.ok(files.every((p) => !/node_modules|\.env|\.git|^package\/js\//.test(p)));
    const manifest = JSON.parse(
      execFileSync("tar", ["-xOzf", archive, "package/package.json"], { encoding: "utf8" }),
    );
    assert.equal(manifest.name, "@iskron/opencode");
    assert.equal(manifest.version, version);
    assert.equal(manifest.scripts, undefined);
    assert.equal(manifest.devDependencies, undefined);
    assert.equal(manifest.exports["."], manifest.main);
    assert.ok(manifest.dependencies["@opencode-ai/plugin"]);
    assert.match(manifest.dependencies["@opencode-ai/plugin"], /^\d+\.\d+\.\d+$/);
    const unpack = mkdtempSync(join(root, "dist/npm-doctor-"));
    const fake = await startFakeNks({ pat: "fixture" });
    try {
      execFileSync("tar", ["-xzf", archive, "-C", unpack]);
      const home = join(unpack, "home");
      mkdirSync(join(home, ".config/opencode"), { recursive: true });
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [join(unpack, "package/skills/establish-mcp/scripts/iskron.mjs"), "doctor", fake.mcpUrl],
        {
          env: {
            ...process.env,
            HOME: home,
            ISKRON_BRIDGE_AUTH_DIR: join(home, "auth"),
            ISKRON_BRIDGE_TOKEN: "fixture",
          },
        },
      );
      assert.match(stdout, /OpenCode: npm/);
      assert.doesNotMatch(stdout, /плагина нет|её кладёт establish-mcp|cp "/);
    } finally {
      await fake.stop();
      rmSync(unpack, { recursive: true, force: true });
    }
  } finally {
    rmSync(archive);
  }
});

test("stable npm pack refuses an untagged or dirty release tree", () => {
  const root = join(HERE, "../..");
  const release = JSON.parse(
    readFileSync(join(root, ".claude-plugin/plugin.json"), "utf8"),
  ).version;
  let exactRelease = false;
  try {
    exactRelease =
      execFileSync("git", ["describe", "--tags", "--exact-match", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim() === `v${release}`;
  } catch {
    // An untagged feature commit is the ordinary test case.
  }
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  if (exactRelease && !dirty) return;
  const result = spawnSync(process.execPath, [join(root, "js/pack-opencode.mjs")], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stable package(?: .*?)? must be built from/);
});
