// Слова плагина OpenCode о субагентах (граф @nks/nks-dev, узлы #6625, #6806 п.7):
// ведущий субагент и его конец, возврат ребёнка после перезагрузки, отказы
// кончившемуся ребёнку, ребёнок, которого родитель не слышит.
import type { Lang } from "../lang.ts";

export interface LeadWords {
  cancelled: () => string;
  cancelledRefusal: () => string;
  cascade: (who: string) => string;
  placeEvicted: () => string;
  placeClosed: () => string;
  placeEvictedRefusal: () => string;
  placeClosedRefusal: () => string;
  /** done — endKept либо endPlain; said — итог, пусто — текста нет. */
  end: (who: string, why: string, done: string, said: string) => string;
  endKept: (who: string, kept: string) => string;
  endPlain: () => string;
  keptLine: (who: string, place: string) => string;
  keptSaid: (who: string, place: string) => string;
  unrevokedUnknown: (who: string) => string;
  /** places — места через запятую. */
  unrevoked: (who: string, places: string, first: string) => string;
  turn: (place: string) => string;
  notice: (child: string, place: string) => string;
  release: (who: string) => string;
  released: () => string;
  /** last — последний текст, пусто — текста нет. */
  away: (who: string, last: string) => string;
  lost: (who: string, why: string) => string;
  tellDone: (sessionID: string) => string;
  tellFailed: (sessionID: string, message: string) => string;
  sessionOf: (child: string) => string;
  noParent: (text: string) => string;
  notDown: (who: string, message: string) => string;
  leftSeat: () => string;
  leftCases: () => string;
  leftCase: (room: string) => string;
  releasedByLauncher: () => string;
  deleted: () => string;
  reloadUnreadable: () => string;
  reloadNoKey: () => string;
  reloadNotBack: () => string;
  /** action — пусто, когда действия нет. */
  identity: (name: string, action: string) => string;
  writeUnderParent: (name: string, of: string) => string;
  writeNoParent: () => string;
  finalRefusal: (why: string, name: string) => string;
  releasedChild: () => string;
  endedChild: () => string;
  endedSatellite: () => string;
  launcherSeat: () => string;
  endedRefusal: (why: string, name: string, action: string, of: string) => string;
  /** what — действие с ресурсами. */
  ask: (who: string, what: string) => string;
  more: (n: number) => string;
  action: () => string;
  interrupt: (who: string, reason: string) => string;
}

const act = (action: string): string => (action ? ` (${action})` : "");
const keptRu = (who: string, place: string): string =>
  `ребёнок ${who} стоял не спутником (${place}) — место не снято, мост не погашен`;
const keptEn = (who: string, place: string): string =>
  `child ${who} stood not as a satellite (${place}) — the seat is not revoked, the bridge is not down`;

