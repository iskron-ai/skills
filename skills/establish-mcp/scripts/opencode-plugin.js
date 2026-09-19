// js/shared/channel.ts
var SILENT_FLOOR_MS = Number(process.env.ISKRON_CHANNEL_SILENT_FLOOR_MS) || 6e4;
var FLAP_PAUSES_MS = (process.env.ISKRON_CHANNEL_FLAP_MS || "5000,10000,20000,40000,60000").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
function classifyOrigin(frame, myKarta) {
  const p = frame.provenance ?? {};
  const noAuthor = p.via === "room" && p.from_karta_seq == null && !p.from_standing;
  if (p.via === "platform" || p.auth === "none" || p.auth === "platform" || noAuthor)
    return "platform";
  if (p.as_person === true) return "human";
  if (p.from_karta_seq != null && p.user_karta_seq != null && p.from_karta_seq === p.user_karta_seq)
    return "human";
  if (myKarta != null && p.from_karta_seq != null && String(p.from_karta_seq) === String(myKarta))
    return "sibling";
  return "peer";
}

// js/shared/frame-text.ts
var NOT_ENVELOPE = /* @__PURE__ */ new Set(["body", "provenance", "type", "origin"]);
var ENVELOPE_FIRST = ["id", "received_at", "stale", "content_type", "body_chars", "body_read"];
function frameToText(frame, raw) {
  if (!frame) return `Кадр канала Искрона:
${raw}`;
  const p = frame.provenance ?? {};
  const origin = frame.origin ?? classifyOrigin(frame);
  const standing = p.from_standing ? ` — стояние ${p.from_standing}` : "";
  const role = p.from_karta_seq != null ? `роли #${p.from_karta_seq}` : "роли неизвестной";
  const who = origin === "platform" ? "от ПЛАТФОРМЫ — побудка, не человек и не делатель" : origin === "human" ? `от ЧЕЛОВЕКА${p.user ? ` @${p.user}` : ""} (${role})${standing}` : origin === "sibling" ? `от БРАТА по твоей роли (#${p.from_karta_seq})${standing} — другое стояние той же роли` : `от делателя ${role}${standing}`;
  const lines = [`Кадр канала Искрона ${who}`];
  const room = frame.room;
  if (room && typeof room === "object") {
    const f = frame;
    const zachin = typeof room.zachin === "string" ? ` «${room.zachin}»` : "";
    const kind = typeof f.kind === "string" ? `, род ${f.kind}` : "";
    const stack = typeof f.stack === "string" ? `, стопка ${f.stack}` : "";
    lines.push(
      origin === "platform" ? `запись КОМНАТЫ${zachin}${kind}${stack}` : `слово КОМНАТЫ${zachin}${kind}${stack} — ответ идёт записью в ту же комнату с in_reply_to по id слова (ход для комнат — в списке тулов сессии), не send стоянию`
    );
  }
  if (frame.provenance) lines.push(`provenance: ${JSON.stringify(frame.provenance)}`);
  const envelope = {};
  const rec = frame;
  for (const k of ENVELOPE_FIRST) if (rec[k] !== void 0) envelope[k] = rec[k];
  for (const k of Object.keys(rec))
    if (!(k in envelope) && !NOT_ENVELOPE.has(k) && rec[k] !== void 0) envelope[k] = rec[k];
  if (Object.keys(envelope).length) lines.push(`frame: ${JSON.stringify(envelope)}`);
  const body = typeof frame.body === "string" ? frame.body : frame.body === void 0 ? raw : JSON.stringify(frame.body, null, 1).replace(/\n\s*/g, " ");
  return `${lines.join("\n")}

${body}`;
}

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;

