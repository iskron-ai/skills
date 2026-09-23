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

// js/shared/clients.ts
var PI_CLIENT = "pi-iskron";

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.12.0";
function buildOf(selfUrl) {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
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

// js/shared/room-kinds.ts
var WORDS = {
  said: "слово от {author}",
  closing: "ведущий {author} предлагает закрыть комнату до {ends_at}; свидетельства: {evidence}",
  closing_may: "ты можешь возразить — objection, in_reply_to={entry_id}",
  closing_not: "возражать не тебе",
  closed: "комната закрыта: {reason}",
  objection: "{author} возражает против закрытия: {reason}",
  late_objection: "{author} возразил после закрытия",
  progress: "{author}: [{key}] {done} = {verdict}{; note}",
  lead: "ведёт {author}",
  opened: "комнату открыл {author}",
  joined: "вошёл {author}",
  left: "вышел {author}",
  invite: "{target} приглашён",
  withdraw: "приглашение отозвано",
  accepted: "{target} принял приглашение",
  node: "в комнате узел #{seq} {name} ({realm})",
  link: "комната связана с {room}",
  unknown: "род {kind} мосту неизвестен"
};
var RULES = {
  said: "stack",
  closing: "interrupt",
  closed: "interrupt",
  objection: "interrupt",
  late_objection: "interrupt",
  invite: "mine",
  progress: "batch",
  lead: "batch",
  opened: "batch",
  joined: "batch",
  left: "batch",
  withdraw: "batch",
  accepted: "batch",
  node: "batch",
  link: "batch"
};
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var str = (v) => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
function authorOf(line) {
  const a = obj(line.author);
  const name = str(a.name);
  const standing = str(a.standing);
  if (name) return standing ? `${name} (${standing})` : name;
  if (standing) return standing;
  return a.kind === "platform" ? "платформа" : "?";
}
var after = (key, prefix) => key.startsWith(prefix) ? key.slice(prefix.length) : key;
function fill(template, v) {
  return template.replace(/\{([^\w{}]*)(\w+)\}/g, (_m, sep, name) => {
    const x = str(v[name]);
    if (sep) return x ? sep + x : "";
    return x || "?";
  });
}
var mineOf = (frame) => [str(frame.to_standing_id), str(frame.to_standing)].filter(Boolean);
function roomKind(frame) {
  if (!frame || typeof frame !== "object") return null;
  const f = frame;
  const ek = f.event_kind;
  if (typeof ek !== "string" || !ek.startsWith("room.")) return null;
  const kind = ek.slice(5);
  const line = obj(f.line);
  const fields = obj(line.fields);
  const key = str(line.key);
  const mine = mineOf(f);
  const node = obj(fields.node);
  const values = {
    kind,
    author: authorOf(line),
    key,
    done: line.done,
    verdict: line.verdict,
    note: line.note,
    ends_at: fields.ends_at,
    evidence: Array.isArray(fields.evidence) ? fields.evidence.map(str).join(", ") : "",
    entry_id: line.entry_id ?? f.entry_id,
    reason: fields.reason,
    target: after(key, "invite:"),
    room: after(key, "link:"),
    seq: node.seq,
    name: node.name,
    realm: node.realm
  };
  const rule = RULES[kind];
  if (!rule) return { kind, rule: "batch", words: fill(WORDS.unknown, values), known: false };
  let words = fill(WORDS[kind], values);
  if (kind === "closing") {
    const may = Array.isArray(fields.may_object) ? fields.may_object.map(str) : [];
    const myId = str(f.to_standing_id);
    const mayI = !!myId && may.includes(myId);
    words += "; " + fill(mayI ? WORDS.closing_may : WORDS.closing_not, values);
  }
  const stack = rule === "stack" ? (
    // Стопка решает только у said; слово без стопки — прежним путём, вставкой.
    f.stack === "defer" ? "batch" : "interrupt"
  ) : rule === "mine" ? mine.includes(str(values.target)) ? "interrupt" : "batch" : rule;
  return { kind, rule: stack, words, known: true };
}
var byKind = (frame) => roomKind(frame) !== null;
var stackOf = (frame) => roomKind(frame)?.rule ?? (frame?.stack === "defer" ? "batch" : "interrupt");

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
    const zachin = typeof room.zachin === "string" ? ` «${room.zachin}»` : "";
    const rk = roomKind(frame);
    const f = frame;
    const words = rk ? `: ${rk.words}` : (typeof f.kind === "string" ? `, род ${f.kind}` : "") + (typeof f.stack === "string" ? `, стопка ${f.stack}` : "");
    lines.push(
      origin === "platform" ? `запись КОМНАТЫ${zachin}${words}` : `слово КОМНАТЫ${zachin}${words} — ответ идёт записью в ту же комнату с in_reply_to по id слова (ход для комнат — в списке тулов сессии), не send стоянию`
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

// js/bridge/roomstack.ts
var ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 6e4;

// js/bridge/holdrecord.ts
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;

// js/extension/channel.ts
function setupChannel(pi) {
  let ctxRef = null;
  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
  });
  pi.on("session_shutdown", async () => {
    ctxRef = null;
  });
  function loud(text, fatal = true) {
    if (ctxRef?.hasUI) ctxRef.ui.notify(text, fatal ? "error" : "warning");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal } },
      { triggerTurn: true, deliverAs: "steer" }
    );
  }
  return (params) => {
    const ev = params?.data;
    if (!ev || typeof ev !== "object") return;
    switch (ev.kind) {
      case "frame": {
        const frame = ev.frame ?? null;
        const raw = ev.raw ?? "";
        if (frame?.type === "hello") {
          if (ctxRef?.hasUI) ctxRef.ui.setStatus?.("iskron", "Искрон: канал слушает");
          return;
        }
        if (frame?.type === "status") return;
        const later = byKind(frame) && stackOf(frame) === "batch";
        pi.sendMessage(
          {
            customType: "iskron-channel",
            content: frameToText(frame, raw),
            display: true,
            details: frame ?? { raw }
          },
          { triggerTurn: true, deliverAs: later ? "followUp" : "steer" }
        );
        return;
      }
      case "dead":
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` + (ev.code === 4001 ? ' или action="mint"' : "") + ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен."
        );
        return;
      case "stale":
      case "backlog":
        if (ev.text)
          pi.sendMessage(
            {
              customType: "iskron-channel",
              content: ev.text,
              display: true,
              details: ev.kind === "stale" ? { stale: true } : { backlog: true }
            },
            { triggerTurn: true, deliverAs: "steer" }
          );
        return;
      case "evicted":
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. Привязка записей цела; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека.`
        );
        return;
      case "alive":
        loud(
          `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; не пройдёт — спроси о токене.`,
          false
        );
        return;
      case "note":
        if (ctxRef?.hasUI && ev.text) ctxRef.ui.notify(`Искрон: ${ev.text}`, "warning");
        return;
      case "attached":
      case "held":
      case "released":
      case "lost":
      case "resumed":
        return;
    }
  };
}

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

