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
//   FB_LOG        file to append "start <pid> [flags]" to the moment this starts, so the
//                 probe can see BOTH that a bridge was spawned at all and, by the
//                 pid, that session_shutdown really killed it.
//   FB_MODE       ok (default) · mute (reads, never answers — a bridge stuck in
//                 someone's browser) · die (exits at once — a broken install) ·
//                 auth (no grant yet: every request is refused -32001
//                 «authorization required», as the real bridge refuses it while
//                 its browser flow waits for the human, until FB_AUTHED exists)
//                 · net (every request refused -32001 «upstream unreachable» — the
//                 same code as the login refusal, a different word: the extension
//                 must not mistake it for a login to wait for), until the file
//                 FB_NET_UP exists — the network is back
//   FB_AUTHED     with FB_MODE=auth: the file whose existence means the human has
//                 finished the login in the browser.
//   FB_DEVICE     with FB_MODE=auth: the sign-in page with a code the refusal also
//                 names — the same login from another device (#6570).
//   FB_DEVICE_FILE with FB_MODE=auth: file holding that page, re-read on every
//                 refusal — the bridge issuing a new code when the old one lapses.
//   FB_DEVICE_UNSET with FB_MODE=auth and no page: the bridge's word why there is
//                 no code — the server has no client for it (#6619).
//   FB_DEVICE_LEFT_S with a page: seconds the code has left at each refusal,
//                 named as its end in UTC, as the bridge names it; default 300.
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
//                 <FB_REPLY>.<tool>, when present, answers only that tool.
//   FB_STAND_HELD place name an iskron_stand says «held» for (satellite: <of>.sub-1).
//   FB_INITS      file to append "<pid> <ms>" to for every initialize received.
//   FB_ENV        file to append one JSON line to at start: the ISKRON_HARNESS_VERSION
//                 and ISKRON_SKILLS_ROOT the launcher handed this bridge (null — none), #6226.
//   FB_USAGE_DELAY_MS the first iskron/usage is answered this much later; with FB_CALLS
//                 every answer is logged as iskron/usage:answered.
import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";

const MODE = process.env.FB_MODE || "ok";
if (process.env.FB_ENV)
  appendFileSync(
    process.env.FB_ENV,
    JSON.stringify({
      harness_version: process.env.ISKRON_HARNESS_VERSION ?? null,
      skills_root: process.env.ISKRON_SKILLS_ROOT ?? null,
    }) + "\n",
  );
// The flags follow the pid: the OpenCode probe reads `--satellite` off a child session's bridge (#6002).
if (process.env.FB_LOG)
  appendFileSync(
    process.env.FB_LOG,
    `start ${[process.pid, ...process.argv.slice(2)].join(" ")}\n`,
  );
if (MODE === "die") process.exit(3);
// FB_DIE_ONCE: a file whose presence makes this bridge exit at once — and it is
// removed, so the next bridge lives (one broken start among good ones).
if (process.env.FB_DIE_ONCE && existsSync(process.env.FB_DIE_ONCE)) {
  unlinkSync(process.env.FB_DIE_ONCE);
  process.exit(3);
}

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
      // Only finished lines: a long append is read half-written now and then.
      const lines = text
        .split("\n")
        .slice(0, -1)
        .filter((l) => l.trim());
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
    // <FB_REPLY>.<tool>, when it exists, answers that one tool — the rest keep FB_REPLY.
    for (const file of [`${process.env.FB_REPLY}.${name}`, process.env.FB_REPLY]) {
      try {
        text = readFileSync(file, "utf8");
        break;
      } catch {
        /* next, or keep the default */
      }
    }
  }
  if (text.startsWith("__ERROR__")) {
    return { isError: true, content: [{ type: "text", text: text.slice("__ERROR__".length) }] };
  }
  return { content: [{ type: "text", text }] };
}

