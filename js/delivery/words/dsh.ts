// Слова слуха dsh-сессии (dsh/hearing.ts): строки, которыми ухо говорит в консоль dsh —
// сигнал стояния, глухота без места и недоставленное в сессию; хвосты слова старта (dsh/start.ts,
// узел #10921) — само слово общее с OpenCode (PREPARE.start). Форма сообщения плагина
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
  /** Хвост слова старта новой сессии (dsh/start.ts): место слушает плагин; скилл iskron — тулом skill (каталога в headless нет), задача — доля в деле до исхода строки. */
  startListen: () => string;
  /** Хвост слова старта продолженной сессии: место снято с прошлым процессом; те же две обязанности, что у startListen. */
  startResumed: () => string;
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
    startListen: () =>
      "Место этой сессии слушает плагин поставки: встань на него (iskron_stand), и кадры дела придут ходами. Каталог скиллов в headless dsh не показан — загрузи скилл iskron тулом skill по имени и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.",
    startResumed: () =>
      "Сессия продолжена новым процессом: место снято с прошлым — встань снова (iskron_stand); сказанное месту после выхода придёт лежалым. Каталог скиллов в headless dsh не показан — загрузи скилл iskron тулом skill по имени и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.",
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
    startListen: () =>
      "The delivery's plugin hears this session's seat: take it (iskron_stand), and case frames arrive as turns. The skills catalog is not shown in headless dsh — load the iskron skill by name with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.",
    startResumed: () =>
      "The session is continued by a new process: its seat went with the last one — take it again (iskron_stand); what was said to the seat after the exit arrives late. The skills catalog is not shown in headless dsh — load the iskron skill by name with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.",
  },
};
