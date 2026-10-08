// Почему расход не лёг в attrs места (граф @nks/nks-dev, узлы #6271, #6401).
import type { Lang } from "../lang.ts";

export interface UsageWords {
  notHosted: () => string;
  noNumbers: () => string;
}

export const USAGE: Readonly<Record<Lang, UsageWords>> = {
  ru: {
    notHosted: () => "расход пишут только OpenCode и pi",
    noNumbers: () => "в снимке нет цифр",
  },
  en: {
    notHosted: () => "only OpenCode and pi report usage",
    noNumbers: () => "the snapshot has no numbers",
  },
};
