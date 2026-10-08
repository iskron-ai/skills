// Отказ занять место роли без имени (граф @nks/nks-dev, узел #6748).
import type { Lang } from "../lang.ts";

export interface UnnamedWords {
  /** action — connect, mint или register. */
  refused: (action: string) => string;
}

export const UNNAMED: Readonly<Record<Lang, UnnamedWords>> = {
  ru: {
    refused: (action) =>
      `Отказано (мост): ${action} без имени места — место роли с пустым именем мост не занимает (его адрес совпал бы с местом человека, а снять его нечем); вызов не отправлен. Назови место явно: name (строчные латинские буквы, цифры, «.», «_», «-»). Безымянное место самого человека — karta="me" при ISKRON_BRIDGE_OWNER_ROLE=1 в окружении моста, которую ставит он сам.`,
  },
  en: {
    refused: (action) =>
      `Refused (bridge): ${action} without a seat name — the bridge does not take a role seat with an empty name (its address would coincide with the human's seat, and nothing could take it off); the call was not sent. Name the seat explicitly: name (lower-case Latin letters, digits, «.», «_», «-»). The human's own unnamed seat is karta="me" with ISKRON_BRIDGE_OWNER_ROLE=1 in the bridge's environment, set by the human.`,
  },
};
