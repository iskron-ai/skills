// Имена протокола, которыми мост говорит с сервером, харнесом и своими плагинами
// (граф @nks/nks-dev, узлы #6809, #6815): выводятся из имени продукта, кроме ключей,
// которые подтверждает поверхность своего сервера (serverProtocol).
import type { Lang } from "./lang.ts";
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
 * Ключ полей ответа, который мост объявляет серверу в `capabilities.experimental` —
 * из имени продукта, как прочие ключи протокола.
 */
export const STRUCTURED_CAPABILITY = `${PRODUCT}/structured`;

/**
 * Ключи протокола сервера, которые из имени продукта не выводятся: их значение
 * называет поверхность своего сервера (отказ api — `_meta[refusal]`).
 */
export const serverProtocol = {
  refusal: "iskron/refusal",
} as const;

// part 5b
/**
 * Перечень action в описании схемы канала сервера: «одно из: a | b | c» (или «one of:»);
 * группа 1 — голова, группа 2 — перечень. Двуязычно при любом языке сессии.
 */
export const ACTION_LIST_RE = /((?:одно из|one of):\s*)([a-z_]+(?:\s*\|\s*[a-z_]+)*)/i;
/**
 * Язык прозы, который мост просит у сервера явно (`locale` места, `accept-language`), по
 * языку сессии; языка нет в таблице — решает умолчание сервера.
 */
export const SERVER_LOCALE: Readonly<Partial<Record<Lang, string>>> = { en: "en" };

/** Заголовок доски каналов на обоих языках сервера — для слова о нераспознанной доске. */
export const BOARD_HEADER = { ru: "Каналы", en: "Channels" } as const;
/**
 * Проза отказа register «места больше нет» (без rule в _meta): занять заново — connect.
 * Двуязычно при любом языке сессии.
 */
export const SEAT_GONE_RE = /no such standing|take it with connect|такого стояния|занять.*connect/i;
/** Проза отказа канала «сессия не держит стояния» (без rule в _meta). */
export const UNATTRIBUTED_RE =
  /не зарегистрирован[аоы]? ни за каким стоянием|hold no registered standing/i;

// part 6
/**
 * Образцы прозы, которую разбирает проба моста-спутника doctor (граф @nks/nks-dev,
 * узел #6809): двуязычны при любом языке сессии. Отказ сервера, за которым стоит вход.
 */
export const SAT_LOGIN_RE =
  /\/login\b|oauth|authoriz|sign.?in|log.?in|вход|войд|токен отвергнут|\b401\b/i;
/** stderr моста, не знающего флага спутника. */
export const SAT_OLD_FLAG_RE = /satellite|unknown (flag|option)|неизвестн/i;
