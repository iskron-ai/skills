// Держание сокета стояния мостом (граф nks-dev: #4233, #4234, #4235).
//
// Мост проксирует ответ `iskron_channel(connect|mint)` и видит в нём адрес
// сокета, показанный единожды. С этой строки сокет его: он держит его той же
// дисциплиной канала, что прежде держал сторож (../shared/channel.ts), и до
// конца MCP-сессии — как исполнитель комнаты разговоров держит стояние треда.
// Наружу из моста ведут две двери, и ни одна не несёт секрета:
//   • локальный сокет в каталоге гранта (#4230, door.ts) — к нему цепляется
//     сторож под Monitor (подкоманда watchdog) и печатает кадры строками-событиями;
//   • уведомления MCP `notifications/message` с logger «iskron-channel» — их
//     читает расширение pi и вкладывает кадр в ход.
// Сокет один на канал, а канал держит места в нескольких графах (#5838):
// места рядом с основным — places.ts, кадр идёт к двери места своего графа.
// Занятость делатель пишет в файл рядом с сокетом (#4231); публикует мост.
import {
  deadTokenAdvice,
  type Holder,
  holdSocket,
  statusUrl as deriveStatusUrl,
} from "../shared/channel.ts";
import { deliveredKeys, noteSeen } from "../shared/seen.ts";
import { socketPathOf } from "../shared/standings.ts";
import { harnessName, notifiedClient } from "./client.ts";
import { stampOrigin } from "./complete.ts";
import { CFG } from "./config.ts";
import { type ChannelEvent, Door, type DoorHooks, ENV_KEY } from "./door.ts";
import { isDelivered, redundantCopy } from "./fanout.ts";
import { dropHoldRecord, keyOf, readHoldRecord, writeHoldRecord } from "./holdrecord.ts";
import {
  addExtra,
  type Channel,
  dropAllExtras,
  extraIn,
  extraOf,
  extraPlaces,
  learnFromHello,
  type Place,
  rememberExtraStatus,
  repointExtras,
  routeFrame,
} from "./places.ts";
import { otherRealm, sameRealm } from "./realms.ts";
import { batchForWatchdogs, noteRoomKind } from "./roomstack.ts";
import { standingLog } from "./store.ts";
import { emit, log } from "./streams.ts";
import { type Standing, state } from "./transport.ts";

export type { ChannelEvent } from "./door.ts";

