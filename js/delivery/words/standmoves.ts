// Отказы iskron_stand, называющие рабочий ход (граф @nks/nks-dev, узел #5036 п. 8;
// контрпримеры #7552–#7556): правило api — словом поверхности, вызов — целиком.
import type { Lang } from "../lang.ts";

export interface StandMovesWords {
  /**
   * 409 channel_already_stands_in_realm (#7556); call — полный вызов места, уже стоящего в графе, либо пусто;
   * roleOpen — вызов по имени из отказа api, роль места не названа (#5418): её даёт строка на доске.
   */
  standsInRealm: (
    realm: string,
    call: string,
    board: string,
    leave: string,
    roleOpen: boolean,
  ) => string;
  /** Полный вызов занятия места, которое эта сессия держала (#7554). */
  standAgain: (call: string) => string;
  /** take снял прежнее место этой сессии (#7553). */
  priorReleased: (prior: string) => string;
  /** The provisional seat of the root's seating (#777) gave way to the seat the agent named. */
  provisionalReplaced: (prior: string) => string;
  priorKept: (prior: string, text: string, revoke: string) => string;
  /** take на другое основное имя при местах рядом (#6499): отказ до connect; beside — места, revokes — их снятие, keep — прежнее имя. */
  besideHoldsMain: (
    prior: string,
    asked: string,
    beside: string,
    revokes: string,
    keep: string,
  ) => string;
  /** 429 переоткрытия сокета (#7552): вызов дождался исхода; own — сокет переоткрыл сам мост. */
  reissueWaited: (seconds: number, own: boolean) => string;
  /** take не удался после connect (#7553): только что занятое место снято, сессия на прежнем. */
  moveUndone: (asked: string, prior: string) => string;
  /** только что занятое место снять не удалось: text — отказ, revoke — вызов снятия. */
  moveNotUndone: (asked: string, text: string, revoke: string) => string;
}

export const STAND_MOVES: Readonly<Record<Lang, StandMovesWords>> = {
  ru: {
    standsInRealm: (realm, call, board, leave, roleOpen) =>
      `Отказано (409): канал этого моста уже стоит в графе ${realm} другим местом — второго места одного канала в одном графе платформа не держит. ` +
      (call
        ? `Встань им: ${call}${roleOpen ? ` — karta места в его строке на доске ${board}` : ""}. `
        : `Его имя — строка этого канала на доске ${board}; встань им: iskron_stand(realm="${realm}", karta, name=<то имя>). `) +
      `Нужно именно новое имя — сначала отпусти прежнее: ${leave}, затем повтори вызов.`,
    standAgain: (call) =>
      `Место этой сессии мост сейчас не держит — займи его полным вызовом: ${call} (status можно передать в нём же).`,
    priorReleased: (prior) =>
      `прежнее место этой сессии ${prior} снято: take переносит сессию на взятое место, а не прибавляет второе`,
    provisionalReplaced: (prior) =>
      `место автопосадки ${prior} заменено: оно было предварительным — явный вызов встал на названное и снял его`,
    priorKept: (prior, text, revoke) =>
      `прежнее место этой сессии ${prior} не снято (${text}) — пока оно живо, дела будут просить from_standing; сними его: ${revoke}`,
    besideHoldsMain: (prior, asked, beside, revokes, keep) =>
      `Отказано: на основном месте этой сессии ${prior} стоят места рядом в других графах — ${beside}. Переход на ${asked} открыл бы новый канал: места рядом потеряли бы слух, а ${prior} не снялось бы, пока они стоят. Ничего не тронуто. Ход: сначала сними места рядом — ${revokes}, затем повтори вызов; или держи прежнее имя: ${keep}.`,
    reissueWaited: (seconds, own) =>
      own
        ? `твоё — возвращено: сокет этого места в тот же миг переоткрывал сам мост, вызов дождался его исхода (${seconds} с)`
        : `сокет этого места только что переоткрывался — вызов переждал порог платформы (${seconds} с) и занял место`,
    moveUndone: (asked, prior) =>
      `Переход не состоялся: только что занятое место ${asked} снято, сессия осталась на прежнем месте ${prior} — оно у неё единственное.`,
    moveNotUndone: (asked, text, revoke) =>
      `Только что занятое место ${asked} снять не удалось (${text}) — сними его: ${revoke}`,
  },
  en: {
    standsInRealm: (realm, call, board, leave, roleOpen) =>
      `Refused (409): this bridge's channel already stands in the graph ${realm} with another seat — the platform holds no second seat of one channel in one graph. ` +
      (call
        ? `Stand as it: ${call}${roleOpen ? ` — the seat's karta is in its line on the board ${board}` : ""}. `
        : `Its name is this channel's line on the board ${board}; stand as it: iskron_stand(realm="${realm}", karta, name=<that name>). `) +
      `If a new name is what you need, release the former one first: ${leave}, then repeat the call.`,
    standAgain: (call) =>
      `The bridge does not hold this session's seat now — take it with the full call: ${call} (status can go in the same call).`,
    priorReleased: (prior) =>
      `this session's former seat ${prior} is revoked: take moves the session to the taken seat, it does not add a second one`,
    provisionalReplaced: (prior) =>
      `the auto-seating's seat ${prior} is replaced: it was provisional — the explicit call stood on the named one and revoked it`,
    priorKept: (prior, text, revoke) =>
      `this session's former seat ${prior} is not revoked (${text}) — while it lives, cases will ask for from_standing; revoke it: ${revoke}`,
    besideHoldsMain: (prior, asked, beside, revokes, keep) =>
      `Refused: seats beside in other graphs stand on this session's main seat ${prior} — ${beside}. Moving to ${asked} would open a new channel: the seats beside would lose hearing, and ${prior} would not be revoked while they stand. Nothing was touched. Move: revoke the seats beside first — ${revokes}, then repeat the call; or keep the former name: ${keep}.`,
    reissueWaited: (seconds, own) =>
      own
        ? `yours — returned: the bridge itself was reopening this seat's socket at that moment, the call waited for its outcome (${seconds} s)`
        : `this seat's socket was just reopened — the call waited out the platform's threshold (${seconds} s) and took the seat`,
    moveUndone: (asked, prior) =>
      `The move did not happen: the seat ${asked} just taken is revoked, the session stays on its former seat ${prior} — its only one.`,
    moveNotUndone: (asked, text, revoke) =>
      `The seat ${asked} just taken could not be revoked (${text}) — revoke it: ${revoke}`,
  },
};
