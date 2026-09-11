// Probe for the single shipped file's front door — subcommand dispatch, the
// build string, and `doctor` (graph nks-dev: bianhua #4220). `doctor` is the
// one command that answers, on the user's machine, "which build is standing
// here and does it work"; its whole value is that every line is a fact read
// now, so the probe checks the facts against a fake server and a scratch
// grant store, and that the run leaves both untouched.
//
// ISKRON_BRIDGE_PATH points the same probe at any copy so it can be shown red
// before a change — against the previous single-purpose bridge, `doctor` is
// read as a server URL and refused, which is exactly the red this probe wants.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

// Чем запускать поставку: node по умолчанию; ISKRON_NODE подставляет другой рантайм
// (например, `opencode` под BUN_BE_BUN=1 — Bun, встроенный в OpenCode).
const NODE = process.env.ISKRON_NODE || process.execPath;

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const PLUGIN = JSON.parse(
  readFileSync(join(HERE, "..", "..", ".claude-plugin", "plugin.json"), "utf8"),
);

function run(args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(NODE, [FILE, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("exit", (code) => resolve({ code, out, err }));
  });
}

test("--version names the plugin's version as the build, whichever subcommand asks", async () => {
  const re = new RegExp(`^v${PLUGIN.version.replaceAll(".", "\\.")}\\+[0-9a-f]{8}$`);
  const top = await run(["--version"]);
  assert.match(top.out.trim(), re, `top-level --version: ${top.out}`);
  const viaBridge = await run(["bridge", "--version"]);
  assert.equal(
    viaBridge.out.trim(),
    top.out.trim(),
    "the bridge subcommand must name the same build",
  );
});

test("--help lists every subcommand and exits 0", async () => {
  const r = await run(["--help"]);
  assert.equal(r.code, 0);
  for (const sub of ["bridge", "watchdog", "watchdog-exit", "doctor"]) {
    assert.ok(r.out.includes(sub), `usage does not mention ${sub}`);
  }
});

test("doctor: names the build, the server, an empty grant — and writes nothing", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const authDir = join(home, ".iskron-bridge");
  try {
    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home });
    assert.equal(r.code, 0, `doctor exited ${r.code}: ${r.err}`);
    assert.match(
      r.out,
      /iskron doctor — v\d+\.\d+\.\d+\+[0-9a-f]{8}/,
      "the first line must name the build",
    );
    assert.ok(r.out.includes(`сервер: ${fake.mcpUrl}`), "the server must be named as given");
    assert.match(
      r.out,
      /отвечает: HTTP 401 \(просит OAuth\)/,
      "an unauthenticated ping must read as the server asking for OAuth",
    );
    assert.match(
      r.out,
      /token endpoint http:\/\/127\.0\.0\.1:\d+\/token/,
      "discovery must name the token endpoint it found",
    );
    assert.match(
      r.out,
      /хранилища нет/,
      "with no store the grant must read as absent, not as broken",
    );
    assert.match(
      r.out,
      /домашняя копия: нет/,
      "a home without a bridge copy is named, not assumed",
    );
    assert.ok(
      !readdirSync(home).includes(".iskron-bridge") || readdirSync(authDir).length === 0,
      "doctor must not create a grant store or a log",
    );
  } finally {
    await fake.stop();
  }
});

test("doctor: reads an existing grant without touching it, and sees the home copy", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  const authDir = join(home, ".iskron-bridge");
  try {
    // Let a real bridge run lay down the store: initialize once, no browser.
    const bridge = spawn(
      process.execPath,
      [FILE, fake.mcpUrl, "--no-browser", "--auth-dir", authDir],
      {
        env: { ...process.env, HOME: home },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let first = "";
    const firstReply = new Promise((res) =>
      bridge.stdout.on("data", (c) => {
        first += c;
        if (first.includes("\n")) res(first);
      }),
    );
    bridge.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      }) + "\n",
    );
    await firstReply;
    // Open the login link as a human would: the sign-in page is minted then, and
    // the client registration with it (#4794) — the client doctor must report.
    const link = /(http:\/\/127\.0\.0\.1:\d+\/login\?k=[\w-]+)/.exec(first)?.[1];
    assert.ok(link, `the bridge must hand out a login link: ${first}`);
    await (await fetch(link, { redirect: "manual" })).text();
    // The bridge outlives a pending login on purpose (the human may be mid-click),
    // so a polite stdin close would wait for that flow; the store is already
    // written by discovery, and the probe only needs the store.
    bridge.kill("SIGKILL");
    await new Promise((res) => bridge.on("exit", res));
    const files = readdirSync(authDir);
    const storeFile = files.find((f) => f.endsWith(".json"));
    assert.ok(storeFile, `the bridge left no store in ${authDir}: ${files.join(", ")}`);
    const before = readFileSync(join(authDir, storeFile), "utf8");
    // A home copy that differs from the packaged file, with a readable version.
    writeFileSync(
      join(authDir, "iskron-bridge.mjs"),
      '#!/usr/bin/env node\nconst VERSION = "0.0.1";\n',
    );

    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", authDir], { HOME: home });
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /грант: .*\.json/, "the store path must be named");
    assert.match(r.out, /client_id: /, "the registered client must be reported");
    assert.match(
      r.out,
      /домашняя копия: .*v0\.0\.1\+[0-9a-f]{8}, ДРУГИЕ байты/,
      "a diverged home copy must be named with its version and hash",
    );
    assert.equal(
      readFileSync(join(authDir, storeFile), "utf8"),
      before,
      "doctor must leave the store byte-identical",
    );
  } finally {
    await fake.stop();
  }
});

