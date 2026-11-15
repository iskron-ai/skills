// Слова слуха dsh-сессии (dsh/hearing.ts): строки, которыми ухо говорит в консоль dsh —
// сигнал стояния, глухота без места и недоставленное в сессию. Форма сообщения плагина
// и строка возврата роли после сжатия — общие (COMPACTION), не здесь.
import type { Lang } from "../lang.ts";

export interface DshWords {
  /** Ухо встало: слушаю стояние ключом. */
  listening: (key: string) => string;
  /** Мост не держит стояний — сессия глуха. */
  deafNoStanding: () => string;
  /** held — ключи через запятую: мост держит несколько, и ни одно не названо этой сессией. */
  deafSeveral: (held: string) => string;
  /** Мост ушёл или не поднял сокет за окно прицепления. */
  gone: (why: string) => string;
  /** Место снято: токен мёртв, выселено или остановлено владельцем. */
  seatGone: (why: string) => string;
  /** Кадр или слово не дошли до живой сессии. */
  notDelivered: (why: string) => string;
}

export const DSH: Readonly<Record<Lang, DshWords>> = {
  ru: {
    listening: (key) => `слушаю стояние ${key}`,
    deafNoStanding: () =>
      "слуха нет: мост не держит стояний — скажи человеку, место под сессию не встало",
    deafSeveral: (held) =>
      `слуха нет: мост держит несколько стояний (${held}), и ни одно не названо этой сессией — скажи человеку`,
    gone: (why) => `место ушло: ${why}`,
    seatGone: (why) => `место снято: ${why}`,
    notDelivered: (why) => `в сессию не дошло: ${why}`,
  },
  en: {
    listening: (key) => `listening on standing ${key}`,
    deafNoStanding: () =>
      "no hearing: the bridge holds no standing — tell the human, the session's seat never stood",
    deafSeveral: (held) =>
      `no hearing: the bridge holds several standings (${held}) and none is this session's — tell the human`,
    gone: (why) => `the seat is gone: ${why}`,
    seatGone: (why) => `the seat was taken off: ${why}`,
    notDelivered: (why) => `did not reach the session: ${why}`,
  },
};
