// Слова слуха dsh-сессии (dsh/hearing.ts): строки, которыми ухо говорит в консоль dsh —
// сигнал стояния, глухота без места и недоставленное в сессию. Форма сообщения плагина
// и строка возврата роли после сжатия — общие (COMPACTION), не здесь.
import type { Lang } from "../lang.ts";

export interface DshWords {
  /** Ухо встало: слушаю стояние ключом. */
  listening: (key: string) => string;
  /** Окно прицепления (с) прошло, а место этой сессии так и не встало. */
  deafNoStanding: (seconds: number) => string;
  /** keys — ключи через запятую: несколько мест названы этой сессией, ухо не угадывает. */
  deafSeveral: (keys: string) => string;
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
    deafNoStanding: (seconds) =>
      `слуха пока нет: за ${seconds} с место этой сессии не встало — жду дальше; пока его нет, кадры дела не дойдут`,
    deafSeveral: (keys) =>
      `слуха нет: несколько мест названы этой сессией (${keys}) — не угадываю, скажи человеку`,
    gone: (why) => `место ушло: ${why}`,
    seatGone: (why) => `место снято: ${why}`,
    notDelivered: (why) => `в сессию не дошло: ${why}`,
  },
  en: {
    listening: (key) => `listening on standing ${key}`,
    deafNoStanding: (seconds) =>
      `no hearing yet: this session's seat has not stood in ${seconds}s — still waiting; until it stands, case frames do not arrive`,
    deafSeveral: (keys) =>
      `no hearing: several seats are named this session's (${keys}) — not guessing, tell the human`,
    gone: (why) => `the seat is gone: ${why}`,
    seatGone: (why) => `the seat was taken off: ${why}`,
    notDelivered: (why) => `did not reach the session: ${why}`,
  },
};
