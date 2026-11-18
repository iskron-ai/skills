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
  /** Хвост слова старта новой сессии (dsh/start.ts): место слушает плагин; скилл iskron — тулом skill (каталог с описаниями в system несёт профиль-патч поставки, проба #8419), задача — доля в деле до исхода строки. */
  startListen: () => string;
  /** Хвост слова старта продолженной сессии: место снято с прошлым процессом; лежалое слово месту приходит в этот же ход шагом (dsh/steer.ts) — ему первый ответ, «Старт» после (проба #8419: модель ушла в «Старт» и до слова не дошла); те же две обязанности, что у startListen. */
  startResumed: () => string;
  /** Хвост слова старта, когда посадка плагина удалась до первого запроса (#11076): место place роли karta в realm уже стоит — не вставать; resumed — сессия продолжена: лежалое слово ложится рядом с задачей в первый шаг или следующим шагом того же хода (dsh/steer.ts) — ему первый ответ; те же две обязанности. */
  startSeated: (place: string, karta: string, realm: string, resumed: boolean) => string;
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
      "Место этой сессии слушает плагин поставки: встань на него (iskron_stand), и кадры дела придут ходами. Загрузи скилл iskron тулом skill и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.",
    startResumed: () =>
      "Сессия продолжена новым процессом: место снято с прошлым — встань снова (iskron_stand). Сказанное месту после выхода, если было, придёт в этот же ход, как только встанешь, — ответь на него первым, «Старт» — после. Загрузи скилл iskron тулом skill и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.",
    startSeated: (place, karta, realm, resumed) =>
      `Место этой сессии уже стоит: ${place}, роль #${karta} в ${realm} — его посадил плагин поставки, вставать заново (iskron_stand) не нужно; кадры дела придут ходами.${resumed ? " Сказанное месту после выхода, если было, приходит в этот же ход — рядом с задачей или следующим шагом; ответь на него первым, «Старт» — после." : ""} Загрузи скилл iskron тулом skill и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.`,
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
      "The delivery's plugin hears this session's seat: take it (iskron_stand), and case frames arrive as turns. Load the iskron skill with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.",
    startResumed: () =>
      "The session is continued by a new process: its seat went with the last one — take it again (iskron_stand). What was said to the seat after the exit, if anything, comes within this turn once you take it — answer it first, the Start after. Load the iskron skill with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.",
    startSeated: (place, karta, realm, resumed) =>
      `This session's seat already stands: ${place}, role #${karta} in ${realm} — the delivery's plugin seated it, no need to take it again (iskron_stand); case frames arrive as turns.${resumed ? " What was said to the seat after the exit, if anything, comes within this turn — beside the task or as a next step; answer it first, the Start after." : ""} Load the iskron skill with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.`,
  },
};
