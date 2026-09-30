// Пробы демона машины (bridge/daemon.ts) — шаг 2 шва «тонкий мост ↔ демон»:
// много сессий в одном демоне, каждая в своей области (shared/scope.ts); смерть
// демона посреди вызова; обновление демона при живых сессиях; окно простоя.
// Демон настоящий — `iskron.mjs daemon`; тонкие мосты поднимают его своей
// копией (ISKRON_BRIDGE_DAEMON=1) либо проба поднимает его сама.
//
// ISKRON_BRIDGE_PATH наводит пробы на другую копию: у моста шага 1 подкоманда
// daemon отказывает — тонкие мосты идут полными каждый в своём процессе, и
// каждая проба здесь краснеет на том, что через один демон не идёт ничего.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const PAT = "nks_pat_daemon";
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "daemon-probe", version: "0" },
};
// Клиент уведомлений: кадр места доходит харнесу уведомлением MCP, а не сторожем.
const INIT_PI = { ...INIT, clientInfo: { name: "pi-iskron", version: "0" } };
const REAL_ENV = {
  ISKRON_BRIDGE_DAEMON: "1",
  ISKRON_BRIDGE_DAEMON_WAIT_MS: "10000",
  ISKRON_BRIDGE_DAEMON_TRACE: "1",
};

function startBridge(serverUrl, authDir, env = {}, args = []) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir, ...args], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: PAT,
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ...REAL_ENV,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  const all = [];
  const notifications = [];
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
      if (msg.id === undefined && msg.method) notifications.push(msg);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  proc.stderr.on("data", (c) => (stderr += c));
  let seq = 0;
  return {
    proc,
    all,
    notifications,
    get stderr() {
      return stderr;
    },
    send: (msg) => proc.stdin.write(JSON.stringify(msg) + "\n"),
    request(method, params = {}, id = ++seq) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${id})`)), 30_000).unref();
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

const journalOf = (dir) => {
  try {
    return readFileSync(join(dir, "run", "daemon.log"), "utf8");
  } catch {
    return "";
  }
};
const daemonPids = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const textOf = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");
const placeOf = (r) => /стояние (?:@[^:\s]+:)?(\S+) — роль/.exec(textOf(r))?.[1];
const daemonPidIn = (stderr) =>
  [...stderr.matchAll(/through the machine's bridge daemon \S+ \(pid (\d+)\)/g)].map((m) => +m[1]);

async function waitFor(what, fn, ms = 15_000) {
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
  const dir = mkdtempSync(join(tmpdir(), "iskron-daemon-"));
  const procs = [];
  const bridge = (env, args, init = INIT) => {
    const b = startBridge(fake.mcpUrl, dir, env, args);
    procs.push(b);
    b.init = init;
    return b;
  };
  try {
    await fn({ fake, dir, bridge, procs });
  } finally {
    await Promise.all(procs.map((b) => b.stop()));
    for (const pid of daemonPids(dir)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function handshake(b, init = b.init ?? INIT) {
  const r = await b.request("initialize", init);
  assert.ok(r.result, `initialize: ${JSON.stringify(r)}\n${b.stderr}`);
  b.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return r;
}
const stand = (b, args) => b.request("tools/call", { name: "iskron_stand", arguments: args });

test("two sessions of one daemon at once keep their places, output, writes and satellite claims apart", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({}, [], INIT_PI);
    const b = bridge({}, [], INIT_PI);
    await Promise.all([handshake(a), handshake(b)]);
    // Одни и те же id у обоих харнесов: ответ идёт своему, не соседу.
    const [ra, rb] = await Promise.all([
      stand(a, { realm: "nks-dev", karta: 931, name: "place-a" }),
      stand(b, { realm: "nks-dev", karta: 932, name: "place-b" }),
    ]);
    assert.ok(!ra.result?.isError, `${textOf(ra)}\n${a.stderr}`);
    assert.ok(!rb.result?.isError, `${textOf(rb)}\n${b.stderr}`);
    assert.equal(placeOf(ra), "place-a", textOf(ra));
    assert.equal(placeOf(rb), "place-b", textOf(rb));
    const [pa] = daemonPidIn(a.stderr);
    const [pb] = daemonPidIn(b.stderr);
    assert.ok(pa && pa === pb, `one daemon for both: ${pa} / ${pb}\n${a.stderr}\n${b.stderr}`);
    assert.equal(daemonPids(dir).length, 1, "one daemon raised");
    // Место: у каждой сессии свой сокет канала.
    await waitFor("both places' sockets", () => fake.state.ws.size === 2);
    assert.deepEqual([...fake.state.wsNames.values()].sort(), ["place-a", "place-b"]);
    // Вывод: кадр места A — только харнесу A.
    await fake.control({ ws_say: { name: "place-a", text: "слово для A" } });
    const heard = (x) =>
      x.notifications.some((n) => JSON.stringify(n.params?.data ?? {}).includes("слово для A"));
    await waitFor("A to hear its frame", () => heard(a)).catch((e) => {
      throw new Error(
        `${e.message}\n${textOf(ra)}\n${JSON.stringify(fake.state.webhooks)}\n${JSON.stringify(a.notifications)}\n${a.stderr}`,
      );
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(heard(b), false, "B does not hear A's frame");
    // Токен и привязка: запись каждого харнеса подписана его местом.
    const write = (x, name) =>
      x.request("tools/call", {
        name: "iskron_add_phenomenon",
        arguments: { realm: "nks-dev", name },
      });
    const [wa, wb] = await Promise.all([write(a, "от A"), write(b, "от B")]);
    assert.ok(wa.result && wb.result, `${JSON.stringify(wa)}\n${JSON.stringify(wb)}`);
    const authors = fake.state.writes.map((w) => w.author);
    assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
    assert.equal(new Set(authors).size, 2, `two authors: ${JSON.stringify(authors)}`);

    // Заявки спутника: два спутника одного позвавшего в одном демоне — разные
    // .sub-N, и заявка пишется pid своего тонкого моста, не демона.
    const CALLER = "host.repo.opus-5";
    await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
    await fake.control({ listDelayMs: 300 });
    const s1 = bridge({}, ["--satellite"]);
    const s2 = bridge({}, ["--satellite"]);
    await Promise.all([handshake(s1), handshake(s2)]);
    const sat = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` };
    const [r1, r2] = await Promise.all([stand(s1, sat), stand(s2, sat)]);
    assert.ok(!r1.result?.isError, `${textOf(r1)}\n${s1.stderr}`);
    assert.ok(!r2.result?.isError, `${textOf(r2)}\n${s2.stderr}`);
    assert.deepEqual(
      [placeOf(r1), placeOf(r2)].sort(),
      [`${CALLER}.sub-1`, `${CALLER}.sub-2`],
      `two runs, two places:\n${textOf(r1)}\n${textOf(r2)}`,
    );
    assert.deepEqual(
      [...daemonPidIn(s1.stderr), ...daemonPidIn(s2.stderr)],
      [pa, pa],
      "the satellites go through the same daemon",
    );
    const claims = readdirSync(join(dir, "satellites"))
      .filter((f) => f.endsWith(".claim"))
      .map((f) => Number(readFileSync(join(dir, "satellites", f), "utf8").trim()))
      .sort();
    assert.deepEqual(
      claims,
      [s1.proc.pid, s2.proc.pid].sort(),
      "each claim carries its thin bridge's pid, not the daemon's",
    );
    // Ни одно слово сессии не потеряло своей области (демон пишет такое в журнал).
    assert.doesNotMatch(journalOf(dir), /emit outside of a session/, journalOf(dir));
  });
});

