// Слова ворот возврата машины: вызов, чья очередь у ворот дальше ~20 с, не держится и отвечает сразу.
import type { Lang } from "../lang.ts";

export interface ReturnGateWords {
  /** `s` — оставшаяся очередь места у ворот, целых секунд. */
  returning: (s: number) => string;
}

export const RETURN_GATE: Readonly<Record<Lang, ReturnGateWords>> = {
  ru: { returning: (s) => `место возвращается — сервер не тронут, повтори через ${s} с` },
  en: {
    returning: (s) => `the seat is returning — the server was not touched, call again in ${s} s`,
  },
};
