// Слова локальной двери места (граф @nks/nks-dev, узел #6080): что дверь говорит
// делателю, когда локальный сокет стояния не поднялся.
import type { Lang } from "../lang.ts";

export interface DoorWords {
  /** Каталог сокетов не личный — сокет и не поднимался; bad — что с каталогом. */
  privateDir: (bad: string) => string;
  /** Сервер сокета упал на подъёме; message — ошибка Node. */
  listenFailed: (message: string) => string;
}

export const DOOR: Readonly<Record<Lang, DoorWords>> = {
  ru: {
    privateDir: (bad) => `ДЕЛАТЕЛЬ: локальный сокет стояния не поднят — ${bad}`,
    listenFailed: (message) =>
      `ДЕЛАТЕЛЬ: локальный сокет стояния не поднялся (${message}) — сторожу не к чему цепляться`,
  },
  en: {
    privateDir: (bad) => `DOER: the local standing socket is not up — ${bad}`,
    listenFailed: (message) =>
      `DOER: the local standing socket did not come up (${message}) — the watchdog has nothing to attach to`,
  },
};
