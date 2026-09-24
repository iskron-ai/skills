// Веер одного события графа по местам роли (граф nks-dev: #5829): у каждой копии
// свой id кадра и тот же event_id; лежалые копии погасших мест приходят живому
// месту при переоткрытии сокета. Делатель слышит событие один раз.
import { statSync } from "node:fs";

import { type Frame } from "../shared/channel.ts";
import { eventKeyOf, seenIds } from "../shared/seen.ts";
import { type StaleBurst } from "./stale.ts";

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
 * лежалой — только для лежалой же) или другая его копия ещё ждёт в кольце либо в пачке
 * и будет предложена и так. Кадр, вытесненный из кольца неотданным, не держит событие:
 * следующая копия предлагается. Живая копия вынимает лежалую из копящейся пачки.
 */
export function redundantCopy(
  frame: Frame | null,
  ring: readonly { frame: Frame | null }[],
  seen: Set<string>,
  seenPath: string,
  burst: StaleBurst,
): string {
  const ev = frame?.type === "message" ? eventKeyOf(frame) : "";
  if (!ev) return "";
  const stale = frame?.stale === true;
  const keys = stale ? [ev, `evs:${ev.slice(3)}`] : [ev];
  if (isDelivered(keys, seen, seenPath) || ring.some((r) => eventKeyOf(r.frame) === ev)) return ev;
  if (stale) return burst.hasEvent(ev) ? ev : "";
  burst.dropEvent(ev);
  return "";
}
