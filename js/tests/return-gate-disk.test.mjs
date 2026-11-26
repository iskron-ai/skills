// Ворота возврата машины (граф @nks/nks-dev, #11375) и возврат мест с диска: после перезагрузки
// плагина или самообновления (смена демона) каждое место перерегистрируется — тем же порядком,
// что возврат сессии: первая — проба, остальные ждут её исхода и идут не больше двух разом.
// Настоящие тонкие мосты через настоящий демон на фейке NKS. ISKRON_BRIDGE_PATH — на прежнюю сборку.
import assert from "node:assert/strict";
import { test } from "node:test";

import { journalOf, stood, waitFor, withFake } from "./lifeend-kit.mjs";

const REG_MS = 300; // каждый register идёт столько: видно, сколько их в полёте
const N = 4;

/** Наибольшее число register в полёте: начатых в пределах REG_MS друг от друга. */
const peak = (at) =>
  Math.max(0, ...at.map((t) => at.filter((u) => u <= t && u > t - REG_MS).length));

test("seats returning from disk after a reload or a self-update: one register first, then at most two at once", async () => {
  await withFake(async ({ fake, bridge }) => {
    for (let i = 0; i < N; i++) {
      const a = await bridge();
      await a.request("iskron/resume", { session: `ses-rg-${i}` });
      await stood(a, `rgd-${i}`);
      assert.equal((await a.request("iskron/away")).result?.away, true);
      a.proc.stdin.end();
      await a.gone();
    }
    const from = fake.state.registerAt.length;
    const fromInit = fake.state.initAt.length;
    await fake.control({ standingRegisterDelayMs: REG_MS, initDelayMs: REG_MS });
    const back = await Promise.all(
      Array.from({ length: N }, async (_, i) => {
        const b = await bridge();
        return b.request("iskron/resume", {
          key: `rgd-${i}--931--_nks_nks-dev`,
          session: `ses-rg-${i}`,
        });
      }),
    );
    for (const r of back) assert.equal(r.result?.resumed, true, JSON.stringify(r));
    const at = fake.state.registerAt.slice(from);
    assert.ok(at.length >= N, `every seat registered again: ${at.length}`);
    const [first, ...rest] = at;
    assert.ok(
      rest.every((t) => t - first >= REG_MS),
      `the probe's register answered before any other went: ${at.map((t) => t - first)}`,
    );
    assert.ok(peak(rest) <= 2, `at most two at once: ${at.map((t) => t - first)}`);
    // The new bridges' own handshakes before the returns: at most two in flight too.
    const inits = fake.state.initAt.slice(fromInit);
    assert.ok(inits.length >= N, `each new bridge opened its session: ${inits.length}`);
    assert.ok(
      peak(inits) <= 2,
      `initializes at most two in flight: ${inits.map((t) => t - inits[0])}`,
    );
  });
});

// A plugin reload: N new thin bridges at once on one daemon, each with an ordinary initialize (no
// replay) — never more than two in flight, spread; one lone new session goes at once.
// The register-by-call path (registergate.ts registerByCall — the disk return's register): each
// seat's first register meets a seat-open race (409 without a rule) and goes once more. The retry
// goes through the gate as the first did: first tries and retries together never more than two
// in flight, however short the window (№5817 [579]).
test("seats returning from disk, each first register raced (409): the retries go through the gate too — at most two registers in flight", async (t) => {
  const was = [process.env.ISKRON_BRIDGE_RETURN_STEP_MS, process.env.ISKRON_BRIDGE_RETURN_CAP_MS];
  // The daemon the first bridge raises takes them: the window as short as it gets.
  process.env.ISKRON_BRIDGE_RETURN_STEP_MS = process.env.ISKRON_BRIDGE_RETURN_CAP_MS = "1";
  t.after(() => {
    for (const [k, v] of [
      ["ISKRON_BRIDGE_RETURN_STEP_MS", was[0]],
      ["ISKRON_BRIDGE_RETURN_CAP_MS", was[1]],
    ])
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
  await withFake(async ({ fake, bridge }) => {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = await bridge();
      await a.request("iskron/resume", { session: `ses-rr-${i}` });
      await stood(a, `rrd-${i}`);
      assert.equal((await a.request("iskron/away")).result?.away, true);
      a.proc.stdin.end();
      await a.gone();
    }
    const before = fake.state.counts.register_standing;
    // Each seat's own first register meets the race, whatever order they come in under load:
    // a count of «the next n» would let a fast seat's retry take a slow seat's refusal.
    await fake.control({
      structured: true,
      registerConcurrentOnce: Array.from({ length: n }, (_, i) => `931:rrd-${i}`),
      registerToolDelayMs: 200,
    });
    fake.state.registerPeak = 0;
    const back = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const b = await bridge();
        return b.request("iskron/resume", {
          key: `rrd-${i}--931--_nks_nks-dev`,
          session: `ses-rr-${i}`,
        });
      }),
    );
    assert.equal(fake.state.counts.register_concurrent, n, "each seat's first try met the race");
    assert.ok(
      fake.state.registerPeak <= 2,
      `at most two registers in flight: ${fake.state.registerPeak}`,
    );
    for (const r of back) assert.equal(r.result?.resumed, true, JSON.stringify(r));
    assert.ok(fake.state.counts.register_standing - before >= n, "every seat registered again");
  });
});

