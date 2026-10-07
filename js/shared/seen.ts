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

const evOf = (v: unknown): string =>
  typeof v === "number" || (typeof v === "string" && v) ? `ev:${v}` : "";

/**
 * Метка события графа в памяти доставленного: `ev:<event_id>`; "" — кадр не несёт
 * события. Событие несут два кадра: via=graph с телом-объектом и event_id в нём
 * (инбокс роли) и via=room с event_id на верхнем уровне конверта, рядом с entry_id
 * (запись дела, написанная тем же событием, — граф nks-dev: #6563, дело №248). Слово
 * делателя, где встретился такой JSON, событием не бывает. Платформа раздаёт одно
 * событие каждому месту роли, у каждой копии свой id кадра (#5829).
 */
export function eventKeyOf(frame: Frame | null | undefined): string {
  const via = frame?.provenance?.via;
  if (via === "room") return evOf(frame?.event_id);
  if (via !== "graph") return "";
  const body = frame?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  return evOf((body as Record<string, unknown>).event_id);
}

/**
 * Копия события в деле: запись дела отдаётся счётом, не текстом события (#6574),
 * поэтому её доставка события не метит — кадр инбокса того же события будить
 * вправе; сама она гаснет только перед копией инбокса, вошедшей в ход текстом.
 */
export const isRoomCopy = (frame: Frame | null | undefined): boolean =>
  frame?.provenance?.via === "room" && !!eventKeyOf(frame);

/**
 * Копии дела событий, которые кадры `shown` внесли в ход ТЕКСТОМ, — вынуть из ждущей
 * пачки: событие вошло текстом копии инбокса, и счёт его не повторит (#5842, #6563).
 * Одно правило всех путей — моста и клиентов: `shown` — только кадры, вошедшие
 * текстом (живой кадр; показанные кадры пачки), никогда не названные лишь числом
 * сверх показанных — такая копия инбокса копию дела не гасит (решение стюарда #931).
 * Возвращает вынутые; копия дела и кадр без события не вынимают ничего.
 */
export function takeRoomCopies<T>(
  pile: T[],
  shown: readonly (Frame | null | undefined)[],
  frameOf: (x: T) => Frame | null | undefined,
): T[] {
  const evs = new Set(shown.map(eventMarkOf).filter(Boolean));
  const out: T[] = [];
  for (let i = pile.length - 1; evs.size && i >= 0; i--) {
    const f = frameOf(pile[i]);
    if (isRoomCopy(f) && evs.has(eventKeyOf(f))) out.unshift(...pile.splice(i, 1));
  }
  return out;
}

/**
 * Пачка, которая показывает первые `keep` кадров: копии дела событий, показанных ею
 * текстом, — вон из пачки целиком, внутри показанных и за пределом (#5842, #6563). Место
 * поглощённой занимает следующий кадр — и его событие, показанное текстом, поглощает
 * свои копии тоже. `kept` — кадры пачки, дошедшие текстом или числом, каждый один раз:
 * первые `keep` из них показаны (`shown`); `absorbed` — поглощённые, они отданы с пачкой.
 */
export function splitBatch(
  all: readonly Frame[],
  keep: number,
): { shown: Frame[]; kept: Frame[]; absorbed: Frame[] } {
  const kept = [...all];
  const absorbed: Frame[] = [];
  for (let got = 1; got;) {
    const taken = takeRoomCopies(kept, kept.slice(0, keep), (f) => f);
    absorbed.push(...taken);
    got = taken.length;
  }
  return { shown: kept.slice(0, keep), kept, absorbed };
}

/** Метка события, которую пишет доставка кадра: "" — у копии дела и у кадра без события. */
export const eventMarkOf = (frame: Frame | null | undefined): string =>
  isRoomCopy(frame) ? "" : eventKeyOf(frame);

/**
 * Метки доставленного кадра: его id и событие графа. Лежалая копия метит событие
 * отдельно (`evs:`) — пачка не будит, и живая копия того же события будить вправе.
 */
export const deliveredKeys = (frame: Frame | null | undefined): string[] => keysOf(frame, "");

function keysOf(frame: Frame | null | undefined, prefix: string): string[] {
  const id = typeof frame?.id === "string" ? frame.id : "";
  const ev = eventMarkOf(frame);
  const mark = ev && frame?.stale === true ? `evs:${ev.slice(3)}` : ev;
  return [id, mark && prefix + mark].filter(Boolean);
}

/**
 * Метки кадра пачки, названного лишь числом сверх показанных (#5831): событие —
 * с приставкой `c` (`cev:`, `cevs:`). Другие копии инбокса гаснут перед ним, как
 * перед отданным, а копия дела — нет: текстом событие в ход не вошло (fanout.ts).
 */
export const countedKeys = (frame: Frame | null | undefined): string[] => keysOf(frame, "c");

/** Метки лежалой пачки: показанные кадры и названные числом сверх них (#5831) — у моста и сторожей. */
export const staleBatchKeys = (ev: { frames?: Frame[]; unshown?: string[] }): string[] => [
  ...(ev.frames ?? []).flatMap((f) => deliveredKeys(f)),
  ...(ev.unshown ?? []),
];

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
