// Behavioural probes of the orchestrator's quench, stops and reap (bridge/orchestra-quench.ts,
// orchestra-foreign.ts, orchestra-reap.ts, orchestra-run-ends.ts — graph @nks/nks-dev, nodes
// #7513, #5042, #7517, #7518, #8203; decisions of case №4050): a real daemon against the fake NKS
// and a substitute `orca` on the daemon's PATH (orchestra-raise-kit.mjs).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  BRIDGE,
  cli,
  describe,
  GIVE_UP,
  GOOD,
  idleSignal,
  invite,
  leading,
  NODE,
  REALM,
  REPO,
  ROOM,
  runUntil,
  signal,
  waitEnded,
} from "./orchestra-raise-kit.mjs";

test("quench: an empty composition alone and idle_warned stop nothing — the moment is idle_due's", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  // Its case closed: the composition is empty, but the platform has not called it idle yet.
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, [])]);
  const empty = await o.step();
  assert.equal(empty.code, 0, empty.err);
  await o.step();
  assert.equal(o.fake.state.orders.human.length, 0, "an empty composition alone is no end");
  // Two wakes empty: the seat is told to leave — still not the orchestrator's moment.
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_warned")]);
  const warned = await o.step();
  assert.equal(warned.code, 0, warned.err);
  assert.equal(o.fake.state.orders.human.length, 0, "idle_warned is no end");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
});

test("quench: our seat's idle_due after it sat gets one composition_empty stop order", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  // The seat registered with our spawned_for and sat in the case: raised, not to be stopped.
  await o.queue([], [signal(1, 9, [ROOM])]);
  const sat = await o.step();
  assert.equal(sat.code, 0, sat.err);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
  assert.equal(o.fake.state.orders.human.length, 0, "a seat in a case is not stopped");
  // Its case closed and the platform found it idle: the stop order goes out with the reason.
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_due")]);
  const empty = await o.step();
  assert.equal(empty.code, 0, empty.err);
  const stops = o.fake.state.orders.human.filter((h) => h.method === "POST");
  assert.equal(stops.length, 1, JSON.stringify(o.fake.state.orders.human));
  assert.equal(stops[0].id, "seat-raised");
  assert.equal(stops[0].realm, REALM);
  assert.equal(stops[0].body.reason_code, "composition_empty");
  assert.match(stops[0].body.client_id, /^orchestra-[0-9a-f]{32}$/);
  // The order carries the idle_due's n: the server lays it only if no newer signal came (#7518).
  assert.equal(stops[0].body.if_signal_n, 3);
  // The fake knows no such live seat (410): reap the exact client, not the slot by assumption.
  assert.match(empty.out, /invite 9: seat_gone/, empty.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
  assert.deepEqual(o.closes(), [["terminal", "close", "--terminal", "term_fake", "--json"]]);
  assert.ok(o.runs()[`${REALM}|${ROOM}|9`].tree.exit, "the exact client's exit was observed");
  await o.step();
  assert.equal(o.closes().length, 1, "the observed client is not closed twice");
});

test("quench: a membership landing after the read cancels the end — the re-check reads the tape again", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orchestra: {
      realms: {
        [REALM]: {
          invites: [],
          signals: [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_due")],
          late: [signal(4, 9, [ROOM])],
        },
      },
    },
  });
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: composition_changed/, r.out);
  assert.equal(o.fake.state.orders.human.length, 0, "no stop order on a fresh membership");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
});

test("quench: a joined after idle_due cancels it even when the composition empties again", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orchestra: {
      realms: {
        [REALM]: {
          invites: [],
          signals: [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_due")],
          // The seat entered another case and left it: the count restarted, no idle_due stands.
          late: [signal(4, 9, [ROOM]), signal(5, 9, [])],
        },
      },
    },
  });
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: composition_changed/, r.out);
  await o.step();
  assert.equal(o.fake.state.orders.human.length, 0, "the idle_due before the joined is spent");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
});

test("quench: a composition_changed refusal of the order leaves the agent alive, unrepeated", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orders_stop_answer: { status: 409, body: { error: "composition_changed" } },
  });
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_due")]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: composition_changed/, r.out);
  await o.step();
  const stops = o.fake.state.orders.human.filter((h) => h.method === "POST");
  assert.equal(stops.length, 1, "one order, not repeated after the refusal");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
});

