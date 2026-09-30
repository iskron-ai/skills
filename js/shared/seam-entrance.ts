// Вход шва «тонкий мост ↔ демон машины» (провод — seam.ts): где лежит сокет
// демона, чей это каталог и кто поднимает демон. Одно на обе стороны: тонкий
// мост ищет демон тем же путём, каким демон слушает.
//
//   <каталог гранта>/run/          личный каталог шва: 0700, этого пользователя,
//                                  не ссылка (privateDirProblem); иначе — отказ
//   run/daemon.sock                сокет демона 0600; длинный путь — личный
//                                  /tmp/iskron-<uid>/daemon-<ключ>.sock с той же проверкой
//   run/daemon.lock                замок жизни демона: один демон на грант
//   run/daemon.raising             замок выборов подъёма: поднимает один тонкий мост
//   run/pipe                       Windows: случайная часть имени канала (0600)
import { createHash, randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { privateDirProblem, shortSocketDir } from "./standings.ts";

/** Ключ демона — каталог гранта: один демон на грант. */
export const seamKey = (authDir: string): string =>
  createHash("sha256").update(resolve(authDir)).digest("hex").slice(0, 16);

/** Личный каталог шва: замки, случайная часть имени канала, сокет (если путь короток). */
export const seamRunDir = (authDir: string): string => join(resolve(authDir), "run");

// Путь unix-сокета без завершающего нуля: 104 байта на macOS и BSD, 108 на Linux.
const SUN_PATH_MAX = 103;

// Имя именованного канала Windows видно всем пользователям машины: его
// непредсказуемая часть — случайное слово в личном каталоге шва, которого
// чужой не прочтёт. ACL канала Node не задаёт — это предел, названный в REALITY.md.
// Файл публикуется атомарно: пишется целиком во временный и ставится на место
// link() — не rename, чтобы второй пишущий не подменил уже прочитанное первым
// слово (демон и мост разошлись бы именами). Читатель, заставший файл пустым
// (прежний неатомарный писатель), перечитывает.
function pipeNonce(authDir: string): string {
  const run = seamRunDir(authDir);
  const file = join(run, "pipe");
  mkdirSync(run, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tmp, randomBytes(16).toString("hex"), { mode: 0o600 });
    linkSync(tmp, file); // EEXIST — слово уже есть
  } catch {
  } finally {
    try {
      unlinkSync(tmp);
    } catch {}
  }
  for (let i = 0; i < 50; i++) {
    const word = readFileSync(file, "utf8").trim();
    if (word) return word;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error(`${file} stays empty — the pipe name is unknown`);
}

/** Локальный вход демона этого каталога гранта. Под Windows создаёт случайную часть имени. */
export function seamSocketPath(authDir: string): string {
  const key = seamKey(authDir);
  if (process.platform === "win32")
    return `\\\\.\\pipe\\iskron-daemon-${key}-${pipeNonce(authDir)}`;
  const inRun = join(seamRunDir(authDir), "daemon.sock");
  if (Buffer.byteLength(inRun) <= SUN_PATH_MAX) return inRun;
  return join(shortSocketDir(), `daemon-${key}.sock`);
}

/**
 * Годен ли вход: личный каталог шва и каталог сокета — каталоги этого
 * пользователя без прав группы и прочих (создаются 0700, если их нет). Иначе —
 * слово, почему нет: тонкий мост идёт полным, демон не слушает. Под Windows
 * права каталогов не проверяются (предел).
 */
export function seamEntranceProblem(authDir: string): string | null {
  if (process.platform === "win32") return null;
  const run = seamRunDir(authDir);
  try {
    mkdirSync(dirname(run), { recursive: true, mode: 0o700 }); // каталог гранта; его права — не забота шва
  } catch (e) {
    return `${dirname(run)}: ${(e as Error).message}`;
  }
  const bad = privateDirProblem(run);
  if (bad) return bad;
  const sockDir = dirname(seamSocketPath(authDir));
  return sockDir === run ? null : privateDirProblem(sockDir);
}

/** Замок выборов подъёма демона: поднимает один. */
export const seamRaiseLockPath = (authDir: string): string =>
  join(seamRunDir(authDir), "daemon.raising");

/** Замок жизни демона: один демон на каталог гранта. */
export const seamDaemonLockPath = (authDir: string): string =>
  join(seamRunDir(authDir), "daemon.lock");

// --- замок файлом (по образцу refreshlock и заявок спутника) -------------------

interface LockBody {
  pid: number;
  token: string;
  started_at: number;
}

export type FileLock =
  | { held: true; release(): void }
  | {
      held: false;
      /** занят живым — null; иначе причина, почему замка не взять */ fault: string | null;
      /** кто держит, когда занят живым */
      holder?: { pid: number; started_at: number };
    };

// Замки шва лежат в личном каталоге 0700: их хозяин — всегда этот пользователь.
// EPERM от kill(pid, 0) значит, что pid занят процессом другого пользователя, —
// номер переиспользован, прежний хозяин мёртв. Жив только свой процесс.
const ownPidAlive = (pid: unknown): boolean => {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
};

const readLock = (path: string): LockBody | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockBody;
  } catch {
    return null;
  }
};

