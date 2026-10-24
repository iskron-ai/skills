// Строки такта и обрыв соединения диспетчера (граф @nks/nks-dev, #8620 (з), #8623): строка,
// поставленная при живой подписке и не ушедшая до обрыва, ждёт hello новой подписки своего
// канала и уходит тактом после него, последняя на место. Такт между subscribe и hello отдал бы
// её серверу, который такую строку отвергает, и на доске осталась бы прежняя занятость
// (полное ревью кандидата 7.22.0, дело №1622).
import assert from "node:assert/strict";
import { test } from "node:test";

import { busyOf, channelOf, muxCarrying, textOf, waitFor, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
/** Такт длиннее хода пробы от строки до обрыва, hello новой подписки — позже такта. */
const GAP_MS = 1500;
const HELLO_LAG_MS = 2500;
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);

test("a busy line waiting for the tact when the connection breaks goes after the new subscription's hello: the board shows it, no row refused", async () => {
  await withMux(
    async ({ fake, mux, session, journal }) => {
      const a = await session();
      ok(await a.stand({ realm: REALM, karta: 931, name: "rh-a", status: "занят 1" }), "A");
      const chan = channelOf(fake, "rh-a");
      const first = await muxCarrying(fake, mux, [chan]);
      await waitFor("the first line by tick", () => busyOf(fake, "rh-a") === "занят 1");
      ok(await a.stand({ realm: REALM, karta: 931, name: "rh-a", status: "занят 2" }), "the line");
      mux.helloLagMs = HELLO_LAG_MS;
      mux.drop();
      assert.equal(
        busyOf(fake, "rh-a"),
        "занят 1",
        "the line still waited for the tact at the break",
      );
      await waitFor(
        "subscribed again on a new connection",
        () => mux.live().some((c) => c !== first && c.subs.has(chan)),
        20_000,
      );
      await waitFor("the fresh line after hello", () => busyOf(fake, "rh-a") === "занят 2").catch(
        (e) => {
          throw new Error(`${e.message}: refused ${JSON.stringify(mux.refusedRows)}\n${journal()}`);
        },
      );
      assert.deepEqual(mux.refusedRows, [], "no row went before its subscription's hello");
    },
    { daemonEnv: { ISKRON_PULSE_GAP_MS: String(GAP_MS) } },
  );
});