// js/shared/clients.ts
var OPENCODE_CLIENT = "opencode-iskron";

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.9.1";
function buildOf(selfUrl) {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}
function buildOfFile(path) {
  try {
    const src = readFileSync(path);
    const v = versionIn(src.toString("utf8")) ?? "?";
    return `v${v}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return null;
  }
}
function versionIn(text) {
  const m = /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1] : null;
}

// js/bridge/build.ts
var BUILD = buildOf(import.meta.url);

// js/bridge/config.ts
var DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";
var ENGLISH_SERVER_URL = "https://mcp.iskron.ai/";
var PRODUCTION_URLS = new Set([DEFAULT_SERVER_URL, ENGLISH_SERVER_URL].map(strip));
function strip(url) {
  return url.replace(/\/+$/, "");
}

// js/bridge/holdrecord.ts
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;

// js/shared/bridge-client.ts
import { spawn } from "node:child_process";
import { basename } from "node:path";
function bridgeRuntime() {
  const own = process.env.ISKRON_NODE?.trim();
  if (own) return { bin: own, env: process.env };
  if (process.versions?.bun)
    return { bin: process.execPath, env: { ...process.env, BUN_BE_BUN: "1" } };
  if (!/^node/i.test(basename(process.execPath))) return { bin: "node", env: process.env };
  return { bin: process.execPath, env: process.env };
}
var STOP_GRACE_MS = 5e3;
var Bridge = class {
  proc = null;
  buf = "";
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  tail = [];
  dead = null;
  bin;
  onLog;
  onNotification;
  onDie;
  constructor(bin, onLog, onNotification = () => {
  }, onDie = () => {
  }) {
    this.bin = bin;
    this.onLog = onLog;
    this.onNotification = onNotification;
    this.onDie = onDie;
  }
  /** Мост вышел или не запустился — вызовы к нему отвергаются этим отказом. */
  get failure() {
    return this.dead;
  }
  start() {
    const rt = bridgeRuntime();
    const proc = spawn(rt.bin, [this.bin], { stdio: ["pipe", "pipe", "pipe"], env: rt.env });
    this.proc = proc;
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk) => this.feed(chunk));
    proc.stderr?.setEncoding("utf8");
    let errBuf = "";
    proc.stderr?.on("data", (chunk) => {
      errBuf += chunk;
      const lines = errBuf.split("\n");
      errBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        this.tail.push(line);
        if (this.tail.length > 20) this.tail.shift();
        this.onLog(line);
      }
    });
    proc.on("error", (e) => this.die(new Error(`мост не запустился: ${e.message}`)));
    proc.on(
      "exit",
      (code, signal) => this.die(new Error(`мост вышел (code=${code}, signal=${signal})${this.why()}`))
    );
  }
  why() {
    return this.tail.length ? `; последнее от моста: ${this.tail.slice(-3).join(" | ")}` : "";
  }
  die(e) {
    if (this.dead) return;
    this.dead = e;
    for (const [, p] of this.pending) p.reject(e);
    this.pending.clear();
    try {
      this.onDie(e);
    } catch {
    }
  }
  feed(chunk) {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "").trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (typeof msg?.id !== "number") {
        if (typeof msg?.method === "string") this.onNotification(msg.method, msg.params);
        continue;
      }
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      if (msg.error)
        waiter.reject(
          Object.assign(new Error(msg.error.message || JSON.stringify(msg.error)), {
            code: msg.error.code
          })
        );
      else waiter.resolve(msg.result);
    }
  }
  notify(method, params) {
    if (this.dead || !this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  request(method, params, opts = {}) {
    if (this.dead) return Promise.reject(this.dead);
    const id = this.nextId++;
    return new Promise((res, rej) => {
      let timer = null;
      const settle = (fn) => (v) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      const resolve2 = settle(res);
      const reject = settle(rej);
      function onAbort() {
        reject(new Error("вызов отменён"));
      }
      this.pending.set(id, { resolve: resolve2, reject });
      if (opts.signal) {
        if (opts.signal.aborted) return onAbort();
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      if (opts.timeoutMs) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method}: нет ответа за ${opts.timeoutMs} мс${this.why()}`));
        }, opts.timeoutMs);
        timer.unref?.();
      }
      if (!this.proc?.stdin?.writable) return reject(new Error("мост не принимает запись"));
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  stop() {
    this.die(new Error("сессия закрыта"));
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.killed || proc.exitCode !== null) return;
    try {
      proc.stdin?.end();
      proc.kill("SIGTERM");
      const hard = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
        }
      }, STOP_GRACE_MS);
      hard.unref?.();
      proc.on("exit", () => clearTimeout(hard));
    } catch {
    }
  }
};
function toParameters(inputSchema) {
  const schema = inputSchema && typeof inputSchema === "object" ? { ...inputSchema } : { type: "object", properties: {} };
  delete schema.$schema;
  if (!schema.type) schema.type = "object";
  if (schema.type === "object" && !schema.properties) schema.properties = {};
  return schema;
}
function snippet(description) {
  const first = (description || "").split("\n").find((l) => l.trim()) ?? "";
  const cut = first.trim().split(/(?<=[.。!?])\s/)[0] ?? first.trim();
  return cut.length > 160 ? cut.slice(0, 157) + "…" : cut;
}
function resultToContent(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const out = blocks.map((b) => {
    if (b?.type === "text") return { type: "text", text: String(b.text ?? "") };
    if (b?.type === "image" && b.data) {
      return {
        type: "image",
        data: String(b.data),
        mimeType: String(b.mimeType ?? "image/png")
      };
    }
    return { type: "text", text: JSON.stringify(b) };
  });
  if (out.length) return out;
  const structured = result?.structuredContent;
  return [
    { type: "text", text: structured ? JSON.stringify(structured) : "(пустой ответ)" }
  ];
}

