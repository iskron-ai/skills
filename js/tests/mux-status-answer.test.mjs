// Строка занятости по соединению диспетчера просит ответа (граф @nks/nks-dev, узел #11337):
// кадр status с ack и свежим ref, одна запись в полёте на канал; status_set — поставлена,
// status_trimmed — поставлена обрезанной (предел назван), status_rejected — НЕ поставлена с
// причиной; молчание 3 с — не отказ и не «поставлена»; кадр error — ответ такту, не строке.
import assert from "node:assert/strict";
import { test } from "node:test";

import { channelOf, muxCarrying, sleep, textOf, waitFor, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const NOT_CONFIRMED = /не подтверждает|does not confirm/;

/** Место на соединении диспетчера; `answers` — фейк отвечает с ref, как следующий api. */
async function seated(ctx, name, answers = true) {
  const a = await ctx.session();
  await a.stand({ realm: REALM, karta: 931, name });
  const chan = channelOf(ctx.fake, name);
  await muxCarrying(ctx.fake, ctx.mux, [chan]);
  Object.assign(ctx.mux, { statusAck: answers, statusEchoRef: answers });
  return { a, chan };
}

const said = (r) => {
  assert.ok(!r.result?.isError, textOf(r));
  return textOf(r);
};

test("today's api answers nothing: the line is sent, not refused, named as not confirmed — never as failed", async () => {
  await withMux(async (ctx) => {
    const { a } = await seated(ctx, "silent-line", false);
    const start = Date.now();
    const text = said(await a.stand({ realm: REALM, status: "a quiet line" }));
    assert.match(text, /a quiet line/);
    assert.match(text, NOT_CONFIRMED);
    assert.ok(Date.now() - start >= 2700, "waits the answer window");
    const frame = ctx.mux.sent("status").find((f) => f.text === "a quiet line");
    assert.equal(frame?.ack, true, "the frame asks for an answer");
    assert.ok(typeof frame.ref === "string" && frame.ref.length <= 32, "a ref of ≤32");
  });
});

test("status_set with the frame's ref: the line is set, no unconfirmed word", async () => {
  await withMux(async (ctx) => {
    const { a } = await seated(ctx, "acked-line");
    const text = said(await a.stand({ realm: REALM, status: "confirmed" }));
    assert.match(text, /confirmed/);
    assert.doesNotMatch(text, NOT_CONFIRMED);
    said(await a.stand({ realm: REALM, status: "confirmed again" }));
    const refs = ctx.mux.sent("status").map((f) => f.ref);
    assert.ok(refs.length >= 2 && refs.every(Boolean), "each write a status frame with a ref");
    assert.equal(new Set(refs).size, refs.length, "a fresh ref per write");
  });
});

test("status_trimmed: set trimmed, the limit named", async () => {
  await withMux(async (ctx) => {
    const { a } = await seated(ctx, "trim-line");
    const long = "очень длинная строка занятости ".repeat(4).trim();
    const text = said(await a.stand({ realm: REALM, status: long }));
    assert.match(text, /64/, "the limit named");
    assert.match(text, /обрезал|trimmed/);
    assert.doesNotMatch(text, NOT_CONFIRMED);
  });
});

test("not_stored: NOT set with its reason", async () => {
  await withMux(async (ctx) => {
    const { a } = await seated(ctx, "rejected-line");
    ctx.mux.statusReason = "not_stored";
    const r = await a.stand({ realm: REALM, status: "reject this" });
    assert.ok(r.result?.isError, textOf(r));
    assert.match(textOf(r), /not_stored/);
    assert.match(textOf(r), /НЕ поставлена|NOT set/);
  });
});

test("ref_invalid: NOT set, and a journal line names a bridge defect", async () => {
  await withMux(async (ctx) => {
    const { a } = await seated(ctx, "bad-ref");
    ctx.mux.statusReason = "ref_invalid";
    const r = await a.stand({ realm: REALM, status: "invalid" });
    assert.ok(r.result?.isError, textOf(r));
    assert.match(textOf(r), /ref_invalid/);
    await waitFor("the defect in the journal", () => /ref as invalid/.test(ctx.journal()));
  });
});

// A busy line does no connect and no register (#4235): the same address in the hold record —
// NOT set, stand again; no register, no second frame.
for (const reason of ["no_live_standing", "unknown_standing"]) {
  test(`${reason}: no register, no second send — the line NOT set, stand again`, async () => {
    await withMux(async (ctx) => {
      const { a } = await seated(ctx, `retry-${reason}`);
      ctx.mux.statusReasons.push(reason);
      const before = ctx.fake.state.counts.register_standing;
      const r = await a.stand({ realm: REALM, status: "retry me" });
      assert.ok(r.result?.isError, textOf(r));
      assert.match(
        textOf(r),
        /места на канале нет — встань снова|no live seat on the channel — stand again/,
      );
      assert.equal(ctx.fake.state.counts.register_standing - before, 0, "no register");
      assert.equal(ctx.mux.sent("status").filter((f) => f.text === "retry me").length, 1);
    });
  });
}

test("an error frame answers the tact, not the line: the write still waits for its own answer", async () => {
  await withMux(async (ctx) => {
    const { a, chan } = await seated(ctx, "err-line", false);
    const pending = a.stand({ realm: REALM, status: "waits" });
    const frame = await waitFor("the status frame", () =>
      ctx.mux.sent("status").find((f) => f.text === "waits"),
    );
    ctx.mux.push({ type: "error", channel_id: chan, code: "standing_required", ref: frame.ref });
    await sleep(300);
    ctx.mux.push({ type: "status_set", channel_id: chan, ref: frame.ref });
    const text = said(await pending);
    assert.doesNotMatch(text, NOT_CONFIRMED, "set by its own answer");
  });
});

test("after a write heard nothing: an unlabelled answer is not known, a mismatching ref ignored, an exact ref resolves cleanly", async () => {
  await withMux(async (ctx) => {
    const { a, chan } = await seated(ctx, "late-line", false);
    assert.match(said(await a.stand({ realm: REALM, status: "first" })), NOT_CONFIRMED);
    const second = a.stand({ realm: REALM, status: "second" });
    await waitFor("second sent", () => ctx.mux.sent("status").find((f) => f.text === "second"));
    ctx.mux.push({ type: "status_set", channel_id: chan });
    assert.match(said(await second), /earlier line|прежней строки/);
    const third = a.stand({ realm: REALM, status: "third" });
    const frame = await waitFor("third sent", () =>
      ctx.mux.sent("status").find((f) => f.text === "third"),
    );
    ctx.mux.push({ type: "status_rejected", channel_id: chan, reason: "not_stored", ref: "other" });
    ctx.mux.push({ type: "status_set", channel_id: chan, ref: frame.ref });
    const text = said(await third);
    assert.match(text, /third/);
    assert.doesNotMatch(text, NOT_CONFIRMED);
    const fourth = a.stand({ realm: REALM, status: "fourth" });
    await waitFor("fourth sent", () => ctx.mux.sent("status").find((f) => f.text === "fourth"));
    ctx.mux.push({ type: "status_set", channel_id: chan });
    assert.doesNotMatch(said(await fourth), NOT_CONFIRMED, "attribution back to normal");
  });
});
