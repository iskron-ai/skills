// Пробы демона машины (bridge/daemon.ts) — шаг 2 шва «тонкий мост ↔ демон»:
// много сессий в одном демоне, каждая в своей области (shared/scope.ts); смерть
// демона посреди вызова; обновление демона при живых сессиях; окно простоя.
// Демон настоящий — `iskron.mjs daemon`; тонкие мосты поднимают его своей
// копией (умолчание; флаг ISKRON_BRIDGE_DAEMON=1 стоит ради копий, где демон
// был за флагом) либо проба поднимает его сама.
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
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { socketPathOf } from "../shared/standings.ts";
import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
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
  // Смена демона: преемник открывает сокет места тем же адресом — контур вытесняет прежний.
  const fake = await startFakeNks({ pat: PAT, evictSameAddress: true });
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

// Exit from a case by outcome (#6573) is the session's: two satellites in one
// daemon each leave only the cases their own run joined.
test("two satellites of one daemon: the end of one run leaves its own cases, not the neighbour's", async () => {
  await withFake(async ({ fake, bridge }) => {
    const CALLER = "host.repo.opus-5";
    await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
    const s1 = bridge({}, ["--satellite"]);
    const s2 = bridge({}, ["--satellite"]);
    await Promise.all([handshake(s1), handshake(s2)]);
    const sat = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` };
    for (const s of [s1, s2]) assert.ok(!(await stand(s, sat)).result?.isError, s.stderr);
    const join = (s, room) =>
      s.request("tools/call", {
        name: "iskron_case",
        arguments: { realm: "nks-dev", action: "join", room },
      });
    await join(s1, "№11");
    await join(s2, "№22");
    const leaves = () =>
      fake.state.calls
        .filter((c) => c.name === "iskron_case" && c.arguments.action === "leave")
        .map((c) => c.arguments.room);
    const end = (s) =>
      new Promise((r) => {
        s.proc.once("exit", r);
        s.proc.stdin.end();
      });
    await end(s1);
    assert.deepEqual(leaves(), ["№11"], `the first run leaves its own case only:\n${s1.stderr}`);
    await end(s2);
    assert.deepEqual(leaves(), ["№11", "№22"], `the second run leaves its own:\n${s2.stderr}`);
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

/** Тот же мост сборкой выпуска (#6650): только она кладёт себя в дом — демон этих проб бежит ею. */
function releaseBridge(home) {
  const path = join(home, "release", "iskron.mjs");
  mkdirSync(dirname(path), { recursive: true });
  const text = readFileSync(BRIDGE, "utf8");
  writeFileSync(path, text.replaceAll('"iskron-build:dev"', '"iskron-build:release"'));
  return path;
}

test("the daemon updates under live sessions: the places stay, the thin bridges stay the same processes", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const home = mkdtempSync(join(tmpdir(), "iskron-daemon-home-"));
    const env = { ...process.env, HOME: home, USERPROFILE: home, ISKRON_BRIDGE_TOKEN: PAT };
    delete env.ISKRON_BRIDGE_NO_UPDATE; // обновления — дело демона; дом — временный
    env.ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS = "200";
    env.ISKRON_BRIDGE_DAEMON_TRACE = "1";
    const d = spawn(NODE, [releaseBridge(home), "daemon", "--auth-dir", dir], {
      env,
      stdio: "ignore",
    });
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

// Демон, обновляемый из временного дома: bump() кладёт в дом сборку v99.0.0 — демон
// передаёт места преемнику.
async function updatableDaemon(dir, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "iskron-daemon-home-"));
  const env = { ...process.env, HOME: home, USERPROFILE: home, ISKRON_BRIDGE_TOKEN: PAT, ...extra };
  delete env.ISKRON_BRIDGE_NO_UPDATE;
  env.ISKRON_BRIDGE_DAEMON_HOME_CHECK_MS = "200";
  env.ISKRON_BRIDGE_DAEMON_TRACE = "1";
  spawn(NODE, [releaseBridge(home), "daemon", "--auth-dir", dir], { env, stdio: "ignore" }).unref();
  const homeCopy = join(home, ".iskron-bridge", "iskron-bridge.mjs");
  await waitFor("the daemon", () => daemonPids(dir)[0]);
  await waitFor("the daemon to put itself home", () => existsSync(homeCopy));
  return {
    // rise — через сколько мс преемник встанет: окно смены, в котором места ни у кого.
    bump(rise = 0) {
      const v99 = readFileSync(BRIDGE, "utf8").replace(
        /^((?:const|let|var)\s+VERSION\s*=\s*)"[^"]+"/m,
        '$1"99.0.0"',
      );
      const slow = (m) => `${m}await new Promise((r) => setTimeout(r, ${rise}));\n`;
      writeFileSync(homeCopy, rise ? v99.replace(/^#!.*\n/, slow) : v99);
    },
    cleanup() {
      for (const pid of daemonPids(dir)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {}
      }
      rmSync(home, { recursive: true, force: true });
    },
  };
}
const write = (x, name) =>
  x.request("tools/call", { name: "iskron_add_phenomenon", arguments: { realm: "nks-dev", name } });

// Ревью #280, п.1: записи, посланные в окне смены демона, уходят в новую сессию
// только после возврата места — иначе они ложатся без автора.
test("writes sent while the daemon hands over land signed — the place comes back before them", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const r = await stand(a, { realm: "nks-dev", karta: 931, name: "race-a" });
      assert.ok(!r.result?.isError, textOf(r));
      await write(a, "before");
      d.bump();
      await waitFor("the handover", () => /handing over to/.test(journalOf(dir)), 10_000);
      const sent = [];
      for (let i = 0; i < 5; i++) {
        sent.push(write(a, `during-${i}`));
        await new Promise((res) => setTimeout(res, 30));
      }
      const answers = await Promise.all(sent);
      assert.ok(
        answers.every((x) => x.result && !x.error),
        JSON.stringify(answers.map((x) => x.error?.message ?? textOf(x).slice(0, 80))),
      );
      assert.equal(
        fake.state.counts.unattributed,
        0,
        `every write signed: ${JSON.stringify(fake.state.writes)}\n${a.stderr}`,
      );
    } finally {
      d.cleanup();
    }
  });
});

// Дело №151: место субагента кончается только явным актом, смена демона — пауза.
// Передача преемнику при живом мосте спутника ставит паузу сама (bridge/suspend.ts):
// место, дела и занятость ждут, мост возвращает место у преемника по записи паузы.
const SAT_CALLER = "host.repo.opus-5";
const SAT_SEAT = `931:${SAT_CALLER}.sub-1`;
const satStand = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${SAT_CALLER}` };
const caseJoin = (s, room) =>
  s.request("tools/call", {
    name: "iskron_case",
    arguments: { realm: "nks-dev", action: "join", room },
  });
const caseLeaves = (fake) =>
  fake.state.calls
    .filter((c) => c.name === "iskron_case" && c.arguments.action === "leave")
    .map((c) => c.arguments.room);
const placeRevokes = (fake) =>
  fake.state.calls
    .filter((c) => c.name === "iskron_channel" && c.arguments.action === "revoke")
    .map((c) => c.arguments.standing);
const endBridge = (b) =>
  new Promise((r) => {
    if (b.proc.exitCode !== null) return r();
    b.proc.once("exit", r);
    b.proc.stdin.end();
  });

test("a planned daemon change pauses a satellite whose bridge lives: its place and case stay and come back on the successor", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      await fake.control({ places: [{ karta: "931", name: SAT_CALLER, listening: true }] });
      const s = bridge({}, ["--satellite"]);
      await handshake(s);
      const r = await stand(s, satStand);
      assert.ok(!r.result?.isError, textOf(r));
      await caseJoin(s, "№44");
      d.bump();
      await waitFor(
        "the satellite through the successor",
        () => /through the machine's bridge daemon v99/.test(s.stderr),
        30_000,
      );
      const after = await write(s, "after the change");
      assert.ok(
        after.result && !after.result.isError,
        `the seat came back: ${JSON.stringify(after)}\n${s.stderr}\n${journalOf(dir)}`,
      );
      assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
      assert.deepEqual(caseLeaves(fake), [], `no case left on the change:\n${journalOf(dir)}`);
      assert.deepEqual(placeRevokes(fake), [], "the place is not revoked on the change");
      assert.ok(fake.state.places.has(SAT_SEAT), "the place stays on the board");
      assert.ok(
        !s.notifications.some((n) => n.params?.data?.kind === "lost"),
        "no lost word to the harness",
      );
      // Настоящий конец прогона — у преемника: дело, принятое по записи паузы, покидается.
      await endBridge(s);
      await waitFor("the run's case left", () => caseLeaves(fake).length > 0, 10_000);
      assert.deepEqual(caseLeaves(fake), ["№44"], journalOf(dir));
      assert.deepEqual(placeRevokes(fake), [`${SAT_CALLER}.sub-1`], journalOf(dir));
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #355, п.3: пауза, принятая в окне передачи, держит то же, что обычный
// iskron/suspend, — окно паузы перевзведено, занятость не снимается пределом передачи.
test("a pause asked while the daemon hands over is taken: the place, case, idle window and busy line wait on the pause record, not taken on the successor", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir, { ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" });
    try {
      await fake.control({ places: [{ karta: "931", name: SAT_CALLER, listening: true }] });
      const s = bridge({}, ["--satellite"]);
      await handshake(s);
      const r = await stand(s, satStand);
      assert.ok(!r.result?.isError, textOf(r));
      const busy = await stand(s, { ...satStand, status: "спутник пишет" });
      assert.ok(!busy.result?.isError, textOf(busy));
      await caseJoin(s, "№55");
      // Вызов в полёте держит сессию уходящего демона: пауза приходит в окно передачи.
      await fake.control({ listDelayMs: 4000 });
      const lists = fake.state.counts.list;
      s.request("tools/call", {
        name: "iskron_channel",
        arguments: { action: "list", realm: "nks-dev" },
      }).catch(() => {});
      await waitFor("the slow call at the server", () => fake.state.counts.list > lists);
      d.bump();
      await waitFor("the handover", () => /handing over to/.test(journalOf(dir)), 10_000);
      await fake.control({ listDelayMs: 0 });
      const paused = (await s.request("iskron/suspend", {})).result;
      assert.equal(
        paused?.suspended,
        true,
        `${JSON.stringify(paused)}\n${s.stderr}\n${journalOf(dir)}`,
      );
      assert.equal(paused.cases, 1, JSON.stringify(paused));
      assert.doesNotMatch(journalOf(dir), /not taken: the daemon is handing over/);
      const connects = fake.state.placeArgs.filter((a) => a.action === "connect");
      assert.equal(
        connects.at(-1)?.ttl_seconds,
        21600,
        `the pause re-arms the window:\n${journalOf(dir)}`,
      );
      await waitFor(
        "the satellite through the successor",
        () => /through the machine's bridge daemon v99/.test(s.stderr),
        30_000,
      );
      assert.match(s.stderr, /is paused and waits on its pause record/);
      await endBridge(s);
      await new Promise((res) => setTimeout(res, 2500)); // за предел передачи
      assert.equal(fake.state.status, "спутник пишет", `the busy line stays:\n${journalOf(dir)}`);
      assert.deepEqual(caseLeaves(fake), [], `no case left on a pause:\n${journalOf(dir)}`);
      assert.deepEqual(placeRevokes(fake), [], "the place is not revoked on a pause");
      assert.ok(fake.state.places.has(SAT_SEAT), "the place stays on the board");
      const holds = readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".hold"));
      assert.equal(holds.length, 1, "a pause record keeps the place");
      const rec = JSON.parse(readFileSync(join(dir, "standings", holds[0]), "utf8"));
      assert.deepEqual(
        rec.cases.map((c) => c.room),
        ["№55"],
      );
    } finally {
      d.cleanup();
    }
  });
});

