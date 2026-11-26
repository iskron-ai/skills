// Ворота возврата машины (граф @nks/nks-dev, #11375): сессии MCP потеряны разом (перезапуск mcp —
// 404 на их id) — первая вернувшаяся сессия — проба, одна на машину; остальные ждут её исхода и
// возвращаются не больше двух разом, каждая после случайной задержки в окне. Проба встретила 503 —
// окно «сервер лёг»: ждущие не стучат, их вызовы — «не отправлено», следующая проба — по окну.
// Перерегистрация мест после потери сессии — тем же порядком; без вызова сессия не возвращается.
// Настоящий демон и сессии по шву на фейке NKS. ISKRON_BRIDGE_PATH — на прежнюю сборку.
import assert from "node:assert/strict";
import { test } from "node:test";

import { sleep, textOf, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const INIT_MS = 300; // каждое рукопожатие идёт столько: видно, сколько их в полёте
const STEP_MS = 400;
const ENV = { ISKRON_BRIDGE_RETURN_STEP_MS: String(STEP_MS) };
const look = (s) => s.rpc("tools/call", { name: "iskron_orient", arguments: { realm: REALM } });

/** Наибольшее число рукопожатий в полёте: начатых в пределах INIT_MS друг от друга. */
const peak = (at) =>
  Math.max(0, ...at.map((t) => at.filter((u) => u <= t && u > t - INIT_MS).length));

async function sessions(session, n) {
  const all = [];
  for (let i = 0; i < n; i++) all.push(await session());
  for (const s of all) assert.ok(!(await look(s)).result?.isError, "precondition: a session works");
  return all;
}

test("all sessions lose MCP at once: one initialize from the machine first, then at most two in flight, spread over the window", async () => {
  await withMux(
    async ({ fake, session, journal }) => {
      const all = await sessions(session, 6);
      const from = fake.state.initAt.length;
      await fake.control({ kill_session: true, initDelayMs: INIT_MS });
      const t0 = Date.now();
      const got = await Promise.all(all.map(look));
      for (const r of got) assert.ok(!r.result?.isError && !r.error, JSON.stringify(r));
      const at = fake.state.initAt.slice(from);
      assert.equal(at.length, 6, `one initialize per session, no more: ${at.map((t) => t - t0)}`);
      const [probe, ...rest] = at;
      assert.ok(
        rest.every((t) => t - probe >= INIT_MS),
        `the probe's initialize answered before any other went: ${at.map((t) => t - t0)}\n${journal()}`,
      );
      assert.ok(peak(rest) <= 2, `at most two returns in flight: ${at.map((t) => t - t0)}`);
      assert.ok(at.at(-1) - t0 <= STEP_MS * 6 + INIT_MS * 6, "within the window");
      assert.match(journal(), /return gate: this session is the machine's probe/);
    },
    { daemonEnv: ENV },
  );
});

// #11375 (№5817 [585]): every return after the probe's outcome draws its delay — two returns at
// once too, not only a crowd. The window at its default (1 s per waiting); the draw fixed at 0.9
// so that it is seen drawn: the second initialize goes no earlier than the probe's answer plus
// 900 ms — never two initializes from the machine within the first second.
test("two sessions lose MCP at once: the second returns after the probe's outcome and a drawn delay — never two initializes in the first second", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 2);
      const from = fake.state.initAt.length;
      await fake.control({ kill_session: true, initDelayMs: INIT_MS });
      const back = await Promise.all(all.map(look));
      for (const r of back) assert.ok(!r.result?.isError, JSON.stringify(r));
      const at = fake.state.initAt.slice(from);
      assert.equal(at.length, 2, `one initialize each: ${at.length}`);
      const [probe, second] = at;
      assert.ok(
        second - probe >= INIT_MS + 900 - 50,
        `the second after the probe's answer and its drawn delay: ${second - probe} ms`,
      );
      assert.ok(second - probe >= 1000, "never two initializes in the first second");
    },
    { daemonEnv: { ISKRON_BRIDGE_RETURN_DRAW: "0.9" } },
  );
});

