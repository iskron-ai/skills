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
// `disk` — an independent snapshot that the order was on disk before its accepted went out. The
// newest run dir is searched first, harness homes and node_modules never; `walk` is its time, `api`
// — when the api's answer ended (done is when the bridge got it).
// --ack-delay-accepted MS — the accepted's answer is held MS before the bridge gets it: a delay
// below and above the bridge's cap on waiting for it, both on purpose (case №1622).
// --tick-log F — every tick frame a bridge sends on a dispatcher connection as one JSON line {t,
// conn, entries: [{channel_id, standing_id?, pulse?, status?}]}: t — when the proxy finished
// reading the frame, a few ms after its bytes went on to the api; what the tact carried (case
// №1645). Read off the client's masked frames; usage and credentials are not logged. Each
// connection's TCP open (not its 101) and close with the bytes left unread is logged too, and a text frame that is not JSON or a compressed
// one (the api offers no compression) as such, unread: a missing tick is a reading only within an
// observed connection with no such line.
import { appendFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
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
const acceptedDelay = Number(arg("--ack-delay-accepted", "0"));
const tickLog = arg("--tick-log", null);
const SKIP = new Set(["home", "node_modules"]);
const ACK = /^\/me\/orders\/([0-9a-f-]+)\/ack(?:\?|$)/;

// The order's journal state on disk right now, searched under the drivers' run dirs; null — none.
// Asynchronous: the walk holds only its own ack, never the sockets this process carries.
async function diskState(id) {
  if (!journalRoot) return undefined;
  const walk = async (dir, depth) => {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    if (depth === 0) {
      const runs = entries.filter((e) => e.isDirectory() && e.name.startsWith("stand-"));
      const mtimes = new Map(await Promise.all(runs.map(async (e) => [e.name, await stat(join(dir, e.name)).then((s) => s.mtimeMs, () => 0)])));
      entries = runs.sort((a, b) => mtimes.get(b.name) - mtimes.get(a.name));
    }
    for (const e of entries) {
      if (!e.isDirectory() || SKIP.has(e.name)) continue;
      const p = join(dir, e.name);
      if (e.name === "orders") {
        try {
          return JSON.parse(await readFile(join(p, `${id}.json`), "utf8")).state ?? null;
        } catch {
          continue;
        }
      }
      if (depth < 6) {
        const found = await walk(p, depth + 1);
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
  req.on("end", async () => {
    const body = Buffer.concat(chunks);
    // The journal as it stands while this ack is still in the proxy, before the api sees it.
    const disk = ack ? await diskState(ack[1]) : undefined;
    const walk = Date.now() - t;
    let state = null;
    if (ack)
      try {
        state = JSON.parse(body.toString()).state ?? null;
      } catch {}
    const hold = state === "accepted" ? acceptedDelay : 0;
    const up = http.request(
      { host: "127.0.0.1", port: TARGET, method: req.method, path, headers: { ...req.headers, host: `127.0.0.1:${TARGET}` } },
      (r) => {
        if (!ack) {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
          return;
        }
        const parts = [];
        r.on("data", (c) => parts.push(c));
        // done — when the bridge got the whole answer, not when its headers came: the bridge
        // reads the whole body before it sends the outcome, so the order check compares against this.
        // A bridge that gave up waiting (its timeout) closed the request first: aborted, no done.
        r.on("end", () => {
          const api = Date.now();
          let logged = false;
          const note = (rec) => {
            if (logged || !ackLog) return;
            logged = true;
            appendFileSync(ackLog, JSON.stringify({ t, order: ack[1], state, status: r.statusCode, disk, walk, api, hold, ...rec }) + "\n");
          };
          res.on("close", () => note({ aborted: Date.now() }));
          setTimeout(() => {
            if (res.destroyed) return;
            res.writeHead(r.statusCode, r.headers);
            res.end(Buffer.concat(parts), () => note({ done: Date.now() }));
          }, hold);
        });
      },
    );
    up.on("error", () => (res.headersSent ? res.destroy() : res.writeHead(502).end()));
    up.end(body);
  });
});

// The client's WebSocket frames (RFC 6455, masked), read as they pass: tick text frames logged.
let conns = 0;
function tickReader() {
  const conn = ++conns;
  const note = (rec) => appendFileSync(tickLog, JSON.stringify({ t: Date.now(), conn, ...rec }) + "\n");
  let buf = Buffer.alloc(0);
  let parts = [];
  const text = (payload) => {
    let f;
    try {
      f = JSON.parse(payload.toString("utf8"));
    } catch {
      return note({ unparsed: payload.length });
    }
    if (f?.type !== "tick") return;
    if (!Array.isArray(f.entries)) return note({ unparsed: payload.length });
    note({ entries: f.entries.map(({ usage: _u, ...e }) => e) });
  };
  const read = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80;
      const rsv1 = buf[0] & 0x40;
      const op = buf[0] & 0x0f;
      const masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      const key = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const payload = Buffer.from(buf.subarray(at, at + len));
      if (key) for (let i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
      buf = buf.subarray(at + len);
      if (op === 0x1 || (op === 0x0 && parts.length)) {
        if (rsv1) {
          note({ compressed: true });
          parts = [];
          continue;
        }
        parts.push(payload);
        if (fin) {
          text(Buffer.concat(parts));
          parts = [];
        }
      }
    }
  };
  // Open — the TCP connection to the api, before its 101; close names the bytes left unread.
  note({ tcp_open: true });
  return { read, close: () => note({ close: true, rest: buf.length + parts.reduce((n, p) => n + p.length, 0) }) };
}

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
    if (tickLog && /\/channel\/mux(?:\?|$)/.test(path)) {
      const ticks = tickReader();
      if (head?.length) ticks.read(head);
      sock.on("data", ticks.read);
      sock.on("close", ticks.close);
    }
  });
  up.on("error", () => sock.destroy());
  sock.on("error", () => up.destroy());
});

server.listen(PORT, "127.0.0.1", () => process.stdout.write(`stand-api-proxy: 127.0.0.1:${PORT}/api -> 127.0.0.1:${TARGET}\n`));
