// LAB-only transparent HTTP ledger. No credentials, request bodies or response bodies in logs.
import http from "node:http";
import { appendFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

const UPSTREAM = "https://nks.lab.mirari.ru/mcp-iskron";
const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "proxy-authenticate", "proxy-authorization", "te", "trailer"]);
// fetch injection is for offline tests only; the CLI has no upstream override.
export function createLedger({ record, fetchImpl = fetch }) {
  const controllers = new Set();
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/mcp-iskron") { res.writeHead(404).end(); return; }
    const controller = new AbortController();
    let journalFailed = false;
    controllers.add(controller);
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const parts = [];
      for await (const chunk of req) parts.push(chunk);
      const body = Buffer.concat(parts);
      let initialize = false;
      try { initialize = JSON.parse(body.toString()).method === "initialize"; } catch {}
      const headers = new Headers();
      const hop = new Set([...HOP, ...String(req.headers.connection ?? "").toLowerCase().split(/\s*,\s*/)]);
      for (const [key, value] of Object.entries(req.headers)) if (!hop.has(key) && value !== undefined)
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const response = await fetchImpl(UPSTREAM, { method: req.method, headers, signal: controller.signal, redirect: "error",
        ...(req.method === "GET" || req.method === "HEAD" ? {} : { body }) });
      if (initialize || req.method === "DELETE") {
        try { record({ at: new Date().toISOString(), kind: initialize ? "initialize" : "delete",
          session_id: initialize ? response.headers.get("mcp-session-id") : req.headers["mcp-session-id"] ?? null, status: response.status }); }
        catch { journalFailed = true; throw new Error("journal unavailable"); }
      }
      res.statusCode = response.status;
      response.headers.forEach((value, key) => { if (!HOP.has(key) && key !== "content-encoding") res.setHeader(key, value); });
      if (response.body) await pipeline(Readable.fromWeb(response.body), res);
      else res.end();
    } catch {
      // No error text: it can contain URLs, credentials or response bodies.
      if (!res.headersSent) res.writeHead(502);
      if (!res.destroyed) res.end();
      if (journalFailed) server.emit("error", new Error("LAB ledger journal write failed"));
    } finally { controllers.delete(controller); }
  });
  return { server, async close() {
    for (const controller of controllers) controller.abort();
    await new Promise((resolve, reject) => {
      server.close((error) => error && error.code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
      server.closeAllConnections();
    });
  } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  const log = arg("--log");
  const port = Number(arg("--port"));
  if (!log || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--log FILE --port PORT required");
  const ledger = createLedger({ record: (entry) => appendFileSync(log, JSON.stringify(entry) + "\n", { mode: 0o600 }) });
  ledger.server.on("error", () => {
    process.stderr.write("LAB ledger server or journal failed\n");
    process.exitCode = 1;
    ledger.close().catch(() => { process.stderr.write("LAB ledger shutdown failed\n"); });
  });
  ledger.server.listen(port, "127.0.0.1", () => console.log(`LAB ledger listening http://127.0.0.1:${port}/mcp-iskron`));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
    ledger.close().catch(() => { process.stderr.write("LAB ledger shutdown failed\n"); process.exitCode = 1; });
  });
}
