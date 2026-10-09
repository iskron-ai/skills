// Правило take=true для занятого места (граф @nks/nks-dev, узлы #6976, #7194): своё имя
// агент забирает сам по молчанию пробы, чужое — только словом человека. Одно на все слова.
import type { Lang } from "../lang.ts";

export interface TakeWords {
  rule: () => string;
}

export const TAKE: Readonly<Record<Lang, TakeWords>> = {
  ru: {
    rule: () =>
      "своё имя (та же роль, та же учётка) — сам, когда держатель молчит 5 минут на пробу словом (iskron_channel send); чужое (другая роль или учётка) — только словом человека",
  },
  en: {
    rule: () =>
      "your own name (the same role, the same account) — by yourself when the holder stays silent 5 minutes to a probe by word (iskron_channel send); another's (another role or account) — only on the human's word",
  },
};
