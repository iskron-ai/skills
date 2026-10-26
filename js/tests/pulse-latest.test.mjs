// #8743: real pulse → holder → mux ticker, with a scripted socket and controlled clock.
// The mock hello answers the channel contract (@nks/nks-dev, #8620); the batch tact and its
// one-frame-per-30s pacing are #8623.
import assert from "node:assert/strict";
import { test } from "node:test";

import { E, H } from "../bridge/holdstate.ts";
import { holdChannel } from "../bridge/muxhold.ts";
import { runPulse, sentPulse } from "../bridge/pulse.ts";
import { state } from "../bridge/transport.ts";
import { bindScope, newScope, runIn } from "../shared/scope.ts";

class Socket extends EventTarget {
  static all = [];
  readyState = 0;
  frames = [];
  constructor(url) {
    super();
    this.url = url;
    Socket.all.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  send(raw) {
    if (this.fail && JSON.parse(raw).type === "tick") throw new Error("send refused");
    this.frames.push({ at: Date.now(), ...JSON.parse(raw) });
  }
  receive(frame) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
  close() {
    this.readyState = 3;
  }
}

function setup(t) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = Socket;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1_800_000_000_000 });
  Socket.all = [];
  return (ms) => t.mock.timers.tick(ms);
}

function seat(t, url) {
  const scope = newScope(url, { env: {}, cwd: "/", pid: 1, path: "" }, () => false);
  const within = (fn) => runIn(scope, fn);
  const holder = within(() => {
    state.initParams = { clientInfo: { name: "pi-iskron" } };
    H.currentUrl = url;
    H.holder = holdChannel({
      url,
      onFrame: bindScope((_raw, f) => {
        if (f?.type === "hello") E.pulse("hello");
      }),
      onDead() {},
      onEvicted() {},
    });
    return H.holder;
  });
  t.after(() => holder.close());
  const pulse = (params) =>
    within(() => {
      const reply = runPulse({ jsonrpc: "2.0", id: 1, method: "iskron/pulse", params });
      assert.equal(reply.result.taken, true);
      return reply.result.pulse;
    });
  pulse.sent = () => within(sentPulse);
  pulse.leave = () =>
    within(() => {
      E.pulse("last", holder);
      holder.close();
    });
  return pulse;
}

function hello(sock, secret) {
  const sub = sock.frames.findLast((f) => f.type === "subscribe" && f.secret === secret);
  assert.ok(sub);
  sock.receive({
    type: "hello",
    ref: sub.ref,
    channel_id: secret,
    sub: secret,
    standings: [],
    ping_interval_seconds: 300,
    credit: 32,
  });
}

test("latest accepted RPC reaches the next mux tact, with only one frame per 30 seconds", (t) => {
  const advance = setup(t);
  seat(t, "ws://mux-latest.test/api/channel/ws/seed");
  const sock = Socket.all[0];
  sock.open();
  hello(sock, "seed");
  advance(0); // connection phase: t=0
  advance(19_000);
  const pulse = seat(t, "ws://mux-latest.test/api/channel/ws/target");
  const oldTurn = new Date().toISOString();
  pulse({ state: "idle", turn_at: oldTurn });
  hello(sock, "target");
  advance(11_000); // t=30: idle on wire, holder phase is t=19
  const ticks = () => sock.frames.filter((f) => f.type === "tick");
  const target = () =>
    ticks()
      .at(-1)
      .entries.find((e) => e.channel_id === "target").pulse;
  assert.equal(target().state, "idle");
  advance(9_000);
  pulse({ state: "busy" });
  advance(10_000); // t=49: old holder throttle admits busy
  advance(170);
  const turn = new Date().toISOString();
  assert.equal(pulse({ state: "interrupted", turn_at: turn }).state, "interrupted");
  advance(10_829);
  assert.equal(ticks().length, 2, "no extra tick before t=60");
  advance(1);
  const sent = target();
  assert.equal(sent.state, "interrupted", "t=60 must carry the last RPC, not queued busy");
  assert.equal(sent.turn_at, turn, "not the old turn snapshot");
  assert.equal(ticks().length, 3);
  for (let i = 1; i < ticks().length; i++) assert.equal(ticks()[i].at - ticks()[i - 1].at, 30_000);
});

