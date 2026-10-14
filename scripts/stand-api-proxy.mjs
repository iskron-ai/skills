#!/usr/bin/env node
// The /api route of a LOCAL carrier for the live bridge run: the bridge answers a stop order and
// reads /me/orders at its socket's origin under /api (graph @nks/nks-dev, nodes #7510, #7611), as
// the deployment serves it behind its proxy, while a LOCAL api answers from its root. This proxy
// listens on loopback, strips /api and passes HTTP and the WebSocket upgrade to the api; the MCP
// of the run issues sockets on it by NKS_PUBLIC_API_URL=http://127.0.0.1:PORT/api. Anything else
// is 404.
//
//   node scripts/stand-api-proxy.mjs --port 18091 --target 8091 [--ack-log F] [--journal-root D]
//
// --ack-log — every POST /me/orders/{id}/ack as one JSON line {t, done, order, state, status,
// disk}: when the request came, when the api answered, the order, the state the bridge sent and
// the api's status. No headers, no credentials. stand-run.mjs and stand-run-opencode.mjs read it
// by their own --ack-log to see accepted answered before the outcome.
// --journal-root — where the drivers' run dirs live (their tmpdir): as an accepted comes in, the
// proxy reads that order's journal entry (stand-*/…/orders/<id>.json) and logs its state as
// `disk` — an independent snapshot that the order was on disk before its accepted went out.
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
};
const PORT = Number(arg("--port", "18091"));
const TARGET = Number(arg("--target", "8091"));
const ackLog = arg("--ack-log", null);
const journalRoot = arg("--journal-root", null);
const ACK = /^\/me\/orders\/([0-9a-f-]+)\/ack(?:\?|$)/;

// The order's journal state on disk right now, searched under the drivers' run dirs; null — none.
function diskState(id) {
  if (!journalRoot) return undefined;
  const walk = (dir, depth) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      if (!e.isDirectory() || (depth === 0 && !e.name.startsWith("stand-"))) continue;
      const p = join(dir, e.name);
      if (e.name === "orders") {
        try {
          return JSON.parse(readFileSync(join(p, `${id}.json`), "utf8")).state ?? null;
        } catch {
          continue;
        }
      }
      if (depth < 6) {
        const found = walk(p, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(journalRoot, 0);
}

const strip = (url) => (url.startsWith("/api/") ? url.slice(4) : url === "/api" ? "/" : null);

const server = http.createServer((req, res) => {
  const path = strip(req.url);
  if (path === null) {
    res.writeHead(404).end();
    return;
  }
  const ack = req.method === "POST" ? ACK.exec(path) : null;
  const t = Date.now();
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    // The journal as it stands while this ack is still in the proxy, before the api sees it.
    const disk = ack ? diskState(ack[1]) : undefined;
    const up = http.request(
      { host: "127.0.0.1", port: TARGET, method: req.method, path, headers: { ...req.headers, host: `127.0.0.1:${TARGET}` } },
      (r) => {
        // done — when the api's answer ended, not when its headers came: the bridge reads the
        // whole body before it sends the outcome, so the order check compares against this.
        if (ack && ackLog)
          r.on("end", () => {
            let state = null;
            try {
              state = JSON.parse(body.toString()).state ?? null;
            } catch {}
            appendFileSync(ackLog, JSON.stringify({ t, done: Date.now(), order: ack[1], state, status: r.statusCode, disk }) + "\n");
          });
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    up.end(body);
  });
});

server.on("upgrade", (req, sock, head) => {
  const path = strip(req.url);
  if (path === null) return sock.destroy();
  const up = net.connect(TARGET, "127.0.0.1", () => {
    const lines = [`${req.method} ${path} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      lines.push(`${req.rawHeaders[i]}: ${/^host$/i.test(req.rawHeaders[i]) ? `127.0.0.1:${TARGET}` : req.rawHeaders[i + 1]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head?.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
  sock.on("error", () => up.destroy());
});

server.listen(PORT, "127.0.0.1", () => process.stdout.write(`stand-api-proxy: 127.0.0.1:${PORT}/api -> 127.0.0.1:${TARGET}\n`));
