// Проза сервера о канале, которую разбирает мост (граф @nks/nks-dev, узел #6809):
// двуязычна при любом языке сессии.

/**
 * Перечень action в описании схемы канала сервера: «одно из: a | b | c» (или «one of:»);
 * группа 1 — голова, группа 2 — перечень.
 */
export const ACTION_LIST_RE = /((?:одно из|one of):\s*)([a-z_]+(?:\s*\|\s*[a-z_]+)*)/i;
/** Проза отказа register «места больше нет» (без rule в _meta): занять заново — connect. */
export const SEAT_GONE_RE = /no such standing|take it with connect|такого стояния|занять.*connect/i;
/** Проза отказа канала «сессия не держит стояния» (без rule в _meta). */
export const UNATTRIBUTED_RE =
  /не зарегистрирован[аоы]? ни за каким стоянием|hold no registered standing/i;