export const LEAD: Readonly<Record<Lang, LeadWords>> = {
  ru: {
    cancelled: () => "его ход отменён в OpenCode (человеком или запустившим)",
    cancelledRefusal: () => "её ход отменён в OpenCode",
    cascade: (who) =>
      `Искрон: ход субагента ${who} прерван отменой твоего хода — он не кончен: место и дела держит, ждёт кадров своего дела. ` +
      `Продолжить — слово в его дело; отпустить — iskron_channel(action="revoke", standing="${who}").`,
    placeEvicted: () => "его место-спутник вытеснено другим держателем",
    placeClosed: () =>
      "его место-спутник отозвано не через запустившего или закрыто платформой (4001)",
    placeEvictedRefusal: () => "её место-спутник вытеснено другим держателем",
    placeClosedRefusal: () => "её место-спутник отозвано или закрыто платформой (4001)",
    end: (who, why, done, said) =>
      `Искрон: субагент ${who} КОНЧЕН — ${why}. Это конец поручения, не ход: ${done}` +
      `Итог — его последнее слово:\n${said || "(текста он не оставил — смотри его дело)"}`,
    endKept: (who, kept) =>
      `${keptRu(who, kept)}; снять его — iskron_channel(action="revoke", standing="${kept}"), только словом человека. `,
    endPlain: () =>
      "мост субагента гасится: из дел он выходит, место снимается (не снимется — скажу отдельно). ",
    keptLine: keptRu,
    keptSaid: (who, place) => `Искрон: ${keptRu(who, place)}`,
    unrevokedUnknown: (who) =>
      `Искрон: мост субагента ${who} погашен; снял ли он место — не ответил: осталось на доске — сними iskron_channel(action="revoke").`,
    unrevoked: (who, places, first) =>
      `Искрон: у субагента ${who} место не снято (сеть): ${places} — сними iskron_channel(action="revoke", standing="${first}").`,
    turn: (place) =>
      `Искрон: субагент ${place} сдал ход, не поручение — он продолжает и ждёт кадров своего дела; итог ляжет сюда по его концу. ` +
      `Отпустить раньше — iskron_channel(action="revoke", standing="${place}").`,
    notice: (child, place) =>
      `Искрон: уведомление OpenCode <subagent sessionID="${child}" state="completed"> — конец ХОДА субагента ${place}, не поручения: ` +
      `он ведущий, стоит своим местом и ждёт кадров своего дела. Не считай его закончившим — итог ляжет сюда словом «КОНЧЕН» по его концу. ` +
      `Отпустить раньше — iskron_channel(action="revoke", standing="${place}").`,
    release: (who) =>
      `Искрон: субагент ${who} отпущен — его мост погашен: выход из дел и снятие места делает он; итог лёг сюда синтетикой.`,
    released: () =>
      "Искрон: запустивший отпустил тебя — поручение кончено, место снято, из дел ты выведен; встать снова нельзя, в граф и дела больше не пиши.",
    away: (who, last) =>
      `Искрон: субагент ${who} снят переносом родителя в другую папку — поручение здесь кончено не по исходу, итога «КОНЧЕН» не будет: ` +
      `его мост гасится: из дел он выходит, место снимается; его сессия осталась в прежней папке. Последнее его слово:\n${last || "(текста он не оставил — смотри его дело)"}`,
    lost: (who, why) =>
      `Искрон: субагент ${who} снят — ${why}. Место без моста уйдёт сроком канала, его дела — сроком места; итога нет, его ход — в его сессии.`,
    tellDone: (sessionID) => `Искрон: слово о субагенте вложено в сессию ${sessionID}`,
    tellFailed: (sessionID, message) =>
      `Искрон: слово о субагенте не вложилось в ${sessionID}: ${message}`,
    sessionOf: (child) => `сессии ${child}`,
    noParent: (text) => `${text}\n(родителя плагин не знает — итог некому)`,
    notDown: (who, message) => `Искрон: мост субагента ${who} не погашен после итога — ${message}`,
    leftSeat: () => "ушёл с места по исходу",
    leftCases: () => "ушёл из дел по исходу",
    leftCase: (room) => `вышел из дела №${room} по исходу`,
    releasedByLauncher: () => "отпущен словом запустившего",
    deleted: () => "сессия субагента удалена",
    reloadUnreadable: () => "перезагрузка плагина, сессия субагента не читается",
    reloadNoKey: () => "перезагрузка плагина, ключа места нет",
    reloadNotBack: () => "перезагрузка плагина, место-спутник по ключу не вернулось",
    identity: (name, action) =>
      `Отказано (плагин): ${name}${act(action)} — личность человека, а у дочерней сессии нет своего места: ` +
      "мостом корня она её не получает. Граф и дела читать можно; кто ты — спроси запустившего.",
    writeUnderParent: (name, of) =>
      `Отказано (плагин): дочерняя сессия пишет только своим местом-спутником — ${name} ушёл бы местом родителя ${of}. ` +
      `Встань: iskron_stand(realm, karta, satellite_of="${of}"), затем повтори; читать можно и так.`,
    writeNoParent: () =>
      `Отказано (плагин): дочерняя сессия пишет только своим местом-спутником, а место родителя неизвестно — корень места не держит. ` +
      "Своего места ей не завести; читать можно и так, писать — словом запустившему.",
    finalRefusal: (why, name) =>
      `Отказано (плагин): ${why} — поручение кончено, место снято; ` +
      `${name} не пойдёт ни её местом, ни местом запустившего, и встать снова нельзя.`,
    releasedChild: () => "запустивший отпустил эту дочернюю сессию",
    endedChild: () => "эта дочерняя сессия кончена",
    endedSatellite: () => "эта дочерняя сессия кончена, её место-спутник отпущено",
    launcherSeat: () => "<место запустившего>",
    endedRefusal: (why, name, action, of) =>
      `Отказано (плагин): ${why} — ` +
      `${name}${act(action)} пошёл бы мостом и местом запустившего. Встань заново: ` +
      `iskron_stand(realm, karta, satellite_of="${of}"), затем повтори вызов.`,
    ask: (who, what) =>
      `Искрон: субагент ${who} ждёт разрешения: ${what}. Ответить на этот запрос может только человек — в окне сессии субагента ${who}. ` +
      "Ты ответить не можешь, и никакое слово субагенту его не разблокирует. " +
      "Скажи человеку, что и где ждёт: ответить или отменить ход субагента может только он.",
    more: (n) => ` и ещё ${n}`,
    action: () => "действие",
    interrupt: (who, reason) => `Искрон: ход субагента ${who} прерван (${reason}).`,
  },
  en: {
    cancelled: () => "its turn was cancelled in OpenCode (by the human or the launcher)",
    cancelledRefusal: () => "its turn was cancelled in OpenCode",
    cascade: (who) =>
      `Iskron: the turn of subagent ${who} was cut by the cancel of your turn — it has not ended: it holds its seat and cases and waits for frames of its case. ` +
      `To go on — a word into its case; to release it — iskron_channel(action="revoke", standing="${who}").`,
    placeEvicted: () => "its satellite seat was evicted by another holder",
    placeClosed: () =>
      "its satellite seat was revoked not through the launcher or closed by the platform (4001)",
    placeEvictedRefusal: () => "its satellite seat was evicted by another holder",
    placeClosedRefusal: () => "its satellite seat was revoked or closed by the platform (4001)",
    end: (who, why, done, said) =>
      `Iskron: subagent ${who} ENDED — ${why}. This is the end of the errand, not a turn: ${done}` +
      `The outcome is its last word:\n${said || "(it left no text — see its case)"}`,
    endKept: (who, kept) =>
      `${keptEn(who, kept)}; to revoke it — iskron_channel(action="revoke", standing="${kept}"), only on the human's word. `,
    endPlain: () =>
      "the subagent's bridge goes down: it leaves its cases, its seat is revoked (if it is not, I will say so separately). ",
    keptLine: keptEn,
    keptSaid: (who, place) => `Iskron: ${keptEn(who, place)}`,
    unrevokedUnknown: (who) =>
      `Iskron: the bridge of subagent ${who} is down; whether it revoked its seat it did not answer: if it is left on the board — revoke it with iskron_channel(action="revoke").`,
    unrevoked: (who, places, first) =>
      `Iskron: subagent ${who}'s seat was not revoked (network): ${places} — revoke it with iskron_channel(action="revoke", standing="${first}").`,
    turn: (place) =>
      `Iskron: subagent ${place} handed over a turn, not the errand — it goes on and waits for frames of its case; the outcome lands here at its end. ` +
      `To release it earlier — iskron_channel(action="revoke", standing="${place}").`,
    notice: (child, place) =>
      `Iskron: the OpenCode notice <subagent sessionID="${child}" state="completed"> is the end of a TURN of subagent ${place}, not of the errand: ` +
      `it is a lead, stands on its own seat and waits for frames of its case. Do not count it finished — the outcome lands here with the word «ENDED» at its end. ` +
      `To release it earlier — iskron_channel(action="revoke", standing="${place}").`,
    release: (who) =>
      `Iskron: subagent ${who} is released — its bridge is down: it leaves its cases and revokes its seat itself; the outcome landed here as a synthetic message.`,
    released: () =>
      "Iskron: the launcher released you — the errand is over, the seat is revoked, you are taken out of the cases; standing again is not possible, write nothing more into the graph or cases.",
    away: (who, last) =>
      `Iskron: subagent ${who} was taken down by the parent's move to another folder — the errand here ended not by its outcome, there will be no «ENDED»: ` +
      `its bridge goes down: it leaves its cases, its seat is revoked; its session stayed in the previous folder. Its last word:\n${last || "(it left no text — see its case)"}`,
    lost: (who, why) =>
      `Iskron: subagent ${who} is taken down — ${why}. The seat without a bridge goes with the channel's term, its cases with the seat's term; there is no outcome, its turn is in its session.`,
    tellDone: (sessionID) =>
      `Iskron: the word about the subagent was delivered into session ${sessionID}`,
    tellFailed: (sessionID, message) =>
      `Iskron: the word about the subagent was not delivered into ${sessionID}: ${message}`,
    sessionOf: (child) => `of session ${child}`,
    noParent: (text) =>
      `${text}\n(the plugin does not know the parent — nobody to give the outcome to)`,
    notDown: (who, message) =>
      `Iskron: the bridge of subagent ${who} was not put down after the outcome — ${message}`,
    leftSeat: () => "left its seat by the outcome",
    leftCases: () => "left its cases by the outcome",
    leftCase: (room) => `left case №${room} by the outcome`,
    releasedByLauncher: () => "released on the launcher's word",
    deleted: () => "the subagent's session was deleted",
    reloadUnreadable: () => "plugin reload, the subagent's session is unreadable",
    reloadNoKey: () => "plugin reload, no seat key",
    reloadNotBack: () => "plugin reload, the satellite seat did not return by its key",
    identity: (name, action) =>
      `Refused (plugin): ${name}${act(action)} is the human's identity, and the child session has no seat of its own: ` +
      "it does not get it through the root's bridge. The graph and cases can be read; who you are — ask the launcher.",
    writeUnderParent: (name, of) =>
      `Refused (plugin): a child session writes only with its own satellite seat — ${name} would go under the parent's seat ${of}. ` +
      `Stand: iskron_stand(realm, karta, satellite_of="${of}"), then repeat; reading works as is.`,
    writeNoParent: () =>
      "Refused (plugin): a child session writes only with its own satellite seat, and the parent's seat is unknown — the root holds no seat. " +
      "It cannot have a seat of its own; reading works as is, writing — by a word to the launcher.",
    finalRefusal: (why, name) =>
      `Refused (plugin): ${why} — the errand is over, the seat is revoked; ` +
      `${name} goes neither with its seat nor with the launcher's, and standing again is not possible.`,
    releasedChild: () => "the launcher released this child session",
    endedChild: () => "this child session has ended",
    endedSatellite: () => "this child session has ended, its satellite seat is released",
    launcherSeat: () => "<the launcher's seat>",
    endedRefusal: (why, name, action, of) =>
      `Refused (plugin): ${why} — ` +
      `${name}${act(action)} would go with the launcher's bridge and seat. Stand again: ` +
      `iskron_stand(realm, karta, satellite_of="${of}"), then repeat the call.`,
    ask: (who, what) =>
      `Iskron: subagent ${who} is waiting for a permission: ${what}. Only the human can answer this request — in the window of the subagent's session ${who}. ` +
      "You cannot answer it, and no message to the subagent unblocks it. " +
      "Tell the human what is waiting and where: only they can answer or cancel the subagent's turn.",
    more: (n) => ` and ${n} more`,
    action: () => "action",
    interrupt: (who, reason) => `Iskron: the turn of subagent ${who} was interrupted (${reason}).`,
  },
};
