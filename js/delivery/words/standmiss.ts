// Почему вызов iskron_stand со status без karta не стал одной занятостью —
// настоящая причина, одна (граф @nks/nks-dev, узел #6509). args — список
// аргументов занятия, уже сведённый ядром в строку.
import type { Lang } from "../lang.ts";

export interface StandMissWords {
  none: () => string;
  args: (args: string) => string;
  name: (asked: string, held: string) => string;
  satellite: (of: string) => string;
  cwd: (cwd: string) => string;
  parked: () => string;
  elsewhere: () => string;
}

const ONLY_RU = "Без karta вызов только ставит занятость места, которое ведёт этот мост";
const ONLY_EN = "Without karta the call only sets the busy line of the seat this bridge leads";

export const STAND_MISS: Readonly<Record<Lang, StandMissWords>> = {
  ru: {
    none: () => `${ONLY_RU} в этом графе, — такого места нет.`,
    args: (args) =>
      `${ONLY_RU}, а вызов несёт ${args} — это занятие места; для одной занятости — только realm и status.`,
    name: (asked, held) =>
      `${ONLY_RU}: вызов называет имя ${asked}, а мост держит здесь ${held} — назови его или опусти name.`,
    satellite: (of) => `${ONLY_RU}: место моста — не спутник места ${of}.`,
    cwd: (cwd) => `${ONLY_RU}: каталог ${cwd} не существует или не абсолютный.`,
    parked: () =>
      `${ONLY_RU}, а с места этот мост ушёл словом (leave): вернись iskron_stand с karta тем же именем.`,
    elsewhere: () =>
      `${ONLY_RU}, а сокета и статусного адреса этого места у моста нет — сокет места не у этого моста: место ждёт возврата с диска либо сокет отпущен (мёртвый токен, снятие); займи место iskron_stand с karta.`,
  },
  en: {
    none: () => `${ONLY_EN} in this graph — there is none.`,
    args: (args) =>
      `${ONLY_EN}, and the call carries ${args} — that is taking a seat; for the busy line alone — only realm and status.`,
    name: (asked, held) =>
      `${ONLY_EN}: the call names ${asked}, and the bridge holds ${held} here — name it or leave name out.`,
    satellite: (of) => `${ONLY_EN}: the bridge's seat is not a satellite of ${of}.`,
    cwd: (cwd) => `${ONLY_EN}: the directory ${cwd} does not exist or is not absolute.`,
    parked: () =>
      `${ONLY_EN}, and this bridge left its seat by word (leave): return by iskron_stand with karta under the same name.`,
    elsewhere: () =>
      `${ONLY_EN}, and the bridge has neither the socket nor the status address of this seat — the seat's socket is not with this bridge: the seat waits for its return from disk, or the socket was released (dead token, revoke); take the seat by iskron_stand with karta.`,
  },
};