// js/opencode/bridge-io.ts
import {
  accessSync,
  constants,
  mkdirSync,
  readdirSync,
  readFileSync as readFileSync2,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve } from "node:path";

// js/shared/home.ts
import { homedir } from "node:os";
import { join } from "node:path";
var homeBridgePath = () => join(homedir(), ".iskron-bridge", "iskron-bridge.mjs");

// js/opencode/bridge-io.ts
var HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 6e5);
var AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 2e3);
var AUTH_PENDING = /authorization required/i;
var PROTOCOL = "2025-06-18";
function findBridge() {
  const tried = [];
  const env = process.env.ISKRON_BRIDGE_PATH?.trim();
  if (env) tried.push(resolve(env));
  tried.push(homeBridgePath());
  for (const candidate of tried) {
    try {
      accessSync(candidate, constants.R_OK);
      return { path: candidate, tried };
    } catch {
    }
  }
  return { path: null, tried };
}
function buildsLine(bridgePath, pluginUrl) {
  return `сборка: мост ${buildOfFile(bridgePath) ?? "не читается"}, плагин ${buildOf(pluginUrl)}`;
}
function authDir() {
  return process.env.ISKRON_BRIDGE_AUTH_DIR || join2(homedir2(), ".iskron-bridge");
}
function cachePath() {
  return join2(authDir(), "opencode-tools.json");
}
function grantStamp() {
  const dir = authDir();
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "opencode-tools.json").map((f) => `${f}:${statSync(join2(dir, f)).mtimeMs}`).sort().join("|");
  } catch {
    return "";
  }
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function readCache() {
  try {
    const list = JSON.parse(readFileSync2(cachePath(), "utf8"));
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}
function writeCache(tools) {
  try {
    mkdirSync(join2(cachePath(), ".."), { recursive: true, mode: 448 });
    writeFileSync(cachePath(), JSON.stringify(tools), { mode: 384 });
  } catch {
  }
}
function loginUrlOf(message) {
  return /open in a browser: (\S+)/.exec(message)?.[1] ?? null;
}
async function handshake(b, onLogin, onReady) {
  const deadline = Date.now() + HANDSHAKE_MS;
  for (; ; ) {
    const stamp = grantStamp();
    try {
      await b.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: OPENCODE_CLIENT, version: "1" }
        },
        { timeoutMs: Math.max(1, deadline - Date.now()) }
      );
      break;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!AUTH_PENDING.test(message)) throw e;
      onLogin(loginUrlOf(message));
      while (grantStamp() === stamp) {
        if (Date.now() + AUTH_POLL_MS > deadline) throw e;
        await sleep(AUTH_POLL_MS);
      }
    }
  }
  onReady();
  b.notify("notifications/initialized");
}
async function listTools(b) {
  const tools = [];
  let cursor;
  do {
    const page = await b.request("tools/list", cursor ? { cursor } : {}, {
      timeoutMs: HANDSHAKE_MS
    });
    for (const t of page?.tools ?? []) tools.push(t);
    cursor = page?.nextCursor;
  } while (cursor);
  return tools;
}
function textOf(result) {
  return resultToContent(result).map((c) => c.type === "text" ? c.text : "[image]").join("\n");
}
async function refreshToolList(b, state2, reload, say, live) {
  try {
    const list = await listTools(b);
    if (!live() || JSON.stringify(list) === JSON.stringify(state2.listed)) return;
    state2.listed = list;
    state2.source = "с сервера";
    writeCache(list);
    await reload();
    say(`Искрон: сервер сменил тулы — в сессии теперь ${list.length}.`, "info");
  } catch (e) {
    if (!live()) return;
    say(
      `Искрон: список тулов после смены на сервере не перечитан — ${e.message}`,
      "warning"
    );
  }
}

