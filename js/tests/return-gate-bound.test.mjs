// Ворота возврата машины (граф @nks/nks-dev, #11375, #11413), три дефекта пути залпа из обзора:
// предел ~20 с держит всё время вызова у ворот — исход пробы, задержку и слот, а не одну задержку;
// чтение доски для вызова в руках (место без слуха) — под тем же пределом; хвост возврата не идёт
// мимо пробы, а метка «вернулась» живёт до следующей потери сессии. Настоящий демон и сессии по
// шву на фейке NKS (ISKRON_BRIDGE_PATH — на прежнюю сборку); хвост против пробы — на исходнике.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sleep, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const look = (s) => s.rpc("tools/call", { name: "iskron_orient", arguments: { realm: REALM } });
const leave = (s) =>
  s.rpc("tools/call", { name: "iskron_channel", arguments: { realm: REALM, action: "leave" } });
const ok = (r) => !r.error && !r.result?.isError;
const LATER = /место возвращается — сервер не тронут, повтори через (\d+) с|call again in (\d+) s/;
const laterS = (r) => {
  const m = LATER.exec(JSON.stringify(r?.error ?? r?.result ?? r));
  return m ? Number(m[1] ?? m[2]) : null;
};
const timed = async (p) => {
  const t = Date.now();
  const r = await p;
  return { r, ms: Date.now() - t };
};
const LIMIT = 1500;
const TIGHT = {
  ISKRON_BRIDGE_RETURN_LIMIT_MS: String(LIMIT),
  ISKRON_BRIDGE_RETURN_STEP_MS: "1",
  ISKRON_BRIDGE_RETURN_CAP_MS: "1",
};

async function sessions(session, n) {
  const all = [];
  for (let i = 0; i < n; i++) all.push(await session());
  for (const s of all) assert.ok(ok(await look(s)), "precondition: a session works");
  return all;
}

// Обзор PR (1): проба отвечает медленно — ждущий её исхода вызов висел, сколько висит проба.
test("waiting for a slow probe: the call answers «returning» at the limit, not when the probe answers", async () => {
  await withMux(
    async ({ fake, session }) => {
      const [probe, other] = await sessions(session, 2);
      const inits = fake.state.initAt.length;
      await fake.control({ kill_session: true, initDelayMs: 4000 });
      const first = timed(look(probe));
      await sleep(150); // the probe is out
      const { r, ms } = await timed(look(other));
      assert.notEqual(laterS(r), null, `answered «returning»: ${JSON.stringify(r)}`);
      assert.ok(ms < LIMIT + 700, `at the limit, not after the probe: ${ms} ms`);
      assert.equal(fake.state.initAt.length - inits, 1, "only the probe's initialize went");
      assert.ok(ok((await first).r), "the probe's own call went through");
    },
    { daemonEnv: TIGHT },
  );
});

// Обзор PR (1): после пробы двое в полёте медленные — третий ждёт слота, и ожидание слота тоже
// считается в предел.
test("waiting for a slot behind two slow returns: the call answers «returning» at the limit", async () => {
  await withMux(
    async ({ fake, session }) => {
      const all = await sessions(session, 4);
      await fake.control({ kill_session: true, initDelayMs: 1100 });
      const t0 = Date.now();
      const got = await Promise.all(
        all.map(async (s) => ({ r: await look(s), at: Date.now() - t0 })),
      );
      const later = got.filter((g) => laterS(g.r) !== null);
      assert.ok(later.length >= 1, `a call waiting for a slot answered: ${JSON.stringify(got)}`);
      for (const g of later) assert.ok(g.at < LIMIT + 700, `at the limit: ${g.at} ms`);
    },
    { daemonEnv: TIGHT },
  );
});

