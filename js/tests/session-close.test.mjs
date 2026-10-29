// Мост, уходя или меняя сессию, закрывает свою сессию MCP: DELETE на тот же адрес с её
// Mcp-Session-Id (спека MCP; граф @nks/nks-dev, вимарша #9174, сессия — #188), один раз,
// ограниченно по времени, id и исход — в grant.log. ISKRON_BRIDGE_PATH наводит пробы на
// другую копию моста — сборку до правки, чтобы увидеть их красными.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const PAT = "pat-session-close";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-harness", version: "0" },
};

function startBridge(url, dir, env = {}) {
  const proc = spawn(NODE, [BRIDGE, url, "--no-browser", "--auth-dir", dir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_DAEMON: "0", // полный мост в процессе
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT, // личный токен — без входа OAuth
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
      waiters.get(msg.id)?.(msg);
      waiters.delete(msg.id);
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  const exited = new Promise((r) => proc.once("exit", r));
  return {
    get stderr() {
      return stderr;
    },
    exited,
    call(method, id, params = {}) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${id})`)), 15_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return p;
    },
    /** The harness goes away: stdin closes; resolves with how long the exit took, ms. */
    async leave() {
      const t0 = Date.now();
      proc.stdin.end();
      await exited;
      return Date.now() - t0;
    },
    kill: () => (proc.exitCode === null && proc.signalCode === null ? proc.kill("SIGKILL") : null),
  };
}

async function withFake(t, opts, fn) {
  const fake = await startFakeNks({ pat: PAT, ...opts });
  const dir = mkdtempSync(join(tmpdir(), "iskron-session-close-"));
  const bridges = [];
  try {
    await fn({
      fake,
      dir,
      spawnBridge: (env) => {
        const b = startBridge(fake.mcpUrl, dir, env);
        bridges.push(b);
        return b;
      },
    });
  } finally {
    for (const b of bridges) b.kill();
    for (const m of journal(dir).matchAll(/ pid=(\d+) \S+ listening /g)) {
      try {
        process.kill(+m[1], "SIGKILL"); // the machine daemon a thin bridge raised
      } catch {}
    }
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function waitFor(check, what, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const readOr = (path) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
};
const grantLog = (dir) => readOr(join(dir, "grant.log"));
const journal = (dir) => readOr(join(dir, "run", "daemon.log"));

/** Open the bridge's session and return the id the fake issued for it. */
async function opened(fake, bridge, id = 1) {
  const before = new Set(fake.state.sessions);
  const r = await bridge.call("initialize", id, INIT);
  assert.ok(r.result, `рукопожатие: ${JSON.stringify(r)}`);
  const fresh = [...fake.state.sessions].filter((s) => !before.has(s));
  assert.equal(fresh.length, 1, "рукопожатие открывает одну сессию");
  return fresh[0];
}

test("уходя, мост закрывает свою сессию: DELETE с её id и токеном, id и исход — в grant.log", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    const sid = await opened(fake, bridge);
    assert.ok((await bridge.call("tools/list", 2)).result, "вызов в сессии");
    await bridge.leave();
    assert.deepEqual(
      fake.state.deletes.map((d) => d.sid),
      [sid],
      "на выходе — ровно один DELETE с id своей сессии",
    );
    assert.equal(fake.state.deletes[0].bearer, PAT, "DELETE несёт ключ, которым сессия открыта");
    assert.equal(fake.state.deletes[0].protocol, "2025-06-18", "и версию протокола сессии");
    assert.ok(!fake.state.sessions.has(sid), "сессия на сервере закрыта");
    assert.match(grantLog(dir), new RegExp(`${sid}.*204`), "id и исход закрытия — в grant.log");
  });
});

test("сессия демона машины закрывается, когда уходит её тонкий мост; демон пишет это в журнал", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge({
      ISKRON_BRIDGE_DAEMON: "1",
      ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
    });
    const sid = await opened(fake, bridge);
    assert.match(bridge.stderr, /through the machine's bridge daemon/, "сессия идёт через демон");
    await bridge.leave();
    await waitFor(() => fake.state.deletes.length > 0, "DELETE сессии демона");
    assert.deepEqual(
      fake.state.deletes.map((d) => d.sid),
      [sid],
      "демон закрыл ровно сессию ушедшего моста",
    );
    await waitFor(() => new RegExp(`${sid} .*204`).test(journal(dir)), "строки в daemon.log");
  });
});

test("демон, остановленный при живом тонком мосте, закрывает его сессию после передачи", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge({
      ISKRON_BRIDGE_DAEMON: "1",
      ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
    });
    const sid = await opened(fake, bridge);
    const pid = Number(/ pid=(\d+) \S+ listening /.exec(journal(dir))?.[1]);
    assert.ok(pid, "pid демона в журнале");
    process.kill(pid, "SIGTERM");
    await waitFor(() => fake.state.deletes.some((d) => d.sid === sid), "DELETE сессии демона");
    assert.equal(
      fake.state.deletes.filter((d) => d.sid === sid).length,
      1,
      "один DELETE на сессию",
    );
  });
});

test("повторное рукопожатие харнеса под живой сессией закрывает прежнюю", async (t) => {
  await withFake(t, {}, async ({ fake, spawnBridge }) => {
    const bridge = spawnBridge();
    const first = await opened(fake, bridge, 1);
    const second = await opened(fake, bridge, 2);
    assert.notEqual(first, second);
    await waitFor(() => fake.state.deletes.length > 0, "DELETE прежней сессии");
    assert.deepEqual(
      fake.state.deletes.map((d) => d.sid),
      [first],
      "замена сессии закрывает прежнюю, новую не трогает",
    );
    assert.ok(fake.state.sessions.has(second), "новая сессия жива");
    await bridge.leave();
    assert.deepEqual(
      fake.state.deletes.map((d) => d.sid),
      [first, second],
      "на выходе закрыта и новая — по одному DELETE на сессию",
    );
  });
});

test("сессия, которую сервер уже забыл (404), не закрывается повторно; на выходе — только новая", async (t) => {
  await withFake(t, {}, async ({ fake, spawnBridge }) => {
    const bridge = spawnBridge();
    const dead = await opened(fake, bridge);
    await fake.control({ kill_session: true }); // простой за порогом — сессии больше нет
    assert.ok((await bridge.call("tools/list", 2)).result, "вызов после 404 проходит в новой");
    const live = [...fake.state.sessions];
    assert.equal(live.length, 1, "мост открыл новую сессию");
    await bridge.leave();
    assert.deepEqual(
      fake.state.deletes.map((d) => d.sid),
      live,
      `DELETE только новой сессии, мёртвая ${dead} не закрывается`,
    );
  });
});

test("отказ DELETE не роняет выход и не повторяется", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    const sid = await opened(fake, bridge);
    await fake.control({ deleteStatus: 500 });
    await bridge.leave();
    await new Promise((r) => setTimeout(r, 300)); // повтор, будь он, успел бы
    assert.deepEqual(
      fake.state.deletes.map((d) => d.sid),
      [sid],
      "один DELETE, без повтора",
    );
    assert.match(grantLog(dir), new RegExp(`${sid}.*500`), "отказ назван в grant.log");
  });
});

test("молчащий DELETE не держит выход дольше своего срока", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    const sid = await opened(fake, bridge);
    await fake.control({ deleteHangMs: 30_000 });
    const took = await bridge.leave();
    assert.ok(took < 10_000, `выход висел на сети ${took}ms`);
    assert.equal(fake.state.deletes.length, 1, "один DELETE, без повтора");
    assert.match(
      grantLog(dir),
      new RegExp(`${sid}.*no answer within`),
      "молчание названо в grant.log",
    );
  });
});
