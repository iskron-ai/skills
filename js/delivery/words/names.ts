// Слова правила имени стояния (граф @nks/nks-dev, узел #5068): чем явное имя
// нарушает правило сервера.
import type { Lang } from "../lang.ts";

export interface NameWords {
  /** length — длина имени в знаках. */
  overLimit: (length: number) => string;
  capitals: () => string;
  badSigns: () => string;
}

export const NAMES: Readonly<Record<Lang, NameWords>> = {
  ru: {
    overLimit: (length) => `длиннее предела: ${length} знаков`,
    capitals: () => "заглавные буквы не допускаются",
    badSigns: () => "недопустимые знаки или первый знак не буква и не цифра",
  },
  en: {
    overLimit: (length) => `over the limit: ${length} signs`,
    capitals: () => "capital letters are not allowed",
    badSigns: () => "signs not allowed, or the first sign is neither a letter nor a digit",
  },
};
