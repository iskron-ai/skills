// Probe for the shared channel discipline (js/shared/channel.ts) — the drop
// machine every holder of a standing socket runs. Two orderings the wire will
// not produce on demand are imitated at the seam where the holder meets the
// runtime: globalThis.WebSocket is replaced before the source is imported.
//
//   • the late dead-token code: `error` first (a guess — 1006 after 500 ms),
//     then the real `close` code landing after that guess. A holder that
//     parses the drop once, first-come, throws away the one code it must never
//     miss and reopens on a token the service has already refused — silently.
//   • three fast drops against a live service: the grant is alive, so the place
//     is kept and reopened slower, and the doer is told once — leaving would
//     throw a live standing away, silence would keep the doer looking reachable.
//
// ISKRON_CHANNEL_SOURCE points the probe at another copy of the source (a past
// revision) to show it red.
//
// The source is imported directly (Node strips the types); the bundle carries
// the same code, and check-js holds the two together.
import assert from "node:assert/strict";
import { test } from "node:test";

const sockets = [];
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.listeners = new Map();
    sockets.push(this);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  close() {
    this.readyState = 3;
  }
  fire(type, event = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, ...event });
  }
}
Object.defineProperty(globalThis, "WebSocket", {
  value: FakeWebSocket,
  writable: true,
  configurable: true,
});

process.env.ISKRON_CHANNEL_FLAP_MS = "400,1600"; // read at import: short flap pauses for the probe
const { holdSocket, DEAD_TOKEN_CODES } = await import(
  process.env.ISKRON_CHANNEL_SOURCE || "../shared/channel.ts"
);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

for (const code of DEAD_TOKEN_CODES) {
  test(`a ${code} close arriving after the 1006 guess is not spent — no reopen, one loud call`, async () => {
    sockets.length = 0;
    const dead = [];
    const holder = holdSocket({
      url: "ws://127.0.0.1:9/channel/ws/tok",
      onFrame: () => {},
      onDeadToken: (c) => dead.push(c),
      onServiceAlive: () => assert.fail("a dead token must not be read as flapping"),
    });
    const first = sockets[0];
    assert.ok(first, "the holder must construct its socket at once");
    first.fire("error");
    await delay(800); // later than the 500 ms the guess waits: the reopen timer is already armed
    first.fire("close", { code });
    await delay(2500); // past the 2 s reopen delay: a swallowed code would show as a second socket
    assert.deepEqual(dead, [code], "the late code must reach the holder exactly once");
    assert.equal(sockets.length, 1, "the holder reopened on a dead token");
    assert.equal(holder.alive, false);
  });
}

test("three fast drops against a live service: the doer is told once, and the holder keeps the place, reopening slower", async () => {
  // ISKRON_CHANNEL_FLAP_MS is set to 400,1600 before the import (top of file).
  sockets.length = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: "probe" }) });
  try {
    const alive = [];
    const holder = holdSocket({
      url: "ws://127.0.0.1:9/channel/ws/tok",
      onFrame: () => {},
      onDeadToken: () => assert.fail("no dead token here"),
      onServiceAlive: (v) => alive.push(v),
    });
    for (let i = 0; i < 2; i++) {
      sockets[sockets.length - 1].fire("close", { code: 1006 });
      await delay(2100); // the reopen delay, then the next socket is up
    }
    sockets[sockets.length - 1].fire("close", { code: 1006 }); // the third fast drop
    await delay(100);
    assert.deepEqual(
      alive,
      ["probe"],
      "the third fast drop must tell the doer, naming the version",
    );
    const n = sockets.length;
    await delay(500); // past the first flap pause
    assert.equal(sockets.length, n + 1, "the live grant keeps its place: the holder reopens");
    assert.equal(holder.alive, true);
    sockets[sockets.length - 1].fire("close", { code: 1006 }); // the band of drops goes on
    await delay(700);
    assert.equal(sockets.length, n + 1, "the next pause is longer, not the same");
    assert.deepEqual(alive, ["probe"], "one band of drops, one word to the doer");
    await delay(1100);
    assert.equal(sockets.length, n + 2, "and after the longer pause it reopens again");
    holder.close();
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("frames are parsed once and handed on raw plus parsed; non-JSON stays raw", async () => {
  sockets.length = 0;
  const got = [];
  holdSocket({
    url: "ws://127.0.0.1:9/channel/ws/tok",
    onFrame: (raw, frame) => got.push([raw, frame]),
    onDeadToken: () => {},
    onServiceAlive: () => {},
  });
  const s = sockets[0];
  s.fire("message", { data: JSON.stringify({ type: "hello", pending: 2 }) });
  s.fire("message", { data: "not json" });
  assert.equal(got.length, 2);
  assert.equal(got[0][1].type, "hello");
  assert.equal(got[1][1], null);
  assert.equal(got[1][0], "not json");
});