// js/opencode/keep.ts
import { mkdirSync as mkdirSync2, readdirSync as readdirSync2, readFileSync as readFileSync3, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
var WATCH_MS = Number(process.env.ISKRON_BRIDGE_WATCH_MS || 5 * 6e4);
var MARKER_PREFIX = "opencode-lost";
function writeLostMarker(authDir2, slots) {
  const entries = [...slots].filter((s) => s.holding && s.session).map((s) => ({ session: s.session, dir: s.dir, key: s.key, child: !!s.child }));
  if (!entries.length) return;
  try {
    mkdirSync2(authDir2, { recursive: true, mode: 448 });
    const lost = { at: (/* @__PURE__ */ new Date()).toISOString(), entries };
    const name = `${MARKER_PREFIX}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync2(join3(authDir2, name), JSON.stringify(lost), { mode: 384 });
  } catch {
  }
}
function takeLostMarker(authDir2) {
  const entries = [];
  let at = "";
  let files;
  try {
    files = readdirSync2(authDir2).filter((f) => f.startsWith(MARKER_PREFIX) && f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of files) {
    let text;
    try {
      text = readFileSync3(join3(authDir2, f), "utf8");
      unlinkSync(join3(authDir2, f));
    } catch {
      continue;
    }
    try {
      const lost = JSON.parse(text);
      if (lost?.at > at) at = lost.at;
      for (const e of lost?.entries ?? [])
        entries.push({
          session: e.session,
          dir: e.dir ?? null,
          key: e.key ?? null,
          child: !!e.child
        });
    } catch {
    }
  }
  if (!entries.length) return null;
  const when = new Date(at);
  const hhmm2 = Number.isNaN(when.getTime()) ? at : `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const where = entries.map((e) => e.key ?? e.dir ?? e.session).join(", ");
  return {
    text: `Искрон: слух был потерян в ${hhmm2} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand.`,
    entries
  };
}
function resumedWord(key, others) {
  const rest = Array.isArray(others) ? others.filter((k) => typeof k === "string") : [];
  return `Искрон: мост поднялся и сам вернул место ${key} — по своей записи держания (каталог сессии либо ключ прежнего места), без твоего хода. ` + (rest.length ? `В том же каталоге записи и других мест: ${rest.join(", ")} — каталог их не различает, возврат взял свежайшую. ` : "") + "Сверь имя с выведенным для этой сессии: чужое — займи своё одним iskron_stand; запись, уже ушедшую этим ходом, проверь по автору в истории узла — слово под чужим именем ляжет другому месту, а мост ответит успехом.";
}
function createKeeper(doors) {
  const roots = /* @__PURE__ */ new Set();
  const hints = /* @__PURE__ */ new Map();
  let stopped = false;
  function selector(slot) {
    if (slot.child) return slot.key ? { key: slot.key } : {};
    const key = slot.key ?? (slot.dir ? hints.get(slot.dir) : void 0);
    return { ...key ? { key } : {}, ...slot.dir ? { cwd: slot.dir } : {} };
  }
  async function resume(slot, root) {
    try {
      await doors.ready(slot);
      slot.dir ??= await doors.directoryOf(root);
      if (!slot.dir && !slot.key || slot.child && !slot.key || stopped) return;
      const r = await slot.bridge.request("iskron/resume", selector(slot), {
        timeoutMs: 3e4
      });
      if (!r?.resumed) return;
      slot.holding = true;
      slot.stood = true;
      if (typeof r.key === "string") slot.key = r.key;
      roots.add(root);
      doors.say(`Искрон: сессия ${root} — ${r.word}`, "info");
      if (typeof r.key === "string") doors.tell(root, resumedWord(r.key, r.others), slot.child);
    } catch (e) {
      doors.say(
        `Искрон: возврат места сессии ${root} не удался — ${e.message}`,
        "warning"
      );
    }
  }
  async function check(root) {
    const slot = await doors.slotFor(root, false);
    if (slot.resume) await slot.resume;
    if (!slot.dir) slot.dir = await doors.directoryOf(root);
    await doors.ready(slot);
    const r = await slot.bridge.request("iskron/check", selector(slot), {
      timeoutMs: 3e4
    });
    if (typeof r?.key === "string") slot.key = r.key;
    if (r?.holding) slot.holding = true;
    else if (r?.holding === false) {
      slot.holding = false;
      roots.delete(root);
    }
    if (r?.resumed) {
      doors.say(`Искрон: сторож слуха вернул место сессии ${root} — ${r.word}`, "info");
      if (typeof r.key === "string") doors.tell(root, resumedWord(r.key, r.others), slot.child);
    } else if (r?.reopened)
      doors.say(`Искрон: сторож слуха переоткрыл сокет сессии ${root} — ${r.word}`, "warning");
    else if (r?.stuck) doors.say(r.word, "error");
  }
  const timer = setInterval(() => {
    if (stopped) return;
    for (const root of roots)
      void check(root).catch(
        (e) => doors.say(`Искрон: сторож слуха сессии ${root} — ${e.message}`, "warning")
      );
  }, WATCH_MS);
  timer.unref?.();
  return {
    hint(entries) {
      for (const e of entries) if (e.dir && e.key && !e.child) hints.set(e.dir, e.key);
    },
    resume,
    stood(slot) {
      slot.holding = true;
      slot.stood = true;
      if (slot.session) roots.add(slot.session);
    },
    forget(root) {
      roots.delete(root);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

// js/opencode/status.ts
function statusLines(path, builds, login, state2, sessions, spare) {
  return [
    `мост: ${path}`,
    builds,
    login.loginPending ? `вход: НЕ ВЫПОЛНЕН — ${login.loginUrl ? `открой в браузере ${login.loginUrl}` : "заверши вход в браузере"}. Адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token (скилл establish-mcp).` : state2.serverSeen ? "вход: есть, сервер отвечает" : "вход: мост ещё не ответил (рукопожатие идёт)",
    `тулов iskron_*: ${state2.listed.length} (${state2.source})`,
    `мостов живых: ${sessions + spare}, сессий с мостом: ${sessions}`
  ].join("\n");
}

// js/opencode/tools.ts
var IDLE_MS = Number(process.env.ISKRON_BRIDGE_IDLE_MS || 30 * 6e4);
if (IDLE_MS <= WATCH_MS)
  process.stderr.write(
    `[iskron/warning] ISKRON_BRIDGE_IDLE_MS (${IDLE_MS}) не длиннее такта сторожа слуха (${WATCH_MS}): слот может быть сжат прежде возврата места
`
  );
var REAP_MS = Number(process.env.ISKRON_BRIDGE_REAP_MS || 6e4);
var STATUS_TOOL = "iskron_bridge";
var STAND_TOOL = "iskron_stand";
function standsBy(name, args) {
  if (name === STAND_TOOL) return true;
  return name === "iskron_channel" && ["connect", "mint", "register"].includes(String(args.action));
}
var hhmm = () => (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5);
async function setupTools(ctx, say, onChannel, rootOf) {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " + found.tried.join(", ") + ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error"
    );
    return { forget() {
    }, stop() {
    } };
  }
  const path = found.path;
  const builds = buildsLine(path, import.meta.url);
  const slots = /* @__PURE__ */ new Map();
  let spare = null;
  let stopped = false;
  let loginPending = false;
  let loginUrl = null;
  const loginWaiters = /* @__PURE__ */ new Set();
  function loginStarted() {
    if (loginPending) return { promise: Promise.resolve(), cancel() {
    } };
    let waiter = () => {
    };
    const promise = new Promise((r) => waiter = r);
    loginWaiters.add(waiter);
    return { promise, cancel: () => loginWaiters.delete(waiter) };
  }
  function onLogin(url) {
    for (const w of loginWaiters) w();
    loginWaiters.clear();
    if (loginPending && url === loginUrl) return;
    loginPending = true;
    loginUrl = url;
    say(
      `Искрон: нужен вход — ${url ? `открой ${url} и заверши его` : "заверши его в браузере"}; адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token. Тулы iskron_* поднимутся после входа сами.`,
      "warning"
    );
  }
  function loginError() {
    return new Error(
      `Искрон: нужен вход в граф — ${loginUrl ? `открой в браузере ${loginUrl}` : "заверши вход в браузере"} и повтори вызов. Адрес локальный для машины OpenCode: с другой — ssh -L <порт>:127.0.0.1:<порт>; на безголовой машине положи личный токен в ~/.iskron-bridge/token (скилл establish-mcp).`
    );
  }
  function spawn2() {
    const slot = {
      bridge: null,
      ready: Promise.resolve(),
      session: null,
      holding: false,
      stood: false,
      dir: null,
      key: null,
      resume: null,
      lastCall: Date.now(),
      busy: 0,
      ownStop: false
    };
    slot.bridge = new Bridge(
      path,
      (line) => say(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        if (method === "notifications/tools/list_changed") return void relist(slot.bridge);
        if (method !== "notifications/message" || params?.logger !== "iskron-channel") return;
        const kind = params?.data?.kind;
        if (kind === "held" || kind === "attached" || params?.data?.frame?.type === "hello")
          keeper.stood(slot);
        if ((kind === "held" || kind === "released") && typeof params?.data?.key === "string")
          slot.key = params.data.key;
        if (kind === "released" || kind === "dead" || kind === "evicted") slot.holding = false;
        onChannel(slot.session, params, !!slot.child);
      },
      (e) => {
        if (slot.ownStop || stopped || !slot.holding) return;
        slot.holding = false;
        onChannel(slot.session, {
          logger: "iskron-channel",
          data: {
            kind: "lost",
            text: `Искрон: слух потерян в ${hhmm()} — мост стояния вышел (${e.message}). Сторож слуха поднимет мост и вернёт место с диска; не ждёшь — iskron_stand.`
          }
        });
      }
    );
    slot.bridge.start();
    shake(slot);
    return slot;
  }
  const keeper = createKeeper({
    say,
    tell: (root, text, child) => onChannel(root, { logger: "iskron-channel", data: { kind: "resumed", text } }, !!child),
    slotFor: (root, touch) => slotFor(root, touch),
    ready: readyFor,
    directoryOf
  });
  const lost = takeLostMarker(authDir());
  let lostWord = lost?.text ?? null;
  if (lost) {
    say(lost.text, "warning");
    keeper.hint(lost.entries);
  }
  function shake(slot) {
    slot.ready = handshake(slot.bridge, onLogin, () => {
      loginPending = false;
      loginUrl = null;
    });
    slot.ready.catch(() => {
    });
  }
  async function readyFor(slot) {
    try {
      await slot.ready;
    } catch {
      shake(slot);
      await slot.ready;
    }
  }
  async function directoryOf(sessionID) {
    try {
      const res = await ctx.session.get({ sessionID });
      const dir = res?.location?.directory ?? res?.data?.location?.directory;
      return typeof dir === "string" && dir.trim() ? dir : null;
    } catch {
      return null;
    }
  }
  async function slotFor(sessionID, touch = true) {
    const root = await rootOf(sessionID);
    const own = root !== sessionID ? slots.get(sessionID) : void 0;
    if (own) {
      const live = own.bridge.failure ? childSlot(sessionID) : own;
      if (touch) live.lastCall = Date.now();
      return live;
    }
    let slot = slots.get(root);
    let dead;
    if (slot?.bridge.failure) {
      dead = slot;
      slots.delete(root);
      slot = void 0;
    }
    if (!slot) {
      slot = spare ?? spawn2();
      spare = null;
      slot.session = root;
      slot.dir = dead?.dir ?? slot.dir;
      slot.key = dead?.key ?? slot.key;
      slots.set(root, slot);
      if (lostWord) {
        onChannel(root, { logger: "iskron-channel", data: { kind: "lost", text: lostWord } });
        lostWord = null;
      }
      const s = slot;
      s.resume = keeper.resume(s, root).finally(() => s.resume = null);
    }
    if (touch) slot.lastCall = Date.now();
    return slot;
  }
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [session, slot] of slots) {
      if (slot.holding || slot.busy > 0 || now - slot.lastCall < IDLE_MS) continue;
      slot.ownStop = true;
      slot.bridge.stop();
      slots.delete(session);
    }
    if (spare && !spare.holding && now - spare.lastCall >= IDLE_MS && state2.serverSeen) {
      spare.ownStop = true;
      spare.bridge.stop();
      spare = null;
    }
  }, REAP_MS);
  reaper.unref?.();
  const state2 = {
    listed: readCache() ?? [],
    source: "из прошлого списка",
    serverSeen: false
  };
  const relist = (b) => b && refreshToolList(
    b,
    state2,
    () => ctx.tool.reload(),
    say,
    () => !stopped
  );
  const statusText = () => statusLines(path, builds, { loginPending, loginUrl }, state2, slots.size, spare ? 1 : 0);
  await ctx.tool.transform((editor) => {
    editor.add({
      name: STATUS_TOOL,
      description: "Состояние моста Искрона в этой сессии OpenCode: выполнен ли вход, адрес авторизации, сколько тулов iskron_* поднято. Зови, когда тулов iskron_* нет или они отвечают отказом входа.",
      input: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return { content: statusText() };
      }
    });
    for (const t of state2.listed) {
      const name = String(t.name);
      editor.add({
        name,
        description: String(t.description ?? ""),
        // JSON Schema сервера без паспорта диалекта — той же срезкой, что у pi.
        input: toParameters(t.inputSchema),
        async execute(input, tool) {
          const slot = await slotFor(String(tool.sessionID));
          slot.busy++;
          try {
            return await callThrough(slot, name, input, String(tool.sessionID));
          } finally {
            slot.busy--;
            slot.lastCall = Date.now();
          }
        }
      });
    }
  });
  function childSlot(sessionID) {
    const have = slots.get(sessionID);
    if (have && !have.bridge.failure) return have;
    const own = spawn2();
    own.session = sessionID;
    own.child = true;
    own.dir = have?.dir ?? null;
    own.key = have?.key ?? null;
    slots.set(sessionID, own);
    if (have?.stood && own.key)
      own.resume = keeper.resume(own, sessionID).finally(() => own.resume = null);
    return own;
  }
  async function awaitReady(slot) {
    if (loginPending) throw loginError();
    const login = loginStarted();
    try {
      await Promise.race([
        readyFor(slot),
        login.promise.then(() => {
          throw loginError();
        })
      ]);
    } finally {
      login.cancel();
    }
  }
  async function callThrough(slot, name, input, sessionID) {
    await awaitReady(slot);
    if (slot.resume) await slot.resume;
    const args = { ...input ?? {} };
    if (standsBy(name, args) && slot.session !== sessionID) {
      slot = childSlot(sessionID);
      await awaitReady(slot);
    }
    if (name === STAND_TOOL && !args.cwd) {
      const dir = slot.dir ??= await directoryOf(slot.session ?? sessionID);
      if (dir) args.cwd = dir;
    }
    const result = await slot.bridge.request("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(textOf(result) || `${name}: отказ без текста`);
    if (standsBy(name, args)) keeper.stood(slot);
    return { content: textOf(result) };
  }
  if (state2.listed.length)
    say(`Искрон: тулов из прошлого списка: ${state2.listed.length}; сверю с сервером.`, "info");
  spare = spawn2();
  let first = spare;
  void (async () => {
    for (; ; ) {
      if (stopped) return;
      try {
        await first.ready;
        const list = await listTools(first.bridge);
        state2.serverSeen = true;
        const same = JSON.stringify(list) === JSON.stringify(state2.listed);
        state2.listed = list;
        state2.source = "с сервера";
        writeCache(list);
        if (!same) await ctx.tool.reload();
        say(`Искрон: мост поднят, тулов в сессии: ${list.length} (с сервера).`, "info");
        return;
      } catch (e) {
        if (stopped) return;
        if (first.bridge.failure) {
          if (first.session === null)
            say(`Искрон: мост умер (${e.message}) — поднимаю новый.`, "warning");
          if (spare === first) spare = null;
          first = spare ?? spawn2();
          spare = first;
        } else {
          shake(first);
        }
        await sleep(AUTH_POLL_MS);
      }
    }
  })();
  return {
    forget(session) {
      keeper.forget(session);
      const slot = slots.get(session);
      if (!slot) return;
      slots.delete(session);
      slot.ownStop = true;
      slot.bridge.stop();
    },
    stop() {
      stopped = true;
      clearInterval(reaper);
      keeper.stop();
      writeLostMarker(authDir(), slots.values());
      if (spare) spare.ownStop = true;
      spare?.bridge.stop();
      spare = null;
      for (const slot of slots.values()) {
        slot.ownStop = true;
        slot.bridge.stop();
      }
      slots.clear();
    }
  };
}

