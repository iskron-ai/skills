// The server's life check of a seat (graph @nks/nks-dev, nodes #11362, #11359): a control frame
// {type:"life_check", standing_id, ref} — on the seat's socket and on the dispatcher (with
// channel_id) — is never a turn: the bridge answers {type:"life", standing_id, ref, state} at once —
// present (the harness session holding the seat lives), gone (its session let it go), unknown
// (not a seat of this bridge). The bridge says it answers by "life" in its seat attrs.caps.
// On the former build the frame went to the session as any frame and nothing answered it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { delay, journalOf, stood, waitFor, withFake } from "./lifeend-kit.mjs";
import { channelOf, muxCarrying, seatIdOf, textOf, withMux } from "./mux-kit.mjs";

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

test("on the seat's socket: present for its own seat, unknown for another — no frame reaches the session; caps names life", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "life-s");
    const id = idOf(fake, "life-s");
    assert.ok(id, "the seat has an id");
    assert.ok(
      fake.state.placeAttrs.get("931:life-s")?.caps?.includes("life"),
      `attrs.caps names life: ${JSON.stringify(fake.state.placeAttrs.get("931:life-s"))}`,
    );
    const before = a.notifications.length;
    await fake.control({ ws_send: JSON.stringify(check(id, "r1")) });
    await fake.control({ ws_send: JSON.stringify(check("someone-else", "r2")) });
    await waitFor("both answered", () => fake.state.lives.length === 2).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    const [mine, other] = fake.state.lives.map((l) => l.frame);
    assert.deepEqual(mine, { type: "life", standing_id: id, ref: "r1", state: "present" });
    assert.deepEqual(other, {
      type: "life",
      standing_id: "someone-else",
      ref: "r2",
      state: "unknown",
    });
    await delay(300);
    const after = a.notifications.slice(before);
    assert.ok(
      !after.some((n) => JSON.stringify(n).includes("life_check")),
      `no notification carries the check: ${JSON.stringify(after)}`,
    );
  });
});

test("on the dispatcher: present while the session holds the channel, gone once its session ended — never a turn", async () => {
  await withMux(async ({ fake, mux, session, journal }) => {
    const s = await session();
    const r = await s.stand({ realm: "nks-dev", karta: 931, name: "life-m" });
    assert.ok(r.result && !r.result.isError, textOf(r));
    const chan = channelOf(fake, "life-m");
    const id = seatIdOf(fake, "life-m");
    await muxCarrying(fake, mux, [chan]);
    mux.push(check(id, "m1", { channel_id: chan }));
    await waitFor("the live answer", () => mux.sent("life").some((l) => l.ref === "m1")).catch(
      (e) => {
        throw new Error(`${e.message}\n${journal()}`);
      },
    );
    const live = mux.sent("life").find((l) => l.ref === "m1");
    assert.equal(live.state, "present");
    assert.equal(live.channel_id, chan);
    assert.equal(live.standing_id, id);
    const ended = await s.rpc("iskron/end", { event: "session_closed" });
    assert.equal(ended.result?.ended, true, JSON.stringify(ended));
    mux.push(check(id, "m2", { channel_id: chan }));
    await waitFor("the answer after the end", () => mux.sent("life").some((l) => l.ref === "m2"));
    assert.equal(mux.sent("life").find((l) => l.ref === "m2").state, "gone");
    const reached = s.frames.filter((f) => JSON.stringify(f).includes('"type":"life_check"'));
    assert.deepEqual(reached, [], "the check reached no session");
  });
});
