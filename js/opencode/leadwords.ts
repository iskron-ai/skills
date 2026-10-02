// Слова о ведущем субагенте его родителю (leads.ts, граф nks-dev: #6625) и двери
// к контексту OpenCode, которыми они доходят: синтетика в сессию родителя.
/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */
import type { Context } from "./plugin.ts";
import type { Say } from "./tools.ts";

export interface LeadDoors {
  say: Say;
  parentOf(child: string): Promise<string | null>;
  /** Синтетика в сессию; wake — будить ли её ходом. */
  tell(session: string, text: string, wake: boolean): Promise<void>;
  /** Мост ребёнка гасится (расход — прежде), сессия помечена кончившейся. */
  end(child: string): Promise<void>;
}

/** Итог — последний текст ребёнка; длиннее — хвост обрезается. */
const SUMMARY_MAX = 4000;

export const endWord = (who: string, why: string, last: string): string => {
  const said = last.length > SUMMARY_MAX ? `${last.slice(0, SUMMARY_MAX)}…` : last;
  return (
    `Искрон: субагент ${who} КОНЧЕН — ${why}. Это конец поручения, не ход: мост субагента погашен, из дел он вышел, место снято. ` +
    `Итог — его последнее слово:\n${said || "(текста он не оставил — смотри его дело)"}`
  );
};

export const turnWord = (place: string): string =>
  `Искрон: субагент ${place} сдал ход, не поручение — он продолжает и ждёт кадров своего дела; итог ляжет сюда по его концу. ` +
  `Отпустить раньше — iskron_channel(action="revoke", standing="${place}").`;

export const releaseWord = (who: string): string =>
  `Искрон: субагент ${who} отпущен — его мост погашен: выход из дел и снятие места делает он; итог лёг сюда синтетикой.`;

export const lostWord = (who: string): string =>
  `Искрон: субагент ${who} снят перезагрузкой плагина — его мост ушёл с местом при остановке; итога нет, его ход — в его сессии. ` +
  "Встанет заново (iskron_stand) — продолжит.";

/**
 * Двери ведущих к OpenCode: родитель — parentID сессии, слово — синтетикой (нет её —
 * промптом); конец — снимок расхода мосту (#6401), затем end гасит мост и метит сессию.
 */
export function leadDoors(
  ctx: Context,
  say: Say,
  flush: (session: string) => Promise<void>,
  end: (child: string) => void,
): LeadDoors {
  return {
    say,
    async end(child) {
      await flush(child).catch(() => {});
      end(child);
    },
    async parentOf(child) {
      const s: any = await ctx.session.get({ sessionID: child } as any);
      return s?.parentID ?? s?.data?.parentID ?? null;
    },
    async tell(sessionID, text, wake) {
      const s: any = ctx.session;
      try {
        if (typeof s.synthetic === "function")
          await s.synthetic({ sessionID, text, delivery: "queue", resume: wake });
        else await s.prompt({ sessionID, text, delivery: "queue" });
        say(`Искрон: слово о субагенте вложено в сессию ${sessionID}`, "info");
      } catch (e) {
        say(
          `Искрон: слово о субагенте не вложилось в ${sessionID}: ${(e as Error).message}`,
          "error",
        );
      }
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
