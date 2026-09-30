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
function pipeNonce(authDir: string): string {
  const file = join(seamRunDir(authDir), "pipe");
  mkdirSync(seamRunDir(authDir), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, randomBytes(16).toString("hex"), { mode: 0o600, flag: "wx" });
  } catch {}
  return readFileSync(file, "utf8").trim();
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
    };

const pidAlive = (pid: unknown): boolean => {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
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
 * Брошенный (хозяин мёртв или замок старше staleMs) уносится rename в
 * уникальное имя, и снимает его только унёсший, сверив токен: из двух
 * уносящих уносит один, а чужой замок, унесённый по ошибке, не снимается.
 * Отказ файловой системы (EACCES, EROFS…) — fault сразу, не ожидание.
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
    if (held && pidAlive(held.pid) && Date.now() - held.started_at < staleMs)
      return { held: false, fault: null };
    const away = `${path}.stale-${token}`;
    try {
      renameSync(path, away);
    } catch {
      return { held: false, fault: null }; // унёс другой — он и возьмёт
    }
    if (readLock(away)?.token !== held?.token)
      return { held: false, fault: `a live lock was taken by mistake and is left as ${away}` };
    try {
      unlinkSync(away);
    } catch {}
    return claim() ? { held: true, release } : { held: false, fault: null };
  } catch (e) {
    return { held: false, fault: `${path}: ${(e as Error).message}` };
  }
}
