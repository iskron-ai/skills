// Веер одного события графа по местам роли (граф nks-dev: #5829): у каждой копии
// свой id кадра и тот же event_id; лежалые копии погасших мест приходят живому
// месту при переоткрытии сокета. Делатель слышит событие один раз.
import { type Frame } from "../shared/channel.ts";
import { eventKeyOf, seenIds } from "../shared/seen.ts";

const KEEP = 500;
const offered = new Set<string>();

/** Помечена ли хоть одна метка отданной — в памяти моста или в файле .seen, который пишут клиенты. */
export function isDelivered(keys: string[], seen: Set<string>, seenPath: string): boolean {
  if (!keys.length) return false;
  const given = seenIds(seenPath);
  return keys.some((k) => seen.has(k) || given.has(k));
}

/** Метка события, если оно уже предложено (в кольцо, клиентам, в пачку) или отдано, — копию не предлагать; иначе "" и событие запомнено. */
export function offeredBefore(frame: Frame | null, seen: Set<string>, seenPath: string): string {
  const evKey = frame?.type === "message" ? eventKeyOf(frame) : "";
  if (!evKey) return "";
  if (offered.has(evKey) || isDelivered([evKey], seen, seenPath)) return evKey;
  offered.add(evKey);
  if (offered.size > KEEP) offered.delete(offered.values().next().value as string);
  return "";
}

/** Забыть предложенное — при отпускании стояния. */
export const dropOffered = (): void => offered.clear();
