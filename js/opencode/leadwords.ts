// Договор ведущих субагентов (leads.ts, граф nks-dev: #6625), слова о них родителю
// и двери к контексту OpenCode, которыми они доходят: синтетика в сессию.
/* eslint-disable @typescript-eslint/no-explicit-any -- ответы SDK без схемы */
import type { Bridge } from "../shared/bridge-client.ts";
import type { Context } from "./plugin.ts";
import { ownPlace, type Place, type SatelliteSlot } from "./satellite.ts";
import type { Say } from "./tools.ts";

export interface Leads {
  /** Успешный вызов ребёнка его мостом: встал — ведущий; первое дело, куда вошёл, — дело поручения; уход по исходу — конец. */
  called(child: string, name: string, args: Record<string, unknown>, place?: Place | null): void;
  /** revoke запустившего, называющий место его ведущего субагента; null — не этот случай. */
  release(caller: string, name: string, args: Record<string, unknown>): Promise<string | null>;
  /** Отпущен запустившим — встать снова ему нельзя. */
  released(child: string): boolean;
  /** Окончательно кончен не запустившим — причина для отказа ребёнку; запустившим или не кончен — undefined. */
  goneWhy(child: string): string | undefined;
  /** Слово моста ребёнка: «held» называет место, кадр — не простой. true — ребёнок кончен, слово ему не вкладывать. */
  heard(child: string, kind: unknown, place?: Place | null): boolean;
  /** Ребёнок прежнего экземпляра плагина возвращается ведущим — с делом поручения, сказанным ходом, последним текстом. */
  back(child: string, was: Partial<Snapshot> & { name?: string; of?: Place | null }): void;
  /** Место вернуть не удалось — мост гасится, родителю слово без пробуждения. */
  fail(child: string, why: string): Promise<void>;
  /** Родителя перенесли в другую папку: ребёнок кончен здесь — мост гасится, родителю «перенесён» без «КОНЧЕН». */
  away(child: string): Promise<void>;
  /** Что ведущего переживает перезагрузку — в маркер потери. */
  snapshot(child: string): Snapshot;
  /** Имя места живого ведущего субагента (без места — id сессии); не ведущий — null. */
  nameOf(child: string): string | null;
  onEvent(ev: any): void;
}

export interface Snapshot {
  room: string | null;
  noted: boolean;
  last?: string;
}

export interface LeadDoors {
  say: Say;
  parentOf(child: string): Promise<string | null>;
  /**
   * Синтетика в сессию — steer: в идущий ход на ближайшей границе шага, не после него
   * (queue в занятую сессию после хода запускал ещё один); wake — будить ли простаивающую.
   */
  tell(session: string, text: string, wake: boolean): Promise<void>;
  /**
   * Мост ребёнка кончает прогон (расход — прежде, затем `iskron/end`: дела, место), но жив.
   * Ответ — места, которые снять не удалось; null — исход неизвестен.
   */
  close(child: string): Promise<string[] | null>;
  /** Мост ребёнка гасится, сессия помечена кончившейся. */
  end(child: string): Promise<void>;
  /** Имя места ребёнка, если это не его спутник (обычное место сессии); спутник или места нет — null. */
  ownPlace(child: string): string | null;
}

/** Конец отменой — окончательный, как revoke запустившего. */
export const CANCELLED = "его ход отменён в OpenCode (человеком или запустившим)";
export const CANCELLED_REFUSAL = "её ход отменён в OpenCode";
/** Каскад: ход ребёнка оборван отменой хода родителя — ребёнок не кончен (cascade.ts). */
export const cascadeWord = (who: string): string =>
  `Искрон: ход субагента ${who} прерван отменой твоего хода — он не кончен: место и дела держит, ждёт кадров своего дела. ` +
  `Продолжить — слово в его дело; отпустить — iskron_channel(action="revoke", standing="${who}").`;
