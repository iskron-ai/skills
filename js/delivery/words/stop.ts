// Остановка агента снятием его места (граф @nks/nks-dev, узлы #7439, #7440, #7493): у агента
// и его места одна жизнь — снятое место кончает агента; чужое закрытие 4001 или кадр
// standing_ended — стоп, а не мёртвый токен. Имя свободно: занять его снова — явный вызов.
import type { Lang } from "../lang.ts";

/**
 * Кто снял место — по причине закрытия (`revoked:person`, `revoked:self`, `revoked:silent` —
 * платформа за молчанием после побудки о живости, #8121) или неизвестно.
 */
export type StopWho = "person" | "self" | "silent" | "other";

export interface StopWords {
  /** Слово агенту, одно на всех путях: закрытие, кадр, ход моста, встретивший снятие. */
  stopped: (name: string, who: StopWho) => string;
  /**
   * Человеку: журнал приказа на диске не записал вход (`outcome` — false: приказ до действия,
   * true — его исход); стоп исполняется всё равно, исход уходит один раз, без повтора.
   */
  orderJournalRefused: (order: string, outcome: boolean) => string;
}

const WHO_RU: Record<StopWho, string> = {
  person: "человеком",
  self: "сессией той же учётки",
  silent: "платформой: после побудки о живости не было твоего действия",
  other: "владельцем или другой сессией",
};
const WHO_EN: Record<StopWho, string> = {
  person: "by the human",
  self: "by a session of the same account",
  silent: "by the platform: no action of yours after the liveness wake-up",
  other: "by the owner or another session",
};

export const STOP: Readonly<Record<Lang, StopWords>> = {
  ru: {
    stopped: (name, who) =>
      `место ${name} снято (${WHO_RU[who]}) — ты остановлен: работу кончи, место не занимай`,
    orderJournalRefused: (order, outcome) =>
      `приказ останова ${order}: журнал на диске не записал ${outcome ? "исход" : "приказ"} — ` +
      `стоп исполнен всё равно, ${outcome ? "исход" : "исход без «принят»"} отправлен один раз, ` +
      `без повтора после перезапуска моста; проверь каталог гранта (orders/)`,
  },
  en: {
    stopped: (name, who) =>
      `the seat ${name} was taken off (${WHO_EN[who]}) — you are stopped: end the work, do not take the seat`,
    orderJournalRefused: (order, outcome) =>
      `stop order ${order}: the journal on disk did not take the ${outcome ? "outcome" : "order"} — ` +
      `the stop is executed all the same, ${outcome ? "the outcome" : "the outcome without accepted"} ` +
      `is sent once, not repeated after a bridge restart; check the grant directory (orders/)`,
  },
};
