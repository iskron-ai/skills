// js/shared/channel.ts
var FLAP_PAUSES_MS = (process.env.ISKRON_CHANNEL_FLAP_MS || "5000,10000,20000,40000,60000").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
function classifyOrigin(frame, myKarta) {
  const p = frame.provenance ?? {};
  if (p.via === "platform" || p.auth === "none") return "platform";
  if (p.as_person === true) return "human";
  if (p.from_karta_seq != null && p.user_karta_seq != null && p.from_karta_seq === p.user_karta_seq)
    return "human";
  if (myKarta != null && p.from_karta_seq != null && String(p.from_karta_seq) === String(myKarta))
    return "sibling";
  return "peer";
}

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.6.3";
function buildOf(selfUrl) {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}

// js/bridge/build.ts
var BUILD = buildOf(import.meta.url);

// js/shared/frame-text.ts
var ENVELOPE_KEYS = ["id", "received_at", "stale", "content_type", "body_chars", "body_read"];
function frameToText(frame, raw) {
  if (!frame) return `Кадр канала Искрона:
${raw}`;
  const p = frame.provenance ?? {};
  const origin = frame.origin ?? classifyOrigin(frame);
  const standing = p.from_standing ? ` — стояние ${p.from_standing}` : "";
  const role = p.from_karta_seq != null ? `роли #${p.from_karta_seq}` : "роли неизвестной";
  const who = origin === "platform" ? "от ПЛАТФОРМЫ — побудка, не человек и не делатель" : origin === "human" ? `от ЧЕЛОВЕКА${p.user ? ` @${p.user}` : ""} (${role})${standing}` : origin === "sibling" ? `от БРАТА по твоей роли (#${p.from_karta_seq})${standing} — другое стояние той же роли` : `от делателя ${role}${standing}`;
  const lines = [`Кадр канала Искрона ${who}`];
  if (frame.provenance) lines.push(`provenance: ${JSON.stringify(frame.provenance)}`);
  const envelope = {};
  for (const k of ENVELOPE_KEYS) if (frame[k] !== void 0) envelope[k] = frame[k];
  if (Object.keys(envelope).length) lines.push(`frame: ${JSON.stringify(envelope)}`);
  const body = typeof frame.body === "string" ? frame.body : raw;
  return `${lines.join("\n")}

${body}`;
}

