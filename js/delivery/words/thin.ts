// Слова тонкого моста (граф @nks/nks-dev, узел #6080): то, что он говорит агенту
// о местах сессии при смене демона.
import type { Lang } from "../lang.ts";

export interface ThinWords {
  /** Причина потери места рядом в другом графе: возврат основного его не вернул (#7602). */
  besideNotBack: () => string;
}

export const THIN: Readonly<Record<Lang, ThinWords>> = {
  ru: {
    besideNotBack: () => "место рядом не вернулось вместе с основным",
  },
  en: {
    besideNotBack: () => "the seat beside did not come back with the main one",
  },
};
