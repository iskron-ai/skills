// Слова входа в дело по строке запуска (ядро shared/launch.ts, граф @nks/nks-dev, узлы
// #6078, #6550).
import type { Lang } from "../lang.ts";

export interface LaunchWords {
  /** Встать не удалось; join — готовый вызов входа в дело. */
  notSeated: (why: string, no: string, join: string) => string;
  /** Имя места, когда мост его не назвал. */
  ownSeat: () => string;
  notEntered: (place: string, no: string, why: string) => string;
  entered: (place: string, no: string) => string;
}

export const LAUNCH: Readonly<Record<Lang, LaunchWords>> = {
  ru: {
    notSeated: (why, no, join) =>
      `Искрон: строка запуска — не встал: ${why}. Субагент встаёт только спутником места запустившего: держит он место — повтори iskron_stand и войди в дело №${no}: ${join}; ` +
      "не держит — запустивший занимает место и запускает тебя заново, а до того работа идёт без графа, итог — словом запустившему.",
    ownSeat: () => "своим местом",
    notEntered: (place, no, why) =>
      `Искрон: встал ${place}; в дело №${no} не вошёл — ${why}. Место остаётся.`,
    entered: (place, no) =>
      `Искрон: встал ${place}, вошёл в дело №${no} — первым словом перескажи бриф в деле.`,
  },
  en: {
    notSeated: (why, no, join) =>
      `Iskron: launch line — not seated: ${why}. A subagent takes only a satellite of its launcher's seat: if the launcher holds one, repeat iskron_stand and enter case №${no}: ${join}; ` +
      "if not, the launcher takes a seat and launches you again; until then the work goes without the graph, the result as a word to the launcher.",
    ownSeat: () => "in a seat of its own",
    notEntered: (place, no, why) =>
      `Iskron: seated ${place}; did not enter case №${no} — ${why}. The seat stays.`,
    entered: (place, no) =>
      `Iskron: seated ${place}, entered case №${no} — retell the brief as your first message in the case.`,
  },
};
