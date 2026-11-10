// Слово конца хода (граф @nks/nks-dev, узел #9342): ход начат кадром канала или дела, слова
// человека в нём не было, а кончился он текстом в консоль без ответа в деле — поставка будит
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
      `${FRAME_MARK} человека в консоли нет: ход и исход — ${tool("case")} line по ключу; say с to — за ответом или действием; человеку ask или ответ на его вопрос. Нечего передать — ход кончен, без текста.`,
    notLaid: (session, why) => `слово конца хода в сессию ${session} не легло: ${why}`,
  },
  en: {
    wake: () =>
      `${FRAME_MARK} no human at the console: progress and outcome — ${tool("case")} line by key; say with to for a reply or action; to the human — ask or answer their question. Nothing to pass on — the turn is over, no text needed.`,
    notLaid: (session, why) => `the turn's end word did not enter session ${session}: ${why}`,
  },
};