/**
 * Взять замок: link() публикует уже записанный файл атомарно (EEXIST — занят).
 * Брошенный (хозяин не свой живой процесс или замок старше staleMs — потолок
 * давности) уносится rename в уникальное имя, и снимает его только унёсший,
 * сверив токен: из двух уносящих уносит один, а живой замок, унесённый по
 * ошибке, возвращается на место. Отказ файловой системы (EACCES, EROFS…) —
 * fault сразу, не ожидание.
 */
export function takeFileLock(path: string, staleMs: number): FileLock {
  const token = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const body = JSON.stringify({ pid: process.pid, token, started_at: Date.now() });
  const release = () => {
    if (readLock(path)?.token === token) {
      try {
        unlinkSync(path);
      } catch {}
    }
  };
  const claim = (): boolean => {
    const tmp = `${path}.${token}`;
    writeFileSync(tmp, body, { mode: 0o600 });
    try {
      linkSync(tmp, path);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    } finally {
      try {
        unlinkSync(tmp);
      } catch {}
    }
  };
  try {
    if (claim()) return { held: true, release };
    const held = readLock(path);
    if (held && ownPidAlive(held.pid) && Date.now() - held.started_at < staleMs)
      return { held: false, fault: null, holder: { pid: held.pid, started_at: held.started_at } };
    const mistake = carryAwayStale(path, held?.token);
    if (mistake) return { held: false, fault: mistake.putBack ? null : mistake.word };
    return claim() ? { held: true, release } : { held: false, fault: null };
  } catch (e) {
    return { held: false, fault: `${path}: ${(e as Error).message}` };
  }
}

/**
 * Унести брошенный замок с токеном staleToken: rename в уникальное имя, снять
 * только свой. null — унесён (или его унёс другой); иначе унесён живой по
 * ошибке: putBack — возвращён на место (замок держат), нет — оставлен в стороне.
 */
export function carryAwayStale(
  path: string,
  staleToken: string | undefined,
): { putBack: boolean; word: string } | null {
  const away = `${path}.stale-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    renameSync(path, away);
  } catch {
    return null; // унёс другой — он и возьмёт
  }
  if (readLock(away)?.token !== staleToken) {
    // Между прочтением и rename брошенный замок сменился живым: он возвращается
    // на место link() — не поверх замка, взятого третьим тем временем.
    try {
      linkSync(away, path);
    } catch {
      return {
        putBack: false,
        word: `a live lock was carried away by mistake and could not be put back (${path} is taken again); it is left as ${away}`,
      };
    }
    try {
      unlinkSync(away);
    } catch {}
    return {
      putBack: true,
      word: `a live lock was carried away by mistake and put back — ${path} is held`,
    };
  }
  try {
    unlinkSync(away);
  } catch {}
  return null;
}
