// Память доставленных кадров стояния — id, на которых делателя уже будили.
// Файл лежит рядом с ключом стояния (см. standings.ts). Пишет его тот, кто кадр
// ОТДАЛ: сторож под Monitor — напечатав, сторож выхода — выходя на нём, мост —
// уведомив pi или OpenCode; запись в локальный сокет ещё не доставка. Читают
// все: мост — не отдать кольцо второй раз и узнать повтор платформы, сторож
// выхода — не проснуться на отданном (граф nks-dev: #4469, #4881). Файл
// переживает мост: место, возвращённое новым мостом, помнит отданное вчера
// (#5831); лежалые файлы прибирает уборка по возрасту (sweep.ts).
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { type Frame } from "./channel.ts";

/**
 * Сколько меток держит память: день трафика места — id кадра и метка события на
 * каждый, и вся очередь, которую платформа отдаёт снова после переподключения
 * (#5831, #5828). Метка — одна строка дописью; файл переписывается хвостом раз
 * в SEEN_SLACK новых меток, не на каждой.
 */
export const SEEN_KEEP = 5000;
export const SEEN_SLACK = 1000;

/**
 * Метка события графа в памяти доставленного: `ev:<event_id>`; "" — кадр не несёт
 * события. Событие — только кадр via=graph с телом-объектом и event_id в нём: слово
 * делателя, где встретился такой JSON, событием не бывает. Платформа раздаёт одно
 * событие каждому месту роли, у каждой копии свой id кадра (граф nks-dev: #5829).
 */
export function eventKeyOf(frame: Frame | null | undefined): string {
  if (frame?.provenance?.via !== "graph") return "";
  const body = frame.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const ev = (body as Record<string, unknown>).event_id;
  return typeof ev === "number" || (typeof ev === "string" && ev) ? `ev:${ev}` : "";
}

/**
 * Метки доставленного кадра: его id и событие графа. Лежалая копия метит событие
 * отдельно (`evs:`) — пачка не будит, и живая копия того же события будить вправе.
 */
export function deliveredKeys(frame: Frame | null | undefined): string[] {
  const id = typeof frame?.id === "string" ? frame.id : "";
  const ev = eventKeyOf(frame);
  return [id, ev && frame?.stale === true ? `evs:${ev.slice(3)}` : ev].filter(Boolean);
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
    appendFileSync(seenPath, id + "\n");
    if (seen.size > SEEN_KEEP + SEEN_SLACK) compact(seenPath, seen);
  } catch {
    /* memory is best effort: a lost note costs one extra wake, never a lost one */
  }
}

/**
 * Обрезать память до хвоста в SEEN_KEEP меток, старые — прочь первыми. Хвост
 * сливается с файлом: там метки других писателей, которых нет в этой памяти, и
 * выбросить их — снова разбудить отданным. Порядок свежести — порядок дописи в
 * файле; своя метка, которой в файле уже нет (её обрезал другой писатель), —
 * старше всего в нём.
 */
function compact(seenPath: string, seen: Set<string>): void {
  const file = [...seenIds(seenPath)];
  const inFile = new Set(file);
  const tail = [...[...seen].filter((x) => !inFile.has(x)), ...file].slice(-SEEN_KEEP);
  // Во временный файл и rename: читающий в миг обрезки не увидит пустого файла.
  const tmp = `${seenPath}.${process.pid}.tmp`;
  writeFileSync(tmp, tail.join("\n") + "\n");
  renameSync(tmp, seenPath);
  seen.clear();
  for (const x of tail) seen.add(x);
}