/**
 * Конец потерей места: платформа его вытеснила (4000) или закрыла (4001). Своё close
 * и revoke мост отпускает тихо, revoke запустившего кончает раньше (leads.ts) — 4001,
 * дошедший сюда, это отзыв снаружи либо мёртвый токен, и различить их нечем: без «токен мёртв».
 */
export const placeGone = (kind: string): string =>
  kind === "evicted"
    ? "его место-спутник вытеснено другим держателем"
    : "его место-спутник отозвано не через запустившего или закрыто платформой (4001)";
export const placeGoneRefusal = (kind: string): string =>
  kind === "evicted"
    ? "её место-спутник вытеснено другим держателем"
    : "её место-спутник отозвано или закрыто платформой (4001)";

/** Конец прогона мостом ребёнка (выход из дел и revoke под своими потолками) — не дольше. */
const END_MS = 5_000;

/** Итог — последний текст ребёнка; длиннее — хвост обрезается. */
const SUMMARY_MAX = 4000;

/** failed — места, которые мост ребёнка снять не смог; null — исход его конца неизвестен. */
export const endWord = (
  who: string,
  why: string,
  last: string,
  kept?: string | null,
  failed: string[] | null = [],
): string => {
  const said = last.length > SUMMARY_MAX ? `${last.slice(0, SUMMARY_MAX)}…` : last;
  const done = kept
    ? `${keptLine(who, kept)}; снять его — iskron_channel(action="revoke", standing="${kept}"), только словом человека. `
    : failed === null
      ? 'мост субагента погашен; снял ли он место — не ответил: осталось на доске — сними iskron_channel(action="revoke"). '
      : failed.length
        ? `мост субагента погашен, но место не снято (сеть): ${failed.join(", ")} — сними iskron_channel(action="revoke", standing="${failed[0]}"). `
        : "мост субагента погашен, из дел он вышел, место снято. ";
  return (
    `Искрон: субагент ${who} КОНЧЕН — ${why}. Это конец поручения, не ход: ${done}` +
    `Итог — его последнее слово:\n${said || "(текста он не оставил — смотри его дело)"}`
  );
};

/** Ребёнок занял обычное место вместо спутника: конец поручения его место не снимает. */
export const keptLine = (who: string, place: string): string =>
  `ребёнок ${who} стоял не спутником (${place}) — место не снято, мост не погашен`;

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

export const awayWord = (who: string, last: string): string =>
  `Искрон: субагент ${who} снят переносом родителя в другую папку — поручение здесь кончено не по исходу, итога «КОНЧЕН» не будет: ` +
  `его мост погашен, из дел он вышел, место снято; его сессия осталась в прежней папке. Последнее его слово:\n${last.slice(0, SUMMARY_MAX) || "(текста он не оставил — смотри его дело)"}`;

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
  slots: Map<string, SatelliteSlot & { child?: boolean; bridge: Pick<Bridge, "request"> }>,
): LeadDoors {
  return {
    say,
    ownPlace: (child) => ownPlace(slots.get(child)),
    async close(child) {
      await flush(child).catch(() => {});
      // Конец прогона — до слова: исход снятия места идёт в слово родителю (№147, e2e12).
      const got: any = await slots
        .get(child)
        ?.bridge.request("iskron/end", {}, { timeoutMs: END_MS, service: true })
        .catch(() => null);
      return got?.ended ? (got.failed ?? []) : null;
    },
    async end(child) {
      end(child);
    },
    async parentOf(child) {
      const s: any = await ctx.session.get({ sessionID: child } as any);
      return s?.parentID ?? s?.data?.parentID ?? null;
    },
    async tell(sessionID, text, wake) {
      const s: any = ctx.session;
      const delivery = "steer";
      try {
        if (typeof s.synthetic === "function")
          await s.synthetic({ sessionID, text, delivery, resume: wake });
        else await s.prompt({ sessionID, text, delivery, resume: wake });
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