test("a satellite whose bridge is gone when the daemon hands over ends as before: case left, place revoked", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir, { ISKRON_BRIDGE_DAEMON_GRACE_MS: "60000" });
    try {
      await fake.control({ places: [{ karta: "931", name: SAT_CALLER, listening: true }] });
      const s = bridge({}, ["--satellite"]);
      await handshake(s);
      const r = await stand(s, satStand);
      assert.ok(!r.result?.isError, textOf(r));
      await caseJoin(s, "№66");
      await s.stop(); // SIGKILL: шов оборван без bye, сессия в окне переподхвата
      await waitFor("the seam closed", () => /closed without bye/.test(journalOf(dir)));
      d.bump();
      await waitFor("the run's case left", () => caseLeaves(fake).length > 0, 30_000);
      assert.deepEqual(caseLeaves(fake), ["№66"], journalOf(dir));
      await waitFor("the place revoked", () => !fake.state.places.has(SAT_SEAT), 10_000);
      assert.deepEqual(placeRevokes(fake), [`${SAT_CALLER}.sub-1`], journalOf(dir));
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #355, п.1: пауза передачи — не пауза iskron/suspend. Ребёнок, закрывший stdin
// или умерший в окне передачи, к преемнику не вернётся: его прогон кончается, как на main.
for (const [how, gone] of [
  ["closes stdin", (s) => endBridge(s)],
  ["dies", (s) => s.stop()],
]) {
  test(`a satellite whose child ${how} in the handover window ends its run: case left, place revoked`, async () => {
    await withFake(async ({ fake, dir, bridge }) => {
      const d = await updatableDaemon(dir, { ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" });
      try {
        await fake.control({ places: [{ karta: "931", name: SAT_CALLER, listening: true }] });
        const s = bridge({}, ["--satellite"]);
        await handshake(s);
        const r = await stand(s, satStand);
        assert.ok(!r.result?.isError, textOf(r));
        await caseJoin(s, "№71");
        d.bump(3000); // преемник встаёт не сразу — окно, в котором места ни у кого
        await waitFor("the handover", () => /handing over to/.test(journalOf(dir)), 10_000);
        await gone(s);
        await waitFor("the run's case left", () => caseLeaves(fake).length > 0, 20_000).catch(
          (e) => {
            throw new Error(`${e.message}\n${journalOf(dir)}`);
          },
        );
        assert.deepEqual(caseLeaves(fake), ["№71"], journalOf(dir));
        await waitFor("the place revoked", () => !fake.state.places.has(SAT_SEAT), 10_000);
        assert.deepEqual(placeRevokes(fake), [`${SAT_CALLER}.sub-1`], journalOf(dir));
        const holds = readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".hold"));
        assert.deepEqual(holds, [], "no pause record outlives the run");
      } finally {
        d.cleanup();
      }
    });
  });
}

// Ревью #355, п.2: вход в дело, ответивший, пока уходящий демон ждёт вызовов в
// полёте, ложится в запись паузы — преемник принимает и его, и выходит из него на конце.
test("a case joined while the daemon waits for calls in flight lands in the pause record and is left at the run's end", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      await fake.control({ places: [{ karta: "931", name: SAT_CALLER, listening: true }] });
      const s = bridge({}, ["--satellite"]);
      await handshake(s);
      const r = await stand(s, satStand);
      assert.ok(!r.result?.isError, textOf(r));
      await fake.control({ case_join_delay_ms: 2500 });
      const joined = caseJoin(s, "№72");
      await waitFor("the join at the server", () =>
        fake.state.calls.some((c) => c.name === "iskron_case" && c.arguments.room === "№72"),
      );
      d.bump();
      const j = await joined;
      assert.ok(j.result && !j.result.isError, `the join answered: ${JSON.stringify(j)}`);
      await fake.control({ case_join_delay_ms: 0 });
      await waitFor(
        "the satellite through the successor",
        () => /through the machine's bridge daemon v99/.test(s.stderr),
        30_000,
      );
      const after = await write(s, "after the change");
      assert.ok(after.result && !after.result.isError, JSON.stringify(after));
      await endBridge(s);
      await waitFor("the run's case left", () => caseLeaves(fake).length > 0, 10_000).catch((e) => {
        throw new Error(`${e.message}\n${s.stderr}\n${journalOf(dir)}`);
      });
      assert.deepEqual(caseLeaves(fake), ["№72"], journalOf(dir));
    } finally {
      d.cleanup();
    }
  });
});

// Приёмка #280, п.3: вызов, отменённый харнесом в окне смены демона, пока его
// приём не подтверждён, не уходит новой сессии и не получает ответа.
test("a call cancelled while the daemon hands over is not sent again and gets no answer", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const r = await stand(a, { realm: "nks-dev", karta: 931, name: "cancel-a" });
      assert.ok(!r.result?.isError, textOf(r));
      d.bump();
      await waitFor("the handover", () => /handing over to/.test(journalOf(dir)), 10_000);
      const before = fake.state.writes.length;
      a.send({
        jsonrpc: "2.0",
        id: 50,
        method: "tools/call",
        params: {
          name: "iskron_add_phenomenon",
          arguments: { realm: "nks-dev", name: "cancelled" },
        },
      });
      a.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 50 } });
      await waitFor(
        "the successor",
        () => /through the machine's bridge daemon v99/.test(a.stderr),
        30_000,
      );
      const after = await write(a, "after");
      assert.ok(after.result && !after.result.isError, JSON.stringify(after));
      await new Promise((res) => setTimeout(res, 500));
      assert.equal(a.all.filter((m) => m.id === 50).length, 0, "no answer to the cancelled call");
      assert.equal(fake.state.writes.length, before + 1, "only the later write went out");
    } finally {
      d.cleanup();
    }
  });
});

