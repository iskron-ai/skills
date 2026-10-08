// Слово человека о выборе сервера (граф @nks/nks-dev, узел #5040): по слову на язык
// поставки, называет продовый адрес этого языка (SERVER_URLS); на любом языке сессии.
import type { Lang } from "../lang.ts";

export const SERVER_CHOICE: Readonly<Record<Lang, RegExp>> = {
  ru: /^(ru|russian|русский)$/i,
  en: /^(en|ai|english|английский)$/i,
};
