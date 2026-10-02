// Договор ведущих субагентов (leads.ts, граф nks-dev: #6625), слова о них родителю
// и двери к контексту OpenCode, которыми они доходят: синтетика в сессию.
/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */
import type { Context } from "./plugin.ts";
import type { Place } from "./satellite.ts";
import type { Say } from "./tools.ts";

export interface Leads {
  /** Успешный вызов ребёнка его мостом: встал — ведущий; первое дело, куда вошёл, — дело поручения; уход по исходу — конец. */
  called(child: string, name: string, args: Record<string, unknown>, place?: Place | null): void;
  /** revoke запустившего, называющий место его ведущего субагента; null — не этот случай. */
  release(caller: string, name: string, args: Record<string, unknown>): Promise<string | null>;
  /** Отпущен запустившим — встать снова ему нельзя. */
  released(child: string): boolean;
  /** Слово моста ребёнка: «held» называет место, кадр — не простой. */
  heard(child: string, kind: unknown, place?: Place | null): void;
  /** Ребёнок прежнего экземпляра плагина возвращается: ведущий с его делом поручения; noted — его ход родителю уже назван. */
  back(child: string, room: string | null | undefined, noted?: boolean): void;
  /** Место вернуть не удалось — мост гасится, родителю слово без пробуждения. */
  fail(child: string, why: string): Promise<void>;
  roomOf(child: string): string | null;
  /** Первый ход ребёнка родителю назван — в маркер потери, чтобы не повторять. */
  noted(child: string): boolean;
  /** Имя места живого ведущего субагента (без места — id сессии); не ведущий — null. */
  nameOf(child: string): string | null;
  onEvent(ev: any): void;
  stop(): void;
}

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

export const noticeWord = (child: string, place: string): string =>
  `Искрон: уведомление OpenCode <subagent sessionID="${child}" state="completed"> — конец ХОДА субагента ${place}, не поручения: ` +
  `он ведущий, стоит своим местом и ждёт кадров своего дела. Не считай его закончившим — итог ляжет сюда словом «КОНЧЕН» по его концу. ` +
  `Отпустить раньше — iskron_channel(action="revoke", standing="${place}").`;

export const releaseWord = (who: string): string =>
  `Искрон: субагент ${who} отпущен — его мост погашен: выход из дел и снятие места делает он; итог лёг сюда синтетикой.`;

export const releasedWord = (): string =>
  "Искрон: запустивший отпустил тебя — поручение кончено, место снято, из дел ты выведен; встать снова нельзя, в граф и дела больше не пиши.";

export const lostWord = (who: string, why: string): string =>
  `Искрон: субагент ${who} снят — ${why}. Место без моста уйдёт сроком канала, его дела — сроком места; итога нет, его ход — в его сессии.`;

/**
 * Двери ведущих к OpenCode: родитель — parentID сессии (Session публичного API; им же
 * связка восстанавливается после перезагрузки), слово — синтетикой (нет её — промптом):
 * resume=false — по описанию API «schedule execution unless resume is false» — ходом не
 * будит, слово ждёт следующего хода; конец — снимок расхода мосту (#6401), затем end.
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
        else await s.prompt({ sessionID, text, delivery: "queue", resume: wake });
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
