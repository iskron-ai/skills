// Слова передачи сокета места преемнику при смене демона (граф @nks/nks-dev, узлы #6586, #6482).
import type { Lang } from "../lang.ts";

export interface HandoffWords {
  /** Кадр из спула адресован месту рядом, которое не вернулось: id — id кадра или «?». */
  strayFrame: (id: string, to: string, key: string, raw: string) => string;
}

export const HANDOFF: Readonly<Record<Lang, HandoffWords>> = {
  ru: {
    strayFrame: (id, to, key, raw) =>
      `ДЕЛАТЕЛЬ: кадр ${id} из спула смены демона адресован месту ${to}, ` +
      `не вернувшемуся, — не кадр места ${key}; вернуть место — iskron_stand в его графе. Кадр: ${raw}`,
  },
  en: {
    strayFrame: (id, to, key, raw) =>
      `DOER: frame ${id} from the daemon-change spool is addressed to the seat ${to}, ` +
      `which has not returned — not a frame of the seat ${key}; to bring the seat back — iskron_stand in its graph. Frame: ${raw}`,
  },
};
