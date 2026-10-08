// Слова держателя живого канала (ядро shared/channel.ts): совет на мёртвом токене
// (граф @nks/nks-dev, узел #5189), подвисшее соединение (#5397, #5380), раскатка.
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";

export interface ChannelWords {
  deadTokenAdvice: (code: number) => string;
  binaryFrame: () => string;
  /** silent — секунд молчания, ping — интервал пинга в секундах. */
  hung: (silent: number, ping: number) => string;
  rollout: () => string;
}

export const CHANNEL: Readonly<Record<Lang, ChannelWords>> = {
  ru: {
    deadTokenAdvice: (code) => `закрытие ${code} — токен мёртв, зови connect`,
    binaryFrame: () => "[двоичный кадр]",
    hung: (silent, ping) =>
      `соединение молчит ${silent} с при пинге раз в ${ping} с — подвисло без закрытия; переоткрываю тем же адресом. Кадры, пришедшие за время молчания, могли пропасть — сверь ${tool("channel")}(action="history")`,
    rollout: () => "служба не отвечает — идёт раскатка, держу тот же токен",
  },
  en: {
    deadTokenAdvice: (code) => `close ${code} — the token is dead, call connect`,
    binaryFrame: () => "[binary frame]",
    hung: (silent, ping) =>
      `the connection has been silent for ${silent} s with a ping every ${ping} s — hung without closing; reopening at the same address. Frames that arrived during the silence may be lost — check ${tool("channel")}(action="history")`,
    rollout: () => "the service is not answering — a rollout is under way, keeping the same token",
  },
};
