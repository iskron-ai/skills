// Осмотр машины (граф @nks/nks-dev, узлы #7494, #7495).
import type { Lang } from "../lang.ts";

export interface MachineStatusWords {
  daemon: () => string;
  absent: () => string;
  unavailable: () => string;
  sessions: () => string;
  fallback: () => string;
  disk: () => string;
  record: () => string;
  attached: () => string;
  detached: () => string;
  primary: () => string;
  beside: () => string;
  satellite: () => string;
  listening: () => string;
  silent: () => string;
  lastWork: () => string;
  unknown: () => string;
}
export const MACHINE_STATUS: Readonly<Record<Lang, MachineStatusWords>> = {
  ru: {
    daemon: () => "демон",
    absent: () => "демон: нет ответа",
    unavailable: () => "снимок сессий недоступен: демон прежней сборки",
    sessions: () => "Сессии",
    fallback: () => "Мосты мимо демона",
    disk: () => "Записи диска без живого держателя",
    record: () => "запись, не живое место",
    attached: () => "прицеплена",
    detached: () => "отцеплена",
    primary: () => "основное",
    beside: () => "рядом",
    satellite: () => "спутник",
    listening: () => "слушает",
    silent: () => "не слушает",
    lastWork: () => "последний вызов графа",
    unknown: () => "не наблюдался",
  },
  en: {
    daemon: () => "daemon",
    absent: () => "daemon: no answer",
    unavailable: () => "session snapshot unavailable: older daemon build",
    sessions: () => "Sessions",
    fallback: () => "Bridges outside the daemon",
    disk: () => "Disk records without a live holder",
    record: () => "record, not a live place",
    attached: () => "attached",
    detached: () => "detached",
    primary: () => "primary",
    beside: () => "beside",
    satellite: () => "satellite",
    listening: () => "listening",
    silent: () => "not listening",
    lastWork: () => "last graph call",
    unknown: () => "not observed",
  },
};
