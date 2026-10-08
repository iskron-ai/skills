// Слова двери в тред Codex (ядро shared/appserver.ts).
import type { Lang } from "../lang.ts";

export interface AppServerWords {
  socketClosed: () => string;
  doorNotOpened: (status: number | undefined) => string;
}

export const APPSERVER: Readonly<Record<Lang, AppServerWords>> = {
  ru: {
    socketClosed: () => "сокет закрыт",
    doorNotOpened: (status) => `дверь не открылась: HTTP ${status}`,
  },
  en: {
    socketClosed: () => "socket closed",
    doorNotOpened: (status) => `the door did not open: HTTP ${status}`,
  },
};
