// Канонический путь каталога для сравнения и хеша (граф nks-dev: #5048): OpenCode 2.0.24
// отдаёт один каталог то /private/tmp/…, то /tmp/… (на macOS /tmp — ссылка), и строковое
// сравнение промахивалось по своим сессиям. Ссылки разворачиваются, завершающий
// разделитель снимается; каталога нет или realpath отказал — строка как пришла.
import { realpathSync } from "node:fs";
import { sep } from "node:path";

export function canonDir(p: string): string {
  let real = p;
  try {
    real = realpathSync.native(p);
  } catch {
    /* нет каталога или нет прав — сравниваем строку */
  }
  while (real.length > 1 && (real.endsWith("/") || real.endsWith(sep))) real = real.slice(0, -1);
  return real;
}

/** Один ли это каталог; пустое с пустым — нет. */
export const sameDir = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && (a === b || canonDir(a) === canonDir(b));
