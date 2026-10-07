// Локальная дверь места (граф nks-dev: #4230, #5838): сокет в каталоге гранта,
// к которому цепляется сторож места, его кольцо кадров и память отданного.
// Сокет службы у моста один на канал (hold.ts), дверей — по одной на место:
// канал держит места в нескольких графах, и кадр идёт к двери своего места.
import { chmodSync, mkdirSync, unlinkSync, utimesSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";

import { type Frame } from "../shared/channel.ts";
import { L } from "../shared/lang.ts";
import { bindScope } from "../shared/scope.ts";
import { foldedTacts, type Marks, noteSeen, seenIds, splitBatch } from "../shared/seen.ts";
import {
  keyFilePathOf,
  privateDirProblem,
  seenFilePathOf,
  shortSocketDir,
  socketPathOf,
  standingsDirOf,
} from "../shared/standings.ts";
import { Backlog } from "./backlog.ts";
import { CFG } from "./config.ts";
import { closeServerKeeping, stampOf, unlinkOwned, writeOwned } from "./doorfiles.ts";
import { marksOf } from "./fanout.ts";
import { countOnly, emitBatch, RoomBatch } from "./roomstack.ts";
import { StaleBurst } from "./stale.ts";
import { log } from "./streams.ts";
import { sweepStale } from "./sweep.ts";

const RING = 20; // кадров, которые прицепившийся позже клиент получит задним числом

/** Ключ стояния без места — сокет из окружения (hold.ts keyFor). */
export const ENV_KEY = "env";

export interface ChannelEvent {
  // held — мост взял сокет (питает holding плагина OpenCode, #5140); backlog — пачка побудки; lost — слух потерян, resumed — место возвращено без хода агента (оба синтезирует плагин, #5366);
  // handover — демон машины передаёт место преемнику: дверь закроется и откроется тем же путём, сторож переподхватывает её (watchdog/client.ts)
  // prettier-ignore
  kind: "attached" | "frame" | "note" | "dead" | "alive" | "evicted" | "stale" | "released" | "held" | "backlog" | "lost" | "resumed" | "handover" | "beside" | "beside-gone";
  key?: string;
  raw?: string;
  frame?: Frame | null;
  text?: string;
  code?: number;
  version?: string;
  buffered?: number;
  /** kind="attached": файл памяти отданного этого места — сторож метит и читает его, а не выводит путь сам (сервер ему не известен). */
  seen?: string;
  /** kind="stale": все кадры полосы — принятое, пока место не слушали, или повтор службы; сторож судит их сам в миг отдачи (shared/stalebatch.ts); kind="backlog": показанные кадры пачки по received_at. */
  frames?: Frame[];
  /** kind="stale" и "backlog": метки доставки пачки (seen.ts splitBatch) — пишет внёсший её в ход. */
  marks?: string[];
  /** kind="stale" моста прежней сборки: показаны не все кадры, это — метки сверх показанных (watchdog/client.ts staleOf). */
  unshown?: string[];
  /** kind="held": место, которое мост держит, — по нему плагин OpenCode ставит спутником дочернюю сессию (#6002). */
  place?: { realm: string; karta: string; name: string };
  /** kind="backlog": сколько кадров ожидало по hello. */
  pending?: number;
  /**
   * kind="frame" из пачки кадров комнаты (roomstack.ts): его место в залпе — at из of; пачка — одна побудка.
   * Свёртка адресных слов не мне (#6081, foldAsides): folded — кадр свёрнут в строку следующего;
   * fold — число слов череды, которую закрывает строка этого кадра (без него — сам кадр).
   */
  batch?: { at: number; of: number; fold?: number; folded?: true };
  /** kind="released": место отпущено своим close или revoke этой сессии — не уход моста, сторож выходит без тревоги (#6638). */
  own?: true;
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
  /** Метки места: память моста и файл .seen, который пишут внёсшие кадр в ход (seen.ts eventIn). */
  readonly marks: Marks = (k) => marksOf(this.seen, this.seenPath)(k);
  /** Пачки места — лежалая и побудки: у каждого места свои (#5838). */
  readonly stale = new StaleBurst(this.marks);
  readonly backlog = new Backlog(this.marks);
  /** Пачка кадров комнаты рода «в пачку» — для сторожей, не для клиентов уведомлений (roomstack.ts, #5851). */
  readonly roomBatch = new RoomBatch(this.marks);
  /** id места у платформы (hello standings[].standing_id) — по нему кадр находит дверь и занятость — место. */
  standingId: string | null = null;
  /**
   * Адрес места @handle:name — так место зовёт доска: из hello (standings[].standing), а у
   * места рядом до того — выведен из хэндла основного места (addressDerived); нет ни того, ни другого — null.
   */
  address: string | null = null;
  /** address выведен мостом, а не назван hello. */
  addressDerived = false;
  /** Почему локальный сокет не поднялся; null — поднят или ещё поднимается. */
  listenError: string | null = null;
  private server: Server | null = null;
  private freshen: ReturnType<typeof setInterval> | null = null;
  /** Отпечатки .key и .sock, которые положила эта дверь (doorfiles.ts): close сносит только их. */
  private stamps: { key: string | null; sock: string | null } = { key: null, sock: null };
  private readonly hooks: DoorHooks;
  // Каталог гранта и сервер — сессии, открывшей дверь (shared/scope.ts): дверь
  // закрывается и из чужой области (уход демона), а пути у неё те же.
  private readonly authDir: string;
  private readonly serverUrl: string;

  constructor(key: string, hooks: DoorHooks) {
    this.key = key;
    this.hooks = {
      onAttach: bindScope(hooks.onAttach),
      lateEvent: bindScope(hooks.lateEvent),
      onError: bindScope(hooks.onError),
    };
    this.authDir = CFG.authDir;
    this.serverUrl = CFG.serverUrl;
    this.seen = seenIds(this.seenPath);
  }

  /**
   * Место (ключ по имени, роли и графу) помнит отданное на своём сервере и после
   * моста; стояние без места (ключ "env") смешивает места — его память живёт с мостом.
   */
  get persistent(): boolean {
    return this.key !== ENV_KEY;
  }

  get seenPath(): string {
    return seenFilePathOf(this.authDir, this.key, this.persistent ? this.serverUrl : "");
  }

  get socketPath(): string {
    return socketPathOf(this.authDir, this.key);
  }

  /** По пути сокета лежит сокет этой двери, а не положенный поверх преемником. */
  get ownsSocket(): boolean {
    return !!this.stamps.sock && stampOf(this.socketPath) === this.stamps.sock;
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
    const authDir = this.authDir;
    mkdirSync(standingsDirOf(authDir), { recursive: true, mode: 0o700 });
    if (process.platform !== "win32" && dirname(path) === shortSocketDir()) {
      const bad = privateDirProblem(dirname(path));
      if (bad) {
        this.listenError = bad;
        this.hooks.onError(
          L(
            `ДЕЛАТЕЛЬ: локальный сокет стояния не поднят — ${bad}`,
            `DOER: the local standing socket is not up — ${bad}`,
          ),
        );
        return;
      }
    }
    sweepStale(authDir, key);
    this.stamps = { key: writeOwned(keyFilePathOf(authDir, key), key + "\n"), sock: null };
    if (process.platform !== "win32") {
      try {
        unlinkSync(path);
      } catch {}
    }
    const gone = (sock: Socket): void => {
      this.clients.delete(sock);
      if (this.clients.size === 0) this.idleAt = Date.now();
    };
    const srv = createServer(
      bindScope((sock: Socket) => {
        this.clients.add(sock);
        this.idleAt = null;
        sock.on("close", () => gone(sock));
        sock.on("error", () => gone(sock));
        this.hooks.onAttach();
        // Задним числом — доказательство держания (hello) и кадры, которых ни один
        // местный клиент ещё не получал: перевзведённый сторож не должен нести
        // делателю то же кольцо второй раз — память доставленного у моста есть.
        // Доставленным кадр помечает отдавший его клиент (печатью, выходом) — файл читается заново.
        // Кадр, лежащий в копящейся пачке комнаты, придёт с ней, не отдельно. Событие —
        // один раз, текстом или числом, и внутри повтора (seen.ts splitBatch). Такт, за
        // которым в кольце идёт новее, свёрнут (#6569): не отдаётся и метится отданным.
        const folded = foldedTacts(this.ring.map((r) => r.frame));
        for (const f of folded) if (f.id) noteSeen(this.seenPath, String(f.id), this.seen);
        const waiting = this.ring.filter(
          ({ frame }) =>
            frame?.type !== "message" ||
            (!folded.has(frame) &&
              !this.marks(String(frame.id ?? "")) &&
              !this.roomBatch.holds(frame)),
        );
        const msgs = waiting.flatMap(({ frame }) => (frame?.type === "message" ? [frame] : []));
        const kept = new Set<Frame | null>(splitBatch(msgs, Infinity, this.marks).kept);
        const backlog = waiting.filter(({ frame }) => frame?.type !== "message" || kept.has(frame));
        sock.write(
          JSON.stringify({
            kind: "attached",
            key,
            buffered: backlog.length,
            seen: this.seenPath,
          } satisfies ChannelEvent) + "\n",
        );
        // Неадресованные месту записи дел (#6574) — пачкой впереди, счётом: так
        // пришли бы и живыми; поодиночке сторож взял бы их за побудку.
        const counts = backlog.filter((h): h is { raw: string; frame: Frame } =>
          countOnly(h.frame),
        );
        const put = (ev: ChannelEvent): void => void sock.write(JSON.stringify(ev) + "\n");
        if (counts.length) emitBatch(counts, put);
        for (const { raw, frame } of backlog) {
          if (!countOnly(frame)) put({ kind: "frame", raw, frame });
        }
        // Место отняли, а сторож перевзвёлся: молчание читалось бы как слух.
        const late = this.hooks.lateEvent();
        if (late) sock.write(JSON.stringify(late) + "\n");
      }),
    );
    srv.on("error", (e) => {
      this.listenError = e.message;
      this.hooks.onError(
        L(
          `ДЕЛАТЕЛЬ: локальный сокет стояния не поднялся (${e.message}) — сторожу не к чему цепляться`,
          `DOER: the local standing socket did not come up (${e.message}) — the watchdog has nothing to attach to`,
        ),
      );
    });
    srv.listen(
      path,
      bindScope(() => {
        if (process.platform !== "win32") {
          try {
            chmodSync(path, 0o600);
          } catch {}
        }
        this.stamps.sock = stampOf(path);
        log(`standing socket held; local listeners attach at ${path}`);
        // Чистка /tmp (macOS — трое суток без доступа) не снесёт сокет долгой вахты.
        if (dirname(path) === shortSocketDir()) {
          const touch = (): void => {
            const now = new Date();
            const mine = stampOf(path) === this.stamps.sock;
            for (const p of mine ? [dirname(path), path] : [dirname(path)])
              try {
                utimesSync(p, now, now);
              } catch {}
          };
          this.freshen = setInterval(touch, 6 * 3600_000);
          this.freshen.unref?.();
        }
      }),
    );
    this.server = srv;
  }

  /** Отдать неотданные пачки сейчас — при отпускании: побудки и комнаты (backlog.ts). */
  flushBatches(): void {
    this.backlog.flushNow();
    this.roomBatch.flushNow();
  }

  /**
   * Закрыть дверь: клиенты, сервер, файлы ключа и сокета. Идемпотентно. Память
   * отданного места (.seen по серверу) остаётся: место, возвращённое новым мостом,
   * получает от платформы ту же очередь снова и не должно отдать её второй раз
   * (#5831); лежалые файлы прибирает уборка по возрасту (sweep.ts). Память
   * стояния без места уходит с мостом, как прежде.
   */
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
    if (this.freshen) clearInterval(this.freshen);
    const srv = this.server;
    this.server = null;
    const shut = (): void => {
      try {
        srv?.close();
      } catch {}
    };
    // Файлы двери — только свои: тем же путём мог встать преемник того же места (doorfiles.ts).
    // Сокет, ещё не поднятый (отпечатка нет), закрывается как есть.
    if (process.platform === "win32" || !this.stamps.sock) shut();
    else closeServerKeeping(this.socketPath, this.stamps.sock, shut);
    unlinkOwned(keyFilePathOf(this.authDir, this.key), this.stamps.key);
    this.stamps = { key: null, sock: null };
    if (!this.persistent) {
      try {
        unlinkSync(this.seenPath);
      } catch {}
    }
    this.ring.length = 0;
    this.idleAt = null;
  }
}
