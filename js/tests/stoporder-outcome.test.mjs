// The outcome of a stop order (graph @nks/nks-dev, nodes #7510, #7519; review in case №669):
// stopped only once the harness's stop is executed — a harness that confirms it (the halts
// capability, the OpenCode plugin) answers method("halted"), its refusal is failed with its
// code, its silence unknown; the journal refusing an entry is said aloud, the stop executed
// all the same and the outcome sent without accepted; the outcome never overtakes the
// accepted's answer; an accepted whose bridge ended before the outcome is answered unknown by
// the next; the open orders read pages by next_since from the cursor in the home.
//
// ISKRON_BRIDGE_PATH aims the probe at any copy of the bridge.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { saidKind, stand, textOf, until } from "./ownseat-kit.mjs";
import { acks, NKS, orderOnDisk, pause, seatId, standing, states } from "./stoporder-kit.mjs";

process.env.ISKRON_ORDER_HALT_MS = "1500"; // the bridges of this file wait so long for the harness
const HALTS = { experimental: { "iskron/halts": {} } };
const halted = (b, params) => b.call("iskron/halted", params);
const stoppedBy = (b, order) =>
  b.notifications.find((n) => n.params?.data?.kind === "stopped" && n.params.data.order === order);

test("a harness that confirms its stop: stopped is answered only after its halted", async (t) => {
  const { fake, b, id } = await standing(t, "proba", HALTS);
  await fake.control({ stop_order: { id: "ord-h1", standing_id: id } });
  await until(() => stoppedBy(b, "ord-h1"), `the stop word naming the order:\n${b.stderr}`);
  await pause(600);
  assert.deepEqual(states(fake, "ord-h1"), ["accepted"], "no outcome before the harness's stop");
  const r = await halted(b, { order: "ord-h1", ok: true });
  assert.equal(r.result?.taken, true, JSON.stringify(r));
  await until(() => states(fake, "ord-h1").includes("stopped"), "the outcome");
  assert.deepEqual(states(fake, "ord-h1"), ["accepted", "stopped"]);
});

test("a harness that refused its stop: failed with the harness's code", async (t) => {
  const { fake, b, id } = await standing(t, "proba", HALTS);
  await fake.control({ stop_order: { id: "ord-h2", standing_id: id } });
  await until(() => stoppedBy(b, "ord-h2"), "the stop word naming the order");
  await halted(b, { order: "ord-h2", ok: false, code: "interrupt_refused" });
  await until(() => states(fake, "ord-h2").includes("failed"), "the outcome");
  assert.equal(acks(fake, "ord-h2").at(-1).reason_code, "interrupt_refused");
  assert.equal(fake.state.orders.list.get("ord-h2").state, "failed");
});

test("a confirming harness silent past the wait: unknown, not stopped", async (t) => {
  const { fake, b, id } = await standing(t, "proba", HALTS);
  await fake.control({ stop_order: { id: "ord-h3", standing_id: id } });
  await until(() => stoppedBy(b, "ord-h3"), "the stop word naming the order");
  await until(() => acks(fake, "ord-h3").length === 2, "the outcome");
  assert.deepEqual(states(fake, "ord-h3"), ["accepted", "unknown"]);
  assert.equal(acks(fake, "ord-h3")[1].reason_code, "harness_silent");
});

test("a journal that refuses the entry: said aloud, the stop executed, the outcome without accepted", async (t) => {
  const { fake, dir, b, id } = await standing(t);
  writeFileSync(join(dir, "orders"), ""); // a file where the journal's directory goes
  await fake.control({ stop_order: { id: "ord-j", standing_id: id } });
  await until(() => saidKind(b, "stopped"), "the stop word");
  await until(() => acks(fake, "ord-j").length, "the outcome");
  await pause(600);
  assert.deepEqual(states(fake, "ord-j"), ["stopped"], "accepted is the order on disk — none");
  const note = b.notifications.find((n) => /журнал на диске/.test(n.params?.data?.text ?? ""));
  assert.ok(note, `the human hears of the journal: ${JSON.stringify(b.notifications)}`);
  assert.match(b.stderr, /журнал на диске не записал приказ/);
});

test("the outcome never overtakes a slow accepted", async (t) => {
  const { fake, b, id } = await standing(t);
  await fake.control({ orders_ack_delay: { accepted: 3000 } });
  await fake.control({ stop_order: { id: "ord-s", standing_id: id } });
  await until(() => saidKind(b, "stopped"), "the stop word");
  await until(() => acks(fake, "ord-s").length === 2, "both answers");
  assert.deepEqual(states(fake, "ord-s"), ["accepted", "stopped"]);
});

test("an accepted left by a bridge that ended before the outcome: the next bridge answers unknown", async (t) => {
  const { fake, dir, b } = await standing(t);
  await fake.control({ stop_order: { id: "ord-r", standing_id: "gone-seat", frame: false } });
  fake.state.orders.list.get("ord-r").state = "accepted";
  mkdirSync(join(dir, "orders"), { recursive: true });
  const base = `${new URL(fake.mcpUrl).origin}/api`;
  const left = { id: "ord-r", standing: "gone-seat", state: "accepted", base, acked: false };
  writeFileSync(
    join(dir, "orders", "ord-r.json"),
    JSON.stringify({ ...left, at: Date.now(), pid: 2 ** 22 + 7 }),
  );
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 0, standings: [] }) });
  await until(() => acks(fake, "ord-r").length, `the outcome:\n${b.stderr}`);
  // The read and the repeat may both answer it: the same outcome, idempotent at the api.
  assert.deepEqual([...new Set(states(fake, "ord-r"))], ["unknown"]);
  assert.equal(acks(fake, "ord-r")[0].reason_code, "bridge_restarted");
  assert.equal(orderOnDisk(dir, "ord-r").state, "unknown");
  assert.ok(!saidKind(b, "stopped"), "the harness is not asked again");
});

test("the read pages past 200 open orders to the bridge's own", async (t) => {
  const { fake, b, id } = await standing(t);
  const others = Array.from({ length: 250 }, (_, i) => ({
    id: `other-${i}`,
    standing_id: "another-session",
    frame: false,
  }));
  await fake.control({ stop_orders: [...others, { id: "ord-p", standing_id: id, frame: false }] });
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 0, standings: [] }) });
  await until(() => fake.state.orders.list.get("ord-p").state === "stopped", "the own order");
  assert.ok(saidKind(b, "stopped"));
});

test("the read cursor lives in the home: the next bridge reads past the settled order", async (t) => {
  const { fake, b, id, up } = await standing(t);
  await fake.control({ stop_order: { id: "ord-c", standing_id: id, frame: false } });
  const seq = fake.state.orders.list.get("ord-c").seq;
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 0, standings: [] }) });
  await until(() => fake.state.orders.list.get("ord-c").state === "stopped", "the outcome");
  await pause(300);
  await b.stop();
  const next = await up();
  const r = await stand(next, { realm: "nks-dev", karta: 931, name: "proba-2" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(fake, NKS, "proba-2"), "the next seat");
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 0, standings: [] }) });
  await until(() => fake.state.orders.queries.length >= 3, "the next bridge's read");
  assert.equal(
    fake.state.orders.queries.at(-1).since,
    seq,
    JSON.stringify(fake.state.orders.queries),
  );
});
