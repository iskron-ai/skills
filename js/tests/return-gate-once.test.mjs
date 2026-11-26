// Ворота возврата машины (граф @nks/nks-dev, #11375, #11413): место проходит ворота один раз на
// возврат — его перерегистрация после повторного открытия сессии второй задержки не тянет; вызов
// у ворот не висит дольше ~20 с — дальняя очередь отвечает сразу словом «место возвращается»,
// место остаётся в очереди; впущенная сессия пишет строку «admitted after». Настоящий демон и
// сессии по шву на фейке NKS. ISKRON_BRIDGE_PATH — на прежнюю сборку.
import assert from "node:assert/strict";
import { test } from "node:test";

import { sleep, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const look = (s) => s.rpc("tools/call", { name: "iskron_orient", arguments: { realm: REALM } });
const ok = (r) => !r.error && !r.result?.isError;
const GATE_LINE = /return gate: (this session is the machine's probe|\d+ waiting — )/;
const LATER = /место возвращается — сервер не тронут, повтори через (\d+) с|call again in (\d+) s/;
const laterS = (r) => {
  const m = LATER.exec(JSON.stringify(r.error ?? r.result ?? r));
  return m ? Number(m[1] ?? m[2]) : null;
};

/** Строки журнала демона после отметки `from`, по сессиям: id → строки. */
function bySession(text) {
  const out = new Map();
  for (const line of text.split("\n")) {
    const m = / \[(s\d+-\d+)\] (.*)$/.exec(line);
    if (!m) continue;
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(m[2]);
  }
  return out;
}

async function sessions(session, n) {
  const all = [];
  for (let i = 0; i < n; i++) all.push(await session());
  for (const s of all) assert.ok(ok(await look(s)), "precondition: a session works");
  return all;
}

// LAB, мост 8.16.6 (#11413): 107 из 165 мест прошли ворота второй раз — сразу после «session
// re-established», до «standing re-registered»; медленнейший ответ — сумма двух окон.
test("every seat loses its session at once: each seat logs one gate line, returns once, and the slowest call waits one window", async () => {
  const N = 6;
  const WAIT = 2850; // окно 3000 мс, жребий 0,95: каждая задержка видна целиком
  await withMux(
    async ({ fake, session, journal }) => {
      const all = await sessions(session, N);
      for (const [i, s] of all.entries())
        assert.ok(ok(await s.stand({ realm: REALM, karta: 931, name: `go-${i}` })));
      const [inits, regs] = [fake.state.initAt.length, fake.state.counts.register_standing];
      const mark = journal().length;
      await fake.control({ kill_session: true });
      const t0 = Date.now();
      const took = await Promise.all(
        all.map(async (s) => {
          const r = await look(s);
          assert.ok(ok(r), JSON.stringify(r));
          return Date.now() - t0;
        }),
      );
      const lines = bySession(journal().slice(mark));
      const gated = [...lines].filter(([, l]) => l.some((x) => GATE_LINE.test(x)));
      assert.equal(gated.length, N, `every seat came to the gate:\n${journal().slice(mark)}`);
      for (const [id, l] of gated) {
        const at = l.filter((x) => GATE_LINE.test(x));
        assert.equal(at.length, 1, `${id} passed the gate once:\n${l.join("\n")}`);
      }
      assert.equal(fake.state.initAt.length - inits, N, "one initialize per seat");
      assert.equal(fake.state.counts.register_standing - regs, N, "one register per seat");
      const admitted = journal()
        .slice(mark)
        .match(/return gate: admitted after \d+ ms \(waited for slot \d+ ms\)/g);
      assert.equal(admitted?.length, N - 1, "every waiting seat's admission is logged");
      assert.ok(
        Math.max(...took) <= WAIT + 1500,
        `the slowest call waited one window, not two: ${took}`,
      );
    },
    {
      daemonEnv: {
        ISKRON_BRIDGE_RETURN_STEP_MS: "3000",
        ISKRON_BRIDGE_RETURN_CAP_MS: "3000",
        ISKRON_BRIDGE_RETURN_DRAW: "0.95",
      },
    },
  );
});

// #11375: вызов, чья очередь у ворот ~40 с, не отправляется и сразу отвечает своей очередью; место
// остаётся в очереди — следующий вызов отвечает меньшим N и тоже ничего не шлёт.
test("a call whose turn is 40 s away answers within a second with N≈40, nothing upstream; the next one answers a smaller N", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 2);
      const inits = fake.state.initAt.length;
      await fake.control({ kill_session: true });
      const t0 = Date.now();
      const got = await Promise.all(all.map(look));
      const later = got.map(laterS);
      const i = later.findIndex((n) => n !== null);
      assert.ok(i >= 0, `one call answered «returning»: ${JSON.stringify(got)}`);
      assert.ok(ok(got[1 - i]), "the probe's call went through");
      assert.ok(Date.now() - t0 < 1500, `answered at once: ${Date.now() - t0} ms`);
      assert.ok(later[i] >= 39 && later[i] <= 41, `N≈40: ${later[i]}`);
      assert.equal(fake.state.initAt.length - inits, 1, "only the probe's initialize went");
      await sleep(1500);
      const calls = fake.state.counts.mcp;
      const t1 = Date.now();
      const again = await look(all[i]);
      assert.ok(Date.now() - t1 < 1000, "again at once");
      const n = laterS(again);
      assert.ok(n !== null && n < later[i] && n >= 37, `a smaller N: ${n} after ${later[i]}`);
      assert.equal(fake.state.counts.mcp, calls, "nothing upstream from the waiting seat");
    },
    { daemonEnv: { ISKRON_BRIDGE_RETURN_STEP_MS: "41000", ISKRON_BRIDGE_RETURN_DRAW: "0.98" } },
  );
});

