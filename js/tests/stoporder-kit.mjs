// Общее у проб приказа останова (stoporder*.test.mjs): мост на месте против фейка приказов
// (fake-orders.mjs) и чтение ответов api, уведомлений и журнала приказов.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { setup, stand, textOf, until } from "./ownseat-kit.mjs";

export const NKS = "@nks/nks-dev";
export const pause = (ms) => new Promise((r) => setTimeout(r, ms));
export const seatId = (fake, canon, name) =>
  [...fake.state.channels.values()].map((c) => c.places.get(canon)).find((p) => p?.name === name)
    ?.standing_id;
export const acks = (fake, id) => fake.state.orders.acks.filter((a) => a.id === id && !a.dropped);
export const states = (fake, id) => acks(fake, id).map((a) => a.state);
export const kinds = (b) => b.notifications.map((n) => n.params?.data?.kind).filter(Boolean);
export const frames = (b) =>
  b.notifications.filter((n) => JSON.stringify(n.params?.data ?? {}).includes('"stop"'));
export const journal = (dir) => readFileSync(join(dir, "standings.log"), "utf8");
export const orderOnDisk = (dir, id) =>
  JSON.parse(readFileSync(join(dir, "orders", `${id}.json`), "utf8"));

/** Мост на месте `name`; capabilities — что клиент объявил в initialize. */
export async function standing(t, name = "proba", capabilities) {
  const env = await setup(t);
  const b = await env.up(undefined, capabilities);
  const r = await stand(b, { realm: "nks-dev", karta: 931, name });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => env.fake.state.ws.size === 1, "the socket");
  await until(() => seatId(env.fake, NKS, name), "the seat id");
  // The open orders read of the socket's hello: an order the probe puts before it would be read
  // too, and a refused or settled one answered again (an idempotent repeat the probe would count).
  await until(() => env.fake.state.orders.reads >= 1, "the open orders read");
  return { ...env, b, id: seatId(env.fake, NKS, name) };
}