test("the daemon dies mid-call: the taken call gets a verdict, the call it never took goes again — no error", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const b = bridge({});
    await handshake(b);
    const [first] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
    await fake.control({ listDelayMs: 3000 });
    const slow = b.request(
      "tools/call",
      { name: "iskron_channel", arguments: { action: "list", realm: "@tester/probe" } },
      10,
    );
    await waitFor("the slow call at the daemon", () =>
      /\] rpc tools\/call 10$/m.test(journalOf(dir)),
    );
    // Демон замер: запрос 11 лёг в сокет, но его приёма демон не подтвердил.
    process.kill(first, "SIGSTOP");
    const pending = b.request("tools/call", { name: "iskron_orient", arguments: {} }, 11);
    await new Promise((r) => setTimeout(r, 300));
    process.kill(first, "SIGKILL");
    const verdict = await slow;
    assert.match(verdict.error?.message ?? "", /OUTCOME IS UNKNOWN/, JSON.stringify(verdict));
    await fake.control({ listDelayMs: 0 });
    const again = await pending;
    assert.ok(
      again.result && !again.error,
      `the untaken call is answered: ${JSON.stringify(again)}`,
    );
    assert.equal(b.all.filter((m) => m.id === 11).length, 1, "one answer for id 11");
    const [, second] = daemonPids(dir);
    assert.ok(second && second !== first, "a new daemon took over");
    const after = journalOf(dir)
      .split("\n")
      .filter((l) => l.includes(` pid=${second} `));
    assert.ok(
      after.some((l) => /\] rpc tools\/call 11$/.test(l)),
      `call 11 went to the new daemon:\n${after.join("\n")}`,
    );
    assert.match(b.stderr, /1 not taken by the daemon go again after the reattach/);
  });
});