// js/opencode/channel.ts
function setupChannel(ctx, say, freshestRoot) {
  async function accepting(id) {
    try {
      const info = await ctx.session.get({ sessionID: id });
      return !(info?.time?.archived ?? info?.data?.time?.archived);
    } catch {
      return false;
    }
  }
  async function deliver(session, text, frame = "кадр", delivery = "steer", child = false) {
    let id = session;
    if (child && (!id || !await accepting(id))) {
      say(
        `Искрон: ${frame} на место дочерней сессии ${id ?? "?"}, которой больше нет, — корню не переадресую; кадр остаётся в истории стояния (iskron_channel history); место дочерней сессии — лишнее на канале, где корень стоит дальше: снимать ли его revoke, решай, зная цену (standing) —${text.slice(0, 120)}`,
        "error"
      );
      return;
    }
    if (id && !await accepting(id)) {
      say(
        `Искрон: сессия ${id} закрыта или в архиве — ${frame} идёт в свежайшую виденную`,
        "warning"
      );
      id = null;
    }
    id ??= freshestRoot();
    if (id && id !== session && !await accepting(id)) id = null;
    if (!id) {
      say(
        `Искрон: ${frame} ВЛОЖИТЬ НЕКУДА — плагин не видел живой корневой сессии; кадр остаётся в истории стояния — ` + text.slice(0, 120),
        "error"
      );
      return;
    }
    try {
      await ctx.session.prompt({ sessionID: id, text, delivery });
      say(`Искрон: ${frame} вложен в сессию ${id}`, "info");
    } catch (e) {
      say(`Искрон: ${frame} не вложился в сессию ${id}: ${e.message}`, "error");
    }
  }
  function loud(session, text) {
    say(text, "error");
    void deliver(session, text);
  }
  return {
    onEvent(session, params, child = false) {
      const ev = params?.data;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          const stack = frame?.stack;
          void deliver(
            session,
            frameToText(frame, ev.raw ?? ""),
            `кадр ${frame?.id ?? "без id"}`,
            stack === "defer" ? "queue" : "steer",
            child
          );
          return;
        }
        case "dead":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` + (ev.code === 4001 ? ' или action="mint"' : "") + ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен."
          );
          return;
        case "stale":
          if (ev.text) void deliver(session, ev.text, "пачка лежалых кадров", "queue");
          return;
        case "backlog":
          if (ev.text)
            void deliver(session, ev.text, `пачка побудки (${ev.frames?.length ?? 0})`, "queue");
          return;
        case "lost":
          if (ev.text) loud(session, ev.text);
          return;
        case "resumed":
          if (ev.text) {
            say(ev.text, "warning");
            void deliver(session, ev.text, "слово о возвращённом месте");
          }
          return;
        case "held":
          say(`Искрон: мост держит стояние ${ev.key ?? ""}`, "info");
          return;
        case "released":
          say(`Искрон: мост отпустил стояние ${ev.key ?? ""} — ${ev.text ?? ""}`, "warning");
          return;
        case "evicted":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. Привязка записей цела; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека.`
          );
          return;
        case "alive":
          loud(
            session,
            `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; не пройдёт — спроси о токене.`
          );
          return;
        case "note":
          if (ev.text) say(`Искрон: ${ev.text}`, "warning");
          return;
        default:
          return;
      }
    }
  };
}

