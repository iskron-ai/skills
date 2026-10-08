// Words about lead subagents (leads.ts; graph @nks/nks-dev, node #6625); the contract
// and the doors to the OpenCode context are in leaddoors.ts.

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

/** Итог — последний текст ребёнка; длиннее — хвост обрезается. */
const SUMMARY_MAX = 4000;

/** Слово ложится до конца прогона мостом ребёнка: снятие места — в ходу, неудача — unrevokedWord. */
export const endWord = (who: string, why: string, last: string, kept?: string | null): string => {
  const said = last.length > SUMMARY_MAX ? `${last.slice(0, SUMMARY_MAX)}…` : last;
  const done = kept
    ? `${keptLine(who, kept)}; снять его — iskron_channel(action="revoke", standing="${kept}"), только словом человека. `
    : "мост субагента гасится: из дел он выходит, место снимается (не снимется — скажу отдельно). ";
  return (
    `Искрон: субагент ${who} КОНЧЕН — ${why}. Это конец поручения, не ход: ${done}` +
    `Итог — его последнее слово:\n${said || "(текста он не оставил — смотри его дело)"}`
  );
};

/** Поправка к итогу, не второй конец: failed — места, которые мост ребёнка снять не смог; null — исход неизвестен. */
export const unrevokedWord = (who: string, failed: string[] | null): string =>
  failed === null
    ? `Искрон: мост субагента ${who} погашен; снял ли он место — не ответил: осталось на доске — сними iskron_channel(action="revoke").`
    : `Искрон: у субагента ${who} место не снято (сеть): ${failed.join(", ")} — сними iskron_channel(action="revoke", standing="${failed[0]}").`;

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
  `его мост гасится: из дел он выходит, место снимается; его сессия осталась в прежней папке. Последнее его слово:\n${last.slice(0, SUMMARY_MAX) || "(текста он не оставил — смотри его дело)"}`;

export const lostWord = (who: string, why: string): string =>
  `Искрон: субагент ${who} снят — ${why}. Место без моста уйдёт сроком канала, его дела — сроком места; итога нет, его ход — в его сессии.`;

export const tellDone = (sessionID: string): string =>
  `Искрон: слово о субагенте вложено в сессию ${sessionID}`;

export const tellFailed = (sessionID: string, message: string): string =>
  `Искрон: слово о субагенте не вложилось в ${sessionID}: ${message}`;