// Приёмка #280, п.1: обычное место, чья запись держания пропала, после смены
// демона не вернулось — отказ вслух на каждом вызове до iskron_stand.
test("a place that did not come back after the daemon change refuses every call until iskron_stand", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const args = { realm: "nks-dev", karta: 931, name: "gone-a" };
      const r = await stand(a, args);
      assert.ok(!r.result?.isError, textOf(r));
      // Записи держания нет — возвращать нечем.
      for (const f of readdirSync(join(dir, "standings")).filter((x) => x.endsWith(".hold")))
        rmSync(join(dir, "standings", f));
      d.bump();
      await waitFor(
        "the word to the harness",
        () =>
          a.notifications.some((n) =>
            /не вернулось после смены демона/.test(JSON.stringify(n.params?.data ?? {})),
          ),
        30_000,
      );
      const before = fake.state.writes.length;
      for (const name of ["x-1", "x-2"]) {
        const refused = await write(a, name);
        assert.equal(refused.result?.isError, true, `${name}: ${JSON.stringify(refused)}`);
        assert.match(textOf(refused), /не вернулось после смены демона машины/);
      }
      assert.equal(fake.state.writes.length, before, "no refused write went out");
      // Ревью #280, круг 3: место в другом графе отказа потерянного не снимает.
      const other = await stand(a, { realm: "drugoy", karta: 48, name: "other-b" });
      assert.ok(!other.result?.isError, textOf(other));
      const still = await write(a, "x-3");
      assert.equal(
        still.result?.isError,
        true,
        `after a stand elsewhere: ${JSON.stringify(still)}`,
      );
      assert.match(textOf(still), /не вернулось после смены демона машины/);
      const there = await a.request("tools/call", {
        name: "iskron_add_phenomenon",
        arguments: { realm: "drugoy", name: "в другом графе" },
      });
      assert.ok(
        there.result && !there.result.isError,
        `the other graph is free: ${JSON.stringify(there)}`,
      );
      assert.equal(fake.state.writes.length, before + 1, "only the other graph's write went out");
      assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280, круг 3: место рядом в другом графе смену демона не переживает —
// громко: уведомление lost по нему и отказ записей в его граф до iskron_stand там.
test("a beside seat lost in the daemon change is said and its graph refused until iskron_stand there", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const ra = await stand(a, { realm: "nks-dev", karta: 931, name: "main-a" });
      assert.ok(!ra.result?.isError, textOf(ra));
      const besideArgs = { realm: "drugoy", karta: 48, name: "main-a" };
      const rb = await stand(a, besideArgs);
      assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
      await waitFor("the beside word", () =>
        a.notifications.some((n) => n.params?.data?.kind === "beside"),
      );
      d.bump();
      await waitFor(
        "the lost word for the beside seat",
        () =>
          a.notifications.some(
            (n) => n.params?.data?.kind === "lost" && /drugoy/.test(n.params?.data?.key ?? ""),
          ),
        30_000,
      );
      const before = fake.state.writes.length;
      for (const name of ["b-1", "b-2"]) {
        const refused = await a.request("tools/call", {
          name: "iskron_add_phenomenon",
          arguments: { realm: "drugoy", name },
        });
        assert.equal(refused.result?.isError, true, `${name}: ${JSON.stringify(refused)}`);
        assert.match(textOf(refused), /граф drugoy\) не вернулось после смены демона/);
      }
      assert.equal(fake.state.writes.length, before, "no refused write went out");
      const main = await write(a, "main");
      assert.ok(
        main.result && !main.result.isError,
        `the main seat came back: ${JSON.stringify(main)}\n${JSON.stringify(a.notifications.map((n) => n.params?.data?.kind + ":" + (n.params?.data?.key ?? "") + ":" + JSON.stringify(n.params?.data?.place ?? null)))}\n${a.stderr}`,
      );
      const again = await stand(a, besideArgs);
      assert.ok(!again.result?.isError, textOf(again));
      const there = await a.request("tools/call", {
        name: "iskron_add_phenomenon",
        arguments: { realm: "drugoy", name: "снова" },
      });
      assert.ok(there.result && !there.result.isError, JSON.stringify(there));
      assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280, круг 3: отмена помнится только до ack или ответа — повторный id после
// отменённого не глотается при следующем обрыве.
test("a cancelled id reused later is sent again after a break, not swallowed", async () => {
  await withFake(async ({ dir, bridge }) => {
    const b = bridge({});
    await handshake(b);
    const [first] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
    const orient = { name: "iskron_orient", arguments: {} };
    // Отмена, пока приём не подтверждён; демон оживает — вызов принят и отвечен.
    process.kill(first, "SIGSTOP");
    const answered = b.request("tools/call", orient, 70);
    b.send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 70 } });
    await new Promise((r) => setTimeout(r, 200));
    process.kill(first, "SIGCONT");
    await answered;
    // Тот же id снова — и обрыв до ack: вызов уходит новому демону.
    process.kill(first, "SIGSTOP");
    const again = b.request("tools/call", orient, 70);
    await new Promise((r) => setTimeout(r, 300));
    process.kill(first, "SIGKILL");
    const reply = await again;
    assert.ok(reply.result && !reply.error, `the reused id is answered: ${JSON.stringify(reply)}`);
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
    const before = await doctor({ ISKRON_BRIDGE_DAEMON: "0" });
    assert.match(before, /демон машины: выключен — мост идёт полным/, before);
    assert.match(before, /не поднимался: каталога шва .* нет/, before);
    const b = bridge({});
    await handshake(b);
    const [pid] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
    const out = await doctor({}); // без флага: демон — умолчание
    assert.match(out, /демон машины: тонкий мост включён — умолчание/, out);
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

// Ревью #280 (Opus, п.1): отказ потерянного места касается только вызовов в
// потерянный граф. Вызов без графа и вызов rN в держимый граф свободны — раньше
// оба отказывались текстом чужой потери (сравнение по слагу без разрешения rN).
test("a lost seat refuses only its own graph: no-realm calls and rN into a held graph go through", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const ra = await stand(a, { realm: "nks-dev", karta: 931, name: "free-a" });
      assert.ok(!ra.result?.isError, textOf(ra));
      const rb = await stand(a, { realm: "drugoy", karta: 48, name: "free-a" });
      assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
      await waitFor("the beside word", () =>
        a.notifications.some((n) => n.params?.data?.kind === "beside"),
      );
      d.bump();
      await waitFor(
        "the lost word for the beside seat",
        () =>
          a.notifications.some(
            (n) => n.params?.data?.kind === "lost" && /drugoy/.test(n.params?.data?.key ?? ""),
          ),
        30_000,
      );
      // Вызов без графа — не в потерянный граф: не отказывается.
      const orient = await a.request("tools/call", { name: "iskron_orient", arguments: {} });
      assert.ok(
        orient.result && !orient.result.isError,
        `a no-realm call is free: ${JSON.stringify(orient)}`,
      );
      // rN в держимый граф — держимый, не потерянный: запись подписана. Ответ
      // собственного вызова списка мог ещё не свернуться в алиасы — короткий ретрай.
      await waitFor("the bridge's own realm list", () =>
        /rpc tools\/call "iskron-thin-realms-\d+"/.test(journalOf(dir)),
      );
      const before = fake.state.writes.length;
      let w = null;
      for (let i = 0; i < 30 && !w; i++) {
        const r = await a.request("tools/call", {
          name: "iskron_add_phenomenon",
          arguments: { realm: "r5", name: "r5-write" },
        });
        if (r.result && !r.result.isError) w = r;
        else await new Promise((res) => setTimeout(res, 200));
      }
      assert.ok(w, `rN into the held graph must go through:\n${a.stderr}`);
      assert.equal(fake.state.writes.length, before + 1, "the write went out");
      assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280 (круг 2, Sol): служебный вызов списка графов (iskron_realm list) —
// то, чем тонкий мост после потери места разрешает rN и слаг вызовов, — идёт
// обычным tools/call через сессию демона. Сужение --tools без iskron_realm в
// наборе отвергало его (narrow.ts outsideSetRefusal), и мост молча принимал
// отказ за ответ списка: rN держимого графа получал unresolved-отказ, потеря
// спутника не снималась возвратом с иным написанием того же графа.
test("the bridge's own realm list is past --tools: rN into the held graph goes through, and a satellite's regain under another spelling lifts the loss", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      // Держимое место и место рядом: рядом теряется при смене демона, и без
      // списка графов r5 и nks-dev для отказа потерянного места неразличимы.
      const a = bridge({}, ["--tools", "case"]);
      await handshake(a);
      const ra = await stand(a, { realm: "nks-dev", karta: 931, name: "narrow-a" });
      assert.ok(!ra.result?.isError, textOf(ra));
      const rb = await stand(a, { realm: "drugoy", karta: 48, name: "narrow-a" });
      assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
      await waitFor("the beside word", () =>
        a.notifications.some((n) => n.params?.data?.kind === "beside"),
      );
      const listsForA = fake.state.counts.realm_list ?? 0;
      d.bump();
      await waitFor(
        "the lost word for the beside seat",
        () =>
          a.notifications.some(
            (n) => n.params?.data?.kind === "lost" && /drugoy/.test(n.params?.data?.key ?? ""),
          ),
        30_000,
      );
      // Служебный вызов списка дошёл до сервера — сужение его не срезало.
      await waitFor(
        "the bridge's own realm list at the server",
        () => (fake.state.counts.realm_list ?? 0) > listsForA,
        10_000,
      );
      // rN в держимый граф — держимый, не потерянный: вызов проходит. Ответ
      // списка мог ещё не свериться в алиасы — короткий ретрай.
      let passedA = null;
      for (let i = 0; i < 30 && !passedA; i++) {
        const r = await a.request("tools/call", {
          name: "iskron_case",
          arguments: { action: "mine", realm: "r5" },
        });
        if (r.result && !r.result.isError) passedA = r;
        else await new Promise((res) => setTimeout(res, 200));
      }
      assert.ok(passedA, `rN into the held graph must go through:\n${a.stderr}`);
      assert.ok(
        fake.state.calls.some((c) => c.name === "iskron_case" && c.arguments?.realm === "r5"),
        "the call reached the server",
      );
      // Спутник: место теряется (записи держания нет), возврат — новым
      // iskron_stand. Потеря записана написанием «nks-dev», возврат — «r5»:
      // тот же граф, и потеря должна сняться.
      const CALLER = "host.repo.gpt-astra";
      await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
      const s = bridge({}, ["--satellite", "--tools", "case"]);
      await handshake(s);
      const sat = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` };
      const rs = await stand(s, sat);
      assert.ok(!rs.result?.isError, textOf(rs));
      process.kill(daemonPids(dir).at(-1), "SIGTERM");
      await waitFor(
        "the satellite's lost word",
        () =>
          s.notifications.some((n) =>
            /потеряно при смене демона/.test(JSON.stringify(n.params?.data ?? {})),
          ),
        30_000,
      );
      // Дождаться, пока список сверился в алиасы: отказ каноническому написанию
      // станет текстом потери спутника, а не «мост не разрешил».
      let named = null;
      for (let i = 0; i < 30 && !named; i++) {
        const r = await s.request("tools/call", {
          name: "iskron_case",
          arguments: { action: "mine", realm: "@nks/nks-dev" },
        });
        if (/место спутника потеряно/.test(textOf(r))) named = r;
        else await new Promise((res) => setTimeout(res, 200));
      }
      assert.ok(
        named,
        `the satellite's loss must be named for the canonical spelling:\n${s.stderr}`,
      );
      // Возврат иным написанием того же графа — потеря снята: вызов прежним
      // написанием проходит, а не отказывается текстом снятой потери.
      const back = await stand(s, { ...sat, realm: "r5" });
      assert.ok(!back.result?.isError, textOf(back));
      let passedB = null;
      for (let i = 0; i < 30 && !passedB; i++) {
        const r = await s.request("tools/call", {
          name: "iskron_case",
          arguments: { action: "mine", realm: "nks-dev" },
        });
        if (r.result && !r.result.isError) passedB = r;
        else await new Promise((res) => setTimeout(res, 200));
      }
      assert.ok(passedB, `the regained satellite's graph must be free:\n${s.stderr}`);
      assert.ok(
        fake.state.calls.some((c) => c.name === "iskron_case" && c.arguments?.realm === "nks-dev"),
        "the call reached the server",
      );
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280 (круг 3, Opus п.1): исключение своего вызова в сужении --tools было
// префиксом id `iskron-*` (narrow.ts) — а префикс выбирает и харнес, и его вызов
// вне набора шёл к серверу. Признак своего вызова — вызов целиком: тул
// iskron_realm, ход list, id из служебного диапазона `iskron-thin-realms-*`
// (lostplaces.ts); прочие id, какого бы вида они ни были, сужению подчиняются.
test("a harness id iskron-* is not the bridge's own call: an outside tool is refused whatever the id, the realm-list shape alone passes", async () => {
  await withFake(async ({ fake, bridge }) => {
    const a = bridge({}, ["--tools", "case"]);
    await handshake(a);
    // Харнес с id вида iskron-* зовёт тул вне набора — отказ вслух, на сервер не ушло.
    const forged = await a.request(
      "tools/call",
      { name: "iskron_look", arguments: {} },
      "iskron-harness-1",
    );
    assert.equal(forged.result?.isError, true, JSON.stringify(forged));
    assert.match(textOf(forged), /нет в наборе этого моста/, textOf(forged));
    assert.equal(
      fake.state.calls.some((c) => c.name === "iskron_look"),
      false,
      "the forged id must not carry an outside tool to the server",
    );
    // Служебная форма — тот же тул и ход с id служебного диапазона: сужение её
    // пропускает, это и есть исключение.
    const service = await a.request(
      "tools/call",
      { name: "iskron_realm", arguments: { action: "list" } },
      "iskron-thin-realms-1",
    );
    assert.ok(service.result && !service.result.isError, JSON.stringify(service));
    assert.match(textOf(service), /Доступные графы/, textOf(service));
  });
});

// Ревью #280 (круг 3, Opus п.2): ворота после переподхвата открывались ответами
// replay/resume — раньше ответа служебного списка графов, и вызов с rN получал
// unresolved-отказ там, где летящий к серверу список разрешил бы имя. Ворота
// держатся и на ответе списка (askRealms закрывает, ответ открывает); проба —
// один вызов в окне медленного списка, без ретраев.
test("the gate holds harness calls until the bridge's own realm list answers: rN into the held graph goes through on the first call, no retries", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const ra = await stand(a, { realm: "nks-dev", karta: 931, name: "gate-a" });
      assert.ok(!ra.result?.isError, textOf(ra));
      const rb = await stand(a, { realm: "drugoy", karta: 48, name: "gate-a" });
      assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
      await waitFor("the beside word", () =>
        a.notifications.some((n) => n.params?.data?.kind === "beside"),
      );
      // Список графов отвечает медленно: окно, в котором вызов харнеса стоит до
      // алиасов из него, — приговорённый до ответа получил бы unresolved-отказ.
      await fake.control({ realmDelayMs: 1200 });
      const listsBefore = fake.state.counts.realm_list ?? 0;
      d.bump();
      await waitFor(
        "the lost word for the beside seat",
        () =>
          a.notifications.some(
            (n) => n.params?.data?.kind === "lost" && /drugoy/.test(n.params?.data?.key ?? ""),
          ),
        30_000,
      );
      // Служебный список дошёл до сервера и держится открытым — один вызов, без ретраев.
      await waitFor(
        "the bridge's own realm list at the server",
        () => (fake.state.counts.realm_list ?? 0) > listsBefore,
        10_000,
      );
      const only = await a.request("tools/call", {
        name: "iskron_case",
        arguments: { action: "mine", realm: "r5" },
      });
      assert.ok(
        only.result && !only.result.isError,
        `rN into the held graph must pass on the first call:\n${JSON.stringify(only)}\n${a.stderr}`,
      );
      assert.ok(
        fake.state.calls.some((c) => c.name === "iskron_case" && c.arguments?.realm === "r5"),
        "the call reached the server",
      );
      assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280 (Opus п.1 / GLM п.3): при нескольких потерянных графах отказ
// подписан графом вызова, а не текстом первой потери.
test("with two seats lost the refusal names the graph of the call, not the first lost one", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const ra = await stand(a, { realm: "nks-dev", karta: 931, name: "two-a" });
      assert.ok(!ra.result?.isError, textOf(ra));
      const rb = await stand(a, { realm: "drugoy", karta: 48, name: "two-a" });
      assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
      await waitFor("the beside word", () =>
        a.notifications.some((n) => n.params?.data?.kind === "beside"),
      );
      // Записи держания прочь: не вернётся и основное место.
      for (const f of readdirSync(join(dir, "standings")).filter((x) => x.endsWith(".hold")))
        rmSync(join(dir, "standings", f));
      d.bump();
      await waitFor(
        "the lost word for the main seat",
        () =>
          a.notifications.some(
            (n) => n.params?.data?.kind === "lost" && /nks-dev/.test(n.params?.data?.key ?? ""),
          ),
        30_000,
      );
      const call = (realm) =>
        a.request("tools/call", {
          name: "iskron_add_phenomenon",
          arguments: { realm, name: "naming" },
        });
      const first = await call("r5");
      assert.equal(first.result?.isError, true, JSON.stringify(first));
      assert.doesNotMatch(
        textOf(first),
        /drugoy/,
        `the refusal must not be signed by the first lost graph: ${textOf(first)}`,
      );
      await waitFor("the bridge's own realm list", () =>
        /rpc tools\/call "iskron-thin-realms-\d+"/.test(journalOf(dir)),
      );
      // Ответ списка мог ещё не свернуться в алиасы — ждём, пока отказ станет
      // называть граф вызова, коротким ретраем.
      let named = null;
      for (let i = 0; i < 30 && !named; i++) {
        const r = await call("r5");
        const t = textOf(r);
        if (/nks-dev/.test(t) && !/граф drugoy/.test(t)) named = r;
        else await new Promise((res) => setTimeout(res, 200));
      }
      assert.ok(named, `the refusal must name the called graph:\n${a.stderr}`);
      assert.equal(named.result?.isError, true, JSON.stringify(named));
      assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280 (Opus, п.1): @a/x и @b/x — для отказа потерянного места разные
// графы; раньше совпадение по слагу отказывало вызов в чужой граф.
test("another owner's same slug is a different graph: a lost seat does not refuse its calls", async () => {
  await withFake(async ({ dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({});
      await handshake(a);
      const r = await stand(a, { realm: "@nks/nks-dev", karta: 931, name: "owner-a" });
      assert.ok(!r.result?.isError, textOf(r));
      for (const f of readdirSync(join(dir, "standings")).filter((x) => x.endsWith(".hold")))
        rmSync(join(dir, "standings", f));
      d.bump();
      await waitFor(
        "the lost word",
        () =>
          a.notifications.some(
            (n) => n.params?.data?.kind === "lost" && /nks-dev/.test(n.params?.data?.key ?? ""),
          ),
        30_000,
      );
      const list = await a.request("tools/call", {
        name: "iskron_channel",
        arguments: { action: "list", realm: "@outsider/nks-dev" },
      });
      assert.ok(
        list.result && !list.result.isError,
        `another graph is free: ${JSON.stringify(list)}`,
      );
      assert.doesNotMatch(
        textOf(list),
        /не вернулось после смены демона/,
        "the refusal must not reach another owner's graph",
      );
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280 (Opus, п.4): SIGTERM демона — не передача преемнику и не уход
// агента: тонкий мост помнит место, переподхват возвращает его по записи
// держания (iskron/resume) — записи подписаны; раньше место терялось молча и
// записи ложились без автора.
test("SIGTERM of the daemon is not the agent leaving: the seat comes back and writes stay signed", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({});
    await handshake(a);
    const r = await stand(a, { realm: "nks-dev", karta: 931, name: "term-a" });
    assert.ok(!r.result?.isError, textOf(r));
    const [first] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
    process.kill(first, "SIGTERM");
    // Сигнал доходит не сразу: запись, ушедшая раньше, принята бы ещё старой сессией
    // и ответила бы до обрыва — воротами она стала бы лишь случаем.
    await waitFor("the old daemon gone", () => !alive(first), 30_000);
    const w = await write(a, "after-term"); // ворота: ждёт возврата места в новой сессии
    assert.ok(w.result && !w.result.isError, JSON.stringify(w));
    assert.equal(
      fake.state.counts.unattributed,
      0,
      `every write signed: ${JSON.stringify(fake.state.writes)}\n${a.stderr}`,
    );
    assert.match(a.stderr, /bringing its place .* back from the hold record/);
    assert.equal(daemonPids(dir).length, 2, "a new daemon was raised");
  });
});

// Сторож места под Monitor харнеса: вывод копится, код выхода — у proc.
function startWatchdog(dir, key, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "watchdog", key, "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wd = { proc, out: "" };
  proc.stdout.on("data", (c) => (wd.out += c));
  return wd;
}

// #6485: SIGTERM демона при тонком мосте на связи — смена держателя, не уход
// делателя: тонкий мост поднимает новый демон и возвращает место, сторож
// переслушивает дверь и показывает слово, посланное после SIGTERM. Прежняя
// сборка отпускала место словом released — сторож выходил кодом 1.
test("SIGTERM of the daemon: the watchdog hears the place again and prints a word sent after it", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({});
    await handshake(a);
    const r = await stand(a, { realm: "nks-dev", karta: 931, name: "term-w" });
    assert.ok(!r.result?.isError, textOf(r));
    await waitFor("the place's socket", () => fake.state.ws.size === 1);
    const before = new Set(fake.state.ws);
    const wd = startWatchdog(dir, "term-w--931--nks-dev");
    try {
      await waitFor("the watchdog to attach", () => /слушаю стояние/.test(wd.out));
      const [first] = daemonPids(dir);
      process.kill(first, "SIGTERM");
      // Слово окна — в сокет уходящего: доходит до сторожа ровно раз (спул, #6586).
      await waitFor("the SIGTERM taken", () => /SIGTERM — ending/.test(journalOf(dir)));
      await fake.control({ ws_say: { name: "term-w", text: "в окне SIGTERM", id: "term-w-0" } });
      await waitFor(
        "the place back at the new daemon",
        () =>
          [...fake.state.ws].some((s) => !before.has(s) && fake.state.wsNames.get(s) === "term-w"),
        30_000,
      ).catch((e) => {
        throw new Error(`${e.message}\n${wd.out}\n${a.stderr}\n${journalOf(dir)}`);
      });
      await waitFor("the old daemon gone", () => !alive(first), 30_000);
      await fake.control({ ws_say: { name: "term-w", text: "после SIGTERM", id: "term-w-1" } });
      await waitFor(
        "the watchdog to print the word",
        () => /после SIGTERM/.test(wd.out),
        10_000,
      ).catch((e) => {
        throw new Error(`${e.message}\nexit ${wd.proc.exitCode}\n${wd.out}\n${journalOf(dir)}`);
      });
      assert.equal(wd.proc.exitCode, null, `the watchdog is still up:\n${wd.out}`);
      assert.doesNotMatch(wd.out, /мост отпустил/, wd.out);
      assert.equal(wd.out.match(/после SIGTERM/g).length, 1, `the word once:\n${wd.out}`);
      assert.equal(
        wd.out.match(/в окне SIGTERM/g)?.length,
        1,
        `the window's word once:\n${wd.out}`,
      );
    } finally {
      wd.proc.kill("SIGKILL");
    }
  });
});

// #6485, обратная сторона: харнес закрыл вход — делатель ушёл, место отпущено,
// сторож выходит громко, а не ждёт возврата.
test("the harness closes stdin: the place is released and the watchdog leaves loudly", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({});
    await handshake(a);
    const r = await stand(a, { realm: "nks-dev", karta: 931, name: "term-x" });
    assert.ok(!r.result?.isError, textOf(r));
    await waitFor("the place's socket", () => fake.state.ws.size === 1);
    const wd = startWatchdog(dir, "term-x--931--nks-dev");
    try {
      await waitFor("the watchdog to attach", () => /слушаю стояние/.test(wd.out));
      a.proc.stdin.end();
      await waitFor("the watchdog to leave", () => wd.proc.exitCode !== null, 15_000).catch((e) => {
        throw new Error(`${e.message}\n${wd.out}\n${journalOf(dir)}`);
      });
      assert.equal(wd.proc.exitCode, 1, wd.out);
      assert.match(wd.out, /мост отпустил сокет/, wd.out);
    } finally {
      wd.proc.kill("SIGKILL");
    }
  });
});

// #6485, предел: SIGTERM, а место не вернулось (записи держания нет) — сторож не
// висит: выходит громко за своё окно; демон не держит сокет дольше предела.
test("SIGTERM of the daemon and the place does not come back: the watchdog leaves at its window", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({ ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" });
    await handshake(a);
    const r = await stand(a, { realm: "nks-dev", karta: 931, name: "term-y" });
    assert.ok(!r.result?.isError, textOf(r));
    await waitFor("the place's socket", () => fake.state.ws.size === 1);
    const wd = startWatchdog(dir, "term-y--931--nks-dev", { ISKRON_WATCHDOG_ATTACH_MS: "3000" });
    try {
      await waitFor("the watchdog to attach", () => /слушаю стояние/.test(wd.out));
      const standings = join(dir, "standings");
      for (const f of readdirSync(standings)) if (f.endsWith(".hold")) rmSync(join(standings, f));
      const [first] = daemonPids(dir);
      process.kill(first, "SIGTERM");
      await waitFor("the watchdog to leave", () => wd.proc.exitCode !== null, 20_000).catch((e) => {
        throw new Error(`${e.message}\n${wd.out}\n${journalOf(dir)}`);
      });
      assert.equal(wd.proc.exitCode, 1, wd.out);
      assert.match(wd.out, /место не вернулось за 3s после смены демона/, wd.out);
      await waitFor("the old daemon gone", () => !alive(first), 10_000);
    } finally {
      wd.proc.kill("SIGKILL");
    }
  });
});

