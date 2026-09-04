// Behavioural probe for the two standing watchdogs shipped in
// skills/standing/references/ (graph nks-dev: #4058, #4059). They have no
// other test set: their carrier is a live standing, and this file covers only
// what a live standing shows too late — the sign of a dead token.
//
// ISKRON_WATCHDOG_DIR points the same probe at any copy (a built bundle, an
// installed one, a previous revision) so it can be shown red before a fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = process.env.ISKRON_WATCHDOG_DIR
  || join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "standing", "references");

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
function runWatchdog(file, url, env) {
  const proc = spawn(process.execPath, [join(DIR, file), url], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "", err = "";
  proc.stdout.on("data", (c) => { out += c; });
  proc.stderr.on("data", (c) => { err += c; });
  return new Promise((resolve) => {
    const t = setTimeout(() => { proc.kill("SIGKILL"); resolve({ exit: null, out, err }); }, 5_000);
    proc.once("exit", (code) => { clearTimeout(t); resolve({ exit: code, out, err }); });
  });
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
}
