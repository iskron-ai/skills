// Шапка пачки побудки (граф @nks/nks-dev, узел #5140): накопленное окна одним событием.
import type { Lang } from "../lang.ts";
import { FRAME_TEXT } from "./frame-text.ts";

export interface BacklogWords {
  /**
   * count — кадров в окне; expected — ожидало в очереди по hello (0 — молчит);
   * shown — показано здесь (меньше count — часть не вошла); direct — прямых слов окна.
   */
  head: (count: number, expected: number, shown: number, direct: number) => string;
}

export const BACKLOG: Readonly<Record<Lang, BacklogWords>> = {
  ru: {
    head: (count, expected, shown, direct) =>
      `Побудка: кадров ${count}` +
      (expected ? ` (ожидало в очереди: ${expected})` : "") +
      (count > shown ? `, здесь первые ${shown}, не вошло ${count - shown}` : "") +
      " — адресованные месту — текстом, прочие — счётом; " +
      `целиком — по строкам дел ниже, не вошедшее — ${FRAME_TEXT.ru.myCases()}.` +
      (direct ? ` Прямых слов ${direct} — не здесь: каждое пришло отдельно и целиком.` : ""),
  },
  en: {
    head: (count, expected, shown, direct) =>
      `Wake-up: ${count} frames` +
      (expected ? ` (waiting in the queue: ${expected})` : "") +
      (count > shown ? `, the first ${shown} here, ${count - shown} left out` : "") +
      " — those addressed to the seat as text, the rest by count; " +
      `in full — by the case lines below, the rest — ${FRAME_TEXT.en.myCases()}.` +
      (direct ? ` ${direct} direct messages are not here: each came on its own and whole.` : ""),
  },
};
