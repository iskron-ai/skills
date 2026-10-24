// Контрольный образец общего соединения каналов, половина моста (граф @nks/nks-dev:
// договор #8620; разводка кадров #8622, пачечный такт #8623): демон держит одно
// соединение диспетчера GET …/channel/mux на все сессии, кадры разводит по каналу,
// квитирует ack{channel_id, sub, seq}, дедупит по id, такт шлёт одной пачкой tick.
// Проба пишется до кода: на мосте без диспетчера каждая краснеет причиной «нет
// диспетчера»; самопроверка фейка зелёная всегда — фейк отвечает по договору сам.
import assert from "node:assert/strict";
import { test } from "node:test";

import { attachMux } from "./fake-mux.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import {
  alive,
  channelOf,
  daemonPids,
  muxCarrying,
  rawClient,
  seatIdOf,
  sleep,
  textOf,
  TICK_MS,
  waitFor,
  withMux,
} from "./mux-kit.mjs";

const REALM = "nks-dev";
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);

test("fake self-check: the dispatcher answers by the contract on its own", async () => {
  const fake = await startFakeNks({ pat: "self" });
  const mux = attachMux(fake);
  const st = fake.state;
  const seat = (chan, secret, name) => {
    const pl = { karta: "931", name, standing_id: `id-${name}` };
    st.channels.set(chan, { primary: "@nks/nks-dev", places: new Map([["@nks/nks-dev", pl]]) });
    st.wsChannel.set(secret, chan);
  };
  seat("ch-a", "sec-a", "self-a");
  seat("ch-b", "sec-b", "self-b");
  const url = `${fake.base.replace(/^http:/, "ws:")}/api/channel/mux`;
  const c = await rawClient(url);
  try {
    c.send({ type: "subscribe", secret: "sec-a", ref: "r-a" });
    c.send({ type: "subscribe", secret: "sec-b", ref: "r-b" });
    const ha = await c.next((f) => f.type === "hello" && f.ref === "r-a");
    await c.next((f) => f.type === "hello" && f.ref === "r-b");
    assert.equal(ha.channel_id, "ch-a");
    assert.match(ha.sub, /^[0-9a-f-]{36}$/);
    for (const k of ["standings", "pending", "ttl_seconds", "ping_interval_seconds", "credit"])
      assert.ok(k in ha, `hello carries ${k}`);
    assert.equal(ha.standings[0].standing_id, "id-self-a");
    // Неверный секрет — отказ по ref, соседние подписки живут.
    c.send({ type: "subscribe", secret: "nope", ref: "r-x" });
    const err = await c.next((f) => f.type === "error");
    assert.deepEqual([err.ref, err.code], ["r-x", "secret_invalid"]);
    mux.say("self-b", "to b", "m-b1");
    const mb = await c.next((f) => f.type === "message" && f.id === "m-b1");
    assert.deepEqual([mb.channel_id, mb.seq], ["ch-b", 1]);
    // Кадр месту A: sub и seq подписки; ack старым sub игнорируется.
    mux.say("self-a", "to a", "m-a1");
    const ma = await c.next((f) => f.type === "message" && f.id === "m-a1");
    assert.deepEqual([ma.channel_id, ma.sub, ma.seq], ["ch-a", ha.sub, 1]);
    c.send({ type: "ack", channel_id: "ch-a", sub: "stale-sub", seq: 1 });
    await waitFor("the stale ack seen", () => mux.ignoredAcks.length === 1, 2000);
    assert.equal(mux.queues.get("ch-a").length, 1, "a stale ack confirms nothing");
    // Переподписка: неподтверждённое приходит заново, с тем же id, в новой подписке.
    c.send({ type: "subscribe", secret: "sec-a", ref: "r-a2" });
    const h2 = await c.next((f) => f.type === "hello" && f.ref === "r-a2");
    const again = await c.next((f) => f.type === "message" && f.id === "m-a1" && f.sub === h2.sub);
    assert.equal(again.seq, 1);
    c.send({ type: "ack", channel_id: "ch-a", sub: h2.sub, seq: 1 });
    await waitFor("the ack applied", () => mux.queues.get("ch-a").length === 0, 2000);
    // Пачка такта кладёт занятость места на доску без адреса статуса.
    c.send({
      type: "tick",
      entries: [{ channel_id: "ch-a", standing_id: "id-self-a", status: "s" }],
    });
    await waitFor("the tick", () => st.placeStatus.get("id-self-a") === "s", 2000);
    assert.equal(st.counts.status_requests, 0);
    // Канал с двумя местами: строка без standing_id — отказ standing_required, прочие идут.
    const two = { karta: "931", name: "self-a2", standing_id: "id-self-a2" };
    st.channels.get("ch-a").places.set("@nks/other", two);
    c.send({
      type: "tick",
      entries: [
        { channel_id: "ch-a", status: "без места" },
        { channel_id: "ch-a", standing_id: "id-self-a2", status: "z" },
      ],
    });
    const refused = await c.next((f) => f.type === "error" && f.code === "standing_required");
    assert.equal(refused.channel_id, "ch-a");
    await waitFor("the row with its seat", () => st.placeStatus.get("id-self-a2") === "z", 2000);
    assert.equal(st.placeStatus.get("id-self-a"), "s", "the row without a seat landed nowhere");
    st.channels.get("ch-a").places.delete("@nks/other");
    c.send({ type: "unsubscribe", channel_id: "ch-a" });
    const closed = await c.next((f) => f.type === "channel_closed");
    assert.deepEqual(
      [closed.channel_id, closed.code, closed.reason],
      ["ch-a", 1000, "unsubscribed"],
    );
    assert.equal(mux.live().length, 1, "one connection all along");
    // Сервер без диспетчера: апгрейд — 404.
    mux.mode = "old";
    await assert.rejects(rawClient(url));
    assert.equal(mux.attempts.at(-1).answered, 404);
  } finally {
    c.close();
    mux.stop();
    await fake.stop();
  }
});

