// Пробы тонкого моста (bridge/thin.ts) на шве «тонкий мост ↔ демон машины».
// Демон — настоящий (bridge/daemon.ts, `iskron.mjs daemon`): тонкий мост сам
// поднимает его своей копией, журнал демона — <грант>/run/daemon.log (с
// ISKRON_BRIDGE_DAEMON_TRACE — и методы rpc). Заглушка tests/fake-daemon.mjs
// осталась там, где настоящему нечего показать без шва для проб: обрыв шва
// посреди вызова при живой сессии и окружение, которое видит сессия.
// Пробы многих сессий одного демона, смерти и обновления демона — daemon.test.mjs.
//
// ISKRON_BRIDGE_PATH наводит пробы на другую копию: против моста без шва флаг
// ISKRON_BRIDGE_DAEMON молча пропускается, против моста шага 1 подкоманда daemon
// отказывает — через демон не идёт ничего, та краснота, ради которой пробы
// написаны. Проба выключателя (NO_DAEMON) проверяет прежнее поведение и на
// старом мосте зелена.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
// Настоящий демон: тонкий мост поднимает его своей копией.
const REAL_ENV = {
  ISKRON_BRIDGE_DAEMON: "1",
  ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
  ISKRON_BRIDGE_DAEMON_TRACE: "1",
};
// Демона не поднять: точки входа нет — процесс демона умирает сразу.
const NO_DAEMON_ENV = {
  ISKRON_BRIDGE_DAEMON: "1",
  ISKRON_BRIDGE_DAEMON_ENTRY: join(HERE, "no-such-daemon.mjs"),
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
  const all = []; // всё, что харнес получил, — для счёта ответов на один id
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
      all.push(msg);
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
    all,
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
// Журнал настоящего демона и его pid по строкам «listening».
const journalOf = (dir) => {
  try {
    return readFileSync(join(dir, "run", "daemon.log"), "utf8");
  } catch {
    return "";
  }
};
const realPids = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);
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
    for (const pid of [...daemonPids(dir), ...realPids(dir)]) {
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
    const thinBridge = spawnBridge(REAL_ENV);
    const thin = await session(thinBridge);
    assert.deepEqual(thin.init.result, full.init.result, "the handshake answers the same");
    assert.deepEqual(toolNames(thin.list), toolNames(full.list), "the same tools are listed");
    assert.ok(thin.orient.result && !thin.orient.error, JSON.stringify(thin.orient));
    assert.deepEqual(thin.orient.result, full.orient.result, "the tool answers the same");
    assert.match(journalOf(dir), /\] rpc tools\/call 3$/m, "the call went through the daemon");
    assert.match(
      thinBridge.stderr,
      /through the machine's bridge daemon v\d+\.\d+\.\d+\+\S+ \(pid/,
    );
  });
});

test("the daemon killed mid-call: the call gets a verdict, the next one answers after the reattach", async () => {
  await withFake(async ({ fake, dir, spawnBridge }) => {
    const b = spawnBridge(REAL_ENV);
    await session(b);
    const [first] = await waitFor("the daemon's pid", () => realPids(dir)[0] && realPids(dir));
    await fake.control({ listDelayMs: 4000 });
    const slow = b.call("tools/call", 10, {
      name: "iskron_channel",
      arguments: { action: "list", realm: "@tester/probe" },
    });
    await waitFor("the slow call at the daemon", () =>
      /\] rpc tools\/call 10$/m.test(journalOf(dir)),
    );
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
    const pids = realPids(dir);
    assert.equal(pids.length, 2, "a new daemon was raised");
    assert.ok(!pids.includes(undefined) && pids[1] !== first);
    const after = journalOf(dir)
      .split(/\n/)
      .filter((l) => l.includes(` pid=${pids[1]} `));
    assert.ok(
      after.some((l) => /\] rpc initialize "iskron-thin-replay-1"$/.test(l)),
      `the new session got the harness's initialize replayed:\n${after.join("\n")}`,
    );
  });
});

// Шов порвался, а демон и сессия живы: вызов уже закрыт вердиктом, и настоящий
// ответ, пришедший после переподхвата, — второй ответ на один id. Харнес его
// видеть не должен (ревью #272, п.1).
test("a seam cut mid-call, the session resumed: one id, one answer", async () => {
  await withFake(async ({ fake, dir, spawnBridge }) => {
    const b = spawnBridge({ ...THIN_ENV, ISKRON_FAKE_DAEMON_CUT: "iskron_channel" });
    await session(b);
    await fake.control({ listDelayMs: 1200 });
    const verdict = await b.call("tools/call", 10, {
      name: "iskron_channel",
      arguments: { action: "list", realm: "@tester/probe" },
    });
    assert.match(verdict.error?.message ?? "", /daemon broke before the answer/);
    await waitFor("the resume", () => /— resumed/.test(b.stderr));
    await new Promise((r) => setTimeout(r, 2000)); // настоящий ответ успел бы прийти
    assert.match(trailOf(dir), /^cut 10$/m, "the seam was cut mid-call");
    const answers = b.all.filter((m) => m.id === 10);
    assert.equal(answers.length, 1, `one answer for id 10, got ${JSON.stringify(answers)}`);
    const next = await b.call("tools/call", 11, { name: "iskron_orient", arguments: {} });
    assert.ok(next.result && !next.error, JSON.stringify(next));
  });
});

