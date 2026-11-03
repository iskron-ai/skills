// Слово конца хода (граф @nks/nks-dev, узел #9342): ход начат кадром канала или дела, слова
// человека в нём не было, а кончился он текстом в консоль без ask, say и send — поставка будит
// сессию одним этим словом (плагин OpenCode на session.idle, Stop-хук плагина Claude Code).
import type { Lang } from "../lang.ts";
import { FRAME_MARK, tool } from "../protocol.ts";

export interface TurnWords {
  /** Будящее слово: текст хода никто не прочтёт — куда класть вопрос и отчёт. */
  wake: () => string;
  /** Плагину в stderr сервиса: слово в сессию не легло. */
  notLaid: (session: string, why: string) => string;
}

export const TURN: Readonly<Record<Lang, TurnWords>> = {
  ru: {
    wake: () =>
      `${FRAME_MARK} человека в консоли нет — вопрос карточкой ask в деле, отчёт — словом в дело или каналом на его место (${tool("case")} ask/say, ${tool("channel")} send). Сказать некому и нечего — ход кончен, текста не нужно.`,
    notLaid: (session, why) => `слово конца хода в сессию ${session} не легло: ${why}`,
  },
  en: {
    wake: () =>
      `${FRAME_MARK} no human at the console — a question as an ask card in the case, a report as a word in the case or by the channel to their seat (${tool("case")} ask/say, ${tool("channel")} send). Nothing to say to anyone — the turn is over, no text needed.`,
    notLaid: (session, why) => `the turn's end word did not enter session ${session}: ${why}`,
  },
};
