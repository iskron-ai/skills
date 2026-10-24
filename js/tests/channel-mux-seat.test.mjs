// Контрольный образец #8620 (граф @nks/nks-dev), половина моста — исходы места на
// соединении диспетчера: последняя строка занятости до отписки, secret_dead как мёртвый
// токен, superseded чужим соединением и своим преемником. Ядро — channel-mux.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alive,
  channelOf,
  daemonPids,
  muxCarrying,
  rawClient,
  seatIdOf,
  sleep,
  textOf,
  waitFor,
  withMux,
} from "./mux-kit.mjs";

const REALM = "nks-dev";
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);
const secretOf = (fake, chan) => [...fake.state.wsChannel].find(([, c]) => c === chan)?.[0];
/** Событие канала этого рода, дошедшее до сессии (уведомление моста). */
const told = (s, kind) => s.frames.filter((f) => JSON.stringify(f).includes(`"kind":"${kind}"`));

test("session A leaves: its last busy line goes in a tick before its unsubscribe, no POST", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "last-a", status: "занят A" }), "A");
    ok(await b.stand({ realm: REALM, karta: 931, name: "last-b", status: "занят B" }), "B");
    const [ca, cb] = [channelOf(fake, "last-a"), channelOf(fake, "last-b")];
    const conn = await muxCarrying(fake, mux, [ca, cb]);
    const ida = seatIdOf(fake, "last-a");
    await waitFor("A's busy line by tick", () => fake.state.placeStatus.get(ida) === "занят A");
    a.bye();
    await waitFor("A's unsubscribe", () => mux.sent("unsubscribe").length);
    await sleep(500);
    const frames = conn.frames.map((f) => f.frame);
    const unsub = frames.findIndex((f) => f.type === "unsubscribe" && f.channel_id === ca);
    const last = frames.findIndex(
      (f) =>
        f.type === "tick" &&
        f.entries.some((e) => e.channel_id === ca && e.standing_id === ida && e.status === ""),
    );
    assert.ok(last >= 0, "A's busy line is cleared by a tick on the dispatcher connection");
    assert.ok(
      last < unsub,
      `the last line before the unsubscribe: tick ${last}, unsubscribe ${unsub}`,
    );
    assert.equal(fake.state.counts.status_requests, 0, "no POST to /channel/status");
    assert.equal(fake.state.placeStatus.get(seatIdOf(fake, "last-b")), "занят B", "B's line stays");
  });
});

test("secret_dead on resubscribing: A told as of a dead token, released, B lives", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "dead-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "dead-b" }), "B stands");
    const [ca, cb] = [channelOf(fake, "dead-a"), channelOf(fake, "dead-b")];
    await muxCarrying(fake, mux, [ca, cb]);
    const sa = secretOf(fake, ca);
    mux.refuse.set(sa, "secret_dead");
    mux.drop();
    await waitFor("B again", () => mux.live().find((c) => c.subs.has(cb)), 15_000);
    await waitFor("A told its token is dead", () => told(a, "dead").length);
    assert.equal(told(b, "dead").length, 0, "B is told nothing");
    await sleep(6000); // дольше первой ступени отступа: отпущенное место не переподписывается
    assert.equal(
      mux.sent("subscribe").filter((s) => s.secret === sa).length,
      2,
      "A asked once more, then let go",
    );
    assert.equal(fake.state.counts.ws_upgrades, 0, "no socket per seat for A");
    assert.equal(mux.conns.length, 2, "one reconnection");
    mux.say("dead-b", "B после отказа A");
    await waitFor("B to hear", () => b.heard("B после отказа A"));
  });
});

test("superseded by another connection: A told its seat is taken and not resubscribed, B lives on the same connection", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "sup-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "sup-b" }), "B stands");
    const [ca, cb] = [channelOf(fake, "sup-a"), channelOf(fake, "sup-b")];
    const conn = await muxCarrying(fake, mux, [ca, cb]);
    const sa = secretOf(fake, ca);
    const other = await rawClient(`${fake.base.replace(/^http:/, "ws:")}/api/channel/mux`);
    try {
      other.send({ type: "subscribe", secret: sa, ref: "theirs" });
      await other.next((f) => f.type === "hello" && f.ref === "theirs");
      await waitFor("A told its seat is taken", () => told(a, "evicted").length);
      await sleep(6000); // дольше первой ступени отступа: войны подписок нет
      assert.equal(
        mux.sent("subscribe").filter((s) => s.secret === sa && s.conn === conn.id).length,
        1,
      );
      assert.ok(!conn.closed && conn.subs.has(cb), "B's subscription lives on the same connection");
      assert.equal(told(b, "evicted").length, 0, "B is told nothing");
      mux.say("sup-b", "B после вытеснения A");
      await waitFor("B to hear", () => b.heard("B после вытеснения A"));
    } finally {
      other.close();
    }
  });
});

test("the daemon hands over on the dispatcher: superseded by its own successor — not a taken seat", async () => {
  await withMux(
    async ({ fake, mux, dir, thin, journal }) => {
      const a = await thin();
      ok(await a.stand({ realm: REALM, karta: 931, name: "succ-a" }), "A stands");
      const chan = channelOf(fake, "succ-a");
      const first = await muxCarrying(fake, mux, [chan], 10_000);
      const [pid] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
      process.kill(pid, "SIGTERM");
      await waitFor("the old daemon gone", () => !alive(pid), 30_000);
      const w = await a.rpc("tools/call", {
        name: "iskron_add_phenomenon",
        arguments: { realm: REALM, name: "после смены" },
      });
      ok(w, "a write after the change");
      await waitFor(
        "the successor's subscription",
        () => mux.live().find((c) => c !== first && c.subs.has(chan)),
        10_000,
      );
      assert.deepEqual(
        mux.superseded.filter((x) => x.channel_id === chan).map((x) => x.from),
        [first.id],
        "the leaving daemon's subscription superseded by the successor's",
      );
      // Свой преемник различён локально: передача кончилась вытеснением, не пределом ожидания.
      assert.match(journal(), /handed over: the successor took the socket \(close 4000\)/);
      assert.doesNotMatch(journal(), /no successor took the socket/);
      await sleep(500);
      assert.doesNotMatch(a.stderr, /was taken|отнят/, "superseded in the handover is expected");
      assert.ok(
        !a.all.some((m) => /was taken|отнят/.test(JSON.stringify(m))),
        "the harness hears no taken seat",
      );
      assert.equal(fake.state.counts.unattributed, 0, "writes stay signed");
      assert.ok(!fake.state.places.has("931:succ-a.2"), "no seat beside");
      assert.equal(fake.state.counts.ws_upgrades, 0, "no socket per seat");
    },
    { own: false },
  );
});
