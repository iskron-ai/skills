// Shipped CLI entries and preservation at an unsupported cover (#9786).
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import { COVER, repo } from "./rites-kit.mjs";

const bridge = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const warning =
  "Контракт 38 больше не поддерживается; старые хуки не удалены. Выполните полный прогон iskronify до 40; ритуалы будут приняты после проверки";
const old = COVER.replace("contract: 39", "contract: 38");
const envFor = (home) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  CODEX_HOME: join(home, ".codex"),
  ISKRON_BRIDGE_AUTH_DIR: join(home, "auth"),
  ISKRON_BRIDGE_TOKEN: "",
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_DAEMON: "0",
  ISKRON_BRIDGE_LANG: "ru",
});
const run = (dir, env, args) =>
  spawnSync(process.execPath, [bridge, ...args], {
    cwd: dir,
    env,
    encoding: "utf8",
    input: "",
    timeout: 10000,
  });
const snapshot = (root, dir = root) =>
  Object.fromEntries(
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? [
            [relative(root, join(dir, e.name)), "directory"],
            ...Object.entries(snapshot(root, join(dir, e.name))),
          ]
        : [[relative(root, join(dir, e.name)), readFileSync(join(dir, e.name)).toString("base64")]],
    ),
  );

test("prepare preserves unsupported hooks/guard bytes and never silently bumps the stamp", () => {
  const dir = repo({ agents: old, rituals: true });
  execFileSync("git", ["init", "-q", dir]);
  const home = join(dir, "home");
  mkdirSync(home);
  const env = envFor(home);
  // Make the existing guard exactly prepare's own form, but with older words.
  const first = run(dir, env, ["prepare", "--json"]);
  assert.ok([0, 3].includes(first.status), first.stderr);
  const file = join(dir, ".claude", "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  s.hooks.PreToolUse[0].hooks[0].command = s.hooks.PreToolUse[0].hooks[0].command.replace(
    "BLOCKED",
    "OLD BLOCKED",
  );
  s.hooks.SessionStart = [
    {
      matcher: "startup",
      hooks: [{ type: "command", command: "echo 'read the iskron door Start'" }],
    },
  ];
  s.hooks.PostToolUse = [
    { matcher: "Bash", hooks: [{ type: "command", command: "echo unrelated-personal-hook" }] },
  ];
  writeFileSync(file, JSON.stringify(s));
  const files = ["AGENTS.md", ".claude/settings.json", ".opencode/plugins/iskron-rituals.js"];
  const before = files.map((f) => readFileSync(join(dir, f)));
  const r = run(dir, env, ["prepare", "--json"]);
  assert.equal(r.status, 3, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.warnings, [warning]);
  assert.equal(out.cover.contract, "38");
  assert.equal(out.cover.stamp, "2026-11-03");
  files.forEach((f, i) => assert.deepEqual(readFileSync(join(dir, f)), before[i], f));
  const plain = run(dir, env, ["prepare"]);
  assert.equal(plain.stdout.split(warning).length - 1, 1);
});

test("doctor warns once and does not write the repository or its isolated home", async () => {
  const fake = await startFakeNks();
  const dir = repo({ agents: old, rituals: true });
  const home = join(dir, "home");
  mkdirSync(home);
  const before = snapshot(dir);
  try {
    const r = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [bridge, "doctor", fake.mcpUrl], {
        cwd: dir,
        env: envFor(home),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (x) => (stdout += x));
      child.stderr.on("data", (x) => (stderr += x));
      child.on("error", reject);
      child.on("exit", (status) => resolve({ status, stdout, stderr }));
    });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.split(warning).length - 1, 1);
    assert.deepEqual(snapshot(dir), before);
  } finally {
    await fake.stop();
  }
});
