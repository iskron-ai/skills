// Веер одного события графа по местам роли (граф nks-dev: #5829): у каждой копии
// свой id кадра и тот же event_id; лежалые копии погасших мест приходят живому
// месту при переоткрытии сокета. Делатель слышит событие один раз.
import { statSync } from "node:fs";

import { type Frame } from "../shared/channel.ts";
import { asText, eventIn, eventKeyOf, type Marks, sameCopy, seenIds } from "../shared/seen.ts";
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

/** Метки места — память моста и файл .seen, который пишут внёсшие кадр в ход (seen.ts eventIn). */
export const marksOf =
  (seen: Set<string>, seenPath: string): Marks =>
  (k) =>
    isDelivered([k], seen, seenPath);

/**
 * Метка события, если эту копию предлагать незачем: событие уже в ходе (seen.ts eventIn)
 * или копия того же рода ещё ждёт в кольце либо в копящейся пачке лежалых и будет
 * предложена и так. Кадр, вытесненный из кольца неотданным, не держит событие:
 * следующая копия предлагается. Живая текстовая копия будит (#5842) — лежалые
 * текстовые копии того же события вынимает из копящейся пачки.
 */
function redundantEvent(
  frame: Frame | null,
  d: Pick<Door, "ring" | "seen" | "seenPath" | "stale">,
): string {
  const ev = frame?.type === "message" ? eventKeyOf(frame) : "";
  if (!ev || !frame) return "";
  if (eventIn(frame, marksOf(d.seen, d.seenPath))) return ev;
  if (d.ring.some((r) => sameCopy(r.frame, frame))) return ev;
  const wakes = asText(frame) && frame.stale !== true;
  if (!wakes && d.stale.holdsCopy(frame)) return ev;
  if (wakes) d.stale.dropCopies(frame);
  return "";
}

/** Копию предлагать незачем (redundantEvent) — строкой в лог моста, и true. */
export function redundantCopy(
  frame: Frame | null,
  d: Pick<Door, "ring" | "seen" | "seenPath" | "stale">,
): boolean {
  const ev = redundantEvent(frame, d);
  const id = frame?.id;
  if (ev)
    log(`frame ${typeof id === "string" ? id : "?"} carries ${ev} already offered — not raised`);
  return !!ev;
}