test("two sessions of one graph on one daemon: one dispatcher connection, B's frame never reaches A", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "mux-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "mux-b" }), "B stands");
    const [ca, cb] = [channelOf(fake, "mux-a"), channelOf(fake, "mux-b")];
    await muxCarrying(fake, mux, [ca, cb]);
    assert.equal(mux.conns.length, 1, "exactly one dispatcher connection for both sessions");
    assert.equal(fake.state.counts.ws_upgrades, 0, "no socket per seat beside it");
    mux.say("mux-b", "слово для B");
    await waitFor("B to hear its frame", () => b.heard("слово для B"));
    mux.say("mux-a", "слово для A");
    await waitFor("A to hear its frame", () => a.heard("слово для A"));
    await sleep(300);
    assert.equal(a.heard("слово для B"), 0, "B's frame does not reach A");
    assert.equal(b.heard("слово для A"), 0, "A's frame does not reach B");
  });
});

test("N sessions: one tick frame per interval whatever N, busy lines in it, no POST to /channel/status", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const names = ["tick-a", "tick-b", "tick-c"];
    const ss = [];
    for (const name of names) {
      const s = await session();
      ok(await s.stand({ realm: REALM, karta: 931, name, status: `занят ${name}` }), name);
      ss.push(s);
    }
    await muxCarrying(
      fake,
      mux,
      names.map((n) => channelOf(fake, n)),
    );
    await Promise.all(ss.map((s) => s.rpc("iskron/pulse", { state: "busy" })));
    await sleep(TICK_MS * 6);
    const ticks = mux.sent("tick");
    assert.ok(ticks.length >= 1, "the daemon sends its tick");
    const at = mux.ticks.map((t) => t.at);
    for (let i = 1; i < at.length; i++)
      assert.ok(
        at[i] - at[i - 1] >= TICK_MS / 2,
        `one tick per interval, not one per session: ${at}`,
      );
    for (const name of names) {
      const id = seatIdOf(fake, name);
      assert.equal(fake.state.placeStatus.get(id), `занят ${name}`, `${name}'s busy line by tick`);
    }
    assert.equal(fake.state.counts.status_requests, 0, "no POST to /channel/status");
    // Пульс — головы, по каналу (#8620 v19): его запись места не называет.
    const pulses = mux.ticks.flatMap((t) => t.entries).filter((e) => e.pulse);
    assert.ok(pulses.length, "the pulse goes in the tact");
    for (const e of pulses)
      assert.ok(!("standing_id" in e), `the pulse's record names no seat: ${JSON.stringify(e)}`);
    for (const name of names) assert.ok(mux.pulses.has(channelOf(fake, name)), `${name}'s pulse`);
  });
});

