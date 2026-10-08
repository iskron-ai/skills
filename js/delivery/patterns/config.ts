// Слово человека о выборе сервера (граф @nks/nks-dev, узел #5040): `ru` и `en` —
// два продовых адреса, на любом языке поставки.
export const SERVER_CHOICE = {
  ru: /^(ru|russian|русский)$/i,
  en: /^(en|ai|english|английский)$/i,
} as const;