/** The daemon the first bridge raises takes these variables; restored after the test. */
function withEnv(t, vars) {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  t.after(() => {
    for (const [k, v] of Object.entries(was))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });
}

/** N seats stood, each its own session through one daemon. */
async function seats(bridge, n, prefix) {
  const all = [];
  for (let i = 0; i < n; i++) {
    const b = await bridge();
    await b.request("iskron/resume", { session: `ses-${prefix}-${i}` });
    await stood(b, `${prefix}-${i}`);
    all.push(b);
  }
  return all;
}

// The automatic board reads (#11337, #11375, #11351; №5817 [617]): the machine's seats come back
// together with their hearing not proven — the sockets reopened, no hello yet — and each
// watchdog's check reads the board. Each read is a return through the gate: the probe's read
// answered before any other goes, then at most two in flight, each after its drawn delay.
test("seats coming back with hearing not proven: their board reads go one first, then at most two in flight, spread", async (t) => {
  const LIST_MS = 300;
  withEnv(t, { ISKRON_BRIDGE_RETURN_STEP_MS: "100", ISKRON_BRIDGE_RETURN_DRAW: "0.5" });
  await withFake(async ({ fake, dir, bridge }) => {
    const n = 5;
    const all = await seats(bridge, n, "rb");
    const sockets = fake.state.ws.size;
    await fake.control({ ws_mute: n, ws_close: 1012 }); // the sockets reopen, no hello comes
    await waitFor(
      "the sockets reopened",
      () => fake.state.wsMute === 0 && fake.state.ws.size >= sockets,
    );
    fake.state.listDelayMs = LIST_MS;
    fake.state.listPeak = 0;
    fake.state.listAt = [];
    await Promise.all(all.map((b) => b.request("iskron/check", {})));
    const at = fake.state.listAt;
    assert.ok(at.length >= n, `every check read the board: ${at.length}`);
    const [first, ...rest] = at;
    assert.ok(
      rest.every((x) => x - first >= LIST_MS - 20),
      `the probe's read answered before any other went: ${at.map((x) => x - first)}`,
    );
    assert.ok(
      fake.state.listPeak <= 2,
      `at most two board reads in flight: ${fake.state.listPeak}`,
    );
    // Each read says itself in the journal: a live run counts them from the bridge's log.
    const said = (journalOf(dir).match(/board read \(watchdog check, /g) ?? []).length;
    assert.ok(said >= n, `a journal line for every board read: ${said}`);
  });
});

// An mcp restart under live sockets (#11351): every session is lost, the sockets hear on — the
// hearing is proven, so no seat reads the board, whatever the sessions' return does.
test("an mcp restart with live sockets: the sessions come back without a single board read", async () => {
  await withFake(async ({ fake, bridge }) => {
    const all = await seats(bridge, N, "rl");
    const lists = fake.state.counts.list;
    await fake.control({ kill_session: true });
    for (const b of all) {
      const r = await b.request("tools/call", { name: "iskron_orient", arguments: {} });
      assert.ok(r.result && !r.error, JSON.stringify(r));
      await b.request("iskron/check", {});
    }
    assert.equal(fake.state.counts.list - lists, 0, "no board read");
  });
});

test("a plugin reload: N new sessions' initializes never more than two in flight; a lone one goes at once", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    await bridge(); // the daemon is up
    await fake.control({ initDelayMs: REG_MS });
    const from = fake.state.initAt.length;
    await Promise.all(Array.from({ length: 6 }, () => bridge()));
    const at = fake.state.initAt.slice(from).sort((a, b) => a - b);
    assert.equal(at.length, 6, `one initialize per new session: ${at.length}`);
    assert.ok(peak(at) <= 2, `never more than two in flight: ${at.map((t) => t - at[0])}`);
    await new Promise((r) => setTimeout(r, 500));
    const lone = fake.state.initAt.length;
    const t0 = Date.now();
    await bridge();
    const took = Date.now() - t0;
    assert.equal(fake.state.initAt.length - lone, 1);
    assert.ok(took < REG_MS + 1500, `the lone initialize went at once: ${took} ms`);
    const gateLines = journalOf(dir)
      .split("\n")
      .filter((l) => /return gate: .* waiting/.test(l));
    assert.ok(gateLines.length <= 6, "no wait line for the lone one beyond the crowd's");
  });
});

/** The machine's daemons by their «listening» lines, in order. */
const daemonsOf = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);

const whoami = { name: "iskron_me", arguments: { action: "whoami" } };