test("the daemon updates under live sessions: the places stay, the thin bridges stay the same processes", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const home = mkdtempSync(join(tmpdir(), "iskron-daemon-home-"));
    const env = { ...process.env, HOME: home, USERPROFILE: home, ISKRON_BRIDGE_TOKEN: PAT };
    delete env.ISKRON_BRIDGE_NO_UPDATE; // обновления — дело демона; дом — временный
    env.ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS = "200";
    env.ISKRON_BRIDGE_DAEMON_TRACE = "1";
    const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], { env, stdio: "ignore" });
    d.unref();
    let watchdog = null;
    try {
      const [first] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
      const homeCopy = join(home, ".iskron-bridge", "iskron-bridge.mjs");
      await waitFor("the daemon to put itself home", () => existsSync(homeCopy));
      const a = bridge({});
      const b = bridge({});
      await Promise.all([handshake(a), handshake(b)]);
      const [ra, rb] = await Promise.all([
        stand(a, { realm: "nks-dev", karta: 931, name: "upd-a" }),
        stand(b, { realm: "nks-dev", karta: 932, name: "upd-b" }),
      ]);
      assert.ok(!ra.result?.isError && !rb.result?.isError, `${textOf(ra)}\n${textOf(rb)}`);
      await waitFor("both sockets", () => fake.state.ws.size === 2);
      // Сторож места A — под монитором харнеса: смену демона он переживает.
      const keyA = "upd-a--931--nks-dev";
      let wdOut = "";
      watchdog = spawn(NODE, [BRIDGE, "watchdog", keyA, "--auth-dir", dir], {
        env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      watchdog.stdout.on("data", (c) => (wdOut += c));
      await waitFor("the watchdog to attach", () => /слушаю стояние/.test(wdOut));
      const connects = fake.state.counts.connect;
      const before = new Set(fake.state.ws);
      const pids = [a.proc.pid, b.proc.pid];

      // Новая сборка в доме — демон передаёт места преемнику из неё.
      const newer = readFileSync(BRIDGE, "utf8").replace(
        /^((?:const|let|var)\s+VERSION\s*=\s*)"[^"]+"/m,
        '$1"99.0.0"',
      );
      mkdirSync(dirname(homeCopy), { recursive: true });
      writeFileSync(homeCopy, newer);
      await waitFor("the successor", () => daemonPids(dir).length >= 2, 30_000);
      await waitFor("the old daemon to leave", () => !alive(first), 30_000);
      const second = daemonPids(dir).at(-1);
      await waitFor(
        "both thin bridges through the successor",
        () =>
          [a, b].every((x) =>
            /through the machine's bridge daemon v99\.0\.0\+\S+ \(pid \d+\)/.test(x.stderr),
          ),
        30_000,
      );
      assert.deepEqual([a.proc.pid, b.proc.pid], pids, "the thin bridges are the same processes");
      assert.ok(
        [a, b].every((x) => x.proc.exitCode === null),
        "and alive",
      );
      // Места вернулись по записи держания — сокеты заново тем же адресом, без нового connect.
      // (Фейк сокет умершего держателя не отпускает — считаются только открытые после смены.)
      const reopened = () =>
        [...fake.state.ws]
          .filter((s) => !before.has(s))
          .map((s) => fake.state.wsNames.get(s))
          .sort();
      await waitFor(
        "both places back on their sockets",
        () => reopened().join() === "upd-a,upd-b",
        20_000,
      ).catch((e) => {
        throw new Error(
          `${e.message}: ${JSON.stringify(reopened())}\nA:\n${a.stderr}\nB:\n${b.stderr}\n${journalOf(dir)}`,
        );
      });
      assert.equal(fake.state.counts.connect, connects, "no new connect: the places came back");
      const again = await stand(a, { realm: "nks-dev", karta: 931, name: "upd-a" });
      assert.match(textOf(again), /сокет уже держит этот мост/, textOf(again));
      const call = await b.request("tools/call", { name: "iskron_orient", arguments: {} });
      assert.ok(call.result && !call.error, JSON.stringify(call));
      assert.match(journalOf(dir), new RegExp(` pid=${second} v99\\.0\\.0\\+\\S+ listening `));
      // Сторож пережил смену демона и слышит место дальше.
      assert.equal(watchdog.exitCode, null, `the watchdog is still up:\n${wdOut}`);
      await fake.control({ ws_say: { name: "upd-a", text: "после смены" } });
      await waitFor("the watchdog to print the frame", () => /после смены/.test(wdOut), 10_000);
      assert.doesNotMatch(journalOf(dir), /emit outside of a session/, journalOf(dir));
    } finally {
      watchdog?.kill("SIGKILL");
      for (const pid of daemonPids(dir)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// Решение шага 2: тонкий мост новее демона (по версии) — демон принимает его
// сессию и тут же передаёт места преемнику его сборкой; равная версия с другим
// хешем — живут вместе, старшинства по хешу нет.
test("a thin bridge newer than the daemon moves the daemon to its build", async () => {
  await withFake(async ({ dir, bridge }) => {
    const home = mkdtempSync(join(tmpdir(), "iskron-daemon-home-"));
    const env = { ...process.env, HOME: home, USERPROFILE: home, ISKRON_BRIDGE_TOKEN: PAT };
    delete env.ISKRON_BRIDGE_NO_UPDATE;
    const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], { env, stdio: "ignore" });
    d.unref();
    const newerFile = join(home, "newer", "iskron.mjs");
    try {
      const [first] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
      const same = bridge({});
      await handshake(same);
      assert.equal(alive(first), true, "a bridge of the daemon's own version moves nothing");
      mkdirSync(dirname(newerFile), { recursive: true });
      writeFileSync(
        newerFile,
        readFileSync(BRIDGE, "utf8").replace(
          /^((?:const|let|var)\s+VERSION\s*=\s*)"[^"]+"/m,
          '$1"99.0.0"',
        ),
      );
      const proc = spawn(NODE, [newerFile, "http://127.0.0.1:1/mcp", "--auth-dir", dir], {
        env: {
          ...process.env,
          ...REAL_ENV,
          ISKRON_BRIDGE_NO_UPDATE: "1",
          ISKRON_BRIDGE_TOKEN: PAT,
        },
        stdio: ["pipe", "ignore", "ignore"],
      });
      try {
        await waitFor("the daemon to leave for the newer build", () => !alive(first), 20_000);
        await waitFor(
          "the successor of the newer build",
          () => /pid=\d+ v99\.0\.0\+\S+ listening .*\(successor\)/.test(journalOf(dir)),
          20_000,
        );
        assert.match(journalOf(dir), /a thin bridge v99\.0\.0\+\S+ is newer than this daemon/);
        await waitFor(
          "the older thin bridge through the newer daemon",
          () => /through the machine's bridge daemon v99\.0\.0/.test(same.stderr),
          20_000,
        );
        assert.equal(same.proc.exitCode, null, "the older thin bridge lives on");
      } finally {
        proc.kill("SIGKILL");
      }
    } finally {
      for (const pid of daemonPids(dir)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});

test("doctor names the daemon: the mode, the socket, the pid, the build and the sessions", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const doctor = (env) =>
      new Promise((resolve) => {
        const p = spawn(NODE, [BRIDGE, "doctor", fake.mcpUrl, "--auth-dir", dir], {
          env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ISKRON_BRIDGE_TOKEN: PAT, ...env },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        p.stdout.on("data", (c) => (out += c));
        p.on("exit", () => resolve(out));
      });
    const before = await doctor({});
    assert.match(before, /демон машины: выключен — мост идёт полным/, before);
    assert.match(before, /не поднимался: каталога шва .* нет/, before);
    const b = bridge({});
    await handshake(b);
    const [pid] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
    const out = await doctor({ ISKRON_BRIDGE_DAEMON: "1" });
    assert.match(out, /демон машины: тонкий мост включён/, out);
    assert.match(
      out,
      new RegExp(`сокет: ${join(dir, "run", "daemon.sock").replaceAll("/", "\\/")}`),
      out,
    );
    assert.match(
      out,
      new RegExp(`отвечает: pid ${pid}, сборка v\\d+\\.\\d+\\.\\d+\\+[0-9a-f]{8}, сессий 1, файл `),
      out,
    );
  });
});

test("the idle window: the daemon outlives its last session by the window, a session within it keeps the daemon", async () => {
  await withFake(async ({ dir, bridge }) => {
    const env = { ISKRON_BRIDGE_DAEMON_IDLE_MS: "1500" };
    const one = bridge(env);
    await handshake(one);
    const [pid] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
    one.proc.stdin.end();
    await new Promise((r) => one.proc.once("exit", r));
    await new Promise((r) => setTimeout(r, 700));
    assert.ok(alive(pid), "the daemon stays within its idle window");
    const two = bridge(env);
    await handshake(two);
    assert.deepEqual(daemonPidIn(two.stderr), [pid], "the second session goes to the same daemon");
    await new Promise((r) => setTimeout(r, 2000));
    assert.ok(alive(pid), "a live session keeps the daemon past the window");
    two.proc.stdin.end();
    await new Promise((r) => two.proc.once("exit", r));
    await waitFor("the daemon to leave after the window", () => !alive(pid), 10_000);
    assert.match(journalOf(dir), /no session for 2s — the daemon leaves/);
    assert.equal(daemonPids(dir).length, 1, "no second daemon was raised");
  });
});
