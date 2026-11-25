// Ворота возврата машины (граф @nks/nks-dev, #11375) и возврат мест с диска: после перезагрузки
// плагина или самообновления (смена демона) каждое место перерегистрируется — тем же порядком,
// что возврат сессии: первая — проба, остальные ждут её исхода и идут не больше двух разом.
// Настоящие тонкие мосты через настоящий демон на фейке NKS. ISKRON_BRIDGE_PATH — на прежнюю сборку.
import assert from "node:assert/strict";
import { test } from "node:test";

import { stood, withFake } from "./lifeend-kit.mjs";

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
