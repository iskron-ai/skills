// Слова тонкого моста (граф @nks/nks-dev, узел #6080): то, что он говорит агенту
// о местах сессии при смене демона.
import type { Lang } from "../lang.ts";

export interface ThinWords {
  /** Причина потери места рядом в другом графе: тонкий мост их не возвращает. */
  besideNotBack: () => string;
}

export const THIN: Readonly<Record<Lang, ThinWords>> = {
  ru: {
    besideNotBack: () => "места других графов рядом не возвращаются",
  },
  en: {
    besideNotBack: () => "beside seats do not come back",
  },
};
