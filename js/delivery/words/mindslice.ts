// Слова подачи правил человека из mind в ход (ядро shared/mindslice.ts, граф @nks/nks-dev, узлы
// #9817, #9816; риски #9818 — утечка, #9819 — объём). Каждое слово начинается меткой `mark`:
// по ней блок находят в ответе iskron_stand.
import type { Lang } from "../lang.ts";

export interface MindSliceWords {
  /** Начало каждого слова подачи. */
  mark: () => string;
  /** Шапка блока строк: сколько правил подано. */
  head: (n: number) => string;
  /** Хвост блока: где тело; cut — выдача упёрлась в limit, offset — следующая страница. */
  foot: (cut: boolean, offset: number) => string;
  empty: () => string;
  /** Своего графа mind у учётки нет. */
  absent: () => string;
  /** Readiness не назвал признака своего графа: mind не читается. */
  unknown: () => string;
  /** Отказ readiness или поиска; why — его проза. */
  unread: (why: string) => string;
}

const RU_MARK = "Искрон · личное человека:";
const EN_MARK = "Iskron · the human's own:";
const LOOK = 'iskron_look(realm="mind", node_id="#N")';
const NEXT = (offset: number) =>
  `iskron_search(realm="mind", q="", attrs_filter="slice:agents,ways", offset=${offset})`;

export const MIND_SLICE: Readonly<Record<Lang, MindSliceWords>> = {
  ru: {
    mark: () => RU_MARK,
    head: (n) =>
      `${RU_MARK} его правила работы с агентами (mind, срез agents,ways; ${n}). Держи их ниже правил проекта. Личное: в дело правило приводи, только когда оно описывает это дело; в брифы, граф проекта и коммиты не переносится.`,
    foot: (cut, offset) =>
      `Тело правила — ${LOOK}.` + (cut ? ` Подана первая страница; дальше — ${NEXT(offset)}.` : ""),
    empty: () => `${RU_MARK} в mind нет правил среза agents,ways.`,
    absent: () =>
      `${RU_MARK} личная память не готова (нет своего графа mind или карты человека) — правила не поданы.`,
    unknown: () =>
      `${RU_MARK} свой граф mind не подтверждён (iskron_me readiness) — срез правил не прочитан, работа идёт без него.`,
    unread: (why) => `${RU_MARK} срез правил из mind не прочитан (${why}) — работа идёт без него.`,
  },
  en: {
    mark: () => EN_MARK,
    head: (n) =>
      `${EN_MARK} their rules for working with agents (mind, slice agents,ways; ${n}). Keep them below the project's rules. Personal: cite a rule in a case only when it describes that case; it never goes into briefs, the project's graph or commits.`,
    foot: (cut, offset) =>
      `A rule's body — ${LOOK}.` +
      (cut ? ` This is the first page; the rest — ${NEXT(offset)}.` : ""),
    empty: () => `${EN_MARK} mind holds no rules of the slice agents,ways.`,
    absent: () =>
      `${EN_MARK} personal memory is not ready (no own mind graph or no card of the human) — no rules given.`,
    unknown: () =>
      `${EN_MARK} no own mind graph confirmed (iskron_me readiness) — the rules slice was not read; the work goes on without it.`,
    unread: (why) =>
      `${EN_MARK} the rules slice of mind was not read (${why}) — the work goes on without it.`,
  },
};
