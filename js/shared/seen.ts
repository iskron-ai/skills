// Память доставленных кадров стояния — id, на которых делателя уже будили.
// Файл лежит рядом с ключом стояния (см. standings.ts). Пишет его тот, кто кадр
// ОТДАЛ: сторож под Monitor — напечатав, сторож выхода — выходя на нём, мост —
// уведомив pi или OpenCode; запись в локальный сокет ещё не доставка. Читают
// все: мост — не отдать кольцо второй раз и узнать повтор платформы, сторож
// выхода — не проснуться на отданном (граф nks-dev: #4469, #4881).
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { type Frame } from "./channel.ts";

const SEEN_KEEP = 200;

const eventIdIn = (o: unknown): string => {
  const v = o && typeof o === "object" ? (o as Record<string, unknown>).event_id : undefined;
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
};

/**
 * Метка события графа в памяти доставленного: `ev:<event_id>`; "" — кадр не несёт
 * события. Платформа раздаёт одно событие каждому месту роли, у каждой копии свой
 * id кадра и тот же event_id в теле (граф nks-dev: #5829) — делатель слышит его раз.
 */
export function eventKeyOf(frame: Frame | null | undefined): string {
  if (!frame) return "";
  let body: unknown = frame.body;
  if (typeof body === "string" && body.trimStart().startsWith("{")) {
    try {
      body = JSON.parse(body);
    } catch {
      body = undefined;
    }
  }
  const ev = eventIdIn(frame) || eventIdIn(body);
  return ev ? `ev:${ev}` : "";
}

/** Метки доставленного кадра: его id и событие графа, которое он несёт. */
export function deliveredKeys(frame: Frame | null | undefined): string[] {
  const id = typeof frame?.id === "string" ? frame.id : "";
  return [id, eventKeyOf(frame)].filter(Boolean);
}

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
      // Свежее — в хвост: своя старая память, затем файл (там свежие метки других), своя новая метка последней.
      seen.delete(id);
      const tail = [...new Set([...seen, ...seenIds(seenPath), id])].slice(-SEEN_KEEP);
      // Во временный файл и rename: читающий в миг обрезки не увидит пустого файла.
      const tmp = `${seenPath}.${process.pid}.tmp`;
      writeFileSync(tmp, tail.join("\n") + "\n");
      renameSync(tmp, seenPath);
      seen.clear();
      for (const x of tail) seen.add(x);
    } else appendFileSync(seenPath, id + "\n");
  } catch {
    /* memory is best effort: a lost note costs one extra wake, never a lost one */
  }
}
