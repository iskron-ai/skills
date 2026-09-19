// Память доставленных кадров стояния — id, на которых делателя уже будили.
// Файл лежит рядом с ключом стояния (см. standings.ts). Пишет его тот, кто кадр
// ОТДАЛ: сторож под Monitor — напечатав, сторож выхода — выходя на нём, мост —
// уведомив pi или OpenCode; запись в локальный сокет ещё не доставка. Читают
// все: мост — не отдать кольцо второй раз и узнать повтор платформы, сторож
// выхода — не проснуться на отданном (граф nks-dev: #4469, #4881).
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const SEEN_KEEP = 200;

export function seenIds(seenPath: string): Set<string> {
  try {
    return new Set(readFileSync(seenPath, "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

export function noteSeen(seenPath: string, id: string, seen: Set<string>): void {
  if (seen.has(id)) return;
  seen.add(id);
  try {
    if (seen.size > SEEN_KEEP) {
      // Rewrite with the tail — merged with the file: other writers' marks are
      // in it and not in this memory, and dropping them re-wakes a delivered frame.
      const merged = new Set([...seenIds(seenPath), ...seen]);
      writeFileSync(seenPath, [...merged].slice(-SEEN_KEEP).join("\n") + "\n");
    } else appendFileSync(seenPath, id + "\n");
  } catch {
    /* memory is best effort: a lost note costs one extra wake, never a lost one */
  }
}
