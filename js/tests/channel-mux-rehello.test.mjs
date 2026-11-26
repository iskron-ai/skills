// Строка занятости и обрыв соединения диспетчера (граф @nks/nks-dev, #8620 (з), #11337): строка,
// данная, пока подписка оборвана, ждёт hello новой подписки своего канала и уходит кадром status
// после него, последняя на место. Кадр между subscribe и hello отдал бы её серверу, который такую
// строку не кладёт, и на доске осталась бы прежняя занятость (полное ревью кандидата 7.22.0, дело
// №1622). Числа расхода по-прежнему идут тактом и ждут hello так же.
import assert from "node:assert/strict";
import { test } from "node:test";

import { busyOf, channelOf, muxCarrying, sleep, textOf, waitFor, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
/** Такт длиннее хода пробы от строки до обрыва, hello новой подписки — позже такта. */
const GAP_MS = 1500;
const HELLO_LAG_MS = 2500;
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);
/** Фейк отвечает на кадр status с ref, как следующий api: молчание 3 с сдвинуло бы такт пробы. */
const answering = (mux) => Object.assign(mux, { statusAck: true, statusEchoRef: true });

test("a busy line given while the connection is broken goes after the new subscription's hello: the board shows it, no frame before hello", async () => {
  await withMux(
    async ({ fake, mux, session, journal }) => {
      answering(mux);
      const a = await session();
      ok(await a.stand({ realm: REALM, karta: 931, name: "rh-a", status: "занят 1" }), "A");
      const chan = channelOf(fake, "rh-a");
      const first = await muxCarrying(fake, mux, [chan]);
      await waitFor("the first line", () => busyOf(fake, "rh-a") === "занят 1");
      mux.helloLagMs = HELLO_LAG_MS;
      mux.drop();
      await waitFor("a new connection", () => mux.live().some((c) => c !== first), 20_000);
      const r = await a.stand({ realm: REALM, karta: 931, name: "rh-a", status: "занят 2" });
      ok(r, "the line");
      assert.match(textOf(r), /ждёт подписки|waits for the dispatcher subscription/);
      assert.equal(busyOf(fake, "rh-a"), "занят 1", "the line waits for hello");
      await waitFor("the fresh line after hello", () => busyOf(fake, "rh-a") === "занят 2").catch(
        (e) => {
          throw new Error(`${e.message}: refused ${JSON.stringify(mux.refusedRows)}\n${journal()}`);
        },
      );
      assert.deepEqual(mux.refusedRows, [], "no line went before its subscription's hello");
      assert.equal(fake.state.counts.status_requests, 0, "no POST");
    },
    { daemonEnv: { ISKRON_PULSE_GAP_MS: String(GAP_MS) } },
  );
});

// Откат после обрыва (#8620 (6)): переподключение получает 404 — держанное к hello уходит, как
// у держанного до первого hello: занятость POST'ом старого адреса, расход — register'ом, один
// раз и последними числами, без новой перемены (дело №1622).
test("numbers waiting for the tact when the connection breaks, then 404: one register with the last numbers, no new change; the busy line given meanwhile by POST", async () => {
  await withMux(
    async ({ fake, mux, session, journal }) => {
      answering(mux);
      const a = await session();
      ok(await a.stand({ realm: REALM, karta: 931, name: "rh-u", status: "занят 1" }), "A");
      const chan = channelOf(fake, "rh-u");
      await muxCarrying(fake, mux, [chan]);
      await waitFor("the first line", () => busyOf(fake, "rh-u") === "занят 1");
      const used = await a.rpc("iskron/usage", { tokens: 7777, model: "m1" });
      assert.equal(used.result?.pushed, true, JSON.stringify(used));
      mux.mode = "old";
      const tries = mux.attempts.length;
      mux.drop();
      assert.equal(mux.usage.size, 0, "the numbers still waited for the tact at the break");
      await waitFor("the bridge tries again", () => mux.attempts.length > tries, 20_000);
      ok(await a.stand({ realm: REALM, karta: 931, name: "rh-u", status: "занят 2" }), "the line");
      const carrying = () =>
        fake.state.calls.filter(
          (c) =>
            c.name === "iskron_channel" &&
            c.arguments?.action === "register" &&
            c.arguments?.attrs?.usage?.tokens === 7777,
        );
      await waitFor("the numbers by register", () => carrying().length > 0, 20_000).catch((e) => {
        throw new Error(`${e.message}\n${journal()}`);
      });
      await waitFor("the busy line by POST", () => busyOf(fake, "rh-u") === "занят 2");
      await sleep(GAP_MS);
      assert.equal(carrying().length, 1, "one register for the held numbers");
      assert.equal(fake.state.placeAttrs.get("931:rh-u")?.usage?.tokens, 7777);
      assert.ok(fake.state.counts.status_posts >= 1, "the busy line went by POST");
    },
    { daemonEnv: { ISKRON_PULSE_GAP_MS: String(GAP_MS), ISKRON_USAGE_GAP_MS: "1" } },
  );
});