test("the bridge acks {channel_id, sub, seq} and a frame sent again after resubscribing reaches the session once", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const a = await session();
    ok(await a.stand({ realm: REALM, karta: 931, name: "ack-a" }), "A stands");
    const chan = channelOf(fake, "ack-a");
    const conn = await muxCarrying(fake, mux, [chan]);
    const sub = conn.subs.get(chan).sub;
    mux.say("ack-a", "первое", "m-1");
    await waitFor("the ack of seq 1", () =>
      mux.sent("ack").find((k) => k.channel_id === chan && k.sub === sub && k.seq === 1),
    );
    // Квитанция теряется: кадр доставлен, но сервер не метит его доставленным.
    mux.holdAcks = true;
    mux.say("ack-a", "второе", "m-2");
    await waitFor("A to hear the second", () => a.heard("второе"));
    await sleep(200);
    const once = a.heard("второе");
    mux.holdAcks = false;
    mux.drop();
    const again = await muxCarrying(fake, mux, [chan]);
    const sub2 = again.subs.get(chan).sub;
    assert.notEqual(sub2, sub, "a new subscription after the break");
    await waitFor("the ack of the frame sent again, in the new subscription", () =>
      mux.sent("ack").find((k) => k.sub === sub2 && k.seq === 1),
    );
    await sleep(300);
    assert.equal(a.heard("второе"), once, "the frame sent again is deduplicated by its id");
  });
});

test("a wrong secret: error on that subscription only, the neighbour lives", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "sec-a" }), "A stands");
    const ca = channelOf(fake, "sec-a");
    const conn = await muxCarrying(fake, mux, [ca]);
    // Секрет места B платформа больше не знает: подписка B — отказ по её ref.
    const before = new Set(fake.state.wsChannel.keys());
    mux.refuseWhen = (s) => (before.has(s) ? null : "secret_invalid");
    await b.stand({ realm: REALM, karta: 931, name: "sec-b" }); // что скажет B — договор не называет
    await waitFor("B's subscription refused", () =>
      mux.sent("subscribe").find((s) => !before.has(s.secret)),
    );
    await sleep(300);
    assert.ok(!conn.closed && conn.subs.has(ca), "A's subscription lives on the same connection");
    assert.equal(mux.sent("unsubscribe").length, 0, "nothing unsubscribed");
    mux.say("sec-a", "A после отказа B");
    await waitFor("A to hear after B's refusal", () => a.heard("A после отказа B"));
  });
});

test("404 on /channel/mux: back to a socket per seat until the daemon restarts, no further dispatcher tries", async () => {
  await withMux(
    async ({ fake, mux, session }) => {
      const [a, b] = [await session(), await session()];
      ok(await a.stand({ realm: REALM, karta: 931, name: "old-a" }), "A stands");
      ok(await b.stand({ realm: REALM, karta: 931, name: "old-b" }), "B stands");
      await waitFor("both seats' sockets", () => fake.state.wsNames.size === 2);
      const c = await session();
      ok(await c.stand({ realm: REALM, karta: 931, name: "old-c" }), "C stands");
      await waitFor("C's socket", () => fake.state.wsNames.size === 3);
      await sleep(TICK_MS * 3);
      assert.equal(
        mux.attempts.length,
        1,
        `the daemon asks the dispatcher once, learns 404 and stays on sockets: ${mux.attempts.length} tries — no dispatcher in the bridge`,
      );
    },
    { mode: "old" },
  );
});

