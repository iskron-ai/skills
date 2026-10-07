// Веер одного события графа по местам роли (граф nks-dev: #5829): у каждой копии
// свой id кадра и тот же event_id; лежалые копии погасших мест приходят живому
// месту при переоткрытии сокета. Делатель слышит событие один раз.
import { statSync } from "node:fs";

import { type Frame } from "../shared/channel.ts";
import { deliveredKeys, eventKeyOf, isRoomCopy, noteSeen, seenIds } from "../shared/seen.ts";
import { type Door } from "./door.ts";
import { type StaleBurst } from "./stale.ts";
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

/**
 * Метка события, если эту копию предлагать незачем: событие уже отдано (живой копией;
 * лежалой — для лежалой же и для копии дела) или другая его копия ещё ждёт в кольце либо в пачке
 * и будет предложена и так. Кадр, вытесненный из кольца неотданным, не держит событие:
 * следующая копия предлагается. Живая копия вынимает лежалую из копящейся пачки.
 */
function redundantEvent(
  frame: Frame | null,
  ring: readonly { frame: Frame | null }[],
  seen: Set<string>,
  seenPath: string,
  burst: StaleBurst,
): string {
  const ev = frame?.type === "message" ? eventKeyOf(frame) : "";
  if (!ev) return "";
  const stale = frame?.stale === true;
  // Копия дела (#6563) — счётом: она гаснет перед всякой копией события, а копию
  // инбокса не держит — та несёт событие текстом и вынимает её из лежалой пачки.
  const room = isRoomCopy(frame);
  const holds = (f: Frame | null): boolean => eventKeyOf(f) === ev && (room || !isRoomCopy(f));
  // Отданная пачка лежалых гасит и копию дела: та не будит и текста не несёт; живую
  // копию инбокса — нет, она будит (#5842).
  const keys = stale || room ? [ev, `evs:${ev.slice(3)}`] : [ev];
  if (isDelivered(keys, seen, seenPath) || ring.some((r) => holds(r.frame))) return ev;
  if ((stale || room) && burst.hasEvent(ev, !room)) return ev;
  if (!room) burst.dropEvent(ev);
  return "";
}

/**
 * Копию предлагать незачем (redundantEvent) — строкой в лог моста, и true. Кадр,
 * который предлагается, вынимает копии дела своего события из копящейся пачки
 * сторожам: они отданы им, счёт их не повторит (#5842, #6563).
 */
export function redundantCopy(frame: Frame | null, d: Door): boolean {
  const ev = redundantEvent(frame, d.ring, d.seen, d.seenPath, d.stale);
  const id = frame?.id;
  if (ev)
    log(`frame ${typeof id === "string" ? id : "?"} carries ${ev} already offered — not raised`);
  else if (frame?.type === "message")
    d.roomBatch.dropEvent(frame, (f) => {
      for (const k of deliveredKeys(f)) noteSeen(d.seenPath, k, d.seen);
      log(
        `frame ${String(f.id ?? "?")}: its event comes by the inbox frame — taken from the batch`,
      );
    });
  return !!ev;
}
