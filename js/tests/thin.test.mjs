// Пробы тонкого моста (bridge/thin.ts) — шаг 1 шва «тонкий мост ↔ демон машины».
// Демон здесь — заглушка tests/fake-daemon.mjs: сторона демона на шве
// (shared/seam-host.ts) и сессия движка (bridge/session.ts) в её процессе.
// Тонкий мост сам поднимает её (ISKRON_BRIDGE_DAEMON_ENTRY), как поднимет демон.
//
// ISKRON_BRIDGE_PATH наводит пробы на другую копию: против моста без шва флаг
// ISKRON_BRIDGE_DAEMON молча пропускается, через заглушку не идёт ничего —
// та краснота, ради которой пробы написаны. Проба выключателя (NO_DAEMON)
// проверяет прежнее поведение и на старом мосте зелена.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(HERE, "..", "..", "skills", "establish-mcp", "scripts", "iskron.mjs");
const FAKE_DAEMON = join(HERE, "fake-daemon.mjs");
const PAT = "nks_pat_thin";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "thin-probe", version: "0" },
};
const THIN_ENV = {
  ISKRON_BRIDGE_DAEMON: "1",
  ISKRON_BRIDGE_DAEMON_ENTRY: FAKE_DAEMON,
  ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
};

function startBridge(serverUrl, authDir, env = {}) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  return {
    proc,
    get stderr() {
      return stderr;
    },
    send: (msg) => proc.stdin.write(JSON.stringify(msg) + "\n"),
    call(method, id, params = {}) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${id})`)), 20_000).unref();
      });
      this.send({ jsonrpc: "2.0", id, method, params });
      return p;
    },
    stop: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.kill("SIGKILL");
          }),
  };
}

const trailOf = (dir) => {
  try {
    return readFileSync(join(dir, "fake-daemon.log"), "utf8");
  } catch {
    return "";
  }
};
const daemonPids = (dir) => [...trailOf(dir).matchAll(/^pid (\d+) listening/gm)].map((m) => +m[1]);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(what, fn, ms = 10_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function withFake(fn) {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-thin-"));
  const bridges = [];
  const spawnBridge = (env) => {
    const b = startBridge(fake.mcpUrl, dir, env);
    bridges.push(b);
    return b;
  };
  try {
    await fn({ fake, dir, spawnBridge });
  } finally {
    await Promise.all(bridges.map((b) => b.stop()));
    for (const pid of daemonPids(dir)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

const toolNames = (r) => (r.result?.tools ?? []).map((t) => t.name);

async function session(b) {
  const init = await b.call("initialize", 1, INIT);
  b.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  const list = await b.call("tools/list", 2);
  const orient = await b.call("tools/call", 3, { name: "iskron_orient", arguments: {} });
  return { init, list, orient };
}

test("a call through the thin bridge answers as through the full bridge — and goes through the daemon", async () => {
  await withFake(async ({ dir, spawnBridge }) => {
    const full = await session(spawnBridge());
    const thinBridge = spawnBridge(THIN_ENV);
    const thin = await session(thinBridge);
    assert.deepEqual(thin.init.result, full.init.result, "the handshake answers the same");
    assert.deepEqual(toolNames(thin.list), toolNames(full.list), "the same tools are listed");
    assert.ok(thin.orient.result && !thin.orient.error, JSON.stringify(thin.orient));
    assert.deepEqual(thin.orient.result, full.orient.result, "the tool answers the same");
    assert.match(trailOf(dir), /^rpc tools\/call 3$/m, "the call went through the daemon");
    assert.match(thinBridge.stderr, /through the machine's bridge daemon v\S+-fake-daemon/);
  });
});

test("the daemon killed mid-call: the call gets a verdict, the next one answers after the reattach", async () => {
  await withFake(async ({ fake, dir, spawnBridge }) => {
    const b = spawnBridge(THIN_ENV);
    await session(b);
    const [first] = await waitFor("the daemon's pid", () => daemonPids(dir)[0] && daemonPids(dir));
    await fake.control({ listDelayMs: 4000 });
    const slow = b.call("tools/call", 10, {
      name: "iskron_channel",
      arguments: { action: "list", realm: "@tester/probe" },
    });
    await waitFor("the slow call at the daemon", () => /^rpc tools\/call 10$/m.test(trailOf(dir)));
    process.kill(first, "SIGKILL");
    const verdict = await slow;
    assert.ok(verdict.error, `a lost call is answered with an error: ${JSON.stringify(verdict)}`);
    assert.match(verdict.error.message, /daemon broke before the answer/);
    assert.match(
      verdict.error.message,
      /OUTCOME IS UNKNOWN/,
      "it went out: the outcome is unknown",
    );
    await fake.control({ listDelayMs: 0 });
    const next = await b.call("tools/call", 11, { name: "iskron_orient", arguments: {} });
    assert.ok(next.result && !next.error, `after the reattach: ${JSON.stringify(next)}`);
    const pids = daemonPids(dir);
    assert.equal(pids.length, 2, "a new daemon was raised");
    assert.ok(!pids.includes(undefined) && pids[1] !== first);
    assert.match(
      trailOf(dir).split(`pid ${pids[1]} listening`)[1],
      /^rpc initialize "iskron-thin-replay-1"$/m,
      "the new session got the harness's initialize replayed",
    );
  });
});

test("no daemon to be had: the full bridge runs in the process, and says so", async () => {
  await withFake(async ({ spawnBridge }) => {
    // Точка входа по умолчанию — сам мост; подкоманды daemon в этой сборке нет.
    const b = spawnBridge({ ISKRON_BRIDGE_DAEMON: "1", ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000" });
    const { init, list, orient } = await session(b);
    assert.ok(init.result, JSON.stringify(init));
    assert.ok(toolNames(list).length > 0, JSON.stringify(list));
    assert.ok(orient.result, JSON.stringify(orient));
    assert.match(b.stderr, /going as the full bridge inside this process/);
    // Ответ фейка на orient — без текста; слово ждёт первого ответа тула с текстом.
    const textOf = (r) => (r.result?.content ?? []).map((c) => c.text).join("\n");
    const write = { name: "iskron_add_phenomenon", arguments: { name: "probe" } };
    const first = await b.call("tools/call", 4, write);
    assert.match(textOf(first), /Создан узел/, JSON.stringify(first));
    assert.match(textOf(first), /runs as the full bridge in its own process/, "the answer says it");
    const again = await b.call("tools/call", 5, write);
    assert.match(textOf(again), /Создан узел/, JSON.stringify(again));
    assert.doesNotMatch(textOf(again), /runs as the full bridge/, "said once");
  });
});

test("ISKRON_BRIDGE_NO_DAEMON=1 — the full bridge, no daemon raised", async () => {
  await withFake(async ({ dir, spawnBridge }) => {
    const b = spawnBridge({ ...THIN_ENV, ISKRON_BRIDGE_NO_DAEMON: "1" });
    const { orient } = await session(b);
    assert.ok(orient.result, JSON.stringify(orient));
    assert.equal(existsSync(join(dir, "fake-daemon.log")), false, "no daemon was raised");
    assert.doesNotMatch(b.stderr, /daemon/);
  });
});

test("the harness leaves: bye ends the session in the daemon; a killed thin bridge ends it too", async () => {
  await withFake(async ({ dir, spawnBridge }) => {
    const polite = spawnBridge(THIN_ENV);
    await session(polite);
    const exited = new Promise((r) => polite.proc.once("exit", r));
    polite.proc.stdin.end();
    await exited;
    assert.match(trailOf(dir), /^end stdin closed, the harness is gone$/m, "bye carried the why");
    const [first] = daemonPids(dir);
    await waitFor("the daemon to leave with its session", () => !alive(first));

    const rude = spawnBridge(THIN_ENV);
    await session(rude);
    await waitFor("the second daemon", () => daemonPids(dir).length === 2);
    await rude.stop(); // SIGKILL
    await waitFor("the session to end on the closed seam", () =>
      /^end the thin bridge is gone \(seam closed without bye\)$/m.test(trailOf(dir)),
    );
  });
});

test("--version names both builds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-thin-"));
  const daemon = spawn(NODE, [FAKE_DAEMON, "daemon", "--auth-dir", dir], { stdio: "ignore" });
  try {
    await waitFor("the daemon to listen", () => daemonPids(dir).length === 1);
    const out = await new Promise((res, rej) =>
      execFile(
        NODE,
        [BRIDGE, "--version", "--auth-dir", dir],
        { env: { ...process.env, ISKRON_BRIDGE_DAEMON: "1", ISKRON_BRIDGE_NO_UPDATE: "1" } },
        (e, stdout) => (e ? rej(e) : res(stdout)),
      ),
    );
    const [own, theirs] = out.trim().split("\n");
    assert.match(own, /^v\d+\.\d+\.\d+\+[0-9a-f]{8}$/, "the first line is this build, as always");
    assert.match(theirs ?? "", new RegExp(`^daemon v\\S+-fake-daemon \\(pid ${daemon.pid}, `));
  } finally {
    daemon.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});