// Ревью #291, п.1: демон решает «передача» один раз — по тонкому мосту на связи в
// миг SIGTERM. Мост умер следом (или SIGTERM обоим разом) — место не возвращает
// никто: преемник не берёт сокет до предела, и занятость снимается там, а не
// висит на доске (#5059). Сборка b000bde оставляла «работаю».
for (const [label, after] of [
  ["SIGKILL of the thin bridge right after", (a) => a.proc.kill("SIGKILL")],
  ["SIGTERM to both at once", (a) => a.proc.kill("SIGTERM")],
]) {
  test(`SIGTERM of the daemon, ${label}: the busy line is cleared at the hand-off limit`, async () => {
    await withFake(async ({ fake, dir, bridge }) => {
      const a = bridge({ ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" });
      await handshake(a);
      const seat = { realm: "nks-dev", karta: 931, name: "term-k" };
      const r = await stand(a, seat);
      assert.ok(!r.result?.isError, textOf(r));
      const s = await stand(a, { ...seat, status: "работаю" });
      assert.ok(!s.result?.isError, textOf(s));
      assert.equal(fake.state.status, "работаю");
      const [first] = daemonPids(dir);
      process.kill(first, "SIGTERM");
      if (label.startsWith("SIGKILL"))
        await waitFor("the SIGTERM taken", () => /SIGTERM — ending/.test(journalOf(dir)));
      after(a);
      await waitFor("the old daemon gone", () => !alive(first), 30_000);
      assert.equal(fake.state.status, "", `the busy line is cleared:\n${journalOf(dir)}`);
      // SIGTERM обоим разом: тонкий мост может умереть раньше, чем демон решит
      // «передача», — тогда сессия уходит обычным отпуском и снимает строку сама.
      // Передача была (после SIGKILL моста — всегда) — строку снимает предел, и журнал это называет.
      if (
        label.startsWith("SIGKILL") ||
        /place term-k--931--nks-dev handed over/.test(journalOf(dir))
      )
        assert.match(journalOf(dir), /place term-k--931--nks-dev: busy line cleared/);
    });
  });
}

// Ревью #291, гонка: пустой POST уходящего демона без standing_id ложится на все
// места канала — и на строку преемника, вставшего в последний миг. Дверь места у
// предела слушает — место преемника, строка его. Дверь здесь — сама проба.
test("SIGTERM of the daemon, the place's door up again at the limit: the busy line is left to its holder", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({ ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" });
    await handshake(a);
    const seat = { realm: "nks-dev", karta: 931, name: "term-r" };
    const r = await stand(a, seat);
    assert.ok(!r.result?.isError, textOf(r));
    const s = await stand(a, { ...seat, status: "преемник работает" });
    assert.ok(!s.result?.isError, textOf(s));
    const [first] = daemonPids(dir);
    process.kill(first, "SIGTERM");
    await waitFor("the SIGTERM taken", () => /SIGTERM — ending/.test(journalOf(dir)));
    a.proc.kill("SIGKILL");
    const path = socketPathOf(dir, "term-r--931--nks-dev");
    await waitFor("the outgoing door closed", () => !existsSync(path), 10_000);
    const door = createServer().listen(path);
    try {
      await waitFor("the old daemon gone", () => !alive(first), 30_000);
      assert.equal(fake.state.status, "преемник работает", journalOf(dir));
      assert.match(journalOf(dir), /busy line left — the successor's door is up/);
    } finally {
      door.close();
    }
  });
});

// Ревью #291, п.2: спутник на SIGTERM демона отпускается целиком (записи держания
// у него нет) — и занятость уходит с ним. Сборка b000bde её оставляла.
test("SIGTERM of the daemon under a satellite: its busy line goes, and its place is revoked", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const CALLER = "host.repo.opus-5";
    await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
    const s = bridge({}, ["--satellite"]);
    await handshake(s);
    const sat = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` };
    const r = await stand(s, sat);
    assert.ok(!r.result?.isError, `${textOf(r)}\n${s.stderr}`);
    const busy = await stand(s, { ...sat, status: "спутник пишет" });
    assert.ok(!busy.result?.isError, textOf(busy));
    assert.equal(fake.state.status, "спутник пишет");
    const [first] = daemonPids(dir);
    assert.ok(fake.state.places.has(`931:${CALLER}.sub-1`), "the satellite stood");
    await s.request("tools/call", {
      name: "iskron_case",
      arguments: { realm: "nks-dev", action: "join", room: "№33" },
    });
    process.kill(first, "SIGTERM");
    await waitFor("the old daemon gone", () => !alive(first), 30_000);
    assert.equal(fake.state.status, "", `the satellite's line is cleared:\n${journalOf(dir)}`);
    // Потерянное место спутника закрывается (#6593, #6550 п.4): выход из дел и revoke
    // до выхода демона — не «живой · не слушает».
    assert.ok(
      !fake.state.places.has(`931:${CALLER}.sub-1`),
      `the lost satellite seat is off the board:\n${journalOf(dir)}`,
    );
    const left = fake.state.calls.filter(
      (c) => c.name === "iskron_case" && c.arguments.action === "leave",
    );
    assert.deepEqual(
      left.map((c) => c.arguments.room),
      ["№33"],
      `its case is left:\n${journalOf(dir)}`,
    );
  });
});

