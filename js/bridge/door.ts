// Локальная дверь места (граф nks-dev: #4230, #5838): сокет в каталоге гранта,
// к которому цепляется сторож места, его кольцо кадров и память отданного.
// Сокет службы у моста один на канал (hold.ts), дверей — по одной на место:
// канал держит места в нескольких графах, и кадр идёт к двери своего места.
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

import { type Frame } from "../shared/channel.ts";
import { deliveredKeys, seenIds } from "../shared/seen.ts";
import {
  keyFilePathOf,
  seenFilePathOf,
  socketPathOf,
  standingsDirOf,
} from "../shared/standings.ts";
import { Backlog, ROOM_BATCH_MS, roomHead } from "./backlog.ts";
import { CFG } from "./config.ts";
import { isDelivered } from "./fanout.ts";
import { StaleBurst } from "./stale.ts";
import { log } from "./streams.ts";
import { sweepStale } from "./sweep.ts";

const RING = 20; // кадров, которые прицепившийся позже клиент получит задним числом

export interface ChannelEvent {
  // held — мост взял сокет (питает holding плагина OpenCode, #5140); backlog — пачка побудки; lost — слух потерян, resumed — место возвращено без хода агента (оба синтезирует плагин, #5366)
  // prettier-ignore
  kind: "attached" | "frame" | "note" | "dead" | "alive" | "evicted" | "stale" | "released" | "held" | "backlog" | "lost" | "resumed";
  key?: string;
  raw?: string;
  frame?: Frame | null;
  text?: string;
  code?: number;
  version?: string;
  buffered?: number;
  /** kind="stale": лежалые кадры полосы — принятое, пока место не слушали, или повтор службы; kind="backlog": кадры пачки по received_at. */
  frames?: Frame[];
  /** kind="backlog": сколько кадров ожидало по hello. */
  pending?: number;
}

export interface DoorHooks {
  /** прицепился локальный клиент — сторож вернулся к месту */
  onAttach: () => void;
  /** событие, которое прицепившийся позже должен узнать, а не прочесть молчанием (место отняли) */
  lateEvent: () => ChannelEvent | null;
  /** локальный сокет не поднялся — слово делателю */
  onError: (text: string) => void;
}

export class Door {
  readonly key: string;
  readonly clients = new Set<Socket>();
  readonly ring: { raw: string; frame: Frame | null }[] = [];
  /** Память доставленных кадров — та же, что читает сторож выхода (../shared/seen.ts). */
  seen: Set<string>;
  /** С какого мига ни один локальный клиент не слушает; null — слушают. */
  idleAt: number | null = Date.now();
  /** Пачки места — лежалая и побудки: у каждого места свои (#5838). */
  readonly stale = new StaleBurst();
  readonly backlog = new Backlog();
  /** Пачка кадров комнаты рода «в пачку» — для сторожей, не для клиентов уведомлений (roomstack.ts, #5851). */
  readonly roomBatch = new Backlog(ROOM_BATCH_MS, roomHead);
  /** id места у платформы (hello standings[].standing_id) — по нему кадр находит дверь и занятость — место. */
  standingId: string | null = null;
  private server: Server | null = null;
  private readonly hooks: DoorHooks;

  constructor(key: string, hooks: DoorHooks) {
    this.key = key;
    this.hooks = hooks;
    this.seen = seenIds(this.seenPath);
  }

  get seenPath(): string {
    return seenFilePathOf(CFG.authDir, this.key);
  }

  get socketPath(): string {
    return socketPathOf(CFG.authDir, this.key);
  }

  push(raw: string, frame: Frame | null): void {
    this.ring.push({ raw, frame });
    if (this.ring.length > RING) this.ring.shift();
  }

  broadcast(ev: ChannelEvent): void {
    const line = JSON.stringify(ev) + "\n";
    for (const c of this.clients) {
      try {
        c.write(line);
      } catch {
        this.clients.delete(c);
      }
    }
  }

  open(): void {
    const path = this.socketPath;
    const key = this.key;
    mkdirSync(standingsDirOf(CFG.authDir), { recursive: true, mode: 0o700 });
    sweepStale(CFG.authDir, key);
    writeFileSync(keyFilePathOf(CFG.authDir, key), key + "\n", { mode: 0o600 });
    if (process.platform !== "win32") {
      try {
        unlinkSync(path);
      } catch {}
    }
    const gone = (sock: Socket): void => {
      this.clients.delete(sock);
      if (this.clients.size === 0) this.idleAt = Date.now();
    };
    const srv = createServer((sock) => {
      this.clients.add(sock);
      this.idleAt = null;
      sock.on("close", () => gone(sock));
      sock.on("error", () => gone(sock));
      this.hooks.onAttach();
      // Задним числом — доказательство держания (hello) и кадры, которых ни один
      // местный клиент ещё не получал: перевзведённый сторож не должен нести
      // делателю то же кольцо второй раз — память доставленного у моста есть.
      // Доставленным кадр помечает отдавший его клиент (печатью, выходом) — файл читается заново.
      // Кадр, лежащий в копящейся пачке комнаты, придёт с ней, не отдельно.
      const backlog = this.ring.filter(
        ({ frame }) =>
          frame?.type !== "message" ||
          (!isDelivered(deliveredKeys(frame), this.seen, this.seenPath) &&
            !this.roomBatch.holds(frame)),
      );
      sock.write(
        JSON.stringify({ kind: "attached", key, buffered: backlog.length } satisfies ChannelEvent) +
          "\n",
      );
      for (const { raw, frame } of backlog) {
        sock.write(JSON.stringify({ kind: "frame", raw, frame } satisfies ChannelEvent) + "\n");
      }
      // Место отняли, а сторож перевзвёлся: молчание читалось бы как слух.
      const late = this.hooks.lateEvent();
      if (late) sock.write(JSON.stringify(late) + "\n");
    });
    srv.on("error", (e) =>
      this.hooks.onError(
        `ДЕЛАТЕЛЬ: локальный сокет стояния не поднялся (${e.message}) — сторожу не к чему цепляться`,
      ),
    );
    srv.listen(path, () => {
      if (process.platform !== "win32") {
        try {
          chmodSync(path, 0o600);
        } catch {}
      }
      log(`standing socket held; local listeners attach at ${path}`);
    });
    this.server = srv;
  }

  /** Отдать неотданные пачки сейчас — при отпускании: побудки и комнаты (backlog.ts). */
  flushBatches(): void {
    this.backlog.flushNow();
    this.roomBatch.flushNow();
  }

  /** Закрыть дверь: клиенты, сервер, файлы ключа, памяти и сокета. Идемпотентно. */
  close(): void {
    // Пачка, ещё не отданная, уходит сейчас, а не теряется молча (backlog.ts).
    this.flushBatches();
    this.stale.drop();
    for (const c of this.clients) {
      try {
        c.end();
      } catch {}
    }
    this.clients.clear();
    const srv = this.server;
    this.server = null;
    if (srv) {
      try {
        srv.close();
      } catch {}
    }
    for (const p of [keyFilePathOf(CFG.authDir, this.key), this.seenPath]) {
      try {
        unlinkSync(p);
      } catch {}
    }
    if (process.platform !== "win32") {
      try {
        unlinkSync(this.socketPath);
      } catch {}
    }
    this.ring.length = 0;
    this.idleAt = null;
  }
}