test("quench: a composition_changed refusal of a never-sat seat past the window is not re-sent unfenced", async (t) => {
  const o = await leading(t, {
    env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500", FAKE_ORCA_WAIT_EXIT: "0" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await new Promise((done) => setTimeout(done, 6_000));
  await o.fake.control({
    orders_stop_answer: { status: 409, body: { error: "composition_changed" } },
  });
  await o.queue([], [signal(1, 9, []), idleSignal(2, 9, "idle_due")]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: composition_changed/, r.out);
  await o.step();
  const stops = o.fake.state.orders.human.filter((h) => h.method === "POST");
  // The platform saw a live composition: no second order, least of all one without if_signal_n.
  assert.equal(stops.length, 1, JSON.stringify(stops.map((s) => s.body)));
  assert.equal(stops[0].body.if_signal_n, 2);
});

test("quench: the caller gone during the re-check — no stop order after it (#8202)", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orchestra: {
      realms: {
        [REALM]: {
          invites: [],
          signals: [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_due")],
          // The tact's read answers; the re-check is held until released — past the client's ceiling.
          raised_holds: [false, true],
        },
      },
    },
  });
  const r = await cli(o.dir, ["step"], GIVE_UP);
  assert.notEqual(r.code, 0, "the client gave up inside its ceiling — a refusal");
  assert.equal(o.fake.state.raisedHeld, 1, "the re-check was on hold when the client left");
  // The daemon has served a later ask: the closed socket of the gone caller is seen by now.
  assert.equal((await cli(o.dir, ["status"])).code, 0);
  // The held re-check answers with the tape unchanged — the end still stands; then the tape is
  // shut, so the next step, queued behind the gone tact, orders nothing of its own.
  await o.fake.control({ raised_release: true });
  await o.fake.control({ orchestra: { realms: { [REALM]: { refuse: 503 } } } });
  await o.step();
  assert.equal(o.fake.state.orders.human.length, 0, "no stop order after the caller left");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
});

test("quench: a raised seat that never joined within the window is a failed launch — stopped (#9970)", async (t) => {
  const o = await leading(t, {
    env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500", FAKE_ORCA_WAIT_EXIT: "0" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  // Cross the independent client's exit-observer tick as well as the join window.
  await new Promise((done) => setTimeout(done, 6_000));
  const run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.tree?.exit, undefined, `no_join needs a live client: ${JSON.stringify(run)}`);
  await o.queue([], [signal(1, 9, [])]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: no_join/, `${r.out}\n${JSON.stringify(o.runs())}`);
  const stops = o.fake.state.orders.human.filter((h) => h.method === "POST");
  assert.equal(stops.length, 1, JSON.stringify(o.fake.state.orders.human));
  assert.equal(stops[0].id, "seat-raised");
  assert.equal(stops[0].body.reason_code, "composition_empty");
  assert.ok(
    o.terminals().some((a) => a[1] === "wait"),
    "the independent exit observer ran",
  );
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].tree?.exit, undefined, "no fabricated client exit");
});

/** Our seat sat and went idle (idle_due); the stop answers `answer`, an open order lies. */
async function stopping(t, answer, order, env = {}) {
  const o = await leading(t, { env });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({ orders_stop_answer: answer });
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_due")]);
  const r = await o.step();
  assert.match(r.out, /invite 9: stop_ordered(?!_elsewhere)/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  // The order our stop put, as the account's orders read it from now on.
  await o.fake.control({
    stop_order: { id: order, standing_id: "seat-raised", realm: REALM, frame: false },
  });
  return o;
}

test("quench: a stop answered without an id ends when no open order is left for the seat", async (t) => {
  const o = await stopping(t, { status: 201, body: {} }, "ord-x");
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", "its order is still open");
  const closed = await fetch(`${o.fake.base}/api/me/orders/ord-x/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state: "stopped" }),
  });
  assert.equal(closed.status, 200);
  await o.step();
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
});

/** The agent's bridge answers the order with `state`, as it closes it. */
const ack = (o, order, state) =>
  fetch(`${o.fake.base}/api/me/orders/${order}/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state }),
  });

