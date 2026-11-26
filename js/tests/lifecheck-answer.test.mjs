// The server's life check of a seat (graph @nks/nks-dev, nodes #11362, #11359): a control frame
// {type:"life_check", standing_id, ref} — on the seat's socket and on the dispatcher (with
// channel_id) — is never a turn: the bridge answers {type:"life", standing_id, ref, state} at once,
// the ref the server's string as is — present (the harness session holding the seat lives), gone
// (that session really ended: the end word, a run's or a satellite's end, the death window),
// unknown (a leave, an away, a supersede, or not a seat of this bridge). The bridge says it
// answers by "life" in its seat attrs.caps. On the former build the frame went to the session as
// any frame and nothing answered it; its dispatcher said gone on any end of a subscription.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { delay, journalOf, stood, waitFor, withFake } from "./lifeend-kit.mjs";
import { channelOf, muxCarrying, seatIdOf, sleep, textOf, withMux } from "./mux-kit.mjs";

const idOf = (fake, name) =>
  [...fake.state.channels.values()]
    .flatMap((c) => [...c.places.values()])
    .find((p) => p.name === name)?.standing_id;
const check = (standing_id, ref, extra = {}) => ({
  type: "life_check",
  standing_id,
  ref,
  ...extra,
});

test("on the seat's socket: present for its own seat, unknown for another, the ref as sent — no frame reaches the session; caps names life", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "life-s");
    const id = idOf(fake, "life-s");
    assert.ok(id, "the seat has an id");
    assert.ok(
      fake.state.placeAttrs.get("931:life-s")?.caps?.includes("life"),
      `attrs.caps names life: ${JSON.stringify(fake.state.placeAttrs.get("931:life-s"))}`,
    );
    const [r1, r2] = [randomUUID(), randomUUID()];
    const before = a.notifications.length;
    await fake.control({ ws_send: JSON.stringify(check(id, 7)) }); // not a string: the server's to reject
    await fake.control({ ws_send: JSON.stringify(check(id, r1)) });
    await fake.control({ ws_send: JSON.stringify(check("someone-else", r2)) });
    await waitFor("both answered", () => fake.state.lives.length >= 2).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    await delay(300);
    assert.equal(fake.state.lives.length, 2, "a number ref is not coerced into an answer");
    const [mine, other] = fake.state.lives.map((l) => l.frame);
    assert.deepEqual(mine, { type: "life", standing_id: id, ref: r1, state: "present" });
    assert.deepEqual(other, {
      type: "life",
      standing_id: "someone-else",
      ref: r2,
      state: "unknown",
    });
    const after = a.notifications.slice(before);
    assert.ok(
      !after.some((n) => JSON.stringify(n).includes("life_check")),
      `no notification carries the check: ${JSON.stringify(after)}`,
    );
  });
});

/** The dispatcher's answer to a check of `chan` (seat `id`), by a fresh ref. */
async function asked(mux, chan, id, journal) {
  const ref = randomUUID();
  mux.push(check(id, ref, { channel_id: chan }));
  await waitFor(`the answer to ${ref}`, () => mux.sent("life").some((l) => l.ref === ref)).catch(
    (e) => {
      throw new Error(`${e.message}\n${journal()}`);
    },
  );
  return mux.sent("life").find((l) => l.ref === ref);
}

const noCheckIn = (s) =>
  assert.deepEqual(
    s.frames.filter((f) => JSON.stringify(f).includes('"type":"life_check"')),
    [],
    "the check reached no session",
  );

test("on the dispatcher: present while the session holds the channel, gone once its session ended — never a turn", async () => {
  await withMux(async ({ fake, mux, session, journal }) => {
    const s = await session();
    const r = await s.stand({ realm: "nks-dev", karta: 931, name: "life-m" });
    assert.ok(r.result && !r.result.isError, textOf(r));
    const chan = channelOf(fake, "life-m");
    const id = seatIdOf(fake, "life-m");
    await muxCarrying(fake, mux, [chan]);
    const live = await asked(mux, chan, id, journal);
    assert.equal(live.state, "present");
    assert.equal(live.channel_id, chan);
    assert.equal(live.standing_id, id);
    const ended = await s.rpc("iskron/end", { event: "session_closed" });
    assert.equal(ended.result?.ended, true, JSON.stringify(ended));
    await sleep(300);
    assert.equal((await asked(mux, chan, id, journal)).state, "gone");
    noCheckIn(s);
  });
});

// nks-api #48 (4eb7c184): an end spares a seat another live channel carries — it leaves the
// event's channel, lives on there, and is not in ended[]. gone is only what ended[] names: the
// spared seat is unknown, its sibling on the same channel gone. On the former build the whole
// channel of an ended run said gone.
for (const endEvent of [true, 404])
  test(`on the dispatcher after an end (${endEvent === true ? "end event" : "the stop, no route"}): a seat the server spared is unknown, its ended sibling gone`, async () => {
    await withMux(async ({ fake, mux, session, journal }) => {
      fake.state.endEvent = endEvent;
      const s = await session();
      const r = await s.stand({ realm: "nks-dev", karta: 931, name: "life-k" });
      assert.ok(r.result && !r.result.isError, textOf(r));
      const rb = await s.stand({ realm: "drugoy", karta: 48, name: "life-k" });
      assert.ok(rb.result && !rb.result.isError, textOf(rb));
      const chan = channelOf(fake, "life-k");
      const seat = (karta) =>
        [...fake.state.channels.get(chan).places.values()].find((p) => p.karta === karta)
          ?.standing_id;
      const [main, beside] = [seat("931"), seat("48")];
      assert.ok(main && beside && main !== beside, "two seats on one channel");
      await muxCarrying(fake, mux, [chan]);
      fake.state.stopKeeps.add("48:life-k"); // another live channel carries the seat beside
      const ended = await s.rpc("iskron/end", { event: "session_closed" });
      assert.equal(ended.result?.ended, true, JSON.stringify(ended));
      await sleep(300);
      assert.equal((await asked(mux, chan, main, journal)).state, "gone", journal());
      assert.equal((await asked(mux, chan, beside, journal)).state, "unknown", journal());
      noCheckIn(s);
    });
  });

// Not an end of the session: an away (a reload), a plain leave inside the death window, a
// supersede by another holder (4000) — unknown; a gone there could end a live seat.
for (const [how, act] of [
  ["an away", async (s) => (await s.rpc("iskron/away"), s.bye())],
  ["a leave inside the death window", async (s) => s.bye()],
  ["a supersede", async (s, mux, chan) => mux.endSub(chan, 4000, "superseded")],
])
  test(`on the dispatcher after ${how}: unknown, not gone`, async () => {
    await withMux(async ({ fake, mux, session, journal }) => {
      const s = await session();
      const r = await s.stand({ realm: "nks-dev", karta: 931, name: "life-u" });
      assert.ok(r.result && !r.result.isError, textOf(r));
      const chan = channelOf(fake, "life-u");
      const id = seatIdOf(fake, "life-u");
      const conn = await muxCarrying(fake, mux, [chan]);
      await act(s, mux, chan);
      const unsub = () => mux.sent("unsubscribe").some((u) => u.channel_id === chan);
      await waitFor("the subscription let go", () => !conn.subs.has(chan) || unsub());
      await sleep(500);
      assert.equal((await asked(mux, chan, id, journal)).state, "unknown", journal());
      noCheckIn(s);
    });
  });