// Обзор PR (2): место ушло словом — вызов в его граф читает доску (не слушает ли другая сессия);
// чтение — возврат через ворота, и дальняя очередь держала вызов целое окно.
test("a deaf seat's board read for a call: a far place at the gate answers «returning» at once", async () => {
  await withMux(
    async ({ fake, session, journal }) => {
      const [busy, deaf] = await sessions(session, 2);
      assert.ok(ok(await deaf.stand({ realm: REALM, karta: 931, name: "bd" })));
      assert.ok(ok(await leave(deaf)), "the seat is left — deaf");
      await fake.control({ kill_session: true, initDelayMs: 600 });
      const probe = look(busy);
      await sleep(150); // the probe is out: the read waits for its outcome, then its delay
      const lists = fake.state.counts.list;
      const { r, ms } = await timed(look(deaf));
      assert.ok(/board read \(hearing of bd/.test(journal()), "the call read the board");
      assert.notEqual(laterS(r), null, `answered «returning»: ${JSON.stringify(r)}`);
      assert.ok(ms < LIMIT + 700, `not held for the window: ${ms} ms`);
      await probe;
      await sleep(4500); // the read's turn has come: its call is gone, it sends nothing
      assert.equal(fake.state.counts.list, lists, "no board read went for the answered call");
    },
    {
      daemonEnv: {
        ISKRON_BRIDGE_RETURN_LIMIT_MS: String(LIMIT),
        ISKRON_BRIDGE_RETURN_STEP_MS: "4000",
        ISKRON_BRIDGE_RETURN_DRAW: "0.9",
      },
    },
  );
});

// Обзор PR (3): место вернулось, mcp перезапустился снова — стук вернувшейся сессии шёл хвостом
// мимо пробы машины, и метка «вернулась» не уходила до конца сессии.
test("a returned seat, mcp restarts again: its knock waits for the machine's one probe", async () => {
  await withMux(
    async ({ fake, session, journal }) => {
      const [other, seat] = await sessions(session, 2);
      assert.ok(ok(await seat.stand({ realm: REALM, karta: 931, name: "tq" })));
      await fake.control({ kill_session: true });
      assert.ok(ok(await look(seat)), "the seat returned once");
      assert.ok(ok(await look(other)));
      assert.ok(ok(await leave(seat)), "the seat is left — its calls read the board");
      await fake.control({ kill_session: true, initDelayMs: 1500 });
      const probe = look(other);
      await sleep(200);
      const mark = journal().length;
      const requests = fake.state.counts.mcp;
      const read = look(seat);
      await sleep(800); // the probe is still out
      assert.equal(fake.state.counts.mcp, requests, "nothing went past the probe in flight");
      await Promise.all([probe, read]);
      await sleep(200); // the journal is written behind the reply
      const probes =
        journal()
          .slice(mark)
          .match(/machine's probe/g) ?? [];
      assert.equal(probes.length, 0, "one probe per machine: the other's, out before the mark");
    },
    { daemonEnv: { ISKRON_BRIDGE_RETURN_STEP_MS: "1", ISKRON_BRIDGE_RETURN_CAP_MS: "1" } },
  );
});

// Метка «вернулась» — того возврата, что её заслужил: 404 на сессию или её отпуск её снимают,
// и следующий стук сессии — снова возврат через ворота, а не хвост.
test("on the source: the returned mark goes with the session — its 404 or letting it go drops it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-gate-mark-"));
  const server = createServer((_q, res) => res.writeHead(404).end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const { readArgs, setConfig } = await import("../bridge/config.ts");
  setConfig(readArgs([`http://127.0.0.1:${server.address().port}/mcp`, "--auth-dir", dir]));
  const { post, state } = await import("../bridge/transport.ts");
  state.sessionId = "lost-1";
  state.returned = "lost-1";
  const msg = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "x" } };
  await assert.rejects(
    post(msg, () => {}),
    /session expired upstream/,
  );
  assert.equal(state.returned, null, "the 404 dropped the mark");
  const { letGo } = await import("../bridge/transport.ts");
  state.sessionId = "lost-2";
  state.returned = "lost-2";
  state.goneSession = "lost-2"; // nothing to close upstream
  await letGo("a reopen");
  assert.equal(state.returned, null, "letting the session go dropped the mark");
});

test("on the source: a tail does not pass a probe out for the server, nor a probe that met the down window", async () => {
  const gate = await import("../bridge/returngate.ts");
  const { DownError, UpstreamError } = await import("../bridge/errors.ts");
  const at = [];
  const knock = (name, ms, fail) => async () => {
    at.push([name, "out", Date.now()]);
    await sleep(ms);
    at.push([name, "in", Date.now()]);
    if (fail) throw new DownError(null, UpstreamError.NOT_SENT, false, 1000);
    return name;
  };
  const probe = gate.throughGate("srv-a", knock("probe", 300), "return");
  await sleep(20);
  const tail = await gate.throughGate("srv-a", knock("tail", 10), "tail");
  await probe;
  assert.equal(tail, "tail");
  const end = at.find(([n, e]) => n === "probe" && e === "in")[2];
  const out = at.find(([n, e]) => n === "tail" && e === "out")[2];
  assert.ok(out >= end, `the tail went after the probe's outcome: ${out - end} ms`);

  const down = gate.throughGate("srv-b", knock("down", 100, true), "return").catch((e) => e);
  await sleep(20);
  const shut = await gate.throughGate("srv-b", knock("shut", 10), "tail").catch((e) => e);
  assert.ok(shut instanceof DownError, `the tail answers the down word: ${shut}`);
  assert.ok(!at.some(([n]) => n === "shut"), "and knocks nothing");
  assert.ok((await down) instanceof DownError);
});
