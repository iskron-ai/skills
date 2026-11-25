// Срез правил человека из mind (граф @nks/nks-dev, #9817) — один на учётку для всего демона:
// N сессий, вставших разом, читают его одним запросом; отказ чтения — пауза с разбросом, в
// которую ни одна сессия не спрашивает снова; запись в свой mind сбрасывает срез.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { test } from "node:test";

import { MIND_SLICE } from "../delivery/index.ts";
import { sliceIn } from "../shared/mindslice.ts";
import { textOf, withMux } from "./mux-kit.mjs";

const REALM = "nks-dev";
const W = MIND_SLICE.ru;
const RULES = [{ seq: 30, name: "Правило 1: короткое имя", text: "Фрагмент описания правила" }];
const count = (fake, name, pick = () => true) =>
  fake.state.calls.filter((c) => c.name === name && pick(c.arguments ?? {})).length;
const slices = (fake) =>
  count(fake, "iskron_search", (a) => a.attrs_filter === "slice:agents,ways");
const whoamis = (fake) => count(fake, "iskron_me", (a) => a.action === "whoami");

/** N сессий демона встают разом; ответы — их тексты. */
async function wave({ session }, n, tag) {
  const all = await Promise.all(Array.from({ length: n }, () => session()));
  const got = await Promise.all(
    all.map((s, i) => s.stand({ realm: REALM, karta: 931, name: `${tag}-${i}` })),
  );
  return { sessions: all, texts: got.map(textOf) };
}

test("N sessions of one daemon standing together read the rules slice once", async () => {
  await withMux(async (ctx) => {
    await ctx.fake.control({ mind: { rules: RULES } });
    const { texts } = await wave(ctx, 4, "many");
    assert.equal(slices(ctx.fake), 1, "one slice read for the account");
    assert.equal(whoamis(ctx.fake), 1, "one whoami for the account");
    for (const t of texts) assert.equal(sliceIn(t)?.split("\n")[0], W.head(1), t);
  });
});

test("a refused slice read backs off: the next sessions do not hammer the server and are told why", async () => {
  await withMux(async (ctx) => {
    await ctx.fake.control({ mind: { refuse: "Ошибка: поиск недоступен" } });
    await wave(ctx, 3, "fail");
    assert.equal(slices(ctx.fake), 1, "one read in the first wave");
    const { texts } = await wave(ctx, 3, "again");
    assert.equal(slices(ctx.fake), 1, "no read while the pause lasts");
    for (const t of texts) assert.equal(sliceIn(t), W.unread("Ошибка: поиск недоступен"));
  });
});

test("a slow server with nothing cached: the stand answers by ~3 s without rules, the one fetch fills the cache", async () => {
  await withMux(async (ctx) => {
    await ctx.fake.control({ mind: { rules: RULES, delayMs: 6000 } });
    const t0 = Date.now();
    const { texts } = await wave(ctx, 1, "slow");
    const took = Date.now() - t0;
    assert.ok(took < 5000, `the stand waited ${took} ms for the slice`);
    assert.equal(sliceIn(texts[0]), W.pending(), texts[0]);
    await new Promise((r) => setTimeout(r, 4000)); // the one fetch lands
    const { texts: next } = await wave(ctx, 1, "filled");
    assert.equal(sliceIn(next[0])?.split("\n")[0], W.head(1), next[0]);
    assert.equal(slices(ctx.fake), 1, "one fetch, the next stand served from it");
  });
});

test("a write to the own mind drops the cached slice: the next stand reads it again", async () => {
  await withMux(async (ctx) => {
    await ctx.fake.control({ mind: { rules: RULES } });
    const { sessions } = await wave(ctx, 1, "first");
    await wave(ctx, 1, "cached");
    assert.equal(slices(ctx.fake), 1, "the second stand is served from the cache");
    await sessions[0].rpc("tools/call", {
      name: "iskron_add_phenomenon",
      arguments: { realm: "@tester/mind", name: "📌 Новое правило", attrs: { slice: "agents" } },
    });
    await wave(ctx, 1, "after-write");
    assert.equal(slices(ctx.fake), 2, "read again after the write");
  });
});