/** Имя стояния → безопасная часть пути: буквы, цифры, точка, дефис; прочее — подчёркивание. */
function keyFor(): string {
  const s = state.standing;
  return s ? keyOf(s.realm, s.karta, s.name ?? "") : ENV_KEY;
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

const channel = (): Channel | null =>
  currentUrl ? { url: currentUrl, statusUrl: currentStatusUrl, cwd: standCwd } : null;

/** Занятость принята доской — запомнить её в записи держания места этого графа (status.ts). */
export function rememberStatus(text: string, realm?: string): void {
  const s = state.standing;
  const ch = channel();
  if (!s || !currentKey || !ch) return;
  const extra = realm ? extraIn(realm) : undefined;
  if (extra) return rememberExtraStatus(extra.door.key, ch, text);
  writeHoldRecord(currentKey, {
    realm: s.realm,
    karta: s.karta,
    name: s.name ?? "",
    url: ch.url,
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
/** Держит ли мост живой сокет канала — места других графов встают на него рядом (#5838). */
export const holdsChannel = (): boolean => !!holder?.alive && !!currentKey;
/** Путь локального сокета ключа — для проверки живого держателя (resume.ts). */
export const localSocketPathOf = (key: string): string => socketPathOf(CFG.authDir, key);
/** Возврат с диска в полёте (+1) или кончился (−1): мёртвый токен при нём — протухшая запись, не тревога. */
export function noteResuming(delta: number): void {
  resuming += delta;
}

let holder: Holder | null = null;
let door: Door | null = null; // дверь основного места — того, ради которого взят сокет
let currentKey: string | null = null;
let currentUrl: string | null = null;
let currentStatusUrl: string | null = null;
let evictedKey: string | null = null; // ключ места, отнятого у этого моста закрытием 4000
let evictedEvent: ChannelEvent | null = null; // прицепившийся после — узнаёт, а не молчит
let parked = false; // ушёл с места: сокет службы закрыт, ключ и адреса целы (leave.ts)
const attachHooks: (() => void)[] = [];
const helloWaiters = new Set<(f: Frame | null) => void>();
type Frame = NonNullable<ChannelEvent["frame"]>;
// Лежалые повторы службы после пересборки сессии копятся в одно слово, а не
// будят pi и OpenCode по одному (граф nks-dev: #4881, #5033).

const doorHooks: DoorHooks = {
  onAttach: () => {
    for (const fn of attachHooks) fn();
  },
  lateEvent: () => (evictedKey ? evictedEvent : null),
  onError: (text) => {
    log(text);
    notify("error", { kind: "note", text });
  },
};

/** Все двери канала: основного места и мест рядом. */
const doors = (): Door[] => [...(door ? [door] : []), ...extraPlaces().map((p) => p.door)];

function isOwn(realm: string, karta: string | number, name: string): boolean {
  const s = state.standing;
  if (!currentKey) return false;
  if (extraOf(realm, karta, name)) return true;
  return (
    !!s &&
    (s.realm === realm || sameRealm(s.realm, realm)) &&
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

/** Статусный адрес канала, ключ и id места этого графа (без графа — основного) — для занятости (status.ts). */
export function statusAddress(
  realm?: string,
): { url: string; key: string; standingId: string | null } | null {
  if (!currentStatusUrl || !currentKey) return null;
  const d = (realm ? extraIn(realm)?.door : undefined) ?? door;
  return { url: currentStatusUrl, key: d?.key ?? currentKey, standingId: d?.standingId ?? null };
}

/** Места, которые держит мост: основное первым, затем места других графов (#5838). */
export const heldPlaces = (): { key: string; realm: string; primary: boolean }[] => [
  ...(door && state.standing
    ? [{ key: door.key, realm: state.standing.realm, primary: true }]
    : []),
  ...extraPlaces().map((p) => ({ key: p.door.key, realm: p.standing.realm, primary: false })),
];

/** Место другого графа, если вызов его называет: уход и занятость — места своего графа (#5838). */
export const besideKeyIn = (realm: unknown): string | null => extraIn(realm)?.door.key ?? null;

/** Ушёл ли мост с ИМЕННО этого места (leave.ts): адрес помнит, сокет закрыт — вернуться можно без connect. */
export const isParked = (realm: string, karta: string | number, name: string): boolean =>
  parked && isOwn(realm, karta, name);

/** С какого мига мост никто не слушает локально ни у одной двери; null — слушают или держать нечего. */
export function listenerIdleSince(): number | null {
  if (!holder?.alive) return null;
  const ds = doors();
  if (!ds.length || ds.some((d) => d.clients.size > 0)) return null;
  return Math.max(...ds.map((d) => d.idleAt ?? 0));
}

/** Позвать, когда прицепился локальный клиент — сторож вернулся к месту. */
export function onListenerAttached(fn: () => void): void {
  attachHooks.push(fn);
}
/** Локальных клиентов сейчас у всех дверей (проба живости из sweep.ts отпадает тут же — она не сторож). */
export const localListeners = (): number => doors().reduce((n, d) => n + d.clients.size, 0);

let resuming = 0; // возвратов с диска в полёте: мёртвый токен при них — протухшая запись, не тревога

/** Кадр hello — доказательство держания; из кольца, если уже пришёл, иначе ожидание под пределом. */
export function awaitHello(timeoutMs: number): Promise<Frame | null> {
  const seen = door?.ring.find((r) => r.frame?.type === "hello")?.frame ?? null;
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

/** Ключ стояния, которое держит мост, — основного либо места названного графа (listen.ts). */
export const heldKey = (realm?: string): string | null =>
  (realm ? besideKeyIn(realm) : null) ?? currentKey;

/** Событие канала — всем дверям: сокет у мест общий. */
function broadcast(ev: ChannelEvent): void {
  for (const d of doors()) d.broadcast(ev);
}

function notify(level: "info" | "warning" | "error", data: ChannelEvent): void {
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level, logger: "iskron-channel", data },
  });
}

/** Поставить место другого графа рядом на канал, который держит мост (#5838). Null — канала нет. */
export function addPlace(s: Standing): string | null {
  const ch = channel();
  const primary = state.standing;
  if (!holder?.alive || !ch || !primary || !otherRealm(primary.realm, s.realm)) return null;
  return addExtra(s, ch, doorHooks);
}

/** id места этого графа у платформы, если register, hello или кадр его назвали. */
export const standingIdIn = (realm: string): string | null =>
  (extraIn(realm)?.door ?? door)?.standingId ?? null;

/**
 * id места из ответа register (RegisteredSession.standing_id, #5838): по нему
 * кадр находит дверь места, а занятость — место. Новое место приходит в тот же
 * сокет — служба перечитывает места канала на каждом проходе доставки.
 */
export function noteStandingId(realm: string, id: string | null): void {
  const d =
    extraIn(realm)?.door ??
    (state.standing && !otherRealm(realm, state.standing.realm) ? door : null);
  if (d && id) d.standingId = id;
}

const held = (): Place | null =>
  door && state.standing ? { standing: state.standing, door } : null;

/**
 * Отпустить всё, что держим: сокет службы, двери, публикацию. Идемпотентно.
 * `forget` стирает и записи держания — снятие, мёртвый токен. `keepBeside` —
 * тот же канал переоткрывается: места рядом остаются на нём.
 */
export function releaseStanding(reason: string, forget = false, keepBeside = false): void {
  if (forget && currentKey) dropHoldRecord(currentKey);
  if (!keepBeside) dropAllExtras(reason, forget);
  if (!holder && !door) return;
  // Пачка, ещё не отданная, уходит сейчас, а не теряется молча (backlog.ts).
  door?.flushBatches();
  standingLog(`released ${currentKey ?? "?"}: ${reason}${forget ? " (record dropped)" : ""}`);
  const released: ChannelEvent = { kind: "released", key: currentKey ?? undefined, text: reason };
  broadcast(released);
  notify("info", released); // плагин OpenCode снимает holding по этому слову, не по догадке (#5140)
  holder?.close(reason);
  holder = null;
  for (const w of [...helloWaiters]) w(null); // ждать hello от отпущенного сокета незачем
  door?.close();
  door = null;
  parked = false;
  currentKey = null;
  currentUrl = null;
  currentStatusUrl = null;
  evictedKey = null;
  evictedEvent = null;
}

/** Взять этот адрес и держать его, чем бы ни был занят прежний. */
export function holdStanding(url: string, statusUrl?: string | null): string {
  const key = keyFor();
  if (url === currentUrl && key === currentKey && holder?.alive) return key;
  // Иное имя — прежнее место мост бросает сам: его запись стирается, иначе возврат по каталогу поднимал бы брошенное (#5140).
  // То же место заново — места рядом остаются на канале (#5838).
  const same = !!currentKey && currentKey === key;
  releaseStanding("новый сокет", !!currentKey && currentKey !== key, same);
  currentKey = key;
  currentUrl = url;
  currentStatusUrl = statusUrl || deriveStatusUrl(url);
  door = new Door(key, doorHooks);
  door.open();
  const s = state.standing;
  if (s)
    writeHoldRecord(key, {
      status: readHoldRecord(key)?.status,
      realm: s.realm,
      karta: s.karta,
      name: s.name ?? "",
      url,
      statusUrl: currentStatusUrl,
      cwd: standCwd ?? readHoldRecord(key)?.cwd,
      client: harnessName(),
      key,
      left: false, // сокет держится снова — пометка ухода словом снята
    });
  const ch = channel();
  if (same && ch) repointExtras(ch);
  openHolder(url, key);
  standingLog(`held ${key}${standCwd ? ` cwd=${standCwd}` : ""}`);
  // Слово «держу» уходит и уведомлением: плагин OpenCode не жнёт держащий мост
  // по простою, а прежде узнавал о держании лишь из attached локального сокета,
  // которого у него нет (#5140).
  notify("info", { kind: "held", key });
  return key;
}

/** Уйти с места (leave.ts): сокет службы закрыт — у всех мест канала, ключи, адреса и двери целы. Возвращает ключ или null. */
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
  for (const d of doors())
    for (let i = d.ring.length - 1; i >= 0; i--)
      if (d.ring[i]?.frame?.type === "hello") d.ring.splice(i, 1);
  openHolder(currentUrl, currentKey);
  standingLog(`resumed ${currentKey}: socket reopened on the same address`);
  return true;
}

/** Кадр одной двери: кольцо, рассылка её клиентам, уведомление — как прежде у единственного места. */
function deliverTo(d: Door, raw: string, frame: Frame | null, full: Frame | null): void {
  const seenPath = d.seenPath;
  const id = full?.type === "message" && typeof full.id === "string" ? full.id : "";
  // Копия события графа, уже предложенного или отданного (веер, fanout.ts), — никому.
  const evKey = redundantCopy(full, d.ring, d.seen, seenPath, d.stale);
  if (evKey) return log(`frame ${id || "?"} carries ${evKey} already offered — not raised`);
  // Повтор уже отданного кадра (тот же id — платформа отдала его снова после
  // возврата места) никому не рассылается; отданное клиенты помечают сами — в файле.
  const again = isDelivered(id ? [id] : [], d.seen, seenPath);
  // Лежалый кадр — принятое, пока место не слушали (после revoke — почта предшественника),
  // либо повтор службы после пересборки сессии: хода не стоит, но и не теряется — одной
  // пачкой на полосу, не по одному; лежалая копия уже отданного кадра в пачку не идёт.
  // pi и OpenCode: уведомление пачкой и есть доставка — отданными метятся все кадры
  // полосы, иначе платформа, отдав их снова после переподключения, будит ими опять (#5831).
  if (full?.type === "message" && full.stale === true)
    return again
      ? log(`stale frame ${id} already delivered — dropped`)
      : d.stale.note(full, (ev, all) => {
          if (notifiedClient())
            for (const f of all) for (const k of deliveredKeys(f)) noteSeen(seenPath, k, d.seen);
          d.broadcast(ev);
          notify("info", keyed(d, ev));
        });
  const text = full === frame ? raw : JSON.stringify(full);
  // В кольцо идёт и hello — каждой двери: сторож, прицепившийся позже, должен
  // увидеть доказательство держания, а не только рабочие кадры.
  const hello = full?.type === "hello";
  for (const x of hello ? doors() : [d]) x.push(text, full);
  if (hello) for (const w of [...helloWaiters]) w(full);
  const ev: ChannelEvent = { kind: "frame", raw: text, frame: full };
  const msg = full?.type === "message" && !again ? full : null;
  if (msg) noteRoomKind(msg);
  // Сторожам кадр комнаты «в пачку» — пачкой по окну, прерывающий — после накопленного (roomstack.ts).
  const toBatch = (b: ChannelEvent): void => (d.broadcast(b), notify("info", keyed(d, b)));
  if (msg && !notifiedClient() && batchForWatchdogs(d, text, msg, toBatch)) return;
  if (!again) for (const x of hello ? doors() : [d]) x.broadcast(ev);
  if (full?.type === "status") return;
  if (again) return log(`frame ${id} came again — already delivered, not raised`);
  if (notifiedClient()) {
    // pi и OpenCode: уведомление и есть доставка, и .seen пишется в миг
    // уведомления — кадр в окне пачки (backlog.ts, #5140) ещё не отдан, и
    // умерший в окне мост его не потеряет: платформа отдаст снова. Метятся все
    // кадры окна, и не показанные пачкой: она называет их числом и адресом history.
    const flushBacklog = (b: ChannelEvent, all: Frame[]): void => {
      for (const f of all) for (const k of deliveredKeys(f)) noteSeen(seenPath, k, d.seen);
      notify("info", keyed(d, b));
    };
    if (hello && Number(full.pending) > 0) d.backlog.open(Number(full.pending), flushBacklog);
    if (full?.type === "message") {
      if (full.origin === "platform") d.backlog.open(0, flushBacklog);
      if (d.backlog.note(full)) return;
    }
    for (const k of deliveredKeys(full)) noteSeen(seenPath, k, d.seen);
  }
  notify("info", keyed(d, ev));
}

/** Событие места другого графа несёт его ключ — клиент уведомлений знает, чьё оно (#5838). */
const keyed = (d: Door, ev: ChannelEvent): ChannelEvent =>
  d === door ? ev : { ...ev, key: d.key };

function openHolder(url: string, key: string): void {
  holder = holdSocket({
    url,
    onFrame: (raw, frame) => {
      void Promise.resolve(stampOrigin(frame)).then((full) => {
        const primary = held();
        if (!primary) return door ? deliverTo(door, raw, frame, full) : undefined; // сокет без стояния (окружение)
        // hello называет места канала — их id и канонические графы (#5838).
        if (full?.type === "hello") learnFromHello(full, primary);
        // Кадр — двери своего места по to_standing_id; несопоставленный — основному со словом.
        const { door: d, note } = routeFrame(full?.type === "hello" ? null : full, primary);
        if (note) {
          log(note);
          d.broadcast({ kind: "note", text: note });
        }
        deliverTo(d, raw, frame, full);
      });
    },
    onEvicted: (code) => {
      const text =
        `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли, слушает другой держатель; ` +
        "привязка записей цела, занятость — пока адрес не повернули connect-ом; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека";
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
    // Подвисание: сторожу под Monitor — строкой, будящей агента; pi и OpenCode показывают уведомление человеку, агента оно не будит (#5380).
    onHung: (text) => {
      log(text);
      broadcast({ kind: "note", text });
      notify("warning", { kind: "note", text });
    },
  });
}

let revokingOwn = false;
/** absorb.ts: своё снятие в полёте — закрытие 4001 обгонит ответ revoke, и это не смерть токена. */
export function setRevokingOwn(v: boolean): void {
  revokingOwn = v;
}