// A regular install keeps the bridge entry in the plugin manifests, not in the
// user's config, and the Codex home is wherever CODEX_HOME points (graph
// @nks/nks-dev, node #4279). doctor must see the plugins, not report "no entry".
test("doctor: sees the bridge entry inside the Claude Code and Codex plugins, not only the user configs", async () => {
  const fake = await startFakeNks();
  const home = mkdtempSync(join(tmpdir(), "iskron-doctor-"));
  try {
    const install = join(home, ".claude", "plugins", "cache", "iskron", "iskron", "9.9.9");
    mkdirSync(install, { recursive: true });
    writeFileSync(
      join(install, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          iskron: {
            command: "node",
            args: ["${CLAUDE_PLUGIN_ROOT}/skills/establish-mcp/scripts/iskron.mjs"],
          },
        },
      }),
    );
    writeFileSync(
      join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: { "iskron@iskron": [{ scope: "user", installPath: install, version: "9.9.9" }] },
      }),
    );
    const codexHome = join(home, "cxh");
    const codexPlugin = join(codexHome, "plugins", "cache", "iskron", "iskron", ".codex-plugin");
    mkdirSync(codexPlugin, { recursive: true });
    writeFileSync(
      join(codexPlugin, "plugin.json"),
      JSON.stringify({
        name: "iskron",
        version: "9.9.9",
        mcpServers: {
          iskron: {
            command: "node",
            args: ["./skills/establish-mcp/scripts/iskron.mjs"],
            cwd: ".",
          },
        },
      }),
    );

    const r = await run(["doctor", fake.mcpUrl, "--auth-dir", join(home, ".iskron-bridge")], {
      HOME: home,
      CODEX_HOME: codexHome,
    });
    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      /Claude Code: плагин iskron@iskron v9\.9\.9 \(user\) — запись «iskron» → мост из плагина/,
      `the plugin-scoped entry must be reported: ${r.out}`,
    );
    assert.match(
      r.out,
      /Codex: плагин iskron@iskron — v9\.9\.9, запись моста в манифесте есть/,
      `the Codex plugin under CODEX_HOME must be reported: ${r.out}`,
    );
    assert.doesNotMatch(
      r.out,
      /Claude Code: в пользовательском конфиге записи моста нет/,
      "a healthy install must not be reported as having no entry",
    );
  } finally {
    await fake.stop();
  }
});

test("doctor with a personal access token names its source and judges it by a live handshake", async () => {
  const fake = await startFakeNks({ pat: "nks_pat_doc" });
  const dir = mkdtempSync(join(tmpdir(), "iskron-doctor-pat-"));
  try {
    const good = await run(["doctor", fake.mcpUrl, "--auth-dir", dir], {
      ISKRON_BRIDGE_TOKEN: "nks_pat_doc",
    });
    assert.equal(good.code, 0, good.err);
    assert.match(good.out, /грант: личный токен \(PAT\) из ISKRON_BRIDGE_TOKEN/);
    assert.match(good.out, /токен принят сервером/);
    assert.equal(readdirSync(dir).length, 0, "doctor must write nothing");
    const bad = await run(["doctor", fake.mcpUrl, "--auth-dir", dir], {
      ISKRON_BRIDGE_TOKEN: "nks_pat_wrong",
    });
    assert.match(bad.out, /ТОКЕН ОТВЕРГНУТ/);
  } finally {
    await fake.stop();
  }
});