// A closed order that did not carry the stop out (#7522, #11099): the agent's bridge will not
// close it, so the daemon closes its own tab by the exact proof; a close whose exit is not seen
// is tried again a bounded number of tacts, then said exhausted — the run stays stopping with
// its runtime and tree.
test("quench: a failed stop's tab is closed by the daemon; an exit never seen is tried, then exhausted", async (t) => {
  // The terminal is never seen to exit, even after the close.
  const o = await stopping(t, { status: 201, body: { id: "ord-f" } }, "ord-f", {
    FAKE_ORCA_WAIT_EXIT: "0",
  });
  assert.equal((await ack(o, "ord-f", "failed")).status, 200);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", r.out);
  assert.match(r.out, /invite 9: stop_failed, client_exit_unconfirmed/, r.out);
  assert.equal(o.closes().length, 1, "the daemon closed its own tab");
  await o.step();
  const third = await o.step();
  assert.match(third.out, /stop_failed, reap_exhausted \(client_exit_unconfirmed\)/, third.out);
  await o.step();
  assert.equal(o.closes().length, 3, "tried three tacts, not more");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.notEqual(o.runs()[`${REALM}|${ROOM}|9`].tree.state, "removed");
});

const exitStops = (o) =>
  o.fake.state.orders.human.filter(
    (h) => h.method === "POST" && h.body?.reason_code === "client_exited",
  );

// #11099, #9256 (а): the agent's bridge let its order expire — the daemon closes its own
// terminal through Orca by the exact-client proof. The closed client alone ends nothing: the
// expired order is replaced once by a stop for the exit, and only its confirmation ends the run.
test("reap: an expired stop's terminal closed by the daemon ends the run only with a confirmed exit stop", async (t) => {
  const o = await stopping(t, { status: 201, body: { id: "ord-e" } }, "ord-e", {
    FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
  });
  await o.fake.control({ orders_stop_answer: { status: 201, body: { id: "ord-x" } } });
  assert.equal((await ack(o, "ord-e", "expired")).status, 200);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_expired, client_exited/, r.out);
  assert.deepEqual(o.closes(), [["terminal", "close", "--terminal", "term_fake", "--json"]]);
  // The stop for the exit goes out unconfirmed: the run stays observed, its tree intact.
  await runUntil(o, () => exitStops(o).length === 1, "the exit stop");
  await o.step();
  const run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.closed, "client_exited");
  assert.notEqual(run.state, "ended", "a closed client without a confirmed stop is no end");
  assert.equal(run.tree.state, "ready");
  await o.fake.control({
    stop_order: { id: "ord-x", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  assert.equal((await ack(o, "ord-x", "stopped")).status, 200);
  await o.step();
  assert.equal((await waitEnded(o)).closed, "client_exited");
  assert.equal(exitStops(o).length, 1, "one stop for the exit");
  assert.equal(o.closes().length, 1, "closed once");
});

// #11099: a tree kept for what it holds is said by status with its path; its client is gone.
test("reap: status names a retained tree with its path once its client exited", async (t) => {
  const o = await stopping(t, { status: 201, body: { id: "ord-d" } }, "ord-d", {
    FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
  });
  const path = o.runs()[`${REALM}|${ROOM}|9`].worktree;
  writeFileSync(join(path, "unsaved.txt"), "work\n");
  // The seat is over at the stop for the exit (410): the run ends, its dirty tree stays.
  await o.fake.control({ orders_stop_answer: { status: 410, body: {} } });
  assert.equal((await ack(o, "ord-d", "expired")).status, 200);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  const run = await runUntil(o, (x) => x.tree?.state === "retained", "the retained tree");
  assert.equal(run.state, "ended", r.out);
  assert.equal(existsSync(join(path, "unsaved.txt")), true, "the unsaved work stays");
  const status = await cli(o.dir, ["status"]);
  assert.match(status.out, new RegExp(`invite 9: tree_dirty_retained: ${path}, client_exited`));
});

// #11099: Orca unreachable at the close is a transient refusal — the next tact tries again, and
// the recovered one closes the terminal; a refusal that lasts ends in a named exhaustion.
test("reap: a transient Orca refusal is tried again and the recovered tact closes the terminal", async (t) => {
  const down = join(tmpdir(), `iskron-down-${process.pid}-${Date.now()}`);
  t.after(() => rmSync(down, { force: true }));
  const o = await stopping(t, { status: 201, body: { id: "ord-t" } }, "ord-t", {
    FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
    FAKE_ORCA_SHOW_FAIL_FILE: down,
  });
  writeFileSync(down, "");
  assert.equal((await ack(o, "ord-t", "expired")).status, 200);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_expired, terminal_binding_unconfirmed/, r.out);
  assert.equal(o.closes().length, 0);
  rmSync(down);
  const back = await o.step();
  assert.equal(back.code, 0, back.err + back.out);
  assert.match(back.out, /invite 9: stop_expired, client_exited/, back.out);
  assert.equal(o.closes().length, 1);
});

