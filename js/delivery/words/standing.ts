// Слова привязки стояния к сессии: причина, с которой мост забывает истёкшее место.
import type { Lang } from "../lang.ts";

export interface StandingWords {
  seatExpired: () => string;
}

export const STANDING: Readonly<Record<Lang, StandingWords>> = {
  ru: { seatExpired: () => "место у платформы истекло — register: места нет" },
  en: { seatExpired: () => "the seat expired at the platform — register: no such seat" },
};
