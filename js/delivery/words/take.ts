// Правило take=true для занятого места (граф @nks/nks-dev, узлы #6976, #7194, #7493): место
// держит живой агент — место умершего мост закрывает сам, поэтому пробы «жив?» нет, а
// вытеснение — только словом человека. Одно на все слова.
import type { Lang } from "../lang.ts";

export interface TakeWords {
  rule: () => string;
}

export const TAKE: Readonly<Record<Lang, TakeWords>> = {
  ru: {
    rule: () =>
      "только словом человека — место держит живой агент: место умершего мост его машины закрывает сам примерно через минуту, пробовать держателя не нужно",
  },
  en: {
    rule: () =>
      "only on the human's word — a live agent holds the seat: the bridge of its machine closes a dead agent's seat itself in about a minute, no need to probe the holder",
  },
};
