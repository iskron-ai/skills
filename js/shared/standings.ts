// Где лежат сокеты стояний — ОДНА конвенция на мост и его клиентов-сторожей.
// Корень — каталог гранта моста (`--auth-dir`, ISKRON_BRIDGE_AUTH_DIR, иначе
// ~/.iskron-bridge); сторож обязан вывести то же место, что и мост, иначе он
// честно отвечает «мост не держит ни одного стояния» о мосте, который держит.
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const defaultAuthDir = (): string => join(homedir(), ".iskron-bridge");

export const authDirFromEnv = (): string =>
  process.env.ISKRON_BRIDGE_AUTH_DIR?.trim() || defaultAuthDir();

export const standingsDirOf = (authDir: string): string => join(authDir, "standings");

const hashOf = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 16);

/**
 * Путь сокета — по хешу ключа, не по самому ключу: у unix-сокета на macOS и BSD
 * предел пути 104 байта, и читаемое имя стояния его выбирает. Читаемое имя
 * лежит рядом файлом `<хеш>.key`, по нему сторож без аргумента находит стояние.
 */
export function socketPathOf(authDir: string, key: string): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\iskron-${hashOf(key)}`;
  return join(standingsDirOf(authDir), `${hashOf(key)}.sock`);
}

export const keyFilePathOf = (authDir: string, key: string): string =>
  join(standingsDirOf(authDir), `${hashOf(key)}.key`);

/** Память сторожа выхода — id уже отданных кадров; файл рядом с ключом, не с сокетом: на Windows сокет — именованный канал, не путь. */
export const seenFilePathOf = (authDir: string, key: string): string =>
  join(standingsDirOf(authDir), `${hashOf(key)}.seen`);
