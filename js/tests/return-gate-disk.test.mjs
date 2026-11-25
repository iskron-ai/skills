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
    await fake.control({ standingRegisterDelayMs: REG_MS });
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
  });
});

/** The machine's daemons by their «listening» lines, in order. */
const daemonsOf = (dir) =>
  [...journalOf(dir).matchAll(/ pid=(\d+) \S+ listening /g)].map((m) => +m[1]);

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