let buf = "";
let usageDelayed = false;
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
    // Notifications need no answer; a request's id is a number or a string (service moves: iskron-service-N).
    if (typeof msg.id !== "number" && typeof msg.id !== "string") continue;
    // FB_INITS: a line per initialize received — how often a client re-handshakes.
    if (msg.method === "initialize" && process.env.FB_INITS)
      appendFileSync(process.env.FB_INITS, `${process.pid} ${Date.now()}\n`);
    if (MODE === "mute") continue; // ...and neither does anything, in this mode
    if (MODE === "net" && !existsSync(process.env.FB_NET_UP || "")) {
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
      const device = process.env.FB_DEVICE_FILE
        ? readFileSync(process.env.FB_DEVICE_FILE, "utf8").trim()
        : process.env.FB_DEVICE;
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: -32001,
          message:
            "iskron-bridge v0+fake: authorization required — open in a browser: " +
            "http://127.0.0.1:43265/authorize?fake=1" +
            (device
              ? ` — or sign in from another device: ${device} (code FAKE1234, valid until ` +
                new Date(Date.now() + Number(process.env.FB_DEVICE_LEFT_S || 300) * 1000)
                  .toISOString()
                  .replace("T", " ")
                  .slice(0, 19) +
                " UTC; a call after that brings a new one)"
              : process.env.FB_DEVICE_UNSET
                ? ` — no sign-in by code: ${process.env.FB_DEVICE_UNSET}`
                : "") +
            " — or give the bridge a personal access " +
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
          JSON.stringify({ ...msg.params, pid: process.pid, id: msg.id }) + "\n",
        );
      // FB_STAND_HELD: the place name an iskron_stand holds — said as «held» before
      // the answer, as the real bridge says it (js/bridge/hold.ts); a satellite
      // stands as <satellite_of>.sub-1.
      if (process.env.FB_STAND_HELD && msg.params?.name === "iskron_stand") {
        const a = msg.params.arguments ?? {};
        const name = a.satellite_of ? `${a.satellite_of}.sub-1` : process.env.FB_STAND_HELD;
        send({
          jsonrpc: "2.0",
          method: "notifications/message",
          params: {
            level: "info",
            logger: "iskron-channel",
            data: {
              kind: "held",
              key: `k-${name}`,
              place: { realm: a.realm, karta: a.karta, name },
            },
          },
        });
      }
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
        // {bySession: {<session>: answer}} — an answer for one session's bridge, the rest as without a file.
        if (result.bySession)
          result = result.bySession[msg.params?.session] ?? {
            resumed: false,
            holding: false,
            word: "записи держания нет",
          };
      } catch {
        /* no answer prepared — nothing to resume */
      }
      ok(msg.id, result);
    } else if (msg.method === "iskron/suspend") {
      // The OpenCode plugin pauses a satellite before its stop (js/bridge/suspend.ts, #6625).
      if (process.env.FB_CALLS)
        appendFileSync(
          process.env.FB_CALLS,
          JSON.stringify({ name: msg.method, arguments: msg.params, pid: process.pid }) + "\n",
        );
      ok(msg.id, { suspended: true });
    } else if (msg.method === "iskron/end") {
      // The plugin ends a lead child's run before its stop (js/bridge/runend.ts);
      // FB_END_FAILED — places the bridge could not revoke (comma-separated).
      if (process.env.FB_CALLS)
        appendFileSync(
          process.env.FB_CALLS,
          JSON.stringify({ name: msg.method, arguments: msg.params, pid: process.pid }) + "\n",
        );
      // FB_END_DELAY_MS — the answer comes this much later: a revoke with its retry, live ~2 s.
      const failed = (process.env.FB_END_FAILED ?? "").split(",").filter(Boolean);
      setTimeout(
        () => ok(msg.id, { ended: true, failed }),
        Number(process.env.FB_END_DELAY_MS || 0),
      );
    } else if (msg.method === "iskron/usage") {
      // The session's spend from the OpenCode plugin (js/bridge/usage.ts, #6271).
      if (process.env.FB_CALLS)
        appendFileSync(
          process.env.FB_CALLS,
          JSON.stringify({ name: msg.method, arguments: msg.params, pid: process.pid }) + "\n",
        );
      // FB_USAGE_DELAY_MS: the first snapshot's answer comes this much later — a
      // register in flight — and its answer is logged, so the probe sees the order.
      const answer = () => {
        if (process.env.FB_CALLS)
          appendFileSync(
            process.env.FB_CALLS,
            JSON.stringify({
              name: "iskron/usage:answered",
              arguments: msg.params,
              pid: process.pid,
            }) + "\n",
          );
        ok(msg.id, { pushed: true });
      };
      const delayMs = Number(process.env.FB_USAGE_DELAY_MS || 0);
      if (delayMs && !usageDelayed) {
        usageDelayed = true;
        setTimeout(answer, delayMs);
      } else answer();
    } else {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `нет метода ${msg.method}` },
      });
    }
  }
});