test("reap: a lasting Orca refusal is tried a bounded number of times, then named exhausted", async (t) => {
  const down = join(tmpdir(), `iskron-down-${process.pid}-${Date.now()}`);
  t.after(() => rmSync(down, { force: true }));
  const o = await stopping(t, { status: 201, body: { id: "ord-l" } }, "ord-l", {
    FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
    FAKE_ORCA_SHOW_FAIL_FILE: down,
  });
  writeFileSync(down, "");
  assert.equal((await ack(o, "ord-l", "expired")).status, 200);
  const outs = [];
  for (let i = 0; i < 4; i++) outs.push((await o.step()).out);
  assert.match(outs[0], /stop_expired, terminal_binding_unconfirmed/, outs[0]);
  assert.match(outs[2], /stop_expired, reap_exhausted \(terminal_binding_unconfirmed\)/, outs[2]);
  assert.doesNotMatch(outs[3], /stop_expired/, "exhausted — no more tries");
  rmSync(down);
  assert.doesNotMatch((await o.step()).out, /stop_expired/);
  assert.equal(o.closes().length, 0);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].reaped, "reap_exhausted");
});

// #11099 (б): the tab now holds another client — the proof of ours fails, nothing is touched.
test("reap: a terminal whose client is not ours is left untouched, the refusal said", async (t) => {
  const other = join(tmpdir(), `iskron-other-${process.pid}-${Date.now()}`);
  t.after(() => rmSync(other, { force: true }));
  const o = await stopping(t, { status: 201, body: { id: "ord-o" } }, "ord-o", {
    FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
    FAKE_ORCA_SHOW_INCARNATION_FILE: other,
  });
  writeFileSync(other, "inc_other");
  assert.equal((await ack(o, "ord-o", "expired")).status, 200);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_expired, terminal_binding_changed/, r.out);
  await o.step();
  assert.equal(o.closes().length, 0, "another client's terminal is never closed");
  const run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.state, "stopping");
  assert.equal(run.tree.state, "ready");
});

/** A thin bridge of this daemon started inside the Orca terminal `handle` — as OpenCode's own
 * bridge inherits the terminal's environment; `seat` — the place it stands, none if absent. */
async function terminalBridge(o, handle, seat) {
  const proc = spawn(NODE, [BRIDGE, `${o.fake.base}/mcp`, "--no-browser", "--auth-dir", o.dir], {
    env: {
      ...process.env,
      ISKRON_BRIDGE_NO_BROWSER: "1",
      ISKRON_BRIDGE_NO_UPDATE: "1",
      ISKRON_BRIDGE_TOKEN: "probe-pat",
      ORCA_TERMINAL_HANDLE: handle,
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const exited = new Promise((r) => proc.once("exit", r));
  const stop = () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.stdin.end();
    return exited;
  };
  // Before the daemon is killed: a thin bridge that loses its daemon raises another one into
  // the same run/ (thin.ts), and the fixture's removal races it.
  o.beforeCleanup.push(() => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    return exited;
  });
  const waiters = new Map();
  let out = "";
  proc.stdout.on("data", (c) => {
    out += c;
    for (let nl; (nl = out.indexOf("\n")) >= 0;) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (line) waiters.get(JSON.parse(line).id)?.(JSON.parse(line));
    }
  });
  let id = 0;
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      waiters.set(n, resolve);
      setTimeout(() => reject(new Error(`no answer for ${method}`)), 20_000).unref();
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  const init = await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "reap-probe", version: "0" },
  });
  assert.ok(init.result, JSON.stringify(init));
  if (seat) {
    const r = await call("tools/call", {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, name: seat },
    });
    assert.ok(r.result && !r.result.isError, JSON.stringify(r));
  }
  return { stop };
}

