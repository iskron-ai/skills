// js/shared/channel.ts
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
var VERSION = "6.3.0";
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

// js/extension/channel.ts
function setupChannel(pi) {
  let ctxRef = null;
  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
  });
  pi.on("session_shutdown", async () => {
    ctxRef = null;
  });
  function loud(text) {
    if (ctxRef?.hasUI) ctxRef.ui.notify(text, "error");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal: true } },
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
        pi.sendMessage(
          {
            customType: "iskron-channel",
            content: frameToText(frame, raw),
            display: true,
            details: frame ?? { raw }
          },
          { triggerTurn: true, deliverAs: "steer" }
        );
        return;
      }
      case "dead":
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` + (ev.code === 4001 ? ' или action="mint"' : "") + ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен."
        );
        return;
      case "alive":
        loud(`Искрон: обрывы, а служба отвечает (${ev.version ?? ""}) — спроси о токене.`);
        return;
      case "note":
        if (ctxRef?.hasUI && ev.text) ctxRef.ui.notify(`Искрон: ${ev.text}`, "warning");
        return;
      case "attached":
      case "released":
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
var PROTOCOL = "2025-06-18";
function setupBridge(pi, onChannel) {
  let bridge = null;
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
      }
    );
    bridge = b;
    b.start();
    const init = await b.request(
      "initialize",
      {
        protocolVersion: PROTOCOL,
        capabilities: {},
        clientInfo: { name: "pi-iskron", version: "1" }
      },
      { timeoutMs: HANDSHAKE_MS }
    );
    if (bridge !== b) return b.stop();
    b.notify("notifications/initialized");
    const tools = [];
    let cursor;
    do {
      const page = await b.request("tools/list", cursor ? { cursor } : {}, {
        timeoutMs: HANDSHAKE_MS
      });
      for (const t of page?.tools ?? []) tools.push(t);
      cursor = page?.nextCursor;
    } while (cursor);
    if (bridge !== b) return b.stop();
    for (const tool of tools) {
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
    const server = init?.serverInfo;
    notify(
      `Искрон: мост поднят (${server?.name ?? "сервер"} ${server?.version ?? ""}), тулов в сессии: ${tools.length}.`,
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
