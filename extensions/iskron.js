// js/extension/channel.ts
import { readFileSync } from "node:fs";

// js/shared/channel.ts
var DEAD_TOKEN_CODES = [4e3, 4001, 4002];
var ROLLOUT_CODE = 4003;
var FAST_DROP_MS = 5e3;
var ERROR_GUESS_DELAY_MS = 500;
function httpOrigin(socketUrl) {
  return new URL(socketUrl).origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}
function versionUrl(socketUrl) {
  return httpOrigin(socketUrl) + "/api/version";
}
function statusUrl(socketUrl) {
  return socketUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace("/channel/ws/", "/channel/status/");
}
async function serviceUp(socketUrl) {
  return fetch(versionUrl(socketUrl), { signal: AbortSignal.timeout(5e3) }).then((r) => r.ok ? r.json() : null).catch(() => null);
}
function holdSocket(o) {
  let fastDrops = 0;
  let dead = false;
  let stopped = false;
  let retry = null;
  let ws = null;
  function open() {
    if (stopped) return;
    const startedAt = Date.now();
    const sock = new WebSocket(o.url);
    ws = sock;
    let gone = false;
    sock.addEventListener("message", (e) => {
      if (stopped || ws !== sock) return;
      const raw = typeof e.data === "string" ? e.data : "[двоичный кадр]";
      let frame = null;
      if (typeof e.data === "string") {
        try {
          frame = JSON.parse(raw);
        } catch {
        }
      }
      o.onFrame(raw, frame && typeof frame === "object" ? frame : null);
    });
    sock.addEventListener(
      "error",
      () => setTimeout(() => void dropped(1006), ERROR_GUESS_DELAY_MS)
    );
    sock.addEventListener("close", (e) => void dropped(e.code));
    async function dropped(code) {
      if (stopped || ws !== sock) return;
      if (DEAD_TOKEN_CODES.includes(code)) {
        if (dead) return;
        dead = true;
        stopped = true;
        if (retry) clearTimeout(retry);
        o.onDeadToken(code);
        return;
      }
      if (gone) return;
      gone = true;
      fastDrops = Date.now() - startedAt < FAST_DROP_MS ? fastDrops + 1 : 0;
      if (fastDrops >= 3) {
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) {
          stopped = true;
          o.onServiceAlive(String(up.version ?? ""));
          return;
        }
        o.onNote?.("служба не отвечает — идёт раскатка, держу тот же токен");
        fastDrops = 1;
      }
      retry = setTimeout(open, code === ROLLOUT_CODE ? 3e3 : 2e3);
    }
  }
  open();
  return {
    close(reason = "held no more") {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const sock = ws;
      ws = null;
      try {
        sock?.close(1e3, reason);
      } catch {
      }
    },
    get alive() {
      return !stopped && !!ws && (ws.readyState === 0 || ws.readyState === 1);
    }
  };
}
function startSaying(o, readText) {
  let said = null;
  let complained = null;
  async function say() {
    let text;
    try {
      text = readText(o.sayFile).trim();
    } catch {
      return;
    }
    if (text === said) return;
    const res = await fetch(o.statusUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5e3)
    }).catch(() => null);
    if (res?.ok) {
      said = text;
      complained = null;
      return;
    }
    if (complained !== text) {
      complained = text;
      o.onRefused?.(text, res ? res.status : null);
    }
    if (res && res.status >= 400 && res.status < 500) said = text;
  }
  const timer = setInterval(() => void say(), o.intervalMs ?? 1e3);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
    }
  };
}