// 8.14.1 on 16-m3: the call's seat was over, but the same OpenCode process in that terminal
// had stood another place through this daemon — the expired order's reap killed a live agent.
// The client holds a live seat: the terminal stays, the reason named, no try counted; once the
// seat is gone the next tact closes it as before.
test("reap: a terminal whose client holds a live seat through the daemon is not closed until it leaves", async (t) => {
  const o = await stopping(t, { status: 201, body: { id: "ord-h" } }, "ord-h", {
    FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
  });
  const agent = await terminalBridge(o, "term_fake", "16-m3.infra.opus-5-5");
  assert.equal((await ack(o, "ord-h", "expired")).status, 200);
  for (let i = 0; i < 4; i++) {
    const r = await o.step();
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, /invite 9: stop_expired, client_holds_seat 16-m3\.infra\.opus-5-5/, r.out);
  }
  assert.equal(o.closes().length, 0, "a live agent's terminal is never closed");
  let run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.state, "stopping");
  assert.equal(run.reaped, undefined, "no reap_exhausted");
  assert.equal(run.reap_tries, undefined, "no try counted");
  await agent.stop();
  for (let i = 0; i < 100 && !o.closes().length; i++) {
    const r = await o.step();
    assert.equal(r.code, 0, r.err + r.out);
    if (!/client_holds_seat/.test(r.out)) break;
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.deepEqual(o.closes(), [["terminal", "close", "--terminal", "term_fake", "--json"]]);
  run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.closed, "client_exited");
});

/** A `ps` before the real one on the daemon's PATH whose `ps eww` refuses while the returned
 * file stands — the environment of a seat holder not read. */
function psRefusing(o) {
  const down = join(o.dir, "ps-down");
  writeFileSync(
    join(o.dir, "bin", "ps"),
    `#!/bin/sh\nif [ "$1" = eww ] && [ -e "${down}" ]; then exit 1; fi\nexec /bin/ps "$@"\n`,
    { mode: 0o755 },
  );
  writeFileSync(down, "");
  return down;
}

