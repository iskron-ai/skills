// Слова паузы спутника на перезагрузку плагина (граф @nks/nks-dev, узлы #6625, #6080).
import type { Lang } from "../lang.ts";

export interface SuspendWords {
  noSeat: () => string;
  /** Причина ухода с сокета на паузе. */
  reason: () => string;
}

export const SUSPEND: Readonly<Record<Lang, SuspendWords>> = {
  ru: {
    noSeat: () => "места-спутника нет — паузы нет",
    reason: () => "пауза спутника",
  },
  en: {
    noSeat: () => "no satellite seat — nothing to pause",
    reason: () => "satellite pause",
  },
};
