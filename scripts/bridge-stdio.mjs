// A session with the delivery's own bridge (skills/establish-mcp/scripts/iskron.mjs)
// over stdio, for the scripts that snapshot the live graph (export-surface,
// export-widgets): auth, refresh and liveness are the bridge's problem.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function openBridge(args = []) {
  const bridge = join(root, "skills/establish-mcp/scripts/iskron.mjs");
  const child = spawn("node", [bridge, ...args], { stdio: ["pipe", "pipe", "inherit"] });
  const replies = new Map();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (m.id !== undefined) replies.set(m.id, m);
      } catch {}
    }
  });
  let id = 1;
  const send = (m) => child.stdin.write(JSON.stringify(m) + "\n");
  const wait = async (want, ms = 120_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (replies.has(want)) return replies.get(want);
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`no reply for ${want}`);
  };
  const request = async (method, params) => {
    const my = id++;
    send({ jsonrpc: "2.0", id: my, method, params });
    return wait(my);
  };

  // On a cold token store the bridge answers at once with the login link
  // instead of blocking on a human — that is its whole promise. So the script
  // does what a harness does: surface the link and keep calling until the click
  // lands. `client` stands in OWN_CLIENTS (js/shared/clients.ts): the bridge
  // refuses such a handshake over a login instead of answering it from its
  // cache — a snapshot written from a stale answer would pass for the live one.
  async function initialize(client) {
    let announced = false;
    const deadline = Date.now() + 300_000; // the bridge's own flow timeout
    for (;;) {
      const res = await request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: client, version: "0" },
      });
      if (!res.error) {
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        return res;
      }
      const url = /(http:\/\/127\.0\.0\.1:\d+\/login\?k=[\w-]+|https?:\/\/\S*\/authorize\?\S+)/.exec(
        res.error.message || "",
      )?.[1];
      if (!url) throw new Error(`initialize failed: ${JSON.stringify(res.error)}`);
      if (!announced) {
        console.error(`authorization needed — open this, then this script continues on its own:\n  ${url}`);
        announced = true;
      }
      if (Date.now() > deadline) throw new Error("the authorization was never completed");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /** A tool call's text; a refusal throws with the tool's own words. */
  async function tool(name, args) {
    const res = await request("tools/call", { name, arguments: args });
    const text = (res.result?.content ?? []).map((c) => c.text ?? "").join("\n");
    if (res.error || res.result?.isError) throw new Error(`${name}: ${res.error?.message ?? text}`);
    return text;
  }

  return { initialize, request, tool, close: () => child.stdin.end() };
}
