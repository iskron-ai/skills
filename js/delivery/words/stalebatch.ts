// Шапка пачки лежалых кадров (ядро shared/stalebatch.ts).
import type { Lang } from "../lang.ts";
import { FRAME_TEXT } from "./frame-text.ts";

export interface StaleWords {
  /** count — всех лежалых, shown — сколько вошло текстом. */
  head: (count: number, shown: number, legacy?: boolean) => string;
}

export const STALE: Readonly<Record<Lang, StaleWords>> = {
  ru: {
    head: (count, shown, legacy = false) =>
      `Лежалых кадров: ${count}` +
      (count > shown ? `, здесь первые ${shown}, не вошло ${count - shown}` : "") +
      (legacy
        ? "; адресованные месту — текстом, прочие — счётом. " +
          `Целиком — по строкам дел; не вошедшее — ${FRAME_TEXT.ru.myCases()}.`
        : "."),
  },
  en: {
    head: (count, shown, legacy = false) =>
      `Stale frames: ${count}` +
      (count > shown ? `, the first ${shown} here, ${count - shown} left out` : "") +
      (legacy
        ? " — taken while the seat was not listening, or the service repeating after a session rebuild; " +
          "those addressed to the seat as text, the rest by count; " +
          `in full — by the case lines below, the rest — ${FRAME_TEXT.en.myCases()}.`
        : "."),
  },
};
