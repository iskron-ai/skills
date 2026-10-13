// Остановка агента снятием его места (граф @nks/nks-dev, узлы #7439, #7440, #7493): у агента
// и его места одна жизнь — снятое место кончает агента; чужое закрытие 4001 или кадр
// standing_ended — стоп, а не мёртвый токен. Имя свободно: занять его снова — явный вызов.
import type { Lang } from "../lang.ts";

/** Кто снял место — по причине закрытия (`revoked:person`, `revoked:self`) или неизвестно. */
export type StopWho = "person" | "self" | "other";

export interface StopWords {
  /** Слово агенту, одно на всех путях: закрытие, кадр, ход моста, встретивший снятие. */
  stopped: (name: string, who: StopWho) => string;
}

const WHO_RU: Record<StopWho, string> = {
  person: "человеком",
  self: "сессией той же учётки",
  other: "владельцем или другой сессией",
};
const WHO_EN: Record<StopWho, string> = {
  person: "by the human",
  self: "by a session of the same account",
  other: "by the owner or another session",
};

export const STOP: Readonly<Record<Lang, StopWords>> = {
  ru: {
    stopped: (name, who) =>
      `место ${name} снято (${WHO_RU[who]}) — ты остановлен: работу кончи, место не занимай`,
  },
  en: {
    stopped: (name, who) =>
      `the seat ${name} was taken off (${WHO_EN[who]}) — you are stopped: end the work, do not take the seat`,
  },
};
