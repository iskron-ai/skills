// A stand-in for the Codex app-server control socket, spoken to exactly as the
// watchdog-codex client speaks to the real one: HTTP Upgrade on a unix socket,
// then websocket text frames carrying JSON-RPC (masked from the client). It
// answers initialize and turn/start, and appends every request it receives to
// FC_LOG as one JSON line — the probe reads what reached the "thread".
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";

function frame(payload) {
  const data = Buffer.from(payload, "utf8");
  let head;
  if (data.length < 126) head = Buffer.from([0x81, data.length]);
  else {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(data.length, 2);
  }
  return Buffer.concat([head, data]);
}

/** Parse masked client frames; returns the text payloads found and the leftover. */
function unframe(buf) {
  const out = [];
  for (;;) {
    if (buf.length < 2) break;
    const op = buf[0] & 0x0f;
    const masked = !!(buf[1] & 0x80);
    let len = buf[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (buf.length < 4) break;
      len = buf.readUInt16BE(2);
      off = 4;
    } else if (len === 127) {
      if (buf.length < 10) break;
      len = Number(buf.readBigUInt64BE(2));
      off = 10;
    }
    const need = off + (masked ? 4 : 0) + len;
    if (buf.length < need) break;
    let payload = buf.subarray(off + (masked ? 4 : 0), need);
    if (masked) {
      const mask = buf.subarray(off, off + 4);
      payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
    }
    buf = buf.subarray(need);
    if (op === 1) out.push(payload.toString("utf8"));
  }
  return { out, rest: buf };
}

export function startFakeCodex(socketPath, logFile) {
  mkdirSync(dirname(socketPath), { recursive: true });
  const server = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const sockets = new Set();
  server.on("upgrade", (req, socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
    );
    let buf = Buffer.alloc(0);
    socket.on("data", (c) => {
      buf = Buffer.concat([buf, c]);
      const { out, rest } = unframe(buf);
      buf = rest;
      for (const text of out) {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          continue;
        }
        appendFileSync(logFile, JSON.stringify(msg) + "\n");
        if (msg.id == null) continue;
        if (msg.method === "initialize") {
          socket.write(frame(JSON.stringify({ id: msg.id, result: { userAgent: "fake-codex" } })));
        } else if (msg.method === "turn/start") {
          socket.write(
            frame(
              JSON.stringify({
                id: msg.id,
                result: { turn: { id: "turn-1", status: "inProgress", items: [], error: null } },
              }),
            ),
          );
        } else {
          socket.write(
            frame(JSON.stringify({ id: msg.id, error: { code: -32601, message: "unknown" } })),
          );
        }
      }
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) => {
    server.listen(socketPath, () => {
      resolve({
        stop: () =>
          new Promise((r) => {
            // Upgraded sockets are not the http server's to close — destroy them ourselves.
            for (const s of sockets) s.destroy();
            server.closeAllConnections?.();
            server.close(r);
          }),
      });
    });
  });
}
