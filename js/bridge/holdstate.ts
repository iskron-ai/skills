// Состояние держания (hold.ts) — сессии моста (shared/scope.ts): у демона машины
// сокет канала и двери мест — свои у каждой сессии, по одному на место, как у
// мостов-процессов. Отдельным модулем — чтобы hold.ts держал поведение, а не поля.
import { type Holder } from "../shared/channel.ts";
import { scoped } from "../shared/scope.ts";
import { type ChannelEvent, type Door } from "./door.ts";

export type Frame = NonNullable<ChannelEvent["frame"]>;

export const H = scoped(() => ({
  /** Каталог сессии, из которого занимается место (cwd в iskron_stand), — в запись держания, для возврата по каталогу (resume.ts). */
  standCwd: null as string | null,
  holder: null as Holder | null,
  /** последний знак службы сокета, отпущенного уходом (parkStanding), — срок записи держания от него (holdkeep.ts) */
  heardAt: 0,
  /** дверь основного места — того, ради которого взят сокет */
  door: null as Door | null,
  currentKey: null as string | null,
  currentUrl: null as string | null,
  currentStatusUrl: null as string | null,
  /** ключ места, отнятого у этого моста закрытием 4000 */
  evictedKey: null as string | null,
  /** прицепившийся после — узнаёт, а не молчит */
  evictedEvent: null as ChannelEvent | null,
  /** ушёл с места: сокет службы закрыт, ключ и адреса целы (leave.ts) */
  parked: false,
  /** ключ места, чей сокет отпущен мёртвым токеном (4001), пока мост не взял сокет снова (deaf.ts) */
  deadKey: null as string | null,
  /** места других графов того же канала на миг 4001: сервер их привязку помнит, слуха нет (deaf.ts) */
  deadPlaces: [] as { realm: string; karta: string | number; name?: string }[],
  attachHooks: [] as (() => void)[],
  helloWaiters: new Set<(f: Frame | null) => void>(),
  /** возвратов с диска в полёте: мёртвый токен при них — протухшая запись, не тревога */
  resuming: 0,
  /** своё снятие в полёте (absorb.ts): закрытие 4001 обгонит ответ revoke */
  revokingOwn: false,
  /** своё close канала в полёте (absorb.ts): закрытие 4001 обгонит ответ, как у revoke (#6634) */
  closingOwn: false,
  /** демон гаснет, а тонкий мост этой сессии жив: он вернёт место новому демону (daemon.ts, #6485) */
  handingOver: null as string | null,
}));

/** Ход после отъёма места (evicted.ts): ставится один раз при загрузке, процессу — один на все сессии. */
export const E: { next: ((key: string, url: string, code: number) => void) | null } = {
  next: null,
};
export function whenEvicted(fn: (key: string, url: string, code: number) => void): void {
  E.next = fn;
}

/** Возврат с диска в полёте (+1) или кончился (−1): мёртвый токен при нём — протухшая запись, не тревога. */
export function noteResuming(delta: number): void {
  H.resuming += delta;
}

/** absorb.ts: своё снятие в полёте — закрытие 4001 обгонит ответ revoke, и это не смерть токена. */
export function setRevokingOwn(v: boolean): void {
  H.revokingOwn = v;
}

/** absorb.ts: своё close канала в полёте — закрытие 4001 тоже не смерть токена. */
export function setClosingOwn(v: boolean): void {
  H.closingOwn = v;
}

/**
 * Процесс передаёт места преемнику (демон машины обновляется, daemon.ts): отпускание
 * мест — не «отпущено», а «передано»; записи держания целы, занятость не снимается.
 * Слово процесса, не сессии: уходят все сессии демона разом.
 */
let handingOver: string | null = null;
export function beginHandover(why: string): void {
  handingOver = why;
}
/**
 * Слово сессии: демон гаснет без преемника (SIGTERM), а её тонкий мост на связи —
 * он поднимет новый демон и вернёт место по записи держания. Это смена держателя,
 * не уход делателя: сторожу «передано», занятость не снимается (#6485).
 */
export function beginSessionHandover(why: string): void {
  H.handingOver = why;
}
/** Почему места передаются преемнику; null — не передаются. */
export const handoverReason = (): string | null => handingOver ?? H.handingOver;
export const handoverUnderway = (): boolean => handoverReason() !== null;
