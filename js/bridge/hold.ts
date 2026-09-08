// Держание сокета стояния мостом (граф nks-dev: #4233, #4234, #4235).
//
// Мост проксирует ответ `iskron_channel(connect|mint)` и видит в нём адрес
// сокета, показанный единожды. С этой строки сокет его: он держит его той же
// дисциплиной канала, что прежде держал сторож (../shared/channel.ts), и до
// конца MCP-сессии — как исполнитель комнаты разговоров держит стояние треда.
// Наружу из моста ведут две двери, и ни одна не несёт секрета:
//   • локальный сокет в каталоге гранта (#4230) — к нему цепляется сторож под
//     Monitor (подкоманда watchdog) и печатает кадры строками-событиями;
//   • уведомления MCP `notifications/message` с logger «iskron-channel» — их
//     читает расширение pi и вкладывает кадр в ход.
// Занятость делатель пишет в файл рядом с сокетом (#4231); публикует мост.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { connect as connectLocal, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyOrigin,
  deadTokenAdvice,
  type Frame,
  type Holder,
  holdSocket,
  statusUrl as deriveStatusUrl,
} from "../shared/channel.ts";
import {
  defaultAuthDir,
  keyFilePathOf,
  socketPathOf,
  standingsDirOf,
} from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { replyText } from "./standing.ts";
import { emit, log } from "./streams.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

const RING = 20; // кадров, которые прицепившийся позже клиент получит задним числом

export interface ChannelEvent {
  kind: "attached" | "frame" | "note" | "dead" | "alive" | "released";
  key?: string;
  raw?: string;
  frame?: Frame | null;
  text?: string;
  code?: number;
  version?: string;
  buffered?: number;
}

function standingsDir(): string {
  return standingsDirOf(CFG.authDir);
}

/** Имя стояния → безопасная часть пути: буквы, цифры, точка, дефис; прочее — подчёркивание. */
function keyFor(): string {
  const s = state.standing;
  const raw = s ? `${s.name ?? "_"}--${s.karta}--${s.realm}` : "env";
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

const socketPathFor = (key: string): string => socketPathOf(CFG.authDir, key);
const keyFilePathFor = (key: string): string => keyFilePathOf(CFG.authDir, key);

let holder: Holder | null = null;
let server: Server | null = null;
let currentKey: string | null = null;
let currentUrl: string | null = null;
let currentStatusUrl: string | null = null;
const clients = new Set<Socket>();
const ring: { raw: string; frame: Frame | null }[] = [];
const helloWaiters = new Set<(f: Frame | null) => void>();

/** Держит ли этот мост сокет ИМЕННО этого стояния — тогда register довольно, connect ротировал бы живое место без причины. */
export function holdsStanding(realm: string, karta: string | number, name: string): boolean {
  const s = state.standing;
  return (
    !!holder?.alive &&
    !!s &&
    s.realm === realm &&
    String(s.karta) === String(karta) &&
    (s.name ?? "") === name &&
    currentKey === keyFor()
  );
}

/** Кадр hello — доказательство держания; из кольца, если уже пришёл, иначе ожидание под пределом. */
export function awaitHello(timeoutMs: number): Promise<Frame | null> {
  const seen = ring.find((r) => r.frame?.type === "hello")?.frame ?? null;
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve) => {
    const done = (f: Frame | null): void => {
      helloWaiters.delete(done);
      resolve(f);
    };
    helloWaiters.add(done);
    setTimeout(() => done(null), timeoutMs).unref();
  });
}

/** Блок `[iskron-bridge]` с командой слушания — для ответа connect и для iskron_stand. */
export function listenBlock(): string | null {
  if (!currentKey) return null;
  const key = currentKey;
  const self = fileURLToPath(import.meta.url);
  // Сторож выводит каталог сокетов так же, как мост: не по умолчанию — скажи ему где.
  const where = CFG.authDir === defaultAuthDir() ? "" : ` --auth-dir "${CFG.authDir}"`;
  return (
    `[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно` +
    ` (строка выше о том, что никто не слушает, описывает миг до этого держания).` +
    `\nСлушать: node "${self}" watchdog ${key}${where} — под Monitor с persistent: true (Claude Code);` +
    ` фоновой задачей — node "${self}" watchdog-exit ${key}${where} (выходит нулём на первом сообщении);` +
    ` в Codex из своей оболочки фоном — node "${self}" watchdog-codex ${key}${where} (кадр входит в идущий тред через app-server).` +
    `\nЗанятость: iskron_channel(action="status", realm, text) — пустой text снимает.` +
    `\nКадры приходят и уведомлениями MCP (logger iskron-channel).`
  );
}

