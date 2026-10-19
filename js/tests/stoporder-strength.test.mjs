// The strength of a stop order's stopped (case №851): the outcome names which stop it was —
// halt_confirmed (the harness confirmed its stop), word_given (a harness without halts: the
// bridge gave the stop word and let the seat go), seat_beside (a seat beside went alone); the
// same code again from the journal, after a bridge change too. Every registration of a seat
// carries attrs.stop {effect, ack}: what a stop order for it does and how its stopped is known.
//
// ISKRON_BRIDGE_PATH aims the probe at any copy of the bridge.
import assert from "node:assert/strict";
import { test } from "node:test";

import { saidKind, setup, stand, textOf, until } from "./ownseat-kit.mjs";
import { NKS, orderOnDisk, pause, seatId, standing, states } from "./stoporder-kit.mjs";

process.env.ISKRON_ORDER_HALT_MS = "1500";
const HALTS = { experimental: { "iskron/halts": {} } };
const DRUGOY = "@nks/drugoy";
const allAcks = (fake, id) => fake.state.orders.acks.filter((a) => a.id === id);
// The acks the fake took: a dropped one keeps no body (fake-orders.mjs).
const stoppedCodes = (fake, id) =>
  allAcks(fake, id)
    .filter((a) => a.state === "stopped" && !a.dropped)
    .map((a) => a.reason_code);
const stoppedBy = (b, order) =>
  b.notifications.find((n) => n.params?.data?.kind === "stopped" && n.params.data.order === order);
const registered = (fake, realm, name) =>
  fake.state.calls
    .filter((c) => c.name === "iskron_channel")
    .map((c) => c.arguments)
    .filter(
      (a) =>
        ["connect", "mint", "register"].includes(a.action) &&
        a.name === name &&
        String(a.realm).endsWith(realm),
    );

test("a harness that confirms its stop: stopped is halt_confirmed, the same code from the journal", async (t) => {
  const { fake, dir, b, id } = await standing(t, "proba", HALTS);
  await fake.control({ orders_ack_drop: 2 }); // accepted and the first stopped are lost
  await fake.control({ stop_order: { id: "ord-hc", standing_id: id } });
  await until(() => stoppedBy(b, "ord-hc"), `the stop word naming the order:\n${b.stderr}`);
  await halted(b, "ord-hc");
  await until(
    () => fake.state.orders.list.get("ord-hc").state === "stopped",
    "the repeated outcome",
  );
  const lost = allAcks(fake, "ord-hc").filter((a) => a.dropped && a.state === "stopped");
  assert.ok(lost.length, `the first stopped was lost: ${JSON.stringify(allAcks(fake, "ord-hc"))}`);
  assert.deepEqual([...new Set(stoppedCodes(fake, "ord-hc"))], ["halt_confirmed"]);
  assert.equal(orderOnDisk(dir, "ord-hc").reason, "halt_confirmed");
});

test("a harness without halts: stopped is word_given, the same code on the second frame", async (t) => {
  const { fake, dir, b, id } = await standing(t);
  const frame = JSON.stringify({
    type: "stop",
    order_id: "ord-wg",
    standing_id: id,
    to_standing: "@tester:proba",
    to_standing_id: id,
  });
  fake.state.orders.list.set("ord-wg", { id: "ord-wg", standing_id: id, state: "issued" });
  await fake.control({ ws_send_many: [frame, frame] });
  await until(() => saidKind(b, "stopped"), "the stop word");
  await until(() => states(fake, "ord-wg").includes("stopped"), "the outcome");
  await pause(600);
  assert.deepEqual([...new Set(stoppedCodes(fake, "ord-wg"))], ["word_given"]);
  assert.equal(orderOnDisk(dir, "ord-wg").reason, "word_given");
});

