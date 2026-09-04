#!/usr/bin/env node
// A stand-in for iskron-bridge, spoken to exactly as the pi extension speaks to
// the real one: MCP over stdio, NDJSON both ways. Not a test file — the probe
// (tests/extension.test.mjs) points ISKRON_BRIDGE_PATH at it.
//
// It exists because the extension's tools half is only observable through a
// child process: it spawns `node <bridge>`, initializes, pages tools/list, and
// proxies tools/call. The real bridge would want the network and a browser; this
// one wants a few env vars.
//
//   FB_LOG        file to append "start <pid>" to the moment this starts, so the
//                 probe can see BOTH that a bridge was spawned at all and, by the
//                 pid, that session_shutdown really killed it.
//   FB_MODE       ok (default) · mute (reads, never answers — a bridge stuck in
//                 someone's browser) · die (exits at once — a broken install)
//   FB_TOOLS      JSON array for tools/list; default is two tools, one of them
//                 iskron_channel, since that is the name the extension watches.
//   FB_PAGINATE   "1" splits tools/list across two pages with a cursor.
//   FB_REPLY      file holding the text of the NEXT tools/call answer; the probe
//                 rewrites it between calls. "__ERROR__<text>" answers isError.
import { appendFileSync, readFileSync } from "node:fs";

const MODE = process.env.FB_MODE || "ok";
if (process.env.FB_LOG) appendFileSync(process.env.FB_LOG, `start ${process.pid}\n`);
if (MODE === "die") process.exit(3);

const TOOLS = JSON.parse(process.env.FB_TOOLS || JSON.stringify([
  {
    name: "iskron_channel",
    description: "Живой канал делателя.\nВторая строка описания.",
    inputSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { action: { type: "string", enum: ["connect", "mint", "register"] } },
      required: ["action"],
    },
  },
  { name: "iskron_orient", description: "Ориентация в графе.", inputSchema: { type: "object", properties: {} } },
]));

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });

function callResult(name) {
  let text = `ok:${name}`;
  if (process.env.FB_REPLY) {
    try { text = readFileSync(process.env.FB_REPLY, "utf8"); } catch { /* keep the default */ }
  }
  if (text.startsWith("__ERROR__")) {
    return { isError: true, content: [{ type: "text", text: text.slice("__ERROR__".length) }] };
  }
  return { content: [{ type: "text", text }] };
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (typeof msg.id !== "number") continue; // notifications need no answer
    if (MODE === "mute") continue;            // ...and neither does anything, in this mode
    if (msg.method === "initialize") {
      ok(msg.id, { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake-nks", version: "0" } });
    } else if (msg.method === "tools/list") {
      if (process.env.FB_PAGINATE === "1") {
        // The second page is only reachable through the cursor loop; a client
        // that reads one page and stops registers half the surface.
        if (!msg.params?.cursor) ok(msg.id, { tools: TOOLS.slice(0, 1), nextCursor: "p2" });
        else ok(msg.id, { tools: TOOLS.slice(1) });
      } else ok(msg.id, { tools: TOOLS });
    } else if (msg.method === "tools/call") {
      ok(msg.id, callResult(msg.params?.name));
    } else {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `нет метода ${msg.method}` } });
    }
  }
});
