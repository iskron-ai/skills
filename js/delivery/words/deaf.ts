// Слова места без слуха (граф @nks/nks-dev, решение #6706): почему вызов
// не подписывается местом, которое могла взять другая сессия.
import type { Lang } from "../lang.ts";

export interface DeafWords {
  /** Доска читает место слушающим — его могла взять другая сессия. */
  takenByOther: (name: string) => string;
  /** Доска не прочлась — слушает ли место другая сессия, неизвестно. */
  unknownHearing: (name: string) => string;
  /** why — одно из двух слов выше. */
  refusal: (why: string) => string;
}

export const DEAF: Readonly<Record<Lang, DeafWords>> = {
  ru: {
    takenByOther: (name) =>
      `место ${name} без слуха (ушёл с него или токен мёртв), а доска читает его слушающим — его могла взять другая сессия`,
    unknownHearing: (name) =>
      `место ${name} без слуха (ушёл с него или токен мёртв), а слушает ли его другая сессия, мост не знает`,
    refusal: (why) =>
      `Отказано (мост): ${why}; его подписью вызов не уйдёт — не отправлен. Вернись iskron_stand: своё место мост вернёт сам, у чужого встанет рядом на имя.N со слухом.`,
  },
  en: {
    takenByOther: (name) =>
      `the seat ${name} has no hearing (left, or the token died), and the board reads it listening — another session may have taken it`,
    unknownHearing: (name) =>
      `the seat ${name} has no hearing (left, or the token died), and the bridge does not know whether another session listens on it`,
    refusal: (why) =>
      `Refused (bridge): ${why}; the call will not go under its signature — not sent. Stand again with iskron_stand: the bridge takes its own seat back by itself and stands beside another's on name.N with hearing.`,
  },
};
