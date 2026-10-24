// Контрольный образец #8620 (граф @nks/nks-dev), половина моста — исходы места на
// соединении диспетчера: отзыв (channel_closed 4004), код, которого мост не просил,
// secret_dead как мёртвый токен, superseded чужим соединением и своим преемником.
// Ядро — channel-mux.test.mjs, занятость на уходе — channel-mux-busy.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  alive,
  channelOf,
  daemonPids,
  muxCarrying,
  rawClient,
  secretOf,
  sleep,
  textOf,
  told,
  waitFor,
  withMux,
} from "./mux-kit.mjs";

const REALM = "nks-dev";
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);

test("revoked under a subscription — channel_closed 4004: A told it is stopped, never resubscribed, B lives; the secret is dead", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "rev-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "rev-b" }), "B stands");
    const [ca, cb] = [channelOf(fake, "rev-a"), channelOf(fake, "rev-b")];
    const conn = await muxCarrying(fake, mux, [ca, cb]);
    mux.endSub(ca, 4004, "revoked:person");
    await waitFor("A told it is stopped", () => told(a, "stopped").length);
    assert.match(JSON.stringify(told(a, "stopped")), /revoked:person/, "the stop names who");
    await sleep(6000); // дольше первой ступени отступа: снятое место не переподписывается
    const sa = secretOf(fake, ca);
    assert.equal(mux.sent("subscribe").filter((s) => s.secret === sa).length, 1, "never again");
    assert.equal(mux.sent("unsubscribe").length, 0, "the bridge unsubscribed nothing itself");
    assert.ok(!conn.closed && conn.subs.has(cb), "B's subscription lives on the same connection");
    assert.equal(told(b, "stopped").length, 0, "B is told nothing");
    mux.say("rev-b", "B после снятия A");
    await waitFor("B to hear", () => b.heard("B после снятия A"));
    const other = await rawClient(`${fake.base.replace(/^http:/, "ws:")}/api/channel/mux`);
    try {
      other.send({ type: "subscribe", secret: sa, ref: "again" });
      const err = await other.next((f) => f.type === "error" && f.ref === "again");
      assert.equal(err.code, "secret_dead", "a subscription of the revoked channel again");
    } finally {
      other.close();
    }
  });
});

test("channel_closed 4001 on a subscription — not a code of it: no stop, subscribed again", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const a = await session();
    ok(await a.stand({ realm: REALM, karta: 931, name: "odd-a" }), "A stands");
    const ca = channelOf(fake, "odd-a");
    const conn = await muxCarrying(fake, mux, [ca]);
    mux.endSub(ca, 4001, "idle");
    await waitFor("A subscribed again", () => conn.subs.has(ca), 15_000);
    assert.equal(told(a, "stopped").length, 0, "4001 on a subscription is no stop");
    mux.say("odd-a", "A после странного кода");
    await waitFor("A to hear", () => a.heard("A после странного кода"));
  });
});

test("two unasked channel_closed 1000 in a row (no hello between): a journal line, one resubscribe, then the end as a dead token; B lives", async () => {
  await withMux(async ({ fake, mux, session, journal }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "one-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "one-b" }), "B stands");
    const [ca, cb] = [channelOf(fake, "one-a"), channelOf(fake, "one-b")];
    const conn = await muxCarrying(fake, mux, [ca, cb]);
    const sa = secretOf(fake, ca);
    const asked = () => mux.sent("subscribe").filter((s) => s.secret === sa).length;
    mux.closeNext.set(sa, 1); // ответ на переподписку — снова 1000, hello не будет
    mux.endSub(ca, 1000, "unsubscribed");
    await waitFor("A told as of a dead token", () => told(a, "dead").length, 15_000);
    await sleep(6000); // дольше первой ступени отступа: цикла переподписок нет
    assert.equal(asked(), 2, "one resubscribe, not a loop");
    assert.ok(!conn.closed && conn.subs.has(cb), "B's subscription lives");
    mux.say("one-b", "B после конца A");
    await waitFor("B to hear", () => b.heard("B после конца A"));
    assert.match(
      journal(),
      /closed with 1000 \(unsubscribed\) — a server defect/,
      "a journal line",
    );
  });
});

test("an unasked 1000, a hello, later another unasked 1000: not in a row — subscribed again, no end", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const a = await session();
    ok(await a.stand({ realm: REALM, karta: 931, name: "two-a" }), "A stands");
    const ca = channelOf(fake, "two-a");
    const conn = await muxCarrying(fake, mux, [ca]);
    const sa = secretOf(fake, ca);
    const asked = () => mux.sent("subscribe").filter((s) => s.secret === sa).length;
    mux.endSub(ca, 1000, "unsubscribed");
    await waitFor(
      "the first resubscribe's hello",
      () => asked() === 2 && conn.subs.has(ca),
      15_000,
    );
    await sleep(500);
    mux.endSub(ca, 1000, "unsubscribed");
    await waitFor("the second resubscribe", () => asked() === 3 && conn.subs.has(ca), 15_000);
    assert.equal(told(a, "dead").length, 0, "a hello between: not the end");
    mux.say("two-a", "A после двух 1000 с hello между");
    await waitFor("A to hear", () => a.heard("A после двух 1000 с hello между"));
  });
});

test("busy on the subscribe — error{ref, busy}: that subscription again after a pause, the connection lives", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const a = await session();
    ok(await a.stand({ realm: REALM, karta: 931, name: "busy-a" }), "A stands");
    const ca = channelOf(fake, "busy-a");
    const conn = await muxCarrying(fake, mux, [ca]);
    const sa = secretOf(fake, ca);
    let busy = 1;
    mux.refuseWhen = (s) => (s === sa && busy-- > 0 ? "busy" : null);
    mux.endSub(ca, 4002, "expired"); // переподписка встречает busy
    await waitFor("subscribed again past busy", () => conn.subs.has(ca), 20_000);
    assert.equal(mux.conns.length, 1, "the connection lives");
    assert.equal(fake.state.counts.ws_upgrades, 0, "no socket per seat");
    assert.equal(told(a, "stopped").length + told(a, "dead").length, 0, "no end of the seat");
  });
});

test("channel_closed 4004 revoked:gone — the seat is taken off; 4002 expired — subscribed again", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "gone-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "exp-b" }), "B stands");
    const [ca, cb] = [channelOf(fake, "gone-a"), channelOf(fake, "exp-b")];
    const conn = await muxCarrying(fake, mux, [ca, cb]);
    mux.endSub(cb, 4002, "expired");
    await waitFor("B subscribed again", () => conn.subs.has(cb), 15_000);
    assert.equal(told(b, "stopped").length + told(b, "dead").length, 0, "expired is no end");
    mux.endSub(ca, 4004, "revoked:gone");
    await waitFor("A told it is stopped", () => told(a, "stopped").length);
    mux.say("exp-b", "B после 4002");
    await waitFor("B to hear", () => b.heard("B после 4002"));
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
