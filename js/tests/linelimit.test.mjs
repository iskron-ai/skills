// The harness's line limit (bridge/linelimit.ts, graph @nks/nks-dev, node #11416): a stdio
// MCP client reads one JSON-RPC line into a fixed buffer, and a longer line kills its whole
// transport. A reply over the limit (1 MiB by default) comes back as one short refusal to
// the same id; the next call works; a reply under the limit passes untouched. Through the
// full bridge and through the thin bridge to the real daemon. ISKRON_BRIDGE_PATH points the
// probe at a past build, which writes the 2 MiB line as is — the red this probe wants.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "nks_pat_linelimit";
const KIB = 1024;
const text = (bytes) => ({ content: [{ type: "text", text: "x".repeat(bytes) }] });
const BIG = text(2048 * KIB);
const UNDER = text(900 * KIB);

function harness(url, dir, daemon, env = {}) {
  const proc = spawn(
    process.env.ISKRON_NODE || process.execPath,
    [BRIDGE, url, "--no-browser", "--auth-dir", dir],
    {
      env: {
        ...process.env,
        ISKRON_BRIDGE_TOKEN: PAT,
        ISKRON_BRIDGE_NO_UPDATE: "1",
        ISKRON_BRIDGE_LANG: "ru",
        ISKRON_BRIDGE_DAEMON: daemon ? "1" : "0",
        ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
        ...env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let pending = Buffer.alloc(0);
  let stderr = "";
  const lines = []; // every line the harness got: { id, bytes, msg }
  const waits = new Map();
  proc.stderr.on("data", (c) => (stderr += c));
  proc.stdout.on("data", (c) => {
    pending = Buffer.concat([pending, c]);
    let nl;
    while ((nl = pending.indexOf(10)) >= 0) {
      const raw = pending.subarray(0, nl);
      pending = pending.subarray(nl + 1);
      if (!raw.length) continue;
      const msg = JSON.parse(raw.toString("utf8"));
      lines.push({ id: msg.id, bytes: raw.length, msg });
      const w = waits.get(msg.id);
      if (w) {
        waits.delete(msg.id);
        clearTimeout(w.timer);
        w.resolve({ bytes: raw.length, msg });
      }
    }
  });
  let id = 0;
  return {
    lines,
    stderr: () => stderr,
    call(method, params = {}) {
      const next = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`silent ${method}: ${stderr}`)), 20000);
        waits.set(next, { resolve, timer });
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: next, method, params }) + "\n");
      });
    },
    async stop() {
      for (const w of waits.values()) clearTimeout(w.timer);
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      await new Promise((r) => {
        proc.once("exit", r);
        proc.kill("SIGKILL");
      });
    },
  };
}

async function withHarness(daemon, env, fn) {
  const fake = await startFakeNks({
    pat: PAT,
    callResults: { iskron_orient: BIG, iskron_look: UNDER },
  });
  const dir = mkdtempSync(join(tmpdir(), "iskron-linelimit-"));
  const b = harness(fake.mcpUrl, dir, daemon, env);
  try {
    const init = await b.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "linelimit-probe", version: "0" },
    });
    assert.ok(init.msg.result && !init.msg.error, JSON.stringify(init.msg));
    await fn(b);
  } finally {
    await b.stop();
    let journal = "";
    try {
      journal = readFileSync(join(dir, "run", "daemon.log"), "utf8");
    } catch {}
    for (const m of journal.matchAll(/ pid=(\d+) \S+ listening /g)) {
      try {
        process.kill(+m[1], "SIGKILL");
      } catch {}
    }
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const daemon of [false, true]) {
  const path = daemon ? "thin bridge → real daemon" : "full stdio bridge";
  test(`a 2 MiB reply is one short refusal to its id, the next call works, 900 KiB passes untouched (${path})`, async () => {
    await withHarness(daemon, {}, async (b) => {
      const big = await b.call("tools/call", { name: "iskron_orient", arguments: {} });
      assert.ok(big.bytes < 4096, `a short line, not the answer: ${big.bytes} bytes`);
      assert.equal(big.msg.result, undefined, "no result goes through");
      assert.equal(big.msg.error?.code, -32001, JSON.stringify(big.msg));
      assert.match(
        big.msg.error.message,
        /ответ сервера — 2\.0 МБ, больше предела строки харнеса \(1\.0 МБ\)/,
      );
      assert.match(big.msg.error.message, /Ничего не сломалось/);
      assert.match(big.msg.error.message, /fold=true/);
      const under = await b.call("tools/call", { name: "iskron_look", arguments: {} });
      assert.deepEqual(under.msg.result, UNDER, "the 900 KiB answer arrives whole");
      const list = await b.call("tools/list");
      assert.ok(list.msg.result?.tools, "the transport is alive after the refusal");
      assert.equal(
        b.lines.filter((l) => l.id === big.msg.id).length,
        1,
        "exactly one reply to the oversized call",
      );
      assert.match(b.stderr(), /over the harness's line limit of 1048576 — refused in its place/);
      if (daemon) assert.match(b.stderr(), /through the machine's bridge daemon/);
    });
  });
}

test("BRIDGE_MAX_LINE_BYTES=0 lifts the limit: the 2 MiB answer goes through whole", async () => {
  await withHarness(false, { ISKRON_BRIDGE_MAX_LINE_BYTES: "0" }, async (b) => {
    const big = await b.call("tools/call", { name: "iskron_orient", arguments: {} });
    assert.deepEqual(big.msg.result, BIG);
  });
});
