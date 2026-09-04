#!/usr/bin/env node
// Harness for watchdog.test.mjs — NOT a test file itself (no .test.mjs suffix,
// so `node --test tests/*.test.mjs` never picks it up). It runs ONE watchdog in
// this process against a fake WebSocket and lets its own exit be the verdict.
//
// Why a fake socket and not a server. The drop machine guards an ORDERING:
// `error` first (a guess — 1006 after 500 ms), then the real `close` code
// arriving late. That ordering was hunted for on the wire on Node v26.8.1 and
// is not reachable there: undici delivers `error` and `close` in the SAME tick
// and the close that follows an error always carries 1006, while a socket that
// has already received a real close frame never fires `error` at all. Measured
// against a server that masks frames, sets RSV1, sends a reserved opcode,
// invalid UTF-8, an orphan continuation, a fragmented ping, an out-of-range
// close code, an RST, a bare FIN, and a close 4000 followed by garbage — every
// one of them collapsed to a single `error`+`close(1006)` pair.
//
// So the ordering is imitated here, at the seam where the watchdog meets the
// runtime: `globalThis.WebSocket` is replaced before the module is imported,
// and the module — which constructs its socket at import time — takes the fake
// without knowing it. Nothing test-shaped is added to the shipped file.
//
// Contract, in env: WD_FILE (watchdog to probe), WD_URL (its argv[2]),
// WD_LATE_MS (how much later than the error the close lands), WD_LATE_CODE.
// The watchdog's own loud exit is the harness's exit. If instead it swallows
// the late code and reopens, the fake sees a SECOND construction — the harness
// says so and leaves with 0, which is what the probe reads as failure.
import { pathToFileURL } from "node:url";
import { writeSync } from "node:fs";

const FILE = process.env.WD_FILE;
const URL_ = process.env.WD_URL;
const LATE_MS = Number(process.env.WD_LATE_MS ?? 800);
const LATE_CODE = Number(process.env.WD_LATE_CODE ?? 4000);
const WINDOW_MS = Number(process.env.WD_WINDOW_MS ?? 6000);

const sockets = [];
class FakeWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.listeners = new Map();
    sockets.push(this);
    if (sockets.length > 1) reopened();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this.listeners.get(type);
    if (l) this.listeners.set(type, l.filter((f) => f !== fn));
  }
  send() {}
  close() {}
  fire(type, event) {
    for (const fn of this.listeners.get(type) ?? []) fn({ type, ...event });
  }
}
// defineProperty, not assignment: the global is installed differently across
// Node lines (a replaceable lazy accessor on some), and a plain `=` can be a
// no-op against a getter. This probe must land the fake on Node 22 — the floor
// the watchdogs declare and the version CI runs them on — as surely as here.
Object.defineProperty(globalThis, "WebSocket", {
  value: FakeWebSocket, writable: true, configurable: true, // non-enumerable, as Node ships it
});
if (globalThis.WebSocket !== FakeWebSocket) {
  writeSync(2, "ПРОБА: подменить globalThis.WebSocket не удалось — пробе не за что взяться\n");
  process.exit(0);
}

// A reopen means the watchdog treated the late dead-token code as noise and
// went back to the same dead token — the silent failure the loud exit exists
// to prevent. Say it in words the probe can match, and leave with 0: a zero
// exit is exactly the "clean stop" a doer must never be handed here.
function reopened() {
  writeSync(2, `ПРОБА: сторож ПЕРЕОТКРЫЛСЯ на мёртвом токене (сокетов: ${sockets.length}) — опоздавший ${LATE_CODE} проглочен\n`);
  process.exit(0);
}

process.argv = [process.argv[0], FILE, URL_];
await import(pathToFileURL(FILE).href);

const first = sockets[0];
if (!first) {
  writeSync(2, "ПРОБА: сторож не построил сокет при импорте — пробе не за что взяться\n");
  process.exit(0);
}

// The runtime's guess arrives first and names no code…
first.fire("error", {});
// …and the truth arrives later than the 500 ms the guess is deferred by.
setTimeout(() => first.fire("close", { code: LATE_CODE, reason: "", wasClean: false }), LATE_MS);

// Neither loud exit nor reopen inside the window is its own kind of silence.
setTimeout(() => {
  writeSync(2, `ПРОБА: сторож молчит спустя ${WINDOW_MS} мс — ни громкого выхода, ни переоткрытия\n`);
  process.exit(0);
}, WINDOW_MS);
