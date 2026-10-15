// Слова держателя живого канала (ядро shared/channel.ts): совет на мёртвом токене
// (граф @nks/nks-dev, узел #5189), подвисшее соединение (#5397, #5380), раскатка.
import type { Lang } from "../lang.ts";
import { tool } from "../protocol.ts";
import { FRAME_TEXT } from "./frame-text.ts";

export interface ChannelWords {
  deadTokenAdvice: (code: number) => string;
  binaryFrame: () => string;
  /** silent — секунд молчания, ping — интервал пинга в секундах. */
  hung: (silent: number, ping: number) => string;
  rollout: () => string;
}

export const CHANNEL: Readonly<Record<Lang, ChannelWords>> = {
  ru: {
    deadTokenAdvice: (code) =>
      code === 4002
        ? `закрытие 4002 — место погасло по простою; вернуть его — ${tool("stand")} тем же именем`
        : `закрытие ${code} — токен мёртв, зови connect`,
    binaryFrame: () => "[двоичный кадр]",
    hung: (silent, ping) =>
      `соединение молчит ${silent} с при пинге раз в ${ping} с — подвисло без закрытия; переоткрываю тем же адресом. Кадры, пришедшие за время молчания, могли пропасть — сверь дела: ${FRAME_TEXT.ru.myCases()}; прямое слово — попроси переслать`,
    rollout: () => "служба не отвечает — идёт раскатка, держу тот же токен",
  },
  en: {
    deadTokenAdvice: (code) =>
      code === 4002
        ? `close 4002 — the seat went out after idling; to return it — ${tool("stand")} with the same name`
        : `close ${code} — the token is dead, call connect`,
    binaryFrame: () => "[binary frame]",
    hung: (silent, ping) =>
      `the connection has been silent for ${silent} s with a ping every ${ping} s — hung without closing; reopening at the same address. Frames that arrived during the silence may be lost — check the cases: ${FRAME_TEXT.en.myCases()}; a direct word — ask for it again`,
    rollout: () => "the service is not answering — a rollout is under way, keeping the same token",
  },
};