// Ревью #297, п.1: место спутника на смене демона закрывается — последний снимок
// расхода, придержанный порогом, ложится до revoke (#6401). Сборка faf654b при
// передаче не слала его вовсе.
test("SIGTERM of the daemon under a satellite: the held-back usage snapshot lands before its place is revoked", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const CALLER = "host.repo.opus-5";
    await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
    const s = bridge({ ISKRON_USAGE_GAP_MS: "600000" }, ["--satellite"], INIT_PI);
    await handshake(s);
    const r = await stand(s, { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` });
    assert.ok(!r.result?.isError, `${textOf(r)}\n${s.stderr}`);
    const seat = `931:${CALLER}.sub-1`;
    const first = await s.request("iskron/usage", { tokens: 1000, model: "m1" });
    assert.equal(first.result?.pushed, true, JSON.stringify(first));
    const held = await s.request("iskron/usage", { tokens: 9000, model: "m2" });
    assert.equal(held.result?.pushed, false, "the gap holds the second snapshot back");
    const [pid] = daemonPids(dir);
    process.kill(pid, "SIGTERM");
    await waitFor("the old daemon gone", () => !alive(pid), 30_000);
    assert.ok(!fake.state.places.has(seat), `the seat is revoked:\n${journalOf(dir)}`);
    const usage = fake.state.placeAttrs.get(seat)?.usage;
    assert.equal(usage?.tokens, 9000, `${JSON.stringify(usage)}\n${journalOf(dir)}`);
    assert.equal(usage?.model, "m2");
  });
});

// Ревью #291, п.3: шов тонкого моста оборван, а сам мост жив — он в окне
// переподхвата и вернётся к новому демону. SIGTERM демона в этот миг — передача,
// не отпуск: сторож ждёт возврата места, а не уходит словом «мост отпустил».
// Мост здесь — сама проба: её pid жив, шов она рвёт без bye.
test("SIGTERM of the daemon while a live thin bridge is between seams: the place is handed over", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({ ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" });
    await handshake(a); // поднимает демон
    const hello = helloFrame({
      build: "v0.0.0+probe",
      path: BRIDGE,
      argv: [fake.mcpUrl, "--no-browser", "--auth-dir", dir],
      patSha: patShaOf(PAT),
    });
    const link = await connectSeam(seamSocketPath(dir), hello, 10_000);
    const waiting = new Map();
    link.onFrame((f) => {
      if (f.t === "rpc" && waiting.has(f.msg.id)) waiting.get(f.msg.id)(f.msg);
    });
    let seq = 100;
    const ask = (method, params) => {
      const id = ++seq;
      const p = new Promise((res) => waiting.set(id, res));
      link.send({ t: "rpc", msg: { jsonrpc: "2.0", id, method, params } });
      return p;
    };
    assert.ok((await ask("initialize", INIT)).result);
    link.send({ t: "rpc", msg: { jsonrpc: "2.0", method: "notifications/initialized" } });
    const r = await ask("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, name: "term-z" },
    });
    assert.ok(!r.result?.isError, JSON.stringify(r));
    await waitFor("the place's socket", () => [...fake.state.wsNames.values()].includes("term-z"));
    const wd = startWatchdog(dir, "term-z--931--nks-dev", { ISKRON_WATCHDOG_ATTACH_MS: "3000" });
    try {
      await waitFor("the watchdog to attach", () => /слушаю стояние/.test(wd.out));
      link.close(); // шов оборван без bye: окно переподхвата
      await waitFor("the seam gone", () => /closed without bye/.test(journalOf(dir)));
      const [first] = daemonPids(dir);
      process.kill(first, "SIGTERM");
      await waitFor("the old daemon gone", () => !alive(first), 30_000);
      assert.doesNotMatch(wd.out, /мост отпустил/, `${wd.out}\n${journalOf(dir)}`);
      await waitFor("the watchdog to leave", () => wd.proc.exitCode !== null, 15_000);
      assert.match(wd.out, /место не вернулось за 3s после смены демона/, wd.out);
    } finally {
      wd.proc.kill("SIGKILL");
    }
  });
});

// #6586: кадр, который служба записала в сокет места уходящего демона после
// начала передачи и до того, как узнала о закрытии, считается доставленным
// (delivered_at — по записи в сокет) и в hello преемника не вернётся. Фейк
// держит сокет уходящего открытым, пока тот не умер, — как контур до чтения
// кадра закрытия; слово пишется только в этот сокет, нового ещё нет.
test("a frame the service wrote into the outgoing daemon's socket reaches the harness after the change", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({}, [], INIT_PI);
      await handshake(a);
      const r = await stand(a, { realm: "nks-dev", karta: 931, name: "win-a" });
      assert.ok(!r.result?.isError, textOf(r));
      await waitFor("the place's socket", () => fake.state.ws.size === 1);
      const before = new Set(fake.state.ws);
      d.bump();
      await waitFor("the handover", () => /handing over to/.test(journalOf(dir)), 10_000);
      const open = [...fake.state.ws].filter((s) => fake.state.wsNames.get(s) === "win-a");
      assert.ok(
        open.length === 1 && before.has(open[0]),
        "the word goes only into the outgoing daemon's socket — the successor's is not open yet",
      );
      await fake.control({ ws_say: { name: "win-a", text: "в окне смены", id: "win-1" } });
      await waitFor(
        "the place back at the successor",
        () =>
          [...fake.state.ws].some((s) => !before.has(s) && fake.state.wsNames.get(s) === "win-a"),
        30_000,
      );
      const heard = () =>
        a.notifications.some((n) => JSON.stringify(n.params?.data ?? {}).includes("в окне смены"));
      await waitFor("the harness to hear the word sent in the window", heard, 10_000).catch((e) => {
        throw new Error(`${e.message}\n${a.stderr}\n${journalOf(dir)}`);
      });
    } finally {
      d.cleanup();
    }
  });
});

// #6586, обратная сторона: спул не дублирует. Слово окна, которое служба отдала бы
// и преемнику (тот же id), и слово после смены доходят по одному разу; уходящий
// демон отпускает сокет по вытеснению 4000, не дожидаясь предела.
test("after the change nothing comes twice: the window's word sent again and a new word reach the harness once", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({}, [], INIT_PI);
      await handshake(a);
      const r = await stand(a, { realm: "nks-dev", karta: 931, name: "win-b" });
      assert.ok(!r.result?.isError, textOf(r));
      await waitFor("the place's socket", () => fake.state.ws.size === 1);
      const before = new Set(fake.state.ws);
      const [first] = daemonPids(dir);
      d.bump(1500);
      // Сессия уходящего кончилась, преемник ещё не встал: слово — только в спул.
      await waitFor(
        "the outgoing session's end",
        () => /session \S+ ended: daemon handover/.test(journalOf(dir)),
        10_000,
      );
      await fake.control({ ws_say: { name: "win-b", text: "в окне смены", id: "win-2" } });
      await waitFor(
        "the place back at the successor",
        () =>
          [...fake.state.ws].some((s) => !before.has(s) && fake.state.wsNames.get(s) === "win-b"),
        30_000,
      );
      const times = (text) =>
        a.notifications.filter((n) => JSON.stringify(n.params?.data ?? {}).includes(text)).length;
      await waitFor("the window's word", () => times("в окне смены") > 0, 10_000);
      await waitFor("the outgoing daemon to leave", () => !alive(first), 8_000).catch((e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      });
      assert.match(journalOf(dir), /handover spool: 1 frame\(s\) of the outgoing daemon/);
      assert.match(journalOf(dir), /handed over: the successor took the socket \(close 4000\)/);
      await fake.control({ ws_say: { name: "win-b", text: "в окне смены", id: "win-2" } });
      await fake.control({ ws_say: { name: "win-b", text: "после смены", id: "after-2" } });
      await waitFor("the word after the change", () => times("после смены") > 0, 10_000);
      await new Promise((res) => setTimeout(res, 500));
      assert.equal(times("в окне смены"), 1, "the window's word once, the spool and the service");
      assert.equal(times("после смены"), 1, "the word after the change once");
    } finally {
      d.cleanup();
    }
  });
});

// #6586, предел: место никто не вернул — уходящий демон держит сокет не дольше
// предела, затем закрывает его и уходит; ничего не висит. Слово, посланное в
// окне предела, не потеряно: сокет ещё держится, кадр лёг в спул и доходит, когда
// агент встаёт на место снова, — сборка, закрывающая сокет сразу, его теряет.
test("no successor takes the place: the outgoing daemon closes the socket at the limit and leaves", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir, { ISKRON_BRIDGE_DAEMON_HANDOFF_MS: "1500" });
    try {
      const a = bridge({}, [], INIT_PI);
      await handshake(a);
      const r = await stand(a, { realm: "nks-dev", karta: 931, name: "win-c" });
      assert.ok(!r.result?.isError, textOf(r));
      await waitFor("the place's socket", () => fake.state.ws.size === 1);
      const [old] = fake.state.ws;
      old.resume(); // фейк не читает сокет — без этого закрытия со стороны моста он не видит
      const [first] = daemonPids(dir);
      // Записи держания нет — преемнику нечем вернуть место.
      const standings = join(dir, "standings");
      for (const f of readdirSync(standings)) if (f.endsWith(".hold")) rmSync(join(standings, f));
      d.bump();
      await waitFor("the handover", () => /handing over to/.test(journalOf(dir)), 10_000);
      await waitFor(
        "the outgoing session's end",
        () => /session \S+ ended: daemon handover/.test(journalOf(dir)),
        10_000,
      );
      await fake.control({ ws_say: { name: "win-c", text: "в окне предела", id: "limit-1" } });
      await waitFor("the outgoing daemon to leave", () => !alive(first), 10_000).catch((e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      });
      assert.match(journalOf(dir), /handed over: no successor took the socket in 1\.5s — closed/);
      await waitFor("the outgoing daemon's socket closed", () => old.destroyed, 5_000);
      assert.equal(fake.state.ws.size, 0, "no socket of the place is open");
      const again = await stand(a, { realm: "nks-dev", karta: 931, name: "win-c" });
      assert.ok(!again.result?.isError, textOf(again));
      const heard = () =>
        a.notifications.some((n) =>
          JSON.stringify(n.params?.data ?? {}).includes("в окне предела"),
        );
      await waitFor("the word sent within the limit", heard, 10_000).catch((e) => {
        throw new Error(`${e.message}\n${a.stderr}\n${journalOf(dir)}`);
      });
    } finally {
      d.cleanup();
    }
  });
});

// #6586, лежалый спул: место не вернулось часами (спутник, сокет без стояния), спул
// лежит; новый hello того же места досылает его не живым — пометкой stale, пачкой лежалых.
test("a spool left for hours is not delivered as live: the next hello of the place gives it as stale", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({}, [], INIT_PI);
    await handshake(a);
    const r = await stand(a, { realm: "nks-dev", karta: 931, name: "win-s" });
    assert.ok(!r.result?.isError, textOf(r));
    await waitFor("the place's socket", () => fake.state.ws.size === 1);
    const standings = join(dir, "standings");
    const hold = readdirSync(standings).find((f) => f.endsWith(".hold"));
    const then = Date.now() - 7 * 3600_000;
    const frame = {
      type: "message",
      id: "old-spool-1",
      received_at: new Date(then).toISOString(),
      stale: false,
      content_type: "text/plain",
      to_standing: "@tester:win-s",
      body: "лежалое из спула",
    };
    writeFileSync(
      join(standings, hold.replace(/\.hold$/, ".spool")),
      [{ open: then }, { frame: JSON.stringify(frame), at: then }, { done: then }]
        .map((e) => JSON.stringify(e) + "\n")
        .join(""),
    );
    await fake.control({ ws_close: 1011 }); // переоткрытие — новый hello места
    const carrying = () =>
      a.notifications.filter((n) =>
        JSON.stringify(n.params?.data ?? {}).includes("лежалое из спула"),
      );
    await waitFor("the spooled frame", () => carrying().length > 0, 15_000).catch((e) => {
      throw new Error(`${e.message}\n${a.stderr}\n${journalOf(dir)}`);
    });
    await new Promise((res) => setTimeout(res, 500));
    assert.deepEqual(
      carrying().map((n) => n.params.data.kind),
      ["stale"],
      "the hours-old spool comes in the stale batch, not as a live frame",
    );
  });
});

// #6586, место рядом: кадр места другого графа, пришедший в окне смены, лежит в спуле
// основного места; место рядом смену не пережило — кадр не отдаётся основному месту
// его кадром и не метится в его .seen, а идёт словом с адресатом.
test("a spooled frame of a beside seat that did not come back is not given to the main place as its own", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const d = await updatableDaemon(dir);
    try {
      const a = bridge({}, [], INIT_PI);
      await handshake(a);
      const ra = await stand(a, { realm: "nks-dev", karta: 931, name: "main-s" });
      assert.ok(!ra.result?.isError, textOf(ra));
      const rb = await stand(a, { realm: "drugoy", karta: 48, name: "side-s" });
      assert.ok(!rb.result?.isError, `beside: ${textOf(rb)}`);
      await waitFor("the place's socket", () => fake.state.ws.size === 1);
      const [realm, side] = [...fake.state.channels.values()]
        .flatMap((c) => [...c.places])
        .find(([, p]) => p.name === "side-s");
      const before = new Set(fake.state.ws);
      const [first] = daemonPids(dir);
      d.bump(1500);
      await waitFor(
        "the outgoing session's end",
        () => /session \S+ ended: daemon handover/.test(journalOf(dir)),
        10_000,
      );
      await fake.control({
        ws_send: JSON.stringify({
          type: "message",
          id: "side-1",
          received_at: new Date().toISOString(),
          stale: false,
          content_type: "text/plain",
          to_standing_id: side.standing_id,
          to_standing: "@tester:side-s",
          realm,
          karta_seq: 48,
          body: "месту рядом",
        }),
      });
      await waitFor(
        "the place back at the successor",
        () =>
          [...fake.state.ws].some((s) => !before.has(s) && fake.state.wsNames.get(s) === "main-s"),
        30_000,
      );
      await waitFor("the outgoing daemon to leave", () => !alive(first), 20_000);
      const carrying = () =>
        a.notifications.filter((n) => JSON.stringify(n.params?.data ?? {}).includes("месту рядом"));
      await waitFor("the beside seat's frame", () => carrying().length > 0, 10_000).catch((e) => {
        throw new Error(`${e.message}\n${a.stderr}\n${journalOf(dir)}`);
      });
      await new Promise((res) => setTimeout(res, 500));
      const kinds = carrying().map((n) => n.params.data.kind);
      assert.deepEqual(
        kinds,
        ["note"],
        "said with its addressee, not raised as the main place's frame",
      );
      assert.match(carrying()[0].params.data.text, /side-s.*не вернувшемуся/);
      const standings = join(dir, "standings");
      for (const f of readdirSync(standings).filter((x) => x.endsWith(".seen")))
        assert.ok(
          !readFileSync(join(standings, f), "utf8").includes("side-1"),
          `${f} marks side-1`,
        );
    } finally {
      d.cleanup();
    }
  });
});

// Ревью #280 (Opus, п.4), спутник: у спутника записи держания нет — конец демона
// без преемника обязан стать громким lost и отказом вслух, не молчанием.
test("SIGTERM of the daemon with a satellite: the lost seat is said and the next call refused", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const CALLER = "host.repo.opus-5";
    await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
    const s = bridge({}, ["--satellite"]);
    await handshake(s);
    const sat = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` };
    const r = await stand(s, sat);
    assert.ok(!r.result?.isError, textOf(r));
    const [first] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
    process.kill(first, "SIGTERM");
    await waitFor("the successor daemon", () => daemonPids(dir).length === 2, 30_000);
    await waitFor(
      "the word to the harness",
      () =>
        s.notifications.some((n) =>
          /потеряно при смене демона/.test(JSON.stringify(n.params?.data ?? {})),
        ),
      10_000,
    );
    // Отказ держится на каждом вызове до нового iskron_stand, не на одном первом.
    const before = fake.state.writes.length;
    for (const name of ["sat-term-1", "sat-term-2"]) {
      const refused = await write(s, name);
      assert.equal(
        refused.result?.isError,
        true,
        `the lost satellite seat refuses ${name}: ${JSON.stringify(refused)}`,
      );
      assert.match(textOf(refused), /место спутника потеряно при смене демона/);
      assert.match(textOf(refused), /iskron_stand с satellite_of/);
    }
    assert.equal(fake.state.writes.length, before, "no refused write went out");
    assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
    const again = await stand(s, sat);
    assert.ok(!again.result?.isError, textOf(again));
    const signed = await write(s, "signed-after-term");
    assert.ok(signed.result && !signed.result.isError, JSON.stringify(signed));
    assert.equal(fake.state.counts.unattributed, 0, JSON.stringify(fake.state.writes));
  });
});