function broadcast(ev: ChannelEvent): void {
  const line = JSON.stringify(ev) + "\n";
  for (const c of clients) {
    try {
      c.write(line);
    } catch {
      clients.delete(c);
    }
  }
}

function notify(level: "info" | "warning" | "error", data: ChannelEvent): void {
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level, logger: "iskron-channel", data },
  });
}

/**
 * Мост, убитый без прощания, оставляет `.key` и `.sock`: сторож без аргумента
 * перечисляет ключи, и мёртвая запись либо уводит его на сокет, где никого нет,
 * либо заставляет отказать «стояний несколько». Перед тем как положить свой
 * ключ, каждый чужой проверяется одним подключением; неотвечающий — убирается.
 */
function sweepStale(dir: string, mine: string): void {
  if (process.platform === "win32" || !existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".key"))) {
    const keyFile = join(dir, f);
    let key: string;
    try {
      key = readFileSync(keyFile, "utf8").trim();
    } catch {
      continue;
    }
    if (!key || key === mine) continue;
    const sock = socketPathFor(key);
    const drop = (): void => {
      for (const p of [keyFile, sock]) {
        try {
          unlinkSync(p);
        } catch {}
      }
    };
    if (!existsSync(sock)) {
      drop();
      continue;
    }
    const probe = connectLocal(sock);
    probe.once("connect", () => probe.destroy());
    probe.once("error", drop);
    probe.setTimeout(1000, () => probe.destroy());
  }
}

function openLocalServer(key: string): void {
  const path = socketPathFor(key);
  mkdirSync(standingsDir(), { recursive: true, mode: 0o700 });
  sweepStale(standingsDir(), key);
  writeFileSync(keyFilePathFor(key), key + "\n", { mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      unlinkSync(path);
    } catch {}
  }
  const srv = createServer((sock) => {
    clients.add(sock);
    sock.on("close", () => clients.delete(sock));
    sock.on("error", () => clients.delete(sock));
    sock.write(
      JSON.stringify({ kind: "attached", key, buffered: ring.length } satisfies ChannelEvent) +
        "\n",
    );
    for (const { raw, frame } of ring) {
      sock.write(JSON.stringify({ kind: "frame", raw, frame } satisfies ChannelEvent) + "\n");
    }
  });
  srv.on("error", (e) => {
    const text = `ДЕЛАТЕЛЬ: локальный сокет стояния не поднялся (${e.message}) — сторожу не к чему цепляться`;
    log(text);
    notify("error", { kind: "note", text });
  });
  srv.listen(path, () => {
    if (process.platform !== "win32") {
      try {
        chmodSync(path, 0o600);
      } catch {}
    }
    log(`standing socket held; local listeners attach at ${path}`);
  });
  server = srv;
}

/** Отпустить всё, что держим: сокет службы, локальный сокет, публикацию. Идемпотентно. */
export function releaseStanding(reason: string): void {
  if (!holder && !server) return;
  broadcast({ kind: "released", text: reason });
  holder?.close(reason);
  holder = null;
  for (const c of clients) {
    try {
      c.end();
    } catch {}
  }
  clients.clear();
  const srv = server;
  server = null;
  if (srv) {
    try {
      srv.close();
    } catch {}
  }
  if (currentKey) {
    try {
      unlinkSync(keyFilePathFor(currentKey));
    } catch {}
    if (process.platform !== "win32") {
      try {
        unlinkSync(socketPathFor(currentKey));
      } catch {}
    }
  }
  ring.length = 0;
  currentKey = null;
  currentUrl = null;
  currentStatusUrl = null;
}

