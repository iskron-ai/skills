// Запись держания на диске (граф nks-dev: #5061): мост, поднятый заново —
// перезапуск плагина, /mcp reconnect — возвращает место по имени, а не
// ротирует его connect-ом: адрес, хуки и очередь остаются теми же. Секрет
// лежит 0600 рядом с ключом стояния, как грант; стирается снятием и мёртвым
// токеном (hold.ts).
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

import { scoped } from "../shared/scope.ts";
import { holdFilePathOf } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { log } from "./streams.ts";

const holdFilePathFor = (key: string): string => holdFilePathOf(CFG.authDir, key);

/** Ключ стояния по его трём именам — та же форма, что у keyFor в hold.ts. */
export function keyOf(realm: string, karta: string | number, name: string): string {
  return `${name || "_"}--${karta}--${realm}`.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

export interface HoldRecord {
  realm: string;
  karta: string | number;
  name: string;
  url: string;
  statusUrl: string | null;
  /** строка занятости, опубликованная от этого места, — возвращается вместе с ним */
  status?: string;
  /** каталог сессии харнесса, из которого место занято (cwd в iskron_stand): по нему мост, поднятый заново, находит своё место без слова агента (#5140) */
  cwd?: string;
  /** харнесс, чей мост занял место (clientInfo.name рукопожатия): возврат по каталогу не переходит границу харнесса */
  client?: string;
  /** ключ стояния — тот, что печатает блок [iskron-bridge]; возврат по ключу точнее возврата по каталогу */
  key?: string;
  /** сессия харнесса, стоявшая на месте (id сессии плагина OpenCode): по каталогу место возвращается только ей (#6017) */
  session?: string;
  /** держатель отпустил место словом (iskron_channel leave): ни сторож, ни возврат по каталогу или ключу его не поднимают — только iskron_stand по имени */
  left?: boolean;
  /** когда записано (мс эпохи) — переписывается и уходом сессии с живым сокетом (#6649): место без сокета живёт у платформы шесть часов, дольше запись мертва */
  at?: number;
  /** дела, в которые вошёл спутник, — пишет только его пауза на перезагрузку плагина (suspend.ts) */
  cases?: { realm?: string; room: string }[];
  /** основа места: имя, от которого мост выбрал это место рядом (`имя.N`), у основного — само имя (#6706) */
  base?: string;
}

/** Срок записи — время простоя, которое платформа даёт месту без сокета. */
export const HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Сессия харнесса, чей это мост, — её называет плагин в `iskron/resume` и `iskron/check` (resume.ts). */
const H = scoped(() => ({ session: null as string | null }));
export function noteHarnessSession(id: string | undefined): void {
  if (id) H.session = id;
}
export const sessionOfBridge = (): string | null => H.session;

function onDisk(key: string): HoldRecord | null {
  try {
    return JSON.parse(readFileSync(holdFilePathFor(key), "utf8")) as HoldRecord;
  } catch {
    return null;
  }
}

/**
 * Основа места знает только выбравший его мост: по виду имени её не угадать —
 * модель в выведенном имени несёт точки (`glm-5.3`), явное имя тоже (#6706).
 */
const B = scoped(() => new Map<string, string>());
export function noteSeatBase(key: string, base: string): void {
  B.set(key, base);
}
/** Основа места, запомненная этим мостом (выбор места, возврат по записи); null — неизвестна. */
export const seatBaseOf = (key: string): string | null => B.get(key) ?? null;

/**
 * Сессия в записи — только названная ЭТОМУ процессу моста (или переданная явно):
 * мост, чья сессия не названа, чужую с диска не наследует (#6017).
 * `left` держится с диска, пока новое держание не скажет `left: false`.
 */
export function writeHoldRecord(
  key: string,
  rec: HoldRecord,
  paused = false,
  at = Date.now(),
): void {
  // Место спутника живёт прогоном (satellite.ts): с диска его возвращает только пауза на перезагрузку плагина (suspend.ts).
  if (CFG.satellite && !paused) return;
  try {
    const session = H.session ?? rec.session;
    const was = rec.left == null || (rec.base ?? B.get(key)) == null ? onDisk(key) : null;
    const left = rec.left ?? was?.left === true;
    writeFileSync(
      holdFilePathFor(key),
      JSON.stringify({
        ...rec,
        session: session ?? undefined,
        left: left || undefined,
        base: B.get(key) ?? rec.base ?? was?.base,
        at,
      }) + "\n",
      { mode: 0o600 },
    );
  } catch (e) {
    log(`hold record not written: ${(e as Error).message}`);
  }
}
/**
 * Вернуть запись такой, какой она была до неудавшегося возврата, — с прежней
 * меткой времени: попытка без hello место не молодит, и срок записи держит
 * последнее настоящее держание, а не последнюю попытку (#6137).
 */
export function restoreHoldRecord(key: string, rec: HoldRecord): void {
  if (CFG.satellite) return;
  try {
    writeFileSync(holdFilePathFor(key), JSON.stringify(rec) + "\n", { mode: 0o600 });
  } catch (e) {
    log(`hold record not restored: ${(e as Error).message}`);
  }
}
/** Пометить запись места отпущенной словом держателя (leave) или снять пометку (возврат на место). */
export function markLeft(key: string, on: boolean): void {
  const r = readHoldRecord(key);
  if (r && (r.left === true) !== on) writeHoldRecord(key, { ...r, left: on });
}
/** Запись места; просроченная стирается и не читается — кроме чтения `anyAge` держащего её моста (holdkeep.ts). */
export function readHoldRecord(key: string, anyAge = false): HoldRecord | null {
  try {
    const r = JSON.parse(readFileSync(holdFilePathFor(key), "utf8")) as HoldRecord;
    if (!r || typeof r.url !== "string" || !r.realm || r.karta == null) return null;
    if (anyAge) return r;
    // Запись без метки времени — не свежая, а неведомая: как и уборка, считаем просроченной.
    if (typeof r.at !== "number" || Date.now() - r.at > HOLD_RECORD_MAX_AGE_MS) {
      dropHoldRecord(key);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}
/** Стереть запись, только если она этого держателя (тот же адрес): запись нового держателя, отнявшего место, цела. */
export function dropOwnHoldRecord(key: string, url: string | null): void {
  const r = readHoldRecord(key, true);
  if (!r || !url || r.url === url) dropHoldRecord(key);
}
export function dropHoldRecord(key: string): void {
  try {
    unlinkSync(holdFilePathFor(key));
  } catch {}
}