test("an order for the seat beside: stopped is seat_beside", async (t) => {
  const { fake, b } = await standing(t);
  const r = await stand(b, { realm: DRUGOY, karta: 48, name: "proba-b" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(fake, DRUGOY, "proba-b"), "the seat beside");
  await fake.control({
    stop_order: { id: "ord-sb", standing_id: seatId(fake, DRUGOY, "proba-b") },
  });
  await until(() => fake.state.orders.list.get("ord-sb").state === "stopped", "the outcome");
  assert.deepEqual(states(fake, "ord-sb"), ["accepted", "stopped"]);
  assert.deepEqual(stoppedCodes(fake, "ord-sb"), ["seat_beside"]);
  assert.ok(!saidKind(b, "stopped"), "no stop of the agent");
});

test("an outcome left by a bridge that died: the next one answers the same code", async (t) => {
  const { fake, dir, b, id, up } = await standing(t);
  await fake.control({ orders_ack_drop: 1000 });
  await fake.control({ stop_order: { id: "ord-nx", standing_id: id } });
  await until(() => saidKind(b, "stopped"), "the stop word");
  await until(() => orderOnDisk(dir, "ord-nx").state === "stopped", "the outcome on disk");
  await b.stop();
  await fake.control({ orders_ack_drop: 0 });
  const next = await up();
  const r = await stand(next, { realm: "nks-dev", karta: 931, name: "proba-2" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => fake.state.orders.list.get("ord-nx").state === "stopped", "the outcome taken");
  assert.deepEqual([...new Set(stoppedCodes(fake, "ord-nx"))], ["word_given"]);
});

test("failed keeps the harness's code (unknown — stoporder-outcome.test.mjs)", async (t) => {
  const { fake, b, id } = await standing(t, "proba", HALTS);
  await fake.control({ stop_order: { id: "ord-fl", standing_id: id } });
  await until(() => stoppedBy(b, "ord-fl"), "the stop word naming the order");
  await b.call("iskron/halted", { order: "ord-fl", ok: false, code: "interrupt_refused" });
  await until(() => states(fake, "ord-fl").includes("failed"), "the outcome");
  assert.deepEqual(states(fake, "ord-fl"), ["accepted", "failed"]);
  assert.equal(allAcks(fake, "ord-fl").at(-1).reason_code, "interrupt_refused");
});

test("attrs.stop of the main seat without halts: agent, word — beside the rest of attrs", async (t) => {
  const { fake } = await standing(t);
  const regs = registered(fake, "nks-dev", "proba");
  assert.ok(regs.length, JSON.stringify(fake.state.calls));
  for (const a of regs) assert.deepEqual(a.attrs.stop, { effect: "agent", ack: "word" });
  const attrs = regs.at(-1).attrs;
  assert.ok(attrs.build?.name && attrs.skills && attrs.harness, JSON.stringify(attrs));
});

test("attrs.stop of the main seat with halts: agent, confirmed", async (t) => {
  const { fake } = await standing(t, "proba", HALTS);
  const regs = registered(fake, "nks-dev", "proba");
  assert.ok(regs.length);
  for (const a of regs) assert.deepEqual(a.attrs.stop, { effect: "agent", ack: "confirmed" });
});

test("attrs.stop of a seat beside: seat; the main seat stays agent on its next registration", async (t) => {
  const { fake, b } = await standing(t);
  const r = await stand(b, { realm: DRUGOY, karta: 48, name: "proba-b" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(fake, DRUGOY, "proba-b"), "the seat beside");
  const beside = registered(fake, "drugoy", "proba-b");
  assert.ok(beside.length, JSON.stringify(fake.state.calls));
  for (const a of beside) assert.deepEqual(a.attrs.stop, { effect: "seat", ack: "word" });
  assert.ok(beside.at(-1).attrs.build, "the rest of attrs stays");
  // The main seat registered again (stand on it once more): the field stays, still agent.
  const before = registered(fake, "nks-dev", "proba").length;
  const again = await stand(b, { realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!again.result?.isError, textOf(again));
  const main = registered(fake, "nks-dev", "proba");
  assert.ok(main.length > before, `the main seat registered again: ${textOf(again)}`);
  assert.deepEqual(main.at(-1).attrs.stop, { effect: "agent", ack: "word" });
  assert.ok(main.at(-1).attrs.build, "the rest of attrs stays");
});

async function halted(b, order) {
  const r = await b.call("iskron/halted", { order, ok: true });
  assert.equal(r.result?.taken, true, JSON.stringify(r));
}

test("attrs.stop of a satellite: its own seat agent, its seat of another graph seat", async (t) => {
  const { fake, dir, up } = await setup(t);
  const CALLER = "host.repo.opus-5";
  await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
  const s = await up(dir, undefined, ["--satellite"]);
  const own = await stand(s, { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` });
  assert.ok(!own.result?.isError, `${textOf(own)}\n${s.stderr}`);
  const name = `${CALLER}.sub-1`;
  await until(() => seatId(fake, NKS, name), "the satellite's seat");
  assert.deepEqual(registered(fake, "nks-dev", name).at(-1).attrs.stop, {
    effect: "agent",
    ack: "word",
  });
  const other = await stand(s, { realm: DRUGOY, karta: 48, satellite_of: `@tester:${CALLER}` });
  assert.ok(!other.result?.isError, `${textOf(other)}\n${s.stderr}`);
  await until(() => registered(fake, "drugoy", name).length, `the seat beside:\n${s.stderr}`);
  for (const a of registered(fake, "drugoy", name))
    assert.deepEqual(a.attrs.stop, { effect: "seat", ack: "word" });
});

// A connect opens the channel it takes and becomes the main seat: it is "agent" even after a
// register in another graph left a binding without a held channel (review of the EN candidate).
test("attrs.stop of a connect after a bare register in another graph: agent", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const channel = (args) => b.call("tools/call", { name: "iskron_channel", arguments: args });
  const reg = await channel({ action: "register", realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(registered(fake, "nks-dev", "proba").length, JSON.stringify(reg));
  await channel({ action: "connect", realm: DRUGOY, karta: 48, name: "proba-c" });
  const conn = registered(fake, "drugoy", "proba-c").filter((a) => a.action === "connect");
  assert.ok(conn.length, JSON.stringify(fake.state.calls.map((c) => c.arguments?.action)));
  assert.deepEqual(conn.at(-1).attrs.stop, { effect: "agent", ack: "word" });
});

// attrs.stop is what the stop itself will do with that seat (stophold.ts seatOf by the id
// noteStandingId put on a door): told and done are checked on the same seat.
test("attrs.stop of the agent's own register of a seat beside: seat, and its stop is seat_beside", async (t) => {
  const { fake, b } = await standing(t);
  const r = await stand(b, { realm: DRUGOY, karta: 48, name: "proba-b" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(fake, DRUGOY, "proba-b"), "the seat beside");
  const before = registered(fake, "drugoy", "proba-b").length;
  const reg = await b.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "register", realm: DRUGOY, karta: 48, name: "proba-b" },
  });
  assert.ok(!reg.result?.isError, textOf(reg));
  const own = registered(fake, "drugoy", "proba-b");
  assert.ok(own.length > before, JSON.stringify(own));
  assert.deepEqual(own.at(-1).attrs.stop, { effect: "seat", ack: "word" });
  await fake.control({
    stop_order: { id: "ord-ob", standing_id: seatId(fake, DRUGOY, "proba-b") },
  });
  await until(() => fake.state.orders.list.get("ord-ob").state === "stopped", "the outcome");
  assert.deepEqual(stoppedCodes(fake, "ord-ob"), ["seat_beside"]);
  assert.ok(!saidKind(b, "stopped"), "no stop of the agent");
});

test("attrs.stop of a bare register without a held channel: no field, and its stop is not stopped", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const reg = await b.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "register", realm: "nks-dev", karta: 931, name: "proba" },
  });
  assert.ok(!reg.result?.isError, textOf(reg));
  const regs = registered(fake, "nks-dev", "proba");
  assert.ok(regs.length, JSON.stringify(fake.state.calls));
  assert.ok(!("stop" in (regs.at(-1).attrs ?? {})), JSON.stringify(regs.at(-1).attrs));
  const id = seatId(fake, NKS, "proba");
  assert.ok(id, "the seat has an id at the platform");
  // An order comes by the channel's socket only (its frame, or the open orders read on hello):
  // with no channel held it never reaches this bridge — no answer at all, the agent goes on.
  await fake.control({ stop_order: { id: "ord-bare", standing_id: id } });
  await pause(2500);
  assert.deepEqual(allAcks(fake, "ord-bare"), []);
  assert.equal(fake.state.orders.list.get("ord-bare").state, "issued");
  assert.ok(!saidKind(b, "stopped"), "no stop of the agent");
});

// A bare register in another graph than a bare main binding: no channel, so no seat beside is
// added (hold.ts addPlace) — the stop finds no seat, nothing is claimed (review of 6c1e2ba2).
test("attrs.stop of a bare register in another graph after a bare one: no field, its stop is not stopped", async (t) => {
  const { fake, up } = await setup(t);
  const b = await up();
  const channel = (args) => b.call("tools/call", { name: "iskron_channel", arguments: args });
  const first = await channel({ action: "register", realm: "nks-dev", karta: 931, name: "proba" });
  assert.ok(!first.result?.isError, textOf(first));
  const reg = await channel({ action: "register", realm: DRUGOY, karta: 48, name: "proba-d" });
  assert.ok(!reg.result?.isError, textOf(reg));
  const regs = registered(fake, "drugoy", "proba-d");
  assert.ok(regs.length, JSON.stringify(fake.state.calls));
  assert.ok(!("stop" in (regs.at(-1).attrs ?? {})), JSON.stringify(regs.at(-1).attrs));
  const id = seatId(fake, DRUGOY, "proba-d");
  assert.ok(id, "the seat has an id at the platform");
  await fake.control({ stop_order: { id: "ord-bare-b", standing_id: id } });
  await pause(2500);
  assert.deepEqual(allAcks(fake, "ord-bare-b"), []);
  assert.equal(fake.state.orders.list.get("ord-bare-b").state, "issued");
  assert.ok(!saidKind(b, "stopped"), "no stop of the agent");
});

// The window of a socket reopen (shared/channel.ts: a drop reopens in 2–60 s, alive is false
// meanwhile): holder, door, key and the seats beside stay, and the stop finds them after the
// reopen. attrs are replaced whole: a register in that window that left the field out erased it.
const registers = (fake) =>
  fake.state.calls.filter((c) => c.name === "iskron_channel" && c.arguments?.action === "register");

// A call into a held seat's graph waits for the reopen's hello (deaf.ts), but the replay of the
// seats on a turned session goes before it (standing.ts ensureStanding): the drop and the
// session's end together put that register into the window.
async function replayInReopenWindow(fake, b, name) {
  const n = registers(fake).length;
  await fake.control({ ws_close: 1012, kill_session: true });
  await until(() => fake.state.ws.size === 0, "the socket dropped");
  // The fake clears «listening» on a close only for the socket's own place name; a seat beside
  // listens by the same channel socket (its register: listening — if the channel's socket is
  // open), so its board line follows the close too, or replayBeside takes it for another
  // session's seat (deaf.ts) and does not register it.
  for (const pl of fake.state.places.values()) pl.listening = false;
  const call = b.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "list", realm: "nks-dev" },
  });
  const replayed = () =>
    registers(fake)
      .slice(n)
      .find((c) => c.arguments.name === name);
  await until(replayed, `the replayed register of ${name}:\n${b.stderr}`);
  assert.equal(fake.state.ws.size, 0, "the register went in the window, before the reopen");
  await call;
  await until(() => fake.state.ws.size === 1, "the socket reopened");
  await pause(500); // the reopen's hello
  return replayed().arguments;
}

test("attrs.stop of the main seat registered while its socket reopens: agent, and its stop stops the agent", async (t) => {
  const { fake, b, id } = await standing(t);
  const args = await replayInReopenWindow(fake, b, "proba");
  assert.deepEqual(args.attrs.stop, { effect: "agent", ack: "word" });
  await fake.control({ stop_order: { id: "ord-rw", standing_id: id } });
  await until(() => states(fake, "ord-rw").includes("stopped"), `the outcome:\n${b.stderr}`);
  assert.deepEqual([...new Set(stoppedCodes(fake, "ord-rw"))], ["word_given"]);
  assert.ok(saidKind(b, "stopped"), "the agent is stopped");
});

test("attrs.stop of a seat beside registered while the socket reopens: seat, and its stop is seat_beside", async (t) => {
  const { fake, b } = await standing(t);
  const r = await stand(b, { realm: DRUGOY, karta: 48, name: "proba-b" });
  assert.ok(!r.result?.isError, textOf(r));
  await until(() => seatId(fake, DRUGOY, "proba-b"), "the seat beside");
  const args = await replayInReopenWindow(fake, b, "proba-b");
  assert.deepEqual(args.attrs.stop, { effect: "seat", ack: "word" });
  await fake.control({
    stop_order: { id: "ord-rb", standing_id: seatId(fake, DRUGOY, "proba-b") },
  });
  await until(() => fake.state.orders.list.get("ord-rb").state === "stopped", "the outcome");
  assert.deepEqual(stoppedCodes(fake, "ord-rb"), ["seat_beside"]);
  assert.ok(!saidKind(b, "stopped"), "no stop of the agent");
});

// A graph with no seat of this session does not wait for the hello: the agent's own register
// goes in the window, and addPlace adds no seat beside on a socket that is not alive.
test("attrs.stop of a new seat of another graph registered while the socket reopens: no field, its stop is not stopped", async (t) => {
  const { fake, b } = await standing(t);
  await fake.control({ ws_close: 1012 });
  await until(() => fake.state.ws.size === 0, "the socket dropped");
  const reg = await b.call("tools/call", {
    name: "iskron_channel",
    arguments: { action: "register", realm: DRUGOY, karta: 48, name: "proba-n" },
  });
  assert.ok(!reg.result?.isError, textOf(reg));
  assert.equal(fake.state.ws.size, 0, "the register went in the window, before the reopen");
  const regs = registered(fake, "drugoy", "proba-n");
  assert.ok(regs.length, JSON.stringify(fake.state.calls));
  assert.ok(!("stop" in (regs.at(-1).attrs ?? {})), JSON.stringify(regs.at(-1).attrs));
  await until(() => fake.state.ws.size === 1, "the socket reopened");
  await pause(500); // the reopen's hello
  const id = seatId(fake, DRUGOY, "proba-n");
  assert.ok(id, "the seat has an id at the platform");
  await fake.control({ stop_order: { id: "ord-rn", standing_id: id } });
  await until(() => states(fake, "ord-rn").length, "the bridge's answer");
  await pause(500);
  assert.deepEqual(states(fake, "ord-rn"), ["refused"]);
  assert.deepEqual(
    allAcks(fake, "ord-rn").map((a) => a.reason_code),
    ["seat_not_held"],
  );
  assert.ok(!saidKind(b, "stopped"), "no stop of the agent");
});
