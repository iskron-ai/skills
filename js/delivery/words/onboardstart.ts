// Первое слово без рабочего графа — дела №777/№932.
import type { Lang } from "../lang.ts";

export interface OnboardStartWords {
  start: () => string;
}

export const ONBOARD_START: Readonly<Record<Lang, OnboardStartWords>> = {
  ru: {
    start: () =>
      "у тебя нет рабочего графа — начни со скилла onboarding (ветвь iskronify «Первый граф»)",
  },
  en: {
    start: () =>
      "You have no working graph — start with the onboarding skill (iskronify branch “First graph”).",
  },
};
