// Слова сужения списка тулов (bridge/narrow.ts): отказ на вызов вне набора --tools.
import type { Lang } from "../lang.ts";

export interface NarrowWords {
  /** list — набор моста, уже сведённый в строку через запятую. */
  outsideSet: (name: string, list: string) => string;
}

export const NARROW: Readonly<Record<Lang, NarrowWords>> = {
  ru: {
    outsideSet: (name, list) =>
      `Отказано (мост): тула ${name} нет в наборе этого моста (${list}) — набор задаёт --tools в записи моста.`,
  },
  en: {
    outsideSet: (name, list) =>
      `Refused (bridge): the tool ${name} is not in this bridge's set (${list}) — the set comes from --tools in the bridge entry.`,
  },
};
