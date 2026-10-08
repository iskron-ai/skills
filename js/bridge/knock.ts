// Стук iskron_stand в место человека — по полному адресу с провода (stand.ts).
// Правило #4342: один стук, повтор один раз не раньше чем через две минуты,
// дальше — слово человеку.
import { envName } from "../delivery/index.ts";
import { scoped } from "../shared/scope.ts";
import { callTool as call, short } from "./call.ts";
import { SW } from "./standwords.ts";

/**
 * Стуки в места людей — когда и сколько, ключ (граф, роль, имя, адрес места). Правило
 * ожидания — #4342. Запись живёт в процессе моста и умирает с ним; новый цикл
 * входа (connect — свежий сокет) сбрасывает счёт по этому месту: предел повторов
 * — на один заход, не пожизненный запрет.
 */
const knocks = scoped(() => new Map<string, { at: number; count: number }>());
// Окно повтора — 2 минуты по #4342; переменная — шов для проб, не ручка человека.
const KNOCK_REPEAT_AFTER_MS = Number(process.env[envName("STAND_KNOCK_REPEAT_MS")]) || 120_000;
const KNOCK_LIMIT = 2;

/** Новый цикл входа места — счёт его стуков сброшен. */
export function resetKnocks(realm: string, karta: string, name: string): void {
  for (const k of [...knocks.keys()])
    if (k.startsWith(`${realm}|${karta}|${name}|`)) knocks.delete(k);
}

export interface KnockAsk {
  realm: string;
  karta: string;
  name: string;
  room: string;
  /** роль держателя места человека — с доски либо room_karta; нет — стук не уходит */
  roomKarta: string | null;
  again: boolean;
}

/** Постучать в место человека, если правило велит, — строка ответа iskron_stand. */
export async function knock(k: KnockAsk): Promise<string> {
  const { realm, karta, name, room, roomKarta } = k;
  const key = `${realm}|${karta}|${name}|${room}`;
  const prior = knocks.get(key);
  const waited = prior ? Date.now() - prior.at : Infinity;
  if (prior && prior.count >= KNOCK_LIMIT) return SW.knockTwice(room);
  if (prior && !k.again) return SW.knockSent(room, waited, KNOCK_REPEAT_AFTER_MS);
  if (prior && waited < KNOCK_REPEAT_AFTER_MS)
    return SW.knockEarly(room, waited, KNOCK_REPEAT_AFTER_MS);
  if (!roomKarta) return SW.knockNoRole(room, realm);
  const s = await call("iskron_channel", {
    action: "send",
    realm,
    karta: roomKarta,
    standing: room,
    text: "join",
  });
  if (s.isError) return SW.knockRefused(room, short(s.text));
  knocks.set(key, { at: Date.now(), count: (prior?.count ?? 0) + 1 });
  return SW.knockDone(room, !!prior, short(s.text, 200));
}