test("session A leaves: only its channel is unsubscribed, B hears on the same connection", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "away-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "away-b" }), "B stands");
    const [ca, cb] = [channelOf(fake, "away-a"), channelOf(fake, "away-b")];
    const conn = await muxCarrying(fake, mux, [ca, cb]);
    a.bye();
    await waitFor("A's unsubscribe", () => mux.sent("unsubscribe").length);
    await sleep(300);
    assert.deepEqual(
      mux.sent("unsubscribe").map((u) => u.channel_id),
      [ca],
      "only A's channel",
    );
    assert.ok(!conn.closed && conn.subs.has(cb), "B's subscription stays on the connection");
    assert.equal(mux.conns.length, 1, "no new connection");
    mux.say("away-b", "B после ухода A");
    await waitFor("B to hear", () => b.heard("B после ухода A"));
  });
});

test("a break: one reconnection, every subscription again", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const [a, b] = [await session(), await session()];
    ok(await a.stand({ realm: REALM, karta: 931, name: "brk-a" }), "A stands");
    ok(await b.stand({ realm: REALM, karta: 931, name: "brk-b" }), "B stands");
    const chans = [channelOf(fake, "brk-a"), channelOf(fake, "brk-b")];
    const first = await muxCarrying(fake, mux, chans);
    mux.drop();
    const next = await muxCarrying(fake, mux, chans);
    assert.notEqual(next, first);
    await sleep(TICK_MS * 3);
    assert.equal(mux.conns.length, 2, "exactly one reconnection");
    mux.say("brk-a", "A после обрыва");
    mux.say("brk-b", "B после обрыва");
    await waitFor("A to hear", () => a.heard("A после обрыва"));
    await waitFor("B to hear", () => b.heard("B после обрыва"));
  });
});

test("the daemon hands over: the own old socket gets 4000 from the successor's subscription — not a taken seat", async () => {
  await withMux(
    async ({ fake, mux, dir, thin }) => {
      // Демон старой жизни держит место сокетом (диспетчера нет); преемник находит его.
      const a = await thin();
      ok(await a.stand({ realm: REALM, karta: 931, name: "hand-a" }), "A stands");
      const chan = channelOf(fake, "hand-a");
      await waitFor("the seat's socket", () => fake.state.wsNames.size === 1);
      mux.mode = "mux";
      const [first] = await waitFor("the daemon", () => daemonPids(dir)[0] && daemonPids(dir));
      process.kill(first, "SIGTERM");
      await waitFor("the old daemon gone", () => !alive(first), 30_000);
      const w = await a.rpc("tools/call", {
        name: "iskron_add_phenomenon",
        arguments: { realm: REALM, name: "после смены" },
      });
      ok(w, "a write after the change");
      await muxCarrying(fake, mux, [chan], 10_000);
      await waitFor("the old socket closed 4000 by the subscription", () =>
        mux.oldClosed.includes(chan),
      );
      await sleep(500);
      assert.doesNotMatch(a.stderr, /was taken|отнят/, "4000 in the handover is expected");
      assert.ok(
        !a.all.some((m) => /was taken|отнят/.test(JSON.stringify(m))),
        "the harness hears no taken seat",
      );
      assert.equal(fake.state.counts.unattributed, 0, "writes stay signed");
      assert.ok(!fake.state.places.has("931:hand-a.2"), "no seat beside");
    },
    { mode: "old", own: false },
  );
});
