// js/delivery/contract.ts
var CONTRACT_SUPPORT = { minimum: 39, target: 44 };
var CONTRACT_WORDS = {
  ru: {
    unsupported: (n, target) => `Контракт ${n} больше не поддерживается; старые хуки не удалены. Выполните полный прогон iskronify до ${target}; ритуалы будут приняты после проверки`
  },
  en: {
    unsupported: (n, target) => `Contract ${n} is no longer supported; old hooks have not been removed. Run a full iskronify pass to ${target}; rituals will be accepted after verification`
  }
};

// js/delivery/lang.ts
var LANGS = ["ru", "en"];
var DEFAULT_LANG = "ru";
function langOfServer(url) {
  try {
    return /\.ai\.?$/i.test(new URL(url).hostname) ? "en" : "ru";
  } catch {
    return "ru";
  }
}

// js/delivery/patterns/cover.ts
var COVER = {
  /** Файл обложки в каталоге сессии. */
  file: "AGENTS.md",
  /** Корневой ключ обложки поставки во фронтматтере. */
  root: "iskron",
  /** Прежние формы по языку репозитория (переход): действует та, чьи ключи стоят во фронтматтере. */
  forms: {
    ru: {
      /** Слот графа: значение начинается с полного адреса графа (хэндл владельца/slug) или rN. */
      graph: "Граф",
      /**
       * Слова, которыми в слоте графа перечисляют равноправные рабочие графы («@a/x или @b/y» —
       * неоднозначно); граф за прозой (указатель на методологию, «не используется») — не рабочий (#8066).
       */
      graphJoins: ["или", "либо", "и", "or", "and"],
      /** Слот роли агента: значение начинается с ровно одной ссылки «#N «имя»». */
      role: "Роль агента",
      /** Кавычки имени в ссылке роли: открывающая и закрывающая. */
      roleQuotes: ["«", "»"],
      /** Штамп iskronify в файле обложки: «(iskronify: контракт N, штамп …». */
      stamp: /\(iskronify:\s*контракт\s*`?(\d+)`?\s*,\s*штамп/,
      contractStamp: /^[\s*_]*\(iskronify:\s*контракт\s*`?(\d+)`?(?=\s*[,—)])/m
    },
    en: {
      graph: "Graph",
      graphJoins: ["or", "and"],
      role: "Agent role",
      /** Открывающая и закрывающая совпадают: имя — до первой закрывающей. */
      roleQuotes: ['"', '"'],
      stamp: /\(iskronify:\s*contract\s*`?(\d+)`?\s*,\s*stamp/,
      contractStamp: /^[\s*_]*\(iskronify:\s*contract\s*`?(\d+)`?(?=\s*[,—)])/m
    }
  },
  /**
   * Штамп выравнивания другой поставки: строка, начатая «(<кто>: contract|контракт N», где кто — не
   * iskronify (свои штампы прежних шаблонов — без «штамп» или с датой вместо числа — не чужие).
   * Он без своего — обложка чужой поставки, даже при совпавших ключах английской формы; та же
   * скобка внутри строки прозы — не штамп.
   */
  stampShape: /^[\s*_]*\((?!iskronify:)[^()\n]*?:\s*(?:contract|контракт)\s*`?\d+/m
};

// js/delivery/patterns/launch.ts
var LAUNCH_WORD = "start";
var word = LAUNCH_WORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var LAUNCH_LINE = new RegExp(
  `^[ \\t]*${word}\\s+(\\S+)\\s+(\\S+)\\s+(?:(?:дело|case)\\s+)?[№#]\\s?(\\d+)(?:[ \\t]+(?:от|from)[ \\t]+(\\S+))?(?=\\s|$)`,
  "imu"
);

// js/delivery/patterns/reposigns.ts
var REPO_SIGNS = {
  /** Настройки Claude Code репо: хук старта — запись hooks.SessionStart. */
  settings: ".claude/settings.json",
  /**
   * Метка хука старта iskronify: строка зовёт «Старт» двери iskron — «iskron door» в
   * английской проекции (hooks.md), «двери iskron» / «скилла-двери iskron» в русской
   * (harness-surfaces.md). Прочее имя продукта в команде (iskron_orient, чужой набор) — не метка.
   */
  startMark: /\biskron door\b|двер[иь]\s+iskron\b/i,
  /** Плагин ритуалов OpenCode, который ставит iskronify. */
  rituals: ".opencode/plugins/iskron-rituals.js"
};

// js/delivery/patterns/sections.ts
var SECTIONS = {
  /** Самопроверка этапа — слово пуша. */
  check: (h) => /самопровер|self-check|self-review/i.test(h),
  /** Жизненный цикл сессии — слово мержа, рядом с разделом мержа. */
  lifecycle: (h) => /жизненн\S* цикл|lifecycle/i.test(h),
  /** Акты после мержа — слово мержа. */
  merge: (h) => /мерж|merge/i.test(h) && /граф|graph/i.test(h) || /every merge/i.test(h),
  /** Пуш в ствол — слово мержа на пуше в main/master, прежде заголовка мержа (№2720). */
  trunk: (h) => /пуш|push/i.test(h) && /main|master|ствол/i.test(h),
  /** Правила персистентности — отказ memory-guard. */
  persist: (h) => /персистент|persistence/i.test(h)
};

// js/delivery/product.ts
var PRODUCT = "iskron";
var UPPER = PRODUCT.toUpperCase();
var ENV_PREFIX = `${UPPER}_`;
var envName = (suffix) => `${ENV_PREFIX}${suffix}`;
var BRIDGE_NAME = `${PRODUCT}-bridge`;
var HOME_DIR = `.${BRIDGE_NAME}`;
var HOME_BRIDGE_FILE = `${BRIDGE_NAME}.mjs`;
var RUNTIME_PREFIX = PRODUCT;
var GLOBAL_PREFIX = `__${PRODUCT}`;
var BRIDGE_FILE = `${PRODUCT}.mjs`;
var PLUGIN_COPY_FILE = `${PRODUCT}.js`;
var SUB_ENTRY_PREFIX = `${PRODUCT}-sub`;
var CLIENTS = {
  opencode: `opencode-${PRODUCT}`,
  pi: `pi-${PRODUCT}`,
  doctor: `${PRODUCT}-doctor`,
  watchdog: `${PRODUCT}-watchdog`,
  dsh: `dsh-${PRODUCT}`
};
var SERVER_URLS = {
  ru: "https://mcp.iskron.ru/",
  en: "https://mcp.iskron.ai/"
};
var DEFAULT_SERVER_URL = SERVER_URLS[DEFAULT_LANG];

// js/delivery/protocol.ts
var TOOL_PREFIX = `${PRODUCT}_`;
var tool = (name) => `${TOOL_PREFIX}${name}`;
var LOGGERS = { channel: `${PRODUCT}-channel`, bridge: BRIDGE_NAME };
var FRAME_MARK = `[${PRODUCT}]`;
var ID_PREFIX = `${PRODUCT}-`;
var STRUCTURED_CAPABILITY = `${PRODUCT}/structured`;
var SPAWN_LINE = `${PRODUCT}/spawned_for:`;
var HALTS_CAPABILITY = `${PRODUCT}/halts`;

// js/delivery/spawned-for.ts
var SPAWNED_FOR_ENV = envName("SPAWNED_FOR");
var SPAWNED_FOR = {
  ru: {
    invalid: () => "spawned_for: нужна полная пара {invite: положительное безопасное целое, room: UUID}; неверный JSON, повтор ключа или конфликт источников. Место не занимай.",
    echo: () => "Register не подтвердил spawned_for той же парой. Подъём не подтверждён; работу не начинай.",
    initial: () => "spawned_for: начальный ввод не подтверждён пустым прежним контекстом сессии. История непуста, недоступна или её форма неизвестна; место не занято.",
    kept: (place) => `spawned_for: свежесть места ${place} этой попыткой не подтверждена; прежнее место не отзываю. Место могло остаться.`,
    connect: () => `Прямой channel connect не принимает spawned_for. Используй ${tool("stand")}: connect без поля, затем register с парой. Место не занято.`,
    unbound: () => "spawned_for: привязка взятого места к этой сессии ещё не восстановлена после проходящего отказа; мост повторит её перед следующим вызовом. Этот вызов не выполнен; другое место или вызов без пары её не заменяют.",
    schema: () => "Основание запуска: номер приглашения внутри дела и UUID дела. Регистрация должна подтвердить ту же пару; отказ не обходится другим именем или take.",
    taken: (realm, room, invite) => `Тебя взяли по зову ${invite} дела ${room} в графе ${realm}: регистрация подтвердила пару. До любой работы войди в это дело — ${tool("case")}(action="join", realm="${realm}", room="${room}") — и прочти его постановку; не вошёл — не работай, скажи почему.`,
    gaveUp: (tries, room, invite) => `spawned_for: регистрация ${tries} раз не подтвердила зов ${invite} дела ${room}; этот экземпляр плагина больше не пытается и места не занимает. Подъём не удался — повтор только новым зовом.`,
    held: (place, realm, room, invite) => `Эта сессия уже стоит на месте ${place} по зову ${invite} дела ${room}: пара подтверждена, второе место не регистрирую. Войди в дело — ${tool("case")}(action="join", realm="${realm}", room="${room}") — до работы.`
  },
  en: {
    invalid: () => "spawned_for requires {invite: positive safe integer, room: UUID}; invalid JSON, duplicate key or conflicting sources. Do not take a seat.",
    echo: () => "Register did not confirm the same spawned_for pair. Launch is not confirmed; do not start work.",
    initial: () => "spawned_for: an empty prior session context did not prove this is the initial prompt. History is nonempty, unavailable or unrecognized; no seat was taken.",
    kept: (place) => `spawned_for: this attempt did not prove place ${place} fresh; the previous place is not revoked. The place may remain.`,
    connect: () => `Raw channel connect does not accept spawned_for. Use ${tool("stand")}: connect without the field, then register with the pair. No seat was taken.`,
    unbound: () => "spawned_for: the taken seat is not yet bound to this session again after a passing refusal; the bridge retries before the next call. This call did not run; another seat or a call without the pair does not replace it.",
    schema: () => "Launch basis: the invitation number within its case and the case UUID. Register must confirm the same pair; do not bypass a refusal with another name or take.",
    taken: (realm, room, invite) => `You were taken for invite ${invite} of case ${room} in graph ${realm}: register confirmed the pair. Before any work join that case — ${tool("case")}(action="join", realm="${realm}", room="${room}") — and read its assignment; not joined — do not work, say why.`,
    gaveUp: (tries, room, invite) => `spawned_for: register did not confirm invite ${invite} of case ${room} ${tries} times; this plugin instance stops trying and takes no seat. The launch failed — only a new invitation retries it.`,
    held: (place, realm, room, invite) => `This session already stands on place ${place} for invite ${invite} of case ${room}: the pair is confirmed, no second place is registered. Join the case — ${tool("case")}(action="join", realm="${realm}", room="${room}") — before any work.`
  }
};

// js/delivery/version.ts
var VERSION = "8.14.2";

// js/delivery/words/asks.ts
var ASK = {
  ru: {
    ask: (author, to, toPlace, key, done, form, advice) => `${author} спрашивает роль ${to}${toPlace} [${key}]: «${done}»${form}${advice}`,
    place: (place) => `(место ${place})`,
    yesNo: () => "ответ: да или нет (yes | no)",
    free: () => "ответ своим текстом",
    choice: (options) => `варианты: ${options}`,
    advice: (option, why) => `рекомендация: ${option}${why}`,
    answer: (author, refersTo, reply) => `${author} отвечает на [${refersTo}]: ${reply}`,
    ack: (refersTo, reply, author) => `ответ [${refersTo}] принят${reply} · ${author}`,
    withdrawn: (withdraws, key, done, verdict, author) => `вопрос [${withdraws}] снят: [${key}] [${done}] = ${verdict} · ${author}`,
    inviteOwnerless: (who, standing) => `платформа зовёт роль ${who} в дело: место ${standing} погасло, его строки ничьи`,
    inviteAnswerWaiting: (who, standing) => `платформа зовёт роль ${who} в дело: ответ ждёт приёма, спросившее место ${standing} ушло`
  },
  en: {
    ask: (author, to, toPlace, key, done, form, advice) => `${author} asks the role ${to}${toPlace} [${key}]: “${done}”${form}${advice}`,
    place: (place) => `(seat ${place})`,
    yesNo: () => "answer: yes or no (yes | no)",
    free: () => "answer in your own words",
    choice: (options) => `options: ${options}`,
    advice: (option, why) => `recommended: ${option}${why}`,
    answer: (author, refersTo, reply) => `${author} answers [${refersTo}]: ${reply}`,
    ack: (refersTo, reply, author) => `answer [${refersTo}] accepted${reply} · ${author}`,
    withdrawn: (withdraws, key, done, verdict, author) => `question [${withdraws}] withdrawn: [${key}] [${done}] = ${verdict} · ${author}`,
    inviteOwnerless: (who, standing) => `the platform calls the role ${who} to the case: the seat ${standing} is gone, its lines are nobody's`,
    inviteAnswerWaiting: (who, standing) => `the platform calls the role ${who} to the case: an answer awaits acceptance, the asking seat ${standing} has left`
  }
};

// js/delivery/words/take.ts
var TAKE = {
  ru: {
    rule: () => "только словом человека; место на доске — не свидетельство, что держатель жив: место умершего закроется примерно через минуту, если он держал его мостом машины с демоном, иначе — сроком платформы"
  },
  en: {
    rule: () => "only on the human's word; a seat on the board is no evidence its holder is alive: a dead agent's seat closes in about a minute when it held the seat through a machine bridge with a daemon, otherwise by the platform's term"
  }
};

// js/delivery/words/frame-text.ts
function clockNotice(lang2, kind2, f) {
  const ru = lang2 === "ru";
  const unknown = ru ? "неизвестно" : "unknown";
  const flag = (v) => v === null ? unknown : v ? ru ? "да" : "yes" : ru ? "нет" : "no";
  const head2 = kind2 === "card_unanswered" ? ru ? "карточка без ответа" : "unanswered card" : ru ? "срок строки" : "line due";
  const ref = `${ru ? "дело" : "case"} №${f.room ?? unknown} (id: ${f.roomId ?? unknown}, ${ru ? "граф" : "realm"}: ${f.realm ?? unknown}) [${f.entry ?? unknown}], ${ru ? "ключ" : "key"}: ${f.key ?? unknown}`;
  const who = `${kind2 === "card_unanswered" ? ru ? "адресат" : "recipient" : ru ? "держатель" : "holder"}: ${f.standing ?? unknown} (id: ${f.standingId ?? unknown}, ${ru ? "роль" : "role"}: ${f.karta ?? unknown})`;
  const facts = kind2 === "card_unanswered" ? `${ru ? "слушает" : "listening"}: ${flag(f.listening)}; ${ru ? "последний ход" : "last action"}: ${f.lastAct ?? unknown}; ${ru ? "роль позвана" : "role called"}: ${flag(f.roleCalled)}` : `${ru ? "срок" : "due"}: ${f.due ?? unknown}; ${ru ? "передано постановщику" : "escalated"}: ${flag(f.escalated)}`;
  return `${head2}: ${ref}; ${who}; ${facts}`;
}
var FRAME_TEXT = {
  ru: {
    clockNotice: (kind2, facts) => clockNotice("ru", kind2, facts),
    cardRepeat: (n) => `повтор карточки: ${n ?? "номер неизвестен"}`,
    openCards: (count, oldest, malformed = false) => `карточек без ответа: ${count ?? "неизвестно"}${oldest ? `; старшая с ${oldest}` : ""}${malformed ? " (неверное my_open_cards)" : ""}`,
    myCases: () => `${tool("case")}(action="mine"), затем read каждого`,
    frame: (id) => `кадр ${id}`,
    yoursBelow: () => ` — адресованные строками ниже; `,
    noneYours: () => ` — адресованных месту нет; `,
    count: (head2, n, mine) => `${head2}: записей ${n}, тебе ${mine}`,
    supersededLines: (gone) => `, сменённых строк ключа ${gone}`,
    askAnswered: (n, by) => `; вопрос [${n}] к тебе закрыт: ответил ${by}`,
    askMoved: (n, to) => `; вопрос [${n}] к тебе переадресован ${to}`,
    inFull: (cases) => `целиком — ${cases || FRAME_TEXT.ru.myCases()}`,
    caseHistory: (args2, since) => `${tool("case")}(${args2}, since=${since})`,
    lifeCheckReply: () => `Ответь действием: обнови занятость — ${tool("stand")}(realm, status=<чем занят>) — или скажи в деле.`,
    lifeCheckSeat: (name) => `Предупреждено место: ${name || "место не названо платформой"}.`,
    humanWordReply: (realm, karta, standing, id) => `ответ: ${tool("channel")}(action="send", realm=${realm}, karta=${karta}, standing=${standing}, in_reply_to=${id}, text=…)`,
    noReplyAddress: (m) => `адреса для ответа нет: ${[
      m.realm && "графа",
      m.karta && "роли человека",
      m.standing && "места человека",
      m.id && "id слова"
    ].filter(Boolean).join(", ")}`
  },
  en: {
    clockNotice: (kind2, facts) => clockNotice("en", kind2, facts),
    cardRepeat: (n) => `card repeat: ${n ?? "number unknown"}`,
    openCards: (count, oldest, malformed = false) => `unanswered cards: ${count ?? "unknown"}${oldest ? `; oldest since ${oldest}` : ""}${malformed ? " (invalid my_open_cards)" : ""}`,
    myCases: () => `${tool("case")}(action="mine"), then read each`,
    frame: (id) => `frame ${id}`,
    yoursBelow: () => ` — yours in the lines below; `,
    noneYours: () => ` — none of them yours; `,
    count: (head2, n, mine) => `${head2}: ${n} records, yours ${mine}`,
    supersededLines: (gone) => `, ${gone} superseded lines of a key`,
    askAnswered: (n, by) => `; your question [${n}] is closed: answered by ${by}`,
    askMoved: (n, to) => `; your question [${n}] is re-asked of ${to}`,
    inFull: (cases) => `in full — ${cases || FRAME_TEXT.en.myCases()}`,
    caseHistory: (args2, since) => `${tool("case")}(${args2}, since=${since})`,
    lifeCheckReply: () => `Answer with an action: update your status — ${tool("stand")}(realm, status=<what you are doing>) — or say a word in the case.`,
    lifeCheckSeat: (name) => `Seat warned: ${name || "the platform did not name the seat"}.`,
    humanWordReply: (realm, karta, standing, id) => `reply: ${tool("channel")}(action="send", realm=${realm}, karta=${karta}, standing=${standing}, in_reply_to=${id}, text=…)`,
    noReplyAddress: (m) => `no address to reply: missing ${[
      m.realm && "the graph",
      m.karta && "the person's role",
      m.standing && "the person's seat",
      m.id && "the word's id"
    ].filter(Boolean).join(", ")}`
  }
};
var CASE_LINE = {
  ru: {
    platform: () => "платформа",
    quote: (s) => `«${s}»`
  },
  en: {
    platform: () => "platform",
    quote: (s) => `“${s}”`
  }
};

// js/delivery/words/compaction.ts
var role = (karta, none) => {
  const seq = karta.replace(/^#/, "");
  return seq && seq !== "undefined" ? `#${seq}` : none;
};
var COMPACTION = {
  ru: {
    keep: (karta, name, realm) => `Искрон: сохрани в сводке роль ${role(karta, "<роль>")}, граф ${realm}, место ${name} (держит мост), номера живых дел, ожидания и наказ на первый ход: загрузить iskron и названные им скиллы роли.`,
    back: (karta, name, realm) => `Искрон: контекст сжат. Роль ${role(karta, "<роль>")}, граф ${realm}, место ${name} держит мост — заново не занимай. До работы загрузи iskron и названные им скиллы роли; факты-основания сводки перечитай в графе через recall.`,
    bare: () => "Искрон: контекст сжат. До работы загрузи iskron и названные им скиллы роли; факты-основания сводки перечитай в графе через recall.",
    restand: (karta, name, realm) => ` Первым ходом вызови iskron_stand(realm="${realm}", karta="${role(karta, "<роль>")}", name="${name}") без take: место остаётся, ответ несёт правила человека.`,
    returned: (sessionID) => `Искрон: слово о роли после сжатия вложено в system текущего запроса сессии ${sessionID}`
  },
  en: {
    keep: (karta, name, realm) => `Iskron: the summary of this compaction must keep the agent's role ${role(karta, "<role>")} in graph ${realm}, its seat ${name} (the bridge holds the standing), the live cases — by number and what they wait for — and the instruction to reread the door (the iskron skill) and the role's skills as the first move after the compaction.`,
    back: (karta, name, realm) => `Iskron: the context was compacted. You are role ${role(karta, "<role>")} in graph ${realm}, the bridge holds seat ${name}. Before the first substantive move load the door (the iskron skill) and the role's skills — the door names them; only those, not all the earlier ones. The summary is a pointer, not the record: a decision, ground or fact from it you lean on — read it in the graph again (the recall skill).`,
    bare: () => `Iskron: the context was compacted. Before the first substantive move load the door (the iskron skill) and the role's skills — the door names them; only those, not all the earlier ones. The summary is a pointer, not the record: a decision, ground or fact from it you lean on — read it in the graph again (the recall skill).`,
    restand: (karta, name, realm) => ` As the first move call iskron_stand(realm="${realm}", karta="${role(karta, "<role>")}", name="${name}") without take: the seat stays, and its answer carries the human's rules.`,
    returned: (sessionID) => `Iskron: the role word after the compaction was inserted into the current request's system for session ${sessionID}`
  }
};

// js/delivery/words/dsh.ts
var DSH = {
  ru: {
    listening: (key) => `слушаю стояние ${key}`,
    deafNoStanding: (seconds) => `слуха пока нет: за ${seconds} с место этой сессии не встало — жду дальше; пока его нет, кадры дела не дойдут`,
    deafSeveral: (keys) => `слуха нет: несколько мест названы этой сессией (${keys}) — не угадываю, скажи человеку`,
    gone: (why) => `место ушло: ${why}`,
    seatGone: (why) => `место снято: ${why}`,
    notDelivered: (why) => `в сессию не дошло: ${why}`,
    startListen: () => "Место этой сессии слушает плагин поставки: встань на него (iskron_stand), и кадры дела придут ходами. Загрузи скилл iskron тулом skill и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.",
    startResumed: () => "Сессия продолжена новым процессом: место снято с прошлым — встань снова (iskron_stand). Сказанное месту после выхода, если было, придёт в этот же ход, как только встанешь, — ответь на него первым, «Старт» — после. Загрузи скилл iskron тулом skill и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.",
    startSeated: (place, karta, realm, resumed) => `Место этой сессии уже стоит: ${place}, роль #${karta} в ${realm} — его посадил плагин поставки, вставать заново (iskron_stand) не нужно; кадры дела придут ходами.${resumed ? " Сказанное месту после выхода, если было, приходит в этот же ход — рядом с задачей или следующим шагом; ответь на него первым, «Старт» — после." : ""} Загрузи скилл iskron тулом skill и иди по его «Старту». Задача этой сессии — твоя доля в деле до исхода её строки, а не вход в дело: вошёл — делай работу и закрой строку исходом.`
  },
  en: {
    listening: (key) => `listening on standing ${key}`,
    deafNoStanding: (seconds) => `no hearing yet: this session's seat has not stood in ${seconds}s — still waiting; until it stands, case frames do not arrive`,
    deafSeveral: (keys) => `no hearing: several seats are named this session's (${keys}) — not guessing, tell the human`,
    gone: (why) => `the seat is gone: ${why}`,
    seatGone: (why) => `the seat was taken off: ${why}`,
    notDelivered: (why) => `did not reach the session: ${why}`,
    startListen: () => "The delivery's plugin hears this session's seat: take it (iskron_stand), and case frames arrive as turns. Load the iskron skill with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.",
    startResumed: () => "The session is continued by a new process: its seat went with the last one — take it again (iskron_stand). What was said to the seat after the exit, if anything, comes within this turn once you take it — answer it first, the Start after. Load the iskron skill with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.",
    startSeated: (place, karta, realm, resumed) => `This session's seat already stands: ${place}, role #${karta} in ${realm} — the delivery's plugin seated it, no need to take it again (iskron_stand); case frames arrive as turns.${resumed ? " What was said to the seat after the exit, if anything, comes within this turn — beside the task or as a next step; answer it first, the Start after." : ""} Load the iskron skill with the skill tool and follow its Start. This session's task is your share in the case until its line's outcome, not entering the case: once in — do the work and close the line with the outcome.`
  }
};

// js/delivery/words/onboardstart.ts
var ONBOARD_START = {
  ru: {
    start: () => "Репо не выровнен: предложи человеку onboarding (iskronify, «Первый граф»); его запрос это не задерживает."
  },
  en: {
    start: () => "This repository is not yet aligned for the agent — offer the person the onboarding skill; it does not hold up their request."
  }
};

// js/delivery/words/prepare.ts
var RITE_RU = (what, where) => `свой ${what} в ${where} — ритуалы несёт поставка, а при своём она молчит: сними его, а в скрипте с ветками иных родов — лишь ветку этого (переход Шага 4 iskronify)`;
var RITE_EN = (what, where) => `the repo's own ${what} in ${where} — the delivery carries the rituals and keeps silent beside its own: take it off, and in a script with branches of other kinds only this one's branch (the transition of iskronify Step 4)`;
var PLUGIN_RU = "свой плагин ритуалов в .opencode/plugins — ритуалы несёт поставка, а при нём она молчит: сними его, а если он несёт ветки иных родов (гейт мержа и подобное) — сними в нём лишь старт, пуш, мерж и memory-guard, остальное оставь файлом с именем без «ritual» (переход Шага 4 iskronify)";
var PLUGIN_EN = "the repo's own rituals plugin in .opencode/plugins — the delivery carries the rituals and keeps silent beside it: take it off, and if it carries branches of other kinds (a merge gate and the like) take off only start, push, merge and the memory guard and keep the rest in a file named without «ritual» (the transition of iskronify Step 4)";
var PREPARE = {
  ru: {
    usage: () => "использование: prepare [--dir <репо>] [--graph rN] [--holon N] [--agent-role N] [--contract N] [--stamp ГГГГ-ММ-ДД] [--case N] [--json] [--lang en|ru]\n",
    badArg: (flag, value) => `${flag}: «${value}» — не та форма; справка — prepare --help`,
    notRepo: (dir) => `${dir} — не git-репозиторий: готовить нечего, ничего не записано`,
    foreign: (file) => `${file} несёт обложку другой поставки — смену поставки решает человек, ничего не записано`,
    unparsed: (file) => `${file} не разбирается — ничего не записано`,
    reality: (caseNo) => `# Reality — против чего проверяется заявка

Носители ещё не установлены${caseNo ? `; дело выравнивания №${caseNo}` : ""}. До их установления поведенческие заявки не принимаются.
`,
    start: ({ graph, holon, role: role2 }) => `До действий исполни «Старт» двери iskron до готовности. Обложка AGENTS.md: граф ${graph}${holon ? `, контур #${holon}` : ""}${role2 ? `, роль #${role2}` : ""}. Своё место повторно не занимай; субагент пишет только своим мостом-спутником.`,
    guard: (graph, section = "Правила персистентности") => `BLOCKED: локальная память запрещена целиком (AGENTS.md${section ? `, «${section}»` : ""}). Правила/команды/свойства кода репо → AGENTS.md; ловушки → дом по «Раскладке»; смысл кода и состояние проекта → граф ${graph}; личное вне проекта, включая факты машины → minding. Полный маршрут — в AGENTS.md; директорию памяти не меняй.`,
    left: (item, keys) => ({
      "cover.repeat": `ключ ${keys} стоит во фронтматтере AGENTS.md дважды — строгий YAML его отвергает, AGENTS.md не тронут: оставь одно значение и повтори prepare`,
      "cover.rituals": `ритуал ${keys} в поле rituals: обложки поставка не знает — он ничего не включает; её ритуалы: start push merge guard turn. Исправь имя или сними его`,
      "cover.graph": "граф не назван — --graph rN (iskron_realm action=list), такт 1 iskronify",
      "cover.holon": "контур не назван — --holon N: поиск контура по атрибуту repository или его заведение",
      "cover.agent_role": "роль не названа — --agent-role N: стюард контура (iskron_search steward_of) или её заведение",
      "cover.contract": "контракт не назван — --contract N последним вызовом прогона (Шаг 7)",
      "cover.flat": "прежняя плоская обложка стоит рядом с блоком — слоты-суждения перенеси в «Проект», плоские ключи сними",
      "CLAUDE.md": "CLAUDE.md — свой файл, не указатель: содержимое влей в AGENTS.md и замени указателем (Шаг 7)",
      "hook.start": RITE_RU("хук старта", ".claude/settings.json"),
      "hook.guard": "memory-guard ждёт графа в обложке — повтори prepare с --graph",
      "hook.push": RITE_RU("хук пуша", ".claude/settings.json"),
      "hook.merge": RITE_RU("хук мержа", ".claude/settings.json"),
      "opencode.rituals": PLUGIN_RU
    })[item],
    unread: (item, hook) => item === "hook.guard" ? `стоит «${hook}», и prepare не узнал, memory-guard ли это, — своего рядом не поставил: прочти скрипт; это он — ничего не делай, нет — допиши по Шагу 4 iskronify (references/hooks.md)` : `стоит «${hook}», и prepare не узнал, хук старта ли это: прочти скрипт; это он — сними (старт несёт поставка, а при своём она молчит), нет — ничего не делай`,
    head: (kind2) => ({ done: "сделано", kept: "уже стоит", left: "модели" })[kind2]
  },
  en: {
    usage: () => "usage: prepare [--dir <repo>] [--graph rN] [--holon N] [--agent-role N] [--contract N] [--stamp YYYY-MM-DD] [--case N] [--json] [--lang en|ru]\n",
    badArg: (flag, value) => `${flag}: "${value}" is not the right form; see prepare --help`,
    notRepo: (dir) => `${dir} is not a git repository: nothing to prepare, nothing written`,
    foreign: (file) => `${file} carries another delivery's cover — switching deliveries is the person's call, nothing written`,
    unparsed: (file) => `${file} does not parse — nothing written`,
    reality: (caseNo) => `# Reality — what a claim is checked against

Carriers are not established yet${caseNo ? `; alignment case №${caseNo}` : ""}. Until they are, behavioral claims are not accepted.
`,
    start: ({ graph, holon, role: role2 }) => `Read the Start section of the iskron door before acting and finish it as readiness, not reading. Addresses are the iskron: cover of AGENTS.md: graph ${graph}${holon ? `, focus holon #${holon}` : ""}${role2 ? `, agent role #${role2}` : ""}. Standing on watch or before the first write to the graph or a case, one call: iskron_stand; a reading session takes no seat. start <graph> <role> <case №N> enters that case; a subagent stands on its own satellite bridge (iskron_stand with satellite_of) and does not write to the graph on the bridge of its caller.`,
    guard: (graph, section = "Persistence rules") => `BLOCKED: local agent memory is forbidden entirely, by directory (AGENTS.md${section ? `, «${section}»` : ""}). Route the fact: repo conventions, rituals, commands and code properties → AGENTS.md; gotchas → their home by «Layout» (GOTCHAS.md or the graph); the meaning of code (decisions, grounds), project state, servers and dated duties → the graph ${graph}; a fact of the user outside the project, machine facts included → personal memory through minding. This memory-guard keeps the directory frozen.`,
    left: (item, keys) => ({
      "cover.repeat": `the key ${keys} stands twice in the front matter of AGENTS.md — strict YAML refuses it, AGENTS.md is untouched: keep one value and run prepare again`,
      "cover.rituals": `the delivery knows no ritual ${keys} in the cover's rituals: field — it switches nothing on; its rituals: start push merge guard turn. Fix the name or drop it`,
      "cover.graph": "no graph named — --graph rN (iskron_realm action=list), iskronify tact 1",
      "cover.holon": "no holon named — --holon N: find the holon by its repository attribute or create it",
      "cover.agent_role": "no role named — --agent-role N: the holon's steward (iskron_search steward_of) or create it",
      "cover.contract": "no contract named — --contract N in the run's last call (Step 7)",
      "cover.flat": "the former flat cover stands beside the block — move judgment slots into «Project», drop the flat keys",
      "CLAUDE.md": "CLAUDE.md is a file of its own, not a pointer: merge its content into AGENTS.md and replace it with the pointer (Step 7)",
      "hook.start": RITE_EN("start hook", ".claude/settings.json"),
      "hook.guard": "memory-guard waits for a graph in the cover — run prepare again with --graph",
      "hook.push": RITE_EN("push hook", ".claude/settings.json"),
      "hook.merge": RITE_EN("merge hook", ".claude/settings.json"),
      "opencode.rituals": PLUGIN_EN
    })[item],
    unread: (item, hook) => item === "hook.guard" ? `"${hook}" stands, and prepare could not tell whether it is the memory-guard — none of its own was put beside it: read the script; if it is, do nothing, if not, add it by iskronify Step 4 (references/hooks.md)` : `"${hook}" stands, and prepare could not tell whether it is the start hook: read the script; if it is, take it off (the delivery carries the start and keeps silent beside its own), if not, do nothing`,
    head: (kind2) => ({ done: "done", kept: "already there", left: "for the model" })[kind2]
  }
};

// js/delivery/words/rites.ts
var cite = (heads) => heads.filter(Boolean).map((h) => `«${h}»`).join(", ");
var RITES = {
  ru: {
    lifecycle: () => "Жизненный цикл сессии",
    push: (check) => `[iskron] пуш — не отгрузка. Исполни самопроверку и правила ревью/PR по AGENTS.md${check ? `, «${check}»` : ""}.`,
    merge: (holon, ...heads) => `[iskron] мерж: исполни акты после мержа по AGENTS.md${cite(heads) ? ` (${cite(heads)})` : ""}${holon ? `; контур #${holon}` : ""}.`,
    early: (graph) => `[iskron] граф ${graph}; контура и роли нет. Продолжи iskronify, «Первый граф», с недостающего шага; номера не выдумывай.`
  },
  en: {
    lifecycle: () => "Session lifecycle",
    push: (check) => `[iskron] a push ships nothing: self-check the diff, a vocabulary pass over the PR text; review — once per ready batch (AGENTS.md${check ? `, «${check}» and the review section` : ""}). Shipping is the merge.`,
    merge: (holon, ...heads) => `[iskron] merge — the after-merge acts of AGENTS.md${cite(heads) ? ` (${cite(heads)})` : ""}: weave ${holon ? `holon #${holon}` : "the holon"}, advance the map, modes by evidence, close along the axis, reconcile, vocabulary pass; feedback reflection — if AGENTS.md calls for it; work by reference from an agent — only the transformation seed and the delivery modes.`,
    early: (graph) => `[iskron] the AGENTS.md cover names graph ${graph}, with no holon and agent role in it yet — continue the onboarding: the «First graph» branch of the iskronify skill, from the missing step; do not invent holon or role numbers.`
  }
};

// js/delivery/words/rooms.ts
var ROOM = {
  ru: {
    said: (author) => `слово от ${author}`,
    saidPending: (author) => `слово от ${author} в полёте — текст придёт следом`,
    aside: (author, addressee, word2) => `${author} → ${addressee}: слово [${word2}]`,
    asideRun: (author, addressee, count, word2) => `${author} → ${addressee}: ${count} (последнее [${word2}])`,
    asideBody: (author, addressee, word2) => `${author} → ${addressee}: текст слова [${word2}]`,
    messages: (n) => {
      const m10 = n % 10;
      const m100 = n % 100;
      const w = m10 === 1 && m100 !== 11 ? "слово" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "слова" : "слов";
      return `${n} ${w}`;
    },
    body: (refersTo, author) => `текст слова [${refersTo}] от ${author}`,
    bodyAborted: (refersTo) => `слово [${refersTo}] оборвано автором`,
    bodyLapsed: (refersTo) => `слово [${refersTo}] оборвано платформой по сроку`,
    closing: (author, endsAt, evidence) => `ведущий ${author} предлагает закрыть дело до ${endsAt}${evidence ? `; свидетельства: ${evidence}` : ""}`,
    closingMay: (entryId) => `ты можешь возразить — iskron_case(action="object", in_reply_to=${entryId})`,
    closingNot: () => "возражать не тебе",
    closed: (reason) => `дело закрыто: ${reason}`,
    objection: (author, reason) => `${author} возражает против закрытия: ${reason}`,
    lateObjection: (author) => `${author} возразил после закрытия`,
    progress: (key, done, verdict, note, author) => `[${key}] [${done}] = ${verdict}${note} · ${author}`,
    opened: (author) => `дело открыл ${author}`,
    joined: (who) => `вошёл ${who}`,
    left: (who, reason) => `вышел ${who}${reason ? `; причина: ${reason}` : ""}`,
    invite: (author, who) => `${author} зовёт ${who} в дело`,
    withdraw: (author) => `приглашение отозвано, отзывает ${author}`,
    retract: (author, answer, afterAck) => `ответ [${answer}] отозван${afterAck ? " после принятия" : ""}, отзывает ${author}`,
    node: (seq, name, realm, reasoning) => `в деле узел #${seq} ${name} (${realm})${reasoning}`,
    nodeUpdated: (seq, name, reasoning) => `узел #${seq} ${name} обновлён${reasoning}`,
    nodeDeleted: (seq, name, reasoning) => `узел #${seq} ${name} удалён${reasoning}`,
    nodeUndeleted: (seq, name, reasoning) => `узел #${seq} ${name} восстановлен${reasoning}`,
    link: (room, rel) => `дело связано с №${room} (${rel})`,
    auto: (code, room) => `запись платформы ${code} о деле №${room}`,
    unknown: (kind2) => `род ${kind2} мосту неизвестен`,
    case: (room) => `№${room}`,
    replyTo: (id) => `в ответ на [${id}]`,
    stale: () => "лежалый",
    bodyRead: (how) => `тело: ${how}`,
    whoHuman: (user) => `человек${user}`,
    whoRole: (karta) => `роль #${karta}`,
    whoSibling: (karta) => `брат по роли #${karta}`,
    whoPlatform: () => "платформа — побудка",
    whoGraph: () => "событие графа",
    legacy: (kind2, stack) => `род ${kind2}${stack ? `, стопка ${stack}` : ""}`
  },
  en: {
    said: (author) => `message from ${author}`,
    saidPending: (author) => `message from ${author} in flight — the text follows`,
    aside: (author, addressee, word2) => `${author} → ${addressee}: message [${word2}]`,
    asideRun: (author, addressee, count, word2) => `${author} → ${addressee}: ${count} (last [${word2}])`,
    asideBody: (author, addressee, word2) => `${author} → ${addressee}: text of message [${word2}]`,
    messages: (n) => `${n} ${n === 1 ? "message" : "messages"}`,
    body: (refersTo, author) => `text of message [${refersTo}] from ${author}`,
    bodyAborted: (refersTo) => `message [${refersTo}] cut off by its author`,
    bodyLapsed: (refersTo) => `message [${refersTo}] cut off by the platform on its deadline`,
    closing: (author, endsAt, evidence) => `the lead ${author} proposes to close the case by ${endsAt}${evidence ? `; evidence: ${evidence}` : ""}`,
    closingMay: (entryId) => `you may object — iskron_case(action="object", in_reply_to=${entryId})`,
    closingNot: () => "the objection is not yours to make",
    closed: (reason) => `case closed: ${reason}`,
    objection: (author, reason) => `${author} objects to closing: ${reason}`,
    lateObjection: (author) => `${author} objected after the close`,
    progress: (key, done, verdict, note, author) => `[${key}] [${done}] = ${verdict}${note} · ${author}`,
    opened: (author) => `case opened by ${author}`,
    joined: (who) => `entered ${who}`,
    left: (who, reason) => `left ${who}${reason ? `; reason: ${reason}` : ""}`,
    invite: (author, who) => `${author} invites ${who} to the case`,
    withdraw: (author) => `invitation withdrawn by ${author}`,
    retract: (author, answer, afterAck) => `answer [${answer}] retracted${afterAck ? " after acceptance" : ""} by ${author}`,
    node: (seq, name, realm, reasoning) => `node #${seq} ${name} (${realm}) in the case${reasoning}`,
    nodeUpdated: (seq, name, reasoning) => `node #${seq} ${name} updated${reasoning}`,
    nodeDeleted: (seq, name, reasoning) => `node #${seq} ${name} deleted${reasoning}`,
    nodeUndeleted: (seq, name, reasoning) => `node #${seq} ${name} restored${reasoning}`,
    link: (room, rel) => `case linked to case №${room} (${rel})`,
    auto: (code, room) => `platform record ${code} about case №${room}`,
    unknown: (kind2) => `kind ${kind2} is unknown to the bridge`,
    case: (room) => `case №${room}`,
    replyTo: (id) => `in reply to [${id}]`,
    stale: () => "stale",
    bodyRead: (how) => `body: ${how}`,
    whoHuman: (user) => `human${user}`,
    whoRole: (karta) => `role #${karta}`,
    whoSibling: (karta) => `sibling of role #${karta}`,
    whoPlatform: () => "platform — a wake-up",
    whoGraph: () => "graph event",
    legacy: (kind2, stack) => `kind ${kind2}${stack ? ` · ${stack}` : ""}`
  }
};
var ROOM_AUTO = {
  ru: {
    child_opened: (room) => `дочернее дело №${room} открыто`,
    child_closing: (room) => `дочернее дело №${room} закрывается`,
    child_closed: (room) => `дочернее дело №${room} закрыто`,
    child_late_objection: (room) => `позднее возражение в дочернем деле №${room}`
  },
  en: {
    child_opened: (room) => `child case №${room} opened`,
    child_closing: (room) => `child case №${room} is closing`,
    child_closed: (room) => `child case №${room} closed`,
    child_late_objection: (room) => `late objection in child case №${room}`
  }
};
var ROOM_REL = {
  ru: {
    parent: () => "дочернее к нему",
    child: () => "родительское к нему",
    continues: () => "продолжает его"
  },
  en: {
    parent: () => "its child",
    child: () => "its parent",
    continues: () => "continues it"
  }
};
var VERDICT = {
  ru: { ok: () => "ok", partial: () => "частично", bad: () => "slop" },
  en: { ok: () => "ok", partial: () => "partial", bad: () => "slop" }
};

// js/delivery/words/rootseat.ts
var ROOT_SEAT = {
  ru: {
    noFile: (file) => `нет ${file}`,
    noFrontmatter: (file) => `в ${file} нет YAML-фронтматтера обложки`,
    noKey: (file, key) => `в обложке ${file} нет слота '${key}'`,
    noForm: (file, keys) => `в обложке ${file} нет ни одного из слотов ${keys}`,
    manyForms: (file, keys) => `обложка ${file} смешивает языки: ${keys} сразу`,
    noGraph: (file, key) => `'${key}' в ${file} не начинается с полного адреса графа или rN`,
    manyGraphs: (file, key, list) => `'${key}' в ${file} называет несколько графов: ${list}`,
    noRoleRef: (file, key, ref) => `'${key}' в ${file} не начинается ссылкой ${ref}`,
    manyRoles: (file, key, list) => `'${key}' в ${file} называет несколько ролей: ${list}`,
    notNumber: (file, key) => `'${key}' в ${file} — не число`,
    seated: (place, karta, realm, file) => `Искрон: место ${place}, роль #${karta} в ${realm} по ${file}; записи подписаны им. Для вахты (room/model) или своего имени — iskron_stand: предварительное место заменит без take.`,
    ownSeated: (place, karta, realm, file) => `Искрон: сессия своим местом ${place}, роль #${karta} в ${realm} по ${file}; записи подписаны им. Другое имя — iskron_stand с take.`,
    cancelled: () => "Экземпляр или сессия остановлены; новая посадка запрещена.",
    cleanupFailed: (place, why) => `Отменённая посадка ${place}: снять место не удалось (${why}); мост закрывается, место может остаться до простоя на сервере.`,
    unproven: () => "мост не подтвердил, что это провизорное место взято этой попыткой; revoke не разрешён",
    notSeated: (why) => `Искрон: сессия не посажена — ${why}; место — словом человека или iskron_stand.`,
    realign: (why, file) => `Искрон: сессия не посажена — ${why}. Выровняй ${file} через iskronify; граф и роль не угадывай. Однозначная обложка — посадка повторится сама.`,
    refused: (text3) => `посадка сорвалась: ${text3}`,
    ownOther: (place, karta, realm) => `Искрон: сессия держит место ${place} — роль #${karta} в ${realm}; роль или граф не совпадают с обложкой. Для смены — iskron_stand с take либо явное снятие текущего места (revoke).`,
    heldUncompared: (place, karta, held, cover) => `Искрон: сессия держит место ${place} — роль #${karta}, ${held}; граф не сличён с ${cover} в обложке. Для смены — iskron_stand с take либо явное снятие текущего места (revoke).`,
    unknownRealm: () => "граф неизвестен (запись держания недоступна)",
    uncompared: (cover, held) => `граф не сличён: ${cover} в обложке, ${held} у места`,
    late: (seconds) => `посадка не уложилась в ${seconds} с, запрос идёт без места`,
    noBridge: () => "мост не поднят"
  },
  en: {
    noFile: (file) => `there is no ${file}`,
    noFrontmatter: (file) => `${file} carries no YAML front matter`,
    noKey: (file, key) => `the front matter of ${file} has no '${key}' slot`,
    noForm: (file, keys) => `the front matter of ${file} has none of the slots ${keys}`,
    manyForms: (file, keys) => `the cover of ${file} mixes languages: ${keys} at once`,
    noGraph: (file, key) => `'${key}' in ${file} does not start with a full graph address or rN`,
    manyGraphs: (file, key, list) => `'${key}' in ${file} names several graphs: ${list}`,
    noRoleRef: (file, key, ref) => `'${key}' in ${file} does not start with a ${ref} reference`,
    manyRoles: (file, key, list) => `'${key}' in ${file} names several roles: ${list}`,
    notNumber: (file, key) => `'${key}' in ${file} is not a number`,
    seated: (place, karta, realm, file) => `Iskron: the session holds seat ${place} — role #${karta} in ${realm}, per ${file}; writes are signed by this seat. For a watch (room/model) or your own name, call iskron_stand — it replaces a provisional seat without take.`,
    ownSeated: (place, karta, realm, file) => `Iskron: the session holds its own seat ${place} — role #${karta} in ${realm}, per ${file}; writes are signed by it. A different name requires iskron_stand with take.`,
    cancelled: () => "The instance or session is stopped; no new seating is allowed.",
    cleanupFailed: (place, why) => `Cancelled seating ${place}: could not revoke the seat (${why}); the bridge is closing, the seat may remain until the server's idle expiry.`,
    unproven: () => "the bridge did not prove this attempt took a provisional seat; revoke is not authorized",
    notSeated: (why) => `Iskron: the session is not seated — ${why}; a seat comes by the human's word or iskron_stand.`,
    realign: (why, file) => `Iskron: the session is not seated — ${why}. Align the repository with the iskronify skill from valid sources; do not guess the graph or the role — ask what cannot be determined by the alignment procedure. Seating repeats by itself as soon as the cover ${file} becomes unambiguous.`,
    refused: (text3) => `seating failed: ${text3}`,
    ownOther: (place, karta, realm) => `Iskron: the session holds seat ${place} — role #${karta} in ${realm}; its role or graph differs from the cover. To change seats, use iskron_stand with take or explicitly revoke the held seat.`,
    heldUncompared: (place, karta, held, cover) => `Iskron: the session holds seat ${place} — role #${karta}, ${held}; its graph is not compared with ${cover} in the cover. To change seats, use iskron_stand with take or explicitly revoke the held seat.`,
    unknownRealm: () => "graph unknown (hold record unavailable)",
    uncompared: (cover, held) => `graph not compared: ${cover} in the cover, ${held} on the seat`,
    late: (seconds) => `seating did not finish in ${seconds} s, the request goes without a seat`,
    noBridge: () => "no bridge raised"
  }
};

// js/delivery/words/stalebatch.ts
var STALE = {
  ru: {
    head: (count, shown, legacy = false) => `Лежалых кадров: ${count}` + (count > shown ? `, здесь первые ${shown}, не вошло ${count - shown}` : "") + (legacy ? `; адресованные месту — текстом, прочие — счётом. Целиком — по строкам дел; не вошедшее — ${FRAME_TEXT.ru.myCases()}.` : ".")
  },
  en: {
    head: (count, shown, legacy = false) => `Stale frames: ${count}` + (count > shown ? `, the first ${shown} here, ${count - shown} left out` : "") + (legacy ? ` — taken while the seat was not listening, or the service repeating after a session rebuild; those addressed to the seat as text, the rest by count; in full — by the case lines below, the rest — ${FRAME_TEXT.en.myCases()}.` : ".")
  }
};

// js/delivery/words/status.ts
var TAKE_PATH_RU = `iskron_stand с take=true (${TAKE.ru.rule()}) переносит слух и статусный адрес сюда ОДИН раз: адрес остаётся у ЭТОГО экземпляра моста, и поднятый следом сторож его не уносит — по устройству: сторож есть локальный клиент сокета, своего connect он не делает (замер: два вызова занятости подряд при живом стороже, сборка 6.10.1; путь take наблюдала сторона nks-mcp на своей). Прежний держатель получит закрытие 4000 (вытесненному отбивать место назад тем же ходом не нужно — ему место рядом, имя.N); входной адрес и очередь места connect не трогает, ждавшее придёт в hello (справка iskron_channel action="?", connect); после переноса перевзведи сторожа командой из ответа`;
var TAKE_PATH_EN = `iskron_stand with take=true (${TAKE.en.rule()}) moves the hearing and the status address here ONCE: the address stays with THIS bridge instance, and a watchdog raised after it does not carry it off — by design: the watchdog is a local client of the socket and makes no connect of its own. The former holder gets close 4000 (the evicted one need not take the seat back the same way — it gets a seat beside, name.N); connect does not touch the seat's incoming address and queue, what waited comes in hello (help: iskron_channel action="?", connect); after the move re-arm the watchdog with the command from the answer`;
var TWO_ENTRIES_RU = "Если место — твоё и держит его мост этой же сессии (в ней две записи iskron, плагинная и пользовательская), зови status тем же набором тулов, которым звал iskron_stand: передача не нужна.";
var TWO_ENTRIES_EN = "If the seat is yours and a bridge of this same session holds it (the session has two iskron entries, the plugin's and the user's), call status with the same tool set you called iskron_stand with: no move is needed.";
var TURNED_RU = `${TWO_ENTRIES_RU} Иначе ${TAKE_PATH_RU}.`;
var TURNED_EN = `${TWO_ENTRIES_EN} Otherwise ${TAKE_PATH_EN}.`;

// js/delivery/words/statuspost.ts
var STATUS_POST = {
  ru: {
    trimmedBy: (message) => `строка обрезана сервером: ${message}`,
    trimmed: () => "сервер обрезал строку; переназови короче",
    noAnswer: (error) => `Отказано (мост): статусный адрес не ответил — ${error}`,
    gone: (body) => `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`,
    refused: (status, body) => `Отказано (${status}) поверхностью: ${body || "без тела"}`,
    notSubscribed: () => "Отказано (мост): канал идёт через диспетчер, а подписки на него сейчас нет — строка не ушла; старый адрес статуса мост зовёт только при откате на сокет",
    seatUnnamed: () => "Отказано (мост): подписка на канал жива, но место строки не названо — на канале несколько мест, а id своего мост не знает; строка не ушла",
    late: () => "предел вышел, пока строка ждала очереди"
  },
  en: {
    trimmedBy: (message) => `the server trimmed the line: ${message}`,
    trimmed: () => "the server trimmed the line; rename it shorter",
    noAnswer: (error) => `Refused (bridge): the status address did not answer — ${error}`,
    gone: (body) => `Refused (404) by the surface: ${body || "no body"} — this seat address no longer addresses: another holder's connect may have turned it, or another instance of the same session's bridge may have held it. Whose it is now, the bridge cannot know from here.`,
    refused: (status, body) => `Refused (${status}) by the surface: ${body || "no body"}`,
    notSubscribed: () => "Refused (bridge): the channel goes through the dispatcher and no subscription carries it now — the line did not go; the old status address is called only after falling back to a socket",
    seatUnnamed: () => "Refused (bridge): the channel's subscription lives, but the line names no seat — the channel carries several and the bridge does not know its own id; the line did not go",
    late: () => "its limit passed in the turn"
  }
};

// js/delivery/words/turn.ts
var TURN = {
  ru: {
    wake: () => `${FRAME_MARK} человека в консоли нет: ход и исход — ${tool("case")} line по ключу; say с to — за ответом или действием; человеку ask или ответ на его вопрос. Нечего передать — ход кончен, без текста.`,
    notLaid: (session, why) => `слово конца хода в сессию ${session} не легло: ${why}`
  },
  en: {
    wake: () => `${FRAME_MARK} no human at the console: progress and outcome — ${tool("case")} line by key; say with to for a reply or action; to the human — ask or answer their question. Nothing to pass on — the turn is over, no text needed.`,
    notLaid: (session, why) => `the turn's end word did not enter session ${session}: ${why}`
  }
};

// js/delivery/words/watchdog.ts
var ruFrames = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const form = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
  return `${n} ${["кадр", "кадра", "кадров"][form]}`;
};
var WATCHDOG = {
  ru: {
    doer: (text3) => `ДЕЛАТЕЛЬ: ${text3}`,
    listening: (key, tail2 = "") => `слушаю стояние ${key}${tail2}`,
    listeningCodex: (key, thread) => `слушаю стояние ${key}; кадры кладу в тред ${thread}`,
    backfilled: (count) => ` (${count} задним числом)`,
    frames: ruFrames,
    noHeld: () => "мост без места: iskron_stand(realm, karta, model); команда слушания — в ответе",
    severalHeld: (held) => `мост держит несколько стояний — назови нужное: ${held}`,
    bridgeLetGo: () => "мост отпустил стояние или ушёл — сессия кончилась?",
    seatNotBack: (s, path) => `место не вернулось за ${s}s после смены демона — сокет ${path} не поднят; вернуть — iskron_stand`,
    noSocket: (path, s) => `мост не поднял локальный сокет ${path} за ${s}s`,
    bridgeReleasedSocket: (text3) => `мост отпустил сокет: ${text3}`,
    notWakeup: (type) => `кадр ${type ?? "не разобран"} — не повод будить`,
    seenEarlier: (id) => `кадр ${id} уже отдан прежним взводом — не повод будить`,
    unaddressed: () => "пачка без адресованных месту — счёт ждёт ближайшей побудки",
    seatLost: () => "ДЕЛАТЕЛЬ: стояние потеряно",
    aliveNote: () => "ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает — мост держит место",
    codexLost: () => "Искрон: стояние потеряно — назовись заново: iskron_stand",
    codexAlive: () => "Искрон: сокет рвут, а служба отвечает — мост держит место",
    noThread: () => "ДЕЛАТЕЛЬ: нет CODEX_THREAD_ID — запускай сторожа из оболочки сессии Codex",
    noDoor: (path) => `ДЕЛАТЕЛЬ: двери нет (${path}). Скажи человеку: ход ЧЕЛОВЕКА — запустить демон app-server и сессию с одним коротким CODEX_HOME (SETUP, Codex). Пока слушай watchdog-exit`,
    threadRefused: (why) => `ДЕЛАТЕЛЬ: тред не принял кадр — ${why}`,
    refusal: () => "отказ",
    framePut: (thread) => `кадр вложен в тред ${thread}`,
    frameSent: (thread) => `кадр отправлен в тред ${thread}`,
    flushNotPut: (s) => `ДЕЛАТЕЛЬ: не дождался вложения за ${s}s после своего отпускания — пачка в тред не отправлена`,
    frameNotPut: (why) => `ДЕЛАТЕЛЬ: кадр не вложился — ${why}`,
    doorClosed: (why, lost) => `дверь закрылась: ${why} — открою заново на следующем кадре` + (lost ? `; без ответа: ${lost} — вернутся из кольца следующим взводом` : ""),
    doorNotOpened: (why) => `дверь не открылась: ${why}`,
    noIdFromRing: () => "кадр без id из кольца — пометить нечем, в тред не кладу повторно",
    alreadyPut: (id) => `кадр ${id} уже вложен — в тред не кладу повторно`
  },
  en: {
    doer: (text3) => `DOER: ${text3}`,
    listening: (key, tail2 = "") => `listening on standing ${key}${tail2}`,
    listeningCodex: (key, thread) => `listening on standing ${key}; putting frames into thread ${thread}`,
    backfilled: (count) => ` (${count} back-dated)`,
    frames: (n) => `${n} ${n === 1 ? "frame" : "frames"}`,
    noHeld: () => "the bridge holds no standing — name yourself with one call to iskron_stand(realm, karta, model): its answer names the listening command",
    severalHeld: (held) => `the bridge holds several standings — name the one you need: ${held}`,
    bridgeLetGo: () => "the bridge released the standing or went away — did the session end?",
    seatNotBack: (s, path) => `the seat did not return within ${s}s after the daemon change — socket ${path} is not up; to bring it back use iskron_stand`,
    noSocket: (path, s) => `the bridge did not bring up the local socket ${path} within ${s}s`,
    bridgeReleasedSocket: (text3) => `the bridge released the socket: ${text3}`,
    notWakeup: (type) => `frame ${type ?? "unparsed"} — not a reason to wake`,
    seenEarlier: (id) => `frame ${id} was already delivered by an earlier arming — not a reason to wake`,
    unaddressed: () => "a batch with nothing addressed to the seat — the count waits for the next wake-up",
    seatLost: () => "DOER: the standing is lost",
    aliveNote: () => "DOER: the socket keeps being cut while the service answers — the bridge holds the seat",
    codexLost: () => "Iskron: the standing is lost — name yourself again: iskron_stand",
    codexAlive: () => "Iskron: the socket keeps being cut while the service answers — the bridge holds the seat",
    noThread: () => "DOER: no CODEX_THREAD_ID — run this watchdog from the Codex session shell: that is where Codex puts the thread id into the environment",
    noDoor: (path) => `DOER: no door (${path}) — this thread is not under an app-server daemon. This is the HUMAN's move before the session starts, not yours: the daemon and the Codex session must start with one short CODEX_HOME (recipe in SETUP, section Codex). Tell them so; until there is a door, listen with watchdog-exit`,
    threadRefused: (why) => `DOER: the thread did not accept the frame — ${why}`,
    refusal: () => "refusal",
    framePut: (thread) => `frame put into thread ${thread}`,
    frameSent: (thread) => `frame sent to thread ${thread}`,
    flushNotPut: (s) => `DOER: the put did not go through within ${s}s after one's own release — the batch was not sent to the thread`,
    frameNotPut: (why) => `DOER: the frame was not put in — ${why}`,
    doorClosed: (why, lost) => `the door closed: ${why} — will reopen on the next frame` + (lost ? `; unanswered: ${lost} — will come back from the ring on the next arming` : ""),
    doorNotOpened: (why) => `the door did not open: ${why}`,
    noIdFromRing: () => "a frame without an id from the ring — nothing to mark it with, not putting it into the thread again",
    alreadyPut: (id) => `frame ${id} was already put in — not putting it into the thread again`
  }
};

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
function buildOf(selfUrl) {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}

// js/shared/http.ts
var USER_AGENT = `${BRIDGE_NAME}/${VERSION}`;
function namedFetch(input, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  return fetch(input, { ...init, headers });
}

// js/shared/lang.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// js/shared/scope.ts
import { AsyncLocalStorage } from "node:async_hooks";
var als = new AsyncLocalStorage();
var PROCESS = {
  id: "process",
  origin: null,
  sessionKey: () => false,
  slots: /* @__PURE__ */ new Map(),
  log: null
};
var currentScope = () => als.getStore() ?? PROCESS;
function scoped(init) {
  const key = {};
  const own = () => {
    const slots = currentScope().slots;
    let v = slots.get(key);
    if (v === void 0) {
      v = init();
      slots.set(key, v);
    }
    return v;
  };
  return new Proxy({}, {
    get: (_, k) => {
      const t = own();
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
    set: (_, k, v) => Reflect.set(own(), k, v),
    has: (_, k) => Reflect.has(own(), k),
    deleteProperty: (_, k) => Reflect.deleteProperty(own(), k),
    ownKeys: () => Reflect.ownKeys(own()),
    getOwnPropertyDescriptor: (_, k) => {
      const d = Reflect.getOwnPropertyDescriptor(own(), k);
      if (d) d.configurable = true;
      return d;
    }
  });
}
function envOf(k) {
  const s = currentScope();
  if (s.origin && s.sessionKey(k)) return s.origin.env[k];
  return process.env[k];
}

// js/shared/standings.ts
import { createHash as createHash2 } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var defaultAuthDir = () => join(homedir(), HOME_DIR);
var authDirFromEnv = () => envOf(envName("BRIDGE_AUTH_DIR"))?.trim() || defaultAuthDir();
var standingsDirOf = (authDir) => join(authDir, "standings");
var hashOf = (key) => createHash2("sha256").update(key).digest("hex").slice(0, 16);
function socketPathOf(authDir, key) {
  if (process.platform === "win32") return `\\\\.\\pipe\\${RUNTIME_PREFIX}-${hashOf(key)}`;
  const near = join(standingsDirOf(authDir), `${hashOf(key)}.sock`);
  if (Buffer.byteLength(near) <= SOCKET_PATH_MAX) return near;
  return join(shortSocketDir(), `${hashOf(resolve(authDir) + "\0" + key)}.sock`);
}
var SOCKET_PATH_MAX = 103;
var shortSocketDir = () => join(
  "/tmp",
  `${RUNTIME_PREFIX}-${typeof process.getuid === "function" ? process.getuid() : "u"}`
);
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;
var holdFilePathOf = (authDir, key) => join(standingsDirOf(authDir), `${hashOf(key)}.hold`);
function seenFilePathOf(authDir, key, server = "") {
  if (!server) return join(standingsDirOf(authDir), `${hashOf(key)}.seen`);
  let origin2 = server;
  try {
    origin2 = new URL(server).origin;
  } catch {
  }
  return join(standingsDirOf(authDir), `${hashOf(key)}.${hashOf(origin2).slice(0, 8)}.seen`);
}

// js/shared/lang.ts
var isLang = (v) => LANGS.includes(v ?? "");
function forcedLang() {
  const v = envOf(envName("BRIDGE_LANG"))?.trim().toLowerCase();
  return isLang(v) ? v : null;
}
function resolve2() {
  const forced = forcedLang();
  if (forced) return forced;
  const fromEnv = envOf(envName("BRIDGE_URL"))?.trim();
  if (fromEnv) return langOfServer(fromEnv);
  try {
    const text3 = readFileSync2(join2(authDirFromEnv(), "server"), "utf8").trim();
    if (text3) return langOfServer(text3);
  } catch {
  }
  return DEFAULT_LANG;
}
var S = scoped(() => ({ current: null }));
var lang = () => S.current ??= resolve2();
var words = (dict) => dict[lang()];
var wordsIn = (dict, l) => dict[l ?? lang()];

// js/shared/channel.ts
var SILENT_FLOOR_MS = Number(process.env[envName("CHANNEL_SILENT_FLOOR_MS")]) || 6e4;
var FLAP_PAUSES_MS = (process.env[envName("CHANNEL_FLAP_MS")] || "5000,10000,20000,40000,60000").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
function classifyOrigin(frame, myKarta) {
  const p = frame.provenance ?? {};
  const noAuthor = p.via === "room" && p.from_karta_seq == null && !p.from_standing;
  if (p.via === "platform" || p.auth === "none" || p.auth === "platform" || noAuthor)
    return "platform";
  if (p.from_person === true || p.as_person === true) return "human";
  if (p.from_karta_seq != null && p.user_karta_seq != null && p.from_karta_seq === p.user_karta_seq)
    return "human";
  if (myKarta != null && p.from_karta_seq != null && String(p.from_karta_seq) === String(myKarta))
    return "sibling";
  return "peer";
}

// js/shared/room-fields.ts
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var str = (v) => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
var after = (key, prefix) => key.startsWith(prefix) ? key.slice(prefix.length) : key;
var need = (v) => str(v) || "?";
var opt = (sep2, v) => {
  const x = str(v);
  return x ? sep2 + x : "";
};
var pick = (dict, key) => Object.hasOwn(dict, key) ? dict[key] : void 0;
var mineOf = (frame) => [str(frame.to_standing_id), str(frame.to_standing)].filter(Boolean);
function myRole(frame, fields) {
  const ka = obj(fields.karta);
  const seq = str(ka.seq);
  if (!seq || seq !== str(frame.karta_seq)) return false;
  const theirs = str(ka.realm);
  const mine = str(frame.realm) || str(obj(frame.room).realm);
  return !theirs || !mine || theirs === mine;
}
function inviteMine(frame) {
  const fields = obj(obj(frame.line).fields);
  const target = after(str(obj(frame.line).key), "invite:");
  if (target && mineOf(frame).includes(target)) return true;
  const seat = Object.keys(obj(fields.standing)).length > 0 || !!str(fields.standing);
  const roleId = str(obj(fields.karta).id) || (seat ? "" : target);
  return (!target || target === roleId) && myRole(frame, fields);
}
function seatIs(frame, ...named2) {
  const myId = str(frame.to_standing_id);
  const myAddr = str(frame.to_standing);
  if (!myId && !myAddr) return null;
  const id = named2.map((v) => str(obj(v).id)).find(Boolean);
  if (id && myId) return id === myId;
  const addr = named2.map((v) => addresseeOf(v)?.addr.filter((a) => a !== str(obj(v).id))[0]).find(Boolean);
  if (addr) return addr === myAddr;
  return id ? false : null;
}
function addresseeOf(v) {
  if (typeof v === "string") return v ? { addr: [v], label: v } : null;
  const o = obj(v);
  const handle = str(o.handle).replace(/^@/, "");
  const standing = str(o.standing) || (handle ? `@${handle}${str(o.name) ? `:${str(o.name)}` : ""}` : str(o.name));
  const id = str(o.id);
  const label = standing || str(o.name) || id;
  const addr = [standing, id].filter(Boolean);
  return addr.length ? { addr, label } : null;
}

// js/shared/asks.ts
var ASK_KINDS = /* @__PURE__ */ new Set(["ask", "answer", "ack"]);
var INVITE_CAUSES = {
  ownerless: "inviteOwnerless",
  answer_waiting: "inviteAnswerWaiting"
};
var toOf = (fields) => obj(fields.to);
var byMe = (frame) => {
  const mine = mineOf(frame);
  const author = obj(obj(frame.line).author);
  return [str(author.id), str(author.standing)].some((a) => a && mine.includes(a));
};
var askFromPerson = (frame) => {
  const line = obj(frame.line);
  const kind2 = str(line.kind);
  const asking = ASK_KINDS.has(kind2) || kind2 === "progress" && !!str(obj(line.fields).withdraws);
  return asking && classifyOrigin(frame) === "human";
};
function askedMine(frame, fields) {
  if (byMe(frame)) return false;
  return seatIs(frame, toOf(fields).standing, frame.addressee) === true;
}
function addressedMine(frame) {
  if (frame.addressee_left === true) return false;
  return seatIs(frame, toOf(obj(obj(frame.line).fields)), frame.addressee) === true;
}
var quote = (s) => s ? words(CASE_LINE).quote(s) : "";
function formOf(fields) {
  const W3 = words(ASK);
  const form = str(fields.form);
  if (form === "yes_no") return W3.yesNo();
  if (form === "free") return W3.free();
  if (form !== "choice" || !Array.isArray(fields.options)) return "";
  const options = fields.options.map((o) => {
    const x = obj(o);
    const ctx = str(x.context);
    return `${str(x.id)} ${quote(str(x.label))}${ctx ? ` (${ctx})` : ""}`;
  }).join(", ");
  return W3.choice(need(options));
}
function askValues(kind2, line, fields) {
  if (kind2 !== "ask")
    return { reply: [str(fields.choice), quote(str(line.done))].filter(Boolean).join("; ") };
  const W3 = words(ASK);
  const to = toOf(fields);
  const k = obj(to.karta);
  const seat = addresseeOf(to.standing);
  const place = seat?.addr[0] ?? seat?.label ?? "";
  const rec4 = obj(fields.recommendation);
  return {
    to: str(k.name) || (str(k.seq) ? `#${str(k.seq)}` : ""),
    to_place: place ? W3.place(need(place)) : "",
    form: formOf(fields),
    advice: str(rec4.option) || str(rec4.why) ? W3.advice(need(str(rec4.option) || "—"), opt(" — ", rec4.why)) : ""
  };
}
function askText(kind2, cause, v) {
  const W3 = words(ASK);
  const invite = cause ? pick(INVITE_CAUSES, cause) : void 0;
  if (invite) return W3[invite](need(v.who), need(v.standing));
  if (kind2 === "progress" && str(v.withdraws))
    return W3.withdrawn(
      need(v.withdraws),
      need(v.key),
      need(v.done),
      need(v.verdict),
      need(v.author)
    );
  if (kind2 === "ask")
    return W3.ask(
      need(v.author),
      need(v.to),
      opt(" ", v.to_place),
      need(v.key),
      need(v.done),
      opt("; ", v.form),
      opt("; ", v.advice)
    );
  if (kind2 === "answer") return W3.answer(need(v.author), need(v.refers_to), need(v.reply));
  if (kind2 === "ack") return W3.ack(need(v.refers_to), opt(": ", v.reply), need(v.author));
  return void 0;
}

// js/shared/numbering.ts
var numberingOf = (frame) => frame.numbering === "case" ? "case" : "";
var numberedKey = (frame, key) => key && numberingOf(frame) ? `case:${key}` : key;

// js/shared/askmemory.ts
var baseOf = (frame) => numberedKey(
  frame,
  `${mineOf(frame)[0] ?? ""}|${str(obj(frame.room).id) || str(obj(frame.room).seq)}|${str(obj(frame.line).key)}`
);
var lineOf = (frame) => obj(frame.line);
var kindOf = (frame) => str(lineOf(frame).kind);
var numOf = (frame) => str(lineOf(frame).entry_id ?? frame.entry_id);
function openOn(store, frame) {
  const base = `${baseOf(frame)}#`;
  const out2 = [];
  for (const s of store.keys())
    if (s.startsWith(base) && !store.has(`off:${s}`)) out2.push(s.slice(base.length));
  return out2;
}
var namedOf = (frame) => {
  const kind2 = kindOf(frame);
  if (kind2 === "progress") return str(obj(lineOf(frame).fields).withdraws);
  if (kind2 === "answer") return str(lineOf(frame).refers_to) || str(frame.in_reply_to);
  return "";
};
var isOpen = (store, frame, n) => {
  const k = `${baseOf(frame)}#${n}`;
  return !!n && store.has(k) && !store.has(`off:${k}`);
};
function closesMine(store, frame) {
  if (byMe(frame) || !str(lineOf(frame).key)) return "";
  const kind2 = kindOf(frame);
  if (kind2 === "progress" || kind2 === "answer") {
    const n = namedOf(frame);
    return isOpen(store, frame, n) ? n : "";
  }
  if (kind2 !== "ask" || askedMine(frame, obj(lineOf(frame).fields))) return "";
  return openOn(store, frame).at(-1) ?? "";
}
function noteAsk(store, frame) {
  if (!str(lineOf(frame).key)) return;
  const kind2 = kindOf(frame);
  const fields = obj(lineOf(frame).fields);
  const base = `${baseOf(frame)}#`;
  if (kind2 === "ask" && askedMine(frame, fields)) {
    const own = numOf(frame);
    if (store.has(`${base}${own}`)) return;
    for (const n of openOn(store, frame)) store.add(`off:${base}${n}`);
    store.add(`${base}${own}`);
    return;
  }
  if (kind2 === "progress" || kind2 === "answer" && !byMe(frame)) {
    const n = namedOf(frame);
    if (isOpen(store, frame, n)) store.add(`off:${base}${n}`);
  } else if ((kind2 === "ack" || kind2 === "ask") && !byMe(frame))
    for (const n of openOn(store, frame)) store.add(`off:${base}${n}`);
}
var ASKS_KEPT = 512;
var kept = /* @__PURE__ */ new Set();
var processAsks = {
  has: (s) => kept.has(s),
  add: (s) => {
    kept.add(s);
    for (const old of kept) {
      if (kept.size <= ASKS_KEPT) break;
      kept.delete(old);
    }
  },
  keys: () => kept
};

// js/shared/room-kinds.ts
var wordSeats = (f) => [
  obj(obj(f.line).fields).to,
  obj(obj(obj(f.word).line).fields).to,
  f.addressee,
  obj(f.word).addressee
];
var NODE_OPS = {
  updated: "nodeUpdated",
  deleted: "nodeDeleted",
  undeleted: "nodeUndeleted"
};
var RULES = {
  said: "stack",
  body: "stack",
  closing: "interrupt",
  closed: "interrupt",
  objection: "interrupt",
  late_objection: "interrupt",
  invite: "mine",
  // Only the answer to the waiting seat interrupts (graph @nks/nks-dev, nodes #6655, #6868).
  ask: "batch",
  answer: "addressed",
  // An answer taken back (api, #7472): in_reply_to names the answer; it wakes the one it was given to.
  retract: "addressed",
  ack: "batch",
  progress: "batch",
  opened: "batch",
  joined: "batch",
  left: "batch",
  withdraw: "batch",
  node: "batch",
  link: "batch",
  // (graph @nks/nks-dev, node #4925)
  auto: "batch"
};
function authorOf(author) {
  const a = obj(author);
  const name = str(a.name);
  const standing = str(a.standing);
  if (standing) return standing;
  if (name) return name;
  return a.kind === "platform" ? words(CASE_LINE).platform() : "?";
}
function roomOf(v) {
  const r = obj(v);
  return str(r.seq) || str(r.id) || str(v);
}
function whoOf(fields) {
  const st = obj(fields.standing);
  const ka = obj(fields.karta);
  return str(st.standing) || str(st.name) || str(ka.name);
}
function kindText(kind2, v, f, pending, aborted) {
  const W3 = words(ROOM);
  const n = (k) => need(v[k]);
  const lapsed = obj(obj(f.line).author).kind === "platform";
  if (pending) return W3.saidPending(n("author"));
  if (aborted) return lapsed ? W3.bodyLapsed(n("refers_to")) : W3.bodyAborted(n("refers_to"));
  if (kind2 === "auto")
    return pick(words(ROOM_AUTO), str(v.code))?.(n("room")) ?? W3.auto(n("code"), n("room"));
  const ask = askText(kind2, str(v.cause), v);
  if (ask !== void 0) return ask;
  const reasoning = opt("; ", v.reasoning);
  const op = kind2 === "node" ? pick(NODE_OPS, str(v.op)) : void 0;
  if (op) return W3[op](n("seq"), n("name"), reasoning);
  switch (kind2) {
    case "said":
      return W3.said(n("author"));
    case "body":
      return W3.body(n("refers_to"), n("author"));
    case "closing":
      return W3.closing(n("author"), n("ends_at"), str(v.evidence));
    case "closed":
      return W3.closed(n("reason"));
    case "objection":
      return W3.objection(n("author"), n("reason"));
    case "late_objection":
      return W3.lateObjection(n("author"));
    case "progress":
      return W3.progress(n("key"), n("done"), n("verdict"), opt(" — ", v.note), n("author"));
    case "opened":
      return W3.opened(n("author"));
    case "joined":
      return W3.joined(n("who"));
    case "left":
      return W3.left(n("who"), str(v.reason));
    case "invite":
      return W3.invite(n("author"), n("who"));
    case "withdraw":
      return W3.withdraw(n("author"));
    case "retract":
      return W3.retract(n("author"), n("refers_to"), v.after_ack === true);
    case "node":
      return W3.node(n("seq"), n("name"), n("realm"), reasoning);
    case "link":
      return W3.link(n("room"), n("rel"));
    default:
      return "";
  }
}
function roomKind(frame) {
  if (!frame || typeof frame !== "object") return null;
  const f = frame;
  const ek = f.event_kind;
  if (typeof ek !== "string" || !ek.startsWith("room.")) return null;
  const kind2 = ek.slice(5);
  const line = obj(f.line);
  const fields = obj(line.fields);
  const key = str(line.key);
  const node = obj(fields.node);
  const cause = kind2 === "invite" ? str(fields.cause) : "";
  const authorName = authorOf(
    kind2 === "body" && Object.keys(obj(f.in_reply_to_from)).length ? f.in_reply_to_from : line.author
  );
  const byWhom = (frame.origin ?? classifyOrigin(frame)) === "human" ? `${authorName} (${words(ROOM).whoHuman("")})` : authorName;
  const values = {
    kind: kind2,
    cause,
    author: byWhom,
    key,
    done: line.done,
    verdict: pick(words(VERDICT), str(line.verdict))?.() ?? line.verdict,
    note: line.note,
    ends_at: fields.ends_at,
    evidence: Array.isArray(fields.evidence) ? fields.evidence.map(str).join(", ") : "",
    entry_id: line.entry_id ?? f.entry_id,
    refers_to: str(line.refers_to) || str(f.in_reply_to) || str(obj(f.word).entry_id),
    reason: fields.reason,
    target: after(key, "invite:"),
    // Observed live: the invite key carries the id, the invitee's name is in the line fields (standing/karta with name).
    // Joined and left — fields.standing (a timed-out leave is written by the platform, api 0.89.6), else the author;
    // a role call by cause — fields.karta (graph @nks/nks-dev, node #6870).
    who: kind2 === "joined" || kind2 === "left" ? whoOf({ standing: fields.standing }) || byWhom : (cause ? whoOf({ karta: fields.karta }) : whoOf(fields)) || after(key, "invite:"),
    standing: str(fields.gone_standing) || addresseeOf(fields.gone_standing)?.label,
    ...ASK_KINDS.has(kind2) ? askValues(kind2, line, fields) : {},
    room: roomOf(fields.room) || after(key, "link:"),
    rel: pick(words(ROOM_REL), str(fields.rel))?.() ?? fields.rel,
    code: fields.code,
    op: fields.op,
    seq: node.seq,
    name: node.name,
    realm: node.realm,
    // A node delta's reasoning is the record's body, not a field (graph @nks/nks-dev, node #6070).
    reasoning: kind2 === "node" ? line.done || f.body : void 0,
    withdraws: fields.withdraws,
    // Observed on the wire (#5893 §4.2, case №1010 [8]): line.fields.after_ack.
    after_ack: fields.after_ack === true
  };
  const W3 = words(ROOM);
  const rule = RULES[kind2];
  const author = str(values.author);
  if (!rule)
    return {
      kind: kind2,
      rule: "batch",
      words: W3.unknown(need(kind2)),
      author,
      phase: null,
      known: false
    };
  const word2 = kind2 === "said" || kind2 === "body";
  const withheld = word2 && f.body_withheld === true;
  const named2 = word2 ? wordSeats(f) : [];
  const to = word2 ? named2.map(addresseeOf).find(Boolean) ?? (withheld ? { addr: ["?"], label: "?" } : null) : null;
  if (to && (withheld || seatIs(f, ...named2) === false)) {
    const counts = kind2 === "said";
    const pair = JSON.stringify([roomOf(f.room), authorName, to.addr[0]]);
    const id = need(counts ? values.entry_id : values.refers_to);
    const by = need(values.author);
    const addressee = need(to.label);
    const run = (n) => n === 0 ? W3.asideBody(by, addressee, id) : n > 1 ? W3.asideRun(by, addressee, W3.messages(n), id) : W3.aside(by, addressee, id);
    const aside = { pair, counts, run };
    const words3 = run(counts ? 1 : 0);
    return { kind: kind2, rule: "batch", words: words3, author, phase: null, known: true, aside };
  }
  const pending = kind2 === "said" && f.body_pending === true && !str(f.body) && !str(line.done);
  const aborted = kind2 === "body" && fields.aborted === true;
  let text3 = kindText(kind2, values, f, pending, aborted);
  if (kind2 === "closing") {
    const may = Array.isArray(fields.may_object) ? fields.may_object.map((m) => typeof m === "string" ? m : str(obj(m).id)) : [];
    const myId = str(f.to_standing_id);
    const mayI = !!myId && may.includes(myId);
    text3 += "; " + (mayI ? W3.closingMay(need(values.entry_id)) : W3.closingNot());
  }
  const stack = rule === "stack" ? f.stack === "defer" ? "batch" : "interrupt" : rule === "mine" ? inviteMine(f) ? "interrupt" : "batch" : rule === "addressed" ? addressedMine(f) ? "interrupt" : "batch" : rule;
  const phase = pending ? "pending" : aborted ? "aborted" : null;
  const bodyInWords = !!str(line.done) && (ASK_KINDS.has(kind2) || kind2 === "progress" || kind2 === "node");
  return {
    kind: kind2,
    rule: phase ? "batch" : stack,
    words: text3,
    author,
    bodyInWords,
    phase,
    known: true
  };
}
var byKind = (frame) => roomKind(frame) !== null;

// js/shared/seats.ts
function seatsOf(f, kind2) {
  const to = obj(obj(obj(f.line).fields).to);
  if (kind2 === "said" || kind2 === "body") return wordSeats(f);
  return [
    kind2 === "ask" ? to.standing : ASK_KINDS.has(kind2) || kind2 === "retract" ? to : null,
    f.addressee
  ];
}
function seatOf(frame, kind2) {
  const f = frame;
  if (kind2 === "ask" && byMe(f)) return false;
  return seatIs(f, ...seatsOf(f, kind2));
}
var named = (v) => typeof v === "string" ? !!v : Object.keys(obj(v)).length > 0;
function namesAddress(f, kind2) {
  const fields = obj(obj(f.line).fields);
  const to = kind2 === "ask" ? obj(fields.to).standing : fields.to;
  if (named(to) || named(f.addressee)) return true;
  return (kind2 === "invite" || kind2 === "withdraw") && (named(fields.standing) || named(fields.karta));
}

// js/shared/addressed.ts
var LOUD_KINDS = /* @__PURE__ */ new Set(["closing", "closed", "objection", "late_objection"]);
var addressedWords = /* @__PURE__ */ new Set();
var WORDS_KEPT = 512;
function wordKeyOf(frame) {
  const f = frame;
  const line = obj(f.line);
  const entry = roomKind(frame)?.kind === "body" ? str(line.refers_to) || str(f.in_reply_to) || str(obj(f.word).entry_id) : str(line.entry_id ?? f.entry_id);
  return numberedKey(
    frame,
    `${mineOf(f)[0] ?? ""}|${str(obj(f.room).id) || str(obj(f.room).seq)}|${entry}`
  );
}
var asideKeyOf = (frame) => `aside:${wordKeyOf(frame)}`;
function rememberWord(key) {
  addressedWords.add(key);
  for (const old of addressedWords) {
    if (addressedWords.size <= WORDS_KEPT) break;
    addressedWords.delete(old);
  }
}
var ASK_CLOSERS = /* @__PURE__ */ new Set(["ask", "answer", "ack", "progress"]);
var askDecided = /* @__PURE__ */ new Map();
function askMemory(f) {
  if (f.asks_decided === true) return "";
  const id = str(f.id) || wordKeyOf(f);
  const was = askDecided.get(id);
  if (was !== void 0) return was;
  const hit = closesMine(processAsks, f);
  noteAsk(processAsks, f);
  askDecided.set(id, hit);
  for (const old of askDecided.keys()) {
    if (askDecided.size <= WORDS_KEPT) break;
    askDecided.delete(old);
  }
  return hit;
}
function addressedToMine(frame) {
  if (!frame) return false;
  const f = frame;
  const room = obj(f.room);
  if (!str(room.seq) && !str(room.id)) return true;
  if (!byKind(frame)) return true;
  const line = obj(f.line);
  const fields = obj(line.fields);
  const rk = roomKind(frame);
  if (rk?.aside) {
    if (f.body_pending === true) rememberWord(asideKeyOf(frame));
    return false;
  }
  const closed = rk && ASK_CLOSERS.has(rk.kind) ? askMemory(f) : "";
  const seat = rk ? seatOf(frame, rk.kind) : null;
  if (rk?.kind === "body") {
    const word2 = obj(f.word);
    if (f.addressed === false || addressedWords.has(asideKeyOf(frame))) return false;
    if (f.addressed === true || seat === true || seat === null && str(obj(obj(word2.line).fields).kind) === "important" || addressedWords.has(wordKeyOf(frame)))
      return true;
  } else if (
    // A word to me, a reply to my record without an address of its own (#5954, #6574),
    // marked important; a word in flight is remembered, since its body comes as a second
    // phase without these marks.
    seat === true || seat === null && (seatIs(f, f.in_reply_to_from) === true && !namesAddress(f, rk?.kind ?? "") || str(f.said) === "important" || str(fields.kind) === "important")
  ) {
    if (rk?.phase === "pending") rememberWord(wordKeyOf(frame));
    return true;
  }
  if (rk?.kind === "ask" && askedMine(f, fields)) return true;
  if (closed && rk?.kind === "progress") return true;
  if (closed) f.closes_mine = closed;
  if (rk && ASK_CLOSERS.has(rk.kind) && f.addressed === true) return true;
  if (rk?.kind === "invite" || rk?.kind === "withdraw") return inviteMine(f);
  if (rk && LOUD_KINDS.has(rk.kind)) return true;
  if (rk && (ASK_KINDS.has(rk.kind) || rk.kind === "retract") || askFromPerson(f)) return false;
  return (frame.origin ?? classifyOrigin(frame, str(f.karta_seq) || void 0)) === "human";
}
function closedQuestion(frame) {
  return addressedToMine(frame) ? "" : frame.closes_mine ?? "";
}

// js/shared/clock-notices.ts
var rec = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var text = (v) => typeof v === "string" && v.length > 0 && v.length <= 256 && [...v].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) ? v : null;
var number = (v) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
var bool = (v) => typeof v === "boolean" ? v : null;
var timestamp = (v) => {
  const s = text(v);
  return s && /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
    s
  ) && Number.isFinite(Date.parse(s)) && (/* @__PURE__ */ new Date(`${s.slice(0, 10)}T00:00:00Z`)).toISOString().slice(0, 10) === s.slice(0, 10) ? s : null;
};
function kind(frame) {
  const p = frame.provenance;
  return frame.type === "message" && p?.via === "platform" && p.auth === "none" && (p.notice === "card_unanswered" || p.notice === "line_due") ? p.notice : null;
}
function dataOf(frame, notice) {
  const d = rec(frame.provenance?.notice_data);
  const r = rec(d.room);
  const who = rec(notice === "card_unanswered" ? d.to : d.holder);
  const seat = {
    standing_id: text(who.standing_id),
    standing: text(who.standing),
    karta_seq: number(who.karta_seq)
  };
  return {
    room: { id: text(r.id), number: number(r.number), realm: text(r.realm) },
    entry_id: number(d.entry_id),
    key: text(d.key),
    ...notice === "card_unanswered" ? {
      to: seat,
      listening: bool(d.listening),
      last_act_at: timestamp(d.last_act_at),
      role_called: bool(d.role_called)
    } : { holder: seat, due_at: timestamp(d.due_at), escalated: bool(d.escalated) }
  };
}
function clockNoticeText(frame) {
  const notice = kind(frame);
  if (!notice) return "";
  const d = dataOf(frame, notice);
  const seat = "to" in d ? d.to : d.holder;
  return words(FRAME_TEXT).clockNotice(notice, {
    room: d.room.number,
    roomId: d.room.id,
    realm: d.room.realm,
    entry: d.entry_id,
    key: d.key,
    standing: seat?.standing ?? null,
    standingId: seat?.standing_id ?? null,
    karta: seat?.karta_seq ?? null,
    listening: "listening" in d ? d.listening : null,
    lastAct: "last_act_at" in d ? d.last_act_at : null,
    roleCalled: "role_called" in d ? d.role_called : null,
    due: "due_at" in d ? d.due_at : null,
    escalated: "escalated" in d ? d.escalated : null
  });
}

// js/shared/frame-format.ts
var COMPACT_COUNTS_CAPABILITY = "compact-counts";
var COMPACT_COUNTS = { [COMPACT_COUNTS_CAPABILITY]: { version: 1 } };
var format = scoped(() => ({ compact: true }));
var compactCounts = () => format.compact;

// js/shared/keyfold.ts
var rec2 = (v) => v && typeof v === "object" ? v : {};
var idOf = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
function superseded(frames) {
  const last = /* @__PURE__ */ new Map();
  const out2 = /* @__PURE__ */ new Set();
  frames.forEach((f, i) => {
    const r = f;
    const line = rec2(r.line);
    const key = typeof line.key === "string" ? line.key : "";
    if (line.kind !== "progress" || !key || line.verdict === "bad" || addressedToMine(f)) return;
    const k = `${idOf(rec2(r.room).id) || idOf(rec2(r.room).seq)}|${key}`;
    const e = Number(r.entry_id ?? line.entry_id);
    const at2 = Number.isFinite(e) ? e : i;
    const was = last.get(k);
    if (!was) return void last.set(k, { frame: f, at: at2 });
    if (at2 >= was.at) {
      out2.add(was.frame);
      last.set(k, { frame: f, at: at2 });
    } else out2.add(f);
  });
  return out2;
}

// js/shared/open-cards.ts
var repeatNumber = (n) => typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
var cardRepeatText = (frame) => {
  if (frame.repeat !== true) return "";
  return words(FRAME_TEXT).cardRepeat(repeatNumber(frame.repeat_n));
};
function openCards(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { count, oldest_at: at2 } = value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return null;
  if (count === 0) return at2 === null ? { count, oldest_at: null } : null;
  if (typeof at2 !== "string" || at2.length > 64 || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
    at2
  ) || !Number.isFinite(Date.parse(at2)) || (/* @__PURE__ */ new Date(`${at2.slice(0, 10)}T00:00:00Z`)).toISOString().slice(0, 10) !== at2.slice(0, 10))
    return null;
  return { count, oldest_at: at2 };
}
var openCardsText = (frame) => {
  const value = frame.my_open_cards;
  const cards = openCards(value);
  return words(FRAME_TEXT).openCards(
    cards?.count ?? null,
    cards?.oldest_at ?? null,
    value !== void 0 && cards === null
  );
};
var cardsIn = (frames) => frames.length ? openCardsText(frames[frames.length - 1]) : "";

// js/shared/seen.ts
import { appendFileSync, readFileSync as readFileSync3, renameSync, writeFileSync } from "node:fs";

// js/shared/graph-inbox.ts
function graphInboxKey(frame) {
  if (frame?.type !== "message" || frame.provenance?.via !== "graph") return null;
  const b = frame.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const body = b;
  if (typeof body.realm_slug !== "string" || !body.realm_slug || typeof body.vimarsha_seq !== "number" || !Number.isInteger(body.vimarsha_seq) || body.vimarsha_seq <= 0 || !["posed_to", "updated", "vimarsha.updated"].includes(String(body.event_kind)))
    return null;
  return JSON.stringify([body.realm_slug, body.vimarsha_seq]);
}
var isGraphInbox = (frame) => graphInboxKey(frame) !== null;
var versionOf = (frame) => frame.body.vimarsha_version;
function graphFolds(frames) {
  const groups = /* @__PURE__ */ new Map();
  for (const frame of frames) {
    const key = graphInboxKey(frame);
    if (key === null) continue;
    const group = groups.get(key) ?? [];
    group.push(frame);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const latest = group.reduce((a, b) => {
      const av = versionOf(a);
      const bv = versionOf(b);
      return typeof av === "number" && typeof bv === "number" && av > bv ? a : b;
    });
    return { latest, superseded: group.filter((f) => f !== latest) };
  });
}

// js/shared/seen.ts
var SEEN_KEEP = 5e3;
var SEEN_SLACK = 1e3;
var graphMarks = /* @__PURE__ */ new WeakMap();
function carryGraphMarks(frame, keys) {
  if (!frame || !isGraphInbox(frame) || !keys?.length) return;
  const all = [.../* @__PURE__ */ new Set([...graphMarks.get(frame) ?? [], ...keys])];
  graphMarks.set(frame, all.slice(-SEEN_KEEP));
}
var evOf = (v) => typeof v === "number" || typeof v === "string" && v ? `ev:${v}` : "";
function eventKeyOf(frame) {
  const via = frame?.provenance?.via;
  if (via === "room") return evOf(frame?.event_id);
  if (via !== "graph") return "";
  const body = frame?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  return evOf(body.event_id);
}
var asText = (frame) => addressedToMine(frame);
function deliveryKeys(frame, named2 = false) {
  const id = typeof frame?.id === "string" ? frame.id : "";
  const ev = frame && asText(frame) ? eventKeyOf(frame) : "";
  const mark = ev && frame?.stale === true ? `evs:${ev.slice(3)}` : ev;
  const retired = (frame && !named2 && asText(frame) ? graphMarks.get(frame) ?? [] : []).map(
    (k) => frame?.stale === true && k.startsWith("ev:") ? `evs:${k.slice(3)}` : k
  );
  return [...new Set([...retired, id, mark && (named2 ? `c${mark}` : mark)].filter(Boolean))];
}
function eventIn(frame, has) {
  const ev = frame ? eventKeyOf(frame) : "";
  if (!ev || !frame) return false;
  const n = ev.slice(3);
  const stale = frame.stale === true;
  const keys = !asText(frame) ? [ev, `evs:${n}`] : stale ? [ev, `evs:${n}`, `cev:${n}`, `cevs:${n}`] : [ev, `cev:${n}`];
  return keys.some(has);
}
var isTact = (frame) => frame?.provenance?.wake === "look_up";
var isLifeCheck = (frame) => frame?.provenance?.wake === "life_check";
function foldedTacts(all) {
  const tacts = all.filter((f) => isTact(f));
  const last = tacts.reduce((a, f) => a && tactAt([a]) > tactAt([f]) ? a : f, null);
  return new Set(tacts.filter((f) => f !== last));
}
var tactAt = (frames) => (frames ?? []).filter(isTact).map((f) => typeof f.received_at === "string" ? f.received_at : "").reduce((a, b) => b > a ? b : a, "");
function splitBatch(all, keep, has) {
  const folded = foldedTacts(all);
  for (const { latest, superseded: superseded2 } of graphFolds(all)) {
    for (const frame of superseded2) {
      folded.add(frame);
      carryGraphMarks(latest, [...deliveryKeys(frame), eventKeyOf(frame)].filter(Boolean));
    }
  }
  let kept2 = all.filter((f) => !folded.has(f) && !eventIn(f, has));
  for (; ; ) {
    const shown = new Set(kept2.slice(0, keep));
    const marks = /* @__PURE__ */ new Set();
    const local = (k) => marks.has(k) || has(k);
    const texts = kept2.filter((f) => {
      if (!asText(f)) return true;
      if (eventIn(f, local)) return false;
      for (const k of deliveryKeys(f, !shown.has(f))) marks.add(k);
      return true;
    });
    const next = texts.filter((f) => asText(f) || !eventIn(f, local));
    if (next.length < kept2.length) {
      kept2 = next;
      continue;
    }
    const on = new Set(next.slice(0, keep));
    return {
      shown: next.slice(0, keep),
      kept: next,
      keys: all.flatMap((f) => deliveryKeys(f, !on.has(f)))
    };
  }
}
function seenIds(seenPath) {
  try {
    return new Set(readFileSync3(seenPath, "utf8").split("\n").filter(Boolean));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function noteSeen(seenPath, id, seen) {
  if (seen.has(id)) return;
  seen.add(id);
  try {
    appendFileSync(seenPath, id + "\n");
    if (seen.size > SEEN_KEEP + SEEN_SLACK) compact(seenPath, seen);
  } catch {
  }
}
function compact(seenPath, seen) {
  const file = [...seenIds(seenPath)];
  const inFile = new Set(file);
  const tail2 = [...[...seen].filter((x) => !inFile.has(x)), ...file].slice(-SEEN_KEEP);
  const tmp = `${seenPath}.${process.pid}.tmp`;
  writeFileSync(tmp, tail2.join("\n") + "\n");
  renameSync(tmp, seenPath);
  seen.clear();
  for (const x of tail2) seen.add(x);
}

// js/shared/frame-text.ts
var W = () => words(ROOM);
var T = () => words(FRAME_TEXT);
var CAPTION_REPLY = /* @__PURE__ */ new Set(["body", "answer", "ack", "retract"]);
var rec3 = (v) => v && typeof v === "object" ? v : {};
var idOf2 = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
var ZACHIN = 40;
function groupKey(f) {
  const c = caseOf(f);
  return c ? JSON.stringify([c.realm, c.room]) : idOf2(f.id) || "?";
}
function casesOf(frames) {
  const by = /* @__PURE__ */ new Map();
  for (const f of frames) {
    const key = groupKey(f);
    const got = by.get(key);
    if (got) got.push(f);
    else by.set(key, [f]);
  }
  return [...by.values()];
}
function caseOf(frame) {
  const f = frame;
  const room = rec3(f.room);
  const n = idOf2(room.seq) || idOf2(room.id);
  if (!n) return null;
  const z = typeof room.zachin === "string" ? [...room.zachin.trim()] : [];
  const zachin = z.length > ZACHIN ? z.slice(0, ZACHIN).join("") + "…" : z.join("");
  const realm = idOf2(room.realm) || idOf2(f.realm);
  return { room: n, zachin, realm };
}
function caseHead(frame, withZachin) {
  const c = caseOf(frame);
  if (!c) return "";
  const no = W().case(need(c.room));
  return withZachin && c.zachin ? `${no} «${c.zachin}»` : no;
}
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function userTag(user) {
  const u = typeof user === "string" ? user.trim().replace(/^@/, "") : "";
  if (!u) return "";
  return /^[\w.-]+$/.test(u) && !UUID.test(u) ? ` @${u}` : ` ${u}`;
}
function whoOf2(frame, withPlace) {
  const p = frame.provenance ?? {};
  const origin2 = frame.origin ?? classifyOrigin(frame);
  if (origin2 === "platform") return W().whoPlatform();
  if (p.via === "graph" && p.from_karta_seq == null && !p.from_standing) return W().whoGraph();
  const place = withPlace && p.from_standing ? ` (${p.from_standing})` : "";
  if (origin2 === "human") return W().whoHuman(userTag(p.user)) + place;
  const karta = p.from_karta_seq;
  if (karta == null) return p.from_standing ?? "";
  return (origin2 === "sibling" ? W().whoSibling : W().whoRole)(need(karta)) + place;
}
function textOf(frame) {
  const rk = roomKind(frame);
  if (rk?.aside || rk?.bodyInWords) return "";
  const b = frame.body;
  return typeof b === "string" ? b : b === void 0 ? "" : JSON.stringify(b);
}
function tail(frame, withReply) {
  const f = frame;
  const parts = [];
  const to = idOf2(f.in_reply_to) || idOf2(frame.provenance?.in_reply_to);
  if (withReply && to) parts.push(W().replyTo(need(to)));
  if (frame.stale === true) parts.push(W().stale());
  const repeat = cardRepeatText(frame);
  if (repeat) parts.push(repeat);
  if (typeof frame.body_read === "string" && frame.body_read !== "history")
    parts.push(W().bodyRead(need(frame.body_read)));
  return parts.length ? `, ${parts.join(", ")}` : "";
}
var markFrame = (text3) => `${FRAME_MARK} ${text3}`;
function humanWordReply(frame, origin2) {
  if (origin2 !== "human") return "";
  const f = frame;
  const p = rec3(frame.provenance);
  const karta = idOf2(p.from_karta_seq) || idOf2(p.user_karta_seq);
  const missing = {
    realm: !idOf2(f.realm),
    karta: !karta,
    standing: !idOf2(p.from_standing),
    id: !idOf2(frame.id)
  };
  return Object.values(missing).every((x) => !x) ? T().humanWordReply(need(f.realm), need(karta), need(p.from_standing), need(frame.id)) : T().noReplyAddress(missing);
}
function frameToText(frame, raw, withCase = true) {
  const text3 = frameText(frame, raw, withCase);
  if (!frame || !withCase) return text3;
  const cards = openCardsText(frame);
  return text3.split("\n").includes(cards) ? text3 : `${text3}
${cards}`;
}
function frameText(frame, raw, withCase) {
  if (!frame) return raw;
  const notice = clockNoticeText(frame);
  if (notice) return notice;
  const f = frame;
  const origin2 = frame.origin ?? classifyOrigin(frame);
  const text3 = textOf(frame);
  const c = caseOf(frame);
  if (c) {
    if (!addressedToMine(frame)) return caseCountLine([frame]);
    const rk = roomKind(frame);
    const line = rec3(f.line);
    const entry = idOf2(f.entry_id) || idOf2(line.entry_id);
    const words3 = rk ? rk.words : W().legacy(need(f.kind), typeof f.stack === "string" ? f.stack : "");
    const author = rk?.author && !words3.includes(rk.author) ? rk.author : "";
    const who = rk || origin2 === "platform" ? "" : whoOf2(frame, false);
    const by = [author, who].filter(Boolean).join(", ");
    const withReply = !rk || !CAPTION_REPLY.has(rk.kind);
    const label = [withCase ? caseHead(frame, true) : "", entry ? `[${entry}]` : ""];
    const head2 = `${[...label.filter(Boolean), words3].join(" ")}${by ? ` — ${by}` : ""}${tail(frame, withReply)}`;
    const lines2 = [head2];
    if (text3 && !words3.includes(text3.trim())) lines2.push(text3);
    return lines2.join("\n");
  }
  const lines = [`${whoOf2(frame, true) || "?"}${tail(frame, true)}`];
  if (text3) lines.push(text3);
  const reply = humanWordReply(frame, origin2);
  if (reply) lines.push(reply);
  if (isLifeCheck(frame)) lines.push(T().lifeCheckSeat(warnedSeat(frame)), T().lifeCheckReply());
  return lines.join("\n");
}
var warnedSeat = (frame) => typeof frame.to_standing === "string" ? frame.to_standing.replace(/^.*:/, "") : "";
var textShown = (frames, cap) => frames.filter((f) => addressedToMine(f)).map((f) => ({
  frame: f,
  text: (withCase) => {
    const t = [...frameText(f, JSON.stringify(f), withCase)];
    return t.length > cap ? t.slice(0, cap).join("") + "…" : t.join("");
  }
}));
function underCounts(counted, shown, incomplete = false, cardFrames = [
  ...counted,
  ...shown.map((s) => s.frame).filter((f) => !counted.includes(f))
]) {
  const lines = groupedCounts(counted, shown, incomplete);
  const cards = cardsIn(cardFrames);
  return cards && !lines.some((line) => line.split("\n").includes(cards)) ? [...lines, cards] : lines;
}
function groupedCounts(counted, shown, incomplete) {
  const groups = casesOf(counted).filter((group) => caseOf(group[0]));
  const placed = /* @__PURE__ */ new Set();
  const under = (group) => {
    const key = groupKey(group[0]);
    return shown.filter((s) => caseOf(s.frame) && groupKey(s.frame) === key).map((s) => (placed.add(s), s.text(false)));
  };
  const rest = () => shown.filter((s) => !placed.has(s)).map((s) => s.text(true));
  if (!groups.length) return rest();
  if (!compactCounts())
    return [...groups.flatMap((g) => [legacyCountLine(g, incomplete), ...under(g)]), ...rest()];
  if (groups.length === 1 && !incomplete)
    return [caseCountLine(groups[0]), ...under(groups[0]), ...rest()];
  const pointer = incomplete ? T().inFull("") : batchPointer(groups.flat());
  if (groups.length === 1)
    return [`${countText(groups[0], true)}; ${pointer}.`, ...under(groups[0]), ...rest()];
  return [...groups.flatMap((g) => [countText(g, true), ...under(g)]), `${pointer}.`, ...rest()];
}
function closingOf(frame) {
  const n = closedQuestion(frame);
  if (!n) return "";
  const rk = roomKind(frame);
  const to = rec3(rec3(rec3(rec3(frame).line).fields).to);
  if (rk?.kind !== "ask") return T().askAnswered(n, need(rk?.author));
  const seat = addresseeOf(to.standing)?.label || idOf2(rec3(to.karta).name);
  return T().askMoved(n, need(seat));
}
function caseCountLine(frames) {
  const count = countText(frames, false);
  if (!compactCounts()) return legacyCountLine(frames, false);
  return count ? `${count}; ${batchPointer(frames)}.` : "";
}
function legacyCountLine(frames, incomplete) {
  const count = countText(frames, false);
  if (!count) return "";
  const yours = frames.some((f) => addressedToMine(f)) ? "; " : T().noneYours();
  return count + yours + (incomplete ? T().inFull("") : batchPointer(frames)) + ".";
}
function countText(frames, withCursor) {
  const c = frames.length ? caseOf(frames[0]) : null;
  if (!c) return "";
  const mineN = frames.filter((f) => addressedToMine(f)).length;
  const gone = superseded(frames).size;
  const head2 = caseHead(frames[0], true);
  const cursor = withCursor ? cursorOf(frames) : null;
  const n = frames.length - gone;
  return T().count(head2, n, mineN) + (gone ? T().supersededLines(gone) : "") + frames.map(closingOf).join("") + (cursor ? ` · realm=${JSON.stringify(cursor.realm)}, since=${cursor.since}` : "");
}
function cursorOf(frames) {
  const first = frames[0];
  const c = first && caseOf(first);
  if (!c?.realm) return null;
  const room = rec3(first.room);
  const entries = frames.map((f) => idOf2(f.entry_id ?? rec3(f.line).entry_id));
  if (entries.some((e) => !e || !Number.isSafeInteger(Number(e)) || Number(e) < 1)) return null;
  return {
    realm: c.realm,
    room: JSON.stringify(room.seq ?? room.id),
    since: Math.min(...entries.map(Number)) - 1
  };
}
function batchPointer(frames) {
  const cursors = casesOf(frames).map(cursorOf);
  const c = cursors[0];
  if (!c || cursors.some((cursor) => !cursor)) return T().inFull("");
  if (cursors.length > 1)
    return T().inFull(T().caseHistory('realm=R, action="history", room=N', "S"));
  return T().inFull(
    T().caseHistory(`realm=${JSON.stringify(c.realm)}, action="history", room=${c.room}`, c.since)
  );
}

// js/shared/ritualcover.ts
import { readdirSync, readFileSync as readFileSync6 } from "node:fs";
import { join as join5 } from "node:path";

// js/shared/cover.ts
import { readFileSync as readFileSync4 } from "node:fs";
import { join as join3 } from "node:path";

// js/shared/coverblock.ts
var unquote = (v) => {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'"))
    return t.slice(1, -1).replace(/''/g, "'");
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
};
var KEY = String.raw`('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^\s'"#][^:]*?)`;
var PAIR = new RegExp(String.raw`^\s*${KEY}\s*:(?:\s+(.*))?$`);
var TOP = new RegExp(String.raw`^${KEY}\s*:(?:\s+#.*)?\s*$`);
var CHILD = new RegExp(String.raw`^\s+${KEY}\s*:(?:\s+(.*))?$`);
var bare = (v) => unquote(
  /^['"]/.test(v.trim()) ? v.trim().replace(/^('(?:[^']|'')*'|"(?:[^"\\]|\\.)*")\s+#.*$/, "$1") : v.replace(/\s+#.*$/, "")
);
function fences(text3) {
  const lines = text3.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end < 0 ? null : { lines, end };
}
function frontMatter(text3) {
  const f = fences(text3);
  if (!f) return null;
  const raw = /* @__PURE__ */ new Map();
  let last = null;
  for (const line of f.lines.slice(1, f.end)) {
    const kv = PAIR.exec(line);
    if (kv) raw.set(last = unquote(kv[1]), kv[2] ?? "");
    else if (last !== null && /^\s+[^\s#]/.test(line))
      raw.set(last, `${raw.get(last)}
${line.trim()}`);
  }
  return new Map([...raw].map(([k, v]) => [k, unquote(v)]));
}
function coverBlocks(text3) {
  const blocks = /* @__PURE__ */ new Map();
  const f = fences(text3);
  let open = null;
  for (const line of f ? f.lines.slice(1, f.end) : []) {
    if (/^\s*(#|$)/.test(line)) continue;
    const top = TOP.exec(line);
    const child = open && CHILD.exec(line);
    if (top) blocks.set(unquote(top[1]), open = /* @__PURE__ */ new Map());
    else if (open && child) open.set(unquote(child[1]), bare(child[2] ?? ""));
    else open = null;
  }
  return blocks;
}
function repeatedKeys(text3) {
  const f = fences(text3);
  const [seen, twice] = [/* @__PURE__ */ new Set(), /* @__PURE__ */ new Set()];
  let block = null;
  for (const line of f ? f.lines.slice(1, f.end) : []) {
    const kv = PAIR.exec(line);
    const at2 = line.search(/\S/);
    if (!kv || line[at2] === "-") continue;
    const name = unquote(kv[1]);
    if (at2 === 0) block = TOP.test(line) ? { root: name, at: -1 } : null;
    else if (!block || block.at >= 0 && block.at !== at2) continue;
    else block.at = at2;
    const key = at2 === 0 ? name : `${block?.root}.${name}`;
    (seen.has(key) ? twice : seen).add(key);
  }
  return [...twice];
}
var coverBlock = (text3, root) => coverBlocks(text3).get(root) ?? null;
var stamped = (block) => /^\d+$/.test(block.get("contract") ?? "") && !!block.get("stamp");
var foreignBlock = (text3, root) => [...coverBlocks(text3)].some(([k, b]) => k !== root && b.has("contract"));
var RITUALS2 = ["start", "push", "merge", "guard", "turn"];
function ritualsOf(block) {
  const field = block?.get("rituals");
  if (field === void 0) return { on: new Set(RITUALS2), unknown: [] };
  const names = field.split(/\s+/).filter(Boolean);
  const known = (n) => RITUALS2.includes(n);
  return { on: new Set(names.filter(known)), unknown: names.filter((n) => !known(n)) };
}

// js/shared/graphslot.ts
var SLUG = String.raw`@[\w.-]+\/[\w.-]*\w`;
var ADDRESS = String.raw`(?:${SLUG}(?=[.-]*(?:$|[\s)\x60'",;.:]))|r\d+(?=$|[\s)\x60'",;.:]))`;
var FRAME = String.raw`[\s\x60'"]*`;
var HEAD = new RegExp(String.raw`^(${ADDRESS})(?:${FRAME}\(${FRAME}(${ADDRESS})${FRAME}\))?`);
var ANY = new RegExp(String.raw`${SLUG}|(?<![\w/])r\d+(?!\w)`, "gu");
var PROSE = new RegExp("^[—–\\-:.(]*\\s*(?!r\\d)\\p{L}", "u");
var esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var listing = (joins) => new RegExp(`^(?:[\\s\`'",;/+&|]${joins.map((j) => `|${esc(j)}(?=[\\s\`'"])`).join("")})*`, "u");
var anyIn = (t) => [...t.matchAll(ANY)].map((m) => m[0]);
function graphOfSlot(value, joins) {
  const [line = "", ...more] = value.split("\n");
  const list = listing(joins);
  const heads = [];
  let rest = line.replace(new RegExp(`^${FRAME}`), "");
  for (let head2 = HEAD.exec(rest); head2; head2 = HEAD.exec(rest)) {
    heads.push(head2.slice(1).filter((x) => !!x));
    rest = rest.slice(head2[0].length);
    rest = rest.slice((list.exec(rest)?.[0] ?? "").length);
  }
  if (!heads.length) return null;
  const pair = [...new Set(heads.flat())];
  const slugs = pair.filter((n) => n.startsWith("@"));
  const doubt = rest !== "" && !PROSE.test(rest) ? anyIn(rest) : [];
  const after2 = anyIn(more.join("\n"));
  const apart = heads.some((h) => !h.some((a) => heads[0]?.includes(a)));
  const strange = doubt.some((a) => !pair.includes(a)) || after2.length > 0;
  if (slugs.length > 1 || pair.length - slugs.length > 1 || apart || strange)
    return { many: [.../* @__PURE__ */ new Set([...pair, ...doubt, ...after2])] };
  return { realm: slugs[0] ?? pair[0] };
}

// js/shared/cover.ts
var formsIn = (pairs, cover) => Object.entries(cover.forms).filter(([, f]) => pairs.has(f.graph) || pairs.has(f.role));
function stampOf(text3, cover = COVER) {
  const block = coverBlock(text3, cover.root);
  if (block && stamped(block) || Object.values(cover.forms).some((f) => f.stamp.test(text3)))
    return "own";
  if (block) return null;
  return foreignBlock(text3, cover.root) || cover.stampShape.test(text3) ? "foreign" : null;
}
function hasCover(text3, cover = COVER) {
  if (coverBlock(text3, cover.root)) return true;
  const pairs = frontMatter(text3);
  return !!pairs && formsIn(pairs, cover).length > 0;
}
function formOf2(pairs, cover = COVER) {
  const W3 = words(ROOT_SEAT);
  const listed = (keys) => keys.map((k) => `'${k}'`).join(", ");
  const found = formsIn(pairs, cover);
  if (found.length > 1)
    return { why: W3.manyForms(cover.file, listed(found.map(([, f]) => f.graph))) };
  const [lang2, form] = found[0] ?? [];
  const all = [cover.root, ...Object.values(cover.forms).map((f) => f.graph)];
  if (!lang2 || !form) return { why: W3.noForm(cover.file, listed(all)) };
  return { lang: lang2, form };
}
var LEAD2 = /^[\s`'"<]*/;
var esc2 = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var roleRef = (q, flags = "") => new RegExp(
  `${flags.includes("g") ? "" : "^"}#(\\d+)\\s*${esc2(q[0])}[\\s\\S]*?${esc2(q[1])}`,
  flags
);
var distinct = (re, v) => [
  ...new Set([...v.matchAll(re)].map((m) => m[1]))
];
function seatOfBlock(block, cover = COVER) {
  const W3 = words(ROOT_SEAT);
  const key = (f) => `${cover.root}.${f}`;
  const graph = block.get("graph")?.trim();
  if (!graph) return { why: W3.noKey(cover.file, key("graph")) };
  if (!/^(?:r\d+|@[\w.-]+\/[\w.-]*\w)$/.test(graph))
    return { why: W3.noGraph(cover.file, key("graph")) };
  const role2 = block.get("agent_role")?.trim();
  if (!role2) return { why: W3.noKey(cover.file, key("agent_role")) };
  if (!/^\d+$/.test(role2)) return { why: W3.notNumber(cover.file, key("agent_role")) };
  return { realm: graph, karta: role2 };
}
function seatOfPairs(pairs, cover = COVER) {
  const W3 = words(ROOT_SEAT);
  const of = formOf2(pairs, cover);
  if ("why" in of) return of;
  const keys = of.form;
  const graph = pairs.get(keys.graph)?.trim();
  if (!graph) return { why: W3.noKey(cover.file, keys.graph) };
  const role2 = pairs.get(keys.role)?.trim();
  if (!role2) return { why: W3.noKey(cover.file, keys.role) };
  const g = graphOfSlot(graph.replace(LEAD2, ""), keys.graphJoins ?? []);
  if (!g) return { why: W3.noGraph(cover.file, keys.graph) };
  if ("many" in g) return { why: W3.manyGraphs(cover.file, keys.graph, g.many.join(", ")) };
  const r = role2.replace(LEAD2, "");
  const roles = distinct(roleRef(keys.roleQuotes, "g"), r);
  if (roles.length > 1)
    return { why: W3.manyRoles(cover.file, keys.role, roles.map((n) => `#${n}`).join(", ")) };
  const first = roleRef(keys.roleQuotes).exec(r);
  if (!first)
    return {
      why: W3.noRoleRef(cover.file, keys.role, `#N ${keys.roleQuotes[0]}…${keys.roleQuotes[1]}`)
    };
  return { realm: g.realm, karta: first[1] };
}
function readCover(dir, cover = COVER) {
  let text3;
  try {
    text3 = readFileSync4(join3(dir, cover.file), "utf8");
  } catch {
    return null;
  }
  if (stampOf(text3, cover) === "foreign") return { foreign: true };
  const block = coverBlock(text3, cover.root);
  if (block) return seatOfBlock(block, cover);
  const pairs = frontMatter(text3);
  if (!pairs) return { why: words(ROOT_SEAT).noFrontmatter(cover.file) };
  return seatOfPairs(pairs, cover);
}

// js/shared/reposigns.ts
import { readFileSync as readFileSync5, statSync } from "node:fs";
import { dirname, join as join4, resolve as resolve3 } from "node:path";
var exists = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};
var text2 = (path) => {
  try {
    return readFileSync5(path, "utf8");
  } catch {
    return null;
  }
};
function repoRoot(dir) {
  let at2 = resolve3(dir);
  for (; ; ) {
    if (exists(join4(at2, ".git"))) return at2;
    const up = dirname(at2);
    if (up === at2) return null;
    at2 = up;
  }
}
function startHook(settings, mark) {
  if (settings === null) return false;
  try {
    const entries = JSON.parse(settings)?.hooks?.SessionStart;
    if (!Array.isArray(entries)) return false;
    return entries.some(
      (e) => Array.isArray(e?.hooks) && e.hooks.some((h) => {
        const command = h?.command;
        return typeof command === "string" && mark.test(command);
      })
    );
  } catch {
    return false;
  }
}
function repoSigns(dir, harness, keys = REPO_SIGNS, cover = COVER) {
  const root = repoRoot(dir);
  const hooks = { "claude-code": false, opencode: false };
  if (root === null) return { root, cover: false, stamp: false, hooks, verdict: "outside" };
  const agents = text2(join4(root, cover.file));
  const stamped2 = agents === null ? null : stampOf(agents, cover);
  const signs = {
    cover: agents !== null && stamped2 !== "foreign" && hasCover(agents, cover),
    stamp: stamped2 === "own",
    hooks: {
      "claude-code": startHook(text2(join4(root, keys.settings)), keys.startMark),
      opencode: exists(join4(root, keys.rituals))
    }
  };
  const hooked = signs.hooks["claude-code"] || signs.hooks.opencode;
  const any = signs.cover || signs.stamp || hooked;
  const block = agents === null ? null : coverBlock(agents, cover.root);
  const carried = !!block?.get("graph") && !!block.get("holon") && !!block.get("agent_role");
  const complete = signs.cover && signs.stamp && (harness === null || harness === "dsh" || carried || signs.hooks[harness]);
  const verdict = stamped2 === "foreign" && !hooked ? "foreign" : !any ? "invite" : complete ? "aligned" : "partial";
  return { root, ...signs, verdict };
}

// js/shared/ritualcover.ts
function headings(text3) {
  const lines = text3.split("\n");
  let i = lines[0]?.trim() === "---" ? lines.findIndex((l, n) => n > 0 && l.trim() === "---") + 1 : 0;
  let fenced = false;
  const out2 = [];
  for (; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (/^\s*(?:```|~~~)/.test(l)) fenced = !fenced;
    else if (!fenced && /^#{1,6}\s/.test(l)) out2.push(l.replace(/^#+\s*|\s+#+\s*$/g, "").trim());
  }
  return out2;
}
function bodyLang(text3) {
  const heads = headings(text3).map((h) => h.toLowerCase());
  return LANGS.find((l) => heads.some((h) => h.startsWith(RITES[l].lifecycle().toLowerCase())));
}
function sectionsOf(text3) {
  const heads = headings(text3);
  const out2 = {};
  for (const k of Object.keys(SECTIONS)) {
    const h = heads.find(SECTIONS[k]);
    if (h) out2[k] = h;
  }
  return out2;
}
function ritualCover(dir, cover = COVER) {
  const root = repoRoot(dir);
  if (!root) return null;
  let text3;
  try {
    text3 = readFileSync6(join5(root, cover.file), "utf8");
  } catch {
    return null;
  }
  if (stampOf(text3, cover) === "foreign") return null;
  const block = coverBlock(text3, cover.root);
  const graph = block?.get("graph");
  if (!block || !graph) return null;
  const holon = block.get("holon") || void 0;
  const role2 = block.get("agent_role") || void 0;
  const lang2 = bodyLang(text3);
  const { on } = ritualsOf(block);
  const sections = sectionsOf(text3);
  return {
    root,
    graph,
    ...holon ? { holon } : {},
    ...role2 ? { role: role2 } : {},
    lang: lang2,
    on,
    sections
  };
}
function mergeHeads(s, trunk) {
  return trunk && s.trunk ? [s.trunk] : [s.lifecycle, s.merge];
}
function startWord(c) {
  const { graph, holon, role: role2, lang: lang2 } = c;
  return holon && role2 ? wordsIn(PREPARE, lang2).start({ graph, holon, role: role2 }) : wordsIn(RITES, lang2).early(graph);
}

// js/shared/turnend.ts
var TURN_RITE = "turn";
var SPEAKING = /* @__PURE__ */ new Map([
  [tool("case"), /* @__PURE__ */ new Set(["ask", "say", "answer", "talk", "line"])],
  [tool("channel"), /* @__PURE__ */ new Set(["send"])]
]);
function speaks(name, input) {
  if (typeof name !== "string") return false;
  const is = (t) => name === t || name.endsWith(`__${t}`);
  const i = input;
  if (is(tool("stand"))) return i?.status != null;
  for (const [t, acts] of SPEAKING)
    if (is(t)) return typeof i?.action === "string" && acts.has(i.action);
  return false;
}
var marked = (text3) => text3.trimStart().startsWith(FRAME_MARK);
var WATCHED_MS = 30 * 6e4;
var RECEIPT_MAX = 280;
var receipt = (text3) => [...text3.trim()].length <= RECEIPT_MAX && !text3.includes("?");
var lostWord = (t, now2 = Date.now()) => t.framed && !t.human && !t.spoke && !!t.text.trim() && !receipt(t.text) && !(t.heard !== null && now2 - t.heard < WATCHED_MS);

// js/dsh/compaction.ts
import { readFileSync as readFileSync7 } from "node:fs";
function placeOf(authDir, key) {
  if (!key) return null;
  try {
    const r = JSON.parse(readFileSync7(holdFilePathOf(authDir, key), "utf8"));
    if (typeof r.realm !== "string" || !r.realm || r.karta == null) return null;
    if (typeof r.name !== "string" || !r.name) return null;
    return { realm: r.realm, karta: String(r.karta), name: r.name };
  } catch {
    return null;
  }
}
function roleWord(authDir, key) {
  const p = placeOf(authDir, key);
  return p ? words(COMPACTION).back(p.karta, p.name, p.realm) : words(COMPACTION).bare();
}

// js/dsh/console.ts
function loudOf(ctx) {
  return (text3) => {
    try {
      ctx.logger?.info?.(text3);
    } catch {
    }
    console.error(text3);
  };
}
function listenerOf(ctx, refused) {
  return (event, fn) => {
    try {
      ctx.on(event, fn);
    } catch (e) {
      refused(`${event}: ${e.message}`);
    }
  };
}

// js/dsh/headless.ts
function profileOf(argv) {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] ?? "";
    if (t === "--profile") return argv[i + 1] ?? null;
    if (t.startsWith("--profile=")) return t.slice("--profile=".length);
    if (t === "--patch") i++;
    else if (!t.startsWith("-")) return t;
  }
  return null;
}
function isHeadless(ctx, argv = process.argv.slice(2)) {
  try {
    if (typeof ctx?.get === "function" && ctx.get("headlessStartup", false) !== void 0)
      return true;
  } catch {
  }
  return profileOf(argv) === "headless";
}

// js/dsh/hearing.ts
import { randomUUID } from "node:crypto";

// js/shared/clients.ts
var OPENCODE_CLIENT = CLIENTS.opencode;
var PI_CLIENT = CLIENTS.pi;
var HARNESS_VERSION_ENV = envName("HARNESS_VERSION");
var SKILLS_ROOT_ENV = envName("SKILLS_ROOT");

// js/shared/fields.ts
var FIELDS_CAPABILITY = STRUCTURED_CAPABILITY;
var FIELDS_CAPABILITIES = { experimental: { [FIELDS_CAPABILITY]: {} } };

// js/bridge/build.ts
var BUILD = buildOf(import.meta.url);

// js/bridge/streams.ts
var deadStreams = /* @__PURE__ */ new WeakSet();
var out = scoped(() => ({ stream: null }));
var processLog = null;
function canWrite(s) {
  return !!s && !deadStreams.has(s) && !s.destroyed && s.writable !== false;
}
var backlogged = /* @__PURE__ */ new WeakSet();
function writeTo(s, text3) {
  if (!canWrite(s)) return false;
  try {
    const fit = s.write(text3);
    if (!fit && !backlogged.has(s)) s.once("drain", () => backlogged.delete(s));
    if (fit) backlogged.delete(s);
    else backlogged.add(s);
    return true;
  } catch {
    deadStreams.add(s);
    return false;
  }
}
function log(msg) {
  const line = `[${BRIDGE_NAME} ${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`;
  const sink = currentScope().log ?? processLog;
  if (sink) sink(line);
  else writeTo(process.stderr, line);
}

// js/bridge/config.ts
var PRODUCTION_URLS = new Set(LANGS.map((l) => strip(SERVER_URLS[l])));
function strip(url) {
  return url.replace(/\/+$/, "");
}
var cfgSlot = scoped(() => ({ cfg: null }));
var CFG = new Proxy({}, {
  get: (_, k) => cfgSlot.cfg ? Reflect.get(cfgSlot.cfg, k) : void 0,
  has: (_, k) => !!cfgSlot.cfg && Reflect.has(cfgSlot.cfg, k)
});

// js/bridge/errors.ts
var CLOSED = /* @__PURE__ */ new Set(["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"]);
var closedUnder = (e) => {
  const err = e;
  return CLOSED.has(err?.code ?? "") || CLOSED.has(err?.cause?.code ?? "");
};

// js/bridge/oauth/discovery.ts
var REGISTRATION_REUSE_MS = 45 * 6e4;

// js/bridge/oauth/pacing.ts
var pauses = (v, fallback) => (v || fallback).split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
var DEAD_RECHECK_MS = pauses(process.env[envName("BRIDGE_DEAD_RECHECK_MS")], "1000,2000");
var IN_CALL_WAIT_MS = Number(process.env[envName("BRIDGE_IN_CALL_WAIT_MS")]) || 1e4;
var ORPHAN_FLOW_MS = Number(process.env[envName("BRIDGE_ORPHAN_FLOW_MS")]) || 5 * 6e4;

// js/bridge/oauth/device.ts
var SLOW_DOWN_MS = Number(process.env[envName("BRIDGE_DEVICE_SLOW_DOWN_MS")]) || 5e3;
var REISSUE_PAUSE_MS = Number(process.env[envName("BRIDGE_DEVICE_REISSUE_MS")]) || 3e4;
var never = new Promise(() => {
});

// js/bridge/oauth/flow.ts
var CLAIM_WAIT_MS = Number(process.env[envName("BRIDGE_CLAIM_WAIT_MS")]) || 15e3;
var LANDED_POLL_MS = Number(process.env[envName("BRIDGE_LANDED_POLL_MS")]) || 2e3;
var RELEASE_GAP_MS = Number(process.env[envName("BRIDGE_RELEASE_GAP_MS")]) || 0;

// js/bridge/repeat.ts
var OWN_CALL_PREFIX = `${ID_PREFIX}bridge-call-`;
var READ_TOOLS = new Set(["look", "orient", "search", "semantic_search"].map(tool));
var SAFE_ACTIONS = {
  [tool("channel")]: /* @__PURE__ */ new Set(["list"]),
  [tool("realm")]: /* @__PURE__ */ new Set(["list"])
};

// js/bridge/sessionclose.ts
var CLOSE_MS = Number(process.env[envName("BRIDGE_SESSION_CLOSE_MS")]) || 3e3;
var flying = scoped(() => /* @__PURE__ */ new Set());

// js/shared/toolreads.ts
var READ_TOOLS2 = new Set(["look", "orient", "search", "semantic_search"].map(tool));
var READ_ACTIONS = {
  [tool("case")]: /* @__PURE__ */ new Set(["read", "history", "mine", "at"]),
  [tool("channel")]: /* @__PURE__ */ new Set(["list", "sessions", "history"]),
  [tool("realm")]: /* @__PURE__ */ new Set(["list"]),
  [tool("org")]: /* @__PURE__ */ new Set(["list", "get", "realms", "list_members", "list_grants"]),
  [tool("me")]: /* @__PURE__ */ new Set(["whoami", "orgs", "kartas", "usage", "readiness"]),
  [tool("history")]: /* @__PURE__ */ new Set(["realm", "node", "delta"]),
  [tool("admin")]: /* @__PURE__ */ new Set([
    "list_members",
    "access",
    "search_users",
    "list_webhooks",
    "user_webhooks",
    "version"
  ])
};

// js/bridge/toolsync.ts
var T2 = scoped(() => ({
  served: null,
  // each harness session has its own list
  told: false,
  // list_changed said, and the harness has not reread yet
  inFlight: 0,
  // the harness's tools/list in flight (any page)
  listing: /* @__PURE__ */ new WeakSet(),
  // the harness's tools/list (first page) in flight
  heldBack: /* @__PURE__ */ new WeakSet(),
  // …in whose answer the server said list_changed
  live: /* @__PURE__ */ new WeakSet(),
  // …answered to the harness with the server's live list
  actions: /* @__PURE__ */ new Set()
  // known schemas in this session, never a process-wide help list
}));

// js/bridge/transport.ts
var state = scoped(() => ({
  sessionId: null,
  protocolVersion: null,
  initParams: null,
  // params of the harness's initialize, for transparent replay
  reinitCounter: 0,
  // The standing this session registered, and the session it was confirmed in.
  // Why the bridge owns re-registration, what was observed to go wrong, and the
  // falsifier that closes it: graph @nks/nks-dev, nodes #3919 (the breakdown),
  // #3454 (the falsifier), #3800 (the header form the surface binds with).
  // The server correlates a writer BY THE MCP SESSION ID (its holder's word):
  // a new session is a different writer, and the surface's own self-repair has
  // nothing to repeat there, because its memory is keyed by that same id and is
  // collected with it. Sessions die silently in three ways — idle past the
  // threshold, eviction by the session ceiling, transport close — and the
  // bridge is the ONLY party that sees the change and still remembers the name
  // the agent derived for itself. So re-registering is the bridge's duty, and
  // it hangs on the change of id, never on a timer.
  standing: null,
  // {realm, karta, name} of the last register that succeeded
  // Places in OTHER graphs on the same channel (#5838): register on the channel
  // in another graph adds a place, and a write is signed by the place of its
  // own graph. `standing` stays the place the socket was taken for; these ride
  // it and are replayed with it after every session turnover.
  places: [],
  standingSession: null,
  // the session id that registration is known to hold in
  // The access token the session was opened with. A session is opened BY a
  // credential and dies with it (the surface's own word): once the token in the
  // store is no longer the one this session was opened with — expired, refreshed
  // after a 401, rotated by a sibling bridge — the old id is a dead letter, and a
  // server that opens a fresh session on it silently runs the call unattributed
  // before we learn the new id. So a changed token means: re-open first.
  sessionToken: null,
  // The last session id the server answered 404 for: it is gone there, closing it is moot (#9174).
  goneSession: null
}));
var reinit = scoped(() => ({ inFlight: null }));

// js/shared/stalebatch.ts
var STALE_BURST_KEEP = 20;
var BODY_CAP = 800;
var shownOf = (frames, body) => body.shown.filter((i) => Number.isSafeInteger(i) && i >= 0).map((i) => frames[i]).filter((f) => f?.type === "message");
function batchBodyText(frames, body, riding = []) {
  const shown = shownOf(frames, body);
  const bodies = underCounts(
    [...riding, ...shown],
    textShown(shown, BODY_CAP),
    body.incomplete,
    frames
  );
  return `${body.head}

${bodies.join("\n\n")}`;
}
function staleBatch(all, has, riding = []) {
  const { shown: frames, kept: kept2, keys } = splitBatch(all, STALE_BURST_KEEP, has);
  const count = kept2.length;
  if (!count) return { text: "", keys };
  const body = {
    head: words(STALE).head(count, frames.length),
    shown: frames.map((f) => all.indexOf(f)),
    incomplete: count > frames.length
  };
  return { text: batchBodyText(all, body, ridingOf(riding, frames, has)), keys, body };
}
function ridingOf(riding, frames, has) {
  const own = new Set(frames.flatMap((f) => deliveryKeys(f)));
  return riding.filter((f) => !frames.includes(f) && !eventIn(f, (k) => has(k) || own.has(k)));
}

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env[envName("BRIDGE_BACKLOG_MS")]) || 1500;

// js/bridge/holdrecord.ts
var S2 = scoped(() => /* @__PURE__ */ new Map());
var H = scoped(() => ({ session: null }));
var B = scoped(() => /* @__PURE__ */ new Map());

// js/bridge/roomstack.ts
var ROOM_BATCH_MS = Number(process.env[envName("BRIDGE_ROOM_BATCH_MS")]) || 6e4;

// js/bridge/sweep.ts
var SEEN_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;

// js/bridge/endedseats.ts
var KEEP_MS = 10 * 6e4;
var J = scoped(() => ({ ended: /* @__PURE__ */ new Map() }));

// js/bridge/holdstate.ts
var H2 = scoped(() => ({
  /** session dir the place is taken from (stand cwd), kept in the hold record for cwd resume (resume.ts) */
  standCwd: null,
  holder: null,
  /** last service sign of a socket released by parkStanding; the record lifetime counts from it (holdkeep.ts) */
  heardAt: 0,
  /** door of the primary place, the one the socket was taken for */
  door: null,
  currentKey: null,
  currentUrl: null,
  currentStatusUrl: null,
  /** key of the place taken from this bridge by close 4000 */
  evictedKey: null,
  /** told to a client attaching later */
  evictedEvent: null,
  /** left the place: service socket closed, key and addresses kept (leave.ts) */
  parked: false,
  /** socket reopened on the same address without this opening's hello yet: another may have rotated it (deaf.ts) */
  unheard: false,
  /** key of a place whose socket was released but binding remembered, until hello proves hearing (deaf.ts) */
  deafKey: null,
  /** places of other graphs on the channel at the 4001: the server remembers the binding, no hearing (deaf.ts) */
  deadPlaces: [],
  attachHooks: [],
  helloWaiters: /* @__PURE__ */ new Set(),
  /** disk resumes in flight: a dead token during one is a stale record, not an alarm */
  resuming: 0,
  /** a return from disk brings the seats beside back: the handover spool waits for them (#7602) */
  spoolHeld: 0,
  spoolLater: null,
  /** live frames of a seat beside not back yet, judged after the spool once the return ends */
  liveLater: [],
  /** own revoke in flight (absorb.ts): close 4001 outruns the revoke answer */
  revokingOwn: false,
  /** own channel close in flight (absorb.ts): close 4001 outruns the answer, as with revoke (#6634) */
  closingOwn: false,
  /** keys of seats beside whose own revoke is in flight (absorb.ts): standing_ended outruns the answer */
  revokingBeside: /* @__PURE__ */ new Set(),
  /** the daemon goes down while this session's thin bridge lives and restores the place (daemon.ts, #6485) */
  handingOver: null,
  /** the last owner's stop of this session (stophold.ts, #7439): `n` counts stops, a move compares it before and after */
  stopped: { n: 0, key: "", text: "" },
  /** a stand call in flight since this stop count (standundo.ts): a stop meanwhile — its connect answers are not held */
  moveSince: null,
  /** seats a stand call in flight took or bound again (connect, register answered): a stop meanwhile takes them off */
  taken: null
}));

// js/bridge/muxtick.ts
var GAP_MS = Number(process.env[envName("PULSE_GAP_MS")]) || 3e4;

// js/bridge/muxhold.ts
var replay = null;
var onFellBack = (fn) => void (replay = fn);

// js/bridge/realms.ts
var aliases = scoped(() => /* @__PURE__ */ new Map());
var R = scoped(() => ({ listing: null }));

// js/bridge/places.ts
var extras = scoped(() => /* @__PURE__ */ new Map());

// js/bridge/spool.ts
var HANDOFF_MS = Number(process.env[envName("BRIDGE_DAEMON_HANDOFF_MS")]) || 12e3;
var DRAIN_MS = HANDOFF_MS + 5e3;

// js/bridge/statusturn.ts
var tails = /* @__PURE__ */ new Map();
function inTurn(url, fn, open = false) {
  const prev = tails.get(url) ?? (open ? Promise.resolve() : null);
  if (!prev) return fn();
  const next = prev.then(fn, fn);
  const tail2 = next.catch(() => {
  });
  tails.set(url, tail2);
  void tail2.then(() => {
    if (tails.get(url) === tail2) tails.delete(url);
  });
  return next;
}

// js/bridge/statuspost.ts
var TRIMMED = "trimmed_to_limit";
var LIMIT = 64;
var obj2 = (v) => v && typeof v === "object" ? v : {};
function trimToWord(text3, max) {
  const chars = [...text3];
  const head2 = chars.slice(0, max - 1).join("");
  const cut = chars[max - 1] === " " ? head2.length : head2.lastIndexOf(" ");
  return (cut > 0 ? head2.slice(0, cut) : head2).trimEnd() + "…";
}
function acceptedIn(body, sent) {
  let parsed = {};
  try {
    parsed = obj2(JSON.parse(body));
  } catch {
  }
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  const w = obj2(warnings.find((x) => obj2(x).code === TRIMMED));
  const told = typeof parsed.doing === "string" ? parsed.doing : null;
  if (!w.code) return told === null ? {} : { doing: told };
  const doing = told ?? trimToWord(sent, LIMIT);
  const message = typeof w.message === "string" ? w.message.trim() : "";
  return { doing, trimmed: { doing, message } };
}
var late = () => words(STATUS_POST).noAnswer(words(STATUS_POST).late());
async function postStatus(url, text3, until, standingId) {
  const left = until - Date.now();
  if (left <= 0) return { ok: false, body: late() };
  const signal = AbortSignal.timeout(left);
  const post2 = () => namedFetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      typeof standingId === "string" ? { text: text3, standing_id: standingId } : { text: text3 }
    ),
    signal
  });
  let res;
  try {
    res = await post2().catch((e) => {
      if (!closedUnder(e) || signal.aborted) throw e;
      return post2();
    });
  } catch (e) {
    return { ok: false, body: words(STATUS_POST).noAnswer(e.message) };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 404) return { ok: false, code: 404, body: words(STATUS_POST).gone(body) };
  if (!res.ok)
    return { ok: false, code: res.status, body: words(STATUS_POST).refused(res.status, body) };
  return { ok: true, body, ...acceptedIn(body, text3) };
}
onFellBack(
  (url, text3, standingId) => inTurn(url, () => postStatus(url, text3, Date.now() + 5e3, standingId), true).then((st) => {
    if (!st.ok) log(`busy line held for the dispatcher not posted: ${st.body}`);
  })
);

// js/bridge/seatorigin.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";

// js/shared/serviceid.ts
var SERVICE_ID = `${ID_PREFIX}service-`;

// js/bridge/seatorigin.ts
var origin = new AsyncLocalStorage2();

// js/watchdog/client.ts
import { connect } from "node:net";

// js/watchdog/words.ts
var wd = () => words(WATCHDOG);

// js/watchdog/client.ts
var ATTACH_WINDOW_MS = Number(process.env[envName("WATCHDOG_ATTACH_MS")]) || 6e4;
var RETRY_MS = 1e3;
var SILENT_MS = 2 ** 30;
function adoptSeenPath(named2, current, seen) {
  if (!named2 || named2 === current) return current;
  seen.clear();
  for (const x of seenIds(named2)) seen.add(x);
  return named2;
}
function staleOf(ev, has, riding = []) {
  if (!ev.unshown) return staleBatch(ev.frames ?? [], has, riding);
  const shown = (ev.frames ?? []).flatMap((f) => deliveryKeys(f));
  const named2 = ev.unshown.map((k) => /^evs?:/.test(k) ? `c${k}` : k);
  return { text: ev.text ?? "", keys: [...shown, ...named2] };
}
function attach(path, o) {
  let startedAt = Date.now();
  let attached = false;
  let handover = false;
  let waitingBack = false;
  let ownRelease = false;
  let forgotten = false;
  let dead = false;
  let retry = null;
  let hold = null;
  let live = null;
  function tryOnce() {
    if (dead) return;
    const sock = connect(path);
    live = sock;
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      attached = true;
      waitingBack = false;
    });
    sock.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.kind === "frame" && ev.frame === void 0 && typeof ev.raw === "string") {
          try {
            ev.frame = JSON.parse(ev.raw);
          } catch {
            ev.frame = null;
          }
        }
        if (ev.kind === "handover") {
          handover = true;
          continue;
        }
        if (ev.kind === "released" && ev.own) ownRelease = true;
        if (ev.kind === "released" && ev.beside) forgotten = true;
        if (ev.kind === "frame") carryGraphMarks(ev.frame, ev.marks);
        o.onEvent(ev);
      }
    });
    sock.on("error", () => {
    });
    sock.on("close", () => {
      live = null;
      if (dead) return;
      if (attached && handover) {
        attached = false;
        handover = false;
        waitingBack = true;
        startedAt = Date.now();
        return void (retry = setTimeout(tryOnce, RETRY_MS));
      }
      if (ownRelease) return;
      if (forgotten) return void (hold = setInterval(() => {
      }, SILENT_MS));
      if (attached) return o.onGone(wd().bridgeLetGo());
      if (Date.now() - startedAt > ATTACH_WINDOW_MS) {
        const s = ATTACH_WINDOW_MS / 1e3;
        return o.onGone(waitingBack ? wd().seatNotBack(s, path) : wd().noSocket(path, s));
      }
      retry = setTimeout(tryOnce, RETRY_MS);
    });
  }
  tryOnce();
  return () => {
    dead = true;
    if (retry) clearTimeout(retry);
    if (hold) clearInterval(hold);
    live?.destroy();
    live = null;
  };
}

// js/dsh/seat.ts
import { readdirSync as readdirSync2, readFileSync as readFileSync8 } from "node:fs";
import { join as join6 } from "node:path";

// js/shared/canon.ts
import { realpathSync } from "node:fs";
import { sep } from "node:path";
function canonDir(p) {
  let real = p;
  try {
    real = realpathSync.native(p);
  } catch {
  }
  while (real.length > 1 && (real.endsWith("/") || real.endsWith(sep))) real = real.slice(0, -1);
  return real;
}
var sameDir = (a, b) => !!a && !!b && (a === b || canonDir(a) === canonDir(b));

// js/dsh/seat.ts
var DSH_MCP_CLIENT = "dsh-mcp-client";
var attachWindowMs = () => Number(process.env[envName("WATCHDOG_ATTACH_MS")]) || 6e4;
var RETRY_MS2 = 1e3;
var LATE_RETRY_MS = 5e3;
function holdOf(authDir, key) {
  try {
    return JSON.parse(readFileSync8(holdFilePathOf(authDir, key), "utf8"));
  } catch {
    return null;
  }
}
function ownSeat(r, startedAt) {
  if (!r) return false;
  return r.client === DSH_MCP_CLIENT && r.left !== true && typeof r.at === "number" && r.at >= startedAt && Date.now() - r.at <= HOLD_RECORD_MAX_AGE_MS && sameDir(r.cwd, process.cwd());
}
var seatOf2 = (authDir, key) => ({
  key,
  path: socketPathOf(authDir, key),
  authDir
});
function ownSeats(authDir, startedAt) {
  let held = [];
  try {
    const dir = standingsDirOf(authDir);
    held = readdirSync2(dir).filter((f) => f.endsWith(".key")).map((f) => {
      try {
        return readFileSync8(join6(dir, f), "utf8").trim();
      } catch {
        return "";
      }
    }).filter(Boolean);
  } catch {
  }
  const keys = [...new Set(held)];
  return keys.filter((k) => ownSeat(holdOf(authDir, k), startedAt)).map((k) => seatOf2(authDir, k));
}
function awaitSeat(startedAt, found, log2) {
  const W3 = () => words(DSH);
  const authDir = authDirFromEnv();
  const windowMs2 = attachWindowMs();
  const began = Date.now();
  let retry = null;
  let said = "";
  const sayOnce = (text3) => {
    if (text3 !== said) log2(said = text3);
  };
  const look = () => {
    const seats = ownSeats(authDir, startedAt);
    if (seats.length === 1) return void found(seats[0]);
    const late2 = Date.now() - began >= windowMs2;
    if (seats.length > 1) sayOnce(W3().deafSeveral(seats.map((s) => s.key).join(", ")));
    else if (late2) sayOnce(W3().deafNoStanding(Math.round(windowMs2 / 1e3)));
    retry = setTimeout(look, late2 ? LATE_RETRY_MS : RETRY_MS2);
    retry.unref?.();
  };
  look();
  return () => {
    if (retry) clearTimeout(retry);
  };
}

// js/dsh/hearing.ts
function turnMessage(text3) {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text: text3 }],
    source: { kind: CLIENTS.dsh }
  };
}
function startHearing(agent, log2, startedAt = Date.now()) {
  const W3 = () => words(DSH);
  const state2 = { key: null };
  let detach = null;
  let cancelWait = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelWait?.();
    cancelWait = null;
    detach?.();
    detach = null;
  };
  const listen = (target) => {
    let seenPath = seenFilePathOf(target.authDir, target.key);
    const seen = seenIds(seenPath);
    const sending = /* @__PURE__ */ new Set();
    const known = (k) => seen.has(k) || sending.has(k);
    const send = (text3, keys) => {
      const a = agent();
      if (!a) return log2(W3().notDelivered("no live agent"));
      for (const k of keys) sending.add(k);
      let res;
      try {
        res = a.followup(turnMessage(markFrame(text3)));
      } catch (e) {
        for (const k of keys) sending.delete(k);
        return log2(W3().notDelivered(e.message));
      }
      void Promise.resolve(res).then(
        () => {
          for (const k of keys) {
            noteSeen(seenPath, k, seen);
            sending.delete(k);
          }
        },
        (e) => {
          for (const k of keys) sending.delete(k);
          log2(W3().notDelivered(e.message));
        }
      );
    };
    detach = attach(target.path, {
      onEvent: (ev) => {
        switch (ev.kind) {
          case "attached":
            seenPath = adoptSeenPath(ev.seen, seenPath, seen);
            state2.key = ev.key ?? target.key;
            return log2(W3().listening(state2.key));
          case "frame": {
            const f = ev.frame;
            if (f?.type !== "message") return;
            const keys = deliveryKeys(f);
            if (keys.some(known)) return;
            if (!addressedToMine(f)) return;
            return send(frameToText(f, ev.raw ?? ""), keys);
          }
          case "stale":
          case "backlog": {
            const b = staleOf(ev, known);
            if (b.text) return send(b.text, b.keys);
            return void b.keys.forEach((k) => noteSeen(seenPath, k, seen));
          }
          case "dead":
          case "evicted":
          case "stopped":
            log2(W3().seatGone(ev.text ?? ev.kind));
            return stop();
          case "released":
            if (!ev.own) log2(W3().gone(ev.text ?? ev.kind));
            return stop();
          default:
            return;
        }
      },
      onGone: (why) => {
        log2(W3().gone(why));
        stop();
      }
    });
  };
  cancelWait = awaitSeat(startedAt, listen, log2);
  return {
    key: () => state2.key,
    live: () => !stopped,
    stop
  };
}

// js/dsh/publish.ts
function afterPublish(a, message, signal, tries = 5) {
  return new Promise((resolve4, reject) => {
    setTimeout(
      () => {
        if (signal?.aborted) return reject(new Error("aborted"));
        try {
          Promise.resolve(a.followup(message)).then(() => resolve4(), reject);
        } catch (e) {
          if (tries > 0 && e.message.includes("reenter"))
            return void afterPublish(a, message, signal, tries - 1).then(resolve4, reject);
          reject(e);
        }
      },
      tries === 5 ? 0 : 25
    );
  });
}

// js/dsh/hold.ts
var HOLD_MS = 6e4;
var windowMs = () => Number(process.env[envName("DSH_HOLD_MS")]) || HOLD_MS;
function createHold(log2) {
  let task = null;
  let wake = null;
  const loud = (p) => void p.catch((e) => log2(e.message));
  const run = (a, signal) => new Promise((resolve4) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      if (task === own) task = null;
      resolve4();
    };
    const timer = setTimeout(finish, windowMs());
    const own = {
      take(m2) {
        task = null;
        clearTimeout(timer);
        const sent = afterPublish(a, m2, signal);
        void sent.then(finish, finish);
        return sent;
      },
      stop: finish
    };
    task = own;
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) return finish();
    const m = wake;
    wake = null;
    if (m) loud(own.take(m));
  });
  return {
    through: (m) => task?.take(m) ?? null,
    wake(m) {
      if (task) loud(task.take(m));
      else wake = m;
    },
    turnStarted() {
      wake = null;
    },
    idle(raw, a, headless, live) {
      const m = wake;
      if (task || !m && !(headless && live)) return;
      if (headless && typeof raw?.runMaintenance === "function")
        try {
          void Promise.resolve(raw.runMaintenance((s) => run(a, s))).catch(() => {
          });
          return;
        } catch (e) {
          log2(e.message);
        }
      wake = null;
      if (m) loud(afterPublish(a, m));
    },
    end() {
      task?.stop();
      task = null;
      wake = null;
    }
  };
}

// js/shared/trunkpush.ts
import { execFileSync } from "node:child_process";
var TRUNK = /^(?:refs\/heads\/)?(?:main|master)$/;
var REF_LINE = /^ [ *+-] \S+(?: \S+)*? +\S+ -> (\S+)/gm;
var words2 = (args2) => args2.match(/(?:\\.|'[^']*'|"(?:[^"\\]|\\.)*"|[^ '"\\])+/g) ?? [];
function git(cwd, ...a) {
  try {
    const stdio = ["ignore", "pipe", "ignore"];
    return execFileSync("git", a, { cwd, encoding: "utf8", stdio, windowsHide: true }).trim();
  } catch {
    return "";
  }
}
function targets(args2) {
  const pos = [];
  let skip = false;
  for (const t of words2(args2)) {
    if (skip) skip = false;
    else if (/^[0-9]*(?:>>?|<|>&)$/.test(t)) skip = true;
    else if (/^[0-9]*(?:>>?|<|>&)/.test(t)) continue;
    else if (/['"\\$`]/.test(t)) return null;
    else if (/^--(?:all|mirror)$/.test(t)) return null;
    else if (/^(?:-o|--push-option|--receive-pack|--exec|--repo)$/.test(t)) skip = true;
    else if (!t.startsWith("-")) pos.push(t);
  }
  const out2 = [];
  let tag = false;
  for (const r of pos.slice(1)) {
    if (tag) tag = false;
    else if (r === "tag") tag = true;
    else out2.push(r.replace(/^\+/, "").split(":").at(-1) || "HEAD");
  }
  return out2.length ? out2 : ["HEAD"];
}
var isTrunk = (branch) => TRUNK.test(branch);
var namesTrunk = (runs) => runs.some((args2) => (targets(args2) ?? []).some((r) => TRUNK.test(r)));
function toTrunk(runs, output, cwd, quiet2 = false) {
  const printed = [...output.matchAll(REF_LINE)].map((m) => m[1] ?? "");
  if (printed.length) return printed.some((r) => TRUNK.test(r));
  const branch = () => cwd ? git(cwd, "symbolic-ref", "--short", "-q", "HEAD") : "";
  if (quiet2) return namesTrunk(runs) ? true : isTrunk(branch()) ? null : false;
  return runs.some(
    (args2) => (targets(args2) ?? []).some((r) => TRUNK.test(r === "HEAD" ? branch() : r))
  );
}

// js/shared/ritualjudge.ts
var ARG = String.raw`(?:>&|\\.|'[^']*'|"(?:[^"\\]|\\.)*"|[^;&|)\n'"\\])*`;
var ENV = String.raw`(?:env +)?(?:[A-Za-z_]+=\S+ +)*`;
var PUSH = String.raw`${ENV}git(?: -C \S+)* push`;
var at = (head2, noop) => String.raw`(?:^|[;&|(\n] *)${head2}(?=[ ;&|)\n]|$)(?!${ARG} (?:${noop})(?:[ ;&|)\n]|$))`;
var PULL = new RegExp(
  at(String.raw`${ENV}git(?: -C \S+)* (?:checkout|switch)`, "-h|--help") + String.raw` (?:main|master)(?=[ ;&|)\n]|$)` + String.raw`(?:${ARG}(?:&&|;|\n))+ *${ENV}git(?: -C \S+)* pull(?=[ ;&|)\n]|$)`
);
var REFUSED = /^(?:fatal:|error:| ! \[(?:remote )?rejected\])/m;
var PUSH_REPORT = /To [^\n]+(?:\n [!=] .*)*\n [ *+-]/;
var HELD = /^(?:[Ee]rror:|fatal:|GraphQL:|X )|not mergeable|merge failed/m;
var TAGS_OUT = /^(?=[\s\S]*\n [*] \[new tag\])(?![\s\S]*\n (?:[ +-] |\* (?!\[new tag\])))/;
var QUIET = new RegExp(
  String.raw`^(?:${ARG}[;&|(\n] *)*` + PUSH + String.raw`(?=[ ;&|)\n]|$)(?!${ARG} (?:-h|--help)(?:[ ;&|)\n]|$))` + ARG + String.raw` (?:-q|--quiet)(?=[ ;&|)\n]|$)`
);
function ran(c, head2, noop, said) {
  if (!new RegExp(at(head2, noop)).test(c.command)) return false;
  const last = new RegExp(at(head2, noop) + ARG + String.raw`\s*(?:&&|$)`).test(c.command);
  return (c.exit ?? 0) === 0 && last || said.test(c.output);
}
function tagOnly(args2) {
  let skip = false;
  let tags = false;
  let broad = false;
  const pos = [];
  for (const t of words2(args2)) {
    if (skip) skip = false;
    else if (/^[0-9]*(?:>>?|<|>&)$/.test(t)) skip = true;
    else if (/^[0-9]*(?:>>?|<|>&)/.test(t)) continue;
    else if (/['"\\$`]/.test(t)) broad = true;
    else if (t === "--tags") tags = true;
    else if (/^(?:--(?:all|mirror|follow-tags|delete)(?:=|$)|-d$)/.test(t)) broad = true;
    else if (/^(?:-o|--push-option|--receive-pack|--exec)$/.test(t)) skip = true;
    else if (!t.startsWith("-")) pos.push(t);
  }
  const refs = pos.slice(1);
  let name = false;
  let ok = true;
  for (const r of refs) {
    if (name) name = false;
    else if (r === "tag") name = true;
    else if (!/^\+?refs\/tags\/[^:]+(?::refs\/tags\/[^:]+)?$/.test(r)) ok = false;
  }
  if (broad) return "no";
  if (ok && !name && (refs.length > 0 || tags)) return "tag";
  return refs.length === 1 && !tags && /^(?!refs\/|tag$)[^:+]+$/.test(refs[0] ?? "") ? "bare" : "no";
}
var pushRuns = (c) => {
  const all = new RegExp(String.raw`(?:^|[;&|(\n] *)${PUSH}(?=[ ;&|)\n]|$)(${ARG})`, "g");
  return [...c.command.matchAll(all)].map((m) => m[1] ?? "");
};
function tagsOnly(c) {
  const kinds = pushRuns(c).map(tagOnly);
  return kinds.length > 0 && !kinds.includes("no") && (!kinds.includes("bare") || TAGS_OUT.test(`
${c.output}`));
}
function quietLanded(c, cwd) {
  if (!cwd) return false;
  const head2 = git(cwd, "rev-parse", "HEAD");
  const trunk = isTrunk(git(cwd, "rev-parse", "--abbrev-ref", "HEAD"));
  return head2 !== "" && head2 === git(cwd, "rev-parse", "@{push}") && (!trunk || namesTrunk(pushRuns(c)));
}
function exitRefused(c) {
  const last = new RegExp(at(PUSH, "-h|--help") + ARG + String.raw`\s*$`);
  return c.exit != null && c.exit !== 0 && last.test(c.command) && !PUSH_REPORT.test(c.output);
}
function pushed(c, cwd) {
  if (REFUSED.test(c.output) || tagsOnly(c) || exitRefused(c)) return false;
  if (ran(c, PUSH, "-h|--help", PUSH_REPORT)) return true;
  return QUIET.test(c.command) && !c.command.includes("<<") && quietLanded(c, cwd);
}
function pushedTo(c, cwd) {
  if (!pushed(c, cwd)) return null;
  const to = toTrunk(pushRuns(c), c.output, cwd, QUIET.test(c.command));
  return to === null ? null : to ? "trunk" : "branch";
}
function merged(c) {
  if (HELD.test(c.output)) return false;
  const noop = "-h|--help|--auto|--disable-auto";
  return ran(c, "gh pr merge", noop, /(Merged|Squashed and merged|Rebased and merged) pull request/) || ran(c, "fj pr merge", noop, /Merged PR #/) || (c.exit ?? 0) === 0 && PULL.test(c.command);
}

// js/shared/ritenotes.ts
function shellNotes(cover, call, dir, skip = () => false) {
  const W3 = wordsIn(RITES, cover.lang);
  const { on, holon, sections } = cover;
  const push = on.has("push") && !skip("push") ? pushedTo(call, dir) : null;
  const said = [];
  if (push === "branch") said.push(W3.push(sections.check));
  if (push === "trunk" || on.has("merge") && !skip("merge") && merged(call))
    said.push(W3.merge(holon, ...mergeHeads(sections, push === "trunk")));
  return said;
}

// js/dsh/rites.ts
var SHELLS = /* @__PURE__ */ new Set(["bash"]);
var textOf2 = (s) => typeof s?.text === "string" ? s.text : "";
function shellCall(exec, result) {
  if (!SHELLS.has(exec?.name) || !result || result.isError) return null;
  const command = exec?.arguments?.command;
  const v = result.value;
  if (typeof command !== "string" || !v || typeof v !== "object") return null;
  if (v.kind !== void 0 && v.kind !== "foreground") return null;
  const exit = typeof v.exitCode === "number" ? v.exitCode : null;
  return { command, output: `${textOf2(v.stdout)}
${textOf2(v.stderr)}`, exit };
}
function riteLines(exec, result, dir) {
  const call = shellCall(exec, result);
  const cover = call ? ritualCover(dir) : null;
  if (!call || !cover) return null;
  return shellNotes(cover, call, dir).join("\n\n") || null;
}

// js/dsh/root.ts
function agentOf(a) {
  if (!a || typeof a !== "object") return null;
  if (typeof a.followup === "function") return { followup: (m) => a.followup(m) };
  if (typeof a.send === "function") return { followup: (m) => a.send(m, "next-turn", true) };
  return null;
}
function childAgent(a) {
  const h = a?.session?.header;
  if (!h || typeof h !== "object") return false;
  const depth = typeof h.delegationDepth === "number" ? h.delegationDepth : 0;
  return h.parentSession != null || h.origin === "subagent" || depth > 0;
}
var sessionId = (s) => typeof s?.id === "string" ? s.id : null;
function createRoot() {
  let started = false;
  let id = null;
  return {
    /** "root" — the session's first agent; "same" — the root's agent replaced; "child" — not the root. */
    take(a, source) {
      const fresh = source === "startup" || source === "resume";
      if (childAgent(a) || started && fresh) return "child";
      if (started) return "same";
      started = true;
      id = sessionId(a?.session);
      return "root";
    },
    /** The event's session is the root's, or one of them is unknown. */
    ours: (session) => {
      const s = sessionId(session);
      return !id || !s || s === id;
    },
    end() {
      started = false;
      id = null;
    }
  };
}

// js/shared/coverin.ts
import { realpathSync as realpathSync2 } from "node:fs";
function atRepoRoot(where) {
  const root = repoRoot(where);
  if (root === null) return false;
  try {
    return realpathSync2(root) === realpathSync2(where);
  } catch {
    return false;
  }
}
function coverIn(where) {
  const align = atRepoRoot(where);
  const cover = readCover(where);
  if (cover === null) return align ? { why: words(ROOT_SEAT).noFile(COVER.file), align } : null;
  if ("foreign" in cover) return null;
  return "why" in cover ? { why: cover.why, align } : cover;
}

// js/shared/rootseat-env.ts
var rootSeatMs = () => Number(process.env[envName("ROOT_SEAT_MS")] || 15e3);
var rootSeatEnabled = () => process.env[envName("ROOT_SEAT")] !== "0";

// js/shared/rootseat-say.ts
var W2 = () => words(ROOT_SEAT);
var oneLine = (text3) => {
  const t = text3.replace(/\s+/g, " ").trim();
  return t.length > 300 ? `${t.slice(0, 299)}…` : t;
};
var notSeatedWord = (why) => W2().notSeated(why);
var refusedWord = (text3) => W2().notSeated(W2().refused(oneLine(text3)));
var lateWord = (ms) => W2().notSeated(W2().late(Math.round(ms / 100) / 10));
function heldWord(r, realm, karta) {
  if ("other" in r) {
    const { name, karta: k, realm: held } = r.other;
    return r.uncompared ? W2().heldUncompared(name, k, held || W2().unknownRealm(), r.uncompared) : W2().ownOther(name, k, held || W2().unknownRealm());
  }
  return (r.provisional === true ? W2().seated : W2().ownSeated)(
    r.place,
    karta,
    r.realm ?? realm,
    COVER.file
  );
}

// js/shared/sameseat.ts
var short = (t) => /^r\d+$/.test(t.trim());
var canonical = (t) => /^@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t);
var slug = (t) => /^[A-Za-z0-9_.-]+$/.test(t) && !short(t);
function sameSeat(seat, realm, karta) {
  if (seat.karta.trim().replace(/^#/, "") !== karta.trim().replace(/^#/, "")) return false;
  const [x, y] = [seat.realm.trim(), realm.trim()];
  if (short(x) || short(y)) return short(x) && short(y) && x === y;
  if (canonical(x) && canonical(y)) return x === y;
  if (canonical(x) && slug(y)) return x.slice(x.indexOf("/") + 1) === y;
  if (slug(x) && canonical(y)) return x === y.slice(y.indexOf("/") + 1);
  return slug(x) && slug(y) && x === y;
}

// js/shared/spawned-for.ts
var invalid = () => {
  throw new Error(words(SPAWNED_FOR).invalid());
};
function parseSpawn(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const a = value;
  if (Object.keys(a).length !== 2 || !Number.isSafeInteger(a.invite) || Number(a.invite) <= 0 || typeof a.room !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a.room))
    return invalid();
  return { invite: a.invite, room: a.room.toLowerCase() };
}
function spawnLine(text3, role2) {
  try {
    const keys = [...text3.matchAll(/("(?:\\.|[^"\\])*")\s*:/g)].map(
      (m) => JSON.parse(m[1])
    );
    if (keys.length !== new Set(keys).size) return invalid();
    const v = JSON.parse(text3);
    if (!role2 || !v || typeof v !== "object" || !Object.hasOwn(v, "karta"))
      return { pair: parseSpawn(v) };
    const { karta, ...pair } = v;
    if (!Number.isSafeInteger(karta) || Number(karta) <= 0) return invalid();
    return { pair: parseSpawn(pair), karta };
  } catch {
    return invalid();
  }
}
function firstLineSpawn(text3) {
  const first = text3.split(/\r?\n/, 1)[0];
  if (!first.startsWith(SPAWN_LINE)) return void 0;
  const body = first.slice(SPAWN_LINE.length);
  const at2 = body.indexOf("{");
  if (at2 < 0 || body.slice(0, at2).trim() !== "") return invalid();
  let end = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = at2; i < body.length; i++) {
    const ch = body[i];
    if (escaped) escaped = false;
    else if (quoted && ch === "\\") escaped = true;
    else if (quoted) quoted = ch !== '"';
    else if (ch === '"') quoted = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  if (end < 0) return invalid();
  const { pair, karta } = spawnLine(body.slice(at2, end + 1), true);
  const role2 = karta === void 0 ? {} : { karta };
  const below = (() => {
    if (text3.length === first.length) return "";
    return text3.slice(first.length + (text3.charCodeAt(first.length) === 10 ? 1 : 2));
  })();
  const after2 = body.slice(end + 1);
  if (after2 === "") return { pair, rest: below, ...role2 };
  if (after2[0] !== " " && after2[0] !== "	") return invalid();
  const brief = after2.replace(/^[ \t]+/, "");
  if (!brief) return invalid();
  return { pair, rest: below ? `${brief}
${below}` : brief, ...role2 };
}

// js/dsh/taskrole.ts
function taskRole(ctx, log2) {
  let task;
  try {
    task = ctx?.get?.("headlessStartup", false)?.task;
  } catch {
    return void 0;
  }
  if (typeof task !== "string") return void 0;
  try {
    const k = firstLineSpawn(task)?.karta;
    return k === void 0 ? void 0 : String(k);
  } catch (e) {
    log2(refusedWord(e.message));
    return void 0;
  }
}

// js/dsh/rootseat.ts
var STAND2 = `mcp__${PRODUCT}__${tool("stand")}`;
var LOOK_MS = 100;
var pause = (ms) => new Promise((r) => setTimeout(r, ms).unref?.());
function createRootSeat(ctx, startedAt, authDir, log2) {
  let seating = null;
  let took = null;
  const held = () => {
    const [s] = ownSeats(authDir, startedAt);
    const r = s ? holdOf(authDir, s.key) : null;
    return r && typeof r.name === "string" ? { name: r.name, karta: String(r.karta ?? ""), realm: String(r.realm ?? "") } : null;
  };
  async function standTool(signal) {
    for (const end = Date.now() + rootSeatMs(); !signal.aborted; await pause(LOOK_MS)) {
      try {
        const def = ctx?.get?.("tools", false)?.get?.(STAND2);
        if (typeof def?.execute === "function") return def;
      } catch {
      }
      if (Date.now() >= end) return null;
    }
    return null;
  }
  async function seat(agent, dir, signal) {
    const cover = coverIn(dir);
    if (cover === null) return;
    if ("why" in cover) return log2(notSeatedWord(cover.why));
    const realm = cover.realm;
    const karta = taskRole(ctx, log2) ?? cover.karta;
    const own = held();
    if (own) {
      const known = !!own.realm && short(own.realm) === short(realm);
      if (known && sameSeat(own, realm, karta)) {
        took = own;
        return log2(heldWord({ place: own.name, realm: own.realm }, realm, karta));
      }
      return log2(
        heldWord(known ? { other: own } : { other: own, uncompared: realm }, realm, karta)
      );
    }
    const def = await standTool(signal);
    if (signal.aborted) return;
    if (!def) return log2(refusedWord(`${STAND2} — no such tool`));
    const model = agent?.model?.current?.()?.model;
    const args2 = { realm, karta, ...typeof model === "string" && model ? { model } : {} };
    try {
      await def.execute(args2, { signal, toolCallId: `${STAND2}:root`, deferContext() {
      } });
    } catch (e) {
      return log2(refusedWord(e.message));
    }
    if (signal.aborted) return;
    const now2 = held();
    took = now2;
    log2(heldWord({ place: now2?.name ?? "?", realm: now2?.realm || realm }, realm, karta));
  }
  return {
    begin(agent, dir) {
      took = null;
      if (!rootSeatEnabled()) return;
      seating?.abort.abort();
      const abort = new AbortController();
      const s = { agent, done: Promise.resolve(), abort, waited: false };
      s.done = seat(agent, dir, abort.signal).catch((e) => log2(refusedWord(e.message))).finally(() => {
        if (seating === s) seating = null;
      });
      seating = s;
    },
    async request(agent) {
      const s = seating;
      if (!s || s.agent !== agent || s.waited) return;
      s.waited = true;
      const ms = rootSeatMs();
      const late2 = await Promise.race([s.done.then(() => false), pause(ms).then(() => true)]);
      if (late2) log2(lateWord(ms));
    },
    // Only while this session's hold record of that very seat lives (held(), as at seating).
    seated: () => took && JSON.stringify(held()) === JSON.stringify(took) ? took : null,
    end() {
      seating?.abort.abort();
      seating = null;
      took = null;
    }
  };
}

// js/shared/covercontract.ts
import { readFileSync as readFileSync9 } from "node:fs";
import { join as join7 } from "node:path";
function contractOf(text3, cover = COVER) {
  if (stampOf(text3, cover) === "foreign") return { kind: "foreign" };
  if (repeatedKeys(text3).length) return { kind: "ambiguous" };
  const block = coverBlock(text3, cover.root);
  const pairs = frontMatter(text3);
  const stamps = Object.values(cover.forms).flatMap((f) => {
    const re = f.contractStamp ?? f.stamp;
    return [...text3.matchAll(new RegExp(re.source, `${re.flags.replace("g", "")}g`))].map(
      (m) => m[1]
    );
  });
  if (pairs) {
    const form = formOf2(pairs, cover);
    const count = Object.values(cover.forms).filter(
      (f) => pairs.has(f.graph) || pairs.has(f.role)
    ).length;
    if ("why" in form && count > 1 || block && count > 0) return { kind: "ambiguous" };
  }
  const values = [...block?.has("contract") ? [block.get("contract")] : [], ...stamps];
  if (!values.length) return { kind: "missing" };
  if (values.length > 1) return { kind: "ambiguous" };
  const value = values[0] ?? "";
  const n = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(n) ? { kind: "known", contract: n } : { kind: "invalid" };
}
function contractWarning(c, lang2) {
  return c.kind === "known" && c.contract < CONTRACT_SUPPORT.minimum ? wordsIn(CONTRACT_WORDS, lang2).unsupported(c.contract, CONTRACT_SUPPORT.target) : null;
}
function repoContractWarning(dir, lang2) {
  const root = repoRoot(dir);
  if (!root) return null;
  try {
    return contractWarning(contractOf(readFileSync9(join7(root, COVER.file), "utf8")), lang2);
  } catch {
    return null;
  }
}

// js/dsh/start.ts
var START_SECTION = "delivery:start";
var ORDER = 10300;
function startText(dir, source, seat) {
  if (source !== "startup" && source !== "resume") return null;
  const cover = ritualCover(dir);
  const warning = repoContractWarning(dir, cover?.lang);
  const W3 = wordsIn(DSH, cover?.lang);
  const tail2 = seat ? W3.startSeated(seat.name, seat.karta, seat.realm, source === "resume") : source === "resume" ? W3.startResumed() : W3.startListen();
  const start = cover?.on.has("start") ? [startWord(cover), tail2].join("\n\n") : null;
  const invite = repoSigns(dir, "dsh").verdict === "invite" ? wordsIn(ONBOARD_START, cover?.lang).start() : null;
  return [warning, start, invite].filter(Boolean).join("\n\n") || null;
}
function putStartWord(agent, source, dir, log2) {
  const text3 = startText(dir, source);
  const prompt = agent?.ctx?.systemPrompt;
  if (!text3) return false;
  if (typeof prompt?.section !== "function") {
    log2("agent.ctx.systemPrompt.section is absent");
    return false;
  }
  try {
    prompt.section({ name: START_SECTION, order: ORDER, text: text3, interpolate: false });
    return true;
  } catch (e) {
    log2(e.message);
    return false;
  }
}
function seatedStart(out2, dir, source, seat) {
  if (!seat || !Array.isArray(out2?.sections)) return out2;
  const text3 = startText(dir, source, seat);
  if (!text3) return out2;
  const sections = out2.sections.map((s) => s?.name === START_SECTION ? { ...s, text: text3 } : s);
  return { ...out2, sections };
}

// js/dsh/steer.ts
var FIRST_MS = 6e3;
var QUIET_MS = 2e3;
var LOOK_MS2 = 50;
var capMs = () => Number(process.env[envName("DSH_FIRST_MS")]) || FIRST_MS;
function toTurn(raw, followup, m) {
  if (raw?.status === "running" && typeof raw.steer === "function") return raw.steer(m);
  return followup(m);
}
function createFirstStep(route) {
  let gate = null;
  let stepping = null;
  const gone = (h) => h.fail(new Error("the session ended before its first step"));
  const pass = (g, h) => {
    clearTimeout(h.timer);
    if (g.ended) return gone(h);
    void new Promise((ok) => ok(route(h.m))).then(h.done, h.fail);
  };
  const drop = (g) => {
    if (!g) return;
    g.ended = true;
    for (const h of g.held.splice(0)) pass(g, h);
    g.wake();
  };
  const close = () => {
    drop(gate);
    drop(stepping);
    gate = stepping = null;
  };
  return {
    begin(agent) {
      close();
      gate = { agent, held: [], wake: () => void 0, ended: false };
    },
    take(m, running) {
      const g = gate;
      if (!g || !running) return null;
      return new Promise((done, fail) => {
        const h = { m, done, fail };
        g.held.push(h);
        g.wake();
        h.timer = setTimeout(() => {
          const i = g.held.indexOf(h);
          if (i >= 0) pass(g, g.held.splice(i, 1)[0]);
        }, capMs());
        h.timer.unref?.();
      });
    },
    async preStep(payload, next, wait, attached) {
      const g = gate;
      if (!g || payload?.agent !== g.agent) return next();
      const end = Date.now() + capMs();
      const quiet2 = Math.min(QUIET_MS, capMs() / 3);
      let since = null;
      while (wait && !g.held.length && !payload?.signal?.aborted && Date.now() < end) {
        if (attached()) since ??= Date.now();
        if (since !== null && Date.now() - since >= quiet2) break;
        await new Promise((r) => {
          g.wake = r;
          setTimeout(r, LOOK_MS2).unref?.();
        });
      }
      if (gate === g) gate = null;
      const held = g.held.splice(0);
      held.forEach((h) => clearTimeout(h.timer));
      let d;
      stepping = g;
      try {
        d = await next();
      } catch (e) {
        held.forEach((h) => pass(g, h));
        throw e;
      } finally {
        if (stepping === g) stepping = null;
      }
      const into = !g.ended && d?.kind === "enter" && Array.isArray(d.messages);
      if (!held.length || !into) {
        held.forEach((h) => pass(g, h));
        return d;
      }
      const msgs = d.messages;
      const at2 = msgs.findIndex((x) => x?.source?.kind === "runtime-context");
      const cut = at2 < 0 ? msgs.length : at2;
      const words3 = held.map((h) => h.m);
      held.forEach((h) => h.done());
      return { ...d, messages: [...msgs.slice(0, cut), ...words3, ...msgs.slice(cut)] };
    },
    end: close
  };
}

// js/shared/quietframe.ts
var flat = (s) => s.replace(/\s+/g, "");
var esc3 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var HEAD2 = "";
var ARGS = "";
var N = 1234567;
var NUM = new RegExp(String(N), "g");
function countLine(lang2) {
  const T3 = FRAME_TEXT[lang2];
  const call = esc3(flat(T3.caseHistory(ARGS, N))).replace(ARGS, `[^()]*`).replace(NUM, String.raw`-?\d+`);
  const cases = `(?:${call}(?:;${call})*|${esc3(flat(T3.myCases()))})`;
  const count = esc3(flat(T3.count(HEAD2, N, 0))).replace(HEAD2, ".+?").replace(NUM, String.raw`\d+`);
  return `${count}[^()]*?${esc3(flat(T3.noneYours()))}${esc3(flat(T3.inFull(ARGS))).replace(ARGS, cases)}\\.`;
}
var head = (lang2) => [false, true].flatMap((legacy) => [STALE[lang2].head(1, 1, legacy), STALE[lang2].head(2, 1, legacy)]).map((h) => esc3(flat(h)).replace(/\d+/g, String.raw`\d+`));
var LINE = `(?:${LANGS.map(countLine).join("|")})`;
var QUIET2 = new RegExp(`^(?:${LANGS.flatMap(head).join("|")})?(?:${LINE})+$`);
function compact2(lang2) {
  const T3 = FRAME_TEXT[lang2];
  const caseHead2 = esc3(flat(ROOM[lang2].case(HEAD2))).replace(HEAD2, "[^«»():;]+") + "(?:«[^»]*»)?";
  const count = esc3(flat(T3.count(HEAD2, N, 0))).replace(HEAD2, caseHead2).replace(NUM, String.raw`\d+`);
  const gone = esc3(flat(T3.supersededLines(N))).replace(NUM, String.raw`\d+`);
  const history = esc3(flat(T3.inFull(T3.caseHistory(ARGS, N)))).replace(ARGS, "[^()]*").replace(NUM, String.raw`-?\d+`);
  const template = esc3(flat(T3.inFull(T3.caseHistory('realm=R, action="history", room=N', "S"))));
  const fallback = esc3(flat(T3.inFull("")));
  const cursor = String.raw`·realm="(?:[^"\\]|\\.)*",since=\d+`;
  const line = `${count}(?:${gone})?`;
  return `(?:${line}(?:${cursor})?;(?:${history}|${fallback})\\.|(?:${line}(?:${cursor})?){2,}(?:${template}|${fallback})\\.)`;
}
var COMPACT = new RegExp(
  `^(?:${LANGS.flatMap(head).join("|")})?(?:${LANGS.map(compact2).join("|")})$`
);
var CARDS = new RegExp(
  `(?:${LANGS.flatMap((lang2) => {
    const T3 = FRAME_TEXT[lang2];
    return [
      esc3(flat(T3.openCards(null, null))),
      esc3(flat(T3.openCards(null, null, true))),
      esc3(flat(T3.openCards(N, null))).replace(NUM, String.raw`\d+`),
      esc3(flat(T3.openCards(N, ARGS))).replace(NUM, String.raw`\d+`).replace(ARGS, String.raw`[0-9T:.+Z-]+`)
    ];
  }).join("|")})$`
);
function quiet(text3) {
  const t = flat(text3);
  const body = t.startsWith(FRAME_MARK) ? t.slice(FRAME_MARK.length) : t;
  const withoutCards = body.replace(CARDS, "");
  return withoutCards !== body && !withoutCards || QUIET2.test(withoutCards) || COMPACT.test(withoutCards);
}

// js/dsh/turnend.ts
var textOf3 = (content) => Array.isArray(content) ? content.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : "";
var WAKES = new Set(LANGS.map((l) => TURN[l].wake()));
var args = (raw) => {
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
};
function createTurnEnds(opts) {
  let turn = null;
  let heard = null;
  const laid = /* @__PURE__ */ new Map();
  const speaking = /* @__PURE__ */ new Set();
  const fresh = () => ({
    framed: false,
    human: false,
    spoke: false,
    text: "",
    heard: null,
    woken: false
  });
  const take = (key) => {
    const n = laid.get(key);
    if (!n) return false;
    if (n > 1) laid.set(key, n - 1);
    else laid.delete(key);
    return true;
  };
  const note = (key) => {
    if (typeof key === "string" && key) laid.set(key, (laid.get(key) ?? 0) + 1);
  };
  function user(m, t) {
    const text3 = textOf3(m?.content);
    const byId = typeof m?.id === "string" && take(m.id);
    if (byId) take(textOf3(m?.content));
    if (byId || take(text3)) {
      if (!quiet(text3)) t.framed = true;
    } else if (WAKES.has(text3.trim())) t.woken = true;
    else if (m?.source?.kind === "user" && !marked(text3) && (opts.watched?.() ?? true)) {
      t.human = true;
      heard = Date.now();
    }
  }
  function end(reason) {
    const t = turn;
    turn = null;
    speaking.clear();
    if (!t || t.woken || reason?.kind !== "completed") return;
    if (lostWord({ ...t, heard }) && opts.on()) opts.wake(words(TURN).wake());
  }
  return {
    laid(m) {
      note(m?.id);
      note(textOf3(m?.content));
    },
    onEvent(ev) {
      const type = ev?.type;
      const data = ev?.data;
      if (type === "turn/start") turn = fresh();
      else if (type === "turn/end") end(data?.reason);
      if (!turn) return;
      if (type === "user/message") user(data, turn);
      else if (type === "assistant/message") {
        const blocks = Array.isArray(data?.message?.content) ? data.message.content : [];
        const calls = blocks.filter((b) => b?.type === "tool-call");
        for (const c of calls)
          if (typeof c.id === "string" && speaks(c.name, args(c.arguments))) speaking.add(c.id);
        turn.text = calls.length ? "" : textOf3(blocks);
      } else if (type === "tool/result") {
        const id = data?.message?.toolCallId;
        if (typeof id === "string" && speaking.delete(id) && !data.message.isError)
          turn.spoke = true;
      }
    },
    forget() {
      turn = null;
      heard = null;
      laid.clear();
      speaking.clear();
    }
  };
}

// js/dsh/plugin.ts
function apply(ctx) {
  const W3 = () => words(DSH);
  const startedAt = Date.now();
  const log2 = loudOf(ctx);
  const notDelivered = (why) => log2(W3().notDelivered(why));
  const sendAfterPublish = (a, message) => void afterPublish(a, message).catch((e) => notDelivered(e.message));
  const authDir = authDirFromEnv();
  let agent = null;
  let raw = null;
  let headless = false;
  let source = null;
  let hearing = null;
  const hold = createHold(notDelivered);
  const turns = createTurnEnds({
    on: () => ritualCover(process.cwd())?.on.has(TURN_RITE) ?? true,
    wake: (text3) => hold.wake(turnMessage(text3)),
    watched: () => !headless
  });
  const route = (m) => agent ? hold.through(m) ?? toTurn(raw, agent.followup, m) : notDelivered("no live agent");
  const first = createFirstStep(route);
  const heard = () => agent && {
    followup: (m) => (turns.laid(m), first.take(m, raw?.status === "running") ?? route(m))
  };
  const on = listenerOf(ctx, notDelivered);
  const root = createRoot();
  const seats = createRootSeat(ctx, startedAt, authDir, log2);
  on("agent/created", (payload) => {
    const took = root.take(payload?.agent, payload?.source);
    if (took === "child") return;
    const fresh = payload?.source === "startup" || payload?.source === "resume";
    if (took === "root") putStartWord(payload?.agent, payload?.source, process.cwd(), notDelivered);
    const own = agentOf(payload?.agent);
    if (own) [agent, raw] = [own, payload.agent];
    if (took === "root" && fresh) {
      source = payload.source;
      seats.begin(payload?.agent, process.cwd());
      first.begin(payload.agent);
    }
    headless = isHeadless(ctx);
    if (!hearing) hearing = startHearing(heard, log2, startedAt);
  });
  on("system-prompt/assemble", async (_assembly, context, next) => {
    const a = context?.scope;
    if (a && a === raw) await seats.request(a);
    const out2 = typeof next === "function" ? await next() : _assembly;
    return a && a === raw ? seatedStart(out2, process.cwd(), source, seats.seated()) : out2;
  });
  on("agent/pre-step", (payload, next) => {
    const wait = source === "resume" && !!seats.seated();
    return first.preStep(payload, next, wait, () => !!hearing?.key() || !hearing?.live());
  });
  on("agent/request", async (payload, next) => {
    await seats.request(payload?.agent);
    return typeof next === "function" ? next() : void 0;
  });
  on("session/disposed", (session) => {
    if (!root.ours(session)) return;
    hearing?.stop();
    hearing = null;
    agent = null;
    raw = null;
    hold.end();
    first.end();
    seats.end();
    turns.forget();
    root.end();
  });
  on("agent/status", (p) => {
    if (p?.status === "idle" && raw && agent && p.agent === raw)
      hold.idle(raw, agent, headless, hearing?.live() ?? false);
  });
  on("tools/post-execute", (exec, result, next) => {
    try {
      const note = riteLines(exec, result, process.cwd());
      const a = agent;
      if (note && a) sendAfterPublish(a, turnMessage(note));
    } catch (e) {
      log2(W3().notDelivered(e.message));
    }
    return typeof next === "function" ? next() : void 0;
  });
  on("session/event", (session, ev) => {
    if (!root.ours(session)) return;
    if (ev?.type === "turn/start") hold.turnStarted();
    turns.onEvent(ev);
    if (ev?.type !== "compaction/end" || ev.error) return;
    const a = agent;
    if (!a || !hearing) return;
    sendAfterPublish(a, turnMessage(markFrame(roleWord(authDir, hearing.key()))));
  });
}
export {
  apply
};
