// Пульс через такт общего соединения (граф @nks/nks-dev: #7529, такт #8623; дело №1622):
// живой прогон OpenCode кандидата 7.22.0 не донёс до api ни busy, ни interrupted хода,
// прерванного вскоре после такта. Проба повторяет расписание на фейковом диспетчере:
// конец хода уходит следующим тактом после такта, донёсшего idle (ускоренный такт: реальных
// 30-секундных таймеров и живого диспетчера проба не заменяет).
import assert from "node:assert/strict";
import { test } from "node:test";

import { channelOf, muxCarrying, sleep, textOf, TICK_MS, waitFor, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const iso = () => new Date().toISOString();

test("a turn interrupted soon after a tact: busy and then interrupted reach the dispatcher within two gaps", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const s = await session();
    const r = await s.stand({ realm: REALM, karta: 931, name: "pulse-esc" });
    assert.ok(r.result && !r.result.isError, textOf(r));
    const chan = channelOf(fake, "pulse-esc");
    await muxCarrying(fake, mux, [chan]);
    await s.rpc("iskron/pulse", { state: "idle", turn_at: iso() });
    await waitFor("the idle pulse", () => mux.pulses.get(chan)?.state === "idle", TICK_MS * 4);
    // The live run: the next turn 9 s after the tact that carried idle, Esc 10 s later (gap 30 s).
    // The next tact carries the last word: interrupted, busy folded into it.
    const t0 = Date.now();
    await sleep(TICK_MS * 0.3);
    await s.rpc("iskron/pulse", { state: "busy" });
    await sleep(TICK_MS * 0.33);
    await s.rpc("iskron/pulse", { state: "interrupted", turn_at: iso() });
    await waitFor(
      "the interrupted pulse",
      () => mux.pulses.get(chan)?.state === "interrupted",
      TICK_MS * 2 + 200,
    );
    const gaps = (Date.now() - t0) / TICK_MS;
    assert.ok(
      gaps <= 1.5,
      `interrupted came ${gaps} gaps after the idle tact, not with the next one`,
    );
  });
});
