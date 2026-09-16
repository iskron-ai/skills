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
}

export function writeHoldRecord(key: string, rec: HoldRecord): void {
  try {
    writeFileSync(holdFilePathFor(key), JSON.stringify(rec) + "\n", { mode: 0o600 });
  } catch (e) {
    log(`hold record not written: ${(e as Error).message}`);
  }
}
export function readHoldRecord(key: string): HoldRecord | null {
  try {
    const r = JSON.parse(readFileSync(holdFilePathFor(key), "utf8")) as HoldRecord;
    return r && typeof r.url === "string" && r.realm && r.karta != null ? r : null;
  } catch {
    return null;
  }
}
export function dropHoldRecord(key: string): void {
  try {
    unlinkSync(holdFilePathFor(key));
  } catch {}
}