/** Взять этот адрес и держать его, чем бы ни был занят прежний. */
function holdStanding(url: string, statusUrl?: string | null): string {
  const key = keyFor();
  if (url === currentUrl && key === currentKey && holder?.alive) return key;
  releaseStanding("новый сокет");
  currentKey = key;
  currentUrl = url;
  currentStatusUrl = statusUrl || deriveStatusUrl(url);
  openLocalServer(key);
  holder = holdSocket({
    url,
    onFrame: (raw, frame) => {
      void completeFrame(stampOrigin(frame)).then((full) => {
        const text = full === frame ? raw : JSON.stringify(full);
        // В кольцо идёт и hello: сторож, прицепившийся позже, должен увидеть
        // доказательство держания, а не только рабочие кадры.
        ring.push({ raw: text, frame: full });
        if (ring.length > RING) ring.shift();
        if (full?.type === "hello") for (const w of [...helloWaiters]) w(full);
        const ev: ChannelEvent = { kind: "frame", raw: text, frame: full };
        broadcast(ev);
        if (full?.type !== "status") notify("info", ev);
      });
    },
    onDeadToken: (code) => {
      const text = `ДЕЛАТЕЛЬ: ${deadTokenAdvice(code)}`;
      log(text);
      const ev: ChannelEvent = { kind: "dead", code, text };
      broadcast(ev);
      notify("error", ev);
      releaseStanding("токен мёртв");
    },
    onServiceAlive: (version) => {
      const text = `ДЕЛАТЕЛЬ: обрывы, а служба отвечает (${version}) — спроси о токене`;
      log(text);
      const ev: ChannelEvent = { kind: "alive", version, text };
      broadcast(ev);
      notify("error", ev);
      releaseStanding("обрывы при живой службе");
    },
    onNote: (text) => {
      log(text);
      broadcast({ kind: "note", text });
    },
  });
  return key;
}

const SOCKET_RE =
  /wss:\/\/[^\s"'`<>)\]]+|ws:\/\/(?:127\.0\.0\.1|\[?::1\]?|localhost)(?::\d+)?\/[^\s"'`<>)\]]+/;
const STATUS_RE = /https?:\/\/[^\s"'`<>)\]]+\/channel\/status\/[^\s"'`<>)\]]+/;
const trim = (s: string): string => s.replace(/[.,;:!?»"')\]]+$/, "");

/**
 * Ответ connect/mint прошёл через мост: взять из него сокет и держать, а сам
 * ответ дополнить тем, чего сервер знать не может, — точной командой слушания
 * и путём файла занятости. Возвращает дополненный ответ либо исходный.
 */
export function absorbChannelReply(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel") return reply;
  if (a?.action !== "connect" && a?.action !== "mint") return reply;
  if (reply?.error || reply?.result?.isError) return reply;
  const text = replyText(reply);
  const socket = SOCKET_RE.exec(text)?.[0];
  if (!socket) return reply;
  const status = STATUS_RE.exec(text)?.[0];
  if (a.realm && a.karta != null) {
    // connect назвал место — ключ, сокет и файл занятости идут под ЭТИМ именем,
    // даже если прежде мост держал другое: ярлык врать не должен.
    state.standing = { realm: a.realm, karta: a.karta, name: a.name };
  }
  holdStanding(trim(socket), status ? trim(status) : null);
  const block = listenBlock() ?? "";
  const content = reply.result?.content;
  if (Array.isArray(content)) {
    content.push({ type: "text", text: block.trim() });
  }
  return reply;
}

/**
 * Своё снятие (revoke того стояния, что держит мост) — не смерть токена: сокет
 * отпускается прежде, чем придёт закрытие 4001, и привязка забывается, иначе
 * держатель объявляет «токен мёртв, зови connect», а послушный агент тут же
 * пересоздаёт снятое место (наблюдено в pi и OpenCode). Ответ сервера едет как есть.
 */
export function absorbRevokeReply(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "revoke") return reply;
  if (reply?.error || reply?.result?.isError) return reply;
  const s = state.standing;
  if (!s) return reply;
  const asked = typeof a.standing === "string" ? a.standing.trim() : "";
  const own =
    asked === "" ||
    asked === "mine" ||
    asked === (s.name ?? "") ||
    asked.endsWith(`:${s.name ?? ""}`);
  if (!own || String(a.karta ?? s.karta) !== String(s.karta)) return reply;
  releaseStanding("снято своим revoke");
  state.standing = null;
  state.standingSession = null;
  log(
    `standing revoked by this session — released quietly, binding forgotten (${s.name ?? "unnamed"})`,
  );
  return reply;
}

/** Отладочный путь: сокет из окружения, без connect. */
export function holdFromEnv(): void {
  const url = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (!url) return;
  holdStanding(url, process.env.ISKRON_CHANNEL_STATUS?.trim() || null);
}

/**
 * Занятость — слово держателя сокета, а держит его мост: action="status" у
 * iskron_channel исполняется здесь, на сервер не уходит (решение владельца,
 * граф nks-dev: #4284 отвергнут). POST на статусный адрес из ответа connect;
 * ответ поверхности — успех или ProblemDetail — доносится целиком, длину мост
 * не судит. Возвращает null для всякого другого вызова.
 */
export function localStatus(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  const a = msg.params?.arguments;
  if (a?.action !== "status") return null;
  const text = typeof a.text === "string" ? a.text : "";
  const reply = (body: string, isError = false): JsonRpcMessage => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...(isError ? { isError: true } : {}), content: [{ type: "text", text: body }] },
  });
  return (async () => {
    const st = await publishStatus(text);
    if (st.ok) return reply(`занятость ${currentKey}: ${text || "(снята)"}`);
    return reply(st.body, true);
  })();
}

