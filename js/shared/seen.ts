// Память доставленных кадров стояния — id, на которых делателя уже будили.
// Файл лежит рядом с ключом стояния (см. standings.ts). Пишет его тот, кто кадр
// ОТДАЛ: сторож под Monitor — напечатав, сторож выхода — выходя на нём, мост —
// уведомив pi или OpenCode; запись в локальный сокет ещё не доставка. Читают
// все: мост — не отдать кольцо второй раз и узнать повтор платформы, сторож
// выхода — не проснуться на отданном (граф nks-dev: #4469, #4881). Файл
// переживает мост: место, возвращённое новым мостом, помнит отданное вчера
// (#5831); лежалые файлы прибирает уборка по возрасту (sweep.ts).
import { appendFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { addressedToMine } from "./addressed.ts";
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

// Одно событие — один раз в ход: текстом или числом (граф @nks/nks-dev, узел #5842; #6563,
// #6574). Правило — две функции ниже, и только они: deliveryKeys — что
// метит доставка, eventIn — гасит ли копию уже помеченное. Метку пишет тот, кто внёс
// кадр в ход (шапка файла), в миг внесения; составляющий счёт проверяет eventIn.

/** Читатель меток: память доставленного, своя или с локальными метками пачки поверх. */
export type Marks = (key: string) => boolean;

/**
 * Копия, которую доставка вносит в ход ТЕКСТОМ: всё, кроме записи дела, не адресованной
 * месту, — та входит числом (#6574). Копия инбокса и слово человека в деле — текст.
 */
const asText = (frame: Frame): boolean => addressedToMine(frame);

/**
 * Метки доставки кадра: id и, если кадр несёт событие графа и вошёл текстом, — событие:
 * `ev:` живой копией, `evs:` лежалой (пачка не будит — живая будить вправе, #5842).
 * `named` — текстовая копия названа лишь числом сверх показанных (#5831): событие
 * метится `cev:`/`cevs:` — другие текстовые копии гаснут, запись дела нет. Копия, вошедшая
 * числом, метит только id: текстом событие не вошло.
 */
export function deliveryKeys(frame: Frame | null | undefined, named = false): string[] {
  const id = typeof frame?.id === "string" ? frame.id : "";
  const ev = frame && asText(frame) ? eventKeyOf(frame) : "";
  const mark = ev && frame?.stale === true ? `evs:${ev.slice(3)}` : ev;
  return [id, mark && (named ? `c${mark}` : mark)].filter(Boolean);
}

/**
 * Событие этой копии уже в ходе — копию не предлагать и не считать. Любую копию гасит
 * текст события (`ev:`); копию, входящую числом, и лежалую — ещё лежалый текст (`evs:`);
 * текстовую — и копия, названная числом (`cev:`, у лежалой и `cevs:`). Живую текстовую
 * копию лежалый текст не гасит: она будит (#5842); запись дела, текстом не вошедшую, —
 * только текст события (граф @nks/nks-dev, узел #5842).
 */
export function eventIn(frame: Frame | null | undefined, has: Marks): boolean {
  const ev = frame ? eventKeyOf(frame) : "";
  if (!ev || !frame) return false;
  const n = ev.slice(3);
  const stale = frame.stale === true;
  const keys = !asText(frame)
    ? [ev, `evs:${n}`]
    : stale
      ? [ev, `evs:${n}`, `cev:${n}`, `cevs:${n}`]
      : [ev, `cev:${n}`];
  return keys.some(has);
}

/** Та же ли это копия события по роду доставки — текст или число (веер, fanout.ts). */
export const sameCopy = (a: Frame | null | undefined, b: Frame): boolean =>
  !!a && eventKeyOf(a) === eventKeyOf(b) && asText(a) === asText(b);

/**
 * Пачка, показывающая первые `keep` кадров (`Infinity` — все): копия, чьё событие уже
 * в ходе (`has`) или входит текстом этой же пачки, — вон, где бы ни стояла; её место
 * занимает следующий кадр. `kept` — кадры, дошедшие текстом или числом, каждый один
 * раз; `keys` — метки доставки всей пачки, и вынутых: пишет их внёсший пачку.
 */
export function splitBatch(
  all: readonly Frame[],
  keep: number,
  has: Marks,
): { shown: Frame[]; kept: Frame[]; keys: string[] } {
  let kept = all.filter((f) => !eventIn(f, has));
  for (;;) {
    const shown = new Set(kept.slice(0, keep));
    const marks = new Set<string>();
    const local: Marks = (k) => marks.has(k) || has(k);
    const texts = kept.filter((f) => {
      if (!asText(f)) return true;
      if (eventIn(f, local)) return false; // текст события уже выше в этой пачке
      for (const k of deliveryKeys(f, !shown.has(f))) marks.add(k);
      return true;
    });
    const next = texts.filter((f) => asText(f) || !eventIn(f, local));
    if (next.length < kept.length) {
      kept = next;
      continue;
    }
    const on = new Set(next.slice(0, keep));
    return {
      shown: next.slice(0, keep),
      kept: next,
      keys: all.flatMap((f) => deliveryKeys(f, !on.has(f))),
    };
  }
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
