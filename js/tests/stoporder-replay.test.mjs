// The outcome of a stop order until the api takes it (graph @nks/nks-dev, node #7510; review in
// case №669): a bridge's start answers the journal's untaken outcomes with no seat and no
// socket; a satellite's bridge ending with an order in flight waits for its outcome, bounded,
// and what it could not answer is answered by the next start; an untaken outcome outlives the
// journal's term, a taken one goes.
//
// ISKRON_BRIDGE_PATH aims the probe at any copy of the bridge.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { saidKind, setup, stand, textOf, until } from "./ownseat-kit.mjs";
import { NKS, orderOnDisk, seatId, standing, states } from "./stoporder-kit.mjs";

const CALLER = "host.repo.opus-5";
const DAY = 24 * 3600_000;

/** An order the fake holds accepted and the journal holds with `entry` (no frame). */
async function inJournal(fake, dir, id, entry) {
  await fake.control({ stop_order: { id, standing_id: "gone-seat", frame: false } });
  fake.state.orders.list.get(id).state = "accepted";
  mkdirSync(join(dir, "orders"), { recursive: true });
  const base = `${new URL(fake.mcpUrl).origin}/api`;
  const e = { id, standing: "gone-seat", base, acked: false, at: Date.now(), ...entry };
  writeFileSync(join(dir, "orders", `${id}.json`), JSON.stringify(e));
}

test("a bridge's start answers an untaken outcome — no seat, no socket", async (t) => {
  const { fake, dir, up } = await setup(t);
  await inJournal(fake, dir, "ord-a", { state: "stopped" });
  const b = await up();
  await until(() => states(fake, "ord-a").length, `the outcome:\n${b.stderr}`);
  assert.deepEqual(states(fake, "ord-a"), ["stopped"]);
  assert.equal(fake.state.ws.size, 0, "no socket was opened");
  await until(() => orderOnDisk(dir, "ord-a").acked, "taken on disk");
});

test("an untaken outcome past the journal's term is kept and answered; a taken one goes", async (t) => {
  const { fake, dir, b } = await standing(t);
  await inJournal(fake, dir, "ord-old", {
    state: "failed",
    reason: "stop_failed",
    at: Date.now() - 2 * DAY,
  });
  await inJournal(fake, dir, "ord-done", {
    state: "stopped",
    acked: true,
    at: Date.now() - 2 * DAY,
  });
  // The read starts past both: only the journal answers them.
  const base = `${new URL(fake.mcpUrl).origin}/api`;
  writeFileSync(join(dir, "orders", "since"), JSON.stringify({ [base]: fake.state.orders.seq }));
  await fake.control({ ws_send: JSON.stringify({ type: "hello", pending: 0, standings: [] }) });
  await until(() => states(fake, "ord-old").length, `the old outcome:\n${b.stderr}`);
  assert.deepEqual([...new Set(states(fake, "ord-old"))], ["failed"]);
  assert.ok(!existsSync(join(dir, "orders", "ord-done.json")), "a taken entry past its term goes");
});

async function satellite(t) {
  const env = await setup(t);
  await env.fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
  const b = await env.up(undefined, undefined, ["--satellite"]);
  const r = await stand(b, { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` });
  assert.ok(!r.result?.isError, textOf(r));
  const name = `${CALLER}.sub-1`;
  await until(() => seatId(env.fake, NKS, name), `the satellite's seat:\n${b.stderr}`);
  await until(() => env.fake.state.ws.size === 1, `the socket:\n${b.stderr}`);
  return { ...env, b, id: seatId(env.fake, NKS, name) };
}

test("a satellite's bridge ending with a slow accepted goes only after the outcome", async (t) => {
  process.env.ISKRON_BRIDGE_ORDER_WAIT_MS = "8000"; // the probe's load is not the bound's test
  t.after(() => delete process.env.ISKRON_BRIDGE_ORDER_WAIT_MS);
  const { fake, b, id } = await satellite(t);
  await fake.control({ orders_ack_delay: { accepted: 3000 } });
  await fake.control({ stop_order: { id: "ord-sat", standing_id: id } });
  await until(() => saidKind(b, "stopped"), `the stop word:\n${b.stderr}`);
  await b.stop(10_000); // the plugin ends the bridge while the order's handler still waits
  assert.deepEqual(states(fake, "ord-sat"), ["accepted", "stopped"], b.stderr);
});

test("a bridge that could not answer before its end leaves the outcome to the next start", async (t) => {
  process.env.ISKRON_BRIDGE_ORDER_WAIT_MS = "300";
  t.after(() => delete process.env.ISKRON_BRIDGE_ORDER_WAIT_MS);
  const { fake, dir, up, b, id } = await satellite(t);
  await fake.control({ orders_ack_delay: { accepted: 2500 } });
  await fake.control({ stop_order: { id: "ord-late", standing_id: id } });
  await until(() => saidKind(b, "stopped"), `the stop word:\n${b.stderr}`);
  await b.stop();
  assert.equal(orderOnDisk(dir, "ord-late").state, "stopped", "the outcome is on disk");
  await fake.control({ orders_ack_delay: {} });
  const next = await up();
  await until(() => states(fake, "ord-late").includes("stopped"), `the outcome:\n${next.stderr}`);
});
