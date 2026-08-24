#!/usr/bin/env node
// Regenerate fixtures/surface.json — the committed snapshot of the live nks-mcp
// tool surface that `make check-surface` lints the corpus against.
//
// Run when the server surface changes (needs network + an authorized grant):
//   node scripts/export-surface.mjs [server-url]
//
// Speaks to the server through the delivery's own bridge
// (skills/establish-mcp/scripts/iskron-bridge.mjs), so auth, refresh and liveness
// are the bridge's problem, not this script's.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bridge = join(root, "skills/establish-mcp/scripts/iskron-bridge.mjs");
const args = process.argv[2] ? [process.argv[2]] : [];

const child = spawn("node", [bridge, ...args], { stdio: ["pipe", "pipe", "inherit"] });
const replies = new Map();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    try { const m = JSON.parse(line); if (m.id !== undefined) replies.set(m.id, m); } catch {}
  }
});
const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
const wait = async (id, ms = 120_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (replies.has(id)) return replies.get(id);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no reply for ${id}`);
};

// On a cold token store the bridge answers at once with the authorize URL
// instead of blocking on a human — that is its whole promise. So this script
// must do what a harness does: surface the URL and keep calling until the click
// lands, rather than treating the first answer as a verdict.
let id = 1;
async function initialize() {
  let announced = false;
  const deadline = Date.now() + 300_000; // the bridge's own flow timeout
  for (;;) {
    send({ jsonrpc: "2.0", id, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {},
      clientInfo: { name: "export-surface", version: "0" } } });
    const res = await wait(id++);
    if (!res.error) return res;
    const url = /(https?:\/\/\S*\/authorize\?\S+)/.exec(res.error.message || "")?.[1];
    if (!url) throw new Error(`initialize failed: ${JSON.stringify(res.error)}`);
    if (!announced) {
      console.error(`authorization needed — open this, then this script continues on its own:\n  ${url}`);
      announced = true;
    }
    if (Date.now() > deadline) throw new Error("the authorization was never completed");
    await new Promise((r) => setTimeout(r, 3000));
  }
}
const init = await initialize();
send({ jsonrpc: "2.0", method: "notifications/initialized" });

const tools = [];
let cursor;
do {
  send({ jsonrpc: "2.0", id, method: "tools/list", params: cursor ? { cursor } : {} });
  const res = await wait(id++);
  if (res.error) throw new Error(`tools/list failed: ${JSON.stringify(res.error)}`);
  tools.push(...res.result.tools);
  cursor = res.result.nextCursor;
} while (cursor);

// Merge every enum-carrying property across all tool input schemas: one
// vocabulary per property name (union — a property may legitimately differ in
// subsets per tool; the lint asks membership, not exactness).
const enums = {};
const walk = (schema, name) => {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.enum) && name) {
    enums[name] = [...new Set([...(enums[name] || []), ...schema.enum])].sort();
  }
  for (const [k, v] of Object.entries(schema.properties || {})) walk(v, k);
  if (schema.items) walk(schema.items, name);
  for (const sub of ["anyOf", "oneOf", "allOf"]) (schema[sub] || []).forEach((v) => walk(v, name));
};
for (const t of tools) walk(t.inputSchema, null);

const surface = {
  server: init.result?.serverInfo ?? null,
  protocolVersion: init.result?.protocolVersion ?? null,
  tools: tools.map((t) => t.name).sort(),
  enums,
};
const out = join(root, "fixtures/surface.json");
writeFileSync(out, JSON.stringify(surface, null, 2) + "\n");
console.log(`wrote ${out}: ${surface.tools.length} tools, ${Object.keys(enums).length} enum vocabularies`);
child.stdin.end();
