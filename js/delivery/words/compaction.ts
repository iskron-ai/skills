// Слова возврата роли после сжатия контекста сессии OpenCode (opencode/compaction.ts):
// наказ сводке сжатия и одно слово в system первого запроса после сжатия; то же слово кладёт
// хук SessionStart Claude Code после сжатия (cli/onboard-hook.ts), без места — `bare`.
import type { Lang } from "../lang.ts";

export interface CompactionWords {
  /** В system запроса сжатия: что сводка обязана сохранить. */
  keep: (karta: string, name: string, realm: string) => string;
  /** Одно слово в system первого запроса сессии после сжатия. */
  back: (karta: string, name: string, realm: string) => string;
  /** То же слово, когда место сессии однозначно не установить: без роли и места. */
  bare: () => string;
  /** Хвост `back` в Claude Code: хук сети не трогает — срез правил человека несёт ответ iskron_stand (#9817). */
  restand: (karta: string, name: string, realm: string) => string;
  returned: (sessionID: string) => string;
}

const role = (karta: string, none: string): string => {
  const seq = karta.replace(/^#/, "");
  return seq && seq !== "undefined" ? `#${seq}` : none;
};

export const COMPACTION: Readonly<Record<Lang, CompactionWords>> = {
  ru: {
    keep: (karta, name, realm) =>
      `Искрон: сохрани в сводке роль ${role(karta, "<роль>")}, граф ${realm}, место ${name} (держит мост), номера живых дел, ожидания и наказ на первый ход: загрузить iskron и названные им скиллы роли.`,
    back: (karta, name, realm) =>
      `Искрон: контекст сжат. Роль ${role(karta, "<роль>")}, граф ${realm}, место ${name} держит мост — заново не занимай. До работы загрузи iskron и названные им скиллы роли; факты-основания сводки перечитай в графе через recall.`,
    bare: () =>
      "Искрон: контекст сжат. До работы загрузи iskron и названные им скиллы роли; факты-основания сводки перечитай в графе через recall.",
    restand: (karta, name, realm) =>
      ` Первым ходом вызови iskron_stand(realm="${realm}", karta="${role(karta, "<роль>")}", name="${name}") без take: место остаётся, ответ несёт правила человека.`,
    returned: (sessionID) =>
      `Искрон: слово о роли после сжатия положено в первый запрос сессии ${sessionID}`,
  },
  en: {
    keep: (karta, name, realm) =>
      `Iskron: the summary of this compaction must keep the agent's role ${role(karta, "<role>")} ` +
      `in graph ${realm}, its seat ${name} (the bridge holds the standing), the live cases — by number ` +
      `and what they wait for — and the instruction to reread the door (the iskron skill) and the role's skills as the first move after the compaction.`,
    back: (karta, name, realm) =>
      `Iskron: the context was compacted. You are role ${role(karta, "<role>")} in graph ${realm}, ` +
      `the bridge holds seat ${name}. Before the first substantive move load the door (the iskron skill) ` +
      `and the role's skills — the door names them; only those, not all the earlier ones. The summary is a ` +
      `pointer, not the record: a decision, ground or fact from it you lean on — read it in the graph again (the recall skill).`,
    bare: () =>
      `Iskron: the context was compacted. Before the first substantive move load the door (the iskron ` +
      `skill) and the role's skills — the door names them; only those, not all the earlier ones. The ` +
      `summary is a pointer, not the record: a decision, ground or fact from it you lean on — read it in the graph again (the recall skill).`,
    restand: (karta, name, realm) =>
      ` As the first move call iskron_stand(realm="${realm}", karta="${role(karta, "<role>")}", name="${name}") without take: the seat stays, and its answer carries the human's rules.`,
    returned: (sessionID) =>
      `Iskron: the role word after the compaction was laid into the first request of session ${sessionID}`,
  },
};