// js/extension/home-copy.ts
import {
  accessSync,
  chmodSync,
  constants,
  readFileSync as readFileSync2,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// js/shared/home.ts
import { homedir } from "node:os";
import { join } from "node:path";
var homeBridgePath = () => join(homedir(), ".iskron-bridge", "iskron-bridge.mjs");

// js/extension/home-copy.ts
function newer(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some((n) => !Number.isInteger(n)))
    return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}
function packagedBridgePath() {
  return resolve(
    dirname(fileURLToPath2(import.meta.url)),
    "..",
    "skills",
    "establish-mcp",
    "scripts",
    "iskron.mjs"
  );
}
function refreshHomeBridge(notify, canSpeak) {
  if (process.env.ISKRON_BRIDGE_PATH?.trim()) return;
  if (!canSpeak) return;
  let packagedPath;
  try {
    packagedPath = packagedBridgePath();
  } catch {
    return;
  }
  const homePath = homeBridgePath();
  let packaged;
  try {
    packaged = readFileSync2(packagedPath);
  } catch {
    return;
  }
  const vPackaged = versionIn(packaged.toString("utf8"));
  if (!vPackaged) {
    notify(
      "Искрон: в поставке мост есть, но его версия не читается — домашнюю копию не трогаю.",
      "warning"
    );
    return;
  }
  let home;
  try {
    home = readFileSync2(homePath);
  } catch {
    return;
  }
  if (home.equals(packaged)) return;
  const vHome = versionIn(home.toString("utf8"));
  if (vHome && newer(vHome, vPackaged) > 0) {
    notify(
      `Искрон: дома мост ${vHome}, в поставке ${vPackaged} — домашний новее, не трогаю.`,
      "warning"
    );
    return;
  }
  const was = vHome ?? "версия не читается";
  const tmp = `${homePath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, packaged);
    chmodSync(tmp, 493);
    renameSync(tmp, homePath);
    notify(
      vHome === vPackaged ? `Искрон: мост дома заменён на привезённый поставкой — версия та же (${vPackaged}), байты другие. Грант не тронут.` : `Искрон: мост дома обновлён ${was} → ${vPackaged}. Грант не тронут, он лежит рядом отдельными файлами.`,
      "info"
    );
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    notify(
      `Искрон: мост дома ${was}, в поставке ${vPackaged}, заменить не вышло (${e.message}). Работаю тем, что есть.`,
      "warning"
    );
  }
}
function findBridge() {
  const tried = [];
  const push = (p) => {
    if (!p) return;
    tried.push(p);
  };
  push(
    process.env.ISKRON_BRIDGE_PATH?.trim() ? resolve(process.env.ISKRON_BRIDGE_PATH.trim()) : null
  );
  try {
    push(packagedBridgePath());
  } catch {
  }
  push(homeBridgePath());
  for (const candidate of tried) {
    try {
      accessSync(candidate, constants.R_OK);
      return { path: candidate, tried };
    } catch {
    }
  }
  return { path: null, tried };
}

// js/extension/tools.ts
var READY_WAIT_MS = Number(process.env.ISKRON_MCP_READY_WAIT_MS || 2e4);
var HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 6e5);
var TICK_MS = 15e3;
var AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 3e3);
var AUTH_PENDING = /authorization required/i;
var PROTOCOL = "2025-06-18";
function setupBridge(pi, onChannel) {
  let bridge = null;
  const offByUs = /* @__PURE__ */ new Set();
  const known = /* @__PURE__ */ new Set();
  let notify = () => {
  };
  let canSpeak = false;
  async function raise() {
    refreshHomeBridge(notify, canSpeak);
    const found = findBridge();
    if (!found.path) {
      notify(
        "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " + found.tried.join(", ") + ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
        "error"
      );
      return;
    }
    const b = new Bridge(
      found.path,
      (line) => notify(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        if (method === "notifications/message" && params?.logger === "iskron-channel")
          onChannel(params);
        if (method === "notifications/tools/list_changed") void relist(b);
      }
    );
    bridge = b;
    b.start();
    let toldLogin = false;
    const deadline = Date.now() + HANDSHAKE_MS;
    const untilAuthed = async (ask) => {
      for (; ; ) {
        try {
          return await ask();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!AUTH_PENDING.test(message) || bridge !== b || Date.now() + AUTH_POLL_MS > deadline)
            throw e;
          if (!toldLogin) {
            toldLogin = true;
            notify(`Искрон: нужен вход — ${message}`, "warning");
          }
          await new Promise((r) => setTimeout(r, AUTH_POLL_MS));
        }
      }
    };
    const init = await untilAuthed(
      () => b.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: PI_CLIENT, version: "1" }
        },
        { timeoutMs: HANDSHAKE_MS }
      )
    );
    if (bridge !== b) return b.stop();
    b.notify("notifications/initialized");
    const tools = [];
    let cursor;
    do {
      const page = await untilAuthed(
        () => b.request("tools/list", cursor ? { cursor } : {}, {
          timeoutMs: HANDSHAKE_MS
        })
      );
      for (const t of page?.tools ?? []) tools.push(t);
      cursor = page?.nextCursor;
    } while (cursor);
    if (bridge !== b) return b.stop();
    function registerAll(list) {
      for (const t of list) known.add(String(t.name));
      for (const tool of list) {
        const name = String(tool.name);
        pi.registerTool({
          name,
          label: name,
          description: String(tool.description ?? ""),
          promptSnippet: snippet(String(tool.description ?? "")),
          parameters: toParameters(tool.inputSchema),
          async execute(_toolCallId, params, signal, onUpdate, _c) {
            const live = bridge;
            if (!live) throw new Error(`${name}: мост не поднят в этой сессии`);
            const started = Date.now();
            onUpdate?.({ content: [{ type: "text", text: `Искрон: ${name}…` }], details: {} });
            const tick = setInterval(() => {
              onUpdate?.({
                content: [
                  {
                    type: "text",
                    text: `Искрон: ${name} — ещё жду, ${Math.round((Date.now() - started) / 1e3)} с`
                  }
                ],
                details: {}
              });
            }, TICK_MS);
            tick.unref?.();
            try {
              const result = await live.request(
                "tools/call",
                { name, arguments: params ?? {} },
                { signal }
                // потолка нет: первый вызов может уйти в браузер к человеку
              );
              if (result?.isError) {
                const text = resultToContent(result).map((c) => c.type === "text" ? c.text : "[image]").join("\n");
                throw new Error(text || `${name}: отказ без текста`);
              }
              const content = resultToContent(result);
              return {
                content,
                details: { tool: name, structuredContent: result?.structuredContent }
              };
            } finally {
              clearInterval(tick);
            }
          }
        });
      }
    }
    async function relist(from) {
      if (bridge !== from) return;
      try {
        const fresh = [];
        let next;
        do {
          const page = await from.request("tools/list", next ? { cursor: next } : {}, {
            timeoutMs: HANDSHAKE_MS
          });
          for (const t of page?.tools ?? []) fresh.push(t);
          next = page?.nextCursor;
        } while (next);
        if (bridge !== from) return;
        const kept = new Set(fresh.map((t) => String(t.name)));
        const dropped = tools.map((t) => String(t.name)).filter((n) => !kept.has(n));
        registerAll(fresh);
        const back = [...offByUs].filter((n) => kept.has(n));
        for (const n of dropped) offByUs.add(n);
        for (const n of back) offByUs.delete(n);
        if (dropped.length || back.length)
          pi.setActiveTools([
            .../* @__PURE__ */ new Set([...pi.getActiveTools().filter((n) => !dropped.includes(n)), ...back])
          ]);
        tools.splice(0, tools.length, ...fresh);
        notify(`Искрон: сервер сменил тулы — в сессии зарегистрировано ${fresh.length}.`, "info");
      } catch (e) {
        if (bridge !== from) return;
        notify(
          `Искрон: список тулов после смены на сервере не перечитан — ${e.message}`,
          "warning"
        );
      }
    }
    const listed = new Set(tools.map((t) => String(t.name)));
    const gone = [...known].filter((n) => !listed.has(n));
    const returned = [...offByUs].filter((n) => listed.has(n));
    registerAll(tools);
    for (const n of gone) offByUs.add(n);
    for (const n of returned) offByUs.delete(n);
    if (gone.length || returned.length)
      pi.setActiveTools([
        .../* @__PURE__ */ new Set([...pi.getActiveTools().filter((n) => !gone.includes(n)), ...returned])
      ]);
    const server = init?.serverInfo;
    notify(
      `Искрон: мост поднят (${server?.name ?? "сервер"} ${server?.version ?? ""}), тулов в сессии: ${tools.length}${toldLogin ? " — вход состоялся" : ""}.`,
      "info"
    );
  }
  pi.on("session_start", async (_event, ctx) => {
    notify = ctx.hasUI ? (t, l) => ctx.ui.notify(t, l ?? "info") : () => {
    };
    canSpeak = Boolean(ctx.hasUI);
    bridge?.stop();
    bridge = null;
    const work = raise().catch((e) => {
      notify(`Искрон: мост не поднялся — ${e.message}`, "error");
      bridge?.stop();
      bridge = null;
    });
    let done = false;
    void work.then(() => {
      done = true;
    });
    await Promise.race([
      work,
      new Promise((r) => {
        const t = setTimeout(() => {
          if (!done) {
            notify(
              "Искрон: мост ещё поднимается — тулы iskron_* появятся, как только ответит.",
              "info"
            );
          }
          r();
        }, READY_WAIT_MS);
        t.unref?.();
      })
    ]);
  });
  pi.on("session_shutdown", async () => {
    bridge?.stop();
    bridge = null;
  });
}

// js/extension/iskron.ts
function iskron_default(pi) {
  const broken = [];
  pi.on("session_start", async (_event, ctx) => {
    if (!broken.length || !ctx.hasUI) return;
    ctx.ui.notify(`Искрон: не встало — ${broken.join("; ")}`, "error");
  });
  let onChannel = () => {
  };
  try {
    onChannel = setupChannel(pi);
  } catch (e) {
    broken.push(`канал: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    setupBridge(pi, (params) => onChannel(params));
  } catch (e) {
    broken.push(`тулы: ${e instanceof Error ? e.message : String(e)}`);
  }
}
export {
  iskron_default as default
};
