// Языки поставки (граф @nks/nks-dev, узел #6080): набор, умолчание и правило
// языка по адресу сервера. Состояние сессии и выбор держит ядро (shared/lang.ts).

/** Языки, на которых говорит поставка; словари слоя (words/) несут каждый. */
export const LANGS = ["ru", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Язык, когда ни переменная, ни адрес сервера его не назвали. */
export const DEFAULT_LANG: Lang = "ru";

/** Язык по адресу сервера: хост на .ai — английский, иначе (и неразборчивый адрес) — русский. */
export function langOfServer(url: string): Lang {
  try {
    return /\.ai\.?$/i.test(new URL(url).hostname) ? "en" : "ru";
  } catch {
    return "ru";
  }
}
