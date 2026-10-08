// Слова сверки с релизами GitHub (граф @nks/nks-dev, узел #6467): отказы API и
// страницы релизов, лимит и его сброс.
import type { Lang } from "../lang.ts";

export interface ReleasesWords {
  /** iso — время сброса, min — минут до него. */
  reset: (iso: string, min: number) => string;
  noReset: () => string;
  perHour: (limit: number) => string;
  anyHourly: () => string;
  /** per — perHour или anyHourly, reset — reset или noReset. */
  exhausted: (per: string, reset: string) => string;
  secondary: (reset: string) => string;
  recordedByOther: (reset: string) => string;
  httpFrom: (status: number, url: string) => string;
  /** location — Location ответа или пустая строка. */
  noTag: (status: number, url: string, location: string) => string;
  fromPage: (apiError: string, tag: string) => string;
  fallback: () => string;
}

export const RELEASES: Readonly<Record<Lang, ReleasesWords>> = {
  ru: {
    reset: (iso, min) => `сброс ${iso} (через ${min} мин)`,
    noReset: () => "время сброса GitHub не назвал",
    perHour: (limit) => `${limit} запросов в час`,
    anyHourly: () => "лимит в час",
    exhausted: (per, reset) =>
      `лимит анонимного API GitHub исчерпан: ${per} на внешний адрес машины, общий всем мостам и клиентам за ним; ${reset}`,
    secondary: (reset) =>
      `вторичный лимит API GitHub: слишком частые запросы с внешнего адреса машины; ${reset}`,
    recordedByOther: (reset) => `лимит API GitHub, записанный другим мостом машины; ${reset}`,
    httpFrom: (status, url) => `HTTP ${status} от ${url}`,
    noTag: (status, url, location) =>
      `HTTP ${status} от ${url}${location ? ` → ${location}` : ""} — тега нет`,
    fromPage: (apiError, tag) =>
      `релизы: API не ответил (${apiError}) — тег ${tag} со страницы релизов`,
    fallback: () => "запасной путь",
  },
  en: {
    reset: (iso, min) => `reset ${iso} (in ${min} min)`,
    noReset: () => "GitHub did not name the reset time",
    perHour: (limit) => `${limit} requests an hour`,
    anyHourly: () => "an hourly limit",
    exhausted: (per, reset) =>
      `the anonymous GitHub API limit is exhausted: ${per} per the machine's external address, shared by all bridges and clients behind it; ${reset}`,
    secondary: (reset) =>
      `GitHub API secondary limit: too frequent requests from the machine's external address; ${reset}`,
    recordedByOther: (reset) =>
      `a GitHub API limit recorded by another bridge of the machine; ${reset}`,
    httpFrom: (status, url) => `HTTP ${status} from ${url}`,
    noTag: (status, url, location) =>
      `HTTP ${status} from ${url}${location ? ` → ${location}` : ""} — no tag`,
    fromPage: (apiError, tag) =>
      `releases: the API did not answer (${apiError}) — tag ${tag} from the releases page`,
    fallback: () => "fallback",
  },
};
