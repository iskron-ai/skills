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
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const PLUGIN = JSON.parse(
  readFileSync(join(HERE, "..", "..", ".claude-plugin", "plugin.json"), "utf8"),
);

function run(args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [FILE, ...args], {
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
    bridge.stdin.end();
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
