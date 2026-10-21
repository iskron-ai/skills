// Behavioural probes of the machine daemon's orchestration door (bridge/orchestra.ts,
// bridge/orchestra-door.ts, cli/orchestra.ts — graph @nks/nks-dev, nodes #7513, #7514, #8202): the flag, the named
// graph boundary and the daemon's local entrance. The daemon is real — raised by the
// subcommand against no server, for the door needs no session; the CLI is the same
// executable. ISKRON_BRIDGE_PATH aims both at any copy, as elsewhere.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;

function cli(args, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "orchestra", ...args, "--lang", "ru"], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (err += c));
  const done = new Promise((resolve) => {
    proc.once("exit", (code, signal) => resolve({ code, signal, out, err }));
    setTimeout(() => proc.kill("SIGKILL"), 30_000).unref();
  });
  return { proc, done };
}

const DAEMON_ENV = {
  // A leaked daemon of a failed probe leaves on its own long before the runner's patience.
  ISKRON_BRIDGE_DAEMON_IDLE_MS: "15000",
};

async function raiseDaemon(dir, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...DAEMON_ENV, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let err = "";
  proc.stderr.on("data", (c) => (err += c));
  const stop = () =>
    new Promise((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) return resolve();
      proc.once("exit", resolve);
      setTimeout(resolve, 5000).unref(); // a kill that never reports still ends the probe
      proc.kill("SIGKILL");
    });
  return { stop, err: () => err };
}

