// Слова вызова тула самим мостом (граф @nks/nks-dev, узлы #5154, #5838, #6706):
// отказы правила одного места на мост и места рядом, пустой ответ.
import type { Lang } from "../lang.ts";

export interface CallWords {
  /** Приставка совета, когда имя то же, а роль другая. */
  sameNamePrefix: () => string;
  /** Совет, когда просимое место слушает другая сессия (other) или мост этого не знает. */
  heardAdvice: (other: boolean, asked: string, led: string) => string;
  sameKeysAdvice: () => string;
  sameNameAdvice: () => string;
  takeOtherAdvice: () => string;
  /** advice — совет с заглавной буквы. */
  otherPlace: (led: string, asked: string, advice: string) => string;
  besideConnect: (led: string) => string;
  besideStand: (led: string) => string;
  noReply: () => string;
}

export const CALL: Readonly<Record<Lang, CallWords>> = {
  ru: {
    sameNamePrefix: () => "то же имя под другой ролью; ",
    heardAdvice: (other, asked, led) =>
      `${other ? `место ${asked} слушает другая сессия` : `слушает ли место ${asked} другая сессия, мост не знает`} — его не трогай; своё место этого моста — ${led}: оставайся на нём либо назови другое name; встать рядом — iskron_stand без name; отнять место (take=true) — только по слову человека`,
    sameKeysAdvice: () =>
      "ключи совпали — это то же место: повтори iskron_stand с take=true, чтобы переоткрыть его сознательно",
    sameNameAdvice: () =>
      "то же имя под другой ролью (оно вывелось из того же каталога) — передай другое name, либо iskron_stand с take=true, чтобы сменить место этого моста",
    takeOtherAdvice: () =>
      "занять другое место вместо этого — iskron_stand с take=true (прежнее останется на доске без слуха; ненужное сними revoke)",
    otherPlace: (led, asked, advice) =>
      `Отказано (мост): этот мост уже ведёт место ${led} — в графе место одно на мост, и место ${asked} его сняло бы с сокета молча. ` +
      `${advice}; держать оба разом — второй мост, то есть другая сессия харнесса; место в другом графе встаёт рядом само.`,
    besideConnect: (led) =>
      `Отказано (мост): этот мост ведёт место ${led}, а connect в другом графе открыл бы второй канал и снял бы его с сокета. Место в другом графе встаёт рядом на том же канале — iskron_stand(realm=…) или register.`,
    besideStand: (led) =>
      `Отказано (мост): этот мост ведёт место ${led}, но сокета канала у него сейчас нет (ушёл с места или место отняли) — место другого графа встать рядом не может. Сперва верни ${led}: iskron_stand его графа.`,
    noReply: () => "ответа нет",
  },
  en: {
    sameNamePrefix: () => "the same name under another role; ",
    heardAdvice: (other, asked, led) =>
      `${other ? `another session listens on the seat ${asked}` : `the bridge does not know whether another session listens on the seat ${asked}`} — leave it alone; this bridge's own seat is ${led}: stay on it or pass another name; to stand beside — iskron_stand without name; taking the seat (take=true) — only on the human's word`,
    sameKeysAdvice: () =>
      "the keys match — it is the same seat: repeat iskron_stand with take=true to reopen it deliberately",
    sameNameAdvice: () =>
      "the same name under another role (derived from the same directory) — pass another name, or iskron_stand with take=true to change this bridge's seat",
    takeOtherAdvice: () =>
      "to take another seat instead of this one — iskron_stand with take=true (the former stays on the board without hearing; remove what is not needed with revoke)",
    otherPlace: (led, asked, advice) =>
      `Refused (bridge): this bridge already leads the seat ${led} — one seat per bridge in a graph, and the seat ${asked} would silently take it off the socket. ` +
      `${advice}; holding both at once needs a second bridge, that is another harness session; a seat in another graph stands beside by itself.`,
    besideConnect: (led) =>
      `Refused (bridge): this bridge leads the seat ${led}, and a connect in another graph would open a second channel and take it off the socket. A seat in another graph stands beside on the same channel — iskron_stand(realm=…) or register.`,
    besideStand: (led) =>
      `Refused (bridge): this bridge leads the seat ${led}, but has no channel socket now (it left the seat or the seat was taken) — a seat of another graph cannot stand beside. First bring back ${led}: iskron_stand for its graph.`,
    noReply: () => "no reply",
  },
};
