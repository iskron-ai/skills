// Файлы локальной двери места (.key, .sock) — общие пути на ключ: новый мост
// того же места кладёт свои теми же путями. Дверь сносит только свои — по
// отпечатку (устройство, inode, время рождения), снятому, когда положила их
// сама: уступивший мост не удаляет двери преемника (граф nks-dev: #6706).
import { lstatSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

/** Отпечаток файла по пути; нет файла — null. Переименование и touch его не меняют. */
export function stampOf(path: string): string | null {
  try {
    const s = lstatSync(path, { bigint: true });
    return `${s.dev}:${s.ino}:${s.birthtimeNs}`;
  } catch {
    return null;
  }
}

/** Записать файл через переименование — свой inode, даже поверх чужого, — и вернуть его отпечаток. */
export function writeOwned(path: string, content: string): string | null {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  try {
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {}
    throw e;
  }
  return stampOf(path);
}

/** Удалить файл, только если по пути лежит тот же, что положила эта дверь. */
export function unlinkOwned(path: string, stamp: string | null): void {
  if (!stamp || stampOf(path) !== stamp) return;
  try {
    unlinkSync(path);
  } catch {}
}

/**
 * Закрыть сервер сокета, не снеся чужой сокет того же пути: libuv при закрытии
 * удаляет путь, к которому сервер привязан, кто бы там ни лежал. Лежит чужой —
 * он на миг отводится в сторону и возвращается тем же inode; закрытие синхронно.
 */
export function closeServerKeeping(path: string, stamp: string | null, close: () => void): void {
  const now = stampOf(path);
  if (!now || now === stamp) {
    close();
    unlinkOwned(path, stamp);
    return;
  }
  const aside = `${path}.${process.pid}.aside`;
  try {
    renameSync(path, aside);
  } catch {
    close();
    return;
  }
  try {
    close();
  } finally {
    try {
      renameSync(aside, path);
    } catch {}
  }
}
