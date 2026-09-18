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
import { chmodSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

import {
  deadTokenAdvice,
  type Frame,
  type Holder,
  holdSocket,
  statusUrl as deriveStatusUrl,
} from "../shared/channel.ts";
import { noteSeen, seenIds } from "../shared/seen.ts";
import {
  keyFilePathOf,
  seenFilePathOf,
  socketPathOf,
  standingsDirOf,
} from "../shared/standings.ts";
import { flushBacklogNow, noteBacklog, openBacklog } from "./backlog.ts";
import { harnessName, notifiedClient } from "./client.ts";
import { completeFrame, stampOrigin } from "./complete.ts";
import { CFG } from "./config.ts";
import { dropHoldRecord, keyOf, readHoldRecord, writeHoldRecord } from "./holdrecord.ts";
import { dropStale, noteStale } from "./stale.ts";
import { standingLog } from "./store.ts";
import { emit, log } from "./streams.ts";
import { sweepStale } from "./sweep.ts";
import { state } from "./transport.ts";

const RING = 20; // кадров, которые прицепившийся позже клиент получит задним числом

export interface ChannelEvent {
  // held — мост взял сокет (питает holding плагина OpenCode, #5140); backlog — пачка побудки; lost — слух потерян (плагин)
  // prettier-ignore
  kind: "attached" | "frame" | "note" | "dead" | "alive" | "evicted" | "stale" | "released" | "held" | "backlog" | "lost";
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

function standingsDir(): string {
  return standingsDirOf(CFG.authDir);
}

/** Имя стояния → безопасная часть пути: буквы, цифры, точка, дефис; прочее — подчёркивание. */
function keyFor(): string {
  const s = state.standing;
  return s ? keyOf(s.realm, s.karta, s.name ?? "") : "env";
}

const socketPathFor = (key: string): string => socketPathOf(CFG.authDir, key);
const keyFilePathFor = (key: string): string => keyFilePathOf(CFG.authDir, key);
/** Занятость этого места, записанная в держании, — для возврата с диска. */
function keptRecordStatus(key: string): string | undefined {
  return readHoldRecord(key)?.status;
}

/** Каталог сессии, из которого занимается место (cwd в iskron_stand), — в запись держания, для возврата по каталогу (resume.ts). */
let standCwd: string | null = null;
/** Возвращает прежний каталог — неудачный возврат с диска откатывает его (resume.ts). */
export function noteStandCwd(cwd: string | null): string | null {
  const prev = standCwd;
  standCwd = cwd;
  // Место уже держится (connect был раньше stand) — каталог дописывается в запись сейчас.
  if (cwd && currentKey && currentUrl) rememberStatus(readHoldRecord(currentKey)?.status ?? "");
  return prev;
}

/** Занятость принята доской — запомнить её в записи держания (status.ts). */
export function rememberStatus(text: string): void {
  const s = state.standing;
  if (!s || !currentKey || !currentUrl) return;
  writeHoldRecord(currentKey, {
    realm: s.realm,
    karta: s.karta,
    name: s.name ?? "",
    url: currentUrl,
    statusUrl: currentStatusUrl,
    status: text || undefined,
    cwd: standCwd ?? readHoldRecord(currentKey)?.cwd,
    client: harnessName(),
    key: currentKey,
  });
}

export { keyOf, readHoldRecord } from "./holdrecord.ts";

/** Держит ли мост живой сокет ИМЕННО этого ключа (resume.ts). */
export const holdsKey = (key: string): boolean => !!holder?.alive && currentKey === key;
/** Ключ места, которое ведёт мост — держит или запарковал; null — не ведёт никакого (resume.ts). */
export const ledKey = (): string | null => currentKey;
/** Путь локального сокета ключа — для проверки живого держателя (resume.ts). */
export const localSocketPathOf = (key: string): string => socketPathFor(key);
/** Возврат с диска в полёте (+1) или кончился (−1): мёртвый токен при нём — протухшая запись, не тревога. */
export function noteResuming(delta: number): void {
  resuming += delta;
}

let holder: Holder | null = null;
let server: Server | null = null;
let currentKey: string | null = null;
let currentUrl: string | null = null;
let currentStatusUrl: string | null = null;
let evictedKey: string | null = null; // ключ места, отнятого у этого моста закрытием 4000
let evictedEvent: ChannelEvent | null = null; // прицепившийся после — узнаёт, а не молчит
const clients = new Set<Socket>();
let parked = false; // ушёл с места: сокет службы закрыт, ключ и адреса целы (leave.ts)
let listenerIdleAt: number | null = null; // с какого мига ни один локальный клиент не слушает
const attachHooks: (() => void)[] = [];
const ring: { raw: string; frame: Frame | null }[] = [];
const helloWaiters = new Set<(f: Frame | null) => void>();
// Память доставленных кадров — та же, что читает сторож выхода (../shared/seen.ts).
let seen: Set<string> = new Set();
// Лежалые повторы службы после пересборки сессии копятся в одно слово, а не
// будят pi и OpenCode по одному (граф nks-dev: #4881, #5033).

function isOwn(realm: string, karta: string | number, name: string): boolean {
  const s = state.standing;
  return (
    !!s &&
    s.realm === realm &&
    String(s.karta) === String(karta) &&
    (s.name ?? "") === name &&
    currentKey === keyFor()
  );
}

/** Держит ли этот мост сокет ИМЕННО этого стояния — тогда register довольно, connect ротировал бы живое место без причины. */
export function holdsStanding(realm: string, karta: string | number, name: string): boolean {
  return !!holder?.alive && isOwn(realm, karta, name);
}

/** Отняли ли у этого моста сокет ИМЕННО этого стояния (закрытие 4000): привязка цела, слух — у другого; статусный адрес — пока его не повернул чужой connect. */
export function wasEvicted(realm: string, karta: string | number, name: string): boolean {
  return !!evictedKey && evictedKey === currentKey && isOwn(realm, karta, name);
}

/** Есть ли у моста статусный адрес ИМЕННО этого стояния — занятость идёт от стояния, не от живого сокета, но только от своего. */
export const hasStatusAddressFor = (realm: string, karta: string | number, name: string): boolean =>
  !!currentStatusUrl && !!currentKey && isOwn(realm, karta, name);

/** Статусный адрес и ключ стояния, которое ведёт мост, — для занятости (status.ts). */
export const statusAddress = (): { url: string; key: string } | null =>
  currentStatusUrl && currentKey ? { url: currentStatusUrl, key: currentKey } : null;

/** Ушёл ли мост с ИМЕННО этого места (leave.ts): адрес помнит, сокет закрыт — вернуться можно без connect. */
export const isParked = (realm: string, karta: string | number, name: string): boolean =>
  parked && isOwn(realm, karta, name);

/** С какого мига мост никто не слушает локально; null — слушают или держать нечего. */
export const listenerIdleSince = (): number | null =>
  holder?.alive && clients.size === 0 ? listenerIdleAt : null;

/** Позвать, когда прицепился локальный клиент — сторож вернулся к месту. */
export function onListenerAttached(fn: () => void): void {
  attachHooks.push(fn);
}
/** Локальных клиентов сейчас (проба живости из sweep.ts отпадает тут же — она не сторож). */
export const localListeners = (): number => clients.size;

let resuming = 0; // возвратов с диска в полёте: мёртвый токен при них — протухшая запись, не тревога

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

/** Ключ стояния, которое держит мост, — для блока слушания (listen.ts). */
export const heldKey = (): string | null => currentKey;

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
  sweepStale(CFG.authDir, key);
  writeFileSync(keyFilePathFor(key), key + "\n", { mode: 0o600 });
  if (process.platform !== "win32") {
    try {
      unlinkSync(path);
    } catch {}
  }
  const gone = (sock: Socket): void => {
    clients.delete(sock);
    if (clients.size === 0) listenerIdleAt = Date.now();
  };
  const srv = createServer((sock) => {
    clients.add(sock);
    listenerIdleAt = null;
    sock.on("close", () => gone(sock));
    sock.on("error", () => gone(sock));
    for (const fn of attachHooks) fn();
    // Задним числом — доказательство держания (hello) и кадры, которых ни один
    // местный клиент ещё не получал: перевзведённый сторож не должен нести
    // делателю то же кольцо второй раз — память доставленного у моста есть.
    const backlog = ring.filter(
      ({ frame }) =>
        frame?.type === "hello" ||
        !(frame?.type === "message" && typeof frame.id === "string" && seen.has(frame.id)),
    );
    sock.write(
      JSON.stringify({ kind: "attached", key, buffered: backlog.length } satisfies ChannelEvent) +
        "\n",
    );
    for (const { raw, frame } of backlog) {
      sock.write(JSON.stringify({ kind: "frame", raw, frame } satisfies ChannelEvent) + "\n");
    }
    // Место отняли, а сторож перевзвёлся: молчание читалось бы как слух.
    if (evictedEvent && evictedKey === key) sock.write(JSON.stringify(evictedEvent) + "\n");
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

/** Отпустить всё, что держим: сокет службы, локальный сокет, публикацию. Идемпотентно. `forget` стирает и запись держания — снятие, мёртвый токен. */
export function releaseStanding(reason: string, forget = false): void {
  if (forget && currentKey) dropHoldRecord(currentKey);
  if (!holder && !server) return;
  // Пачка, ещё не отданная, уходит сейчас, а не теряется молча (backlog.ts).
  flushBacklogNow();
  standingLog(`released ${currentKey ?? "?"}: ${reason}${forget ? " (record dropped)" : ""}`);
  const released: ChannelEvent = { kind: "released", key: currentKey ?? undefined, text: reason };
  broadcast(released);
  notify("info", released); // плагин OpenCode снимает holding по этому слову, не по догадке (#5140)
  holder?.close(reason);
  holder = null;
  for (const c of clients) {
    try {
      c.end();
    } catch {}
  }
  clients.clear();
  for (const w of [...helloWaiters]) w(null); // ждать hello от отпущенного сокета незачем
  const srv = server;
  server = null;
  if (srv) {
    try {
      srv.close();
    } catch {}
  }
  if (currentKey) {
    for (const p of [keyFilePathFor(currentKey), seenFilePathOf(CFG.authDir, currentKey)]) {
      try {
        unlinkSync(p);
      } catch {}
    }
    if (process.platform !== "win32") {
      try {
        unlinkSync(socketPathFor(currentKey));
      } catch {}
    }
  }
  ring.length = 0;
  parked = false;
  listenerIdleAt = null;
  currentKey = null;
  currentUrl = null;
  currentStatusUrl = null;
  evictedKey = null;
  evictedEvent = null;
  seen = new Set();
  dropStale();
}

/** Взять этот адрес и держать его, чем бы ни был занят прежний. */
export function holdStanding(url: string, statusUrl?: string | null): string {
  const key = keyFor();
  if (url === currentUrl && key === currentKey && holder?.alive) return key;
  // Иное имя — прежнее место мост бросает сам: его запись стирается, иначе возврат по каталогу поднимал бы брошенное (#5140).
  releaseStanding("новый сокет", !!currentKey && currentKey !== key);
  currentKey = key;
  currentUrl = url;
  currentStatusUrl = statusUrl || deriveStatusUrl(url);
  openLocalServer(key);
  const s = state.standing;
  if (s)
    writeHoldRecord(key, {
      status: keptRecordStatus(key),
      realm: s.realm,
      karta: s.karta,
      name: s.name ?? "",
      url,
      statusUrl: currentStatusUrl,
      cwd: standCwd ?? readHoldRecord(key)?.cwd,
      client: harnessName(),
      key,
    });
  listenerIdleAt = Date.now();
  seen = seenIds(seenFilePathOf(CFG.authDir, key));
  openHolder(url, key);
  standingLog(`held ${key}${standCwd ? ` cwd=${standCwd}` : ""}`);
  // Слово «держу» уходит и уведомлением: плагин OpenCode не жнёт держащий мост
  // по простою, а прежде узнавал о держании лишь из attached локального сокета,
  // которого у него нет (#5140).
  notify("info", { kind: "held", key });
  return key;
}

/** Уйти с места (leave.ts): сокет службы закрыт, ключ, адреса и локальный сокет целы. Возвращает ключ или null. */
export function parkStanding(reason: string): string | null {
  if (!holder?.alive || !currentKey) return null;
  holder.close(reason);
  holder = null;
  parked = true;
  standingLog(`parked ${currentKey}: ${reason}`);
  const text = `мост ушёл с места (${reason}) — сокет закрыт, место цело; возврат — сторож или iskron_stand`;
  broadcast({ kind: "note", text });
  return currentKey;
}

/** Вернуться на место, с которого ушёл: тот же адрес, сокет открыт заново. */
export function resumeStanding(): boolean {
  if (!parked || !currentUrl || !currentKey) return false;
  parked = false;
  // Доказательство слуха — свежий hello за этим открытием, не прежний из кольца (#5036 §4).
  for (let i = ring.length - 1; i >= 0; i--)
    if (ring[i]?.frame?.type === "hello") ring.splice(i, 1);
  openHolder(currentUrl, currentKey);
  standingLog(`resumed ${currentKey}: socket reopened on the same address`);
  return true;
}

function openHolder(url: string, key: string): void {
  holder = holdSocket({
    url,
    onFrame: (raw, frame) => {
      void completeFrame(stampOrigin(frame)).then((full) => {
        // Лежалый кадр — принятое, пока место не слушали (после revoke — почта
        // предшественника), либо повтор службы после пересборки сессии: хода не
        // стоит, но и не теряется — уходит одной пачкой на полосу, не по одному.
        if (full?.type === "message" && full.stale === true)
          return noteStale(full, (ev) => {
            broadcast(ev);
            notify("info", ev);
          });
        const text = full === frame ? raw : JSON.stringify(full);
        // В кольцо идёт и hello: сторож, прицепившийся позже, должен увидеть
        // доказательство держания, а не только рабочие кадры.
        ring.push({ raw: text, frame: full });
        if (ring.length > RING) ring.shift();
        if (full?.type === "hello") for (const w of [...helloWaiters]) w(full);
        const ev: ChannelEvent = { kind: "frame", raw: text, frame: full };
        broadcast(ev);
        const id = full?.type === "message" && typeof full.id === "string" ? full.id : "";
        const seenPath = seenFilePathOf(CFG.authDir, key);
        // Повтор уже отданного кадра (тот же id — платформа отдала его снова после
        // возврата места) не будит второй раз: память доставленного пережила мост.
        const again = !!id && seen.has(id);
        // Кадр, отданный локальному клиенту (Claude Code, Codex), — отдан: сторож выхода, взведённый
        // после, на нём не выходит. Без клиента не отмечается: принятое в пустоту должно будить его.
        if (id && clients.size > 0) noteSeen(seenPath, id, seen);
        if (full?.type === "status") return;
        if (again) return log(`frame ${id} came again — already delivered, not raised`);
        if (notifiedClient()) {
          // pi и OpenCode: уведомление и есть доставка, и .seen пишется в миг
          // уведомления — кадр в окне пачки (backlog.ts, #5140) ещё не отдан, и
          // умерший в окне мост его не потеряет: платформа отдаст снова.
          const flushBacklog = (b: ChannelEvent): void => {
            for (const f of b.frames ?? [])
              if (typeof f.id === "string" && f.id) noteSeen(seenPath, f.id, seen);
            notify("info", b);
          };
          if (full?.type === "hello" && Number(full.pending) > 0)
            openBacklog(Number(full.pending), flushBacklog);
          if (full?.type === "message") {
            if (full.origin === "platform") openBacklog(0, flushBacklog);
            if (noteBacklog(full)) return;
          }
          if (id) noteSeen(seenPath, id, seen);
        }
        notify("info", ev);
      });
    },
    onEvicted: (code) => {
      const text =
        `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли, слушает другой держатель; ` +
        "привязка записей цела, занятость — пока адрес не повернули connect-ом; вернуть слух сюда — iskron_stand с take=true";
      log(text);
      standingLog(`evicted ${key}: close ${code}`);
      evictedKey = key;
      dropHoldRecord(key); // адрес повернули — запись мертва
      const ev: ChannelEvent = { kind: "evicted", code, text };
      evictedEvent = ev;
      broadcast(ev);
      notify("warning", ev);
    },
    onDeadToken: (code) => {
      if (revokingOwn) {
        // Своё снятие в полёте: 4001 пришёл раньше ответа revoke — это не
        // смерть токена, а его закрытие; отпускаем тихо, иначе послушный агент
        // пересоздаст только что снятое место (наблюдено в OpenCode и Codex).
        log(
          `standing revoked by this session — released quietly, binding forgotten (${state.standing?.name ?? "unnamed"}; close ${code} arrived before the answer)`,
        );
        releaseStanding("снято своим revoke", true);
        state.standing = null;
        state.standingSession = null;
        return;
      }
      if (resuming > 0) {
        // Протухшая запись держания: место у платформы уже мертво — не тревога,
        // а тихий откат; iskron_stand займёт место заново connect-ом.
        log(`hold record for ${key} is dead at the platform (close ${code}) — dropped`);
        releaseStanding("возврат с диска не удался", true);
        return;
      }
      const text = `ДЕЛАТЕЛЬ: ${deadTokenAdvice(code)}`;
      log(text);
      standingLog(`dead ${key}: close ${code}`);
      const ev: ChannelEvent = { kind: "dead", code, text };
      broadcast(ev);
      notify("error", ev);
      releaseStanding("токен мёртв", true);
    },
    onServiceAlive: (version) => {
      const text =
        `ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает (${version}) — место держу, переоткрываю реже; ` +
        "не пройдёт — спроси о токене";
      log(text);
      const ev: ChannelEvent = { kind: "alive", version, text };
      broadcast(ev);
      notify("warning", ev);
    },
    onNote: (text) => {
      log(text);
      broadcast({ kind: "note", text });
    },
  });
}

let revokingOwn = false;
/** absorb.ts: своё снятие в полёте — закрытие 4001 обгонит ответ revoke, и это не смерть токена. */
export function setRevokingOwn(v: boolean): void {
  revokingOwn = v;
}
