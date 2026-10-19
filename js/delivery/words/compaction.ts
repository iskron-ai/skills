// Слова возврата роли после сжатия контекста сессии OpenCode (opencode/compaction.ts):
// наказ сводке сжатия и одно слово в system первого запроса после сжатия.
import type { Lang } from "../lang.ts";

export interface CompactionWords {
  /** В system запроса сжатия: что сводка обязана сохранить. */
  keep: (karta: string, name: string, realm: string) => string;
  /** Одно слово в system первого запроса сессии после сжатия. */
  back: (karta: string, name: string, realm: string) => string;
  returned: (sessionID: string) => string;
}

const role = (karta: string, none: string): string => {
  const seq = karta.replace(/^#/, "");
  return seq && seq !== "undefined" ? `#${seq}` : none;
};

export const COMPACTION: Readonly<Record<Lang, CompactionWords>> = {
  ru: {
    keep: (karta, name, realm) =>
      `Искрон: сводка этого сжатия обязана сохранить роль агента ${role(karta, "<роль>")} ` +
      `в графе ${realm}, его место ${name} (стояние держит мост), живые дела — номером и тем, ` +
      `чего в них ждут, — и указание первым ходом после сжатия перечитать дверь (скилл iskron) и скилы роли.`,
    back: (karta, name, realm) =>
      `Искрон: контекст сжат. Ты — роль ${role(karta, "<роль>")} в графе ${realm}, место ${name} ` +
      `держит мост. До первого содержательного хода загрузи дверь (скилл iskron) и скилы роли — ` +
      `их называет дверь; только их, не все прежние.`,
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
      `and the role's skills — the door names them; only those, not all the earlier ones.`,
    returned: (sessionID) =>
      `Iskron: the role word after the compaction was laid into the first request of session ${sessionID}`,
  },
};
