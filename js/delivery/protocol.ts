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

/**
 * Метка продукта на кадре, который плагин вставляет в сессию (#6815 п. 3): кадры двух
 * поставок в одной сессии различимы, и агент отвечает тулами своей.
 */
export const FRAME_MARK = `[${PRODUCT}]`;

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

/**
 * Язык прозы, который мост просит у сервера явно (`locale` места, `accept-language`), по
 * языку сессии; языка нет в таблице — решает умолчание сервера.
 */
export const SERVER_LOCALE: Readonly<Partial<Record<Lang, string>>> = { en: "en" };