test("no session returns without a call: only the sessions that call knock", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 4);
      const from = fake.state.initAt.length;
      await fake.control({ kill_session: true });
      await Promise.all(all.slice(0, 2).map(look));
      await sleep(STEP_MS * 4);
      assert.equal(fake.state.initAt.length - from, 2, "two calls, two returns — the idle wait");
    },
    { daemonEnv: ENV },
  );
});

test("the probe meets 503: the waiting do not knock and answer «not sent»; the next probe goes by the window", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 5);
      const from = fake.state.initAt.length;
      const requests = () => fake.state.counts.mcp; // every MCP POST that reached the server
      await fake.control({ kill_session: true, initRefuse: { status: 503, retryAfter: 2 } });
      const got = await Promise.all(all.map(look));
      for (const r of got)
        assert.match(textOf(r) + JSON.stringify(r.error ?? ""), /server unavailable/);
      assert.equal(fake.state.initAt.length - from, 1, "one initialize: the probe's");
      const calls = requests();
      const again = await Promise.all(all.map(look)); // inside the window
      for (const r of again) assert.match(JSON.stringify(r.error ?? r), /not sent/);
      assert.equal(fake.state.initAt.length - from, 1, "no waiter knocked inside the window");
      assert.equal(requests(), calls, "no request at all inside the window");
      await fake.control({ initRefuse: null });
      await sleep(2_500); // the window's time is up
      const back = await look(all[0]);
      assert.ok(!back.error && !back.result?.isError, JSON.stringify(back));
      assert.equal(fake.state.initAt.length - from, 2, "the next probe, one");
    },
    { daemonEnv: ENV },
  );
});

// The reviewer's scene (№5817 [573]): each seat's first re-registration meets a seat-open race
// (409 without a rule) and goes once more. The retry is a register of the same return: through
// the gate, counted in flight — first tries and retries together never more than two at once,
// however short the window.
test("a re-registration's retry after a seat-open race goes through the gate too: at most two registers in flight, first tries and retries together", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 5);
      for (const [i, s] of all.entries())
        assert.ok(!(await s.stand({ realm: REALM, karta: 931, name: `rr-${i}` })).result?.isError);
      const before = fake.state.counts.register_standing;
      await fake.control({
        kill_session: true,
        structured: true, // the race is told by the refusal's status, 409 without a rule
        // each seat's own first try, whatever order they come in under load
        registerConcurrentOnce: Array.from({ length: 5 }, (_, i) => `931:rr-${i}`),
        registerToolDelayMs: 200,
      });
      fake.state.registerPeak = 0;
      await Promise.all(all.map(look));
      assert.equal(fake.state.counts.register_concurrent, 5, "each seat's first try met the race");
      assert.ok(
        fake.state.registerPeak <= 2,
        `at most two registers in flight: ${fake.state.registerPeak}`,
      );
      assert.ok(
        fake.state.counts.register_standing - before >= 5,
        `every seat registered again: ${fake.state.counts.register_standing - before}`,
      );
    },
    { daemonEnv: { ISKRON_BRIDGE_RETURN_STEP_MS: "1", ISKRON_BRIDGE_RETURN_CAP_MS: "1" } },
  );
});

test("re-registration of seats after the lost session goes the same way: one first, then at most two at once", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 5);
      for (const [i, s] of all.entries())
        assert.ok(!(await s.stand({ realm: REALM, karta: 931, name: `rg-${i}` })).result?.isError);
      const regs = () => fake.state.registerAt ?? [];
      const from = regs().length;
      // Each register lies INIT_MS long: at most two in flight leave at most two ends in any
      // INIT_MS window (the fake stamps a register when it lies).
      await fake.control({
        kill_session: true,
        initDelayMs: INIT_MS,
        standingRegisterDelayMs: INIT_MS,
      });
      await Promise.all(all.map(look));
      const at = regs().slice(from);
      assert.ok(at.length >= 5, `every seat registered again: ${at.length}`);
      const first = at[0];
      assert.ok(peak(at) <= 2, `spread, at most two at once: ${at.map((t) => t - first)}`);
    },
    { daemonEnv: ENV },
  );
});
