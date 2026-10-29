// Правило take=true для занятого места (граф @nks/nks-dev, узлы #6976, #7194, #7493):
// вытеснение — только словом человека. Место на доске — не свидетельство жизни держателя:
// место умершего закрывает через окно мост машины с демоном, иначе оно уходит сроком
// платформы. Одно на все слова.
import type { Lang } from "../lang.ts";

export interface TakeWords {
  rule: () => string;
}

export const TAKE: Readonly<Record<Lang, TakeWords>> = {
  ru: {
    rule: () =>
      "только словом человека; место на доске — не свидетельство, что держатель жив: место умершего закроется примерно через минуту, если он держал его мостом машины с демоном, иначе — сроком платформы",
  },
  en: {
    rule: () =>
      "only on the human's word; a seat on the board is no evidence its holder is alive: a dead agent's seat closes in about a minute when it held the seat through a machine bridge with a daemon, otherwise by the platform's term",
  },
};
