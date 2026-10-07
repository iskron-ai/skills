// Веер одного события графа по местам роли (граф nks-dev: #5829): у каждой копии
// свой id кадра и тот же event_id; лежалые копии погасших мест приходят живому
// месту при переоткрытии сокета. Делатель слышит событие один раз.
import { statSync } from "node:fs";

import { type Frame } from "../shared/channel.ts";
import {
  countedKeys,
  deliveredKeys,
  eventKeyOf,
  eventMarkOf,
  isRoomCopy,
  noteSeen,
  seenIds,
} from "../shared/seen.ts";
import { type Door } from "./door.ts";
import { log } from "./streams.ts";

/**
 * Последнее прочтение каждого файла .seen и его отпечаток (inode, размер, mtime).
 * Файл перечитывается, только когда отпечаток сменился — дописью любого писателя
 * или обрезкой (rename); иначе отдаётся прежний набор. Кадр, чья метка найдена в
 * памяти моста, файла не трогает вовсе.
 */
const lastRead = new Map<string, { stamp: string; ids: Set<string> }>();

function givenIds(seenPath: string): Set<string> {
  let stamp: string;
  try {
    const st = statSync(seenPath);
    stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    lastRead.delete(seenPath);
    return new Set();
  }
  const hit = lastRead.get(seenPath);
  if (hit?.stamp === stamp) return hit.ids;
  const ids = seenIds(seenPath);
  lastRead.set(seenPath, { stamp, ids });
  return ids;
}

/** Помечена ли хоть одна метка отданной — в памяти моста или в файле .seen, который пишут клиенты. */
export function isDelivered(keys: string[], seen: Set<string>, seenPath: string): boolean {
  if (!keys.length) return false;
  if (keys.some((k) => seen.has(k))) return true;
  const given = givenIds(seenPath);
  return keys.some((k) => given.has(k));
}

/** Что веер читает у двери: кольцо, память отданного и пачки места. */
type FanDoor = Pick<
  Door,
  "ring" | "seen" | "seenPath" | "stale" | "backlog" | "roomBatch" | "textEvents" | "clients"
>;

/** Сколько событий, отданных текстом, держит память двери. */
const TEXT_EVENTS_KEEP = 2000;

/**
 * Метка события, если эту копию предлагать незачем: событие уже отдано (живой копией;
 * лежалой — для лежалой же и для копии дела) или другая его копия ещё ждёт в кольце либо в пачке
 * и будет предложена и так. Кадр, вытесненный из кольца неотданным, не держит событие:
 * следующая копия предлагается. Живая копия вынимает лежалую из копящейся пачки.
 *
 * Копия дела (#6563) — счётом: она гаснет только перед копией инбокса, вошедшей в ход
 * ТЕКСТОМ, — отданной (метки `ev:`/`evs:`) либо отданной мостом текстом, чью метку сторож
 * ещё не поставил (textEvents). Копия инбокса, названная пачкой лишь числом (метки
 * `cev:`/`cevs:`), её не гасит, а ждущая в окне побудки или в пачке лежалых — ещё не
 * решена: копия дела идёт своим путём, и её вынет показ копии инбокса текстом
 * (takeShownCopies; решение стюарда #931).
 */
function redundantEvent(frame: Frame | null, d: FanDoor): string {
  const ev = frame?.type === "message" ? eventKeyOf(frame) : "";
  if (!ev) return "";
  const stale = frame?.stale === true;
  const room = isRoomCopy(frame);
  if (room && caseCopyShown(frame, d)) return ev;
  // Копия в кольце держит событие для копии того же рода; копию дела держит только текст.
  const holds = (f: Frame | null): boolean => !!f && eventKeyOf(f) === ev && isRoomCopy(f) === room;
  // Копию инбокса гасит отданная копия инбокса — текстом или числом; лежалая отданная
  // живую не гасит: та будит (#5842). Копию дела — только текст (caseCopyShown выше).
  const text = stale ? [ev, `evs:${ev.slice(3)}`] : [ev];
  const keys = room ? [] : [...text, ...text.map((k) => `c${k}`)];
  if (isDelivered(keys, d.seen, d.seenPath) || d.ring.some((r) => holds(r.frame))) return ev;
  if ((stale || room) && d.stale.hasEvent(ev, room)) return ev;
  if (!room) d.stale.dropEvent(ev);
  return "";
}

/**
 * Копия дела, чьё событие уже вошло в ход текстом: отдано копией инбокса (метки `ev:`/`evs:`)
 * или отдано мостом текстом, а метку сторож ещё не поставил (textEvents). Одно правило для
 * веера и для повтора кольца прицепившемуся (door.ts): такую копию не предлагать вовсе.
 */
export function caseCopyShown(
  frame: Frame | null,
  d: Pick<FanDoor, "seen" | "seenPath" | "textEvents">,
): boolean {
  if (!isRoomCopy(frame)) return false;
  const ev = eventKeyOf(frame);
  return d.textEvents.has(ev) || isDelivered([ev, `evs:${ev.slice(3)}`], d.seen, d.seenPath);
}

/** Копию предлагать незачем (redundantEvent) — строкой в лог моста, и true. */
export function redundantCopy(frame: Frame | null, d: FanDoor): boolean {
  const ev = redundantEvent(frame, d);
  const id = frame?.id;
  if (ev)
    log(`frame ${typeof id === "string" ? id : "?"} carries ${ev} already offered — not raised`);
  return !!ev;
}

/**
 * Пачка (лежалых, побудки) отдана с показанными кадрами `shown`: копии дела их событий —
 * вон (takeShownCopies). `all` — пачка отдана клиенту уведомлений, и отданными метятся все
 * её кадры (#5831): показанные — метками отданного, названные лишь числом — метками счёта
 * (seen.ts countedKeys); null — метят сторожа сами, и пачка, ушедшая при пустом локальном
 * сокете, текстом не дошла ни до кого: она копий дела не гасит.
 */
export function batchHandedOut(
  d: FanDoor,
  shown: readonly Frame[],
  all: readonly Frame[] | null,
): void {
  const on = new Set(shown);
  for (const f of all ?? [])
    for (const k of on.has(f) ? deliveredKeys(f) : countedKeys(f)) noteSeen(d.seenPath, k, d.seen);
  if (all || d.clients.size) takeShownCopies(d, shown);
}

/**
 * Кадры `shown` вошли в ход текстом — живой кадр или показанные кадры пачки: их события
 * запоминаются (копия дела, пришедшая позже, гаснет — redundantEvent), копии дела этих
 * событий вон из пачек места, ждущих счётом (комнаты сторожам, окно побудки, лежалые),
 * и метятся отданными — счёт их не повторит (#5842, #6563). Пачки клиентов вынимают
 * свои сами по тем же показанным кадрам (seen.ts takeRoomCopies).
 */
export function takeShownCopies(d: FanDoor, shown: readonly (Frame | null)[]): void {
  for (const ev of shown.map(eventMarkOf).filter(Boolean)) {
    d.textEvents.delete(ev);
    d.textEvents.add(ev);
  }
  for (const old of d.textEvents) {
    if (d.textEvents.size <= TEXT_EVENTS_KEEP) break;
    d.textEvents.delete(old);
  }
  const taken = [
    ...d.roomBatch.takeCopies(shown),
    ...d.backlog.takeCopies(shown),
    ...d.stale.takeCopies(shown),
  ];
  for (const f of taken) {
    for (const k of deliveredKeys(f)) noteSeen(d.seenPath, k, d.seen);
    log(`frame ${String(f.id ?? "?")}: its event came as text by the inbox frame — not counted`);
  }
}