// Ревью #280 (Opus, п.3): обрыв чистит и таймер ворот — унаследованный открыл бы
// ворота новой сессии раньше её GATE_MS, до ответа iskron/resume. Обёртка
// slow-daemon.mjs делает миг второго рукопожатия предсказуемым: унаследованный
// таймер сработал бы заметно раньше полной задержки новой сессии.
test("the gate timer does not survive the break: the second wait is a full one", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = bridge({
      ISKRON_BRIDGE_DAEMON_ENTRY: join(HERE, "slow-daemon.mjs"),
      ISKRON_TEST_DAEMON_DELAY_MS: "3000",
    });
    await handshake(a);
    const r = await stand(a, { realm: "nks-dev", karta: 931, name: "gate-t" });
    assert.ok(!r.result?.isError, textOf(r));
    await fake.control({ registerToolDelayMs: 21_000 }); // возврат места не отвечает раньше ворот
    const killLatest = () => {
      const pids = daemonPids(dir);
      process.kill(pids[pids.length - 1], "SIGKILL");
    };
    killLatest(); // первый обрыв: реплей шлёт initialize и iskron/resume, ворота закрыты
    await waitFor("the resume in flight", () =>
      /bringing its place .* back from the hold record/.test(a.stderr),
    );
    await new Promise((res) => setTimeout(res, 300));
    killLatest(); // второй обрыв — ворота ещё закрыты, таймер первой очереди жив
    await waitFor("the third daemon", () => daemonPidIn(a.stderr).length === 3, 30_000);
    const arm2 = Date.now();
    await waitFor(
      "the gate to time out",
      () =>
        /did not answer the bridge's own calls in 20000ms — letting calls through/.test(a.stderr),
      30_000,
    );
    const opened = Date.now();
    await fake.control({ registerToolDelayMs: 0 });
    assert.ok(
      opened - arm2 >= 20_000 - 1500,
      `the gate opened ${opened - arm2}ms after the second attach — earlier than its own GATE_MS`,
    );
  });
});
