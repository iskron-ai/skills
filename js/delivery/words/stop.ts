// Остановка агента снятием его места (граф @nks/nks-dev, узлы #7439, #7440): чужое
// закрытие 4001 — стоп, а не мёртвый токен; встать снова — только словом человека.
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

/** Кто снял место — по причине закрытия (`revoked:person`, `revoked:self`) или неизвестно. */
export type StopWho = "person" | "self" | "other";

export interface StopWords {
  /** Слово агенту, одно на всех путях: закрытие, отказ возврата, отказ стояния. */
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
      `место ${name} снято (${WHO_RU[who]}) — стоп: место не занимай, работу не продолжай; встать снова — только по слову человека: ${tool("stand")}(take=true)`,
  },
  en: {
    stopped: (name, who) =>
      `the seat ${name} was taken off (${WHO_EN[who]}) — stop: do not take the seat, do not go on with the work; to stand again — only on the human's word: ${tool("stand")}(take=true)`,
  },
};
