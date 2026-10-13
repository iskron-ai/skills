// Осмотр машины (граф @nks/nks-dev, узлы #7494, #7495).
import type { Lang } from "../lang.ts";

export interface MachineStatusWords {
  daemon: () => string;
  absent: () => string;
  unavailable: () => string;
  missing: () => string;
  protocol: () => string;
  refused: () => string;
  snapshotFailed: () => string;
  sessions: () => string;
  fallback: () => string;
  disk: () => string;
  record: () => string;
  left: (left: boolean) => string;
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
    missing: () => "демон: каталога нет",
    protocol: () => "демон: другой протокол",
    refused: () => "демон: отказ",
    snapshotFailed: () => "снимок сессий недоступен: сбой снимка",
    sessions: () => "Сессии",
    fallback: () => "Мосты мимо демона",
    disk: () => "Записи диска вне снимка демона",
    record: () => "запись, живость неизвестна",
    left: (left) => (left ? "ушла" : "не ушла"),
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
    missing: () => "daemon: directory does not exist",
    protocol: () => "daemon: different protocol",
    refused: () => "daemon: refused",
    snapshotFailed: () => "session snapshot unavailable: snapshot failed",
    sessions: () => "Sessions",
    fallback: () => "Bridges outside the daemon",
    disk: () => "Disk records outside the daemon snapshot",
    record: () => "record, liveness unknown",
    left: (left) => (left ? "left" : "not left"),
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