// Предел сжат (BRIDGE_RETURN_LIMIT_MS): очередь 3,6 с дальше предела 1,5 с — вызов отвечает сразу;
// возврат идёт своим порядком, и вызов после него проходит без второго initialize и второй задержки.
test("the seat keeps its place: a call after its return goes through, with one initialize and one gate line", async () => {
  await withMux(
    async ({ fake, session, journal }) => {
      const all = await sessions(session, 2);
      const inits = fake.state.initAt.length;
      const mark = journal().length;
      await fake.control({ kill_session: true });
      const t0 = Date.now();
      const got = await Promise.all(all.map(look));
      const i = got.findIndex((r) => laterS(r) !== null);
      assert.ok(i >= 0, `one call answered «returning»: ${JSON.stringify(got)}`);
      assert.ok(Date.now() - t0 < 1500, `answered at once: ${Date.now() - t0} ms`);
      assert.equal(laterS(got[i]), 4, "N — the remaining wait in whole seconds");
      await sleep(4500);
      const t1 = Date.now();
      const back = await look(all[i]);
      assert.ok(ok(back), JSON.stringify(back));
      assert.ok(Date.now() - t1 < 1000, `the seat had returned: ${Date.now() - t1} ms`);
      assert.equal(fake.state.initAt.length - inits, 2, "one initialize each, none again");
      const lines = [...bySession(journal().slice(mark)).values()];
      for (const l of lines)
        assert.ok(
          l.filter((x) => GATE_LINE.test(x)).length <= 1,
          `one gate line:\n${l.join("\n")}`,
        );
    },
    {
      daemonEnv: {
        ISKRON_BRIDGE_RETURN_STEP_MS: "4000",
        ISKRON_BRIDGE_RETURN_DRAW: "0.9",
        ISKRON_BRIDGE_RETURN_LIMIT_MS: "1500",
      },
    },
  );
});

test("a call whose turn is under the limit waits and goes as before", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 2);
      await fake.control({ kill_session: true });
      const t0 = Date.now();
      const got = await Promise.all(all.map(look));
      for (const r of got) assert.ok(ok(r), JSON.stringify(r));
      assert.ok(Date.now() - t0 >= 1900, `the second waited its turn: ${Date.now() - t0} ms`);
    },
    { daemonEnv: { ISKRON_BRIDGE_RETURN_STEP_MS: "4000", ISKRON_BRIDGE_RETURN_DRAW: "0.5" } },
  );
});