/** Until the daemon's door answers — or the cause why it never did. */
async function untilDoor(dir, env = {}) {
  const until = Date.now() + 20_000;
  for (;;) {
    const r = await cli(["status", "--auth-dir", dir], env).done;
    if (!/демона машины нет/.test(r.err)) return r;
    if (Date.now() > until) throw new Error(`the door never answered: ${r.err}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const flagAt = (dir) => join(dir, "run", "orchestra.json");
const flagOf = (dir) => JSON.parse(readFileSync(flagAt(dir), "utf8"));

test("orchestra: no daemon — every op is refused aloud, not run around", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const r = await cli(["on", "--auth-dir", dir]).done;
  assert.equal(r.code, 1, `exit 1, not ${r.code}: ${r.err}${r.out}`);
  assert.match(r.err, /демона машины нет/, r.err);
  assert.ok(!existsSync(flagAt(dir)), "nothing was written without a daemon");
});

test("orchestra: on without the machine's consent — refused, the flag untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir);
  try {
    await untilDoor(dir);
    const r = await cli(["on", "--realm", "@x/one", "--auth-dir", dir]).done;
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, /не допустила оркестратора/, r.err);
    assert.match(r.err, /ISKRON_ORCHESTRA/, r.err);
    assert.ok(!existsSync(flagAt(dir)), "the refusal wrote no flag");
  } finally {
    await d.stop();
  }
});

test("orchestra: on with consent — the flag lies next to the grant, the boundary grows, off clears", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    const on = await cli(["on", "--realm", "@x/one", "--realm", "@x/two", "--auth-dir", dir]).done;
    assert.equal(on.code, 0, on.err);
    assert.match(on.out, /включён/);
    assert.deepEqual(flagOf(dir), { on: true, realms: ["@x/one", "@x/two"] });
    const more = await cli(["on", "--realm", "@x/three", "--auth-dir", dir]).done;
    assert.equal(more.code, 0, more.err);
    assert.deepEqual(
      flagOf(dir).realms,
      ["@x/one", "@x/two", "@x/three"],
      "on extends, not replaces",
    );
    const st = await cli(["status", "--auth-dir", dir]).done;
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /включён/);
    assert.match(st.out, /@x\/one, @x\/two, @x\/three/);
    const off = await cli(["off", "--auth-dir", dir]).done;
    assert.equal(off.code, 0, off.err);
    assert.match(off.out, /выключен/);
    assert.deepEqual(flagOf(dir), { on: false, realms: [] });
    const st2 = await cli(["status", "--auth-dir", dir]).done;
    assert.equal(st2.code, 0, st2.err);
    assert.match(st2.out, /выключен/);
  } finally {
    await d.stop();
  }
});

test("orchestra: the flag outlives the daemon — a new daemon reads what lies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const first = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
  const on = await cli(["on", "--realm", "@x/kept", "--auth-dir", dir]).done;
  assert.equal(on.code, 0, on.err);
  await first.stop();
  const second = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  try {
    const st = await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /включён/);
    assert.match(st.out, /@x\/kept/);
  } finally {
    await second.stop();
  }
});

test("orchestra: a line that is no known op is answered in the daemon's tongue, and the door stays alive", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir);
  const ask = (line) =>
    new Promise((resolve, reject) => {
      const s = connect(join(dir, "run", "orchestra.sock"));
      s.setTimeout(10_000, () => {
        s.destroy();
        reject(new Error("the door stayed silent"));
      });
      s.on("error", reject);
      s.on("connect", () => s.write(line + "\n"));
      let buf = "";
      s.on("data", (c) => {
        buf += c;
        const nl = buf.indexOf("\n");
        if (nl < 0) return;
        s.destroy();
        try {
          resolve(JSON.parse(buf.slice(0, nl)));
        } catch (e) {
          reject(e);
        }
      });
    });
  try {
    await untilDoor(dir);
    const junk = await ask(JSON.stringify({ op: "levitate", realms: [] }));
    assert.equal(junk.ok, false, JSON.stringify(junk));
    assert.match(junk.said, /неизвестное действие/, JSON.stringify(junk));
    const broken = await ask("{not json");
    assert.equal(broken.ok, false, JSON.stringify(broken));
    assert.match(broken.said, /неизвестное действие/, JSON.stringify(broken));
    // The refusals close their own connections only: a proper ask still served.
    const st = await cli(["status", "--auth-dir", dir]).done;
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /выключен/);
  } finally {
    await d.stop();
  }
});

// ── такт: чтение очередей от курсора (#5042, #8202; двери #4951 и #6010) ──

/** A raised signal as the raised door carries it (#6010); cursor — the opaque one it came with. */
const signal = (i, cause, extra = {}) => ({
  id: `s${i}`,
  standing: "@alari:seat.one",
  n: i,
  spawned_for: { invite: 9, room: "1260" },
  cause,
  room: "1260",
  rooms: ["1260"],
  at: `2026-10-20T20:00:0${i}Z`,
  cursor: `c${i}`,
  ...extra,
});

/** An invite as the invites door carries it LIVE (nks-api 0.130.12, #4951): entry_id —
 * the record number in the case, room_id — the case's uuid, payload — the kind's own. */
const invite = {
  entry_id: 9,
  room_id: "725414c2-7078-4dfa-a5b9-140adb3b3422",
  zachin: "срез 3: подъём исполнителя",
  karta_seq: 931,
  author: "@alari:16-m3.methodology.gpt-6-astra",
  at: "2026-10-20T20:00:00Z",
  payload: {},
  attrs: {},
};

const cursorsAt = (dir) => join(dir, "run", "orchestra-cursors.json");

/** A daemon that can read a server: the fake's address and a PAT beside the grant, and a
 * hold record per realm whose channel url names the api beside it — as lived sessions would
 * leave. The records' realms are ALSO the discovered half of the boundary (#8202). */
async function raiseReader(dir, fake, realms = ["@nks/nks-dev"]) {  writeFileSync(join(dir, "server"), `${fake.base}/mcp\n`);
  writeFileSync(join(dir, "token"), "probe-pat");
  mkdirSync(join(dir, "standings"), { recursive: true });
  let n = 0;
  for (const realm of realms) {
    writeFileSync(
      join(dir, "standings", `probe-${++n}.hold`),
      JSON.stringify({
        realm,
        karta: 931,
        name: `probe-${n}`,
        url: `${fake.base}/channel/ws/probe-${n}`,
        at: Date.now(),
      }) + "\n",
    );
  }
  return raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
}

/** Тонкий мост в пробе взятия: stdio JSON-RPC, как харнес дочернего агента. */
function thinBridge(authDir, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "--no-browser", "--auth-dir", authDir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_TOKEN: "probe-pat",
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_DAEMON: "0",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let buf = "";
  proc.stdout.on("data", (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  let id = 0;
  return {
    stop: () =>
      proc.exitCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.stdin.end();
            setTimeout(() => proc.kill("SIGKILL"), 3000).unref();
          }),
    async call(method, params = {}) {
      const myId = ++id;
      const p = new Promise((res, rej) => {
        waiters.set(myId, res);
        setTimeout(() => rej(new Error(`no answer for ${method}`)), 20_000).unref();
      });
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
      return p;
    },
  };
}
const textOfReply = (r) => (r.result?.content ?? []).map((c) => c.text ?? "").join("\n");

// WIP (№1317, пауза владельца — №1302[61] → №1317[13]): договор взятия в фейке готов,
// проводка spawned_for в мост не начата. Красная проба сработала (spawned_for не ехал
// в register, assert упал на месте), но разборка харнеса тонких мостов роняет файловую
// пробу «promise resolution is still pending» и тянет ранер ~75 с — продолжить после
// паузы: починить разборку, снять skip, начать проводку в standing.ts. Не приёмка.
test.skip("orchestra: the raised child claims its invite at register — repeat quiet, rival refused, unknown refused", async (t) => {
  const fake = await startFakeNks({ pat: "probe-pat" });
  const dirOf = () => {
    const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
    writeFileSync(join(dir, "server"), `${fake.base}/mcp\n`);
    writeFileSync(join(dir, "token"), "probe-pat");
    return dir;
  };
  const room = "11111111-2222-4333-8444-555555555555";
  await fake.control({
    orchestra: {
      realms: {
        "@nks/nks-dev": {
          invites: [
            { entry_id: 463, room_id: room, zachin: "probe raise", karta_seq: 931, author: null, at: "2026-10-21T08:00:00Z", payload: {}, attrs: {} },
          ],
          signals: [],
        },
      },
    },
  });
  const claim = (invite) => JSON.stringify({ invite, room, realm: "@nks/nks-dev" });
  // The raised child: the spawning daemon handed it the invite; every register carries the claim.
  const child = thinBridge(dirOf(), { ISKRON_BRIDGE_SPAWNED_FOR: claim(463) });
  t.after(() => child.stop());
  await child.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "raised-probe", version: "0" },
  });
  const stand = await child.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "@nks/nks-dev", karta: "931", name: "raised-1" },
  });
  assert.ok(!stand.result?.isError, `stand: ${textOfReply(stand)}`);
  const sent = fake.state.calls
    .filter((c) => c.name === "iskron_channel" && c.arguments.action === "register")
    .map((c) => c.arguments.spawned_for);
  assert.ok(
    sent.some((s) => s?.invite === 463 && s?.room === room),
    `spawned_for never rode the register: ${JSON.stringify(sent)}`,
  );
  // Repeat by the same place — quiet, no error (the claim is the place's own).
  const again = await child.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "@nks/nks-dev", karta: "931", name: "raised-1" },
  });
  assert.ok(!again.result?.isError, `repeat: ${textOfReply(again)}`);
  // A rival place under the same invite — 409 spawned_for_claimed, loud.
  const rival = thinBridge(dirOf(), { ISKRON_BRIDGE_SPAWNED_FOR: claim(463) });
  t.after(() => rival.stop());
  await rival.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "rival-probe", version: "0" },
  });
  const rr = await rival.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "@nks/nks-dev", karta: "931", name: "raised-2" },
  });
  assert.ok(rr.result?.isError, "the rival must be refused");
  assert.match(textOfReply(rr), /spawned_for_claimed/);
  // An invite the queue does not hold — 422 spawned_for_unknown, loud.
  const bogus = thinBridge(dirOf(), { ISKRON_BRIDGE_SPAWNED_FOR: claim(999) });
  t.after(() => bogus.stop());
  await bogus.call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "bogus-probe", version: "0" },
  });
  const br = await bogus.call("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "@nks/nks-dev", karta: "931", name: "raised-3" },
  });
  assert.ok(br.result?.isError, "the unknown invite must be refused");
  assert.match(textOfReply(br), /spawned_for_unknown/);
  await child.stop();
  await rival.stop();
  await bogus.stop();
  await fake.stop();
});

test("orchestra: step reads invites and raised from its cursor; a step sees only the new", async () => {
  const fake = await startFakeNks({ pat: "probe-pat" });
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseReader(dir, fake);
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    const orchestra = (realms) => fake.control({ orchestra: { realms } });
    await orchestra({
      "@nks/nks-dev": { invites: [invite], signals: [signal(1, "raised"), signal(2, "joined")] },
    });
    const on = await cli(["on", "--realm", "@nks/nks-dev", "--auth-dir", dir]).done;
    assert.equal(on.code, 0, on.err);
    const first = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(first.code, 0, first.err + first.out);
    assert.match(first.out, /такт прошёл/, first.out);
    assert.match(first.out, /@nks\/nks-dev/, first.out);
    assert.match(first.out, /приглашений 1/, first.out);
    assert.match(first.out, /сигналов 2/, first.out);
    assert.match(first.out, /raised 1, joined 1/, first.out);
    const kept = JSON.parse(readFileSync(cursorsAt(dir), "utf8"));
    assert.equal(kept.realms["@nks/nks-dev"].cursor, "c2", "the cursor lies beside the grant");
    // Nothing new: the cursor holds, the standing invites stay the queue's truth.
    const again = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /сигналов 0/, again.out);
    assert.match(again.out, /приглашений 1/, again.out);
    // One new signal: only it is seen — the cursor did its work.
    await orchestra({
      "@nks/nks-dev": {
        invites: [invite],
        signals: [signal(1, "raised"), signal(2, "joined"), signal(3, "left")],
      },
    });
    const third = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(third.code, 0, third.err);
    assert.match(third.out, /сигналов 1/, third.out);
    assert.match(third.out, /left 1/, third.out);
    // status carries the cursors and the last tact (#8202).
    const st = await cli(["status", "--auth-dir", dir]).done;
    assert.equal(st.code, 0, st.err);
    assert.match(st.out, /@nks\/nks-dev/, st.out);
    assert.match(st.out, /c3/, st.out);
  } finally {
    await d.stop();
    await fake.stop();
  }
});

test("orchestra: a failed read refuses the whole tact — cursors unmoved, nothing ordered", async () => {
  const fake = await startFakeNks({ pat: "probe-pat" });
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseReader(dir, fake);
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    await fake.control({
      orchestra: {
        realms: {
          "@nks/nks-dev": { invites: [], signals: [signal(1, "raised"), signal(2, "joined")] },
          "@nks/drugoy": { refuse: 503 },
        },
      },
    });
    const on = await cli([
      "on",
      "--realm",
      "@nks/nks-dev",
      "--realm",
      "@nks/drugoy",
      "--auth-dir",
      dir,
    ]).done;
    assert.equal(on.code, 0, on.err);
    const refused = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.err, /такт отказан целиком/, refused.err);
    assert.match(refused.err, /@nks\/drugoy/, refused.err);
    assert.match(refused.err, /503/, refused.err);
    assert.ok(!existsSync(cursorsAt(dir)), "a refused tact advanced no realm's cursor");
    // The refusal kept the healthy realm's cursor too: its tape is read whole next time.
    await fake.control({
      orchestra: {
        realms: {
          "@nks/nks-dev": {
            invites: [],
            signals: [signal(1, "raised"), signal(2, "joined"), signal(3, "left")],
          },
          "@nks/drugoy": { invites: [], signals: [] },
        },
      },
    });
    const ok = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(ok.code, 0, ok.err + ok.out);
    assert.match(ok.out, /сигналов 3/, ok.out);
    assert.match(ok.out, /@nks\/drugoy/, ok.out);
  } finally {
    await d.stop();
    await fake.stop();
  }
});

test("orchestra: step with the orchestrator off is an idle tact — honest and quiet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir);
  try {
    await untilDoor(dir);
    const r = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /такт пуст/, r.out);
    assert.ok(!existsSync(cursorsAt(dir)), "an idle tact wrote no cursors");
  } finally {
    await d.stop();
  }
});

test("orchestra: no known api — the tact is refused aloud, not guessed from the mcp server", async () => {
  const fake = await startFakeNks({ pat: "probe-pat" });
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  // No hold record and no live session: the daemon holds no channel, so the api address
  // beside it is unknown — and the mcp server url does NOT name it (live probe, mcp.iskron.ru).
  writeFileSync(join(dir, "server"), `${fake.base}/mcp\n`);
  writeFileSync(join(dir, "token"), "probe-pat");
  const d = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    const on = await cli(["on", "--realm", "@nks/nks-dev", "--auth-dir", dir]).done;
    assert.equal(on.code, 0, on.err);
    const r = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /адрес api неизвестен/, r.err);
  } finally {
    await d.stop();
    await fake.stop();
  }
});

test("orchestra: a short rN realm is refused at the boundary — it does not ride REST as is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseDaemon(dir, { ISKRON_ORCHESTRA: "1" });
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    const on = await cli(["on", "--realm", "r5", "--auth-dir", dir]).done;
    assert.equal(on.code, 1, on.out);
    assert.match(on.err, /r5/, on.err);
    assert.match(on.err, /@owner\/slug/, on.err);
    // the flag stays empty: nothing half-accepted lies beside the grant
    const st = await cli(["status", "--auth-dir", dir]).done;
    assert.doesNotMatch(st.out, /r5/, st.out);
  } finally {
    await d.stop();
  }
});

test("orchestra: the only live root place recorded rN — its graph resolves and stays in the boundary", async () => {
  const fake = await startFakeNks({ pat: "probe-pat" });
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  // #7514: the boundary holds the graphs of the machine's live agents whatever the record's
  // spelling. The single live place is recorded as r5 (as live records carry); a dead r9
  // record (expired) leaves by liveness, not by name (#8202, word [27] of №1260).
  const d = await raiseReader(dir, fake, ["r5"]);
  // The machine's real record shape: the standing act (stoodAt) is hours old while the
  // record's heartbeat (at) is fresh — liveness follows at, as readHoldRecord reads it.
  writeFileSync(
    join(dir, "standings", "probe-1.hold"),
    JSON.stringify({
      realm: "r5",
      karta: 931,
      name: "probe-1",
      url: `${fake.base}/channel/ws/probe-1`,
      stoodAt: Date.now() - 7 * 60 * 60 * 1000,
      at: Date.now(),
    }) + "\n",
  );
  writeFileSync(
    join(dir, "standings", "dead-r9.hold"),
    JSON.stringify({
      realm: "r9",
      karta: 931,
      name: "dead-probe",
      url: `${fake.base}/channel/ws/dead`,
      at: Date.now() - 7 * 60 * 60 * 1000,
    }) + "\n",
  );
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    await fake.control({
      orchestra: { realms: { "@nks/nks-dev": { invites: [], signals: [signal(1, "raised")] } } },
    });
    // No named boundary at all: the discovered half must carry the resolved graph alone.
    const on = await cli(["on", "--auth-dir", dir]).done;
    assert.equal(on.code, 0, on.err);
    const r = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /@nks\/nks-dev/, `${r.out} — r5 resolved, not skipped`);
    assert.match(r.out, /сигналов 1/, r.out);
    assert.doesNotMatch(r.out, /r5|такт пуст/, r.out);
    const kept = JSON.parse(readFileSync(cursorsAt(dir), "utf8"));
    assert.equal(
      kept.realms["@nks/nks-dev"].cursor,
      "c1",
      "the cursor lies under the canonical name",
    );
    assert.ok(!("r5" in kept.realms), "no cursor under the short form");
  } finally {
    await d.stop();
    await fake.stop();
  }
});

test("orchestra: a live rN the realm list does not know — the tact is refused, boundary named incomplete", async () => {
  const fake = await startFakeNks({ pat: "probe-pat" });
  const dir = mkdtempSync(join(tmpdir(), "iskron-orchestra-"));
  const d = await raiseReader(dir, fake, ["r99"]);
  try {
    await untilDoor(dir, { ISKRON_ORCHESTRA: "1" });
    const on = await cli(["on", "--realm", "@nks/nks-dev", "--auth-dir", dir]).done;
    assert.equal(on.code, 0, on.err);
    const r = await cli(["step", "--auth-dir", dir]).done;
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /r99/, r.err);
    assert.match(r.err, /не разрешается/, r.err);
    assert.match(r.err, /граница неполна/, r.err);
    assert.ok(!existsSync(cursorsAt(dir)), "a refused tact advanced nothing");
  } finally {
    await d.stop();
    await fake.stop();
  }
});
