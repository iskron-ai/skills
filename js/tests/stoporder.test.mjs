// The owner's stop order (graph @nks/nks-dev, nodes #7509, #7510, #7519; api 0.122.0, word of
// #48 in case №669): the stop frame is the bridge's, never the agent's; the order goes on disk,
// accepted is answered before the stop, the seat stops as when the owner takes it off and the
// outcome is answered — repeated from the journal until the api takes it, after a daemon change
// too. The same order twice is one stop. An order for a seat beside ends only that seat; an
// order for a seat the bridge does not hold is refused. The read of open orders on hello is the
// second way in.
//
// ISKRON_BRIDGE_PATH aims the probe at any copy of the bridge: before the orders a stop frame
// went to the agent and nothing answered it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { saidKind, setup, stand, textOf, until } from "./ownseat-kit.mjs";
import {
  acks,
  frames,
  journal,
  kinds,
  NKS,
  orderOnDisk,
  pause,
  seatId,
  standing,
} from "./stoporder-kit.mjs";

const DRUGOY = "@nks/drugoy";

test("a stop frame: not the agent's — accepted before the stop, the stop word, the seat ended by stopped", async (t) => {
  const { fake, dir, b, id } = await standing(t);
  await fake.control({ stop_order: { id: "ord-1", standing_id: id } });
  await until(() => saidKind(b, "stopped"), `the stop word:\n${b.stderr}`);
  assert.match(saidKind(b, "stopped").params.data.text, /ты остановлен/);
  await until(() => acks(fake, "ord-1").length === 2, "the outcome");
  assert.equal(
    acks(fake, "ord-1")[0].sockets,
    1,
    "accepted reaches the api while the seat is held",
  );
  assert.deepEqual(
    acks(fake, "ord-1").map((a) => a.state),
    ["accepted", "stopped"],
  );
  assert.equal(fake.state.orders.list.get("ord-1").state, "stopped");
  assert.equal(fake.state.channels.size, 0, "the seat ended by the answer, as by itself");
  assert.equal(frames(b).length, 0, `the stop frame never reached the agent: ${kinds(b)}`);
  assert.ok(!kinds(b).includes("dead"), "no dead token");
  await pause(800);
  assert.equal(fake.state.counts.connect, 1, "nothing takes the seat again");
  assert.match(journal(dir), /stop order ord-1 for \S+: stopped/);
  assert.equal(orderOnDisk(dir, "ord-1").state, "stopped");
});

test("a stop frame is never given to the agent as a frame", async (t) => {
  const { fake, b, id } = await standing(t);
  await fake.control({ stop_order: { id: "ord-0", standing_id: id } });
  await until(() => kinds(b).includes("frame") || kinds(b).includes("stopped"), "a word");
  await pause(500);
  assert.equal(frames(b).length, 0, JSON.stringify(frames(b)));
});

test("the same order twice is one stop: one stop word, the same outcome answered", async (t) => {
  const { fake, dir, b, id } = await standing(t);
  const frame = JSON.stringify({
    type: "stop",
    order_id: "ord-2",
    standing_id: id,
    by: "person",
    to_standing: "@tester:proba",
    to_standing_id: id,
  });
  fake.state.orders.list.set("ord-2", { id: "ord-2", standing_id: id, state: "issued" });
  await fake.control({ ws_send_many: [frame, frame] });
  await until(() => acks(fake, "ord-2").some((a) => a.state === "stopped"), "the outcome");
  await pause(600);
  assert.equal(kinds(b).filter((k) => k === "stopped").length, 1, `one stop: ${kinds(b)}`);
  assert.equal(journal(dir).match(/stop order ord-2 for/g)?.length, 1, journal(dir));
  assert.ok(
    acks(fake, "ord-2").every((a) => ["accepted", "stopped"].includes(a.state)),
    JSON.stringify(acks(fake, "ord-2")),
  );
});

test("an outcome the network lost is answered again from the journal", async (t) => {
  const { fake, b, id } = await standing(t);
  await fake.control({ orders_ack_drop: 2 }); // accepted and the first stopped are lost
  await fake.control({ stop_order: { id: "ord-3", standing_id: id } });
  await until(() => saidKind(b, "stopped"), "the stop word");
  await until(
    () => fake.state.orders.list.get("ord-3").state === "stopped",
    "the repeated outcome",
  );
  assert.ok(fake.state.orders.acks.filter((a) => a.dropped).length >= 2);
});

