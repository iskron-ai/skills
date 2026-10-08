// Образцы прозы, которую разбирает проба моста-спутника doctor (граф @nks/nks-dev,
// узел #6809): двуязычны при любом языке сессии.

/** Отказ сервера, за которым стоит вход. */
export const SAT_LOGIN_RE =
  /\/login\b|oauth|authoriz|sign.?in|log.?in|вход|войд|токен отвергнут|\b401\b/i;
/** stderr моста, не знающего флага спутника. */
export const SAT_OLD_FLAG_RE = /satellite|unknown (flag|option)|неизвестн/i;