// js/opencode/channel.ts
function setupChannel(client, say) {
  async function freshestRoot() {
    try {
      const res = await client.session.list();
      const roots = (res?.data ?? []).filter((s) => !s.parentID);
      roots.sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
      return roots[0]?.id ?? null;
    } catch {
      return null;
    }
  }
  async function deliver(session, text) {
    const id = session ?? await freshestRoot();
    if (!id) {
      say(
        "Искрон: кадр пришёл, а сессии, куда его вложить, нет — " + text.slice(0, 120),
        "warning"
      );
      return;
    }
    try {
      await client.session.promptAsync({
        path: { id },
        body: { parts: [{ type: "text", text }] }
      });
    } catch (e) {
      say(`Искрон: кадр не вложился в сессию ${id}: ${e.message}`, "error");
    }
  }
  function loud(session, text) {
    say(text, "error");
    void deliver(session, text);
  }
  return {
    onEvent(session, params) {
      const ev = params?.data;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          void deliver(session, frameToText(frame, ev.raw ?? ""));
          return;
        }
        case "dead":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` + (ev.code === 4001 ? ' или action="mint"' : "") + ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен."
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

// js/opencode/tools.ts
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
import { tool as tool2 } from "@opencode-ai/plugin";

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
  constructor(bin, onLog, onNotification = () => {
  }) {
    this.bin = bin;
    this.onLog = onLog;
    this.onNotification = onNotification;
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
      if (msg.error) waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
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
      }, 2e3);
      hard.unref?.();
      proc.on("exit", () => clearTimeout(hard));
    } catch {
    }
  }
};
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

// js/shared/home.ts
import { homedir } from "node:os";
import { join } from "node:path";
var homeBridgePath = () => join(homedir(), ".iskron-bridge", "iskron-bridge.mjs");

// js/opencode/schema.ts
import { tool } from "@opencode-ai/plugin";
function one(p, z) {
  if (Array.isArray(p?.enum) && p.enum.length && p.enum.every((e) => typeof e === "string"))
    return z.enum(p.enum);
  const types = Array.isArray(p?.type) ? p.type : [p?.type];
  const t = types.find((x) => x !== "null");
  let s;
  switch (t) {
    case "string":
      s = z.string();
      break;
    case "number":
    case "integer":
      s = z.number();
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "array":
      s = z.array(z.any());
      break;
    case "object":
      s = z.record(z.string(), z.any());
      break;
    default:
      s = z.any();
  }
  return types.includes("null") ? s.nullable() : s;
}
function argsFrom(inputSchema, z = tool.schema) {
  const props = inputSchema && typeof inputSchema.properties === "object" ? inputSchema.properties : {};
  const required = new Set(
    Array.isArray(inputSchema?.required) ? inputSchema.required : []
  );
  const out = {};
  for (const [key, p] of Object.entries(props)) {
    let s = one(p, z);
    if (typeof p?.description === "string" && p.description) s = s.describe(p.description);
    if (!required.has(key)) s = s.optional();
    out[key] = s;
  }
  return out;
}

// js/opencode/tools.ts
var READY_WAIT_MS = Number(process.env.ISKRON_MCP_READY_WAIT_MS || 2e4);
var HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 6e5);
var AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 2e3);
var AUTH_PENDING = /authorization required/i;
var IDLE_MS = Number(process.env.ISKRON_BRIDGE_IDLE_MS || 30 * 6e4);
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
function abortable(p, signal) {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new Error("вызов отменён"));
  return new Promise((res, rej) => {
    const onAbort = () => rej(new Error("вызов отменён"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        res(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        rej(e instanceof Error ? e : new Error(String(e)));
      }
    );
  });
}
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
async function handshake(b, onLogin, onLoggedIn) {
  const deadline = Date.now() + HANDSHAKE_MS;
  let waited = false;
  for (; ; ) {
    const stamp = grantStamp();
    try {
      await b.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: "opencode-iskron", version: "1" }
        },
        { timeoutMs: Math.max(1, deadline - Date.now()) }
      );
      break;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!AUTH_PENDING.test(message)) throw e;
      waited = true;
      onLogin(loginUrlOf(message));
      while (grantStamp() === stamp) {
        if (Date.now() + AUTH_POLL_MS > deadline) throw e;
        await sleep(AUTH_POLL_MS);
      }
    }
  }
  if (waited) onLoggedIn();
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
async function setupTools(say, onChannel, rootOf) {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " + found.tried.join(", ") + ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error"
    );
    return { tools: {}, forget() {
    }, stop() {
    } };
  }
  const path = found.path;
  const slots = /* @__PURE__ */ new Map();
  let spare = null;
  let loginPending = false;
  let loginUrl = null;
  let loginSeen = () => {
  };
  const loginStarted = new Promise((r) => loginSeen = r);
  function onLogin(url) {
    loginSeen();
    if (loginPending && url === loginUrl) return;
    loginPending = true;
    loginUrl = url;
    say(
      `Искрон: нужен вход — ${url ? `открой ${url} и заверши его` : "заверши его в браузере"}; мост ждёт до ${Math.round(HANDSHAKE_MS / 6e4)} мин, тулы iskron_* поднимутся после.`,
      "warning"
    );
  }
  function spawn2() {
    const slot = {
      bridge: null,
      ready: Promise.resolve(),
      session: null,
      holding: false,
      lastCall: Date.now()
    };
    slot.bridge = new Bridge(
      path,
      (line) => say(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        if (method !== "notifications/message" || params?.logger !== "iskron-channel") return;
        const kind = params?.data?.kind;
        if (kind === "attached") slot.holding = true;
        if (kind === "released" || kind === "dead") slot.holding = false;
        onChannel(slot.session, params);
      }
    );
    slot.bridge.start();
    shake(slot);
    return slot;
  }
  function shake(slot) {
    slot.ready = handshake(slot.bridge, onLogin, () => {
      loginPending = false;
      loginUrl = null;
    });
    slot.ready.catch(() => {
    });
  }
  async function readyFor(slot, signal) {
    try {
      await abortable(slot.ready, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      shake(slot);
      await abortable(slot.ready, signal);
    }
  }
  async function slotFor(sessionID) {
    const root = await rootOf(sessionID);
    let slot = slots.get(root);
    if (!slot) {
      slot = spare ?? spawn2();
      spare = null;
      slot.session = root;
      slots.set(root, slot);
    }
    slot.lastCall = Date.now();
    return slot;
  }
  spare = spawn2();
  const first = spare;
  const listing = first.ready.then(() => listTools(first.bridge)).then((list) => {
    writeCache(list);
    return list;
  });
  listing.catch(() => {
  });
  let listed = null;
  await Promise.race([
    listing.then(
      (l) => {
        listed = l;
      },
      () => {
      }
    ),
    loginStarted,
    new Promise((r) => setTimeout(r, READY_WAIT_MS).unref?.())
  ]);
  let source = "с сервера";
  if (!listed) {
    listed = readCache();
    source = "из прошлого списка";
    if (!listed && loginPending) {
      listed = await listing.catch(() => null);
      source = "с сервера, после входа";
    }
    if (!listed) {
      say(
        (loginPending ? `Искрон: вход не завершён за ${Math.round(HANDSHAKE_MS / 6e4)} мин и прошлого списка тулов нет — ` : `Искрон: мост не ответил за ${Math.round(READY_WAIT_MS / 1e3)} с и прошлого списка тулов нет — `) + "тулов iskron_* не будет до перезапуска OpenCode. Проверь `node ~/.iskron-bridge/iskron-bridge.mjs doctor`.",
        "error"
      );
      first.bridge.stop();
      return { tools: {}, forget() {
      }, stop() {
      } };
    }
  }
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [session, slot] of slots) {
      if (slot.holding || now - slot.lastCall < IDLE_MS) continue;
      slot.bridge.stop();
      slots.delete(session);
    }
  }, 6e4);
  reaper.unref?.();
  const tools = {};
  for (const t of listed) {
    const name = String(t.name);
    tools[name] = tool2({
      description: String(t.description ?? ""),
      args: argsFrom(t.inputSchema),
      async execute(args, ctx) {
        const slot = await slotFor(ctx.sessionID);
        await readyFor(slot, ctx.abort);
        const result = await slot.bridge.request(
          "tools/call",
          { name, arguments: args ?? {} },
          { signal: ctx.abort }
          // потолка нет: первый вызов может уйти в браузер к человеку
        );
        if (result?.isError) throw new Error(textOf(result) || `${name}: отказ без текста`);
        return {
          title: name,
          output: textOf(result),
          metadata: result?.structuredContent ? { structuredContent: result.structuredContent } : {}
        };
      }
    });
  }
  say(`Искрон: мост поднят, тулов в сессии: ${Object.keys(tools).length} (${source}).`, "info");
  return {
    tools,
    forget(session) {
      const slot = slots.get(session);
      if (!slot) return;
      slots.delete(session);
      slot.bridge.stop();
    },
    stop() {
      clearInterval(reaper);
      spare?.bridge.stop();
      spare = null;
      for (const slot of slots.values()) slot.bridge.stop();
      slots.clear();
    }
  };
}

// js/opencode/plugin.ts
var IskronPlugin = async ({ client }) => {
  const say = (text, level) => {
    process.stderr.write(`[iskron] ${text}
`);
    void client.tui.showToast({ body: { message: text, variant: level === "warning" ? "warning" : level } }).catch(() => {
    });
  };
  const roots = /* @__PURE__ */ new Map();
  async function rootOf(sessionID) {
    const known = roots.get(sessionID);
    if (known) return known;
    let root = sessionID;
    try {
      const seen = /* @__PURE__ */ new Set();
      for (; ; ) {
        seen.add(root);
        const res = await client.session.get({ path: { id: root } });
        const parent = res?.data?.parentID;
        if (!parent || seen.has(parent)) break;
        root = parent;
      }
    } catch {
    }
    roots.set(sessionID, root);
    return root;
  }
  let onChannel = () => {
  };
  try {
    const ch = setupChannel(client, say);
    onChannel = (s, p) => ch.onEvent(s, p);
  } catch (e) {
    say(`Искрон: канал не встал — ${e.message}`, "error");
  }
  let half = { tools: {}, forget() {
  }, stop() {
  } };
  try {
    half = await setupTools(say, onChannel, rootOf);
  } catch (e) {
    say(`Искрон: мост не поднялся — ${e.message}`, "error");
  }
  const hooks = {
    tool: half.tools,
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const id = event.properties.info.id;
        roots.delete(id);
        half.forget(id);
      }
    },
    dispose: async () => half.stop()
  };
  return hooks;
};
var plugin_default = IskronPlugin;
export {
  plugin_default as default
};
