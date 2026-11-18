// Foreign stops and a re-read of the run's own stop on the same orders page.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { invite, leadingDsh, ROOM } from "./dsh-kit.mjs";

process.env.NODE_OPTIONS = `--require ${join(dirname(fileURLToPath(import.meta.url)), "fast-clock.cjs")}`;
process.env.FAST_CLOCK = "10";
const SEAT = "11111111-1111-4111-8111-111111111111";
const KARTA = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const entry = (id, kind, extra = {}) => ({
  id,
  kind,
  to_standing_id: null,
  to_karta_node_id: null,
  in_reply_to: null,
  author_standing_id: LEAD,
  author: "@tester:lead",
  payload: {},
  ...extra,
});

async function check(t, state, own, phase = "dormant") {
  if (process.env.ISKRON_NODE) return t.skip("the accelerated clock requires NODE_OPTIONS");
  const first = entry(31, "invite", { to_karta_node_id: KARTA });
  const o = await leadingDsh(t, {
    env: { FAKE_DSH_HOLD_MS: phase === "live" || phase === "continuation" ? "10000" : "1000" },
    caseRoom: { status: "open", entries: [first] },
  });
  const base = readFileSync(join(o.dir, "server"), "utf8").trim().replace(/\/mcp$/, "");
  if (phase === "live-exited")
    await fetch(`${base}/control`, {
      method: "POST",
      body: JSON.stringify({ orders_stop_answer: { status: 201, body: { id: "ord-own" } } }),
    });
  await o.queue([invite(31)]);
  assert.match((await o.step()).out, /invite 31: launched/);
  await o.queue([], [{ cursor: "s-31", spawned_for: { invite: 31, room: ROOM }, standing: SEAT }]);
  await o.step();
  if (phase.startsWith("continuation")) {
    await o.until(31, (r) => r.state === "dormant", 30_000);
    if (phase === "continuation-exited")
      await fetch(`${base}/control`, {
        method: "POST",
        body: JSON.stringify({ orders_stop_answer: { status: 201, body: { id: "ord-own" } } }),
      });
    await o.room("open", [first, entry(32, "said", { to_standing_id: SEAT })]);
    assert.match((await o.step()).out, /dormant_woken_32.*launched/);
  }
  const before = await o.until(
    31,
    (r) =>
      phase === "dormant"
        ? r.state === "dormant"
        : phase.endsWith("-exited")
          ? r.state === "stopping" && !!r.tree?.exit
          : phase === "continuation"
            ? r.state === "launched"
            : r.state === "raised",
    30_000,
  );
  if (phase === "dormant" || phase.endsWith("-exited"))
    assert.ok(before.tree.exit, "the process exit was observed");
  else assert.equal(before.tree.exit, undefined, "the live process has not exited");

  // The fake has no seat to accept our exit stop; seed the known own id on the persisted run,
  // then let its orders API serve that id and the foreign one on the same page.
  const registry = join(o.dir, "run", "orchestra-runs.json");
  const data = JSON.parse(readFileSync(registry, "utf8"));
  const row = Object.values(data.runs).find((r) => r.invite === 31);
  if (own) row.orders = [...(row.orders ?? []), "ord-own"];
  writeFileSync(registry, JSON.stringify(data));
  await fetch(`${base}/control`, {
    method: "POST",
    body: JSON.stringify({
      stop_orders: [
        ...(own
          ? [{ id: "ord-own", standing_id: SEAT, realm: "@nks/nks-dev", frame: false }]
          : []),
        { id: "ord-foreign", standing_id: SEAT, realm: "@nks/nks-dev", frame: false },
      ],
    }),
  });
  if (state === "stopped") {
    const ack = await fetch(`${base}/api/me/orders/ord-foreign/ack`, {
      method: "POST",
      headers: {
        authorization: "Bearer probe-pat",
        "content-type": "application/json",
        "user-agent": "probe",
      },
      body: JSON.stringify({ state: "stopped" }),
    });
    assert.ok(ack.ok, `foreign stop ack: ${ack.status}`);
  }
  await o.room("open", [first, entry(33, "said", { to_standing_id: SEAT })]);
  const calls = o.dshCalls().length;
  await o.step();
  if (phase !== "dormant" && state === "issued") {
    const ack = await fetch(`${base}/api/me/orders/ord-foreign/ack`, {
      method: "POST",
      headers: {
        authorization: "Bearer probe-pat",
        "content-type": "application/json",
        "user-agent": "probe",
      },
      body: JSON.stringify({ state: "stopped" }),
    });
    assert.ok(ack.ok);
  }
  for (let i = 0; i < 20 && o.run(31)?.state !== "ended"; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await o.step();
  }
  const ended = await o.until(31, (r) => r.state === "ended");
  assert.equal(o.dshCalls().length, calls, "no continuation after the foreign stop was read");
  assert.equal(ended.foreign_stop?.id, "ord-foreign");
  assert.equal(ended.foreign_stop?.state, state);
}

for (const state of ["issued", "stopped"])
  for (const own of [true, false])
    test(`foreign ${state} × dormant × exit observed × own order ${own}`, (t) =>
      check(t, state, own),
    );

for (const state of ["issued", "stopped"])
  for (const own of [true, false])
    test(`foreign ${state} × live × exit unobserved × own order ${own}`, (t) =>
      check(t, state, own, "live"),
    );

for (const state of ["issued", "stopped"])
  for (const own of [true, false])
    test(`foreign ${state} × live × exit observed × own order ${own}`, (t) =>
      check(t, state, own, "live-exited"),
    );

for (const state of ["issued", "stopped"])
  for (const own of [true, false])
    for (const observed of [false, true])
      test(`foreign ${state} × continuation × exit ${observed ? "observed" : "unobserved"} × own order ${own}`, (t) =>
        check(t, state, own, observed ? "continuation-exited" : "continuation"),
      );

for (const state of ["issued", "stopped"])
  for (const own of [true, false])
    test(
      `foreign ${state} × dormant × exit unobserved × own order ${own}`,
      { skip: "dormancy requires the observed clean dsh exit" },
      () => {},
    );