/** POST строки занятости на статусный адрес стояния, которое держит мост. */
export async function publishStatus(text: string): Promise<{ ok: boolean; body: string }> {
  if (!currentStatusUrl || !currentKey) {
    return {
      ok: false,
      body: 'Отказано (мост): стояния мост не держит — сперва iskron_stand или iskron_channel(action="connect") (и register на живом месте), затем status',
    };
  }
  let res: Response;
  try {
    res = await fetch(currentStatusUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    return {
      ok: false,
      body: `Отказано (мост): статусный адрес не ответил — ${(e as Error).message}`,
    };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (!res.ok)
    return { ok: false, body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}` };
  return { ok: true, body };
}

let readCounter = 0;

/**
 * Дочитывание кадра — обязанность моста (слово владельца): платформа режет
 * длинное тело в кадре сокета и называет полную длину в body_chars; до делателя
 * кадр доходит целым, потому что мост, держатель сессии, дочитывает его сам
 * через историю канала, прежде чем отдать сторожу или плагину. Не дочиталось —
 * кадр идёт как есть, с пометкой, что он обрезан: лучше честный обрез, чем
 * молчание.
 */
async function completeFrame(frame: Frame | null): Promise<Frame | null> {
  if (!frame || typeof frame.body !== "string" || typeof frame.body_chars !== "number")
    return frame;
  if (!frame.id || [...frame.body].length >= frame.body_chars) return frame;
  const realm = state.standing?.realm;
  if (!realm) return { ...frame, body_read: "truncated: стояние без realm, дочитать нечем" };
  const id = `iskron-bridge-read-${++readCounter}`;
  let reply: JsonRpcMessage | null = null;
  try {
    await post(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "iskron_channel",
          arguments: { realm, action: "history", view: "message", message: frame.id },
        },
      },
      (m) => {
        if (m.id === id) reply = m;
      },
    );
  } catch (e) {
    log(`кадр ${frame.id} обрезан, дочитать не вышло: ${(e as Error).message}`);
    return { ...frame, body_read: `truncated: ${(e as Error).message}` };
  }
  const text = replyText(reply);
  const nl = text.indexOf("\n");
  const tail = text.indexOf("\nПровенанс, как платформа");
  if (nl < 0 || (reply as JsonRpcMessage | null)?.result?.isError) {
    return { ...frame, body_read: `truncated: ${text.slice(0, 160)}` };
  }
  const body = (tail > nl ? text.slice(nl + 1, tail) : text.slice(nl + 1)).trim();
  return { ...frame, body, body_read: "history" };
}

/** Кто говорит — штампует мост: он один знает роль своего стояния. */
function stampOrigin(frame: Frame | null): Frame | null {
  if (!frame || frame.type !== "message") return frame;
  return { ...frame, origin: classifyOrigin(frame, state.standing?.karta) };
}
