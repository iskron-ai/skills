// Behavioural probe for the two standing watchdogs shipped in
// skills/standing/references/ (graph nks-dev: #4058, #4059). They have no
// other test set: their carrier is a live standing, and this file covers only
// what a live standing shows too late — the sign of a dead token. Two ways in:
// over a real socket (a server that closes with the code), and at the seam
// where the watchdog meets the runtime, for an ordering the runtime will not
// produce on demand — see tests/watchdog-drop-order.mjs for that one.
//
// ISKRON_WATCHDOG_DIR points the same probe at any copy (a built bundle, an
// installed one, a previous revision) so it can be shown red before a fix.
//
// Node 22+, and that is why this file has its own make target and its own CI
// job: the watchdogs take the global WebSocket, while the bridge next door
// claims Node 20 and is held there. Run it with `make test-watchdog`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.ISKRON_WATCHDOG_DIR
  || join(HERE, "..", "skills", "standing", "references");
const ORDER_HARNESS = join(HERE, "watchdog-drop-order.mjs");

// The smallest thing the service does on a dead token: accept the upgrade and
// close with the code. No frames, no pings — that is all the watchdog sees.
function startClosingServer(code) {
  const server = createServer((_, res) => { res.writeHead(404); res.end(); });
  const upgraded = new Set(); // server.close() does not know hijacked sockets — destroy them ourselves
  server.on("upgrade", (req, socket) => {
    upgraded.add(socket);
    socket.once("close", () => upgraded.delete(socket));
    const accept = createHash("sha1")
      .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.write(Buffer.from([0x88, 0x02, code >> 8, code & 0xff])); // close frame, 2-byte payload = code
    setTimeout(() => socket.end(), 200).unref(); // let the client answer the close handshake first
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `ws://127.0.0.1:${server.address().port}/channel/ws/tok`,
    close: () => { for (const s of upgraded) s.destroy(); server.closeAllConnections(); return new Promise((done) => server.close(done)); },
  })));
}

// Runs a watchdog and waits for it to exit on its own. A watchdog still alive
// after the timeout is the failure this probe exists for, not a skip.
function runWatchdog(file, url, env, timeoutMs = 5_000) {
  const proc = spawn(process.execPath, [join(DIR, file), url], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "", err = "";
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.on("data", (c) => { err += c; });
  return new Promise((resolve) => {
    const t = setTimeout(() => { proc.kill("SIGKILL"); resolve({ exit: null, out, err }); }, timeoutMs);
    proc.once("exit", (code) => { clearTimeout(t); resolve({ exit: code, out, err }); });
  });
}

// The other end of the same rule: the socket keeps dropping while the service
// answers. There is nothing to reopen and no code to name, so the watchdog must
// still leave loudly — a silent exit here leaves the doer looking reachable.
function startFlappingServer() {
  const server = createServer((req, res) => {
    if (req.url === "/api/version") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ version: "probe" }));
    }
    res.writeHead(404); res.end();
  });
  server.on("upgrade", (_, socket) => socket.destroy()); // accepted, then torn down at once
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `ws://127.0.0.1:${server.address().port}/channel/ws/tok`,
    close: () => { server.closeAllConnections(); return new Promise((done) => server.close(done)); },
  })));
}

