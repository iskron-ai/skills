// Первое слово в репозитории, не выровненном под агента: ни обложки, ни хука старта,
// ни штампа iskronify (shared/reposigns.ts) — дела №777/№996.
import type { Lang } from "../lang.ts";

export interface OnboardStartWords {
  start: () => string;
}

export const ONBOARD_START: Readonly<Record<Lang, OnboardStartWords>> = {
  ru: {
    start: () =>
      "Этот репозиторий ещё не выровнен под агента — начни со скилла onboarding (ветвь iskronify «Первый граф»).",
  },
  en: {
    start: () =>
      "This repository is not yet aligned for the agent — start with the onboarding skill.",
  },
};
