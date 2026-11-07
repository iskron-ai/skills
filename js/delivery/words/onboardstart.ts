// Первое слово в репозитории, не выровненном под агента: ни обложки, ни хука старта,
// ни штампа iskronify (shared/reposigns.ts) — дела №777/№996.
import type { Lang } from "../lang.ts";

export interface OnboardStartWords {
  start: () => string;
}

export const ONBOARD_START: Readonly<Record<Lang, OnboardStartWords>> = {
  ru: {
    start: () =>
      "Репо не выровнен: предложи человеку onboarding (iskronify, «Первый граф»); его запрос это не задерживает.",
  },
  en: {
    start: () =>
      "This repository is not yet aligned for the agent — offer the person the onboarding skill; it does not hold up their request.",
  },
};
