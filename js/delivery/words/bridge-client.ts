// Слова клиента MCP к дочернему мосту (ядро shared/bridge-client.ts): отказы вызовов и
// пустой ответ тула.
import type { Lang } from "../lang.ts";

export interface BridgeClientWords {
  failedToStart: (message: string) => string;
  /** why — хвост lastFromBridge или пусто. */
  exited: (code: number | null, signal: string | null, why: string) => string;
  lastFromBridge: (lines: string) => string;
  aborted: () => string;
  noAnswer: (method: string, ms: number, why: string) => string;
  noWrites: () => string;
  sessionClosed: () => string;
  emptyAnswer: () => string;
}

export const BRIDGE_CLIENT: Readonly<Record<Lang, BridgeClientWords>> = {
  ru: {
    failedToStart: (message) => `мост не запустился: ${message}`,
    exited: (code, signal, why) => `мост вышел (code=${code}, signal=${signal})${why}`,
    lastFromBridge: (lines) => `; последнее от моста: ${lines}`,
    aborted: () => "вызов отменён",
    noAnswer: (method, ms, why) => `${method}: нет ответа за ${ms} мс${why}`,
    noWrites: () => "мост не принимает запись",
    sessionClosed: () => "сессия закрыта",
    emptyAnswer: () => "(пустой ответ)",
  },
  en: {
    failedToStart: (message) => `the bridge failed to start: ${message}`,
    exited: (code, signal, why) => `the bridge exited (code=${code}, signal=${signal})${why}`,
    lastFromBridge: (lines) => `; last from the bridge: ${lines}`,
    aborted: () => "call aborted",
    noAnswer: (method, ms, why) => `${method}: no answer in ${ms} ms${why}`,
    noWrites: () => "the bridge does not accept writes",
    sessionClosed: () => "session closed",
    emptyAnswer: () => "(empty answer)",
  },
};
