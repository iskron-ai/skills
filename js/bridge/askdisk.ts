// Память вопросов места на диске (граф nks-dev: роды #6867, доля моста #6868):
// файл `.asks` рядом с памятью отданного (.seen). Вопрос человеку ждёт ответа
// сутками, а .seen держит день трафика — открытый вопрос оттуда вытеснился бы,
// и гасящее его пришло бы числом. Здесь запись живёт с местом: по строке на
// вопрос мне и на его гашение — вопросов мало, файл не обрезается; файл без
// своего .seen убирает уборка (sweep.ts).
import { appendFileSync, readFileSync } from "node:fs";

import { type AskStore } from "../shared/askmemory.ts";

/** Путь памяти вопросов места по пути его .seen. */
export const asksPathOf = (seenPath: string): string => seenPath.replace(/\.seen$/, "") + ".asks";

const loaded = new Map<string, Set<string>>();

function load(path: string): Set<string> {
  try {
    return new Set(readFileSync(path, "utf8").split("\n").filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Память вопросов места: в процессе — набор, на диске — дописью. */
export function diskAsks(seenPath: string): AskStore {
  const path = asksPathOf(seenPath);
  let set = loaded.get(path);
  if (!set) loaded.set(path, (set = load(path)));
  const s = set;
  return {
    has: (k) => s.has(k),
    add: (k) => {
      if (s.has(k)) return;
      s.add(k);
      try {
        appendFileSync(path, `${k}\n`);
      } catch {}
    },
    keys: () => s,
  };
}