// js/opencode/commands.ts
import { readFileSync as readFileSync4 } from "node:fs";
function slashOf(markdown) {
  if (!markdown.startsWith("---")) return false;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return false;
  const head = markdown.slice(3, end);
  return /^slash:\s*true\s*$/m.test(head);
}
function commandText(id, args) {
  return `Загрузи скилл \`${id}\` инструментом \`skill\` (id: \`${id}\`) и действуй строго по нему. Это набрал человек, а не ты; его слова — ниже.

` + args.trim();
}
async function listSkills(ctx) {
  const res = await ctx.skill.list();
  const list = Array.isArray(res) ? res : res?.data ?? [];
  const out = [];
  for (const s of list) {
    const id = String(s?.id ?? "");
    const path = typeof s?.path === "string" ? s.path : null;
    if (!id || !path) continue;
    let text;
    try {
      text = readFileSync4(path, "utf8");
    } catch {
      continue;
    }
    if (!slashOf(text)) continue;
    out.push({ id, description: snippet(String(s?.description ?? "")) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
async function setupCommands(ctx, say) {
  const state2 = { commands: await listSkills(ctx) };
  await ctx.command.transform((editor) => {
    for (const { id, description } of state2.commands) {
      editor.add({
        name: id,
        description,
        async execute({ sessionID, prompt, delivery }) {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: commandText(id, String(prompt?.text ?? "")),
            delivery
          });
        }
      });
    }
  });
  if (state2.commands.length)
    say(`Искрон: команд «/» по скиллам поставки: ${state2.commands.length}.`, "info");
  return {
    async refresh() {
      const next = await listSkills(ctx);
      const same = next.length === state2.commands.length && next.every((c, i) => c.id === state2.commands[i]?.id);
      state2.commands = next;
      if (!same) await ctx.command.reload();
    }
  };
}

// js/opencode/plugin.ts
async function setup(ctx) {
  const say = (text, level) => {
    process.stderr.write(`[iskron${level === "info" ? "" : "/" + level}] ${text}
`);
  };
  const roots = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Map();
  async function rootOf(sessionID) {
    const known = roots.get(sessionID);
    if (known) {
      seen.set(known, Date.now());
      return known;
    }
    let root = sessionID;
    try {
      const visited = /* @__PURE__ */ new Set();
      for (; ; ) {
        visited.add(root);
        const res = await ctx.session.get({ sessionID: root });
        const parent = res?.parentID ?? res?.data?.parentID;
        if (!parent || visited.has(parent)) break;
        root = parent;
      }
    } catch {
      seen.set(root, Date.now());
      return root;
    }
    roots.set(sessionID, root);
    seen.set(root, Date.now());
    return root;
  }
  function freshestRoot() {
    let best = null;
    let at = -1;
    for (const [id, t] of seen) {
      if (t <= at) continue;
      best = id;
      at = t;
    }
    return best;
  }
  let onChannel = () => {
  };
  try {
    const ch = setupChannel(ctx, say, freshestRoot);
    onChannel = (s, p, c) => ch.onEvent(s, p, c);
  } catch (e) {
    say(`Искрон: канал не встал — ${e.message}`, "error");
  }
  let half = { forget() {
  }, stop() {
  } };
  try {
    half = await setupTools(ctx, say, onChannel, rootOf);
  } catch (e) {
    say(`Искрон: мост не поднялся — ${e.message}`, "error");
  }
  let commands = { refresh: async () => {
  } };
  try {
    commands = await setupCommands(ctx, say);
  } catch (e) {
    say(`Искрон: команды скиллов не встали — ${e.message}`, "error");
  }
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const ev = event;
        const id = ev?.data?.sessionID;
        switch (ev?.type) {
          case "session.deleted":
            if (!id) break;
            roots.delete(id);
            seen.delete(id);
            half.forget(id);
            break;
          case "session.created": {
            if (!id) break;
            const parent = ev.data?.parentID;
            if (typeof parent === "string")
              void rootOf(parent).then((root) => {
                roots.set(id, root);
                seen.set(root, Date.now());
              });
            else void rootOf(id);
            break;
          }
          case "skill.updated":
            void commands.refresh();
            break;
        }
      }
    } catch {
    }
  })();
  return () => {
    controller.abort();
    half.stop();
  };
}
var plugin_default = { id: "iskron", setup };
export {
  plugin_default as default
};
