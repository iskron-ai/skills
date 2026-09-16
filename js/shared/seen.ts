// Память доставленных кадров стояния — id, на которых делателя уже будили.
// Файл лежит рядом с ключом стояния (см. standings.ts); пишет его и мост
// (кадр отдан хотя бы одному локальному клиенту — двери харнеса), и сторож
// выхода-на-кадре (кадр отдан выходом). Читает сторож выхода: кадр из кольца
// моста, уже отданный, не будит второй раз (граф nks-dev: #4469, #4881).
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
      // Rewrite with the tail; the ring is far shorter than this anyway.
      writeFileSync(seenPath, [...seen].slice(-SEEN_KEEP).join("\n") + "\n");
    } else appendFileSync(seenPath, id + "\n");
  } catch {
    /* memory is best effort: a lost note costs one extra wake, never a lost one */
  }
}