// Closed by default (#11208): the live seat holder's environment not read is no "not here" —
// every path keeps the terminal, the refusal named, no try counted; read again, the ordinary
// fork returns. Linux reads /proc, not ps: the substitute has nothing to refuse there.
const psOnly = { skip: process.platform === "linux" && "the reader is /proc on Linux" };
test(
  "reap: a seat holder whose environment is not read keeps the terminal until it is read",
  psOnly,
  async (t) => {
    const o = await stopping(t, { status: 201, body: { id: "ord-u" } }, "ord-u", {
      FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
    });
    const agent = await terminalBridge(o, "term_fake", "16-m3.infra.opus-5-5");
    const down = psRefusing(o);
    assert.equal((await ack(o, "ord-u", "expired")).status, 200);
    for (let i = 0; i < 4; i++) {
      const r = await o.step();
      assert.equal(r.code, 0, r.err + r.out);
      assert.match(r.out, /invite 9: stop_expired, client_hold_unknown \(ps_exit_1\)/, r.out);
    }
    assert.equal(o.closes().length, 0, "a terminal whose holder is unknown is never closed");
    const run = o.runs()[`${REALM}|${ROOM}|9`];
    assert.equal(run.reaped, undefined, "no reap_exhausted");
    assert.equal(run.reap_tries, undefined, "no try counted");
    rmSync(down);
    const back = await o.step();
    assert.match(back.out, /invite 9: stop_expired, client_holds_seat 16-m3\.infra\.opus-5-5/);
    await agent.stop();
    for (let i = 0; i < 100 && !o.closes().length; i++) {
      if (!/client_holds_seat/.test((await o.step()).out)) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    assert.equal(o.closes().length, 1, "no seat holder left — closed as before");
  },
);

// The same decision on the older close paths (orchestra-run-ends.ts): a launch with neither tree
// nor exec, its window passed or its row ended — a client standing a seat through the daemon
// keeps its terminal and the row as it was; standing nowhere, it is closed as before.
const legacyRow = (o, state) => ({
  realm: REALM,
  room: ROOM,
  invite: 9,
  karta: 931,
  launcher: "probe-mac",
  harness: "opencode",
  model: "anthropic/claude-opus-5-5",
  repository: REPO,
  worktree: o.checkout,
  terminal: "term_fake",
  runtime: "rt_fake",
  state,
  at: "2026-01-01T00:00:00Z",
});
for (const [state, line] of [
  ["launched", "no_seat (cause_unseen), terminal_closed"],
  ["ended", "ended, terminal_closed"],
])
  for (const seat of ["16-m3.infra.opus-5-5", undefined])
    test(`legacy close: a ${state} launch's terminal ${seat ? "is kept while its client holds a seat" : "is closed when its client holds none"}`, async (t) => {
      const o = await leading(t);
      writeFileSync(
        join(o.dir, "run", "orchestra-runs.json"),
        JSON.stringify({ runs: { [`${REALM}|${ROOM}|9`]: legacyRow(o, state) } }),
      );
      await terminalBridge(o, "term_fake", seat);
      const r = await o.step();
      assert.equal(r.code, 0, r.err + r.out);
      const run = o.runs()[`${REALM}|${ROOM}|9`];
      if (seat) {
        assert.match(r.out, new RegExp(`invite 9: [a-z_]+, client_holds_seat ${seat}`), r.out);
        assert.equal(o.closes().length, 0, "a live agent's terminal is never closed");
        assert.equal(run.state, state, "the row stays as it was");
        assert.equal(run.closed, undefined);
      } else {
        assert.ok(r.out.includes(`invite 9: ${line}`), r.out);
        assert.deepEqual(o.closes(), [["terminal", "close", "--terminal", "term_fake", "--json"]]);
      }
    });
// Unread environments on the older paths: a live seat holder unread keeps the row as it was; no
// live seat holder at all — nothing unread matters, closed as before.
for (const [state, line] of [
  ["launched", "no_seat (cause_unseen), terminal_closed"],
  ["ended", "ended, terminal_closed"],
])
  for (const seat of ["16-m3.infra.opus-5-5", undefined])
    test(
      `legacy close: a ${state} launch's terminal ${seat ? "is kept while a seat holder is unread" : "is closed when no client holds a seat, ps refusing"}`,
      psOnly,
      async (t) => {
        const o = await leading(t);
        writeFileSync(
          join(o.dir, "run", "orchestra-runs.json"),
          JSON.stringify({ runs: { [`${REALM}|${ROOM}|9`]: legacyRow(o, state) } }),
        );
        await terminalBridge(o, "term_fake", seat);
        psRefusing(o);
        const r = await o.step();
        assert.equal(r.code, 0, r.err + r.out);
        const run = o.runs()[`${REALM}|${ROOM}|9`];
        if (seat) {
          assert.match(r.out, /invite 9: [a-z_]+, client_hold_unknown \(ps_exit_1\)/, r.out);
          assert.equal(o.closes().length, 0, "an unknown holder's terminal is never closed");
          assert.equal(run.state, state, "the row stays as it was");
          assert.equal(run.closed, undefined);
        } else {
          assert.ok(r.out.includes(`invite 9: ${line}`), r.out);
          assert.equal(o.closes().length, 1);
        }
      },
    );

// The control: the same client in that terminal, attached to the daemon but standing nowhere —
// closed as before.
test("reap: a terminal whose client holds no seat is closed as before", async (t) => {
  const o = await stopping(t, { status: 201, body: { id: "ord-n" } }, "ord-n", {
    FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
  });
  await terminalBridge(o, "term_fake");
  assert.equal((await ack(o, "ord-n", "expired")).status, 200);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_expired, client_exited/, r.out);
  assert.deepEqual(o.closes(), [["terminal", "close", "--terminal", "term_fake", "--json"]]);
});

