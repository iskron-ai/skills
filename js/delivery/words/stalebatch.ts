// Шапка пачки лежалых кадров (ядро shared/stalebatch.ts).
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

export interface StaleWords {
  /** count — всех лежалых, shown — сколько вошло текстом. */
  head: (count: number, shown: number) => string;
}

export const STALE: Readonly<Record<Lang, StaleWords>> = {
  ru: {
    head: (count, shown) =>
      `Лежалых кадров: ${count}` +
      (count > shown ? `, здесь первые ${shown}, не вошло ${count - shown}` : "") +
      " — принятые, пока место не слушали, или повтор службы после пересборки сессии; " +
      "адресованные месту — текстом, прочие — счётом; " +
      `полностью и не вошедшее — ${tool("channel")}(action="history").`,
  },
  en: {
    head: (count, shown) =>
      `Stale frames: ${count}` +
      (count > shown ? `, the first ${shown} here, ${count - shown} left out` : "") +
      " — taken while the seat was not listening, or the service repeating after a session rebuild; " +
      "those addressed to the seat as text, the rest by count; " +
      `in full and the rest — ${tool("channel")}(action="history").`,
  },
};
