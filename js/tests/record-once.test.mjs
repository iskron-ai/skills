// A case record is given to a seat once (graph @nks/nks-dev, nodes #6574, #11359): the
// stale wake-ups of 2026-11-26 06:59–07:06Z (one OpenCode seat of #931) re-counted records
// already given — the server's stale replay and the role's copies carry new frame ids, so the
// id memory let them through, and each stale batch counted them again. The real bridge,
// a pi-type client on the seam (its notification is the delivery), the fake dispatcher.
import assert from "node:assert/strict";
import { test } from "node:test";

import { channelOf, muxCarrying, sleep, textOf, waitFor, withMux } from "./mux-kit.mjs";
import { progress } from "./room-frames.mjs";

const REALM = "nks-dev";
const ok = (r, what) => assert.ok(r.result && !r.result.isError, `${what}: ${textOf(r)}`);

/** The channel's notifications to the session: kind and the frames or the one frame. */
const events = (s) =>
  s.frames
    .filter((f) => f.t === "rpc" && f.msg?.method === "notifications/message")
    .map((f) => f.msg.params?.data)
    .filter((d) => d && ["frame", "stale", "backlog"].includes(d.kind));
const framesOf = (ev) => (ev.kind === "frame" ? [ev.frame] : (ev.frames ?? []));
/** How many times the record (case 7, entry n) reached the session. */
const given = (s, n) =>
  events(s)
    .flatMap(framesOf)
    .filter((f) => f?.entry_id === n).length;
/** A count frame of case 7: a progress line of its own key, not to the seat. */
const record = (channel_id, n, id, extra = {}) => ({
  ...progress(n, `key-${n}`),
  channel_id,
  id,
  ...extra,
});

async function seat(fake, mux, session, name) {
  const s = await session();
  ok(await s.stand({ realm: REALM, karta: 931, name }), "stands");
  const channel_id = channelOf(fake, name);
  await muxCarrying(fake, mux, [channel_id]);
  return { s, channel_id };
}

test("100 copies of one frame id are one delivery", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const { s, channel_id } = await seat(fake, mux, session, "once-id");
    for (let i = 0; i < 100; i++) mux.push(record(channel_id, 30, "same-id"));
    await waitFor("the first copy", () => given(s, 30));
    await sleep(500);
    assert.equal(given(s, 30), 1, "one frame id — one item");
  });
});

test("100 copies of one record under new frame ids are one count", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const { s, channel_id } = await seat(fake, mux, session, "once-rec");
    for (let i = 0; i < 100; i++) mux.push(record(channel_id, 31, `live-${i}`));
    await waitFor("the first copy", () => given(s, 31));
    for (let i = 0; i < 100; i++) mux.push(record(channel_id, 31, `stale-${i}`, { stale: true }));
    mux.push(record(channel_id, 99, "fence"));
    await waitFor("the fence", () => given(s, 99));
    await sleep(2000); // the stale window (1.5 s) closes
    assert.equal(given(s, 31), 1, "one record — one item, live or stale");
  });
});

// The breakdown (record-once probe of the 06:59–07:06Z stale batches): records 12–16 of a
// case given as live counts; then the stale replay brings 11–16 again under new ids, and a
// record of the case older than all given. Not one of them is news — no stale event comes.
test("a stale replay of given records and of an older one wakes nothing", async () => {
  await withMux(async ({ fake, mux, session, journal }) => {
    const { s, channel_id } = await seat(fake, mux, session, "once-replay");
    for (let n = 12; n <= 16; n++) mux.push(record(channel_id, n, `first-${n}`));
    await waitFor("the live counts", () => given(s, 16));
    for (let n = 11; n <= 16; n++) mux.push(record(channel_id, n, `again-${n}`, { stale: true }));
    await sleep(2500);
    assert.deepEqual(
      events(s).filter((e) => e.kind === "stale"),
      [],
      "no stale batch of records already counted",
    );
    for (let n = 12; n <= 16; n++) assert.equal(given(s, n), 1, `record ${n} once`);
    assert.equal(given(s, 11), 0, "an older stale count is not news");
    assert.match(journal() + "", /counts a record (given|older) to the seat/);
  });
});

// The batch is the server's frames grouped by case, no head of the bridge's own (#11359).
test("a whole stale batch and a whole wake-up batch carry no head of the bridge's own", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const { s, channel_id } = await seat(fake, mux, session, "no-head");
    const platform = { provenance: { via: "platform" }, type: "message", channel_id };
    mux.push({ ...platform, id: "old-1", body: "ЛЕЖАЛОЕ-ТЕЛО", stale: true });
    await waitFor("the stale batch", () => events(s).find((e) => e.kind === "stale"), 5000);
    mux.push({ ...platform, id: "wake-1", body: "ПОБУДКА-ТЕЛО" });
    await waitFor("the wake batch", () => events(s).find((e) => e.kind === "backlog"), 5000);
    for (const kind of ["stale", "backlog"]) {
      const { text } = events(s).find((e) => e.kind === kind);
      assert.doesNotMatch(text, /Лежалых кадров|Побудка: кадров|Stale frames|Wake-up:/, text);
      assert.match(
        text,
        kind === "stale" ? /^[^\n]*\nЛЕЖАЛОЕ-ТЕЛО/ : /^[^\n]*\nПОБУДКА-ТЕЛО/,
        text,
      );
    }
  });
});

test("a repeated card (repeat: true) still comes, and a text record is not taken for a count", async () => {
  await withMux(async ({ fake, mux, session }) => {
    const { s, channel_id } = await seat(fake, mux, session, "once-card");
    mux.push(record(channel_id, 40, "card-first"));
    await waitFor("the first", () => given(s, 40));
    mux.push(record(channel_id, 40, "card-repeat", { repeat: true, repeat_n: 1 }));
    await waitFor("the server's repeat", () => given(s, 40) === 2);
  });
});
