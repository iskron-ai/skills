// Где лежат сокеты стояний — ОДНА конвенция на мост и его клиентов-сторожей.
// Корень — каталог гранта моста (`--auth-dir`, ISKRON_BRIDGE_AUTH_DIR, иначе
// ~/.iskron-bridge); сторож обязан вывести то же место, что и мост, иначе он
// честно отвечает «мост не держит ни одного стояния» о мосте, который держит.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { L } from "./lang.ts";
import { envOf } from "./scope.ts";

export const defaultAuthDir = (): string => join(homedir(), ".iskron-bridge");

export const authDirFromEnv = (): string =>
  envOf("ISKRON_BRIDGE_AUTH_DIR")?.trim() || defaultAuthDir();

export const standingsDirOf = (authDir: string): string => join(authDir, "standings");

const hashOf = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 16);

/**
 * Путь сокета — по хешу ключа, не по самому ключу: у unix-сокета на macOS и BSD
 * предел пути 104 байта, и читаемое имя стояния его выбирает. Читаемое имя
 * лежит рядом файлом `<хеш>.key`, по нему сторож без аргумента находит стояние.
 */
export function socketPathOf(authDir: string, key: string): string {
  if (process.platform === "win32") return `\\\\.\\pipe\\iskron-${hashOf(key)}`;
  const near = join(standingsDirOf(authDir), `${hashOf(key)}.sock`);
  if (Buffer.byteLength(near) <= SOCKET_PATH_MAX) return near;
  // Каталог гранта длинный — сокет в коротком личном каталоге, под хешем
  // каталога и ключа: два моста с разными каталогами не делят одного сокета.
  return join(shortSocketDir(), `${hashOf(resolve(authDir) + "\0" + key)}.sock`);
}

/** Предел пути unix-сокета без завершающего нуля: 104 байта на macOS и BSD, 108 на Linux. */
const SOCKET_PATH_MAX = 103;

/** Короткий личный каталог сокетов — когда путь под каталогом гранта не влезает в предел. */
export const shortSocketDir = (): string =>
  join("/tmp", `iskron-${typeof process.getuid === "function" ? process.getuid() : "u"}`);

/**
 * Личный каталог сокетов (короткий в общем /tmp, каталог шва демона) заводится
 * 0700 и берётся, только если он каталог (не ссылка) этого пользователя без
 * прав группы и прочих. Между проверкой и listen его не подменить: /tmp со
 * sticky-битом не даёт чужому переименовать наш каталог. Иначе — слово, почему
 * нет; null — годен. Двери мест (door.ts) и шов демона (seam.ts) — одна проверка.
 */
export function privateDirProblem(dir: string): string | null {
  let st;
  try {
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    st = lstatSync(dir);
  } catch (e) {
    return `${dir}: ${(e as Error).message}`;
  }
  if (!st.isDirectory()) return L(`${dir} — не каталог`, `${dir} is not a directory`);
  if (typeof process.getuid === "function" && st.uid !== process.getuid())
    return L(`${dir} принадлежит другому пользователю`, `${dir} belongs to another user`);
  if (st.mode & 0o077)
    return L(`${dir} открыт группе или прочим`, `${dir} is open to group or others`);
  return null;
}

export const keyFilePathOf = (authDir: string, key: string): string =>
  join(standingsDirOf(authDir), `${hashOf(key)}.key`);

/** Запись держания — адреса сокета и занятости (0600): мост, поднятый заново, возвращает место с диска (граф nks-dev: #5061). */
export const holdFilePathOf = (authDir: string, key: string): string =>
  join(standingsDirOf(authDir), `${hashOf(key)}.hold`);

/** Основа места (граф nks-dev: #6706): переживает запись держания, которую стирает мёртвый токен. */
export const baseFilePathOf = (authDir: string, key: string): string =>
  join(standingsDirOf(authDir), `${hashOf(key)}.base`);

/** Намерение занять место (0600): лежит, пока connect моста в полёте (граф nks-dev: #6706). */
export const takingFilePathOf = (authDir: string, key: string): string =>
  join(standingsDirOf(authDir), `${hashOf(key)}.taking`);

/** Спул передачи (0600): кадры, пришедшие уходящему демону после закрытия двери места, — преемнику (граф nks-dev: #6586). */
export const spoolFilePathOf = (authDir: string, key: string): string =>
  join(standingsDirOf(authDir), `${hashOf(key)}.spool`);

/**
 * Память отданного — id уже отданных кадров; файл рядом с ключом, не с сокетом: на
 * Windows сокет — именованный канал, не путь. С `server` — память места на этом
 * сервере (`<хеш ключа>.<хеш origin>.seen`): она переживает мост, а ключ места
 * сервера не называет, и каталог гранта у `use en|ru|url` один (#5831). Без
 * `server` — прежнее имя: память живёт, пока жив мост.
 */
export function seenFilePathOf(authDir: string, key: string, server = ""): string {
  if (!server) return join(standingsDirOf(authDir), `${hashOf(key)}.seen`);
  let origin = server;
  try {
    origin = new URL(server).origin;
  } catch {
    /* не URL — хешируется как есть */
  }
  return join(standingsDirOf(authDir), `${hashOf(key)}.${hashOf(origin).slice(0, 8)}.seen`);
}