// js/extension/channel.ts
function socketAddress() {
  const direct = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (direct) return direct;
  const file = process.env.ISKRON_CHANNEL_SOCKET_FILE?.trim();
  if (!file) return null;
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}
function frameToText(frame, raw) {
  if (!frame) return `Кадр канала Искрона:
${raw}`;
  const from = frame.provenance?.from_standing || frame.provenance?.from_karta_seq;
  const head = from ? `Кадр канала Искрона от ${from}` : "Кадр канала Искрона";
  const body = typeof frame.body === "string" ? frame.body : raw;
  return `${head}:

${body}`;
}
function setupChannel(pi) {
  let holder = null;
  let saying = null;
  let ctxRef = null;
  let current = null;
  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    const url = socketAddress();
    if (!url) {
      if (ctx.hasUI) {
        ctx.ui.notify(
          'Искрон: места ещё нет. Займи стояние сам — iskron_channel(action="connect"), сразу за ним register тем же именем: слушание включится без отдельного действия.',
          "info"
        );
      }
      return;
    }
    hold(url);
  });
  function release(reason) {
    holder?.close(reason);
    holder = null;
    saying?.stop();
    saying = null;
  }
  function hold(url) {
    if (url === current && holder?.alive) return;
    current = url;
    release("новый сокет");
    const ctx = ctxRef;
    holder = holdSocket({
      url,
      onFrame: (raw, frame) => {
        if (frame?.type === "hello") {
          if (ctx?.hasUI) ctx.ui.setStatus?.("iskron", "Искрон: канал слушает");
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
      },
      // Процессу здесь выйти некуда, поэтому громкость — это сказать делателю
      // так, чтобы он это увидел в ходе, а не в логе, которого никто не читает.
      onDeadToken: (code) => loud(
        ctx,
        `Искрон: канал закрыт кодом ${code} — токен мёртв. Зови iskron_channel(action="connect")` + (code === 4001 ? ' или action="mint"' : "") + ", затем register тем же именем: новый сокет расширение возьмёт из ответа само, перезапуск не нужен."
      ),
      onServiceAlive: (version) => loud(ctx, `Искрон: обрывы, а служба отвечает (${version}) — спроси о токене.`)
    });
    startSayingFor(url);
    if (ctx?.hasUI) ctx.ui.setStatus?.("iskron", "Искрон: канал прицепляется");
  }
  pi.on("session_shutdown", async () => {
    current = null;
    release("session shutdown");
  });
  function loud(ctx, text) {
    if (ctx?.hasUI) ctx.ui.notify(text, "error");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal: true } },
      { triggerTurn: true, deliverAs: "steer" }
    );
  }
  function startSayingFor(url) {
    const sayFile = process.env.ISKRON_CHANNEL_SAY;
    if (!sayFile) return;
    saying = startSaying(
      { sayFile, statusUrl: process.env.ISKRON_CHANNEL_STATUS || statusUrl(url) },
      (file) => readFileSync(file, "utf8")
    );
  }
  return (url) => {
    const u = url?.trim();
    if (!u) return;
    const loopback = /^ws:\/\/(127\.0\.0\.1|\[?::1\]?|localhost)(:|\/)/.test(u);
    if (!u.startsWith("wss://") && !loopback) return;
    hold(u);
  };
}

// js/extension/bridge-client.ts
import { spawn } from "node:child_process";
var Bridge = class {
  proc = null;
  buf = "";
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  tail = [];
  dead = null;
  bin;
  onLog;
  constructor(bin, onLog) {
    this.bin = bin;
    this.onLog = onLog;
  }
  start() {
    const proc = spawn(process.execPath, [this.bin], { stdio: ["pipe", "pipe", "pipe"] });
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
      if (typeof msg?.id !== "number") continue;
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
function harvestSocket(content, offer) {
  const text = content.map((c) => c.type === "text" ? c.text : "").join("\n");
  const found = /wss?:\/\/[^\s"'`<>)\]]+/.exec(text)?.[0];
  if (!found) return;
  offer(found.replace(/[.,;:!?»"')\]]+$/, ""));
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
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// js/shared/version.ts
function versionIn(text) {
  const m = /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1] : null;
}

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
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "skills",
    "establish-mcp",
    "scripts",
    "iskron.mjs"
  );
}
var homeBridgePath = () => join(homedir(), ".iskron-bridge", "iskron-bridge.mjs");
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
  push(homeBridgePath());
  try {
    push(packagedBridgePath());
  } catch {
  }
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
function setupBridge(pi, offerSocket) {
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
    const b = new Bridge(found.path, (line) => notify(`Искрон/мост: ${line}`, "info"));
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
            if (name === "iskron_channel") harvestSocket(content, offerSocket);
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
  let offerSocket = () => {
  };
  try {
    offerSocket = setupChannel(pi);
  } catch (e) {
    broken.push(`канал: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    setupBridge(pi, (url) => offerSocket(url));
  } catch (e) {
    broken.push(`тулы: ${e instanceof Error ? e.message : String(e)}`);
  }
}
export {
  iskron_default as default
};
