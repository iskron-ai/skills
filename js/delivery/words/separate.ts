// Слова выбора места (граф @nks/nks-dev, узел #6706): своё место прежнего моста
// сессии, место рядом и отказы, когда встать некуда или доска не прочлась.
import type { Lang } from "../lang.ts";
import { TAKE } from "./take.ts";

/**
 * Кто держит base, когда мост встал рядом (#6976): live — живой мост другой сессии этого
 * дома гранта (та же роль, та же учётка); record — запись другой сессии этого дома, её мост
 * здесь не отвечает; board — только доска: роль та же, учётку сверяет делатель; null — неизвестно.
 */
export type Kin = "live" | "record" | "board" | null;

export interface SeparateWords {
  ownSession: (base: string) => string;
  /** own — место рядом держал прежний мост этой же сессии. */
  beside: (base: string, name: string, own: boolean, kin: Kin) => string;
  unknown: (name: string) => string;
  noFree: (base: string) => string;
}

// Пробы «жив?» и подхвата по её молчанию нет (#7493) — работа идёт на месте рядом; место
// умершего закрывает мост машины с демоном, иначе срок платформы (take.ts).
const besideRu = (): string =>
  `работай здесь, её дела не бери и её не жди; вытеснить ту сессию (take=true): ${TAKE.ru.rule()}`;

const besideEn = (): string =>
  `work here, do not take its cases and do not wait for it; evicting that session (take=true): ${TAKE.en.rule()}`;

const HOLDER_RU: Record<NonNullable<Kin>, string> = {
  live: "другая живая сессия твоего имени (та же роль, та же учётка)",
  record:
    "другая сессия твоего имени (та же роль, та же учётка; её мост здесь не отвечает — жива ли, доска не скажет; место умершего закроет мост машины с демоном, иначе срок платформы)",
  board: "другая сессия той же роли",
};

const HOLDER_EN: Record<NonNullable<Kin>, string> = {
  live: "another live session of your own name (the same role, the same account)",
  record:
    "another session of your own name (the same role, the same account; its bridge does not answer here — the board does not tell whether it is alive; a dead agent's seat is closed by a machine bridge with a daemon, otherwise by the platform's term)",
  board: "another session of the same role",
};

export const SEPARATE: Readonly<Record<Lang, SeparateWords>> = {
  ru: {
    ownSession: (base) =>
      `место ${base} держал прежний мост этой же сессии харнесса (перезапуск или компакшн) — своё место этой сессии, мост вернул его сам`,
    beside: (base, name, own, kin) =>
      `место ${base} держит ${kin ? HOLDER_RU[kin] : "другая сессия"} — её место не трогаю и им не подписываюсь; встаю рядом на ${name} со слухом${own ? " (его держал прежний мост этой же сессии — вернул сам)" : ""}: это своё место, кадры по нему идут сюда; ` +
      besideRu(),
    unknown: (name) =>
      `Отказано (мост): доска разобрана не целиком — слушает ли место ${name} другая сессия, мост не знает; вслепую не встаю и take=true не советую. Повтори, когда доска прочтётся, либо назови другое name.`,
    noFree: (base) =>
      `Отказано (мост): место ${base} держит другая сессия, и все места рядом ${base}.2…99 заняты — подписываться чужим местом без слуха мост не станет; прибери погасшие места либо назови другое name.`,
  },
  en: {
    ownSession: (base) =>
      `the seat ${base} was held by a former bridge of this same harness session (a restart or a compaction) — this session's own seat, the bridge took it back itself`,
    beside: (base, name, own, kin) =>
      `${kin ? HOLDER_EN[kin] : "another session"} holds the seat ${base} — leaving its seat alone and not signing with it; standing beside as ${name} with hearing${own ? " (a former bridge of this same session held it — taken back)" : ""}: it is this session's own seat, its frames come here; ` +
      besideEn(),
    unknown: (name) =>
      `Refused (bridge): the board was not read in full — the bridge does not know whether another session listens on the seat ${name}; not standing blind and not advising take=true. Repeat when the board reads, or pass another name.`,
    noFree: (base) =>
      `Refused (bridge): another session holds the seat ${base}, and every seat beside ${base}.2…99 is taken — the bridge will not sign with another's seat without hearing; clear the dead seats or pass another name.`,
  },
};
