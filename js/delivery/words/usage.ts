// Почему расход не лёг в attrs места (граф @nks/nks-dev, узлы #6271, #6401).
import type { Lang } from "../lang.ts";

export interface UsageWords {
  notHosted: () => string;
  noNumbers: () => string;
  /** max — предел объекта usage в записи такта, байт. */
  tooLarge: (max: number) => string;
}

export const USAGE: Readonly<Record<Lang, UsageWords>> = {
  ru: {
    notHosted: () => "расход пишут только OpenCode и pi",
    noNumbers: () => "в снимке нет цифр",
    tooLarge: (max) => `снимок больше ${max} байт — предела записи такта; не отправлен`,
  },
  en: {
    notHosted: () => "only OpenCode and pi report usage",
    noNumbers: () => "the snapshot has no numbers",
    tooLarge: (max) => `the snapshot is over ${max} bytes, the tact record's limit; not sent`,
  },
};
