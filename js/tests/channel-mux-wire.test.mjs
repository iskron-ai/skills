// Контрольный образец #8620 (граф @nks/nks-dev), половина моста — провод соединения
// диспетчера: кадр без channel_id, 5xx на адресе диспетчера, кредит подписки, закрытие
// 4001 idle. Ядро образца — channel-mux.test.mjs; места и их исходы — channel-mux-seat.
import assert from "node:assert/strict";
import { test } from "node:test";

import { busyOf, channelOf, muxCarrying, sleep, textOf, waitFor, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);

test("a frame without channel_id: a line in the journal, the connection lives", async () => {
  await withMux(async ({ fake, mux, session, journal }) => {
    const a = await session();
    ok(await a.stand({ realm: REALM, karta: 931, name: "bare-a" }), "A stands");
    const ca = channelOf(fake, "bare-a");
    const conn = await muxCarrying(fake, mux, [ca]);
    mux.push({ type: "message", id: "bare-1", body: "кадр без канала", seq: 1 });
    await waitFor("the journal line of the frame without a channel", () =>
      /dispatcher: a message frame without a channel/.test(journal()),
    );
    assert.equal(a.heard("кадр без канала"), 0, "the frame reaches no session");
    assert.ok(!conn.closed && !conn.socket.destroyed, "the connection lives");
    assert.equal(mux.conns.length, 1, "no reconnection");
    mux.say("bare-a", "A после кадра без канала");
    await waitFor("A to hear after it", () => a.heard("A после кадра без канала"));
  });
});

test("5xx on /channel/mux: another try after a pause, never a socket per seat", async () => {
  await withMux(
    async ({ fake, mux, session }) => {
      const a = await session();
      await a.stand({ realm: REALM, karta: 931, name: "down-a" }); // слушания нет, пока диспетчер лежит
      const ca = channelOf(fake, "down-a");
      await waitFor("the dispatcher's 503", () => mux.attempts.length >= 1);
      mux.mode = "mux";
      await muxCarrying(fake, mux, [ca], 15_000);
      const [first, second] = mux.attempts;
      assert.deepEqual(
        mux.attempts.map((x) => x.answered),
        [503, 101],
      );
      assert.ok(
        second.at - first.at >= 3000,
        `a pause before the next try: ${second.at - first.at} ms`,
      );
      assert.equal(fake.state.counts.ws_upgrades, 0, "no fallback to a socket per seat");
      mux.say("down-a", "A после 503");
      await waitFor("A to hear", () => a.heard("A после 503"));
    },
    { mode: "down" },
  );
});

test("cut before any answer on /channel/mux: another try after a pause, never a socket per seat", async () => {
  await withMux(
    async ({ fake, mux, session }) => {
      const a = await session();
      await a.stand({ realm: REALM, karta: 931, name: "cut-a" }); // слушания нет, пока ответа нет
      const ca = channelOf(fake, "cut-a");
      await waitFor("the cut attempt", () => mux.attempts.length >= 1);
      await sleep(500);
      assert.equal(fake.state.counts.ws_upgrades, 0, "no fallback on an answer never seen");
      mux.mode = "mux";
      await muxCarrying(fake, mux, [ca], 15_000);
      assert.equal(fake.state.counts.ws_upgrades, 0, "no fallback to a socket per seat");
      mux.say("cut-a", "A после обрыва до ответа");
      await waitFor("A to hear", () => a.heard("A после обрыва до ответа"));
    },
    { mode: "cut" },
  );
});

test("a busy line given while the dispatcher is down waits, no POST; 404 later — it goes to the old address", async () => {
  await withMux(
    async ({ fake, mux, session }) => {
      const a = await session();
      await a.stand({ realm: REALM, karta: 931, name: "held-a", status: "занят Q" });
      await waitFor("the dispatcher's 503", () => mux.attempts.length >= 1);
      await sleep(500);
      assert.equal(fake.state.counts.status_requests, 0, "no POST while no fallback");
      mux.mode = "old";
      await waitFor("the fallback socket", () => fake.state.counts.ws_upgrades >= 1, 15_000);
      await waitFor("the held line by POST", () => busyOf(fake, "held-a") === "занят Q");
    },
    { mode: "down" },
  );
});

test("credit: the bridge acks every frame, the window refills; a stalled channel does not stall its neighbour", async () => {
  await withMux(
    async ({ fake, mux, session }) => {
      const [a, b] = [await session(), await session()];
      ok(await a.stand({ realm: REALM, karta: 931, name: "cred-a" }), "A stands");
      ok(await b.stand({ realm: REALM, karta: 931, name: "cred-b" }), "B stands");
      const [ca, cb] = [channelOf(fake, "cred-a"), channelOf(fake, "cred-b")];
      await muxCarrying(fake, mux, [ca, cb]);
      // Сервер придерживает квитанции A: кредит 2 исчерпан, прочее A ждёт.
      mux.stalled.set(ca, []);
      for (let i = 1; i <= 6; i++) mux.say("cred-a", `A-${i}`);
      await waitFor("A to hear its credit", () => a.heard("A-2"));
      mux.say("cred-b", "B при исчерпанном кредите A");
      await waitFor("B to hear past A's stall", () => b.heard("B при исчерпанном кредите A"));
      assert.equal(a.heard("A-3"), 0, "nothing past the credit while acks are held");
      mux.unstall(ca);
      await waitFor("A to hear all six", () => a.heard("A-6"));
      await sleep(300);
      for (let i = 1; i <= 6; i++) assert.equal(a.heard(`A-${i}`), 1, `A-${i} once`);
      const seqs = mux
        .sent("ack")
        .filter((k) => k.channel_id === ca)
        .map((k) => k.seq);
      assert.deepEqual(seqs.slice(-6), [1, 2, 3, 4, 5, 6], "every frame acked by its seq");
      assert.ok(mux.peak.get(ca) <= 2, `never more than the credit in flight: ${mux.peak.get(ca)}`);
    },
    { credit: 2 },
  );
});

test("4001 idle on the connection: one reconnection, every subscription again, no seat stopped", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "idle-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "idle-b" }), "B stands");
    const chans = [channelOf(fake, "idle-a"), channelOf(fake, "idle-b")];
    const first = await muxCarrying(fake, mux, chans);
    mux.close(4001, "idle");
    await waitFor("the reconnection", () => mux.conns.length === 2, 15_000);
    const next = await muxCarrying(fake, mux, chans, 10_000);
    assert.notEqual(next, first);
    assert.equal(mux.sent("unsubscribe").length, 0, "nothing unsubscribed");
    mux.say("idle-a", "A после 4001");
    mux.say("idle-b", "B после 4001");
    await waitFor("A to hear", () => a.heard("A после 4001"));
    await waitFor("B to hear", () => b.heard("B после 4001"));
    assert.equal(mux.conns.length, 2, "exactly one reconnection");
    // Без подписок мост сам закрывает соединение — раньше предела простоя сервера (30 с).
    a.bye();
    b.bye();
    await waitFor("the bridge to close its idle connection", () => !mux.live().length, 10_000);
    await sleep(1500);
    assert.equal(mux.conns.length, 2, "no anonymous connection opened again");
  });
});
