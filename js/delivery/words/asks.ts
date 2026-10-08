// Слова вопроса в деле — роды ask, answer, ack (граф @nks/nks-dev, узлы #6866,
// #6867, зов роли #6870). Аргументы — готовые строки, как в words/rooms.ts:
// обязательное — значение или «?», необязательное — с разделителем или пустое.
import type { Lang } from "../lang.ts";

export interface AskWords {
  /** toPlace, form, advice — необязательные. */
  ask: (
    author: string,
    to: string,
    toPlace: string,
    key: string,
    done: string,
    form: string,
    advice: string,
  ) => string;
  place: (place: string) => string;
  yesNo: () => string;
  free: () => string;
  choice: (options: string) => string;
  /** why — необязательное. */
  advice: (option: string, why: string) => string;
  answer: (author: string, refersTo: string, reply: string) => string;
  /** reply — необязательное. */
  ack: (refersTo: string, reply: string, author: string) => string;
  /** Снятие — progress роли спросившего на ключе вопроса с fields.withdraws. */
  withdrawn: (
    withdraws: string,
    key: string,
    done: string,
    verdict: string,
    author: string,
  ) => string;
  /** Зов роли платформой по погасшему месту (invite с cause): место погасло, строки ничьи. */
  inviteOwnerless: (who: string, standing: string) => string;
  /** Зов роли: ответ ждёт приёма, спросившее место ушло. */
  inviteAnswerWaiting: (who: string, standing: string) => string;
}

export const ASK: Readonly<Record<Lang, AskWords>> = {
  ru: {
    ask: (author, to, toPlace, key, done, form, advice) =>
      `${author} спрашивает роль ${to}${toPlace} [${key}]: «${done}»${form}${advice}`,
    place: (place) => `(место ${place})`,
    yesNo: () => "ответ: да или нет (yes | no)",
    free: () => "ответ своим текстом",
    choice: (options) => `варианты: ${options}`,
    advice: (option, why) => `рекомендация: ${option}${why}`,
    answer: (author, refersTo, reply) => `${author} отвечает на [${refersTo}]: ${reply}`,
    ack: (refersTo, reply, author) => `ответ [${refersTo}] принят${reply} · ${author}`,
    withdrawn: (withdraws, key, done, verdict, author) =>
      `вопрос [${withdraws}] снят: [${key}] [${done}] = ${verdict} · ${author}`,
    inviteOwnerless: (who, standing) =>
      `платформа зовёт роль ${who} в дело: место ${standing} погасло, его строки ничьи`,
    inviteAnswerWaiting: (who, standing) =>
      `платформа зовёт роль ${who} в дело: ответ ждёт приёма, спросившее место ${standing} ушло`,
  },
  en: {
    ask: (author, to, toPlace, key, done, form, advice) =>
      `${author} asks the role ${to}${toPlace} [${key}]: “${done}”${form}${advice}`,
    place: (place) => `(seat ${place})`,
    yesNo: () => "answer: yes or no (yes | no)",
    free: () => "answer in your own words",
    choice: (options) => `options: ${options}`,
    advice: (option, why) => `recommended: ${option}${why}`,
    answer: (author, refersTo, reply) => `${author} answers [${refersTo}]: ${reply}`,
    ack: (refersTo, reply, author) => `answer [${refersTo}] accepted${reply} · ${author}`,
    withdrawn: (withdraws, key, done, verdict, author) =>
      `question [${withdraws}] withdrawn: [${key}] [${done}] = ${verdict} · ${author}`,
    inviteOwnerless: (who, standing) =>
      `the platform calls the role ${who} to the case: the seat ${standing} is gone, its lines are nobody's`,
    inviteAnswerWaiting: (who, standing) =>
      `the platform calls the role ${who} to the case: an answer awaits acceptance, the asking seat ${standing} has left`,
  },
};