test("no daemon to be had: the full bridge runs in the process, and says so", async () => {
  await withFake(async ({ spawnBridge }) => {
    // Точки входа демона нет: поднятый процесс умирает сразу.
    const b = spawnBridge(NO_DAEMON_ENV);
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
    const env = { ...REAL_ENV, ISKRON_BRIDGE_DAEMON_IDLE_MS: "300" };
    const polite = spawnBridge(env);
    await session(polite);
    const exited = new Promise((r) => polite.proc.once("exit", r));
    polite.proc.stdin.end();
    await exited;
    assert.match(
      journalOf(dir),
      /session \S+ ended: stdin closed, the harness is gone$/m,
      "bye carried the why",
    );
    const [first] = realPids(dir);
    await waitFor("the daemon to leave after its idle window", () => !alive(first));

    const rude = spawnBridge(env);
    await session(rude);
    await waitFor("the second daemon", () => realPids(dir).length === 2);
    await rude.stop(); // SIGKILL
    await waitFor("the session to end on the closed seam", () =>
      /session \S+ ended: the thin bridge is gone \(seam closed without bye\)$/m.test(
        journalOf(dir),
      ),
    );
  });
});

test("--version names both builds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-thin-"));
  const daemon = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1" },
    stdio: "ignore",
  });
  try {
    await waitFor("the daemon to listen", () => realPids(dir).length === 1);
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
    assert.match(
      theirs ?? "",
      new RegExp(`^daemon ${own.replace("+", "\\+")} \\(pid ${daemon.pid}, `),
    );
  } finally {
    daemon.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- ревью #272: вход, токен, окружение, замок подъёма, Ctrl-C --------------------

// Демон, поднятый не тонким мостом, — со своим окружением (как демон, живущий дольше харнеса).
// Настоящий — файлом моста; заглушка — где пробе нужно видеть окружение сессии.
async function startDaemon(dir, env, file = BRIDGE) {
  const d = spawn(NODE, [file, "daemon", "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...env },
    stdio: "ignore",
  });
  await waitFor("the daemon to listen", () =>
    (file === BRIDGE ? realPids(dir) : daemonPids(dir)).includes(d.pid),
  );
  return d;
}

test("a daemon signing in with another personal token refuses the session; the bridge goes full and says why", async () => {
  await withFake(async ({ dir, spawnBridge }) => {
    await startDaemon(dir, { ISKRON_BRIDGE_TOKEN: "nks_pat_someone_else" });
    const b = spawnBridge(REAL_ENV);
    const { orient } = await session(b);
    assert.ok(orient.result, JSON.stringify(orient));
    assert.match(b.stderr, /refused this bridge: .*personal token differs/);
    assert.match(b.stderr, /going as the full bridge inside this process/);
  });
});

test("the session's env replaces the daemon's own session keys, not merges into them", async () => {
  await withFake(async ({ dir, spawnBridge }) => {
    await startDaemon(dir, { ISKRON_BRIDGE_TOKEN: PAT, ISKRON_STALE_MARK: "1" }, FAKE_DAEMON);
    await session(spawnBridge({ ...THIN_ENV, HARNESS_OTHER: "1" }));
    assert.match(
      trailOf(dir),
      /^env stale=false harness_other=false token_in_hello=false$/m,
      "a key the harness did not name is gone; the session gets its env only, and no token over the seam",
    );
  });
});

test("an entrance open to others is not used: the full bridge, with the reason, no daemon raised", async () => {
  await withFake(async ({ dir, spawnBridge }) => {
    mkdirSync(join(dir, "run"), { mode: 0o755 });
    chmodSync(join(dir, "run"), 0o755);
    const b = spawnBridge(THIN_ENV);
    const { orient } = await session(b);
    assert.ok(orient.result, JSON.stringify(orient));
    assert.match(b.stderr, /the daemon's entrance is not private \(.*открыт группе или прочим/);
    assert.equal(existsSync(join(dir, "fake-daemon.log")), false, "no daemon was raised");
  });
});

test(
  "a raise lock the disk refuses sends the bridge full at once, with the reason",
  {
    skip: process.getuid?.() === 0 && "root writes anywhere",
  },
  async () => {
    await withFake(async ({ dir, spawnBridge }) => {
      mkdirSync(join(dir, "run"), { mode: 0o500 });
      chmodSync(join(dir, "run"), 0o500);
      try {
        const started = Date.now();
        const b = spawnBridge(THIN_ENV); // ожидание демона — 10 с; ждать тут нечего
        const { orient } = await session(b);
        assert.ok(orient.result, JSON.stringify(orient));
        assert.match(b.stderr, /cannot raise the bridge daemon for .*(EACCES|permission denied)/i);
        assert.ok(Date.now() - started < 5000, "not after the whole wait");
      } finally {
        chmodSync(join(dir, "run"), 0o700);
      }
    });
  },
);

test("Ctrl-C of the thin bridge gone full leaves at once, as the full bridge does — even with a login out", async () => {
  const fake = await startFakeNks({});
  const dir = mkdtempSync(join(tmpdir(), "iskron-thin-"));
  const b = startBridge(fake.mcpUrl, dir, {
    ISKRON_BRIDGE_TOKEN: "", // вход по OAuth: initialize оставит логин ждать клика
    ...NO_DAEMON_ENV,
  });
  try {
    const init = await b.call("initialize", 1, INIT);
    assert.match(init.error?.message ?? "", /login|127\.0\.0\.1/i, JSON.stringify(init));
    assert.match(b.stderr, /going as the full bridge inside this process/);
    const exited = new Promise((r) => b.proc.once("exit", r));
    const t0 = Date.now();
    b.proc.kill("SIGINT");
    await Promise.race([
      exited,
      new Promise((_, rej) => setTimeout(() => rej(new Error("still up 5s after Ctrl-C")), 5000)),
    ]);
    assert.ok(Date.now() - t0 < 5000);
  } finally {
    await b.stop();
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