// Review of PR #724 п.3: an order left issued for good holds neither the slot nor the orders
// cursor past the window — the run ends said so, its tab untouched (#7522).
test("quench: an open stop past the window keeps its runtime, tree and held cursor", async (t) => {
  const window = 6000;
  const o = await stopping(t, { status: 201, body: { id: "ord-i" } }, "ord-i", {
    ISKRON_ORCHESTRA_RAISE_WINDOW_MS: String(window),
  });
  const since = Date.now();
  const cursor = () =>
    JSON.parse(readFileSync(join(o.dir, "run", "orchestra-orders.json"), "utf8")).since;
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", r.out);
  assert.equal(cursor(), 0, "within the window the open order is read again");
  await new Promise((done) => setTimeout(done, Math.max(0, window + 500 - (Date.now() - since))));
  const late = await o.step();
  assert.equal(late.code, 0, late.err + late.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", late.out);
  assert.equal(o.closes().length, 0, "the tab of an agent that may live is never closed");
  assert.equal(cursor(), 0, "an unknown stop still holds its cursor");
});

// Review of PR #724 п.4: a stop answered without an id is matched by its seat — never by an
// older closed order of that seat read again behind a held cursor.
test("quench: a stop without an id is not matched by an older closed order of its seat", async (t) => {
  const o = await stopping(t, { status: 201, body: {} }, "ord-y");
  await o.fake.control({
    stop_order: { id: "ord-old", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const old = o.fake.state.orders.list.get("ord-old");
  old.state = "failed";
  old.issued_at = new Date(Date.now() - 3_600_000).toISOString();
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  const run = () => o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run().state, "stopping", r.out);
  assert.equal(run().order_id, undefined, "the old order is not the run's");
  assert.equal(run().stop_outcome, undefined, "nor its outcome");
  assert.equal((await ack(o, "ord-y", "stopped")).status, 200);
  const after = await o.step();
  assert.equal(after.code, 0, after.err + after.out);
  await waitEnded(o);
  assert.equal(run().state, "ended", after.out);
});

test("quench: someone else's stop closed refused does not end our run nor close its tab", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    stop_order: { id: "ord-n", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  o.fake.state.orders.list.get("ord-n").state = "refused";
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_refused_elsewhere/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0);
});

test("quench: a stopping run whose graph left the boundary ends when its order closes, not before", async (t) => {
  const o = await stopping(t, { status: 201, body: { id: "ord-b" } }, "ord-b");
  const other = "@probe/other";
  writeFileSync(
    join(o.dir, "run", "orchestra.json"),
    JSON.stringify({ on: true, realms: [other] }),
  );
  const hold = join(o.dir, "standings", "probe-1.hold");
  writeFileSync(hold, JSON.stringify({ ...JSON.parse(readFileSync(hold, "utf8")), realm: other }));
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", "its order is still open");
  // The account's open orders are read whole, whatever the boundary: the closed order frees
  // the run — and its limit slot (№4050 [32] п.3).
  const closed = await fetch(`${o.fake.base}/api/me/orders/ord-b/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state: "stopped" }),
  });
  assert.equal(closed.status, 200);
  const after = await o.step();
  assert.equal(after.code, 0, after.err + after.out);
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
});

test("quench: a stop on demand of our seat by someone else ends the run, closes its tab and frees its slot", async (t) => {
  const o = await leading(t, { descriptions: () => [describe({ body: { limit: 1 } })] });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([invite(9, GOOD), invite(10, GOOD)], [signal(1, 9, [ROOM])]);
  const full = await o.step();
  assert.match(full.out, /invite 10: limit_reached/, full.out);
  // A person (or the chief of staff) orders our raised seat to stop — not the orchestrator.
  await o.fake.control({
    stop_order: { id: "ord-h", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const open = await o.step();
  assert.equal(open.code, 0, open.err + open.out);
  assert.match(open.out, /invite 9: stop_ordered_elsewhere/, open.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0, "the seat still holds its order: the tab stays");
  // The agent's bridge carried the order out.
  const acked = await fetch(`${o.fake.base}/api/me/orders/ord-h/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state: "stopped" }),
  });
  assert.equal(acked.status, 200);
  const after = await o.step();
  assert.equal(after.code, 0, after.err + after.out);
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
  assert.deepEqual(o.closes(), [], "observed natural exit needs no extra close");
  const next = await o.step();
  assert.match(next.out, /invite 10: launched/, next.out);
  assert.equal(o.launches().length, 2);
  // The orchestrator itself ordered nothing.
  assert.equal(o.fake.state.orders.human.filter((h) => h.method === "POST").length, 0);
});