// The LAB run of batch A (№5817), its first mcp restart: the seats had been left by the bridge
// (nobody listened for 15 minutes — its socket closed, the seat parked) when every session was
// lost; then each seat made one call. The rebind read the board for every parked seat — the deaf
// check — and then sent no register anyway (a left seat is not re-registered): six board reads
// for nothing, and again on every next call. A parked seat is no rebind's: no board read, no
// register; it returns by its own stand (#11351, #11337).
test("an mcp restart over seats the bridge had left: no board read and no register on the return", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const all = await seats(bridge, N, "lp");
    for (const b of all) {
      const r = await b.request("tools/call", {
        name: "iskron_channel",
        arguments: { action: "leave", realm: "nks-dev" },
      });
      assert.ok(r.result && !r.result.isError, JSON.stringify(r));
    }
    const [lists, regs] = [fake.state.counts.list, fake.state.counts.register_standing];
    await fake.control({ kill_session: true });
    for (let round = 0; round < 2; round++)
      for (const b of all) {
        const r = await b.request("tools/call", whoami);
        assert.ok(r.result && !r.error, JSON.stringify(r));
      }
    assert.equal(fake.state.counts.list - lists, 0, `no board read:\n${journalOf(dir)}`);
    assert.equal(fake.state.counts.register_standing - regs, 0, "a left seat is not registered");
    assert.equal(
      (journalOf(dir).match(/board read \(/g) ?? []).length,
      0,
      "no board read line in the journal",
    );
  });
});

// The LAB run of batch A (№5817): seats stood; a daemon handover (SIGTERM) — the successor
// returns each seat from disk; then an mcp restart loses every session with the sockets alive,
// and each seat makes one call. The return re-registers each seat and reads no board: the
// socket hears on — a lost session is not a deaf seat (#11351, #11337).
test("after a handover, an mcp restart under live sockets: each seat re-registers and no board is read", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const all = await seats(bridge, N, "lh");
    const [first] = await waitFor("the daemon", () => daemonsOf(dir).length && daemonsOf(dir));
    process.kill(first, "SIGTERM");
    await waitFor("the successor", () => daemonsOf(dir).length >= 2, 20_000);
    for (const b of all) {
      const r = await b.request("tools/call", whoami);
      assert.ok(r.result && !r.error, JSON.stringify(r));
    }
    await waitFor("the seats back from disk", () =>
      (journalOf(dir).match(/standing resumed from disk/g) ?? []).length >= N ? true : null,
    );
    const [lists, regs] = [fake.state.counts.list, fake.state.counts.register_standing];
    await fake.control({ kill_session: true });
    for (const b of all) {
      const r = await b.request("tools/call", whoami);
      assert.ok(r.result && !r.error, JSON.stringify(r));
    }
    assert.equal(fake.state.counts.register_standing - regs, N, "each seat registered again");
    assert.equal(fake.state.counts.list - lists, 0, `no board read:\n${journalOf(dir)}`);
    for (const [i, b] of all.entries()) {
      const r = await b.request("tools/call", {
        name: "iskron_channel",
        arguments: { action: "revoke", realm: "nks-dev", karta: 931, standing: `lh-${i}` },
      });
      assert.ok(r.result && !r.error, JSON.stringify(r));
    }
    assert.equal(
      fake.state.counts.list - lists,
      0,
      `no board read by the revoke:\n${journalOf(dir)}`,
    );
  });
});

// A daemon handover (a self-update's crest, #11375; №5817 [292]): every thin bridge replays the
// harness's initialize to the successor — a return, not a session's first handshake: one first,
// then at most two in flight, spread.
test("a daemon handover: the successor's upstream initializes for the sessions it took over — one first, then at most two in flight", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const all = [];
    for (let i = 0; i < N; i++) {
      const b = await bridge();
      const r = await b.request("tools/call", { name: "iskron_orient", arguments: {} });
      assert.ok(r.result && !r.error, JSON.stringify(r));
      all.push(b);
    }
    const [first] = await waitFor("the daemon", () => daemonsOf(dir).length && daemonsOf(dir));
    const from = fake.state.initAt.length;
    await fake.control({ initDelayMs: REG_MS });
    process.kill(first, "SIGKILL");
    await waitFor("the successor", () => daemonsOf(dir).length >= 2, 20_000);
    const back = await Promise.all(
      all.map((b) => b.request("tools/call", { name: "iskron_orient", arguments: {} })),
    );
    for (const r of back) assert.ok(r.result && !r.error, JSON.stringify(r));
    const at = fake.state.initAt.slice(from).sort((a, b) => a - b);
    assert.ok(at.length >= N, `every session opened again: ${at.length}`);
    const [probe, ...rest] = at;
    assert.ok(
      rest.every((t) => t - probe >= REG_MS),
      `the probe's initialize answered before any other went: ${at.map((t) => t - probe)}`,
    );
    assert.ok(peak(rest) <= 2, `at most two in flight: ${at.map((t) => t - probe)}`);
  });
});
