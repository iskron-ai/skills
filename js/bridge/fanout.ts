// Веер одного события графа по местам роли (граф nks-dev: #5829): у каждой копии
// свой id кадра и тот же event_id; лежалые копии погасших мест приходят живому
// месту при переоткрытии сокета. Делатель слышит событие один раз.
import { type Frame } from "../shared/channel.ts";
import { eventKeyOf, seenIds } from "../shared/seen.ts";
import { type StaleBurst } from "./stale.ts";

/** Помечена ли хоть одна метка отданной — в памяти моста или в файле .seen, который пишут клиенты. */
export function isDelivered(keys: string[], seen: Set<string>, seenPath: string): boolean {
  if (!keys.length) return false;
  const given = seenIds(seenPath);
  return keys.some((k) => seen.has(k) || given.has(k));
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