for (const file of ["watchdog.mjs", "watchdog-exit.mjs"]) {
  test(`${file}: a dead token is a loud non-zero exit, even with the busy-line publisher on`, async () => {
    const srv = await startClosingServer(4000);
    const say = join(mkdtempSync(join(tmpdir(), "iskron-wd-")), "say");
    writeFileSync(say, "");
    try {
      const r = await runWatchdog(file, srv.url, {
        ISKRON_CHANNEL_SAY: say,
        ISKRON_CHANNEL_STATUS: srv.url.replace("ws:", "http:").replace("/channel/ws/", "/channel/status/"),
      });
      assert.notEqual(r.exit, null, `${file} is still alive 5s after a 4000 close — a dead token that looks like an empty inbox`);
      assert.notEqual(r.exit, 0, `${file} exited 0 on a dead token — indistinguishable from a clean stop`);
      assert.match(r.out + r.err, /токен мёртв/, "the last line must name the dead token for the doer");
    } finally {
      await srv.close();
    }
  });

  test(`${file}: drops against a live service also end loudly, never in silence`, async () => {
    const srv = await startFlappingServer();
    const say = join(mkdtempSync(join(tmpdir(), "iskron-wd-")), "say");
    writeFileSync(say, "");
    try {
      const r = await runWatchdog(file, srv.url, {
        ISKRON_CHANNEL_SAY: say,
        ISKRON_CHANNEL_STATUS: `${srv.url.replace("ws:", "http:").replace("/channel/ws/", "/channel/status/")}`,
      }, 20_000);
      assert.notEqual(r.exit, null, `${file} kept running after three fast drops with the service up — it should have handed the question to the doer`);
      assert.notEqual(r.exit, 0, `${file} exited 0 there: the doer reads a clean stop and keeps believing the socket is held`);
      assert.match(r.out + r.err, /спроси о токене/, "the last line must hand the doer the question it cannot answer itself");
    } finally {
      await srv.close();
    }
  });
}

// ── The late code ───────────────────────────────────────────────────────────
// `error` says only that the socket went; the watchdog guesses 1006 for it
// after 500 ms, because on a failed upgrade some runtimes send nothing else.
// The real code rides `close`, and nothing promises it arrives inside those
// 500 ms. A watchdog that parses the drop once, first-come, therefore throws
// away the one code it must never miss and reopens on a token the service has
// already refused — silently, which is the exact failure the loud exit is for.
//
// This ordering could not be produced on the wire: on Node v26.8.1 undici
// delivers `error` and `close` in one tick and any close after an error is
// 1006, while a socket holding a real close frame never fires `error`. Eleven
// misbehaving servers were tried (masked frame, RSV1, reserved opcode, bad
// UTF-8, orphan continuation, fragmented ping, out-of-range close code, RST,
// bare FIN, close 4000 then junk, close 4000 then a hang) and each collapsed
// to the same pair. So the ordering is imitated one layer down, by swapping
// globalThis.WebSocket before the watchdog is imported — the harness carries
// the reasoning. What is pinned here is the drop machine's contract, not a
// packet sequence: a dead-token code is never spent, whenever it lands.
for (const file of ["watchdog.mjs", "watchdog-exit.mjs"]) {
  for (const code of [4000, 4001, 4002]) {
    test(`${file}: a ${code} close arriving after the 1006 guess still leaves loudly`, async () => {
      const r = await new Promise((resolve) => {
        const proc = spawn(process.execPath, [ORDER_HARNESS], {
          env: {
            ...process.env,
            WD_FILE: join(DIR, file),
            WD_URL: "ws://127.0.0.1:9/channel/ws/tok", // never dialled: the socket is a fake
            WD_LATE_MS: "800",                         // later than the 500 ms the guess waits
            WD_LATE_CODE: String(code),
            WD_WINDOW_MS: "6000",
            ISKRON_CHANNEL_SAY: "",                    // busy-line half stays off
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "", err = "";
        proc.stdout.on("data", (c) => { out += c; });
        proc.stderr.on("data", (c) => { err += c; });
        const t = setTimeout(() => { proc.kill("SIGKILL"); resolve({ exit: null, out, err }); }, 20_000);
        proc.once("exit", (x) => { clearTimeout(t); resolve({ exit: x, out, err }); });
      });
      const said = r.out + r.err;
      assert.doesNotMatch(said, /ПЕРЕОТКРЫЛСЯ/,
        `${file} swallowed a late ${code} and went back to the dead token — the doer keeps looking reachable`);
      assert.notEqual(r.exit, null, `${file} never finished after a late ${code}`);
      assert.notEqual(r.exit, 0,
        `${file} left with 0 after a late ${code} — a clean stop is what a doer reads as "nothing to hear"`);
      assert.match(said, /токен мёртв/, "the last line must name the dead token for the doer");
    });
  }
}
