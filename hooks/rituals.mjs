// js/cli/rituals-hook.ts
import { readFileSync as readFileSync7 } from "node:fs";

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
      stamp: /\(iskronify:\s*контракт\s*`?\d+`?\s*,\s*штамп/
    },
    en: {
      graph: "Graph",
      graphJoins: ["or", "and"],
      role: "Agent role",
      /** Открывающая и закрывающая совпадают: имя — до первой закрывающей. */
      roleQuotes: ['"', '"'],
      stamp: /\(iskronify:\s*contract\s*`?\d+`?\s*,\s*stamp/
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
  `^[ \\t]*${word}\\s+(\\S+)\\s+(\\S+)\\s+(?:(?:дело|case)\\s+)?[№#]\\s?(\\d+)(?:[ \\t]+(?:от|from)[ \\t]+(@\\S+))?(?=\\s|$)`,
  "imu"
);

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
var GLOBAL_PREFIX = `__${PRODUCT}`;
var BRIDGE_FILE = `${PRODUCT}.mjs`;
var PLUGIN_COPY_FILE = `${PRODUCT}.js`;
var SUB_ENTRY_PREFIX = `${PRODUCT}-sub`;
var CLIENTS = {
  opencode: `opencode-${PRODUCT}`,
  pi: `pi-${PRODUCT}`,
  doctor: `${PRODUCT}-doctor`,
  watchdog: `${PRODUCT}-watchdog`
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
var HALTS_CAPABILITY = `${PRODUCT}/halts`;

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
var FRAME_TEXT = {
  ru: {
    myCases: () => `${tool("case")}(action="mine"), затем read каждого`,
    frame: (id) => `кадр ${id}`,
    yoursBelow: () => ` — адресованные строками ниже; `,
    noneYours: () => ` — адресованных месту нет; `,
    count: (head2, n, mine) => `${head2}: записей ${n}, тебе ${mine}`,
    supersededLines: (gone) => `, сменённых строк ключа ${gone}`,
    askAnswered: (n, by) => `; вопрос [${n}] к тебе закрыт: ответил ${by}`,
    askMoved: (n, to) => `; вопрос [${n}] к тебе переадресован ${to}`,
    inFull: (cases) => `целиком — ${cases || FRAME_TEXT.ru.myCases()}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`,
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
    myCases: () => `${tool("case")}(action="mine"), then read each`,
    frame: (id) => `frame ${id}`,
    yoursBelow: () => ` — yours in the lines below; `,
    noneYours: () => ` — none of them yours; `,
    count: (head2, n, mine) => `${head2}: ${n} records, yours ${mine}`,
    supersededLines: (gone) => `, ${gone} superseded lines of a key`,
    askAnswered: (n, by) => `; your question [${n}] is closed: answered by ${by}`,
    askMoved: (n, to) => `; your question [${n}] is re-asked of ${to}`,
    inFull: (cases) => `in full — ${cases || FRAME_TEXT.en.myCases()}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`,
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
    start: ({ graph, holon, role }) => `Прочти раздел «Старт» двери iskron до действий и закончи его готовностью, не чтением. Адреса — обложка iskron: в AGENTS.md: граф ${graph}${holon ? `, фокус-контур #${holon}` : ""}${role ? `, роль агента #${role}` : ""}. Стояние — на вахту или перед первой записью в граф или дело, одним iskron_stand; читающая сессия места не занимает. start <граф> <роль> <дело №N> — вход в это дело; субагент встаёт своим мостом-спутником (iskron_stand с satellite_of) и на мосту позвавшего в граф не пишет.`,
    guard: (graph, section = "Правила персистентности") => `BLOCKED: локальная память агента запрещена целиком, по директории (AGENTS.md${section ? `, «${section}»` : ""}). Маршрутизируй факт: конвенции, ритуалы, команды и свойства кода репо → AGENTS.md; ловушки → их дом по «Раскладке» (GOTCHAS.md либо граф); смысл кода (решения, основания), состояние проекта, серверы и датированные долги → граф ${graph}; факт пользователя вне проекта, включая факты машины → личная память через minding. Директорию держит замороженной этот memory-guard.`,
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
    head: (kind) => ({ done: "сделано", kept: "уже стоит", left: "модели" })[kind]
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
    start: ({ graph, holon, role }) => `Read the Start section of the iskron door before acting and finish it as readiness, not reading. Addresses are the iskron: cover of AGENTS.md: graph ${graph}${holon ? `, focus holon #${holon}` : ""}${role ? `, agent role #${role}` : ""}. Standing on watch or before the first write to the graph or a case, one call: iskron_stand; a reading session takes no seat. start <graph> <role> <case №N> enters that case; a subagent stands on its own satellite bridge (iskron_stand with satellite_of) and does not write to the graph on the bridge of its caller.`,
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
    head: (kind) => ({ done: "done", kept: "already there", left: "for the model" })[kind]
  }
};

// js/delivery/words/rites.ts
var cite = (heads) => heads.filter(Boolean).map((h) => `«${h}»`).join(", ");
var RITES = {
  ru: {
    lifecycle: () => "Жизненный цикл сессии",
    push: (check) => `[iskron] пуш — не отгрузка: самопроверка диффа, словарный проход по тексту PR; ревью — раз на готовую пачку (AGENTS.md${check ? `, «${check}» и раздел о ревью` : ""}). Отгрузка — мерж.`,
    merge: (holon, ...heads) => `[iskron] мерж — акты после мержа AGENTS.md${cite(heads) ? ` (${cite(heads)})` : ""}: протки ${holon ? `контур #${holon}` : "контур"}, продвинь карту, модусы по свидетельству, закрой по оси, reconcile, словарный проход; фидбэк-рефлексия — если её велит AGENTS.md; работа по ссылке от агента — только семя превращения и модусы поставки.`,
    early: (graph) => `[iskron] обложка AGENTS.md называет граф ${graph}, контура и роли агента в ней ещё нет — продолжи онбординг: ветвь «Первый граф» скилла iskronify, с недостающего шага; номеров контура и роли не выдумывай.`
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
    unknown: (kind) => `род ${kind} мосту неизвестен`,
    case: (room) => `№${room}`,
    replyTo: (id) => `в ответ на [${id}]`,
    stale: () => "лежалый",
    bodyRead: (how) => `тело: ${how}`,
    whoHuman: (user) => `человек${user}`,
    whoRole: (karta) => `роль #${karta}`,
    whoSibling: (karta) => `брат по роли #${karta}`,
    whoPlatform: () => "платформа — побудка",
    whoGraph: () => "событие графа",
    legacy: (kind, stack) => `род ${kind}${stack ? `, стопка ${stack}` : ""}`
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
    unknown: (kind) => `kind ${kind} is unknown to the bridge`,
    case: (room) => `case №${room}`,
    replyTo: (id) => `in reply to [${id}]`,
    stale: () => "stale",
    bodyRead: (how) => `body: ${how}`,
    whoHuman: (user) => `human${user}`,
    whoRole: (karta) => `role #${karta}`,
    whoSibling: (karta) => `sibling of role #${karta}`,
    whoPlatform: () => "platform — a wake-up",
    whoGraph: () => "graph event",
    legacy: (kind, stack) => `kind ${kind}${stack ? ` · ${stack}` : ""}`
  }
};

// js/delivery/words/stalebatch.ts
var STALE = {
  ru: {
    head: (count, shown, legacy = false) => `Лежалых кадров: ${count}` + (count > shown ? `, здесь первые ${shown}, не вошло ${count - shown}` : "") + (legacy ? ` — принятые, пока место не слушали, или повтор службы после пересборки сессии; адресованные месту — текстом, прочие — счётом; целиком — по строкам дел ниже, не вошедшее — ${FRAME_TEXT.ru.myCases()}.` : ".")
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

// js/delivery/words/turn.ts
var TURN = {
  ru: {
    wake: () => `${FRAME_MARK} человека в консоли нет — вопрос карточкой ask в деле, отчёт — словом в дело или каналом на его место (${tool("case")} ask/say, ${tool("channel")} send). Сказать некому и нечего — ход кончен, текста не нужно.`,
    notLaid: (session, why) => `слово конца хода в сессию ${session} не легло: ${why}`
  },
  en: {
    wake: () => `${FRAME_MARK} no human at the console — a question as an ask card in the case, a report as a word in the case or by the channel to their seat (${tool("case")} ask/say, ${tool("channel")} send). Nothing to say to anyone — the turn is over, no text needed.`,
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
    doer: (text2) => `ДЕЛАТЕЛЬ: ${text2}`,
    listening: (key, tail = "") => `слушаю стояние ${key}${tail}`,
    listeningCodex: (key, thread) => `слушаю стояние ${key}; кадры кладу в тред ${thread}`,
    backfilled: (count) => ` (${count} задним числом)`,
    frames: ruFrames,
    noHeld: () => "мост не держит ни одного стояния — назовись одним вызовом iskron_stand(realm, karta, model): его ответ назовёт команду слушания",
    severalHeld: (held) => `мост держит несколько стояний — назови нужное: ${held}`,
    bridgeLetGo: () => "мост отпустил стояние или ушёл — сессия кончилась?",
    seatNotBack: (s, path) => `место не вернулось за ${s}s после смены демона — сокет ${path} не поднят; вернуть — iskron_stand`,
    noSocket: (path, s) => `мост не поднял локальный сокет ${path} за ${s}s`,
    bridgeReleasedSocket: (text2) => `мост отпустил сокет: ${text2}`,
    notWakeup: (type) => `кадр ${type ?? "не разобран"} — не повод будить`,
    seenEarlier: (id) => `кадр ${id} уже отдан прежним взводом — не повод будить`,
    unaddressed: () => "пачка без адресованных месту — счёт ждёт ближайшей побудки",
    seatLost: () => "ДЕЛАТЕЛЬ: стояние потеряно",
    aliveNote: () => "ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает — мост держит место",
    codexLost: () => "Искрон: стояние потеряно — назовись заново: iskron_stand",
    codexAlive: () => "Искрон: сокет рвут, а служба отвечает — мост держит место",
    noThread: () => "ДЕЛАТЕЛЬ: нет CODEX_THREAD_ID — запускай этого сторожа из оболочки сессии Codex: там Codex кладёт id треда в окружение",
    noDoor: (path) => `ДЕЛАТЕЛЬ: двери нет (${path}) — этот тред не под демоном app-server. Это ход ЧЕЛОВЕКА до запуска сессии, не твой: демон и сессия Codex должны стартовать с одним коротким CODEX_HOME (рецепт в SETUP, раздел Codex). Скажи ему это; пока двери нет — слушай watchdog-exit`,
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
    doer: (text2) => `DOER: ${text2}`,
    listening: (key, tail = "") => `listening on standing ${key}${tail}`,
    listeningCodex: (key, thread) => `listening on standing ${key}; putting frames into thread ${thread}`,
    backfilled: (count) => ` (${count} back-dated)`,
    frames: (n) => `${n} ${n === 1 ? "frame" : "frames"}`,
    noHeld: () => "the bridge holds no standing — name yourself with one call to iskron_stand(realm, karta, model): its answer names the listening command",
    severalHeld: (held) => `the bridge holds several standings — name the one you need: ${held}`,
    bridgeLetGo: () => "the bridge released the standing or went away — did the session end?",
    seatNotBack: (s, path) => `the seat did not return within ${s}s after the daemon change — socket ${path} is not up; to bring it back use iskron_stand`,
    noSocket: (path, s) => `the bridge did not bring up the local socket ${path} within ${s}s`,
    bridgeReleasedSocket: (text2) => `the bridge released the socket: ${text2}`,
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

// js/shared/lang.ts
import { readFileSync } from "node:fs";
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
import { homedir } from "node:os";
import { join, resolve } from "node:path";
var defaultAuthDir = () => join(homedir(), HOME_DIR);
var authDirFromEnv = () => envOf(envName("BRIDGE_AUTH_DIR"))?.trim() || defaultAuthDir();
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;

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
    const text2 = readFileSync(join2(authDirFromEnv(), "server"), "utf8").trim();
    if (text2) return langOfServer(text2);
  } catch {
  }
  return DEFAULT_LANG;
}
var S = scoped(() => ({ current: null }));
var lang = () => S.current ??= resolve2();
var wordsIn = (dict, l) => dict[l ?? lang()];

// js/shared/ritualcover.ts
import { readdirSync, readFileSync as readFileSync3 } from "node:fs";
import { join as join4 } from "node:path";

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
function fences(text2) {
  const lines = text2.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end < 0 ? null : { lines, end };
}
function coverBlocks(text2) {
  const blocks2 = /* @__PURE__ */ new Map();
  const f = fences(text2);
  let open = null;
  for (const line of f ? f.lines.slice(1, f.end) : []) {
    if (/^\s*(#|$)/.test(line)) continue;
    const top = TOP.exec(line);
    const child = open && CHILD.exec(line);
    if (top) blocks2.set(unquote(top[1]), open = /* @__PURE__ */ new Map());
    else if (open && child) open.set(unquote(child[1]), bare(child[2] ?? ""));
    else open = null;
  }
  return blocks2;
}
var coverBlock = (text2, root) => coverBlocks(text2).get(root) ?? null;
var stamped = (block) => /^\d+$/.test(block.get("contract") ?? "") && !!block.get("stamp");
var foreignBlock = (text2, root) => [...coverBlocks(text2)].some(([k, b]) => k !== root && b.has("contract"));
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

// js/shared/cover.ts
function stampOf(text2, cover = COVER) {
  const block = coverBlock(text2, cover.root);
  if (block && stamped(block) || Object.values(cover.forms).some((f) => f.stamp.test(text2)))
    return "own";
  if (block) return null;
  return foreignBlock(text2, cover.root) || cover.stampShape.test(text2) ? "foreign" : null;
}

// js/shared/reposigns.ts
import { readFileSync as readFileSync2, statSync } from "node:fs";
import { dirname, join as join3, resolve as resolve3 } from "node:path";
var exists = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};
function repoRoot(dir) {
  let at2 = resolve3(dir);
  for (; ; ) {
    if (exists(join3(at2, ".git"))) return at2;
    const up = dirname(at2);
    if (up === at2) return null;
    at2 = up;
  }
}

// js/shared/ritualcover.ts
function headings(text2) {
  const lines = text2.split("\n");
  let i = lines[0]?.trim() === "---" ? lines.findIndex((l, n) => n > 0 && l.trim() === "---") + 1 : 0;
  let fenced = false;
  const out = [];
  for (; i < lines.length; i++) {
    const l = lines[i] ?? "";
    if (/^\s*(?:```|~~~)/.test(l)) fenced = !fenced;
    else if (!fenced && /^#{1,6}\s/.test(l)) out.push(l.replace(/^#+\s*|\s+#+\s*$/g, "").trim());
  }
  return out;
}
function bodyLang(text2) {
  const heads = headings(text2).map((h) => h.toLowerCase());
  return LANGS.find((l) => heads.some((h) => h.startsWith(RITES[l].lifecycle().toLowerCase())));
}
function sectionsOf(text2) {
  const heads = headings(text2);
  const out = {};
  for (const k of Object.keys(SECTIONS)) {
    const h = heads.find(SECTIONS[k]);
    if (h) out[k] = h;
  }
  return out;
}
function ritualCover(dir, cover = COVER) {
  const root = repoRoot(dir);
  if (!root) return null;
  let text2;
  try {
    text2 = readFileSync3(join4(root, cover.file), "utf8");
  } catch {
    return null;
  }
  if (stampOf(text2, cover) === "foreign") return null;
  const block = coverBlock(text2, cover.root);
  const graph = block?.get("graph");
  if (!block || !graph) return null;
  const holon = block.get("holon") || void 0;
  const role = block.get("agent_role") || void 0;
  const lang2 = bodyLang(text2);
  const { on } = ritualsOf(block);
  const sections = sectionsOf(text2);
  return {
    root,
    graph,
    ...holon ? { holon } : {},
    ...role ? { role } : {},
    lang: lang2,
    on,
    sections
  };
}
function mergeHeads(s, trunk) {
  return trunk && s.trunk ? [s.trunk] : [s.lifecycle, s.merge];
}
function startWord(c) {
  const { graph, holon, role, lang: lang2 } = c;
  return holon && role ? wordsIn(PREPARE, lang2).start({ graph, holon, role }) : wordsIn(RITES, lang2).early(graph);
}

// js/shared/trunkpush.ts
import { execFileSync } from "node:child_process";
var TRUNK = /^(?:refs\/heads\/)?(?:main|master)$/;
var REF_LINE = /^ [ *+-] \S+(?: \S+)*? +\S+ -> (\S+)/gm;
var words2 = (args) => args.match(/(?:\\.|'[^']*'|"(?:[^"\\]|\\.)*"|[^ '"\\])+/g) ?? [];
function git(cwd, ...a) {
  try {
    const stdio = ["ignore", "pipe", "ignore"];
    return execFileSync("git", a, { cwd, encoding: "utf8", stdio, windowsHide: true }).trim();
  } catch {
    return "";
  }
}
function targets(args) {
  const pos = [];
  let skip = false;
  for (const t of words2(args)) {
    if (skip) skip = false;
    else if (/^[0-9]*(?:>>?|<|>&)$/.test(t)) skip = true;
    else if (/^[0-9]*(?:>>?|<|>&)/.test(t)) continue;
    else if (/['"\\$`]/.test(t)) return null;
    else if (/^--(?:all|mirror)$/.test(t)) return null;
    else if (/^(?:-o|--push-option|--receive-pack|--exec|--repo)$/.test(t)) skip = true;
    else if (!t.startsWith("-")) pos.push(t);
  }
  const out = [];
  let tag = false;
  for (const r of pos.slice(1)) {
    if (tag) tag = false;
    else if (r === "tag") tag = true;
    else out.push(r.replace(/^\+/, "").split(":").at(-1) || "HEAD");
  }
  return out.length ? out : ["HEAD"];
}
var isTrunk = (branch) => TRUNK.test(branch);
var namesTrunk = (runs) => runs.some((args) => (targets(args) ?? []).some((r) => TRUNK.test(r)));
function toTrunk(runs, output, cwd, quiet2 = false) {
  const printed2 = [...output.matchAll(REF_LINE)].map((m) => m[1] ?? "");
  if (printed2.length) return printed2.some((r) => TRUNK.test(r));
  const branch = () => cwd ? git(cwd, "symbolic-ref", "--short", "-q", "HEAD") : "";
  if (quiet2) return namesTrunk(runs) ? true : isTrunk(branch()) ? null : false;
  return runs.some(
    (args) => (targets(args) ?? []).some((r) => TRUNK.test(r === "HEAD" ? branch() : r))
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
function tagOnly(args) {
  let skip = false;
  let tags = false;
  let broad = false;
  const pos = [];
  for (const t of words2(args)) {
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

// js/shared/turnend.ts
var TURN_RITE = "turn";
var SPEAKING = /* @__PURE__ */ new Map([
  [tool("case"), /* @__PURE__ */ new Set(["ask", "say", "answer", "talk"])],
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
var marked = (text2) => text2.trimStart().startsWith(FRAME_MARK);
var WATCHED_MS = 30 * 6e4;
var RECEIPT_MAX = 280;
var receipt = (text2) => [...text2.trim()].length <= RECEIPT_MAX && !text2.includes("?");
var lostWord = (t, now = Date.now()) => t.framed && !t.human && !t.spoke && !!t.text.trim() && !receipt(t.text) && !(t.heard !== null && now - t.heard < WATCHED_MS);

// js/cli/hookkinds.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join6 } from "node:path";

// js/cli/preparescripts.ts
import { readFileSync as readFileSync4, statSync as statSync2 } from "node:fs";
import { isAbsolute, join as join5 } from "node:path";
var SCRIPT = /\.(sh|bash|zsh|js|cjs|mjs|ts|py|rb|pl)$/;
var PROJECT = /\$\{?CLAUDE_PROJECT_DIR\}?/g;
var INTERPRETER = /(^|\/)(sh|bash|zsh|dash|node|bun|deno|tsx|python3?|ruby|perl)$/;
function scriptsOf(root, command) {
  const words3 = command.split(/\s+/).map((t) => t.replace(/["']/g, ""));
  const at2 = (t) => {
    const p = t.replace(PROJECT, root);
    return isAbsolute(p) ? p : join5(root, p);
  };
  return words3.filter(
    (t, i) => SCRIPT.test(t) || t.includes("CLAUDE_PROJECT_DIR") || i > 0 && INTERPRETER.test(words3[i - 1] ?? "") && /^[\w.~]/.test(t) || t.includes("/") && isFile(at2(t))
  ).map(at2);
}
function isFile(path) {
  try {
    return statSync2(path).isFile();
  } catch {
    return false;
  }
}
function text(path) {
  try {
    return isFile(path) ? readFileSync4(path, "utf8") : "";
  } catch {
    return "";
  }
}
function knownHook(root, command, known) {
  return known(command) || scriptsOf(root, command).some((p) => known(text(p)));
}
function runsOn(matcher, tool2) {
  try {
    return new RegExp(`^(?:${matcher})$`).test(tool2);
  } catch {
    return false;
  }
}

// js/cli/hookkinds.ts
var covers = (m, target) => !m || m === "*" || runsOn(m, target);
var onAny = (...targets2) => (m) => targets2.some((t) => covers(m, t));
var KNOWN = {
  "hook.start": {
    event: "SessionStart",
    known: (c) => c.toLowerCase().includes(PRODUCT),
    on: onAny("startup", "resume", "clear")
  },
  "hook.guard": {
    event: "PreToolUse",
    known: (c) => /\.claude\W{0,4}projects/.test(c) && /memory/i.test(c),
    on: (m) => ["Write", "Edit"].every((t) => covers(m, t))
  },
  "hook.push": {
    event: "PostToolUse",
    known: (c) => c.includes("git(?: -C [^ ]+)* push"),
    on: onAny("Bash")
  },
  "hook.merge": {
    event: "PostToolUse",
    known: (c) => c.includes("gh pr merge"),
    on: onAny("Bash")
  }
};
var hooksOf = (s, event, on = () => true) => (s.hooks?.[event] ?? []).filter((e) => on(e.matcher)).flatMap((e) => e.hooks ?? []);
var cmd = (h) => h.command ?? "";
var knownOf = (root, s, kind, target) => {
  const k = KNOWN[kind];
  const on = target === void 0 ? k.on : onAny(target);
  return hooksOf(s, k.event, on).filter((h) => knownHook(root, cmd(h), k.known));
};
function read(path) {
  try {
    const s = JSON.parse(readFileSync5(path, "utf8"));
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  } catch {
    return {};
  }
}
function standingRites(root, target) {
  const files = ["settings.json", "settings.local.json"].map((f) => read(join6(root, ".claude", f)));
  const kinds = Object.keys(KNOWN);
  return new Set(kinds.filter((k) => files.some((s) => knownOf(root, s, k, target).length > 0)));
}

// js/cli/turnread.ts
import { readFileSync as readFileSync6 } from "node:fs";

// js/shared/quietframe.ts
var flat = (s) => s.replace(/\s+/g, "");
var esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var HEAD2 = "";
var ARGS = "";
var N = 1234567;
var NUM = new RegExp(String(N), "g");
function countLine(lang2) {
  const T = FRAME_TEXT[lang2];
  const call = esc(flat(T.caseHistory(ARGS, N))).replace(ARGS, `[^()]*`).replace(NUM, String.raw`-?\d+`);
  const cases = `(?:${call}(?:;${call})*|${esc(flat(T.myCases()))})`;
  const count = esc(flat(T.count(HEAD2, N, 0))).replace(HEAD2, ".+?").replace(NUM, String.raw`\d+`);
  return `${count}[^()]*?${esc(flat(T.noneYours()))}${esc(flat(T.inFull(ARGS))).replace(ARGS, cases)}\\.`;
}
var head = (lang2) => [false, true].flatMap((legacy) => [STALE[lang2].head(1, 1, legacy), STALE[lang2].head(2, 1, legacy)]).map((h) => esc(flat(h)).replace(/\d+/g, String.raw`\d+`));
var LINE = `(?:${LANGS.map(countLine).join("|")})`;
var QUIET2 = new RegExp(`^(?:${LANGS.flatMap(head).join("|")})?(?:${LINE})+$`);
function compact(lang2) {
  const T = FRAME_TEXT[lang2];
  const caseHead = esc(flat(ROOM[lang2].case(HEAD2))).replace(HEAD2, "[^«»():;]+") + "(?:«[^»]*»)?";
  const count = esc(flat(T.count(HEAD2, N, 0))).replace(HEAD2, caseHead).replace(NUM, String.raw`\d+`);
  const gone = esc(flat(T.supersededLines(N))).replace(NUM, String.raw`\d+`);
  const history = esc(flat(T.inFull(T.caseHistory(ARGS, N)))).replace(ARGS, "[^()]*").replace(NUM, String.raw`-?\d+`);
  const template = esc(flat(T.inFull(T.caseHistory('realm=R, action="history", room=N', "S"))));
  const fallback = esc(flat(T.inFull("")));
  const cursor = String.raw`·realm="(?:[^"\\]|\\.)*",since=\d+`;
  const line = `${count}(?:${gone})?`;
  return `(?:${line}(?:${cursor})?;(?:${history}|${fallback})\\.|(?:${line}(?:${cursor})?){2,}(?:${template}|${fallback})\\.)`;
}
var COMPACT = new RegExp(
  `^(?:${LANGS.flatMap(head).join("|")})?(?:${LANGS.map(compact).join("|")})$`
);
function quiet(text2) {
  const t = flat(text2);
  const body = t.startsWith(FRAME_MARK) ? t.slice(FRAME_MARK.length) : t;
  return QUIET2.test(body) || COMPACT.test(body);
}

// js/cli/turnread.ts
var WATCH = /\bwatchdog(?:-exit)?\b/;
var EXITS = /\bwatchdog-exit\b/;
var NOTICE = /^\s*<task-notification>/;
var OWN = [...LANGS.map((l) => WATCHDOG[l].listening("").trim()), "[Monitor "];
var ownEvent = (event) => event.split("\n").map((l) => l.trim()).filter(Boolean).every((l) => OWN.some((p) => l.startsWith(p)) || /^\{.*"type":"hello"/.test(l));
var blocks = (e) => {
  const c = e.message?.content;
  return typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
};
var textOf = (b) => b.map((x) => x.type === "text" && typeof x.text === "string" ? x.text : "").join("\n");
function watchTasks(entries) {
  const calls = /* @__PURE__ */ new Map();
  const tasks = /* @__PURE__ */ new Map();
  for (const e of entries)
    for (const b of blocks(e)) {
      const command = String(b.input?.command ?? "");
      if (b.type === "tool_use" && WATCH.test(command))
        calls.set(String(b.id), EXITS.test(command));
      if (b.type !== "tool_result" || !calls.has(String(b.tool_use_id))) continue;
      const r = e.toolUseResult;
      const shell = typeof r?.backgroundTaskId === "string";
      const id = r?.taskId ?? r?.backgroundTaskId;
      const said = typeof b.content === "string" ? b.content : textOf(b.content ?? []);
      const found = typeof id === "string" ? id : /\btask:? ([\w-]+)/.exec(said)?.[1];
      if (found) tasks.set(found, shell && calls.get(String(b.tool_use_id)) === true);
    }
  return tasks;
}
function frameNotice(text2, exits) {
  const event = /<event>([\s\S]*?)<\/event>/.exec(text2)?.[1]?.trim();
  if (event !== void 0) return !ownEvent(event) && !quiet(event);
  return exits && /<status>\s*completed\s*<\/status>/.test(text2);
}
function prompt(e, watch) {
  if (e.type !== "user" || e.isMeta || e.isCompactSummary) return null;
  const b = blocks(e);
  if (!b.length || b.some((x) => x.type === "tool_result")) return null;
  const text2 = textOf(b);
  const origin = e.origin?.kind;
  if (origin === "human") return "human";
  if (NOTICE.test(text2) || origin === "task-notification") {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(text2)?.[1]?.trim();
    return id && watch.has(id) && frameNotice(text2, watch.get(id) === true) ? "frame" : "other";
  }
  if (marked(text2)) return quiet(text2) ? "other" : "frame";
  return origin === void 0 ? "human" : "other";
}
var ended = (e) => {
  const r = e.message?.stop_reason;
  return e.type === "assistant" && typeof r === "string" && r !== "tool_use";
};
function lastTurn(path) {
  let entries;
  try {
    entries = readFileSync6(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return {};
      }
    }).filter((e) => (e.type === "user" || e.type === "assistant") && !e.isSidechain);
  } catch {
    return null;
  }
  const watch = watchTasks(entries);
  const said = [...entries].reverse().find((e) => prompt(e, watch) === "human")?.timestamp;
  const heard = typeof said === "string" ? Date.parse(said) : NaN;
  const seen = { framed: false, human: false, spoke: false, text: "", heard: null };
  if (Number.isFinite(heard)) seen.heard = heard;
  const last = [...entries].reverse().find((e) => e.type === "assistant");
  const tail = last && !last.isApiErrorMessage ? blocks(last).at(-1) : void 0;
  if (tail?.type === "text" && typeof tail.text === "string") seen.text = tail.text;
  let prompts = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (prompts && ended(e)) break;
    const kind = prompt(e, watch);
    if (kind) prompts++;
    if (kind === "frame") seen.framed = true;
    if (kind === "human") seen.human = true;
    for (const b of e.type === "assistant" ? blocks(e) : [])
      if (b.type === "tool_use" && speaks(b.name, b.input)) seen.spoke = true;
  }
  return seen;
}

// js/cli/rituals-hook.ts
function hookInput() {
  try {
    if (!process.stdin.isTTY) return JSON.parse(readFileSync7(0, "utf8")) ?? {};
  } catch {
  }
  return {};
}
function printed(r) {
  if (!r || typeof r !== "object") return { output: String(r ?? ""), exit: null };
  const o = r;
  const exit = typeof o.exit_code === "number" ? o.exit_code : null;
  return { output: `${String(o.stdout ?? "")}
${String(o.stderr ?? "")}`, exit };
}
function riteWords(input, dir) {
  const cover = ritualCover(dir);
  if (!cover) return [];
  const event = input.hook_event_name;
  if (event === "SessionStart") {
    const source = typeof input.source === "string" ? input.source : "startup";
    if (source === "compact" || !cover.on.has("start")) return [];
    if (standingRites(cover.root, source).has("hook.start")) return [];
    return [startWord(cover)];
  }
  if (event !== "PostToolUse" || input.tool_name !== "Bash") return [];
  const own = standingRites(cover.root, "Bash");
  const call = {
    command: String(input.tool_input?.command ?? ""),
    ...printed(input.tool_response)
  };
  const said = [];
  const W = wordsIn(RITES, cover.lang);
  const push = cover.on.has("push") && !own.has("hook.push") ? pushedTo(call, dir) : null;
  if (push === "branch") said.push(W.push(cover.sections.check));
  if (push === "trunk" || cover.on.has("merge") && !own.has("hook.merge") && merged(call))
    said.push(W.merge(cover.holon, ...mergeHeads(cover.sections, push === "trunk")));
  return said;
}
function turnWord(input, dir) {
  if (input.stop_hook_active === true || typeof input.transcript_path !== "string") return null;
  const cover = ritualCover(dir);
  if (cover && !cover.on.has(TURN_RITE)) return null;
  const turn = lastTurn(input.transcript_path);
  return turn && lostWord(turn) ? wordsIn(TURN, cover?.lang).wake() : null;
}
try {
  const input = hookInput();
  const dir = typeof input.cwd === "string" && input.cwd ? input.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const reason = input.hook_event_name === "Stop" ? turnWord(input, dir) : null;
  if (reason) process.stdout.write(`${JSON.stringify({ decision: "block", reason })}
`);
  const said = riteWords(input, dir);
  if (said.length) {
    const hookEventName = String(input.hook_event_name);
    const additionalContext = said.join("\n\n");
    process.stdout.write(
      `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}
`
    );
  }
} catch {
}
process.exitCode = 0;