test("404 fallback keeps the per-socket 30-second pulse pacing", async (t) => {
  const advance = setup(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  const pulse = seat(t, "ws://pulse-old.test/api/channel/ws/old");
  const failed = Socket.all[0];
  const closed = new Event("close");
  Object.assign(closed, { code: 1006 });
  failed.dispatchEvent(closed);
  for (let i = 0; i < 20 && Socket.all.length < 2; i++) await Promise.resolve();
  const sock = Socket.all[1];
  assert.ok(sock, "404 switched the same holder to the old socket");
  sock.open();
  sock.receive({ type: "hello", ping_interval_seconds: 300 });
  const pulses = () => sock.frames.filter((f) => f.type === "pulse");
  assert.equal(pulses().length, 1);
  const initial = pulse.sent();
  advance(9_000);
  pulse({ state: "busy" });
  advance(10_000);
  const turn = new Date().toISOString();
  pulse({ state: "interrupted", turn_at: turn });
  advance(10_999);
  assert.equal(pulses().length, 1);
  assert.deepEqual(pulse.sent(), initial);
  advance(1);
  assert.equal(pulses().length, 2);
  assert.equal(pulses()[1].at - pulses()[0].at, 30_000);
  assert.equal(pulses()[1].state, "interrupted");
  assert.equal(pulses()[1].turn_at, turn);
  assert.deepEqual(pulse.sent(), {
    type: "pulse",
    state: "interrupted",
    pending: 0,
    turn_at: turn,
    sent_at: new Date(pulses()[1].at).toISOString(),
  });
});

test("sent is the successful tick snapshot and time, scoped per channel", (t) => {
  const advance = setup(t);
  const a = seat(t, "ws://pulse-sent.test/api/channel/ws/a");
  const b = seat(t, "ws://pulse-sent.test/api/channel/ws/b");
  const sock = Socket.all[0];
  sock.open();
  hello(sock, "a");
  hello(sock, "b");
  assert.equal(a.sent(), null, "queued hello is not sent");
  advance(0);
  const oldA = a.sent();
  const oldB = b.sent();
  advance(9_000);
  a({ state: "busy" });
  b({ state: "idle" });
  assert.deepEqual(a.sent(), oldA);
  assert.deepEqual(b.sent(), oldB);
  sock.fail = true;
  advance(21_000);
  assert.deepEqual(a.sent(), oldA, "failed tick is not sent");
  assert.deepEqual(b.sent(), oldB);
  advance(1_000);
  const turn = new Date().toISOString();
  a({ state: "interrupted", turn_at: turn });
  b({ state: "unknown" }); // replace queued idle with the last successfully sent state
  sock.fail = false;
  advance(29_000);
  const tick = sock.frames.filter((f) => f.type === "tick").at(-1);
  for (const [id, pulse] of [
    ["a", a],
    ["b", b],
  ]) {
    assert.deepEqual(pulse.sent(), {
      type: "pulse",
      ...tick.entries.find((e) => e.channel_id === id).pulse,
      sent_at: new Date(tick.at).toISOString(),
    });
  }
  assert.equal(a.sent().state, "interrupted");
  assert.equal(a.sent().turn_at, turn);
  assert.equal(b.sent().state, "unknown");
  advance(1_000);
  a({ state: "idle" });
  a.leave();
  assert.equal(a.sent().state, "idle", "leave flush confirms its snapshot");
  assert.equal(a.sent().sent_at, new Date().toISOString());
  assert.equal(b.sent().sent_at, new Date(tick.at).toISOString());
  const beforeLeave = b.sent();
  b({ state: "failed" });
  sock.fail = true;
  b.leave();
  assert.deepEqual(b.sent(), beforeLeave, "failed leave flush is not sent");
});
