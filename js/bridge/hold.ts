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
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deadTokenAdvice,
  type Frame,
  type Holder,
  holdSocket,
  startSaying,
  statusUrl as deriveStatusUrl,
} from "../shared/channel.ts";
import { CFG } from "./config.ts";
import { replyText } from "./standing.ts";
import { emit, log } from "./streams.ts";
import { state } from "./transport.ts";
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

export function standingsDir(): string {
  return join(CFG.authDir, "standings");
}

/** Имя стояния → безопасная часть пути: буквы, цифры, точка, дефис; прочее — подчёркивание. */
export function keyFor(): string {
  const s = state.standing;
  const raw = s ? `${s.name ?? "_"}--${s.karta}--${s.realm}` : "env";
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

/**
 * Путь сокета — по хешу ключа, не по самому ключу: у unix-сокета на macOS и BSD
 * предел пути 104 байта, и читаемое имя стояния его выбирает. Читаемое имя
 * лежит рядом файлом `<хеш>.key`, по нему сторож без аргумента находит стояние.
 */
export function socketPathFor(key: string): string {
  const h = createHash("sha256").update(key).digest("hex").slice(0, 16);
  if (process.platform === "win32") return `\\\\.\\pipe\\iskron-${h}`;
  return join(standingsDir(), `${h}.sock`);
}

export function keyFilePathFor(key: string): string {
  const h = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return join(standingsDir(), `${h}.key`);
}

export function sayPathFor(key: string): string {
  return join(standingsDir(), `${key}.say`);
}

let holder: Holder | null = null;
let server: Server | null = null;
let saying: { stop(): void } | null = null;
let currentKey: string | null = null;
let currentUrl: string | null = null;
const clients = new Set<Socket>();
const ring: { raw: string; frame: Frame | null }[] = [];

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

function openLocalServer(key: string): void {
  const path = socketPathFor(key);
  mkdirSync(standingsDir(), { recursive: true, mode: 0o700 });
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
  saying?.stop();
  saying = null;
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
}

/** Взять этот адрес и держать его, чем бы ни был занят прежний. */
export function holdStanding(url: string, statusUrl?: string | null): string {
  const key = keyFor();
  if (url === currentUrl && key === currentKey && holder?.alive) return key;
  releaseStanding("новый сокет");
  currentKey = key;
  currentUrl = url;
  openLocalServer(key);
  holder = holdSocket({
    url,
    onFrame: (raw, frame) => {
      // В кольцо идёт и hello: сторож, прицепившийся позже, должен увидеть
      // доказательство держания, а не только рабочие кадры.
      ring.push({ raw, frame });
      if (ring.length > RING) ring.shift();
      const ev: ChannelEvent = { kind: "frame", raw, frame };
      broadcast(ev);
      if (frame?.type !== "status") notify("info", ev);
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
  saying = startSaying(
    {
      sayFile: sayPathFor(key),
      statusUrl: statusUrl || deriveStatusUrl(url),
      onRefused: (_text, status) => {
        const text = `ДЕЛАТЕЛЬ: строку занятости не приняли (${status ?? "нет ответа"}) — укороти её`;
        log(text);
        broadcast({ kind: "note", text });
        notify("warning", { kind: "note", text });
      },
    },
    (file) => readFileSync(file, "utf8"),
  );
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
  if (!state.standing && a.realm && a.karta != null) {
    // connect уже назвал место — держим под ним, пока register не подтвердит.
    state.standing = { realm: a.realm, karta: a.karta, name: a.name };
  }
  const key = holdStanding(trim(socket), status ? trim(status) : null);
  const self = fileURLToPath(import.meta.url);
  const block =
    `\n\n[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно.` +
    `\nСлушать: node "${self}" watchdog ${key} — под Monitor с persistent: true (Claude Code);` +
    ` фоновой задачей — node "${self}" watchdog-exit ${key} (выходит нулём на первом сообщении).` +
    `\nЗанятость: пиши текст в ${sayPathFor(key)}; пустой текст снимает.` +
    `\nКадры приходят и уведомлениями MCP (logger iskron-channel).`;
  const content = reply.result?.content;
  if (Array.isArray(content)) {
    content.push({ type: "text", text: block.trim() });
  }
  return reply;
}

/** Отладочный путь: сокет из окружения, без connect. */
export function holdFromEnv(): void {
  const url = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (!url) return;
  holdStanding(url, process.env.ISKRON_CHANNEL_STATUS?.trim() || null);
}
