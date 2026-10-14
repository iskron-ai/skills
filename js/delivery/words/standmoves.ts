// Отказы iskron_stand, называющие рабочий ход (граф @nks/nks-dev, узел #5036 п. 8;
// контрпримеры #7552–#7556): правило api — словом поверхности, вызов — целиком.
import type { Lang } from "../lang.ts";

export interface StandMovesWords {
  /** 409 channel_already_stands_in_realm (#7556); call — полный вызов места, уже стоящего в графе, либо пусто. */
  standsInRealm: (realm: string, call: string, board: string, leave: string) => string;
  /** Полный вызов занятия места, которое эта сессия держала (#7554). */
  standAgain: (call: string) => string;
}

export const STAND_MOVES: Readonly<Record<Lang, StandMovesWords>> = {
  ru: {
    standsInRealm: (realm, call, board, leave) =>
      `Отказано (409): канал этого моста уже стоит в графе ${realm} другим местом — второго места одного канала в одном графе платформа не держит. ` +
      (call
        ? `Встань им: ${call}. `
        : `Его имя — строка этого канала на доске ${board}; встань им: iskron_stand(realm="${realm}", karta, name=<то имя>). `) +
      `Нужно именно новое имя — сначала отпусти прежнее: ${leave}, затем повтори вызов.`,
    standAgain: (call) =>
      `Место этой сессии мост сейчас не держит — займи его полным вызовом: ${call} (status можно передать в нём же).`,
  },
  en: {
    standsInRealm: (realm, call, board, leave) =>
      `Refused (409): this bridge's channel already stands in the graph ${realm} with another seat — the platform holds no second seat of one channel in one graph. ` +
      (call
        ? `Stand as it: ${call}. `
        : `Its name is this channel's line on the board ${board}; stand as it: iskron_stand(realm="${realm}", karta, name=<that name>). `) +
      `If a new name is what you need, release the former one first: ${leave}, then repeat the call.`,
    standAgain: (call) =>
      `The bridge does not hold this session's seat now — take it with the full call: ${call} (status can go in the same call).`,
  },
};
