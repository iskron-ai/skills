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
//                 someone's browser) · die (exits at once — a broken install) ·
//                 auth (no grant yet: every request is refused -32001
//                 «authorization required», as the real bridge refuses it while
//                 its browser flow waits for the human, until FB_AUTHED exists)
//                 · net (every request refused -32001 «upstream unreachable» — the
//                 same code as the login refusal, a different word: the extension
//                 must not mistake it for a login to wait for)
//   FB_AUTHED     with FB_MODE=auth: the file whose existence means the human has
//                 finished the login in the browser.
//   FB_TOOLS      JSON array for tools/list; default is two tools, one of them
//                 iskron_channel, since that is the name the extension watches.
//   FB_PAGINATE   "1" splits tools/list across two pages with a cursor.
//   FB_TOOLS_FILE file with a JSON tools array, re-read on every tools/list —
//                 the server's list changing under a live bridge.
//   FB_CHANGED    file whose appearance makes this bridge say
//                 notifications/tools/list_changed once (and remove the file),
//                 as the real bridge does after a rollout (#5406).
//   FB_REPLY      file holding the text of the NEXT tools/call answer; the probe
//                 rewrites it between calls. "__ERROR__<text>" answers isError.
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";

const MODE = process.env.FB_MODE || "ok";
if (process.env.FB_LOG) appendFileSync(process.env.FB_LOG, `start ${process.pid}\n`);
if (MODE === "die") process.exit(3);

const TOOLS = JSON.parse(
  process.env.FB_TOOLS ||
    JSON.stringify([
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
      {
        name: "iskron_orient",
        description: "Ориентация в графе.",
        inputSchema: { type: "object", properties: {} },
      },
    ]),
);

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

// FB_EVENTS: файл, каждая новая строка которого — событие стояния, которое
// настоящий мост шлёт уведомлением notifications/message с logger
// iskron-channel (см. js/bridge/hold.ts). Проба дописывает строки, фейк их
// эмитит — так половина «канал» расширения проверяется без сокета вовсе.
// Файлов два: общий (FB_EVENTS) и свой у процесса (FB_EVENTS.<pid>) — так проба
// адресует событие одному из нескольких мостов, поднятых одним плагином.
if (process.env.FB_EVENTS) {
  const seen = new Map();
  const files = [process.env.FB_EVENTS, `${process.env.FB_EVENTS}.${process.pid}`];
  setInterval(() => {
    for (const file of files) {
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines.slice(seen.get(file) ?? 0)) {
        send({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: { level: "info", logger: "iskron-channel", data: JSON.parse(line) },
        });
      }
      seen.set(file, lines.length);
    }
  }, 40).unref();
}
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const currentTools = () =>
  process.env.FB_TOOLS_FILE && existsSync(process.env.FB_TOOLS_FILE)
    ? JSON.parse(readFileSync(process.env.FB_TOOLS_FILE, "utf8"))
    : TOOLS;
if (process.env.FB_CHANGED) {
  const flag = process.env.FB_CHANGED;
  setInterval(() => {
    if (!existsSync(flag)) return;
    try {
      unlinkSync(flag);
    } catch {}
    send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  }, 100).unref();
}

function callResult(name) {
  let text = `ok:${name}`;
  if (process.env.FB_REPLY) {
    try {
      text = readFileSync(process.env.FB_REPLY, "utf8");
    } catch {
      /* keep the default */
    }
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
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof msg.id !== "number") continue; // notifications need no answer
    if (MODE === "mute") continue; // ...and neither does anything, in this mode
    if (MODE === "net") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: -32001,
          message:
            "iskron-bridge v0+fake: upstream unreachable: fetch failed (ECONNREFUSED). " +
            "The call never reached the server, so nothing was applied — retry freely. The bridge stays up.",
        },
      });
      continue;
    }
    if (MODE === "auth" && !existsSync(process.env.FB_AUTHED || "")) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: -32001,
          message:
            "iskron-bridge v0+fake: authorization required — open in a browser: " +
            "http://127.0.0.1:43265/authorize?fake=1 — or give the bridge a personal access " +
            "token instead (ISKRON_BRIDGE_TOKEN, or the file <auth-dir>/token). " +
            "The call never reached the server, so nothing was applied — retry freely. " +
            "The bridge stays up.",
        },
      });
      continue;
    }
    if (msg.method === "initialize") {
      ok(msg.id, {
        protocolVersion: "2025-06-18",
        capabilities: {},
        serverInfo: { name: "fake-nks", version: "0" },
      });
    } else if (msg.method === "tools/list") {
      if (process.env.FB_PAGINATE === "1") {
        // The second page is only reachable through the cursor loop; a client
        // that reads one page and stops registers half the surface.
        if (!msg.params?.cursor)
          ok(msg.id, { tools: currentTools().slice(0, 1), nextCursor: "p2" });
        else ok(msg.id, { tools: currentTools().slice(1) });
      } else ok(msg.id, { tools: currentTools() });
    } else if (msg.method === "tools/call") {
      // FB_CALLS: file to append each tools/call's params to, one JSON per line —
      // the probe reads what the plugin actually sent, not only what it got back.
      // …with this process's pid, so a probe can tell WHICH bridge served a call.
      if (process.env.FB_CALLS)
        appendFileSync(
          process.env.FB_CALLS,
          JSON.stringify({ ...msg.params, pid: process.pid }) + "\n",
        );
      ok(msg.id, callResult(msg.params?.name));
    } else if (msg.method === "iskron/resume" || msg.method === "iskron/check") {
      // The bridge's own requests from the OpenCode plugin (js/bridge/resume.ts):
      // logged in the same shape as a tool call; FB_RESUME names a file whose
      // JSON is the answer — without it the bridge has nothing to resume.
      if (process.env.FB_CALLS)
        appendFileSync(
          process.env.FB_CALLS,
          JSON.stringify({ name: msg.method, arguments: msg.params, pid: process.pid }) + "\n",
        );
      let result = { resumed: false, holding: false, word: "записи держания нет" };
      try {
        if (process.env.FB_RESUME) result = JSON.parse(readFileSync(process.env.FB_RESUME, "utf8"));
      } catch {
        /* no answer prepared — nothing to resume */
      }
      ok(msg.id, result);
    } else {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `нет метода ${msg.method}` },
      });
    }
  }
});