test("quench: a stop on demand already carried out before the tact ends the run at once", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    stop_order: { id: "ord-q", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  o.fake.state.orders.list.get("ord-q").state = "stopped"; // closed between two tacts
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_stopped_elsewhere/, r.out);
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
});

// Review of №4050 [105] п.2: the order lands between the open-orders read of demands and the
// read of every state — the run it marks stopping is not ended by the same tact's settle.
test("quench: a stop on demand put inside the tact keeps the run stopping and its tab open", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orders_on_read: { id: "ord-r", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_ordered_elsewhere/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0, "the agent's bridge has not carried the order out yet");
  // The next tact sees the order open among the account's orders: still stopping.
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0);
});

// Review of №4050 [105] п.3: the order reaches the account before the raised tape names the seat.
test("quench: a stop on demand of a seat not yet in the registry is read again once the seat is known", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.fake.control({
    stop_order: { id: "ord-e", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const early = await o.step();
  assert.equal(early.code, 0, early.err + early.out);
  assert.doesNotMatch(early.out, /elsewhere/, early.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "launched");
  await o.queue([], [signal(1, 9, [ROOM])]);
  const known = await o.step();
  assert.match(known.out, /invite 9: stop_ordered_elsewhere/, known.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  const cursor = () =>
    JSON.parse(readFileSync(join(o.dir, "run", "orchestra-orders.json"), "utf8")).since;
  // No unseated run is left, but the order is still open: it is read again for its outcome.
  assert.equal(cursor(), 0, "an open order of our stopping run holds the cursor");
  assert.equal((await ack(o, "ord-e", "stopped")).status, 200);
  await o.step();
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
  assert.equal(cursor(), 1, "the order closed: the cursor passes it");
});

// Review of №4050 [105] п.4: a tab is closed only by the handle of the Orca runtime the launch
// kept — not a run ended before this code, not after Orca restarted; and once.
test("close: an ended run with no Orca runtime kept — a registry from before — is never closed", async (t) => {
  const o = await leading(t);
  const old = {
    realm: REALM,
    room: ROOM,
    invite: 7,
    karta: 931,
    launcher: "probe-mac",
    harness: "opencode",
    model: "m",
    repository: REPO,
    worktree: o.checkout,
    terminal: "term_old",
    state: "ended",
    at: "2026-11-09T10:00:00Z",
  };
  writeFileSync(
    join(o.dir, "run", "orchestra-runs.json"),
    JSON.stringify({ runs: { [`${REALM}|${ROOM}|7`]: old } }),
  );
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.terminals().length, 0, JSON.stringify(o.terminals()));
  assert.doesNotMatch(r.out, /invite 7/, r.out);
});

test("close: after Orca restarted, the old runtime's handle is not closed — said once", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].runtime, "rt_fake");
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  o.restartOrca("rt_new");
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, []), idleSignal(3, 9, "idle_due")]);
  const r = await o.step();
  assert.match(r.out, /invite 9: seat_gone/, r.out);
  assert.notEqual(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
  assert.equal(o.closes().length, 0);
  const shows = o.terminals().length;
  const again = await o.step();
  assert.doesNotMatch(again.out, /invite 9: ended/, again.out);
  assert.ok(o.terminals().length > shows, "unconfirmed binding is retried");
  assert.equal(o.closes().length, 0, "another runtime is never closed");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].tree.exit, undefined, "slot remains held");
});

test("quench: a seat the orchestrator did not launch is never stopped", async (t) => {
  const o = await leading(t);
  await o.queue(
    [],
    [
      signal(1, 42, [ROOM], "seat-foreign"),
      signal(2, 42, [], "seat-foreign"),
      idleSignal(3, 42, "idle_due", "seat-foreign"),
    ],
  );
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.equal(o.fake.state.orders.human.length, 0);
});

test("quench: idle_due of a seat without our spawned_for orders nothing, ours sat empty lives", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  // Ours emptied without idle_due; a seat raised by hand goes idle_due beside it.
  const hand = { ...idleSignal(3, 9, "idle_due", "seat-hand"), spawned_for: null };
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, []), hand]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.equal(o.fake.state.orders.human.length, 0, "neither the hand seat nor ours is stopped");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].standing_id, "seat-raised");
});
