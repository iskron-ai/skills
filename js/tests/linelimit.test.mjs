// The harness's line limit (bridge/linelimit.ts, graph @nks/nks-dev, node #11416): a stdio
// MCP client reads one JSON-RPC line into a fixed buffer, and a longer line kills its whole
// transport. A reply over the limit (1 MiB by default) comes back as one short refusal to
// the same id; the next call works; a reply under the limit passes untouched. The refusal
// says what is known: a result is carried out, an isError result may be partly applied,
// and a JSON-RPC error (its code named) applied nothing. Through the full bridge and through the thin
// bridge to the real daemon. ISKRON_BRIDGE_PATH points the probe at a past build: one from
// before the limit writes the 2 MiB line as is, one from before the outcome calls an error
// carried out — the reds this probe wants.
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
const BIG_REFUSAL = { ...text(2048 * KIB), isError: true };
const BIG_ERROR = { code: -32602, message: "x".repeat(2048 * KIB) };
// An error whose code is no number and too long to name in a short refusal.
const BIG_UNNAMED = { code: "x".repeat(64 * KIB), message: "x".repeat(2048 * KIB) };
/** What only the «carried out» verdict says — never of an isError result or an error. */
const APPLIED = { ru: /исполнен|применена/, en: /carried out|is applied/ };

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
    callResults: { iskron_orient: BIG, iskron_look: UNDER, iskron_search: BIG_REFUSAL },
    callErrors: { iskron_history: BIG_ERROR, iskron_admin: BIG_UNNAMED },
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
      assert.match(
        big.msg.error.message,
        /исполнен — запись, если это была запись, применена/,
        "a plain result was carried out, and the refusal says so",
      );
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

  test(`an oversized JSON-RPC error is refused as not applied and names its code (${path})`, async () => {
    await withHarness(daemon, {}, async (b) => {
      const err = await b.call("tools/call", { name: "iskron_history", arguments: {} });
      assert.ok(err.bytes < 4096, `a short line, not the answer: ${err.bytes} bytes`);
      assert.equal(err.msg.error?.code, -32001, JSON.stringify(err.msg));
      assert.doesNotMatch(err.msg.error.message, APPLIED.ru, "an error applied nothing");
      assert.match(err.msg.error.message, /ошибкой JSON-RPC \(код -32602\)/);
      assert.match(err.msg.error.message, /ничего не применено/);
      assert.match(err.msg.error.message, /fold=true/);
      const list = await b.call("tools/list");
      assert.ok(list.msg.result?.tools, "the transport is alive after the refusal");
    });
  });

  test(`an oversized isError result may have been partly applied (${path})`, async () => {
    await withHarness(daemon, {}, async (b) => {
      const ref = await b.call("tools/call", { name: "iskron_search", arguments: {} });
      assert.ok(ref.bytes < 4096, `a short line, not the answer: ${ref.bytes} bytes`);
      assert.equal(ref.msg.error?.code, -32001, JSON.stringify(ref.msg));
      assert.doesNotMatch(ref.msg.error.message, APPLIED.ru, "a refusal is not a confirmed write");
      assert.match(ref.msg.error.message, /ответил отказом, слишком длинным, чтобы его показать/);
      assert.match(
        ref.msg.error.message,
        /часть вызова могла примениться \(пачка отказывает и после части своих записей\) — перечитай цель, прежде чем повторять/,
      );
      assert.doesNotMatch(ref.msg.error.message, /ничего не применено/);
      assert.match(ref.msg.error.message, /fold=true/);
      const list = await b.call("tools/list");
      assert.ok(list.msg.result?.tools, "the transport is alive after the refusal");
    });
  });
}

test("in English an error applied nothing, a refusal may be partial, and a result is applied", async () => {
  await withHarness(false, { ISKRON_BRIDGE_LANG: "en" }, async (b) => {
    const err = await b.call("tools/call", { name: "iskron_history", arguments: {} });
    assert.match(err.msg.error.message, /JSON-RPC error \(code -32602\)/);
    assert.match(err.msg.error.message, /nothing was applied by this call/);
    assert.doesNotMatch(err.msg.error.message, APPLIED.en, "an error applied nothing");
    const ref = await b.call("tools/call", { name: "iskron_search", arguments: {} });
    assert.match(
      ref.msg.error.message,
      /a refusal too long to show: part of the call may have been applied \(a batch can refuse after some of its writes\) — re-read the target before retrying/,
    );
    assert.doesNotMatch(ref.msg.error.message, /nothing was applied/);
    assert.doesNotMatch(ref.msg.error.message, APPLIED.en, "a refusal is not a confirmed write");
    const big = await b.call("tools/call", { name: "iskron_orient", arguments: {} });
    assert.match(big.msg.error.message, /carried out — a write, if it was one, is applied/);
  });
});

test("a code too long to name stays out of the refusal: the line is still short", async () => {
  await withHarness(false, {}, async (b) => {
    const unnamed = await b.call("tools/call", { name: "iskron_admin", arguments: {} });
    assert.ok(unnamed.bytes < 4096, `a short line, not the code: ${unnamed.bytes} bytes`);
    assert.equal(unnamed.msg.error?.code, -32001, JSON.stringify(unnamed.msg).slice(0, 200));
    assert.match(unnamed.msg.error.message, /ошибкой JSON-RPC \(код \?\)/);
    assert.doesNotMatch(unnamed.msg.error.message, APPLIED.ru);
  });
});

test("BRIDGE_MAX_LINE_BYTES=0 lifts the limit: the 2 MiB answer goes through whole", async () => {
  await withHarness(false, { ISKRON_BRIDGE_MAX_LINE_BYTES: "0" }, async (b) => {
    const big = await b.call("tools/call", { name: "iskron_orient", arguments: {} });
    assert.deepEqual(big.msg.result, BIG);
  });
});
