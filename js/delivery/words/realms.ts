// Отказ по неразрешённому имени графа (граф @nks/nks-dev, узел #5838).
import type { Lang } from "../lang.ts";

export interface RealmsWords {
  /** held — места моста в канонической форме, уже через ", ". */
  unresolved: (realm: string, held: string) => string;
}

export const REALMS: Readonly<Record<Lang, RealmsWords>> = {
  ru: {
    unresolved: (realm, held) =>
      `Отказано (мост): граф «${realm}» мост не разрешил в @owner/slug (списка графов нет или имени в нём нет) — тот ли это граф, что у мест моста (${held}), не известно, и гадать нельзя. Повтори вызов с полным адресом графа @owner/slug.`,
  },
  en: {
    unresolved: (realm, held) =>
      `Refused (bridge): the bridge did not resolve the graph "${realm}" to @owner/slug (there is no list of graphs or the name is not in it) — whether it is the graph of the bridge's seats (${held}) is unknown, and guessing is not allowed. Repeat the call with the full graph address @owner/slug.`,
  },
};
