// Имена протокола, которыми мост говорит с сервером, харнесом и своими плагинами
// (граф @nks/nks-dev, узлы #6809, #6815): выводятся из имени продукта, кроме ключей,
// которые подтверждает поверхность своего сервера (SERVER_PROTOCOL).
import { BRIDGE_NAME, PRODUCT } from "./product.ts";

/** Префикс тулов сервера поставки. */
export const TOOL_PREFIX = `${PRODUCT}_`;
/** Имя тула сервера: `tool("stand")` — `iskron_stand`. */
export const tool = (name: string): string => `${TOOL_PREFIX}${name}`;

/** Метод плагин↔мост (OpenCode, pi): `method("resume")` — `iskron/resume`. */
export const method = (name: string): string => `${PRODUCT}/${name}`;

/** Логгеры уведомлений MCP: кадры канала и слово самого моста. */
export const LOGGERS = { channel: `${PRODUCT}-channel`, bridge: BRIDGE_NAME } as const;

/** Префикс внутренних id JSON-RPC моста и его клиентов — по нему мост узнаёт свои вызовы. */
export const ID_PREFIX = `${PRODUCT}-`;

/**
 * Ключи протокола сервера. Не выводятся из имени продукта: их значение называет
 * поверхность своего сервера (отказ api — `_meta[refusal]`, поля ответа —
 * `capabilities.experimental[fields]`).
 */
export const SERVER_PROTOCOL = {
  refusal: "iskron/refusal",
  fields: "iskron/structured",
} as const;

// part 6
/**
 * Образцы прозы, которую разбирает проба моста-спутника doctor (граф @nks/nks-dev,
 * узел #6809): двуязычны при любом языке сессии. Отказ сервера, за которым стоит вход.
 */
export const SAT_LOGIN_RE =
  /\/login\b|oauth|authoriz|sign.?in|log.?in|вход|войд|токен отвергнут|\b401\b/i;
/** stderr моста, не знающего флага спутника. */
export const SAT_OLD_FLAG_RE = /satellite|unknown (flag|option)|неизвестн/i;