test("an outcome not taken before the bridge died is answered by the next one of the same home", async (t) => {
  const { fake, dir, b, id, up } = await standing(t);
  await fake.control({ orders_ack_drop: 1000 });
  await fake.control({ stop_order: { id: "ord-4", standing_id: id } });
  await until(() => saidKind(b, "stopped"), "the stop word");
  await until(() => orderOnDisk(dir, "ord-4").state === "stopped", "the outcome on disk");
  assert.equal(orderOnDisk(dir, "ord-4").acked, false);
  await b.stop();
  await fake.control({ orders_ack_drop: 0 });
  const next = await up();
  const r = await stand(next, { realm: "nks-dev", karta: 931, name: "proba-2" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => fake.state.orders.list.get("ord-4").state === "stopped", "the outcome taken");
  await until(() => orderOnDisk(dir, "ord-4").acked, "the journal marks it taken");
  assert.ok(!saidKind(next, "stopped"), "the next bridge stops nobody");
});

test("an order for the seat beside ends that seat only — the main seat holds, no stop word", async (t) => {
  const { fake, b } = await standing(t);
  const r = await stand(b, { realm: DRUGOY, karta: 48, name: "proba-b" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(fake, DRUGOY, "proba-b"), "the seat beside");
  await fake.control({ stop_order: { id: "ord-5", standing_id: seatId(fake, DRUGOY, "proba-b") } });
  await until(() => fake.state.orders.list.get("ord-5").state === "stopped", "the outcome");
  await until(() => /that seat beside is forgotten/.test(b.stderr), "the seat beside forgotten");
  await pause(400);
  assert.ok(!kinds(b).includes("stopped"), `no stop of the agent: ${kinds(b)}`);
  assert.equal(fake.state.ws.size, 1, "the main seat's socket stays");
  assert.ok(seatId(fake, NKS, "proba"), "the main seat stays on the channel");
});

// #48 in №669: stopped for the founder ends the channel whole — its seats beside too — with one
// 4001 revoked:self; the bridge does nothing more: that 4001 is no foreign stop, the seats beside
// go quietly with the main seat, nothing stands again.
test("an order for the founder with a seat beside: one stop, the seat beside goes quietly, no second stop on the 4001", async (t) => {
  const { fake, dir, b, id } = await standing(t);
  const r = await stand(b, { realm: DRUGOY, karta: 48, name: "proba-b" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(fake, DRUGOY, "proba-b"), "the seat beside");
  await fake.control({ stop_order: { id: "ord-f", standing_id: id } });
  await until(() => fake.state.orders.list.get("ord-f").state === "stopped", "the outcome");
  await until(() => fake.state.channels.size === 0, "the channel ended whole");
  await pause(800);
  assert.equal(kinds(b).filter((k) => k === "stopped").length, 1, `one stop word: ${kinds(b)}`);
  assert.ok(!kinds(b).includes("dead"), "no dead token");
  assert.equal(journal(dir).match(/^.*stopped .*close 4001.*$/m), null, journal(dir));
  assert.equal(fake.state.counts.connect, 1, "nothing stands again");
});

test("an order for a seat the bridge does not hold is refused; nobody stops", async (t) => {
  const { fake, b } = await standing(t);
  await fake.control({ stop_order: { id: "ord-6", standing_id: "not-mine" } });
  await until(() => acks(fake, "ord-6").length, "the answer");
  await pause(300);
  assert.deepEqual(
    acks(fake, "ord-6").map((a) => a.state),
    ["refused"],
  );
  assert.ok(!kinds(b).includes("stopped"));
  assert.equal(fake.state.ws.size, 1);
});

// Case №1046: a bridge that never learnt its seat's id took a stop order for any id as its own —
// the law of standing_ended: an unknown id is no seat of its; the order stops it only when
// addressed to that very seat (to_standing_id, and its name if named).
const NOT_MINE = [
  ["addressed to that seat", { to_standing: "@tester:sosed.sub-5", to_standing_id: "s5" }],
  ["addressed to this seat by name only", { to_standing: "@tester:proba" }],
  ["with no addressee", {}],
];
async function blind(t) {
  const env = await setup(t);
  await env.fake.control({ registerNoId: true, helloNoIds: true });
  const b = await env.up();
  const r = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => env.fake.state.ws.size === 1, "the socket");
  await pause(200);
  return { ...env, b };
}
for (const [what, to] of NOT_MINE)
  test(`#1046: the seat id unknown to the bridge — an order for another seat ${what} is refused; nobody stops`, async (t) => {
    const { fake, b } = await blind(t);
    await fake.control({ stop_order: { id: "ord-nm", standing_id: "s5", to } });
    await until(() => acks(fake, "ord-nm").length, `the answer:\n${b.stderr}`);
    await pause(300);
    assert.deepEqual(
      acks(fake, "ord-nm").map((a) => a.state),
      ["refused"],
    );
    assert.ok(!kinds(b).includes("stopped"), `nobody stops: ${kinds(b)}`);
    assert.equal(fake.state.ws.size, 1, "the seat's socket stays");
  });

test("#1046: the seat id unknown to the bridge — an order addressed to this seat still stops it", async (t) => {
  const { fake, b } = await blind(t);
  await fake.control({ stop_order: { id: "ord-own", standing_id: seatId(fake, NKS, "proba") } });
  await until(() => saidKind(b, "stopped"), `the stop word:\n${b.stderr}`);
  await until(() => fake.state.orders.list.get("ord-own").state === "stopped", "the outcome");
});

test("an order the socket missed is read on hello and executed the same way", async (t) => {
  const { fake, b, id } = await standing(t);
  await fake.control({ stop_order: { id: "ord-7", standing_id: id, frame: false } });
  await fake.control({ stop_order: { id: "ord-x", standing_id: "another-session", frame: false } });
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 0, standings: [] }) });
  await until(() => saidKind(b, "stopped"), `the stop word:\n${b.stderr}`);
  await until(() => fake.state.orders.list.get("ord-7").state === "stopped", "the outcome");
  assert.equal(acks(fake, "ord-x").length, 0, "another session's order is not answered");
});
