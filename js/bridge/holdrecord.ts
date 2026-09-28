// Запись держания на диске (граф nks-dev: #5061): мост, поднятый заново —
// перезапуск плагина, /mcp reconnect — возвращает место по имени, а не
// ротирует его connect-ом: адрес, хуки и очередь остаются теми же. Секрет
// лежит 0600 рядом с ключом стояния, как грант; стирается снятием и мёртвым
// токеном (hold.ts).
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";

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
  /** когда записано (мс эпохи): место без сокета живёт у платформы шесть часов, дольше запись мертва */
  at?: number;
}

/** Срок записи — время простоя, которое платформа даёт месту без сокета. */
export const HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Сессия харнесса, чей это мост, — её называет плагин в `iskron/resume` и `iskron/check` (resume.ts). */
let harnessSession: string | null = null;
export function noteHarnessSession(id: string | undefined): void {
  if (id) harnessSession = id;
}
export const sessionOfBridge = (): string | null => harnessSession;

/** Отпущено ли место словом держателя по прежней записи ключа — переписывание записи этого не снимает. */
function leftOnDisk(key: string): boolean {
  try {
    return (JSON.parse(readFileSync(holdFilePathFor(key), "utf8")) as HoldRecord)?.left === true;
  } catch {
    return false;
  }
}

/**
 * Сессия в записи — только названная ЭТОМУ процессу моста (или переданная явно):
 * мост, чья сессия не названа, чужую с диска не наследует (#6017).
 * `left` держится с диска, пока новое держание не скажет `left: false`.
 */
export function writeHoldRecord(key: string, rec: HoldRecord): void {
  if (CFG.satellite) return; // место спутника живёт прогоном: возвращать с диска нечего (satellite.ts)
  try {
    const session = harnessSession ?? rec.session;
    const left = rec.left ?? leftOnDisk(key);
    writeFileSync(
      holdFilePathFor(key),
      JSON.stringify({
        ...rec,
        session: session ?? undefined,
        left: left || undefined,
        at: Date.now(),
      }) + "\n",
      { mode: 0o600 },
    );
  } catch (e) {
    log(`hold record not written: ${(e as Error).message}`);
  }
}
/** Пометить запись места отпущенной словом держателя (leave) или снять пометку (возврат на место). */
export function markLeft(key: string, on: boolean): void {
  const r = readHoldRecord(key);
  if (r && (r.left === true) !== on) writeHoldRecord(key, { ...r, left: on });
}
/** Запись места; просроченная стирается и не читается. */
export function readHoldRecord(key: string): HoldRecord | null {
  try {
    const r = JSON.parse(readFileSync(holdFilePathFor(key), "utf8")) as HoldRecord;
    if (!r || typeof r.url !== "string" || !r.realm || r.karta == null) return null;
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
export function dropHoldRecord(key: string): void {
  try {
    unlinkSync(holdFilePathFor(key));
  } catch {}
}
