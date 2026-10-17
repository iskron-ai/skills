#!/usr/bin/env node

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

// js/delivery/patterns/board.ts
var BOARD_HEADER = { ru: "Каналы", en: "Channels" };
var BOARD_FORM = {
  boardHeader: /^\s*(?:Каналы|Channels)(?:\s*\((\d+)\))?(?:\s|:|$)/m,
  boardEmpty: /^\s*(?:Ни одна роль этого графа (?:не держит канала|нигде не стоит)|No role (?:of|in) this graph (?:holds a channel|stands anywhere))/m,
  listens: /(^|·)\s*(?:слушает|listening)/,
  alive: /живой|слушает|\blive\b|listening/,
  undelivered: /(?:не доставлено|undelivered)\s+(\d+)/,
  seatId: /(?:id этого места|id of this (?:seat|place))[^\n]*\n\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
};

// js/delivery/patterns/caseexit.ts
var CASE_EXIT_CLOSED = /закрыт|снят|отозван|closed|revoked|not found|не найден/i;

// js/delivery/patterns/channel.ts
var ACTION_LIST_RE = /((?:одно из|one of):\s*)([a-z_]+(?:\s*\|\s*[a-z_]+)*)/i;
var SEAT_GONE_RE = /no such standing|take it with connect|такого стояния|занять.*connect/i;
var UNATTRIBUTED_RE = /не зарегистрирован[аоы]? ни за каким стоянием|hold no registered standing/i;

// js/delivery/patterns/config.ts
var SERVER_CHOICE = {
  ru: /^(ru|russian|русский)$/i,
  en: /^(en|ai|english|английский)$/i
};

// js/delivery/patterns/deliver.ts
var NOTICE_MARK = /ПОСТАВКА ОТСТАЛА|DELIVERY BEHIND/;

// js/delivery/patterns/launch.ts
var LAUNCH_WORD = "start";
var word = LAUNCH_WORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var LAUNCH_LINE = new RegExp(
  `^[ \\t]*${word}\\s+(\\S+)\\s+(\\S+)\\s+(?:(?:дело|case)\\s+)?[№#]\\s?(\\d+)(?:[ \\t]+(?:от|from)[ \\t]+(@\\S+))?(?=\\s|$)`,
  "imu"
);

// js/delivery/patterns/satprobe.ts
var SAT_LOGIN_RE = /\/login\b|oauth|authoriz|sign.?in|log.?in|вход|войд|токен отвергнут|\b401\b/i;
var SAT_OLD_FLAG_RE = /satellite|unknown (flag|option)|неизвестн/i;

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
var BRIDGE_SKILL = "establish-mcp";
var BRIDGE_FILE = `${PRODUCT}.mjs`;
var PLUGIN_FILE = "opencode-plugin.js";
var PLUGIN_COPY_FILE = `${PRODUCT}.js`;
var SKILL_STAMP_MASK = "*/SKILL.md";
var SKILL_SET = "iskron-ai/skills";
var PLUGIN_NAME = PRODUCT;
var SUB_ENTRY_PREFIX = `${PRODUCT}-sub`;
var CONNECTOR_PATTERN = /iskron|искрон|\bnks\b/i;
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
var SATELLITE_CODE = "const p=require('path').join(require('os').homedir(),'.iskron-bridge','iskron-bridge.mjs');process.argv.splice(1,0,p);import(require('url').pathToFileURL(p).href)";
var HOOKS_SECTION = { ru: "Хуки", en: "Hooks" };

// js/delivery/protocol.ts
var TOOL_PREFIX = `${PRODUCT}_`;
var tool = (name2) => `${TOOL_PREFIX}${name2}`;
var method = (name2) => `${PRODUCT}/${name2}`;
var LOGGERS = { channel: `${PRODUCT}-channel`, bridge: BRIDGE_NAME };
var FRAME_MARK = `[${PRODUCT}]`;
var ID_PREFIX = `${PRODUCT}-`;
var STRUCTURED_CAPABILITY = `${PRODUCT}/structured`;
var HALTS_CAPABILITY = `${PRODUCT}/halts`;
var serverProtocol = {
  refusal: "iskron/refusal"
};
var SERVER_LOCALE = { ru: "ru", en: "en" };

// js/delivery/version.ts
var VERSION = "7.13.0";
var BUILD_MARK = "iskron-build";
var CHANNEL_MARK = "iskron-build:release";

// js/delivery/words/absorb.ts
var ABSORB = {
  ru: {
    socketHidden: () => "(адрес сокета держит мост — агенту не показывается)",
    statusHidden: () => "(статусный адрес держит мост)",
    mainSeatHeld: (name2, held2) => `[iskron-bridge] ${name2 ?? "это место"} — основное место канала моста, а на канале стоят места других графов: ${held2}. Мост ничего не отпустил; снять основное — сперва сними их (revoke в их графе).`
  },
  en: {
    socketHidden: () => "(the bridge holds the socket address — it is not shown to the agent)",
    statusHidden: () => "(the bridge holds the status address)",
    mainSeatHeld: (name2, held2) => `[iskron-bridge] ${name2 ?? "this seat"} is the main seat of the bridge's channel, and seats of other graphs stand on the channel: ${held2}. The bridge released nothing; to remove the main one, first remove them (revoke in their graph).`
  }
};

// js/delivery/words/appserver.ts
var APPSERVER = {
  ru: {
    socketClosed: () => "сокет закрыт",
    doorNotOpened: (status) => `дверь не открылась: HTTP ${status}`
  },
  en: {
    socketClosed: () => "socket closed",
    doorNotOpened: (status) => `the door did not open: HTTP ${status}`
  }
};

// js/delivery/words/asks.ts
var ASK = {
  ru: {
    ask: (author, to, toPlace, key2, done, form, advice) => `${author} спрашивает роль ${to}${toPlace} [${key2}]: «${done}»${form}${advice}`,
    place: (place) => `(место ${place})`,
    yesNo: () => "ответ: да или нет (yes | no)",
    free: () => "ответ своим текстом",
    choice: (options) => `варианты: ${options}`,
    advice: (option, why) => `рекомендация: ${option}${why}`,
    answer: (author, refersTo, reply2) => `${author} отвечает на [${refersTo}]: ${reply2}`,
    ack: (refersTo, reply2, author) => `ответ [${refersTo}] принят${reply2} · ${author}`,
    withdrawn: (withdraws, key2, done, verdict, author) => `вопрос [${withdraws}] снят: [${key2}] [${done}] = ${verdict} · ${author}`,
    inviteOwnerless: (who, standing) => `платформа зовёт роль ${who} в дело: место ${standing} погасло, его строки ничьи`,
    inviteAnswerWaiting: (who, standing) => `платформа зовёт роль ${who} в дело: ответ ждёт приёма, спросившее место ${standing} ушло`
  },
  en: {
    ask: (author, to, toPlace, key2, done, form, advice) => `${author} asks the role ${to}${toPlace} [${key2}]: “${done}”${form}${advice}`,
    place: (place) => `(seat ${place})`,
    yesNo: () => "answer: yes or no (yes | no)",
    free: () => "answer in your own words",
    choice: (options) => `options: ${options}`,
    advice: (option, why) => `recommended: ${option}${why}`,
    answer: (author, refersTo, reply2) => `${author} answers [${refersTo}]: ${reply2}`,
    ack: (refersTo, reply2, author) => `answer [${refersTo}] accepted${reply2} · ${author}`,
    withdrawn: (withdraws, key2, done, verdict, author) => `question [${withdraws}] withdrawn: [${key2}] [${done}] = ${verdict} · ${author}`,
    inviteOwnerless: (who, standing) => `the platform calls the role ${who} to the case: the seat ${standing} is gone, its lines are nobody's`,
    inviteAnswerWaiting: (who, standing) => `the platform calls the role ${who} to the case: an answer awaits acceptance, the asking seat ${standing} has left`
  }
};

// js/delivery/words/frame-text.ts
var FRAME_TEXT = {
  ru: {
    myCases: () => `${tool("case")}(action="mine"), затем read каждого`,
    frame: (id) => `кадр ${id}`,
    yoursBelow: () => ` — адресованные строками ниже; `,
    noneYours: () => ` — адресованных месту нет; `,
    count: (head, n, mine) => `${head}: записей ${n}, тебе ${mine}`,
    supersededLines: (gone) => `, сменённых строк ключа ${gone}`,
    inFull: (cases) => `целиком — ${cases || FRAME_TEXT.ru.myCases()}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`
  },
  en: {
    myCases: () => `${tool("case")}(action="mine"), then read each`,
    frame: (id) => `frame ${id}`,
    yoursBelow: () => ` — yours in the lines below; `,
    noneYours: () => ` — none of them yours; `,
    count: (head, n, mine) => `${head}: ${n} records, yours ${mine}`,
    supersededLines: (gone) => `, ${gone} superseded lines of a key`,
    inFull: (cases) => `in full — ${cases || FRAME_TEXT.en.myCases()}`,
    caseHistory: (args, since) => `${tool("case")}(${args}, since=${since})`
  }
};
var CASE_LINE = {
  ru: {
    platform: () => "платформа",
    quote: (s2) => `«${s2}»`
  },
  en: {
    platform: () => "platform",
    quote: (s2) => `“${s2}”`
  }
};

// js/delivery/words/backlog.ts
var BACKLOG = {
  ru: {
    head: (count, expected, shown, direct) => `Побудка: кадров ${count}` + (expected ? ` (ожидало в очереди: ${expected})` : "") + (count > shown ? `, здесь первые ${shown}, не вошло ${count - shown}` : "") + ` — адресованные месту — текстом, прочие — счётом; целиком — по строкам дел ниже, не вошедшее — ${FRAME_TEXT.ru.myCases()}.` + (direct ? ` Прямых слов ${direct} — не здесь: каждое пришло отдельно и целиком.` : "")
  },
  en: {
    head: (count, expected, shown, direct) => `Wake-up: ${count} frames` + (expected ? ` (waiting in the queue: ${expected})` : "") + (count > shown ? `, the first ${shown} here, ${count - shown} left out` : "") + ` — those addressed to the seat as text, the rest by count; in full — by the case lines below, the rest — ${FRAME_TEXT.en.myCases()}.` + (direct ? ` ${direct} direct messages are not here: each came on its own and whole.` : "")
  }
};

// js/delivery/words/take.ts
var TAKE = {
  ru: {
    rule: () => "своё имя (та же роль, та же учётка) — сам, когда держатель молчит 5 минут на пробу словом (iskron_channel send); чужое (другая роль или учётка) — только словом человека"
  },
  en: {
    rule: () => "your own name (the same role, the same account) — by yourself when the holder stays silent 5 minutes to a probe by word (iskron_channel send); another's (another role or account) — only on the human's word"
  }
};

// js/delivery/words/call.ts
var CALL = {
  ru: {
    sameNamePrefix: () => "то же имя под другой ролью; ",
    heardAdvice: (other, asked, led) => `${other ? `место ${asked} слушает другая сессия` : `слушает ли место ${asked} другая сессия, мост не знает`} — его не трогай; своё место этого моста — ${led}: оставайся на нём либо назови другое name; встать рядом — iskron_stand без name; отнять место (take=true): ${TAKE.ru.rule()}`,
    sameKeysAdvice: () => "ключи совпали — это то же место: повтори iskron_stand с take=true, чтобы переоткрыть его сознательно",
    sameNameAdvice: () => "то же имя под другой ролью (оно вывелось из того же каталога) — передай другое name, либо iskron_stand с take=true, чтобы сменить место этого моста",
    takeOtherAdvice: () => "занять другое место вместо этого — iskron_stand с take=true (прежнее останется на доске без слуха; ненужное сними revoke)",
    otherPlace: (led, asked, advice) => `Отказано (мост): этот мост уже ведёт место ${led} — в графе место одно на мост, и место ${asked} его сняло бы с сокета молча. ${advice}; держать оба разом — второй мост, то есть другая сессия харнесса; место в другом графе встаёт рядом само.`,
    besideConnect: (led) => `Отказано (мост): этот мост ведёт место ${led}, а connect в другом графе открыл бы второй канал и снял бы его с сокета. Место в другом графе встаёт рядом на том же канале — iskron_stand(realm=…) или register.`,
    besideStand: (led) => `Отказано (мост): этот мост ведёт место ${led}, но сокета канала у него сейчас нет (ушёл с места или место отняли) — место другого графа встать рядом не может. Сперва верни ${led}: iskron_stand его графа.`,
    noReply: () => "ответа нет"
  },
  en: {
    sameNamePrefix: () => "the same name under another role; ",
    heardAdvice: (other, asked, led) => `${other ? `another session listens on the seat ${asked}` : `the bridge does not know whether another session listens on the seat ${asked}`} — leave it alone; this bridge's own seat is ${led}: stay on it or pass another name; to stand beside — iskron_stand without name; taking the seat (take=true): ${TAKE.en.rule()}`,
    sameKeysAdvice: () => "the keys match — it is the same seat: repeat iskron_stand with take=true to reopen it deliberately",
    sameNameAdvice: () => "the same name under another role (derived from the same directory) — pass another name, or iskron_stand with take=true to change this bridge's seat",
    takeOtherAdvice: () => "to take another seat instead of this one — iskron_stand with take=true (the former stays on the board without hearing; remove what is not needed with revoke)",
    otherPlace: (led, asked, advice) => `Refused (bridge): this bridge already leads the seat ${led} — one seat per bridge in a graph, and the seat ${asked} would silently take it off the socket. ${advice}; holding both at once needs a second bridge, that is another harness session; a seat in another graph stands beside by itself.`,
    besideConnect: (led) => `Refused (bridge): this bridge leads the seat ${led}, and a connect in another graph would open a second channel and take it off the socket. A seat in another graph stands beside on the same channel — iskron_stand(realm=…) or register.`,
    besideStand: (led) => `Refused (bridge): this bridge leads the seat ${led}, but has no channel socket now (it left the seat or the seat was taken) — a seat of another graph cannot stand beside. First bring back ${led}: iskron_stand for its graph.`,
    noReply: () => "no reply"
  }
};

// js/delivery/words/channel.ts
var CHANNEL = {
  ru: {
    deadTokenAdvice: (code) => code === 4002 ? `закрытие 4002 — место погасло по простою; вернуть его — ${tool("stand")} тем же именем` : `закрытие ${code} — токен мёртв, зови connect`,
    binaryFrame: () => "[двоичный кадр]",
    hung: (silent, ping) => `соединение молчит ${silent} с при пинге раз в ${ping} с — подвисло без закрытия; переоткрываю тем же адресом. Кадры, пришедшие за время молчания, могли пропасть — сверь дела: ${FRAME_TEXT.ru.myCases()}; прямое слово — попроси переслать`,
    rollout: () => "служба не отвечает — идёт раскатка, держу тот же токен"
  },
  en: {
    deadTokenAdvice: (code) => code === 4002 ? `close 4002 — the seat went out after idling; to return it — ${tool("stand")} with the same name` : `close ${code} — the token is dead, call connect`,
    binaryFrame: () => "[binary frame]",
    hung: (silent, ping) => `the connection has been silent for ${silent} s with a ping every ${ping} s — hung without closing; reopening at the same address. Frames that arrived during the silence may be lost — check the cases: ${FRAME_TEXT.en.myCases()}; a direct word — ask for it again`,
    rollout: () => "the service is not answering — a rollout is under way, keeping the same token"
  }
};

// js/delivery/words/cli.ts
var CLI = {
  ru: {
    usage: (build, rituals) => `iskron ${build}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug] [--satellite] [--tools <a,b,c>]
      (--satellite — мост прогона субагента из файла агента: только место-спутник <место позвавшего>.sub-N)
      (--tools — какие тулы видит харнес, iskron_stand всегда; без флага — все)
  node iskron.mjs watchdog [ключ] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-exit [ключ] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-codex [ключ] [--auth-dir <dir>] [--lang en|ru]   (из оболочки Codex: CODEX_THREAD_ID, CODEX_HOME)
      (--lang — язык поверхности; команду сторожа с ним печатает блок моста)
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs status [--json] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs stop <место|id сессии> [--realm <граф>] [--auth-dir <dir>] [--lang en|ru]   (приказ останова месту; старый api — снятие)
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs use <en|ru|url> [--auth-dir <dir>]   (en — mcp.iskron.ai, ru — mcp.iskron.ru)
  ${rituals}
  node iskron.mjs daemon --auth-dir <dir>   (демон машины; его поднимает тонкий мост — мост по умолчанию)
  node iskron.mjs version   (или --version)
  env: ISKRON_BRIDGE_TOKEN — личный токен вместо OAuth (или файл <auth-dir>/token);
       ISKRON_BRIDGE_DAEMON=0 — полный мост в своём процессе, без демона машины;
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`,
    homeUpdated: (path) => `[iskron-bridge] дом обновлён этой сборкой: ${path}
`,
    updateTitle: (build) => `iskron update — ${build}`,
    updateServer: (url, source, fresh2) => `сервер: ${url} (${source}) — ${fresh2}`,
    rateLimited: (error, reset) => `свежий релиз не узнан: ${error} — лимит GitHub; повтори ${reset ? "после сброса" : "позже"}`,
    latestUnknown: (error) => `свежий релиз не узнан: ${error ?? "нет ответа"} — сеть или GitHub; повтори позже`,
    lag: (cmp) => cmp > 0 ? " — отстал" : cmp < 0 ? " — новее релиза (сборка из ветки)" : " — не отстал",
    latest: (version, tag, mine, lag) => `свежий релиз: v${version} (${tag}); этот файл: v${mine}${lag}`,
    downloadFailed: (error) => `скачать не вышло: ${error}`,
    placed: (path) => `положено: ${path}`,
    nothingPlaced: (home) => `в дом ничего не клалось: ${home} не старше релиза`,
    next: () => "Дальше:",
    stepSkills: (setup, fetched) => `  1. Скиллы обновляет канал харнеса — порядок в свежем установщике ${setup}${fetched ? "" : " (не скачан — возьми из релиза)"}: прочти его и исполни шаги обновления для этого харнеса.`,
    stepRestart: () => "  2. Перезапусти сессии харнеса: мост, поднятый прежней сборкой, живёт до конца своей сессии.",
    stepDoctor: () => "  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — сверка, что стоит и работает.",
    useNoAddress: () => "use: назови адрес — en (mcp.iskron.ai), ru (mcp.iskron.ru) или полный URL инстанса",
    useWritten: (url, path, fresh2) => `мост смотрит на ${url} — записано в ${path}; ${fresh2}`,
    useEffect: () => "Действует с нового процесса моста: перезапусти сессии харнеса. Грант раздельный по адресу — первый вызов на новом адресе ведёт во вход."
  },
  en: {
    usage: (build, rituals) => `iskron ${build}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug] [--satellite] [--tools <a,b,c>]
      (--satellite — the bridge of a subagent run from an agent file: only the satellite seat <caller's seat>.sub-N)
      (--tools — which tools the harness sees, iskron_stand always; without the flag — all)
  node iskron.mjs watchdog [key] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-exit [key] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-codex [key] [--auth-dir <dir>] [--lang en|ru]   (from the Codex shell: CODEX_THREAD_ID, CODEX_HOME)
      (--lang — the surface language; the bridge block prints the watchdog command with it)
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs status [--json] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs stop <seat|session id> [--realm <graph>] [--auth-dir <dir>] [--lang en|ru]   (a stop order to the seat; an older api — a revoke)
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs use <en|ru|url> [--auth-dir <dir>]   (en — mcp.iskron.ai, ru — mcp.iskron.ru)
  ${rituals}
  node iskron.mjs daemon --auth-dir <dir>   (the machine daemon; the thin bridge raises it — the default bridge)
  node iskron.mjs version   (or --version)
  env: ISKRON_BRIDGE_TOKEN — a personal token instead of OAuth (or the file <auth-dir>/token);
       ISKRON_BRIDGE_DAEMON=0 — the full bridge in its own process, without the machine daemon;
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`,
    homeUpdated: (path) => `[iskron-bridge] home updated by this build: ${path}
`,
    updateTitle: (build) => `iskron update — ${build}`,
    updateServer: (url, source, fresh2) => `server: ${url} (${source}) — ${fresh2}`,
    rateLimited: (error, reset) => `latest release unknown: ${error} — GitHub rate limit; retry ${reset ? "after the reset" : "later"}`,
    latestUnknown: (error) => `latest release unknown: ${error ?? "no answer"} — network or GitHub; retry later`,
    lag: (cmp) => cmp > 0 ? " — behind" : cmp < 0 ? " — newer than the release (a branch build)" : " — not behind",
    latest: (version, tag, mine, lag) => `latest release: v${version} (${tag}); this file: v${mine}${lag}`,
    downloadFailed: (error) => `download failed: ${error}`,
    placed: (path) => `placed: ${path}`,
    nothingPlaced: (home) => `nothing was placed in the home: ${home} is not older than the release`,
    next: () => "Next:",
    stepSkills: (setup, fetched) => `  1. Skills are updated by the harness channel — the order is in the fresh installer ${setup}${fetched ? "" : " (not downloaded — take it from the release)"}: read it and carry out the update steps for this harness.`,
    stepRestart: () => "  2. Restart the harness sessions: a bridge started by the previous build lives until the end of its session.",
    stepDoctor: () => "  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — a check of what is installed and working.",
    useNoAddress: () => "use: name an address — en (mcp.iskron.ai), ru (mcp.iskron.ru) or the full URL of an instance",
    useWritten: (url, path, fresh2) => `the bridge looks at ${url} — written to ${path}; ${fresh2}`,
    useEffect: () => "Takes effect from a new bridge process: restart the harness sessions. The grant is separate per address — the first call at a new address leads to login."
  }
};

// js/delivery/words/deaf.ts
var DEAF = {
  ru: {
    takenByOther: (name2) => `место ${name2} без слуха (ушёл с него или токен мёртв), а доска читает его слушающим — его могла взять другая сессия`,
    unknownHearing: (name2) => `место ${name2} без слуха (ушёл с него или токен мёртв), а слушает ли его другая сессия, мост не знает`,
    refusal: (why) => `Отказано (мост): ${why}; его подписью вызов не уйдёт — не отправлен. Вернись iskron_stand: своё место мост вернёт сам, у чужого встанет рядом на имя.N со слухом.`
  },
  en: {
    takenByOther: (name2) => `the seat ${name2} has no hearing (left, or the token died), and the board reads it listening — another session may have taken it`,
    unknownHearing: (name2) => `the seat ${name2} has no hearing (left, or the token died), and the bridge does not know whether another session listens on it`,
    refusal: (why) => `Refused (bridge): ${why}; the call will not go under its signature — not sent. Stand again with iskron_stand: the bridge takes its own seat back by itself and stands beside another's on name.N with hearing.`
  }
};

// js/delivery/words/doctor.ts
var DOCTOR = {
  ru: {
    title: (build) => `iskron doctor — ${build}`,
    homeNone: (home) => `домашняя копия: нет (${home}) — её кладёт establish-mcp при подключении`,
    homeSame: (home) => `домашняя копия: ${home} — та же сборка, что и этот файл`,
    homeDiffers: (home, v, hash, selfPath2) => {
      const fix2 = selfPath2 ? `обнови её из поставки: cp "${selfPath2}" ${home}` : "этот файл не читается";
      return `домашняя копия: ${home} — v${v}+${hash}, ДРУГИЕ байты: ${fix2}`;
    },
    srcArgument: () => "аргумент запуска",
    srcEnv: () => "переменная ISKRON_BRIDGE_URL",
    srcFile: (p) => `файл выбора ${p}`,
    srcDefault: (p) => `по умолчанию; сменить — node <мост> use en | ru | <url>, файл ${p}`,
    freshProd: () => "продовый адрес: самообновление с релизов поставки включено",
    freshOther: () => "другой инстанс: обновлений с релизов поставки нет",
    server: (url, source) => `сервер: ${url} (${source})`,
    unreachable: (why) => `  недостижим: ${why}`,
    wantsOAuth: () => " (просит OAuth)",
    noTokenProbe: () => " (пробник без токена — отказ ожидаем)",
    answers: (status, note3) => `  отвечает: HTTP ${status}${note3}`,
    grantPat: (source) => `грант: личный токен (PAT) из ${source} — OAuth не используется`,
    patCheckFailed: (why) => `  проверить не вышло: ${why}`,
    patRejected: () => "  ТОКЕН ОТВЕРГНУТ (HTTP 401) — отозван, истёк или без прав на этот граф: выпусти новый на странице токенов графа",
    patAccepted: (status) => `  токен принят сервером (HTTP ${status})`,
    patOther: (status) => `  сервер ответил HTTP ${status} — не отказ токена, смотри строку «сервер»`,
    patStore: (path) => `  хранилище OAuth ${path} есть, но не читается, пока стоит PAT`,
    grant: (path) => `грант: ${path}`,
    noStore: () => "  хранилища нет — мост ещё ни разу не входил на этот сервер",
    noTokens: () => "  токенов нет",
    access: (usable, left2, span) => `  access: ${usable ? "годен" : "не годен"}${left2 !== null ? ` (${left2 > 0 ? "истекает через" : "истёк"} ${span})` : ""}`,
    refreshNone: () => "  refresh: нет",
    refreshValidIn: (s2) => `в силе через ${s2}`,
    refreshValid: () => "в силе",
    refreshExpired: () => "ИСТЁК — нужен вход",
    refreshExpiresIn: (s2) => `истекает через ${s2}`,
    refresh: (parts) => `  refresh: есть${parts ? ` (${parts})` : ""}`,
    refusedSince: (since, reason) => `  отказ стоит с ${since}: ${reason}`,
    lock: (p) => `  замок: ${p}`,
    grantLog: () => "  grant.log, последнее:",
    latestNotAsked: () => "свежий релиз: мост ещё не спрашивал релизы (спросит через пару секунд после старта сессии; руками — подкоманда update)",
    latestUnknown: (why, ago) => `свежий релиз: не узнан (${why ?? "без причины"}), спрашивал ${ago} мин назад`,
    latestBehind: (latest, v, downloaded, ago) => `свежий релиз: v${latest} — ЭТОТ ФАЙЛ ОТСТАЛ (v${v}); в дом скачано: ${downloaded || "ничего"}; спрашивал ${ago} мин назад`,
    latestCurrent: (latest, ago) => `свежий релиз: v${latest}, этот файл не отстал; спрашивал ${ago} мин назад`,
    pluginMissing: (registry) => `Claude Code: плагин iskron не установлен (${registry})`,
    entryNotFound: () => "запись моста в манифесте не найдена",
    entryFound: (name2) => `запись «${name2}» → мост из плагина`,
    unreadable: (p) => `${p} не читается`,
    pluginLine: (key2, v, scope, entry, path) => `Claude Code: плагин ${key2} v${v} (${scope}) — ${entry}; ${path}`,
    claudeUnreadable: (p) => `Claude Code: ${p} не читается`,
    codexNoManifest: () => "манифеста нет",
    codexManifest: (v, hit) => `v${v}, ${hit ? "запись моста в манифесте есть" : "записи моста в манифесте нет"}`,
    codexPlugin: (plugin, market, word3, dir2) => `Codex: плагин ${plugin}@${market} — ${word3}; ${dir2}`,
    codexNoPlugin: (cache) => `Codex: плагина iskron в кэше нет (${cache})`,
    claudeEntry: (name2, cmd, args) => `Claude Code: запись «${name2}» → ${cmd} ${args}`,
    claudeNoManual: () => "Claude Code: ручной записи моста в пользовательском конфиге нет (штатная — в плагине)",
    ocNoPlugin: (copy) => `OpenCode: плагина нет (${copy}) — его кладёт establish-mcp при подключении`,
    ocNoPackaged: (copy) => `OpenCode: плагин ${copy} стоит; рядом с этим файлом поставки плагина нет, сверить не с чем`,
    ocSame: (copy) => `OpenCode: плагин ${copy} — та же сборка, что в поставке`,
    ocDiffers: (copy, packaged) => `OpenCode: плагин ${copy} — ДРУГИЕ байты, обнови из поставки: cp "${packaged}" ${copy}`,
    codexHome: (h) => `Codex: дом ${h}`,
    codexDoorOpen: (door) => `Codex: дверь app-server открыта (${door})`,
    codexDoorNever: () => "Codex: двери нет и не будет — дом длиннее предела unix-сокета; нужен короткий дом для демона и сессий",
    codexDoorNone: (door) => `Codex: двери нет (${door}) — демон app-server не поднят; без неё кадр доставляет watchdog-exit`,
    codexManual: (has) => `Codex: ${has ? "ручная запись моста в config.toml есть" : "ручной записи моста в config.toml нет (штатная — в плагине)"}`,
    daemonOn: () => "демон машины: тонкий мост включён — умолчание (выключатель — ISKRON_BRIDGE_DAEMON=0 в окружении моста)",
    daemonOff: () => "демон машины: выключен — мост идёт полным (выключатель стоит в окружении этого процесса: ISKRON_BRIDGE_DAEMON=0 или ISKRON_BRIDGE_NO_DAEMON)",
    daemonNeverUp: (dir2) => `  не поднимался: каталога шва ${dir2} нет`,
    daemonGrant: (dir2) => `  каталог гранта: ${dir2} — один демон на каталог`,
    daemonSocket: (s2) => `  вход, сокет: ${s2}`,
    fallbackNone: () => "  мимо демона (полным мостом в своём процессе — запасным путём или выключателем) не идёт ни одна сессия",
    fallbackCount: (n) => `  мимо демона (полным мостом в своём процессе — запасным путём или выключателем) идут сессий: ${n} — демон их не видит и в «сессий» не считает`,
    fallbackOne: (pid, build, since, cwd, why) => `    pid ${pid}, сборка ${build}, с ${since}, каталог ${cwd}: ${why}`,
    daemonAnswers: (pid, build, other, v, sessions, path) => `  отвечает: pid ${String(pid)}, сборка ${build}${other ? ` — ДРУГАЯ, чем этот файл (v${v})` : ""}, сессий ${String(sessions ?? "?")}${path ? `, файл ${path}` : ""}`,
    daemonUnsafe: (why) => `  вход не личный: ${String(why)} — тонкий мост пойдёт полным`,
    daemonSilent: (socket, why) => `  сокет: ${String(socket)} — не отвечает (${String(why)})`,
    thisFile: (p) => `этот файл: ${p}`
  },
  en: {
    title: (build) => `iskron doctor — ${build}`,
    homeNone: (home) => `home copy: none (${home}) — establish-mcp places it on connect`,
    homeSame: (home) => `home copy: ${home} — the same build as this file`,
    homeDiffers: (home, v, hash, selfPath2) => {
      const fix2 = selfPath2 ? `update it from the delivery: cp "${selfPath2}" ${home}` : "this file is unreadable";
      return `home copy: ${home} — v${v}+${hash}, DIFFERENT bytes: ${fix2}`;
    },
    srcArgument: () => "launch argument",
    srcEnv: () => "the ISKRON_BRIDGE_URL variable",
    srcFile: (p) => `choice file ${p}`,
    srcDefault: (p) => `the default; to change — node <bridge> use en | ru | <url>, file ${p}`,
    freshProd: () => "production address: self-update from the delivery releases is on",
    freshOther: () => "another instance: there are no updates from the delivery releases",
    server: (url, source) => `server: ${url} (${source})`,
    unreachable: (why) => `  unreachable: ${why}`,
    wantsOAuth: () => " (asks for OAuth)",
    noTokenProbe: () => " (a probe without a token — a refusal is expected)",
    answers: (status, note3) => `  answers: HTTP ${status}${note3}`,
    grantPat: (source) => `grant: a personal token (PAT) from ${source} — OAuth is not used`,
    patCheckFailed: (why) => `  the check failed: ${why}`,
    patRejected: () => "  TOKEN REJECTED (HTTP 401) — revoked, expired or without rights to this graph: issue a new one on the graph's token page",
    patAccepted: (status) => `  the token is accepted by the server (HTTP ${status})`,
    patOther: (status) => `  the server answered HTTP ${status} — not a token refusal, see the "server" line`,
    patStore: (path) => `  the OAuth store ${path} exists but is not read while a PAT is set`,
    grant: (path) => `grant: ${path}`,
    noStore: () => "  no store — the bridge has never logged in to this server",
    noTokens: () => "  no tokens",
    access: (usable, left2, span) => `  access: ${usable ? "usable" : "not usable"}${left2 !== null ? ` (${left2 > 0 ? "expires in" : "expired"} ${span})` : ""}`,
    refreshNone: () => "  refresh: none",
    refreshValidIn: (s2) => `valid in ${s2}`,
    refreshValid: () => "valid",
    refreshExpired: () => "EXPIRED — a login is needed",
    refreshExpiresIn: (s2) => `expires in ${s2}`,
    refresh: (parts) => `  refresh: present${parts ? ` (${parts})` : ""}`,
    refusedSince: (since, reason) => `  a refusal stands since ${since}: ${reason}`,
    lock: (p) => `  lock: ${p}`,
    grantLog: () => "  grant.log, latest:",
    latestNotAsked: () => "latest release: the bridge has not asked about releases yet (it will in a couple of seconds after the session starts; by hand — the update subcommand)",
    latestUnknown: (why, ago) => `latest release: unknown (${why ?? "no reason"}), asked ${ago} min ago`,
    latestBehind: (latest, v, downloaded, ago) => `latest release: v${latest} — THIS FILE IS BEHIND (v${v}); downloaded to the home: ${downloaded || "nothing"}; asked ${ago} min ago`,
    latestCurrent: (latest, ago) => `latest release: v${latest}, this file is not behind; asked ${ago} min ago`,
    pluginMissing: (registry) => `Claude Code: the iskron plugin is not installed (${registry})`,
    entryNotFound: () => "no bridge entry found in the manifest",
    entryFound: (name2) => `entry "${name2}" → the bridge from the plugin`,
    unreadable: (p) => `${p} is unreadable`,
    pluginLine: (key2, v, scope, entry, path) => `Claude Code: plugin ${key2} v${v} (${scope}) — ${entry}; ${path}`,
    claudeUnreadable: (p) => `Claude Code: ${p} is unreadable`,
    codexNoManifest: () => "no manifest",
    codexManifest: (v, hit) => `v${v}, ${hit ? "the bridge entry is in the manifest" : "no bridge entry in the manifest"}`,
    codexPlugin: (plugin, market, word3, dir2) => `Codex: plugin ${plugin}@${market} — ${word3}; ${dir2}`,
    codexNoPlugin: (cache) => `Codex: no iskron plugin in the cache (${cache})`,
    claudeEntry: (name2, cmd, args) => `Claude Code: entry "${name2}" → ${cmd} ${args}`,
    claudeNoManual: () => "Claude Code: no manual bridge entry in the user config (the standard one is in the plugin)",
    ocNoPlugin: (copy) => `OpenCode: no plugin (${copy}) — establish-mcp places it on connect`,
    ocNoPackaged: (copy) => `OpenCode: the plugin ${copy} is installed; there is no plugin next to this delivery file, nothing to compare with`,
    ocSame: (copy) => `OpenCode: the plugin ${copy} — the same build as in the delivery`,
    ocDiffers: (copy, packaged) => `OpenCode: the plugin ${copy} — DIFFERENT bytes, update from the delivery: cp "${packaged}" ${copy}`,
    codexHome: (h) => `Codex: home ${h}`,
    codexDoorOpen: (door) => `Codex: the app-server door is open (${door})`,
    codexDoorNever: () => "Codex: there is no door and there will not be — the home is longer than the unix socket limit; a short home is needed for the daemon and sessions",
    codexDoorNone: (door) => `Codex: no door (${door}) — the app-server daemon is not up; without it the frame is delivered by watchdog-exit`,
    codexManual: (has) => `Codex: ${has ? "there is a manual bridge entry in config.toml" : "no manual bridge entry in config.toml (the standard one is in the plugin)"}`,
    daemonOn: () => "machine daemon: the thin bridge is on — the default (the switch is ISKRON_BRIDGE_DAEMON=0 in the bridge environment)",
    daemonOff: () => "machine daemon: off — the bridge runs full (the switch is set in this process environment: ISKRON_BRIDGE_DAEMON=0 or ISKRON_BRIDGE_NO_DAEMON)",
    daemonNeverUp: (dir2) => `  never started: the seam directory ${dir2} does not exist`,
    daemonGrant: (dir2) => `  grant directory: ${dir2} — one daemon per directory`,
    daemonSocket: (s2) => `  entrance, socket: ${s2}`,
    fallbackNone: () => "  no session goes around the daemon (the full bridge in its own process — the fallback path or the switch)",
    fallbackCount: (n) => `  sessions around the daemon (the full bridge in its own process — the fallback path or the switch): ${n} — the daemon does not see them nor count them in "sessions"`,
    fallbackOne: (pid, build, since, cwd, why) => `    pid ${pid}, build ${build}, since ${since}, directory ${cwd}: ${why}`,
    daemonAnswers: (pid, build, other, v, sessions, path) => `  answers: pid ${String(pid)}, build ${build}${other ? ` — DIFFERENT from this file (v${v})` : ""}, sessions ${String(sessions ?? "?")}${path ? `, file ${path}` : ""}`,
    daemonUnsafe: (why) => `  the entrance is not private: ${String(why)} — the thin bridge will go full`,
    daemonSilent: (socket, why) => `  socket: ${String(socket)} — not answering (${String(why)})`,
    thisFile: (p) => `this file: ${p}`
  }
};

// js/delivery/words/doctorharness.ts
var HARNESS = {
  ru: {
    launchFix: (harness, entry, node, bridge) => {
      const abs = node ?? "<абсолютный путь к node: command -v node>";
      const shell = "запускай харнесс из оболочки, где node находится";
      const alt = harness === "codex" ? "плагинной записи Codex абсолютного пути не вписать, а вторая запись рядом дала бы два моста" : `либо запись с абсолютным путём к node, от PATH не зависящая: ${entry ? `claude mcp remove "${entry}" --scope user, затем ` : ""}claude mcp add --scope user "${entry ?? "iskron-bridge"}" -- ${abs} "${bridge}"${entry ? "" : " — и выключи запись плагина plugin:iskron:iskron в /mcp, чтобы мост был один"}; путь привязан к этой установке node — сменишь её, перепиши запись`;
      return `    ход: ${shell}; ${alt}`;
    },
    launchNotFound: (who, cmd, absolute) => `${who}: команда «${cmd}» не найдена${absolute ? "" : " в PATH этой оболочки"} или не исполнима — харнесс мост не поднимет (spawn ENOENT)`,
    launchAbsolute: (who, cmd) => `${who}: команда ${cmd} — исполнима, от PATH не зависит`,
    launchFound: (who, cmd, found) => `${who}: «${cmd}» → ${found}`,
    launchProfile: (who, cmd, found, dir2) => `${who}: «${cmd}» → ${found} — в PATH этой оболочки; каталог ${dir2} кладёт туда профиль оболочки или менеджер версий, и харнесс, запущенный не из оболочки (приложение, сервис), его может не увидеть. Какой PATH у харнесса, отсюда не видно; пишет харнесс spawn ENOENT — ход строкой ниже`,
    openCodeRuntime: () => "OpenCode: мост плагина бежит на рантайме самого OpenCode — от node в PATH не зависит",
    secondPath: (where, name2, url, remove) => `${where}: запись «${name2}» ведёт ${url} напрямую по http, мимо моста — второй путь к тому же серверу: тулы двоятся, записи этого пути уходят без места. Путь к графу один — мост → убери её: ${remove}`,
    deleteFrom: (file) => `удали её из ${file}`,
    connector: (name2, file) => `Claude Code: коннектор «${name2}» в истории подключений (${file}, claudeAiMcpEverConnected; строка останется и после снятия) — коннекторы claude.ai приходят в каждую сессию Claude Code рядом с мостом, а адреса коннектора на диске нет. Если он стоит и ведёт на сервер графа — это второй путь мимо моста → убери его в claude.ai (Настройки → Коннекторы) или выключи в Claude Code (/mcp)`,
    skillsOtherChannel: (pi) => `тем каналом, которым набор ставили (pi — ${pi}; порядок — SETUP.md, раздел «Обновление»)`,
    skillsNone: () => "скиллы: набора поставки не нашёл (плагин Claude Code, плагин Codex, ~/.agents/skills, ISKRON_SKILLS_ROOT)",
    skillsUnreadable: (root) => `скиллы: ${root} — версия набора не читается`,
    skillsCurrent: (root, v) => `скиллы: ${root} — v${v}, не ниже моста`,
    skillsBelowBridge: (bridge) => `НИЖЕ моста v${bridge}: метод в контексте агента старше моста`,
    skillsBelowRelease: (release) => `НИЖЕ релиза v${release}, вровень с мостом: отстала поставка целиком (мост — подкоманда update)`,
    skillsBehind: (root, v, why, how2) => `скиллы: ${root} — v${v}, ${why} → обнови набор: ${how2}; затем новая сессия`,
    ocUnreadable: (file) => `OpenCode: ${file} не читается`,
    ocDisabled: (name2, file) => `OpenCode: запись mcp «${name2}» в ${file} ведёт Искрон, но выключена — не в игре`,
    ocBridge: (name2, file, path) => `OpenCode: запись mcp «${name2}» в ${file} зовёт ${path} — похоже на мост поставки. Если это он, её тулы namespaced, а мост общий для сессий сервиса: запись может уйти под подписью соседней сессии. Тогда убери её из этого файла руками: у opencode mcp есть list, add, auth, logout — команды remove нет. Поверхность поставки это плагин`,
    ocHttp: (name2, file) => `OpenCode: запись mcp «${name2}» в ${file} ведёт Искрон напрямую по http, мимо моста — её тулы namespaced, стояния канала у неё нет, и записи уходят без места. Путь к графу один — мост, его приносит плагин поставки. Убери её из этого файла руками: у opencode mcp есть list, add, auth, logout — команды remove нет`,
    ocNone: (unreadable, cwd) => `OpenCode: записей mcp Искрона не нашёл${unreadable ? ` в том, что прочёл (${unreadable} файл(а) не разобрались — смотри строки выше)` : ""} — смотрел вверх от ${cwd}, глобальный слой и переменные; запись в другом дереве этим не проверена, позови doctor из каталога проекта`
  },
  en: {
    launchFix: (harness, entry, node, bridge) => {
      const abs = node ?? "<absolute node path: command -v node>";
      const shell = "start the harness from a shell where node is found";
      const alt = harness === "codex" ? "the Codex plugin entry takes no absolute path, and a second entry beside it would make two bridges" : `or an entry with the absolute node path, independent of PATH: ${entry ? `claude mcp remove "${entry}" --scope user, then ` : ""}claude mcp add --scope user "${entry ?? "iskron-bridge"}" -- ${abs} "${bridge}"${entry ? "" : " — and disable the plugin entry plugin:iskron:iskron in /mcp so the bridge is one"}; the path is tied to this node install — change it, rewrite the entry`;
      return `    fix: ${shell}; ${alt}`;
    },
    launchNotFound: (who, cmd, absolute) => `${who}: the command "${cmd}" is not found${absolute ? "" : " in this shell's PATH"} or not executable — the harness will not raise the bridge (spawn ENOENT)`,
    launchAbsolute: (who, cmd) => `${who}: the command ${cmd} is executable and independent of PATH`,
    launchFound: (who, cmd, found) => `${who}: "${cmd}" → ${found}`,
    launchProfile: (who, cmd, found, dir2) => `${who}: "${cmd}" → ${found} — in this shell's PATH; the directory ${dir2} is put there by the shell profile or a version manager, and a harness started outside a shell (an app, a service) may not see it. The harness's PATH cannot be seen from here; if the harness says spawn ENOENT — the fix is on the next line`,
    openCodeRuntime: () => "OpenCode: the plugin's bridge runs on OpenCode's own runtime — independent of node in PATH",
    secondPath: (where, name2, url, remove) => `${where}: the entry "${name2}" leads to ${url} directly over http, around the bridge — a second path to the same server: the tools double, and writes on this path go out without a seat. The one path to the graph is the bridge → remove it: ${remove}`,
    deleteFrom: (file) => `delete it from ${file}`,
    connector: (name2, file) => `Claude Code: the connector "${name2}" is in the connection history (${file}, claudeAiMcpEverConnected; the line stays after removal) — claude.ai connectors come into every Claude Code session next to the bridge, and the connector's address is not on disk. If it is installed and leads to the graph server, it is a second path around the bridge → remove it in claude.ai (Settings → Connectors) or disable it in Claude Code (/mcp)`,
    skillsOtherChannel: (pi) => `by the channel the set was installed with (pi — ${pi}; the order — SETUP.md, section «Update»)`,
    skillsNone: () => "skills: no delivery set found (the Claude Code plugin, the Codex plugin, ~/.agents/skills, ISKRON_SKILLS_ROOT)",
    skillsUnreadable: (root) => `skills: ${root} — the set's version is unreadable`,
    skillsCurrent: (root, v) => `skills: ${root} — v${v}, not behind the bridge`,
    skillsBelowBridge: (bridge) => `BEHIND the bridge v${bridge}: the method in the agent's context is older than the bridge`,
    skillsBelowRelease: (release) => `BEHIND the release v${release}, level with the bridge: the whole delivery is behind (the bridge — the update subcommand)`,
    skillsBehind: (root, v, why, how2) => `skills: ${root} — v${v}, ${why} → update the set: ${how2}; then a new session`,
    ocUnreadable: (file) => `OpenCode: ${file} is unreadable`,
    ocDisabled: (name2, file) => `OpenCode: the mcp entry "${name2}" in ${file} leads to Iskron but is disabled — not in play`,
    ocBridge: (name2, file, path) => `OpenCode: the mcp entry "${name2}" in ${file} calls ${path} — it looks like the delivery bridge. If it is, its tools are namespaced, and the bridge is shared by the service's sessions: the entry may go out under a neighbouring session's signature. Then remove it from this file by hand: opencode mcp has list, add, auth, logout — there is no remove command. The delivery surface is the plugin`,
    ocHttp: (name2, file) => `OpenCode: the mcp entry "${name2}" in ${file} leads to Iskron directly over http, around the bridge — its tools are namespaced, it has no channel standing, and its writes go out without a seat. The one path to the graph is the bridge, brought by the delivery plugin. Remove it from this file by hand: opencode mcp has list, add, auth, logout — there is no remove command`,
    ocNone: (unreadable, cwd) => `OpenCode: found no Iskron mcp entries${unreadable ? ` in what I read (${unreadable} file(s) could not be parsed — see the lines above)` : ""} — looked upward from ${cwd}, the global layer and variables; an entry in another tree is not checked by this, call doctor from the project directory`
  }
};

// js/delivery/words/door.ts
var DOOR = {
  ru: {
    privateDir: (bad) => `ДЕЛАТЕЛЬ: локальный сокет стояния не поднят — ${bad}`,
    listenFailed: (message) => `ДЕЛАТЕЛЬ: локальный сокет стояния не поднялся (${message}) — сторожу не к чему цепляться`
  },
  en: {
    privateDir: (bad) => `DOER: the local standing socket is not up — ${bad}`,
    listenFailed: (message) => `DOER: the local standing socket did not come up (${message}) — the watchdog has nothing to attach to`
  }
};

// js/delivery/words/handoff.ts
var HANDOFF = {
  ru: {
    strayFrame: (id, to, key2, raw) => `ДЕЛАТЕЛЬ: кадр ${id} из спула смены демона адресован месту ${to}, не вернувшемуся, — не кадр места ${key2}; вернуть место — iskron_stand в его графе. Кадр: ${raw}`
  },
  en: {
    strayFrame: (id, to, key2, raw) => `DOER: frame ${id} from the daemon-change spool is addressed to the seat ${to}, which has not returned — not a frame of the seat ${key2}; to bring the seat back — iskron_stand in its graph. Frame: ${raw}`
  }
};

// js/delivery/words/hearing.ts
var HEARING = {
  ru: {
    unresolvedAgent: (what) => `Отказано (мост): karta="agent" — мост не ведёт места в этом графе и не знает, какой роли это имя у этой сессии, а место под сентинелом не сличить ни с доской, ни с прежним держанием (${what} мог бы встать вторым местом или взять чужое). Назови роль числом — роль агента из AGENTS.md.`,
    otherListens: (seat2) => `место ${seat2} слушает другая сессия`,
    unknownListens: (seat2) => `слушает ли место ${seat2} другая сессия, мост не знает (доска не прочлась или разобрана не целиком)`,
    rawSeatRefusal: (who, action) => `Отказано (мост): ${who} — ${action} ${action === "register" ? "подписал бы записи чужим местом" : "отнял бы его"}; вызов не отправлен. Встань iskron_stand: своё место мост вернёт сам, у чужого встанет рядом на имя.N со слухом.`
  },
  en: {
    unresolvedAgent: (what) => `Refused (bridge): karta="agent" — the bridge leads no seat in this graph and does not know which role this session held the name under, and a seat under the sentinel matches neither the board nor a former hold (${what} could make a second seat or take another's). Name the role by number — the agent's role from AGENTS.md.`,
    otherListens: (seat2) => `another session listens on the seat ${seat2}`,
    unknownListens: (seat2) => `the bridge does not know whether another session listens on the seat ${seat2} (the board did not read, or not all of it)`,
    rawSeatRefusal: (who, action) => `Refused (bridge): ${who} — ${action} ${action === "register" ? "would sign writes with another's seat" : "would take it"}; the call was not sent. Stand with iskron_stand: the bridge takes its own seat back by itself and stands beside another's on name.N with hearing.`
  }
};

// js/delivery/words/hold.ts
var HOLD = {
  ru: {
    newSocket: () => "новый сокет",
    revokedOwn: () => "снято своим revoke",
    closedOwn: () => "канал закрыт своим close этой сессии — место отпущено, токен жив; встать снова — iskron_stand",
    resumeFailed: () => "возврат с диска не удался",
    tokenDead: () => "место погасло по простою (4002)",
    parked: (reason) => `мост ушёл с места (${reason}) — сокет закрыт, место цело; возврат — сторож или iskron_stand`,
    evicted: (code) => `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли, слушает другой держатель; записи в этот граф мост не отправит, пока не встанешь своим местом — его подписью они легли бы; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true): ${TAKE.ru.rule()}`,
    evictedBeside: (code, name2, base) => `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли (${name2}), слушает другой держатель; его место не перехватываю и им не подписываюсь — встаю рядом на ${base}.N со слухом сам; исход — следующим словом, место и команду сторожа скажет iskron_stand тем же вызовом; вытеснить ту сессию (take=true): ${TAKE.ru.rule()}`,
    besideDone: (name2, said2) => `Искрон: место ${name2} отняли (4000) — мост встал рядом своим местом со слухом. ${said2}`,
    besideFailed: (name2, base, said2) => `Искрон: место ${name2} отняли (4000), встать рядом мост не смог — слуха нет: ${said2} Ход — iskron_stand с name=${base} без take: мост встанет рядом на ${base}.N со слухом.`,
    evictedRefusal: (name2, base) => `Отказано (мост): место ${name2} отняли (4000), его слушает другой держатель, а встать рядом мост пока не смог — запись легла бы под его подписью; вызов не отправлен. Ход — iskron_stand с name=${base} без take: мост встанет рядом на ${base}.N со слухом; затем повтори вызов.`,
    besideOther: (place, ok, said2) => ok ? `Место другого графа ${place} было на отнятом канале — встало снова на новом. ${said2}` : `Место другого графа ${place} было на отнятом канале и снова не встало — слуха там нет: ${said2} Ход — iskron_stand в том графе тем же именем.`,
    takenBySession: () => "место взял новый мост этой же сессии — этот экземпляр отпускает сокет, слух — у нового",
    dead: (advice) => `ДЕЛАТЕЛЬ: ${advice}`,
    alive: (version) => `ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает (${version}) — место держу, переоткрываю реже; не пройдёт — спроси о токене`
  },
  en: {
    newSocket: () => "new socket",
    revokedOwn: () => "revoked by this session",
    closedOwn: () => "the channel was closed by this session's own close — the seat is released, the token is alive; to stand again — iskron_stand",
    resumeFailed: () => "resume from disk failed",
    tokenDead: () => "the seat went out after idling (4002)",
    parked: (reason) => `the bridge left the seat (${reason}) — socket closed, seat intact; to return use the watchdog or iskron_stand`,
    evicted: (code) => `DOER: close ${code} — the seat was taken, another holder is listening; the bridge sends no writes into this graph until you stand on your own seat — they would go under its signature; to listen here, iskron_stand without name stands beside on name.N; to retake the seat (take=true): ${TAKE.en.rule()}`,
    evictedBeside: (code, name2, base) => `DOER: close ${code} — the seat ${name2} was taken, another holder is listening; not taking it over and not signing with it — standing beside as ${base}.N with hearing myself; the outcome comes next, iskron_stand with the same call tells the seat and the watchdog command; evicting that session (take=true): ${TAKE.en.rule()}`,
    besideDone: (name2, said2) => `Iskron: the seat ${name2} was taken (4000) — the bridge stood beside on its own seat with hearing. ${said2}`,
    besideFailed: (name2, base, said2) => `Iskron: the seat ${name2} was taken (4000), and the bridge could not stand beside — no hearing: ${said2} The move — iskron_stand with name=${base} without take: the bridge stands beside as ${base}.N with hearing.`,
    evictedRefusal: (name2, base) => `Refused (bridge): the seat ${name2} was taken (4000), another holder listens on it, and the bridge could not stand beside yet — the write would go under its signature; the call was not sent. The move — iskron_stand with name=${base} without take: the bridge stands beside as ${base}.N with hearing; then repeat the call.`,
    besideOther: (place, ok, said2) => ok ? `The seat of another graph ${place} was on the taken channel — it stands again on the new one. ${said2}` : `The seat of another graph ${place} was on the taken channel and did not stand again — no hearing there: ${said2} The move — iskron_stand in that graph with the same name.`,
    takenBySession: () => "a new bridge of this same session took the seat — this instance lets the socket go, the hearing is the new one's",
    dead: (advice) => `DOER: ${advice}`,
    alive: (version) => `DOER: the socket keeps being cut while the service answers (${version}) — holding the seat, reopening less often; if it fails, ask about the token`
  }
};

// js/delivery/words/leave.ts
var LEAVE = {
  ru: {
    notHolding: () => "мост места не держит — уходить неоткуда",
    cleared: () => "занятость снята",
    notCleared: (body) => `занятость не снята (${body})`,
    seats: (keys) => `с мест ${keys} (сокет канала у них общий)`,
    seat: (key2) => `с места ${key2}`,
    leftByWord: (which2, line) => `ушёл ${which2}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится; место отпущено словом, само не вернётся — вернуть: iskron_stand тем же именем`,
    left: (which2, line) => `ушёл ${which2}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится и придёт при возвращении (сторож или iskron_stand)`,
    satelliteReleased: () => "место-спутник отпущено целиком",
    leftSatellite: (place, line) => `ушёл с места-спутника ${place}: сокет закрыт, ${line}; место отпущено целиком — ни сторож, ни возврат его не поднимут; встать снова — iskron_stand с satellite_of`,
    returned: (how2, status) => `мост вернулся на место (${how2}) — сокет открыт заново тем же адресом${status ? `, занятость «${status}» возвращена` : ""}`,
    noHello: () => "сокет, открытый заново тем же адресом, не дал hello — адрес мог повернуть другой",
    watchdogAttached: () => "прицепился сторож",
    nobodyListens: (min) => `никто не слушает ${min} мин`,
    byDoerWord: () => "по слову делателя",
    refusedBeside: (beside, led, realm) => `Отказано (мост): место ${beside} стоит на общем канале моста рядом с ${led} — уход закрыл бы сокет всем местам канала. Уйти со всех — leave в графе ${realm ?? "основного места"}; снять только это место — revoke.`,
    refusedOther: (realm, led, ledRealm) => `Отказано (мост): в графе ${realm} этот мост места не держит — уходить неоткуда; его место ${led} в графе ${ledRealm} не тронуто.`,
    refusedNamed: (standing, led) => `Отказано (мост): ${standing} — не место этого моста, вызов не отправлен; leave отпускает только место этого моста${led ? ` (${led}, не тронуто)` : " (сейчас он места не держит)"}; лишнее место своей учётки снимает revoke(karta, standing=${standing}) — только словом человека: revoke уничтожает входящий адрес и хуки места.`
  },
  en: {
    notHolding: () => "the bridge holds no seat — nothing to leave",
    cleared: () => "busyness cleared",
    notCleared: (body) => `busyness not cleared (${body})`,
    seats: (keys) => `the seats ${keys} (they share the channel socket)`,
    seat: (key2) => `the seat ${key2}`,
    leftByWord: (which2, line) => `left ${which2}: the socket is closed, ${line}; address, queue and hooks intact — mail piles up; the seat is released by word and will not return by itself — to bring it back: iskron_stand with the same name`,
    left: (which2, line) => `left ${which2}: the socket is closed, ${line}; address, queue and hooks intact — mail piles up and arrives on return (the watchdog or iskron_stand)`,
    satelliteReleased: () => "the satellite seat is released whole",
    leftSatellite: (place, line) => `left the satellite seat ${place}: the socket is closed, ${line}; the seat is released whole — neither the watchdog nor a return will raise it; to stand again — iskron_stand with satellite_of`,
    returned: (how2, status) => `the bridge is back on the seat (${how2}) — the socket is reopened at the same address${status ? `, busyness "${status}" restored` : ""}`,
    noHello: () => "the socket reopened at the same address gave no hello — another may have turned the address",
    watchdogAttached: () => "a watchdog attached",
    nobodyListens: (min) => `nobody has listened for ${min} min`,
    byDoerWord: () => "by the doer's word",
    refusedBeside: (beside, led, realm) => `Refused (bridge): the seat ${beside} stands on the bridge's shared channel beside ${led} — leaving would close the socket for all seats of the channel. To leave all — leave in the graph ${realm ?? "of the main seat"}; to remove only this seat — revoke.`,
    refusedOther: (realm, led, ledRealm) => `Refused (bridge): this bridge holds no seat in the graph ${realm} — nothing to leave; its seat ${led} in the graph ${ledRealm} is untouched.`,
    refusedNamed: (standing, led) => `Refused (bridge): ${standing} is not this bridge's seat, the call was not sent; leave releases only this bridge's seat${led ? ` (${led}, untouched)` : " (it holds no seat now)"}; a spare seat of your own account is removed by revoke(karta, standing=${standing}) — only on the human's word: revoke destroys the seat's incoming address and hooks.`
  }
};

// js/delivery/words/listen.ts
var LISTEN = {
  ru: {
    block: (listen) => `[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно (строка выше о том, что никто не слушает, описывает миг до этого держания).
${listen}
Занятость: iskron_stand(realm, status) на этом месте — пустой status снимает.
Кадры приходят и уведомлениями MCP (logger iskron-channel).`,
    unheard: (listen) => `[iskron-bridge] Сторож к этому месту не прицеплен — кадры копятся. ${listen}`,
    monitor: (self, key2, where) => `под Monitor — node "${self}" watchdog ${key2}${where} с наибольшим timeout_ms, перевзводить по истечении (Claude Code)`,
    exit: (self, key2, where) => `фоновой задачей — node "${self}" watchdog-exit ${key2}${where} (выходит нулём на первом сообщении)`,
    codex: (self, key2, where) => `в Codex внутри одной длинной команды своей оболочки — node "${self}" watchdog-codex ${key2}${where} & …; kill %1 (кадр входит в идущий тред через app-server; отдельной командой с nohup сторож умирает вместе с ней)`,
    self: (pi) => `Слушает ${pi ? "расширение pi" : "плагин OpenCode"} само — сторож не нужен, кадры входят в ход.`,
    claude: (monitor, exit) => `Слушать: ${monitor}; без Monitor — ${exit}.`,
    codexLine: (codex, exit) => `Слушать: ${codex}; без двери app-server — ${exit}.`,
    any: (monitor, exit, codex) => `Слушать: ${monitor}; ${exit}; ${codex}.`
  },
  en: {
    block: (listen) => `[iskron-bridge] The bridge holds this standing's socket — there is no one to hand it to (a line above saying no one listens describes the moment before this holding).
${listen}
Busy line: iskron_stand(realm, status) on this seat — an empty status clears it.
Frames also come as MCP notifications (logger iskron-channel).`,
    unheard: (listen) => `[iskron-bridge] No watchdog is attached to this seat — frames pile up. ${listen}`,
    monitor: (self, key2, where) => `under Monitor — node "${self}" watchdog ${key2}${where} with the largest timeout_ms, re-armed when it runs out (Claude Code)`,
    exit: (self, key2, where) => `as a background task — node "${self}" watchdog-exit ${key2}${where} (exits zero on the first message)`,
    codex: (self, key2, where) => `in Codex inside one long command of your shell — node "${self}" watchdog-codex ${key2}${where} & …; kill %1 (a frame enters the running thread through app-server; as a separate nohup command the watchdog dies with it)`,
    self: (pi) => `The ${pi ? "pi extension" : "OpenCode plugin"} listens itself — no watchdog needed, frames enter the turn.`,
    claude: (monitor, exit) => `Listen: ${monitor}; without Monitor — ${exit}.`,
    codexLine: (codex, exit) => `Listen: ${codex}; without the app-server door — ${exit}.`,
    any: (monitor, exit, codex) => `Listen: ${monitor}; ${exit}; ${codex}.`
  }
};

// js/delivery/words/lostplaces.ts
var LOST = {
  ru: {
    satellite: (key2) => `Отказано (мост): место спутника потеряно при смене демона машины (${key2}) — у места спутника нет записи держания, и записи легли бы без автора; вызов не отправлен. Встань снова: iskron_stand с satellite_of.`,
    seat: (key2, realm, why) => `Отказано (мост): место ${key2} (граф ${realm}) не вернулось после смены демона машины (${why}) — записи легли бы без автора; вызов не отправлен. Верни место: iskron_stand в этом графе тем же именем.`
  },
  en: {
    satellite: (key2) => `Refused (bridge): the satellite's seat was lost in the machine daemon's change (${key2}) — a satellite seat has no holding record, and writes would go unattributed; the call was not sent. Stand again: iskron_stand with satellite_of.`,
    seat: (key2, realm, why) => `Refused (bridge): the seat ${key2} (graph ${realm}) did not come back after the machine daemon's change (${why}) — writes would go unattributed; the call was not sent. Bring it back: iskron_stand in that graph with the same name.`
  }
};

// js/delivery/words/machinestatus.ts
var MACHINE_STATUS = {
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
    left: (left2) => left2 ? "ушла" : "не ушла",
    attached: () => "прицеплена",
    detached: () => "отцеплена",
    primary: () => "основное",
    beside: () => "рядом",
    satellite: () => "спутник",
    listening: () => "слушает",
    silent: () => "не слушает",
    lastWork: () => "последний вызов графа",
    unknown: () => "не наблюдался"
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
    left: (left2) => left2 ? "left" : "not left",
    attached: () => "attached",
    detached: () => "detached",
    primary: () => "primary",
    beside: () => "beside",
    satellite: () => "satellite",
    listening: () => "listening",
    silent: () => "not listening",
    lastWork: () => "last graph call",
    unknown: () => "not observed"
  }
};

// js/delivery/words/moment.ts
var MOMENT = {
  ru: {
    status: () => '[мост] Занятость ставит iskron_stand(realm, status) на месте, которое мост уже держит, — основной ход; action="status" (realm, text до 64 символов) — прежний, оставлен для совместимости: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.',
    leave: () => '[мост] action="leave" (realm) — уйти с места: исполняет мост — сокет закрыт, занятость снята, адрес, очередь и хуки целы; почта копится и придёт при возвращении (сторож или iskron_stand). У места-спутника субагента уход полный: место отпущено целиком, почта не копится, возврата нет — встать снова можно только iskron_stand с satellite_of. Сам мост уходит только там, где кадр доходит лишь сторожем (Claude Code, Codex) и сторож не взведён 15 минут; в pi и OpenCode кадр приходит уведомлением, и мост места не бросает. Занятость снимается на конце сессии.',
    formerMoments: () => [
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; вопрос по сути или обязательство — вимаршей `posed_to` отвечающей роли с «Отвечено, когда»; разовая задача или вопрос — в деле, кончается исходом; отказ доставки рода не меняет; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; вопрос соседу и ожидание — вимаршей `posed_to`, не строкой дела; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; гроссбух — строками дела; нет дела — открой его, файл сессии — лишь запасной путь; кадром не шлётся; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; гроссбух — строками дела; без дела — файл сессии; кадром не шлётся; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; гроссбух сессии — в файле сессии и в кадре; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в комнате, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; гроссбух сессии — в файле сессии и в кадре; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; hint — семя превращения: только важное после сессии, не журнал; гроссбух сессии — в файле сессии и в кадре; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; hint — гроссбух превращения: исходы с вердиктами и что дальше, не пересказ карты; строки CHECKS в ответе — работа этого такта.",
      "[мост] Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; hint — указатель на то, чего не покажет карта, не план; строки CHECKS в ответе — работа этого такта."
    ]
  },
  en: {
    status: () => '[bridge] Busyness is set by iskron_stand(realm, status) on a seat the bridge already holds — the main move; action="status" (realm, text up to 64 characters) is the former one, kept for compatibility: the bridge, the socket holder, executes it, the call does not go to the server; an empty text clears; a surface refusal comes whole.',
    leave: () => `[bridge] action="leave" (realm) — leave the seat: the bridge executes it — the socket is closed, busyness cleared, address, queue and hooks intact; mail piles up and arrives on return (the watchdog or iskron_stand). For a subagent's satellite seat the leave is total: the seat is released whole, mail does not pile up, there is no return — standing again is only iskron_stand with satellite_of. The bridge itself leaves only where a frame reaches only through a watchdog (Claude Code, Codex) and the watchdog has not been armed for 15 minutes; in pi and OpenCode a frame comes as a notification, and the bridge does not abandon the seat. Busyness clears at the end of the session.`,
    formerMoments: () => [
      "[bridge] The writing skill's moment: before each node, name the reader, what will change retrieval and what is new here; type and given_as, the three modes as claims, a thesis name, arrows with sense; the body is present knowledge, never provenance: who said it, when, by whose hand — lives in the node's history and in the case, a node is rewritten, not appended with a section; hint is a transformation's seed: only what matters after the session, not a log; a substantive question or obligation is a vimarsha with `posed_to` to the answering role and an answer criterion; a one-off task or question belongs in a case and ends with its outcome; delivery refusal does not change its kind; the CHECKS lines in the reply are this beat's work.",
      "[bridge] The writing skill's moment: before each node, name the reader, what will change retrieval and what is new here; type and given_as, the three modes as claims, a thesis name, arrows with sense; the body is present knowledge, never provenance: who said it, when, by whose hand — lives in the node's history and in the case, a node is rewritten, not appended with a section; hint is a transformation's seed: only what matters after the session, not a log; a question to a neighbour and a wait are a vimarsha with `posed_to`, not a case line; the CHECKS lines in the reply are this beat's work.",
      "[bridge] The writing skill's moment: before each node, name the reader, what will change retrieval and what is new here; type and given_as, the three modes as claims, a thesis name, arrows with sense; the body is present knowledge, never provenance: who said it, when, by whose hand — lives in the node's history and in the case, a node is rewritten, not appended with a section; hint is a transformation's seed: only what matters after the session, not a log; the ledger is case lines; no case — open one, the session file is only a fallback; not sent as a frame; the CHECKS lines in the reply are this beat's work."
    ]
  }
};

// js/delivery/words/names.ts
var NAMES = {
  ru: {
    overLimit: (length) => `длиннее предела: ${length} знаков`,
    capitals: () => "заглавные буквы не допускаются",
    badSigns: () => "недопустимые знаки или первый знак не буква и не цифра"
  },
  en: {
    overLimit: (length) => `over the limit: ${length} signs`,
    capitals: () => "capital letters are not allowed",
    badSigns: () => "signs not allowed, or the first sign is neither a letter nor a digit"
  }
};

// js/delivery/words/narrow.ts
var NARROW = {
  ru: {
    outsideSet: (name2, list3) => `Отказано (мост): тула ${name2} нет в наборе этого моста (${list3}) — набор задаёт --tools в записи моста.`
  },
  en: {
    outsideSet: (name2, list3) => `Refused (bridge): the tool ${name2} is not in this bridge's set (${list3}) — the set comes from --tools in the bridge entry.`
  }
};

// js/delivery/words/oauth.ts
var CALLBACK_EN = {
  loginUnreachable: (error) => `<h3>iskron-bridge: the sign-in page could not be reached (${error}) — reload this page.</h3>`,
  anotherTab: () => "iskron-bridge: another tab is finishing this login — you can close this one.",
  refused: (err) => `iskron-bridge: authorization failed (${err})`,
  stillRunning: () => "iskron-bridge: the code arrived and the exchange is still running — watch the agent.",
  failed: (failure) => `iskron-bridge: authorization failed (${failure}) — nothing was stored; the agent has the details.`,
  authenticated: () => "iskron-bridge: authenticated — you can close this tab.",
  abandoned: () => "iskron-bridge: the login was abandoned — nothing was stored.",
  loginOver: () => "iskron-bridge: this page belongs to a login that is over — open the link the agent gave you."
};
var CALLBACK = { ru: CALLBACK_EN, en: CALLBACK_EN };
var DEVICE_CLIENT = {
  ru: {
    bareRefusal: (id, status) => `сервер авторизации отказал в коде входа клиенту ${id}: ${status} без объяснения — ход оператора сервера авторизации`,
    namedRefused: (id, word3) => `сервер авторизации отверг клиента входа по коду ${id}, заданного ISKRON_BRIDGE_DEVICE_CLIENT (${word3}) — поправь переменную или клиента на сервере`,
    unset: (id) => `вход по коду на этом сервере не настроен: нет клиента ${id} — ход оператора сервера авторизации`
  },
  en: {
    bareRefusal: (id, status) => `the sign-in server refused a sign-in code to the client ${id}: ${status} with no word why — a move for the operator of the sign-in server`,
    namedRefused: (id, word3) => `the sign-in server refused the client ${id} named by ISKRON_BRIDGE_DEVICE_CLIENT (${word3}) — fix the variable or the client on the server`,
    unset: (id) => `sign-in by code is not set up on this server: there is no client ${id} — a move for the operator of the sign-in server`
  }
};

// js/delivery/words/owner.ts
var OWNER = {
  ru: {
    refused: (what, env2) => `Отказано (мост): ${what} — роль владельца (主). Агент не занимает её без слова человека; слово человека — настройка ${env2}=1 в окружении моста, которую ставит он сам. Встань своей ролью (karta) — той, что назвал тебе человек или AGENTS.md как роль агента.`,
    human: (karta) => `karta="${karta}" — роль самого человека`,
    unread: (seq3, why) => `Отказано (мост): тип роли #${seq3} не прочитался (${why}) — роль владельца без проверки не занимается; повтори.`,
    incomplete: () => "список ролей владельца неполон"
  },
  en: {
    refused: (what, env2) => `Refused (bridge): ${what} is the owner's role (主). An agent does not take it without the human's word; the human's word is the setting ${env2}=1 in the bridge's environment, set by the human. Stand in your own role (karta) — the one the human or AGENTS.md named as the agent's.`,
    human: (karta) => `karta="${karta}" is the human's own role`,
    unread: (seq3, why) => `Refused (bridge): the type of role #${seq3} could not be read (${why}) — the owner's role is not taken unchecked; retry.`,
    incomplete: () => "the list of the owner's roles is incomplete"
  }
};

// js/delivery/words/places.ts
var PLACES = {
  ru: {
    anotherSeat: () => "другое место графа",
    graph: () => "граф",
    unmatched: (frame2, standingId, to, realm, several, key2) => `ДЕЛАТЕЛЬ: кадр ${frame2} (to_standing_id ${standingId}, ${to}, граф ${realm}) не сопоставлен ни одному месту моста (${several ? "подходят несколько" : "не подходит ни одно"}) — отдан основному месту ${key2}; сверь адрес кадра.`
  },
  en: {
    anotherSeat: () => "another seat of the graph",
    graph: () => "graph",
    unmatched: (frame2, standingId, to, realm, several, key2) => `DOER: frame ${frame2} (to_standing_id ${standingId}, ${to}, graph ${realm}) matches no seat of the bridge (${several ? "several fit" : "none fits"}) — given to the main seat ${key2}; check the frame's address.`
  }
};

// js/delivery/words/realms.ts
var REALMS = {
  ru: {
    unresolved: (realm, held2) => `Отказано (мост): граф «${realm}» мост не разрешил в @owner/slug (списка графов нет или имени в нём нет) — тот ли это граф, что у мест моста (${held2}), не известно, и гадать нельзя. Повтори вызов с полным адресом графа @owner/slug.`
  },
  en: {
    unresolved: (realm, held2) => `Refused (bridge): the bridge did not resolve the graph "${realm}" to @owner/slug (there is no list of graphs or the name is not in it) — whether it is the graph of the bridge's seats (${held2}) is unknown, and guessing is not allowed. Repeat the call with the full graph address @owner/slug.`
  }
};

// js/delivery/words/releases.ts
var RELEASES = {
  ru: {
    reset: (iso2, min) => `сброс ${iso2} (через ${min} мин)`,
    noReset: () => "время сброса GitHub не назвал",
    perHour: (limit) => `${limit} запросов в час`,
    anyHourly: () => "лимит в час",
    exhausted: (per, reset) => `лимит анонимного API GitHub исчерпан: ${per} на внешний адрес машины, общий всем мостам и клиентам за ним; ${reset}`,
    secondary: (reset) => `вторичный лимит API GitHub: слишком частые запросы с внешнего адреса машины; ${reset}`,
    recordedByOther: (reset) => `лимит API GitHub, записанный другим мостом машины; ${reset}`,
    httpFrom: (status, url) => `HTTP ${status} от ${url}`,
    noTag: (status, url, location) => `HTTP ${status} от ${url}${location ? ` → ${location}` : ""} — тега нет`,
    fromPage: (apiError, tag) => `релизы: API не ответил (${apiError}) — тег ${tag} со страницы релизов`,
    fallback: () => "запасной путь"
  },
  en: {
    reset: (iso2, min) => `reset ${iso2} (in ${min} min)`,
    noReset: () => "GitHub did not name the reset time",
    perHour: (limit) => `${limit} requests an hour`,
    anyHourly: () => "an hourly limit",
    exhausted: (per, reset) => `the anonymous GitHub API limit is exhausted: ${per} per the machine's external address, shared by all bridges and clients behind it; ${reset}`,
    secondary: (reset) => `GitHub API secondary limit: too frequent requests from the machine's external address; ${reset}`,
    recordedByOther: (reset) => `a GitHub API limit recorded by another bridge of the machine; ${reset}`,
    httpFrom: (status, url) => `HTTP ${status} from ${url}`,
    noTag: (status, url, location) => `HTTP ${status} from ${url}${location ? ` → ${location}` : ""} — no tag`,
    fromPage: (apiError, tag) => `releases: the API did not answer (${apiError}) — tag ${tag} from the releases page`,
    fallback: () => "fallback"
  }
};

// js/delivery/words/resume.ts
var via = "iskron_stand";
var RESUME = {
  ru: {
    failed: () => "возврат на место не удался",
    returnedParked: (pending2) => pending2 === null ? "возврат на место, с которого мост уходил; hello за 4 с не пришёл" : `возврат на место, с которого мост уходил (ожидало кадров — ${pending2})`,
    legacy: (n) => `есть место прежней сборки без сессии: ${n} — вернуть: ${via}(name="${n}")`,
    noRecord: (key2, cwd) => `своей записи держания ${key2 ? `с ключом ${key2}` : `для каталога ${cwd ?? "?"}`} нет`,
    rejoin: () => `место могло истечь у платформы и выйти из своих дел — после ${via} войди заново в дела, где тебя ждут: iskron_case(action="join", room="№N")`,
    foreignDir: (foreign) => `в каталоге лежат записи мест, на которых эта сессия не стояла (${foreign}); по одному каталогу они не берутся, место займёт ${via}`,
    neighbourKey: (keys) => `на месте ${keys} стояла другая сессия — место соседа возврат не берёт; своё место займёт ${via}`,
    left: (left2) => `место отпущено словом держателя (leave): ${left2} — само не вернётся, вернуть: ${via} тем же именем`,
    alreadyHolding: () => "мост уже держит это место",
    byRecord: () => "возврат по записи",
    otherSeat: (key2, led) => `${key2}: мост ведёт другое место ${led}`,
    liveBridge: (key2) => `${key2}: держит живой мост`,
    ownNotTaken: (key2, why) => `${key2}: держит прежний мост этой сессии, взять не вышло — ${why}`,
    noHello: (key2) => `${key2}: hello не пришёл — запись цела, сторож повторит возврат; не ждёшь — ${via}`,
    stale: (key2) => `${key2}: запись протухла — место займёт ${via}`,
    registerRefused: (text2) => `register отказал — ${text2}`,
    othersInDir: (others) => `в том же каталоге записи и других мест: ${others}`,
    notYours: () => 'место не твоё — iskron_channel(action="leave") отпустит его, канал цел',
    nothingToReturn: (skipped) => `возвращать нечего — ${skipped}`,
    noKeyNoCwd: () => "ни key, ни cwd не передан",
    noSeatNoKeyNoCwd: () => "места нет, ни key, ни cwd не передан",
    leftByWord: (key2) => `место ${key2} отпущено словом держателя (leave) — сторож его не поднимает; вернуть: ${via} тем же именем`,
    watchdogReason: () => "сторож слуха",
    boardUnread: (text2) => `доска не прочиталась — ${text2}`,
    noSeatOnBoard: () => "своего места на доске нет",
    listening: () => "слушаю",
    gaveUp: (key2, limit) => `Искрон: доска читает место ${key2} не слушающим и после ${limit} переоткрытий сокета — больше не рву; проверь доску и сервер, вернуть слух — ${via} тем же именем: другую сессию на месте он не тронет и встанет рядом; take=true: ${TAKE.ru.rule()}.`,
    deafBoard: () => "доска не читает слушающим",
    reopened: (pending2) => pending2 === null ? "сокет переоткрыт, hello за 4 с не пришёл" : `сокет переоткрыт: ожидало кадров — ${pending2}`,
    busyRestored: (kept2) => `; занятость возвращена: ${kept2}`,
    busyNotRestored: (body) => `; занятость не возвращена: ${body}`,
    busyForeign: () => "; прежняя строка занятости не возвращена — скажи свою",
    fromDisk: (pending2, busy) => `возврат места с диска после перезапуска моста — сокет открыт заново тем же адресом (ожидало кадров — ${pending2})${busy}`
  },
  en: {
    failed: () => "the return to the seat failed",
    returnedParked: (pending2) => pending2 === null ? "the return to the seat the bridge had left; hello did not come in 4 s" : `the return to the seat the bridge had left (frames waiting — ${pending2})`,
    legacy: (n) => `there is a seat of an earlier build without a session: ${n} — to bring it back: ${via}(name="${n}")`,
    noRecord: (key2, cwd) => `there is no own hold record ${key2 ? `with the key ${key2}` : `for the directory ${cwd ?? "?"}`}`,
    rejoin: () => `the seat may have expired at the platform and left its cases — after ${via} join again the cases that wait for you: iskron_case(action="join", room="№N")`,
    foreignDir: (foreign) => `the directory holds records of seats this session did not stand on (${foreign}); they are not taken by directory alone, ${via} will take the seat`,
    neighbourKey: (keys) => `another session stood on the seat ${keys} — a return does not take a neighbour's seat; ${via} will take your own`,
    left: (left2) => `the seat was released by the holder's word (leave): ${left2} — it will not return by itself, to bring it back: ${via} with the same name`,
    alreadyHolding: () => "the bridge already holds this seat",
    byRecord: () => "return by record",
    otherSeat: (key2, led) => `${key2}: the bridge leads another seat ${led}`,
    liveBridge: (key2) => `${key2}: held by a live bridge`,
    ownNotTaken: (key2, why) => `${key2}: a former bridge of this session holds it, taking it failed — ${why}`,
    noHello: (key2) => `${key2}: hello did not come — the record is intact, the watchdog will repeat the return; if you do not wait — ${via}`,
    stale: (key2) => `${key2}: the record went stale — ${via} will take the seat`,
    registerRefused: (text2) => `register refused — ${text2}`,
    othersInDir: (others) => `the same directory holds records of other seats too: ${others}`,
    notYours: () => 'the seat is not yours — iskron_channel(action="leave") will release it, the channel stays intact',
    nothingToReturn: (skipped) => `nothing to return — ${skipped}`,
    noKeyNoCwd: () => "neither key nor cwd was passed",
    noSeatNoKeyNoCwd: () => "no seat, and neither key nor cwd was passed",
    leftByWord: (key2) => `the seat ${key2} was released by the holder's word (leave) — the watchdog does not raise it; to bring it back: ${via} with the same name`,
    watchdogReason: () => "the hearing watchdog",
    boardUnread: (text2) => `the board could not be read — ${text2}`,
    noSeatOnBoard: () => "the own seat is not on the board",
    listening: () => "listening",
    gaveUp: (key2, limit) => `Iskron: the board reads the seat ${key2} as not listening and after ${limit} socket reopenings — I no longer tear it; check the board and the server, to restore hearing — ${via} with the same name: it leaves another session on the seat alone and stands beside; take=true: ${TAKE.en.rule()}.`,
    deafBoard: () => "the board does not read it as listening",
    reopened: (pending2) => pending2 === null ? "the socket is reopened, hello did not come in 4 s" : `the socket is reopened: frames waiting — ${pending2}`,
    busyRestored: (kept2) => `; busy line restored: ${kept2}`,
    busyNotRestored: (body) => `; busy line not restored: ${body}`,
    busyForeign: () => "; the former busy line is not restored — say your own",
    fromDisk: (pending2, busy) => `the seat returned from disk after the bridge restarted — the socket reopened at the same address (frames waiting — ${pending2})${busy}`
  }
};

// js/delivery/words/rituals.ts
var ruleRu = (section) => `правило — скилл iskronify, Шаг 4 «${section}», образец — его references/harness-surfaces.md`;
var ruleEn = (section) => `the rule is skill iskronify, Step 4 «${section}», the sample is its references/harness-surfaces.md`;
var RITUALS = {
  ru: {
    usage: () => "node iskron.mjs check-rituals [репо...] [--json] [-- репо...]   (плагины .opencode/plugins не пишут в сессии чужих каталогов и не ломаются; без репо — текущий каталог)",
    fixScope: (section) => `починка: подписка на поток событий берёт каталог события (location.directory события или его data), канонизирует его и ctx.location.directory (realpath, при ошибке — строка, без завершающего разделителя) и пропускает чужой; ${ruleRu(section)}`,
    fixBroken: (section) => `починка: хук тула исполняется в своей сессии как написан — имена определены, бросает только guard на пути памяти; ${ruleRu(section)}`,
    notChecked: (file, error) => `не проверен  ${file}: ${error}`,
    noSubscription: () => " (на поток событий не подписан — только хуки тулов)",
    hole: (file) => `ДЫРА  ${file}`,
    foreignWrites: (count) => `  пишет в сессию чужого каталога: ${count} записей на session.created — та сессия получит адреса этого репо`,
    lostSpelling: (mine, twin) => `  своя сессия под другим написанием каталога без приветствия (настоящий путь: ${mine}, написание экземпляра: ${twin}) — каталоги сравниваются сырой строкой, а одна папка приходит то /tmp/…, то /private/tmp/…`,
    mute: () => "  подписан на поток событий, а своя корневая сессия приветствия не получила — каталог экземпляра берётся не из ctx.location.directory (поля ctx.directory в Context нет) или условие не пропускает свою",
    broken: (hit) => `  хук тула сломан в своей сессии (плагин исполнен как есть) — ${hit}`,
    unknownFlag: (flag) => `неизвестный флаг ${flag} (каталог с таким именем — ./${flag} или после --)`,
    noDir: (dir2) => `нет такого каталога: ${dir2}`,
    noPlugins: () => "плагинов в .opencode/plugins нет"
  },
  en: {
    usage: () => "node iskron.mjs check-rituals [repo...] [--json] [-- repo...]   (.opencode/plugins write into no session of another directory and do not break; no repo — the current directory)",
    fixScope: (section) => `fix: the event-stream subscriber takes the event's directory (location.directory of the event or its data), canonicalises it and ctx.location.directory (realpath, the string on failure, no trailing separator) and skips a foreign one; ${ruleEn(section)}`,
    fixBroken: (section) => `fix: a tool hook runs in its own session as written — its names defined, only the guard throws, on a memory path; ${ruleEn(section)}`,
    notChecked: (file, error) => `not checked  ${file}: ${error}`,
    noSubscription: () => " (no event-stream subscription — tool hooks only)",
    hole: (file) => `HOLE  ${file}`,
    foreignWrites: (count) => `  writes into a session of another directory: ${count} writes on session.created — that session gets this repo's addresses`,
    lostSpelling: (mine, twin) => `  its own session under another spelling of the folder gets no greeting (the real path: ${mine}, the instance's spelling: ${twin}) — directories are compared as raw strings, while one folder comes as /tmp/… and as /private/tmp/…`,
    mute: () => "  subscribed to the event stream, yet its own root session got no greeting — the instance's directory is not taken from ctx.location.directory (Context has no ctx.directory) or the condition drops its own",
    broken: (hit) => `  a tool hook breaks in its own session (the plugin is run as is) — ${hit}`,
    unknownFlag: (flag) => `unknown flag ${flag} (a directory of that name — ./${flag} or after --)`,
    noDir: (dir2) => `no such directory: ${dir2}`,
    noPlugins: () => "no plugins in .opencode/plugins"
  }
};

// js/delivery/words/rooms.ts
var ROOM = {
  ru: {
    said: (author) => `слово от ${author}`,
    saidPending: (author) => `слово от ${author} в полёте — текст придёт следом`,
    aside: (author, addressee, word3) => `${author} → ${addressee}: слово [${word3}]`,
    asideRun: (author, addressee, count, word3) => `${author} → ${addressee}: ${count} (последнее [${word3}])`,
    asideBody: (author, addressee, word3) => `${author} → ${addressee}: текст слова [${word3}]`,
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
    progress: (key2, done, verdict, note3, author) => `[${key2}] [${done}] = ${verdict}${note3} · ${author}`,
    opened: (author) => `дело открыл ${author}`,
    joined: (who) => `вошёл ${who}`,
    left: (who, reason) => `вышел ${who}${reason ? `; причина: ${reason}` : ""}`,
    invite: (author, who) => `${author} зовёт ${who} в дело`,
    withdraw: (author) => `приглашение отозвано, отзывает ${author}`,
    node: (seq3, name2, realm, reasoning) => `в деле узел #${seq3} ${name2} (${realm})${reasoning}`,
    nodeUpdated: (seq3, name2, reasoning) => `узел #${seq3} ${name2} обновлён${reasoning}`,
    nodeDeleted: (seq3, name2, reasoning) => `узел #${seq3} ${name2} удалён${reasoning}`,
    nodeUndeleted: (seq3, name2, reasoning) => `узел #${seq3} ${name2} восстановлен${reasoning}`,
    link: (room, rel) => `дело связано с №${room} (${rel})`,
    auto: (code, room) => `запись платформы ${code} о деле №${room}`,
    unknown: (kind) => `род ${kind} мосту неизвестен`,
    case: (room) => `№${room}`,
    replyTo: (id) => `в ответ на [${id}]`,
    stale: () => "лежалый",
    bodyRead: (how2) => `тело: ${how2}`,
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
    aside: (author, addressee, word3) => `${author} → ${addressee}: message [${word3}]`,
    asideRun: (author, addressee, count, word3) => `${author} → ${addressee}: ${count} (last [${word3}])`,
    asideBody: (author, addressee, word3) => `${author} → ${addressee}: text of message [${word3}]`,
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
    progress: (key2, done, verdict, note3, author) => `[${key2}] [${done}] = ${verdict}${note3} · ${author}`,
    opened: (author) => `case opened by ${author}`,
    joined: (who) => `entered ${who}`,
    left: (who, reason) => `left ${who}${reason ? `; reason: ${reason}` : ""}`,
    invite: (author, who) => `${author} invites ${who} to the case`,
    withdraw: (author) => `invitation withdrawn by ${author}`,
    node: (seq3, name2, realm, reasoning) => `node #${seq3} ${name2} (${realm}) in the case${reasoning}`,
    nodeUpdated: (seq3, name2, reasoning) => `node #${seq3} ${name2} updated${reasoning}`,
    nodeDeleted: (seq3, name2, reasoning) => `node #${seq3} ${name2} deleted${reasoning}`,
    nodeUndeleted: (seq3, name2, reasoning) => `node #${seq3} ${name2} restored${reasoning}`,
    link: (room, rel) => `case linked to case №${room} (${rel})`,
    auto: (code, room) => `platform record ${code} about case №${room}`,
    unknown: (kind) => `kind ${kind} is unknown to the bridge`,
    case: (room) => `case №${room}`,
    replyTo: (id) => `in reply to [${id}]`,
    stale: () => "stale",
    bodyRead: (how2) => `body: ${how2}`,
    whoHuman: (user) => `human${user}`,
    whoRole: (karta) => `role #${karta}`,
    whoSibling: (karta) => `sibling of role #${karta}`,
    whoPlatform: () => "platform — a wake-up",
    whoGraph: () => "graph event",
    legacy: (kind, stack) => `kind ${kind}${stack ? ` · ${stack}` : ""}`
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

// js/delivery/words/runend.ts
var RUN_END = {
  ru: {
    pluginEnd: () => "конец прогона по слову плагина"
  },
  en: {
    pluginEnd: () => "the run's end on the plugin's word"
  }
};

// js/delivery/words/satellite.ts
var SATELLITE = {
  ru: {
    empty: () => "пусто",
    notSeatName: (of, fault) => `Отказано (мост): satellite_of «${of}» — не имя места (${fault}); передай место позвавшего как печатает доска: @handle:name.`,
    noCaller: (of) => `Отказано (мост): места позвавшего ${of} на доске этого графа нет — спутнику не к чему встать рядом; проверь satellite_of и граф в постановке.`,
    ambiguous: (count, base) => `Отказано (мост): имя ${base} на доске носят ${count} места — передай satellite_of полным адресом @handle:name.`,
    alreadyHolds: (led) => `мост уже держит ${led} — повтор этого прогона либо параллельный прогон с той же записью моста (тот же файл агента или другой с той же записью), который делит это место и потеряет его, когда первый закончит; параллельно — не больше одного прогона на запись моста`,
    nameCut: (base, n, max, name2) => `имя ${base}.sub-${n} длиннее предела ${max} знаков — база укорочена: ${name2}`,
    allTaken: (caller) => `Отказано (мост): у места ${caller} заняты все спутники .sub-1…99 — прибери погасшие места прежних прогонов.`,
    needSatelliteOf: () => "Отказано (мост): это мост-спутник — он занимает только место-спутник субагента; передай satellite_of — место позвавшего (@handle:name) из постановки.",
    notSatellite: () => "Отказано (мост): satellite_of — только мосту-спутнику (запись моста с --satellite в файле агента); этот мост — мост сессии, и место-спутник на нём заняло бы голос позвавшего. Субагенту без своего моста — предел: он говорит местом позвавшего и называет себя в своих строках.",
    derivesName: () => "Отказано (мост): имя спутника выводит мост — name, take и room вместе с satellite_of не передаются.",
    boardUnread: (text2) => `Отказано: доска не прочиталась — ${text2}`,
    claimsUnsure: (unsure, name2) => `заявки имён спутников на этой машине выбор не удержали (${unsure}) — имя ${name2} выбрано по доске: уникальность не гарантирована, мост-спутник, вставший разом, мог взять то же имя`,
    seat: (caller, karta, ttl) => `место-спутник ${caller}: роль #${karta}, окно простоя канала ${ttl} с, записи держания нет — место живёт прогоном`,
    noCallerId: (caller) => `id места ${caller} доска не напечатала — признак спутника (satellite_of) платформе не послан: место может унаследовать недоставленную почту роли`,
    bypass: (action) => `Отказано (мост-спутник): ${action} мимо iskron_stand — место этому мосту даёт только iskron_stand с satellite_of; чужое место спутник не берёт и не снимает.`,
    onlyOwn: (action, own, karta, realm) => `Отказано (мост-спутник): ${action} — только своего места ${own} (роль #${karta}, граф ${realm}); место позвавшего и любое другое спутник не берёт и не снимает.`,
    listen: (ttl) => `[iskron-bridge] Место-спутник: сторожа не взводи — место живёт прогоном субагента и подписывает его записи; с концом прогона мост уходит с места сам, канал гаснет окном простоя ${ttl} с. Первый ход — вход в дело, названное постановкой, и пересказ постановки первым словом в нём.`
  },
  en: {
    empty: () => "empty",
    notSeatName: (of, fault) => `Refused (bridge): satellite_of "${of}" is not a seat name (${fault}); pass the caller's seat as the board prints it: @handle:name.`,
    noCaller: (of) => `Refused (bridge): the caller's seat ${of} is not on this graph's board — the satellite has nothing to stand beside; check satellite_of and the graph in the brief.`,
    ambiguous: (count, base) => `Refused (bridge): ${count} seats on the board carry the name ${base} — pass satellite_of as the full address @handle:name.`,
    alreadyHolds: (led) => `the bridge already holds ${led} — a repeat of this run or a parallel run with the same bridge entry (the same agent file or another with the same entry), which shares this seat and loses it when the first one ends; in parallel — no more than one run per bridge entry`,
    nameCut: (base, n, max, name2) => `the name ${base}.sub-${n} is longer than the ${max}-sign limit — the base is cut: ${name2}`,
    allTaken: (caller) => `Refused (bridge): every satellite .sub-1…99 of the seat ${caller} is taken — clear the dead seats of former runs.`,
    needSatelliteOf: () => "Refused (bridge): this is a satellite bridge — it takes only a subagent's satellite seat; pass satellite_of — the caller's seat (@handle:name) from the brief.",
    notSatellite: () => "Refused (bridge): satellite_of is for a satellite bridge only (a bridge entry with --satellite in the agent file); this is a session bridge, and a satellite seat on it would take the caller's voice. A subagent without a bridge of its own has a limit: it speaks as the caller's seat and names itself in its lines.",
    derivesName: () => "Refused (bridge): the bridge derives the satellite's name — name, take and room do not go with satellite_of.",
    boardUnread: (text2) => `Refused: the board did not read — ${text2}`,
    claimsUnsure: (unsure, name2) => `satellite name claims on this machine did not hold the pick (${unsure}) — the name ${name2} was picked by the board: uniqueness is not guaranteed, a satellite bridge standing at the same moment may have taken the same name`,
    seat: (caller, karta, ttl) => `satellite seat of ${caller}: role #${karta}, channel idle window ${ttl} s, no holding record — the seat lives by the run`,
    noCallerId: (caller) => `the board did not print the id of ${caller} — the satellite sign (satellite_of) was not sent to the platform: the seat may inherit the role's undelivered mail`,
    bypass: (action) => `Refused (satellite bridge): ${action} bypassing iskron_stand — only iskron_stand with satellite_of gives this bridge a seat; a satellite neither takes nor releases another's seat.`,
    onlyOwn: (action, own, karta, realm) => `Refused (satellite bridge): ${action} — only its own seat ${own} (role #${karta}, graph ${realm}); a satellite neither takes nor releases the caller's seat or any other.`,
    listen: (ttl) => `[iskron-bridge] Satellite seat: do not arm a watchdog — the seat lives by the subagent's run and signs its records; when the run ends the bridge leaves the seat itself, the channel dies after the ${ttl} s idle window. The first move — enter the case the brief names and retell the brief as your first message in it.`
  }
};

// js/delivery/words/satprobe.ts
var SAT_PROBE = {
  ru: {
    loginAdvice: () => "войди: вызови любой тул iskron_* в основной сессии и открой ссылку входа из его ответа (или положи личный токен в ~/.iskron-bridge/token — скилл establish-mcp), потом повтори doctor",
    exited: (code) => `вышел с кодом ${code}`,
    refusalLogin: (label, what, advice) => `проба «${label}»: ${what} — спутник не вошёл: грант машины мёртв или отозван → ${advice}`,
    refusal: (label, what, msg) => `проба «${label}»: ${what} вернул отказ: ${msg} → сделай, что велит отказ, и повтори doctor`,
    silent: (secs2) => `молчит ${secs2}s`,
    oldFlag: (flag) => ` — похоже, домашний мост старше флага ${flag} → node ~/.iskron-bridge/iskron-bridge.mjs update`,
    runByHand: () => " → запусти эту команду руками и прочти, что она пишет в stderr",
    noInit: (label, why, stderrNote, old) => `проба «${label}»: мост не ответил на initialize (${why}${stderrNote})${old}`,
    noList: (label, name2, version, exited) => `проба «${label}»: initialize ответил (${name2} v${version}), tools/list — нет (${exited ?? "молчит"}) → запусти команду руками и прочти её stderr`,
    answered: (label, name2, version, tools) => `проба «${label}»: мост ответил — ${name2} v${version}, тулов ${tools}`,
    schema: (tool2, bad) => `тул ${tool2}: схема несёт ${bad} на верхнем уровне — сервер отдаёт схему, которую API Anthropic отвергнет («input_schema does not support oneOf, allOf, or anyOf at the top level»), и падает весь прогон субагента, не один этот тул → чинит это сервер, не файл агента и не мост (мост отдаёт схему как есть): скажи имя тула оператору сервера MCP — тому, кто держит адрес из строки «сервер» выше, — и жди его обновления, затем повтори doctor`,
    winKilled: (label, secs2) => `проба «${label}»: мост не ушёл по закрытому stdin за ${secs2}s — снят принудительно → повтори doctor; если он менял токен, вход может понадобиться заново`,
    sigKilled: (label, secs2) => `проба «${label}»: мост не ушёл ни по закрытому stdin, ни по SIGTERM за ${secs2}s — снят SIGKILL → повтори doctor; если он менял токен, вход может понадобиться заново`
  },
  en: {
    loginAdvice: () => "log in: call any iskron_* tool in the main session and open the login link from its answer (or put a personal token in ~/.iskron-bridge/token — the establish-mcp skill), then repeat doctor",
    exited: (code) => `exited with code ${code}`,
    refusalLogin: (label, what, advice) => `probe "${label}": ${what} — the satellite is not logged in: the machine grant is dead or revoked → ${advice}`,
    refusal: (label, what, msg) => `probe "${label}": ${what} returned a refusal: ${msg} → do what the refusal says and repeat doctor`,
    silent: (secs2) => `silent for ${secs2}s`,
    oldFlag: (flag) => ` — it seems the home bridge is older than the ${flag} flag → node ~/.iskron-bridge/iskron-bridge.mjs update`,
    runByHand: () => " → run this command by hand and read what it writes to stderr",
    noInit: (label, why, stderrNote, old) => `probe "${label}": the bridge did not answer initialize (${why}${stderrNote})${old}`,
    noList: (label, name2, version, exited) => `probe "${label}": initialize answered (${name2} v${version}), tools/list did not (${exited ?? "silent"}) → run the command by hand and read its stderr`,
    answered: (label, name2, version, tools) => `probe "${label}": the bridge answered — ${name2} v${version}, tools ${tools}`,
    schema: (tool2, bad) => `tool ${tool2}: the schema carries ${bad} at the top level — the server hands out a schema the Anthropic API will reject ("input_schema does not support oneOf, allOf, or anyOf at the top level"), and the whole subagent run fails, not just this tool → the server fixes this, not the agent file or the bridge (the bridge passes the schema as is): tell the MCP server operator the tool name — whoever holds the address from the "server" line above — and wait for their update, then repeat doctor`,
    winKilled: (label, secs2) => `probe "${label}": the bridge did not leave on closed stdin within ${secs2}s — killed forcibly → repeat doctor; if it was renewing the token, a login may be needed again`,
    sigKilled: (label, secs2) => `probe "${label}": the bridge left neither on closed stdin nor on SIGTERM within ${secs2}s — killed with SIGKILL → repeat doctor; if it was renewing the token, a login may be needed again`
  }
};

// js/delivery/words/separate.ts
var probeRu = (base) => `спроси её словом — iskron_channel(action="send", standing=${base}, text="жив? что держишь?") — и жди ответа до 5 минут: ответила — договоритесь, её дела не бери; молчит — iskron_stand(name=${base}, take=true) и войди в её дела (iskron_case(action="mine", standing=${base})); человека не спрашивай`;
var probeEn = (base) => `ask it by word — iskron_channel(action="send", standing=${base}, text="alive? what do you hold?") — and wait up to 5 minutes for the answer: it answered — agree, do not take its cases; it is silent — iskron_stand(name=${base}, take=true) and enter its cases (iskron_case(action="mine", standing=${base})); do not ask the human`;
var HOLDER_RU = {
  live: "другая живая сессия твоего имени (та же роль, та же учётка)",
  record: "другая сессия твоего имени (та же роль, та же учётка; её мост здесь не отвечает — жива ли, скажет проба)",
  board: "другая сессия той же роли"
};
var HOLDER_EN = {
  live: "another live session of your own name (the same role, the same account)",
  record: "another session of your own name (the same role, the same account; its bridge does not answer here — the probe tells whether it is alive)",
  board: "another session of the same role"
};
var SEPARATE = {
  ru: {
    ownSession: (base) => `место ${base} держал прежний мост этой же сессии харнесса (перезапуск или компакшн) — своё место этой сессии, мост вернул его сам`,
    beside: (base, name2, own, kin) => `место ${base} держит ${kin ? HOLDER_RU[kin] : "другая сессия"} — её место не трогаю и им не подписываюсь; встаю рядом на ${name2} со слухом${own ? " (его держал прежний мост этой же сессии — вернул сам)" : ""}: это своё место, кадры по нему идут сюда; ` + (kin === "board" ? `учётку держателя сверь по доске с адресом своего места: та же — ${probeRu(base)}; другая — вытеснить ту сессию (take=true) только словом человека` : kin ? probeRu(base) : `вытеснить ту сессию (take=true): ${TAKE.ru.rule()}`),
    unknown: (name2) => `Отказано (мост): доска разобрана не целиком — слушает ли место ${name2} другая сессия, мост не знает; вслепую не встаю и take=true не советую. Повтори, когда доска прочтётся, либо назови другое name.`,
    noFree: (base) => `Отказано (мост): место ${base} держит другая сессия, и все места рядом ${base}.2…99 заняты — подписываться чужим местом без слуха мост не станет; прибери погасшие места либо назови другое name.`
  },
  en: {
    ownSession: (base) => `the seat ${base} was held by a former bridge of this same harness session (a restart or a compaction) — this session's own seat, the bridge took it back itself`,
    beside: (base, name2, own, kin) => `${kin ? HOLDER_EN[kin] : "another session"} holds the seat ${base} — leaving its seat alone and not signing with it; standing beside as ${name2} with hearing${own ? " (a former bridge of this same session held it — taken back)" : ""}: it is this session's own seat, its frames come here; ` + (kin === "board" ? `check the holder's account on the board against your own seat's address: the same — ${probeEn(base)}; another — evicting that session (take=true) only on the human's word` : kin ? probeEn(base) : `evicting that session (take=true): ${TAKE.en.rule()}`),
    unknown: (name2) => `Refused (bridge): the board was not read in full — the bridge does not know whether another session listens on the seat ${name2}; not standing blind and not advising take=true. Repeat when the board reads, or pass another name.`,
    noFree: (base) => `Refused (bridge): another session holds the seat ${base}, and every seat beside ${base}.2…99 is taken — the bridge will not sign with another's seat without hearing; clear the dead seats or pass another name.`
  }
};

// js/delivery/words/stalebatch.ts
var STALE = {
  ru: {
    head: (count, shown) => `Лежалых кадров: ${count}` + (count > shown ? `, здесь первые ${shown}, не вошло ${count - shown}` : "") + ` — принятые, пока место не слушали, или повтор службы после пересборки сессии; адресованные месту — текстом, прочие — счётом; целиком — по строкам дел ниже, не вошедшее — ${FRAME_TEXT.ru.myCases()}.`
  },
  en: {
    head: (count, shown) => `Stale frames: ${count}` + (count > shown ? `, the first ${shown} here, ${count - shown} left out` : "") + ` — taken while the seat was not listening, or the service repeating after a session rebuild; those addressed to the seat as text, the rest by count; in full — by the case lines below, the rest — ${FRAME_TEXT.en.myCases()}.`
  }
};

// js/delivery/words/stand.ts
var s = (ms2) => Math.round(ms2 / 1e3);
var left = (window, waited) => Math.ceil((window - waited) / 1e3);
var STAND = {
  ru: {
    needRealmKarta: (tail2) => "Отказано (мост): iskron_stand требует realm и karta — граф и роль из AGENTS.md или строки запуска." + tail2,
    badCwd: (cwd, relative) => `Отказано (мост): cwd должен быть существующим абсолютным каталогом — получено «${cwd}»${relative ? " (относительный путь резолвился бы от cwd моста, не сессии)" : ""}.`,
    badName: (asked, fault, max) => `Отказано (мост): name «${asked}» — ${fault}; правило имени: строчные латинские буквы, цифры, точка, подчёркивание, дефис, первый знак — буква или цифра, не длиннее ${max} знаков. Имя не укорачивается молча: короткое имя адресовало бы другое место.`,
    cutPart: (k) => k === "repo" ? "репо" : k === "host" ? "машина" : "модель",
    nameCut: (full, max, name2, what) => `выведенное имя ${full} длиннее предела ${max} знаков — укорочено до ${name2} (срезано: ${what}); нужно другое — передай name`,
    noModel: () => "model не передан — имя без третьей части (машина.репо): вторая сессия этой машины над этим репозиторием сойдётся на то же место; передай model, чтобы различать",
    legacy: (address, realm, karta) => `на доске живо место прежнего имени ${address} — его адрес могут держать дела и хуки; сними его: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`,
    boardUnread: (text2) => `Отказано: доска не прочиталась — ${text2}`,
    boardUnknown: (start, own, others) => `Отказано: форма доски не распознана — ни заголовка «${own}» («${others}»), ни слова о пустом графе, ни строк мест; управляющих действий (connect, стук) по догадке не делаю. Начало ответа: ${start}`,
    boardAmbiguous: (n, name2, karta) => `Отказано: на доске ${n} места с именем ${name2} у роли #${karta} — форма неоднозначна, состояние не определить.`,
    boardCount: (declared, parsed) => `Отказано: доска объявляет ${declared} мест, разобрано ${parsed}, и своего места среди разобранных нет — нераспознанная строка могла быть им — или местом, которое слушает другая сессия; connect ротировал бы его вслепую, а take=true отнял бы его. Повтори, когда доска прочтётся, либо встань под другим name.`,
    boardCountFound: (declared, parsed) => `Доска объявляет ${declared} мест, разобрано ${parsed} — одну строку парсер не понял; своё место найдено, иду дальше.`,
    refused: (what, text2) => `Отказано: ${what} — ${text2}`,
    noIdInRegister: () => "register id места не назвал — кадры места находятся по графу и адресу, занятость ждёт id.",
    modelNotCleared: (why) => `Прежняя модель места не снята (${why}): харнесс модели не назвал, а доска может показывать прежнюю.`,
    howBeside: (led) => `место другого графа — встаёт рядом на канале, который держит этот мост (${led}): register`,
    howReturned: () => "возврат на место, с которого мост уходил, — сокет открыт заново тем же адресом, register",
    howOwnSession: () => "своё место этой сессии — вернул: его держал прежний мост этой же сессии харнесса, connect (сокет теперь у этого моста, прежний получил 4000) и register",
    otherHolder: (holder) => `Отказано (мост): место ${holder} слушает другой держатель — подписываться им без слуха мост не станет; встань своим местом: iskron_stand без name либо с другим name.`,
    howRegister: () => "сокет уже держит этот мост — register",
    ttlRefused: (ttl, text2) => `Окно простоя ${ttl} с контур не принял (${text2}) — место занято с окном по умолчанию контура.`,
    takenButRegister: (text2) => `Место занято, но register отказал — ${text2}`,
    howConnect: (mine, listensElsewhere, take2) => mine ? listensElsewhere ? "место слушал другой держатель — connect по take (сокет теперь у этого моста, прежний держатель получил 4000) и register" : take2 ? "connect по take — новый цикл входа, счёт стуков сброшен — и register" : "место было — connect (сокет теперь у этого моста) и register" : "connect и register",
    head: (place, karta, realm, how2) => `[iskron_stand] стояние ${place} — роль #${karta}, граф ${realm}: ${how2}.`,
    note: (text2) => `[iskron_stand] ${text2}`,
    noWatchdog: () => "Команда сторожа не выдаётся: сокета этого места у моста ещё нет — эта сессия кадры и приглашения не принимает, пока место не вернётся.",
    noSocket: () => "Сокета у моста нет — слушать нечем; проверь ответ connect.",
    besideNoDoor: () => "Место записано, но двери у него нет — сокет канала моста не жив; кадры этого графа сюда не придут.",
    besideHeard: () => "Сокет канала держит этот мост — кадры места этого графа идут его сторожу.",
    heldAlready: () => "Сокет держит этот мост (hello получен при открытии сокета).",
    hello: (pending2) => `hello получен: ожидало кадров — ${pending2}.`,
    noLocalSocket: (why) => `НО локальный сокет стояния не поднят (${why}) — сторожу не к чему цепляться: слуха в этой сессии нет, команда сторожа выше не сработает. Место занято, записи подписаны; скажи это человеку.`,
    noHello: () => "hello за 4 с не пришёл — сокет мост держит, но доказательства слуха ещё нет: проверь доску.",
    knockNotHere: (room) => `Место человека ${room}: стук не отправлен — сокета этого места у моста ещё нет, ответ человека сюда не пришёл бы; постучи тем же вызовом, когда место вернётся.`,
    knockTwice: (room) => `Место человека ${room}: стучал дважды, приглашения нет — больше не стучу в этом заходе; скажи человеку, что его место не ответило, и попроси открыть чат (счёт сбрасывает новый вход: take=true или новая сессия).`,
    knockSent: (room, waited, window) => `Место человека ${room}: стук уже отправлен ${s(waited)} с назад — жди приглашения; осознанный повтор — тем же вызовом с repeat_knock=true, не раньше чем через ${s(window)} с.`,
    knockEarly: (room, waited, window) => `Место человека ${room}: повтор рано — с первого стука прошло ${s(waited)} с, правило ждёт ${s(window)} с; повтори через ${left(window, waited)} с.`,
    knockNoRole: (room, realm) => `Место человека ${room}: на доске графа ${realm} этого места нет, а send требует роль его держателя — стук не отправлен. Место человека живёт его присутствием: либо он ушёл дольше порога (попроси открыть чат и повтори), либо передай room_karta=<роль человека>.`,
    knockRefused: (room, text2) => `Место человека ${room}: стук отказан — ${text2}`,
    knockDone: (room, again, text2) => `Место человека ${room}: ${again ? "повторный " : ""}стук отправлен — ${text2} Жди первого слова из места человека с шапкой; до него туда не пиши — встанешь рядом с человеком, когда оно придёт.`,
    statusElsewhere: (takePath) => `Занятость не публикуется: статусного адреса этого стояния у моста нет — он у держателя сокета; ${takePath}.`,
    statusRefused: (body, guidance) => `Занятость не принята: ${body}${guidance}`
  },
  en: {
    needRealmKarta: (tail2) => "Refused (bridge): iskron_stand needs realm and karta — the graph and the role from AGENTS.md or the launch line." + tail2,
    badCwd: (cwd, relative) => `Refused (bridge): cwd must be an existing absolute directory — got "${cwd}"${relative ? " (a relative path would resolve against the bridge's cwd, not the session's)" : ""}.`,
    badName: (asked, fault, max) => `Refused (bridge): name "${asked}" — ${fault}; the name rule: lowercase latin letters, digits, dot, underscore, hyphen, the first sign a letter or digit, at most ${max} signs. A name is never cut silently: a shorter name would address another seat.`,
    cutPart: (k) => k === "repo" ? "repo" : k === "host" ? "host" : "model",
    nameCut: (full, max, name2, what) => `the derived name ${full} is longer than the ${max}-sign limit — cut to ${name2} (dropped: ${what}); want another — pass name`,
    noModel: () => "model not passed — the name has no third part (host.repo): a second session of this machine over this repository lands on the same seat; pass model to tell them apart",
    legacy: (address, realm, karta) => `a seat of the former name ${address} is alive on the board — cases and hooks may hold its address; remove it: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`,
    boardUnread: (text2) => `Refused: the board did not read — ${text2}`,
    boardUnknown: (start, own, others) => `Refused: the board's form is not recognized — no «${own}» («${others}») header, no word about an empty graph, no seat lines; no controlling moves (connect, knock) on a guess. The answer begins: ${start}`,
    boardAmbiguous: (n, name2, karta) => `Refused: the board has ${n} seats named ${name2} for role #${karta} — the form is ambiguous, the state cannot be told.`,
    boardCount: (declared, parsed) => `Refused: the board declares ${declared} seats, ${parsed} were read, and your own is not among them — the unread line may be it, or a seat another session listens on; connect would rotate it blind, and take=true would take it. Repeat when the board reads, or stand under another name.`,
    boardCountFound: (declared, parsed) => `The board declares ${declared} seats, ${parsed} were read — the parser missed a line; your own seat is found, going on.`,
    refused: (what, text2) => `Refused: ${what} — ${text2}`,
    noIdInRegister: () => "register did not name the seat's id — the seat's frames are found by graph and address; the busy line waits for the id.",
    modelNotCleared: (why) => `The seat's earlier model is not cleared (${why}): the harness named no model, and the board may still show the earlier one.`,
    howBeside: (led) => `a seat of another graph — stands beside on the channel this bridge holds (${led}): register`,
    howReturned: () => "back to the seat the bridge had left — the socket reopened at the same address, register",
    howOwnSession: () => "this session's own seat — taken back: a former bridge of this same harness session held it, connect (the socket is now this bridge's, the former one got 4000) and register",
    otherHolder: (holder) => `Refused (bridge): another holder listens on the seat ${holder} — the bridge will not sign with it without hearing; stand on your own seat: iskron_stand without name or with another name.`,
    howRegister: () => "this bridge already holds the socket — register",
    ttlRefused: (ttl, text2) => `The contour refused the ${ttl} s idle window (${text2}) — the seat is taken with the contour's default window.`,
    takenButRegister: (text2) => `The seat is taken, but register refused — ${text2}`,
    howConnect: (mine, listensElsewhere, take2) => mine ? listensElsewhere ? "another holder listened on the seat — connect by take (the socket is now this bridge's, the former holder got 4000) and register" : take2 ? "connect by take — a new entry cycle, the knock count reset — and register" : "the seat was there — connect (the socket is now this bridge's) and register" : "connect and register",
    head: (place, karta, realm, how2) => `[iskron_stand] standing ${place} — role #${karta}, graph ${realm}: ${how2}.`,
    note: (text2) => `[iskron_stand] ${text2}`,
    noWatchdog: () => "No watchdog command: the bridge does not hold this seat's socket yet — this session takes no frames and no invitations until the seat is back.",
    noSocket: () => "The bridge holds no socket — nothing to listen with; check the connect answer.",
    besideNoDoor: () => "The seat is recorded, but it has no door — the bridge's channel socket is not alive; this graph's frames will not come here.",
    besideHeard: () => "This bridge holds the channel socket — this graph's seat frames go to its watchdog.",
    heldAlready: () => "This bridge holds the socket (hello came when the socket opened).",
    hello: (pending2) => `hello received: frames waiting — ${pending2}.`,
    noLocalSocket: (why) => `BUT the standing's local socket is not up (${why}) — the watchdog has nothing to attach to: no hearing in this session, the watchdog command above will not work. The seat is held, records are signed; tell the human.`,
    noHello: () => "no hello within 4 s — the bridge holds the socket, but there is no proof of hearing yet: check the board.",
    knockNotHere: (room) => `The human's seat ${room}: no knock sent — the bridge does not hold this seat's socket yet, the human's answer would not come here; knock with the same call once the seat is back.`,
    knockTwice: (room) => `The human's seat ${room}: knocked twice, no invitation — no more knocks this time; tell the human their seat did not answer and ask them to open the chat (a new entry resets the count: take=true or a new session).`,
    knockSent: (room, waited, window) => `The human's seat ${room}: a knock went ${s(waited)} s ago — wait for the invitation; a deliberate repeat — the same call with repeat_knock=true, not before ${s(window)} s.`,
    knockEarly: (room, waited, window) => `The human's seat ${room}: too early to repeat — ${s(waited)} s since the first knock, the rule waits ${s(window)} s; repeat in ${left(window, waited)} s.`,
    knockNoRole: (room, realm) => `The human's seat ${room}: the board of graph ${realm} does not have it, and send needs its holder's role — no knock sent. The human's seat lives by their presence: either they have been away past the threshold (ask them to open the chat and repeat), or pass room_karta=<the human's role>.`,
    knockRefused: (room, text2) => `The human's seat ${room}: the knock was refused — ${text2}`,
    knockDone: (room, again, text2) => `The human's seat ${room}: ${again ? "repeated " : ""}knock sent — ${text2} Wait for the first message from the human's seat with its header; do not write there before it — you will stand beside the human when it comes.`,
    statusElsewhere: (takePath) => `The busy line is not published: the bridge has no status address for this standing — the socket's holder has it; ${takePath}.`,
    statusRefused: (body, guidance) => `The busy line was not accepted: ${body}${guidance}`
  }
};

// js/delivery/words/standing.ts
var STANDING = {
  ru: { seatExpired: () => "место у платформы истекло — register: места нет" },
  en: { seatExpired: () => "the seat expired at the platform — register: no such seat" }
};

// js/delivery/words/standings.ts
var STANDINGS = {
  ru: {
    notDir: (dir2) => `${dir2} — не каталог`,
    otherUser: (dir2) => `${dir2} принадлежит другому пользователю`,
    openToOthers: (dir2) => `${dir2} открыт группе или прочим`
  },
  en: {
    notDir: (dir2) => `${dir2} is not a directory`,
    otherUser: (dir2) => `${dir2} belongs to another user`,
    openToOthers: (dir2) => `${dir2} is open to group or others`
  }
};

// js/delivery/words/standmiss.ts
var ONLY_RU = "Без karta вызов только ставит занятость места, которое ведёт этот мост";
var ONLY_EN = "Without karta the call only sets the busy line of the seat this bridge leads";
var STAND_MISS = {
  ru: {
    none: () => `${ONLY_RU} в этом графе, — такого места нет.`,
    args: (args) => `${ONLY_RU}, а вызов несёт ${args} — это занятие места; для одной занятости — только realm и status.`,
    name: (asked, held2) => `${ONLY_RU}: вызов называет имя ${asked}, а мост держит здесь ${held2} — назови его или опусти name.`,
    satellite: (of) => `${ONLY_RU}: место моста — не спутник места ${of}.`,
    cwd: (cwd) => `${ONLY_RU}: каталог ${cwd} не существует или не абсолютный.`,
    parked: () => `${ONLY_RU}, а с места этот мост ушёл словом (leave): вернись iskron_stand с karta тем же именем.`,
    elsewhere: () => `${ONLY_RU}, а сокета и статусного адреса этого места у моста нет — сокет места не у этого моста: место ждёт возврата с диска либо сокет отпущен (мёртвый токен, снятие); займи место iskron_stand с karta.`
  },
  en: {
    none: () => `${ONLY_EN} in this graph — there is none.`,
    args: (args) => `${ONLY_EN}, and the call carries ${args} — that is taking a seat; for the busy line alone — only realm and status.`,
    name: (asked, held2) => `${ONLY_EN}: the call names ${asked}, and the bridge holds ${held2} here — name it or leave name out.`,
    satellite: (of) => `${ONLY_EN}: the bridge's seat is not a satellite of ${of}.`,
    cwd: (cwd) => `${ONLY_EN}: the directory ${cwd} does not exist or is not absolute.`,
    parked: () => `${ONLY_EN}, and this bridge left its seat by word (leave): return by iskron_stand with karta under the same name.`,
    elsewhere: () => `${ONLY_EN}, and the bridge has neither the socket nor the status address of this seat — the seat's socket is not with this bridge: the seat waits for its return from disk, or the socket was released (dead token, revoke); take the seat by iskron_stand with karta.`
  }
};

// js/delivery/words/standmoves.ts
var STAND_MOVES = {
  ru: {
    standsInRealm: (realm, call, board, leave, roleOpen) => `Отказано (409): канал этого моста уже стоит в графе ${realm} другим местом — второго места одного канала в одном графе платформа не держит. ` + (call ? `Встань им: ${call}${roleOpen ? ` — karta места в его строке на доске ${board}` : ""}. ` : `Его имя — строка этого канала на доске ${board}; встань им: iskron_stand(realm="${realm}", karta, name=<то имя>). `) + `Нужно именно новое имя — сначала отпусти прежнее: ${leave}, затем повтори вызов.`,
    standAgain: (call) => `Место этой сессии мост сейчас не держит — займи его полным вызовом: ${call} (status можно передать в нём же).`,
    priorReleased: (prior) => `прежнее место этой сессии ${prior} снято: take переносит сессию на взятое место, а не прибавляет второе`,
    provisionalReplaced: (prior) => `место автопосадки ${prior} заменено: оно было предварительным — явный вызов встал на названное и снял его`,
    priorKept: (prior, text2, revoke) => `прежнее место этой сессии ${prior} не снято (${text2}) — пока оно живо, дела будут просить from_standing; сними его: ${revoke}`,
    besideHoldsMain: (prior, asked, beside, revokes, keep) => `Отказано: на основном месте этой сессии ${prior} стоят места рядом в других графах — ${beside}. Переход на ${asked} открыл бы новый канал: места рядом потеряли бы слух, а ${prior} не снялось бы, пока они стоят. Ничего не тронуто. Ход: сначала сними места рядом — ${revokes}, затем повтори вызов; или держи прежнее имя: ${keep}.`,
    reissueWaited: (seconds2, own) => own ? `твоё — возвращено: сокет этого места в тот же миг переоткрывал сам мост, вызов дождался его исхода (${seconds2} с)` : `сокет этого места только что переоткрывался — вызов переждал порог платформы (${seconds2} с) и занял место`,
    moveUndone: (asked, prior) => `Переход не состоялся: только что занятое место ${asked} снято, сессия осталась на прежнем месте ${prior} — оно у неё единственное.`,
    moveNotUndone: (asked, text2, revoke) => `Только что занятое место ${asked} снять не удалось (${text2}) — сними его: ${revoke}`
  },
  en: {
    standsInRealm: (realm, call, board, leave, roleOpen) => `Refused (409): this bridge's channel already stands in the graph ${realm} with another seat — the platform holds no second seat of one channel in one graph. ` + (call ? `Stand as it: ${call}${roleOpen ? ` — the seat's karta is in its line on the board ${board}` : ""}. ` : `Its name is this channel's line on the board ${board}; stand as it: iskron_stand(realm="${realm}", karta, name=<that name>). `) + `If a new name is what you need, release the former one first: ${leave}, then repeat the call.`,
    standAgain: (call) => `The bridge does not hold this session's seat now — take it with the full call: ${call} (status can go in the same call).`,
    priorReleased: (prior) => `this session's former seat ${prior} is revoked: take moves the session to the taken seat, it does not add a second one`,
    provisionalReplaced: (prior) => `the auto-seating's seat ${prior} is replaced: it was provisional — the explicit call stood on the named one and revoked it`,
    priorKept: (prior, text2, revoke) => `this session's former seat ${prior} is not revoked (${text2}) — while it lives, cases will ask for from_standing; revoke it: ${revoke}`,
    besideHoldsMain: (prior, asked, beside, revokes, keep) => `Refused: seats beside in other graphs stand on this session's main seat ${prior} — ${beside}. Moving to ${asked} would open a new channel: the seats beside would lose hearing, and ${prior} would not be revoked while they stand. Nothing was touched. Move: revoke the seats beside first — ${revokes}, then repeat the call; or keep the former name: ${keep}.`,
    reissueWaited: (seconds2, own) => own ? `yours — returned: the bridge itself was reopening this seat's socket at that moment, the call waited for its outcome (${seconds2} s)` : `this seat's socket was just reopened — the call waited out the platform's threshold (${seconds2} s) and took the seat`,
    moveUndone: (asked, prior) => `The move did not happen: the seat ${asked} just taken is revoked, the session stays on its former seat ${prior} — its only one.`,
    moveNotUndone: (asked, text2, revoke) => `The seat ${asked} just taken could not be revoked (${text2}) — revoke it: ${revoke}`
  }
};

// js/delivery/words/standtool.ts
var STAND_TOOL = {
  ru: {
    description: () => '[мост] Занять стояние одним вызовом: мост читает доску, выводит имя (машина.репо.модель), занимает место (connect и register; только register, если сокет уже держит этот мост), при room стучит кадром join в место человека по полному адресу с провода (повтор — только repeat_knock=true, один раз, не раньше чем через 2 минуты) и возвращает имя, команду сторожа, число ожидавших кадров и расписку стука. Очередь роли — iskron_orient(focus=роль) на входе и по поводу; кадр — адресату и участникам дела. Место в другом графе встаёт рядом на том же канале (register): сессия слышит все свои графы, и запись в каждом подписана местом этого графа. Дальше — запустить сторожа командой из ответа и ждать. Он же — ход занятости: на месте, которое этот мост уже держит, вызов realm и status (karta и name — те же или опущены; без model, room, take — с ними это занятие места и сверка) лишь ставит строку занятости — без доски, connect, register и стука; пустой status снимает; прежний iskron_channel(action="status") оставлен для совместимости. Тул исполняет мост; нет его в сессии — тулы идут мимо моста либо мост старой сборки (doctor скажет), стой по скиллу standing.',
    realm: () => "Адрес графа: @owner/slug или rN.",
    karta: () => "Роль агента (#N из AGENTS.md или строки запуска). Нужна, чтобы занять место; для занятости на держимом месте её можно опустить.",
    name: () => "Своя половина имени стояния; без неё выводится машина.репо.модель — модель из параметра model.",
    room: () => "Адрес места человека @handle:name (его даёт окно человека); мост стучит туда join, чтобы встать рядом с человеком.",
    model: () => "Модель, которой бежит агент (id или имя, например claude-opus-5 или opus-5) — третья часть выведенного имени; без неё имя — машина.репо.",
    muteSiblings: () => "Не слышать эхо других стояний той же роли.",
    take: () => "Сознательный переход: вытеснить живого держателя ДРУГОЙ сессии — своего имени (та же роль, та же учётка) сам, когда он молчит 5 минут на пробу словом (iskron_channel send), чужого (другая роль или учётка) — только по слову человека (без take имя, выведенное или явное, которое держит другая сессия, встаёт рядом на имя.N со слухом; своё место, которое держит прежний мост этой же сессии харнесса, мост возвращает сам — take не нужен); либо сменить место этого моста в графе (в графе одно место на мост: другая роль или другое имя без take — отказ вслух, прежнее место остаётся на доске без слуха). Место в другом графе take не требует — оно встаёт рядом.",
    roomKarta: () => "Роль человека, чьё это место (#N), если места нет на доске; обычно роль человека, приславшего адрес места.",
    repeatKnock: () => "Осознанный повтор стука в то же место человека: разрешён один раз и не раньше чем через 2 минуты после первого; без него повторный вызов второго join не шлёт.",
    satelliteOf: () => "Только мосту-спутнику субагента (запись моста с --satellite в файле агента): место позвавшего @handle:name из постановки. Мост встаёт рядом местом-спутником <имя позвавшего>.sub-N (первое свободное N), ролью из karta (её называет постановка, роль позвавшего не наследуется); место живёт прогоном. name, take и room с ним не передаются.",
    status: () => "Занятость места, до 64 символов: при занятии — первая строка; на месте, которое этот мост уже держит, — основной способ обновить занятость (вызов только её и ставит); пустая строка снимает.",
    cwd: () => "Директория сессии харнесса, существующий абсолютный каталог — из неё выводится репо для имени (git toplevel, в связанном ворктри — основной копии, иначе её basename) и читаются ветки при поиске мест прежнего имени, когда мост запущен не из рабочей копии; плагин OpenCode подставляет её сам. Без неё — cwd моста; несуществующая или относительная — отказ вслух."
  },
  en: {
    description: () => `[bridge] Take a standing in one call: the bridge reads the board, derives the name (machine.repo.model), takes the seat (connect and register; only register if this bridge already holds the socket), with room knocks a join frame into the human's seat by the full address from the wire (a repeat — only repeat_knock=true, once, no sooner than 2 minutes) and returns the name, the watchdog command, the number of waiting frames and the knock receipt. Read the role queue with iskron_orient(focus=role) on entry and when occasion calls; frames go to the addressee and case participants. A seat in another graph stands beside on the same channel (register): the session hears all its graphs, and a write in each is signed by that graph's seat. Then — start the watchdog with the command from the reply and wait. It is also the busyness move: on a seat this bridge already holds, a call with realm and status (karta and name — the same or omitted; with model, room or take it is a seat-taking and a check) only sets the busyness line — no board, connect, register or knock; an empty status clears; the former iskron_channel(action="status") is kept for compatibility. The bridge executes the tool; if it is not in the session, the tools go past the bridge or the bridge is an old build (doctor will say), stand by the standing skill.`,
    realm: () => "Graph address: @owner/slug or rN.",
    karta: () => "The agent's role (#N from AGENTS.md or the launch line). Needed to take a seat; for busyness on a held seat it may be omitted.",
    name: () => "Your own half of the standing's name; without it machine.repo.model is derived — the model from the model parameter.",
    room: () => "The human's seat address @handle:name (the human's window gives it); the bridge knocks a join there to stand beside the human.",
    model: () => "The model the agent runs on (id or name, for example claude-opus-5 or opus-5) — the third part of the derived name; without it the name is machine.repo.",
    muteSiblings: () => "Do not hear the echo of other standings of the same role.",
    take: () => "A deliberate move: to displace a live holder of ANOTHER session — of your own name (the same role, the same account) by yourself when it stays silent 5 minutes to a probe by word (iskron_channel send), of another's (another role or account) — only on the human's word (without take a name, derived or explicit, that another session holds stands beside on name.N with hearing; the bridge takes back by itself a seat a former bridge of this same harness session holds — no take needed); or to change this bridge's seat in a graph (one seat per bridge in a graph: another role or another name without take is a refusal aloud, the former seat stays on the board without hearing). A seat in another graph does not need take — it stands beside.",
    roomKarta: () => "The role of the human whose seat it is (#N) if the seat is not on the board; usually the role of the human who sent the seat address.",
    repeatKnock: () => "A deliberate repeat of the knock at the same human seat: allowed once and no sooner than 2 minutes after the first; without it a repeated call sends no second join.",
    satelliteOf: () => "Only for a subagent's satellite bridge (the bridge entry with --satellite in the agent file): the caller's seat @handle:name from the brief. The bridge stands beside as the satellite seat <caller's name>.sub-N (the first free N), with the role from karta (the brief names it, the caller's role is not inherited); the seat lives for the run. name, take and room are not passed with it.",
    status: () => "The seat's busyness, up to 64 characters: on taking — the first line; on a seat this bridge already holds — the main way to update busyness (the call sets only it); an empty string clears.",
    cwd: () => "The harness session's directory, an existing absolute path — the repo for the name is derived from it (git toplevel, in a linked worktree — of the main copy, otherwise its basename) and branches are read when looking for seats of the former name, when the bridge is not started from the working copy; the OpenCode plugin supplies it itself. Without it — the bridge's cwd; a nonexistent or relative one is a refusal aloud."
  }
};

// js/delivery/words/status.ts
var TAKE_PATH_RU = `iskron_stand с take=true (${TAKE.ru.rule()}) переносит слух и статусный адрес сюда ОДИН раз: адрес остаётся у ЭТОГО экземпляра моста, и поднятый следом сторож его не уносит — по устройству: сторож есть локальный клиент сокета, своего connect он не делает (замер: два вызова занятости подряд при живом стороже, сборка 6.10.1; путь take наблюдала сторона nks-mcp на своей). Прежний держатель получит закрытие 4000 (вытесненному отбивать место назад тем же ходом не нужно — ему место рядом, имя.N); входной адрес и очередь места connect не трогает, ждавшее придёт в hello (справка iskron_channel action="?", connect); после переноса перевзведи сторожа командой из ответа`;
var TAKE_PATH_EN = `iskron_stand with take=true (${TAKE.en.rule()}) moves the hearing and the status address here ONCE: the address stays with THIS bridge instance, and a watchdog raised after it does not carry it off — by design: the watchdog is a local client of the socket and makes no connect of its own. The former holder gets close 4000 (the evicted one need not take the seat back the same way — it gets a seat beside, name.N); connect does not touch the seat's incoming address and queue, what waited comes in hello (help: iskron_channel action="?", connect); after the move re-arm the watchdog with the command from the answer`;
var TWO_ENTRIES_RU = "Если место — твоё и держит его мост этой же сессии (в ней две записи iskron, плагинная и пользовательская), зови status тем же набором тулов, которым звал iskron_stand: передача не нужна.";
var TWO_ENTRIES_EN = "If the seat is yours and a bridge of this same session holds it (the session has two iskron entries, the plugin's and the user's), call status with the same tool set you called iskron_stand with: no move is needed.";
var TURNED_RU = `${TWO_ENTRIES_RU} Иначе ${TAKE_PATH_RU}.`;
var TURNED_EN = `${TWO_ENTRIES_EN} Otherwise ${TAKE_PATH_EN}.`;
var NOT_HELD_RU = "Отказано (мост): этот мост места не держит, статусного адреса у него нет.";
var NOT_HELD_EN = "Refused (bridge): this bridge holds no seat, it has no status address.";
var STATUS = {
  ru: {
    busyLine: (label, line, nudge) => `занятость ${label}: ${line || "(снята)"}${nudge}`,
    placeDerived: (place) => `${place} (адрес выведен, hello его не называл)`,
    placeUnnamed: (name2) => `места${name2 ? ` «${name2}»` : ""} (адреса @handle:name ещё нет — hello не пришёл)`,
    evictedWhy: () => `слух у другого держателя — вернуть его iskron_stand с take=true: ${TAKE.ru.rule()}`,
    reopeningWhy: () => "сокет переоткрывается — строка опубликована, слух вернётся сам",
    noSeatId: (key2) => `Отказано (мост): id места ${key2} у моста ещё не известен (hello его не назвал) — без него строка легла бы на все места канала; повтори iskron_stand этого графа.`,
    takePath: () => TAKE_PATH_RU,
    turnedGuidance: () => TURNED_RU,
    notHeld: () => NOT_HELD_RU,
    notHeldNone: () => `${NOT_HELD_RU} Назовись одним вызовом iskron_stand(realm, karta, model, status) — занятость можно передать прямо в нём. Если место слушает другой держатель, iskron_stand скажет это; тогда ${TAKE_PATH_RU}.`,
    notHeldList: (list3) => `${NOT_HELD_RU} Места этого графа на этой машине держат живые мосты: ${list3}. ${TURNED_RU}`,
    whereCwd: (cwd) => `каталог ${cwd}`,
    whereClient: (client) => `харнесс ${client}`
  },
  en: {
    busyLine: (label, line, nudge) => `busyness ${label}: ${line || "(cleared)"}${nudge}`,
    placeDerived: (place) => `${place} (address derived, hello did not name it)`,
    placeUnnamed: (name2) => `of the seat${name2 ? ` «${name2}»` : ""} (no @handle:name address yet — hello has not come)`,
    evictedWhy: () => `the hearing is with another holder — take it back by iskron_stand with take=true: ${TAKE.en.rule()}`,
    reopeningWhy: () => "the socket is reopening — the line is published, the hearing comes back by itself",
    noSeatId: (key2) => `Refused (bridge): the bridge does not yet know the id of the seat ${key2} (hello did not name it) — without it the line would land on all seats of the channel; repeat iskron_stand for this graph.`,
    takePath: () => TAKE_PATH_EN,
    turnedGuidance: () => TURNED_EN,
    notHeld: () => NOT_HELD_EN,
    notHeldNone: () => `${NOT_HELD_EN} Introduce yourself with one call iskron_stand(realm, karta, model, status) — busyness can be passed right in it. If another holder listens on the seat, iskron_stand will say so; then ${TAKE_PATH_EN}.`,
    notHeldList: (list3) => `${NOT_HELD_EN} Seats of this graph on this machine are held by live bridges: ${list3}. ${TURNED_EN}`,
    whereCwd: (cwd) => `directory ${cwd}`,
    whereClient: (client) => `harness ${client}`
  }
};

// js/delivery/words/statuspost.ts
var STATUS_POST = {
  ru: {
    trimmedBy: (message) => `строка обрезана сервером: ${message}`,
    trimmed: () => "сервер обрезал строку; переназови короче",
    noAnswer: (error) => `Отказано (мост): статусный адрес не ответил — ${error}`,
    gone: (body) => `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`,
    refused: (status, body) => `Отказано (${status}) поверхностью: ${body || "без тела"}`
  },
  en: {
    trimmedBy: (message) => `the server trimmed the line: ${message}`,
    trimmed: () => "the server trimmed the line; rename it shorter",
    noAnswer: (error) => `Refused (bridge): the status address did not answer — ${error}`,
    gone: (body) => `Refused (404) by the surface: ${body || "no body"} — this seat address no longer addresses: another holder's connect may have turned it, or another instance of the same session's bridge may have held it. Whose it is now, the bridge cannot know from here.`,
    refused: (status, body) => `Refused (${status}) by the surface: ${body || "no body"}`
  }
};

// js/delivery/words/stop.ts
var WHO_RU = {
  person: "человеком",
  self: "сессией той же учётки",
  other: "владельцем или другой сессией"
};
var WHO_EN = {
  person: "by the human",
  self: "by a session of the same account",
  other: "by the owner or another session"
};
var STOP = {
  ru: {
    stopped: (name2, who) => `место ${name2} снято (${WHO_RU[who]}) — ты остановлен: работу кончи, место не занимай`,
    orderJournalRefused: (order, outcome) => `приказ останова ${order}: журнал на диске не записал ${outcome ? "исход" : "приказ"} — стоп исполнен всё равно, ${outcome ? "исход" : "исход без «принят»"} отправлен один раз, без повтора после перезапуска моста; проверь каталог гранта (orders/)`
  },
  en: {
    stopped: (name2, who) => `the seat ${name2} was taken off (${WHO_EN[who]}) — you are stopped: end the work, do not take the seat`,
    orderJournalRefused: (order, outcome) => `stop order ${order}: the journal on disk did not take the ${outcome ? "outcome" : "order"} — the stop is executed all the same, ${outcome ? "the outcome" : "the outcome without accepted"} is sent once, not repeated after a bridge restart; check the grant directory (orders/)`
  }
};

// js/delivery/words/stopcli.ts
var STOP_CLI = {
  ru: {
    usage: () => "использование: stop <место|id сессии> [--realm <граф>] [--auth-dir <dir>] [--lang en|ru]\n",
    noDaemon: () => "демон машины не ответил снимком — живых мест не видно; место, которое держит мост мимо демона, снимает его сессия (iskron_channel action=revoke)",
    notFound: (target) => `ни сессии, ни места «${target}» у демона машины нет — имена и id сессий печатает status`,
    ambiguous: (target, list3) => `«${target}» называет несколько мест: ${list3} — уточни --realm или назови id сессии`,
    otherOwner: (target, list3) => `места ${target} у этой машины нет: место этого имени здесь — ${list3}, другого владельца; stop снимает только места этой машины по их адресу, ничего не отправлено`,
    noOwner: (target) => `владельца места ${target} не сверить: демон не назвал адреса мест этого имени (адрес ещё не известен или сборка старше) — ничего не отправлено; назови id сессии из status`,
    noId: (seat2) => `id места ${seat2} мосту ещё не известен (hello его не назвал) — приказ адресовать нечем; повтори позже`,
    noRecord: (seat2) => `записи держания места ${seat2} на диске нет — адрес api этого места неизвестен`,
    noServer: (seat2) => `демон не назвал сервер места ${seat2} (сборка старше stop) — ключ выбрать нечем; обнови поставку: update`,
    noKey: (server) => `ключа учётки сервера ${server} нет — ни личного токена, ни гранта OAuth в каталоге гранта; вход — establish-mcp`,
    signIn: (server, why) => `ВОЙДИ ЗАНОВО: грант сервера ${server} не освежился (${why}) — ключ другого сервера месту не шлётся; вход — establish-mcp, затем повтори stop`,
    ordered: (seat2, order) => `приказ останова выдан месту ${seat2}${order ? ` (приказ ${order})` : ""}: мост погасит агента и ответит исходом; ушло ли место — status`,
    revoked: (seat2) => `api без приказа останова (404 ручки) — место ${seat2} снято (revoke): агент гаснет по закрытию сокета`,
    gone: (seat2) => `место ${seat2} уже снято (410)`,
    refused: (seat2, how2, status, body) => `место ${seat2}: ${how2} отказан (${status}) — ${body}`,
    unreachable: (seat2, why) => `место ${seat2}: api не ответил — ${why}`
  },
  en: {
    usage: () => "usage: stop <seat|session id> [--realm <graph>] [--auth-dir <dir>] [--lang en|ru]\n",
    noDaemon: () => "the machine daemon gave no snapshot — no live seats are seen; a seat a bridge holds past the daemon is revoked by its session (iskron_channel action=revoke)",
    notFound: (target) => `the machine daemon has neither a session nor a seat «${target}» — status prints the names and session ids`,
    ambiguous: (target, list3) => `«${target}» names several seats: ${list3} — narrow it by --realm or name the session id`,
    otherOwner: (target, list3) => `this machine has no seat ${target}: the seat of that name here is ${list3}, another owner's; stop takes off only this machine's seats by their address, nothing is sent`,
    noOwner: (target) => `the owner of the seat ${target} cannot be checked: the daemon named no address of the seats of that name (not known yet or an older build) — nothing is sent; name the session id from status`,
    noId: (seat2) => `the bridge does not know the id of the seat ${seat2} yet (hello did not name it) — the order has no address; repeat later`,
    noRecord: (seat2) => `there is no hold record of the seat ${seat2} on disk — the seat's api address is unknown`,
    noServer: (seat2) => `the daemon did not name the server of the seat ${seat2} (a build older than stop) — no key can be chosen; update the delivery: update`,
    noKey: (server) => `no account key for the server ${server} — neither a personal token nor an OAuth grant in the grant directory; sign in — establish-mcp`,
    signIn: (server, why) => `SIGN IN AGAIN: the grant of the server ${server} did not refresh (${why}) — another server's key is never sent to the seat; sign in — establish-mcp, then repeat stop`,
    ordered: (seat2, order) => `a stop order is issued to the seat ${seat2}${order ? ` (order ${order})` : ""}: the bridge puts the agent down and answers the outcome; whether the seat went — status`,
    revoked: (seat2) => `the api has no stop order (404 of the route) — the seat ${seat2} is revoked: the agent goes down on the socket's close`,
    gone: (seat2) => `the seat ${seat2} is already ended (410)`,
    refused: (seat2, how2, status, body) => `seat ${seat2}: ${how2} refused (${status}) — ${body}`,
    unreachable: (seat2, why) => `seat ${seat2}: the api did not answer — ${why}`
  }
};

// js/delivery/words/subagents.ts
var TODO = { ru: "НАДО:", en: "TODO:" };
var SUBAGENT = {
  ru: {
    todo: () => TODO.ru,
    form: (form) => {
      switch (form) {
        case "eval-no-sep":
          return "--satellite стоит без `--` после кода `node -e` — node примет его за свой флаг («bad option») и не запустится";
        case "eval-session":
          return "мост не увидит --satellite в своём argv (нет `--` перед ним или путь моста не положен в argv[1]) и встанет мостом сессии, не спутником";
        case "eval-other":
          return "код `node -e` не совпадает с эталонной формой записи — рабочей признаётся только она, сверенная живьём";
        case "shell":
          return "форма прежнего контракта (sh -c): на Windows sh нет, а переменных в args фронтматтера Claude Code не раскрывает";
        case "path":
          return "путь к мосту записан прямо в args — машинный путь в общем файле, на другой машине его нет";
        case "session":
          return "запись зовёт мост без --satellite — субагент встал бы мостом сессии, а не спутником";
      }
    },
    osJudged: (platform3) => `ОС под суд: ${platform3}`,
    header: (root, os) => `субагенты: проект ${root} (${os})`,
    noFiles: (dirs) => `  файлов агентов нет (${dirs}) — позови doctor из каталога проекта, если субагенты там`,
    shadowed: (path, agent) => `  ${path}: затенён файлом проекта с тем же именем «${agent}» — Claude Code берёт проектный`,
    withBlock: (ready) => `блоком ниже вместо прежних mcpServers и disallowedTools:
${ready}`,
    proposed: (name2) => `${name2} (предложенная форма)`,
    refEntry: (name2, block) => `запись «${name2}» — ссылка на сервер из конфига сессии, не свой мост на прогон → замени встроенной записью, ${block}`,
    formEntry: (name2, form, block) => `запись «${name2}»: ${form} → ${block}`,
    noEntry: (block) => `записи моста-спутника нет — у субагента нет тулов графа → вставь во фронтматтер ${block}`,
    sharedName: (agent) => `запись названа «iskron-sub» — общим именем прежнего контракта: второй файл с ним поведёт свои прогоны тем же процессом моста → переименуй запись в iskron-sub-${agent}`,
    replaceEntry: (name2, form, block) => `запись «${name2}»: ${form} → замени ${block}`,
    noCommand: (name2, command) => `команда записи «${name2}» «${command}» на этой машине не находится (PATH) → поставь Node 22+ либо добавь каталог node в PATH: Claude Code запускает его по PATH`,
    noBridge: (bridge, home) => `моста по пути записи нет: ${bridge} → поставь его (скилл establish-mcp кладёт домашнюю копию ${home}), затем повтори doctor`,
    callerBridges: (need2, fix2) => `мосты позвавшего не сняты (${need2 || "disallowedTools нет"}) — субагент унаследует их тулы, и его записи уйдут местом позвавшего → замени строку: disallowedTools: ${fix2}`,
    ownRemoved: (own) => `disallowedTools снимает свой же мост ${own} → убери ${own} из disallowedTools`,
    nameShared: (name2, count, files, agent) => `имя записи «${name2}» делят ${count} файла(ов): ${files} — Claude Code держит одно соединение на имя записи, их прогоны пойдут одним процессом моста, и первый закончивший погасит место другим → переименуй запись в этом файле: iskron-sub-${agent}`,
    noGrantAgain: () => "проба спутника не шла — входа в граф на этой машине нет (действие — строкой выше)",
    noGrant: (advice) => `проба спутника не шла — входа в граф на этой машине нет → ${advice}`,
    sameFailed: (label) => `проба той же команды, что у «${label}», не прошла — действие выше`,
    sameProbe: (label) => `проба: та же команда, что у «${label}» выше`,
    userScope: () => " (пользовательский)",
    named: (...names2) => `запись «${names2.join("», «")}»`,
    unnamed: () => "без записи моста-спутника",
    fine: () => " — в порядке",
    ocKeys: (keys) => `; ${TODO.ru} ключ ${keys} OpenCode в файле агента не читает → убери его`,
    ocAgent: (path, keyNote) => `  ${path}: OpenCode — мост-спутник даёт дочерней сессии плагин поставки (строка OpenCode выше), записи в файле не нужно${keyNote}`,
    trustNear: (near, here) => `доверие к папке принято для «${near}», а проект открыт как «${here}» — Claude Code сравнивает путь буква в букву (C:/ и c:/ — разные папки), и в недоверенной папке сервер из фронтматтера не поднимается без диалога → запусти claude в терминале из этой папки и прими диалог доверия либо открой папку тем же написанием пути`,
    trustNone: (here) => `доверие к папке «${here}» и её родителям в ~/.claude.json не отмечено — в недоверенной папке сервер из фронтматтера не поднимается, и диалога об этом нет → запусти claude в этой папке и прими диалог доверия`
  },
  en: {
    todo: () => TODO.en,
    form: (form) => {
      switch (form) {
        case "eval-no-sep":
          return '--satellite stands without `--` after the `node -e` code — node takes it for its own flag ("bad option") and will not start';
        case "eval-session":
          return "the bridge will not see --satellite in its argv (no `--` before it, or the bridge path is not put into argv[1]) and will stand as a session bridge, not a satellite";
        case "eval-other":
          return "the `node -e` code does not match the reference form — only that form, verified live, is accepted as working";
        case "shell":
          return "the form of the former contract (sh -c): Windows has no sh, and Claude Code does not expand variables in frontmatter args";
        case "path":
          return "the bridge path is written straight into args — a machine path in a shared file, absent on another machine";
        case "session":
          return "the entry calls the bridge without --satellite — the subagent would stand as a session bridge, not a satellite";
      }
    },
    osJudged: (platform3) => `OS under judgment: ${platform3}`,
    header: (root, os) => `subagents: project ${root} (${os})`,
    noFiles: (dirs) => `  no agent files (${dirs}) — call doctor from the project directory if the subagents are there`,
    shadowed: (path, agent) => `  ${path}: shadowed by the project file with the same name "${agent}" — Claude Code takes the project one`,
    withBlock: (ready) => `with the block below instead of the former mcpServers and disallowedTools:
${ready}`,
    proposed: (name2) => `${name2} (proposed form)`,
    refEntry: (name2, block) => `entry "${name2}" is a reference to a server from the session config, not its own bridge per run → replace it with an inline entry, ${block}`,
    formEntry: (name2, form, block) => `entry "${name2}": ${form} → ${block}`,
    noEntry: (block) => `no satellite bridge entry — the subagent has no graph tools → insert into the frontmatter ${block}`,
    sharedName: (agent) => `the entry is named "iskron-sub" — the shared name of the former contract: a second file with it would run its runs through the same bridge process → rename the entry to iskron-sub-${agent}`,
    replaceEntry: (name2, form, block) => `entry "${name2}": ${form} → replace ${block}`,
    noCommand: (name2, command) => `the command of entry "${name2}" "${command}" is not found on this machine (PATH) → install Node 22+ or add the node directory to PATH: Claude Code launches it via PATH`,
    noBridge: (bridge, home) => `no bridge at the entry path: ${bridge} → install it (the establish-mcp skill places a home copy at ${home}), then repeat doctor`,
    callerBridges: (need2, fix2) => `the caller's bridges are not removed (${need2 || "no disallowedTools"}) — the subagent would inherit their tools, and its writes would go out under the caller's seat → replace the line: disallowedTools: ${fix2}`,
    ownRemoved: (own) => `disallowedTools removes the entry's own bridge ${own} → remove ${own} from disallowedTools`,
    nameShared: (name2, count, files, agent) => `the entry name "${name2}" is shared by ${count} file(s): ${files} — Claude Code keeps one connection per entry name, their runs would go through one bridge process, and the first to finish would put out the seat for the others → rename the entry in this file: iskron-sub-${agent}`,
    noGrantAgain: () => "the satellite probe did not run — there is no graph login on this machine (the action is in the line above)",
    noGrant: (advice) => `the satellite probe did not run — there is no graph login on this machine → ${advice}`,
    sameFailed: (label) => `the probe of the same command as "${label}" failed — the action is above`,
    sameProbe: (label) => `probe: the same command as "${label}" above`,
    userScope: () => " (user)",
    named: (...names2) => `entry "${names2.join('", "')}"`,
    unnamed: () => "no satellite bridge entry",
    fine: () => " — fine",
    ocKeys: (keys) => `; ${TODO.en} the key ${keys} is not read by OpenCode in an agent file → remove it`,
    ocAgent: (path, keyNote) => `  ${path}: OpenCode — the delivery plugin gives the child session a satellite bridge (the OpenCode line above), no entry is needed in the file${keyNote}`,
    trustNear: (near, here) => `folder trust was accepted for "${near}", but the project is opened as "${here}" — Claude Code compares the path letter for letter (C:/ and c:/ are different folders), and in an untrusted folder the frontmatter server does not start without a dialog → run claude in a terminal from this folder and accept the trust dialog, or open the folder with the same spelling of the path`,
    trustNone: (here) => `trust for the folder "${here}" and its parents is not marked in ~/.claude.json — in an untrusted folder the frontmatter server does not start, and there is no dialog about it → run claude in this folder and accept the trust dialog`
  }
};

// js/delivery/words/suspend.ts
var SUSPEND = {
  ru: {
    noSeat: () => "места-спутника нет — паузы нет",
    reason: () => "пауза спутника"
  },
  en: {
    noSeat: () => "no satellite seat — nothing to pause",
    reason: () => "satellite pause"
  }
};

// js/delivery/words/thin.ts
var THIN = {
  ru: {
    besideNotBack: () => "место рядом не вернулось вместе с основным"
  },
  en: {
    besideNotBack: () => "the seat beside did not come back with the main one"
  }
};

// js/delivery/words/unnamed.ts
var UNNAMED = {
  ru: {
    refused: (action) => `Отказано (мост): ${action} без имени места — место роли с пустым именем мост не занимает (его адрес совпал бы с местом человека, а снять его нечем); вызов не отправлен. Назови место явно: name (строчные латинские буквы, цифры, «.», «_», «-»). Безымянное место самого человека — karta="me" при ISKRON_BRIDGE_OWNER_ROLE=1 в окружении моста, которую ставит он сам.`
  },
  en: {
    refused: (action) => `Refused (bridge): ${action} without a seat name — the bridge does not take a role seat with an empty name (its address would coincide with the human's seat, and nothing could take it off); the call was not sent. Name the seat explicitly: name (lower-case Latin letters, digits, «.», «_», «-»). The human's own unnamed seat is karta="me" with ISKRON_BRIDGE_OWNER_ROLE=1 in the bridge's environment, set by the human.`
  }
};

// js/delivery/words/update.ts
var UPDATE = {
  ru: {
    reexecNewer: (homeVersion, version, path) => `домашняя копия новее этой сборки (v${homeVersion} > v${version}) — запускаюсь ею: ${path}`,
    restartFailed: (error) => `перезапуск не удался: ${error}`,
    versionMismatch: (got, version) => `скачанный мост называет v${got}, релиз — v${version}`,
    bridgeDownloaded: () => `Свежий мост уже скачан в ~/${HOME_DIR} и поднимется новой сессией.`,
    downloadFailed: (error, self) => `Скачать свежий мост не вышло (${error}); повтори: node "${self}" update.`,
    homeSymlink: () => "Свежий мост в дом не положен: дом — симлинк на чужую копию, его не трогаю; обнови эту копию сам.",
    bridgeAlreadyHome: () => `Свежий мост уже лежит в ~/${HOME_DIR} и поднимется новой сессией.`,
    bridgeNotHome: (self) => `Свежий мост в дом не положен; повтори: node "${self}" update (мост, который отвечает, — тот и обновляет дом; в пакетной поставке OpenCode мост живёт в пакете и обновляется с ним).`,
    stale: (version, fresh2, bridgeWord, claude, flat, pi, codex, setup) => `[${BRIDGE_NAME}] ПОСТАВКА ОТСТАЛА: этот мост v${version}, свежий релиз v${fresh2}. ${bridgeWord} Скиллы обновляет канал харнеса, и об этом надо СКАЗАТЬ ЧЕЛОВЕКУ: Claude Code — ${claude}; плоская установка — ${flat}; pi — ${pi}; Codex — ${codex}. Полный порядок — свежий установщик ${setup} (кладёт update); по слову человека «обнови» исполни его.`,
    moveClaude: () => "/plugin marketplace update iskron, затем /reload-plugins",
    moveFlat: () => "повторный npx skills add iskron-ai/skills --all --global (приносит новые скиллы и освежает стоящие: npx skills update --global ходит только по lock-файлу и новых не приносит, снятое убирается руками — npx skills remove <имя> --global)",
    movePi: () => "pi update git:github.com/iskron-ai/skills",
    moveCodex: () => "codex plugin marketplace upgrade iskron, затем codex plugin remove iskron@iskron и codex plugin add iskron@iskron"
  },
  en: {
    reexecNewer: (homeVersion, version, path) => `the home copy is newer than this build (v${homeVersion} > v${version}) — restarting with it: ${path}`,
    restartFailed: (error) => `restart failed: ${error}`,
    versionMismatch: (got, version) => `the downloaded bridge names v${got}, the release — v${version}`,
    bridgeDownloaded: () => `The fresh bridge is already downloaded into ~/${HOME_DIR} and comes up with a new session.`,
    downloadFailed: (error, self) => `Downloading the fresh bridge failed (${error}); repeat: node "${self}" update.`,
    homeSymlink: () => "The fresh bridge is not put home: home is a symlink to another copy, left alone; update that copy yourself.",
    bridgeAlreadyHome: () => `The fresh bridge already lies in ~/${HOME_DIR} and comes up with a new session.`,
    bridgeNotHome: (self) => `The fresh bridge is not put home; repeat: node "${self}" update (the bridge that answers is the one that updates home; in OpenCode's packaged delivery the bridge lives in the package and updates with it).`,
    stale: (version, fresh2, bridgeWord, claude, flat, pi, codex, setup) => `[${BRIDGE_NAME}] DELIVERY BEHIND: this bridge is v${version}, the fresh release is v${fresh2}. ${bridgeWord} The harness channel updates the skills, and this must be TOLD TO THE HUMAN: Claude Code — ${claude}; flat install — ${flat}; pi — ${pi}; Codex — ${codex}. The full order — the fresh installer ${setup} (update puts it); on the human's word "update" run it.`,
    moveClaude: () => "/plugin marketplace update iskron, then /reload-plugins",
    moveFlat: () => "repeat npx skills add iskron-ai/skills --all --global (it brings new skills and refreshes standing ones: npx skills update --global walks only the lock file and brings none, a dropped skill is removed by hand — npx skills remove <name> --global)",
    movePi: () => "pi update git:github.com/iskron-ai/skills",
    moveCodex: () => "codex plugin marketplace upgrade iskron, then codex plugin remove iskron@iskron and codex plugin add iskron@iskron"
  }
};

// js/delivery/words/usage.ts
var USAGE = {
  ru: {
    notHosted: () => "расход пишут только OpenCode и pi",
    noNumbers: () => "в снимке нет цифр"
  },
  en: {
    notHosted: () => "only OpenCode and pi report usage",
    noNumbers: () => "the snapshot has no numbers"
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
    listening: (key2, tail2 = "") => `слушаю стояние ${key2}${tail2}`,
    listeningCodex: (key2, thread) => `слушаю стояние ${key2}; кадры кладу в тред ${thread}`,
    backfilled: (count) => ` (${count} задним числом)`,
    frames: ruFrames,
    noHeld: () => "мост не держит ни одного стояния — назовись одним вызовом iskron_stand(realm, karta, model): его ответ назовёт команду слушания",
    severalHeld: (held2) => `мост держит несколько стояний — назови нужное: ${held2}`,
    bridgeLetGo: () => "мост отпустил стояние или ушёл — сессия кончилась?",
    seatNotBack: (s2, path) => `место не вернулось за ${s2}s после смены демона — сокет ${path} не поднят; вернуть — iskron_stand`,
    noSocket: (path, s2) => `мост не поднял локальный сокет ${path} за ${s2}s`,
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
    flushNotPut: (s2) => `ДЕЛАТЕЛЬ: не дождался вложения за ${s2}s после своего отпускания — пачка в тред не отправлена`,
    frameNotPut: (why) => `ДЕЛАТЕЛЬ: кадр не вложился — ${why}`,
    doorClosed: (why, lost) => `дверь закрылась: ${why} — открою заново на следующем кадре` + (lost ? `; без ответа: ${lost} — вернутся из кольца следующим взводом` : ""),
    doorNotOpened: (why) => `дверь не открылась: ${why}`,
    noIdFromRing: () => "кадр без id из кольца — пометить нечем, в тред не кладу повторно",
    alreadyPut: (id) => `кадр ${id} уже вложен — в тред не кладу повторно`
  },
  en: {
    doer: (text2) => `DOER: ${text2}`,
    listening: (key2, tail2 = "") => `listening on standing ${key2}${tail2}`,
    listeningCodex: (key2, thread) => `listening on standing ${key2}; putting frames into thread ${thread}`,
    backfilled: (count) => ` (${count} back-dated)`,
    frames: (n) => `${n} ${n === 1 ? "frame" : "frames"}`,
    noHeld: () => "the bridge holds no standing — name yourself with one call to iskron_stand(realm, karta, model): its answer names the listening command",
    severalHeld: (held2) => `the bridge holds several standings — name the one you need: ${held2}`,
    bridgeLetGo: () => "the bridge released the standing or went away — did the session end?",
    seatNotBack: (s2, path) => `the seat did not return within ${s2}s after the daemon change — socket ${path} is not up; to bring it back use iskron_stand`,
    noSocket: (path, s2) => `the bridge did not bring up the local socket ${path} within ${s2}s`,
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
    flushNotPut: (s2) => `DOER: the put did not go through within ${s2}s after one's own release — the batch was not sent to the thread`,
    frameNotPut: (why) => `DOER: the frame was not put in — ${why}`,
    doorClosed: (why, lost) => `the door closed: ${why} — will reopen on the next frame` + (lost ? `; unanswered: ${lost} — will come back from the ring on the next arming` : ""),
    doorNotOpened: (why) => `the door did not open: ${why}`,
    noIdFromRing: () => "a frame without an id from the ring — nothing to mark it with, not putting it into the thread again",
    alreadyPut: (id) => `frame ${id} was already put in — not putting it into the thread again`
  }
};

// js/shared/version.ts
var releaseBuild = () => CHANNEL_MARK.endsWith(":release");
var devBuildIn = (text2) => text2.includes(`"${[BUILD_MARK, "dev"].join(":")}"`);
function buildOf(selfUrl) {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}
var MARK_LITERAL = /"([^"\s]+-build):(?:dev|release)"/g;
function versionIn(text2) {
  for (const [, name2] of text2.matchAll(MARK_LITERAL)) if (name2 !== BUILD_MARK) return null;
  const m = /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text2);
  return m ? m[1] : null;
}

// js/bridge/build.ts
var BUILD = buildOf(import.meta.url);

// js/bridge/daemon.ts
import { spawn as spawn3 } from "node:child_process";
import { appendFileSync as appendFileSync5, mkdirSync as mkdirSync15, readFileSync as readFileSync26, statSync as statSync9 } from "node:fs";
import { join as join23 } from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";

// js/shared/home.ts
import { homedir } from "node:os";
import { join } from "node:path";
var homeBridgePath = () => join(homedir(), HOME_DIR, HOME_BRIDGE_FILE);

// js/shared/regex.ts
var escapeRe = (s2) => s2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
function newScope(id, origin2, sessionKey) {
  return { id, origin: origin2, sessionKey, slots: /* @__PURE__ */ new Map(), log: null };
}
var runIn = (scope, fn) => als.run(scope, fn);
function bindScope(fn) {
  const s2 = als.getStore();
  return s2 ? (...a) => als.run(s2, () => fn(...a)) : fn;
}
var bindAll = (o) => Object.fromEntries(
  Object.entries(o).map(([k, v]) => [
    k,
    typeof v === "function" ? bindScope(v) : v
  ])
);
function scoped(init) {
  const key2 = {};
  const own = () => {
    const slots = currentScope().slots;
    let v = slots.get(key2);
    if (v === void 0) {
      v = init();
      slots.set(key2, v);
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
  const s2 = currentScope();
  if (s2.origin && s2.sessionKey(k)) return s2.origin.env[k];
  return process.env[k];
}
var sessionPid = () => currentScope().origin?.pid ?? process.pid;
var sessionCwd = () => currentScope().origin?.cwd ?? process.cwd();

// js/shared/seam.ts
import { createHash as createHash2 } from "node:crypto";
import { connect } from "node:net";

// js/shared/snapshot.ts
var record = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var text = (v) => typeof v === "string" ? v : "";
var number = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
var list = (v) => Array.isArray(v) ? v : [];
function safeSkills(v) {
  const s2 = record(v);
  if (typeof s2.name !== "string" || typeof s2.version !== "string") return void 0;
  return {
    name: s2.name,
    version: s2.version,
    ...typeof s2.stamp === "string" ? { stamp: s2.stamp } : {}
  };
}
function safeUsage(v) {
  const raw = record(v);
  const out7 = {};
  for (const k of [
    "tokens",
    "input",
    "output",
    "cache_read",
    "cache_write",
    "context",
    "window",
    "percent"
  ])
    if (typeof raw[k] === "number" && Number.isFinite(raw[k])) out7[k] = raw[k];
  for (const k of ["model", "at"]) if (typeof raw[k] === "string") out7[k] = raw[k];
  return Object.keys(out7).length ? out7 : void 0;
}
function safePulse(v) {
  const raw = record(v);
  if (typeof raw.state !== "string") return void 0;
  const out7 = { state: raw.state };
  if (typeof raw.pending === "number" && Number.isFinite(raw.pending)) out7.pending = raw.pending;
  for (const k of ["turn_at", "read_at", "cycle_at", "sent_at"])
    if (typeof raw[k] === "string") out7[k] = raw[k];
  return out7;
}
function safePlace(v) {
  const p = record(v);
  const usage2 = safeUsage(p.usage);
  const pulse = safePulse(p.pulse);
  const skills = safeSkills(p.skills);
  return {
    name: text(p.name),
    realm: text(p.realm),
    karta: typeof p.karta === "number" ? number(p.karta) : text(p.karta),
    primary: p.primary === true,
    listening: p.listening === true,
    ...typeof p.standing_id === "string" ? { standing_id: p.standing_id } : {},
    ...typeof p.address === "string" && p.address ? { address: p.address } : {},
    ...typeof p.satellite_of === "string" ? { satellite_of: p.satellite_of } : {},
    ...typeof p.last_work_at === "string" ? { last_work_at: p.last_work_at } : {},
    ...usage2 ? { usage: usage2 } : {},
    ...pulse ? { pulse } : {},
    ...skills ? { skills } : {},
    ...typeof p.skills_mismatch === "boolean" ? { skills_mismatch: p.skills_mismatch } : {}
  };
}
function safeSnapshot(v) {
  const raw = record(v);
  const d = record(raw.daemon);
  return {
    daemon: { pid: number(d.pid), build: text(d.build), path: text(d.path) },
    sessions: list(raw.sessions).map((v2) => {
      const s2 = record(v2);
      const skills = safeSkills(s2.skills);
      const installed = safeSkills(s2.installed_skills);
      return {
        local_id: text(s2.local_id),
        thin_pid: number(s2.thin_pid),
        attached: s2.attached === true,
        harness: text(s2.harness),
        harness_session: typeof s2.harness_session === "string" ? s2.harness_session : null,
        cwd: text(s2.cwd),
        build: text(s2.build),
        ...typeof s2.server === "string" && s2.server ? { server: s2.server } : {},
        ...typeof s2.api === "string" && s2.api ? { api: s2.api } : {},
        ...skills ? { skills } : {},
        ...installed ? { installed_skills: installed } : {},
        ...typeof s2.skills_mismatch === "boolean" ? { skills_mismatch: s2.skills_mismatch } : {},
        places: list(s2.places).map(safePlace)
      };
    })
  };
}

// js/shared/seam.ts
var SEAM_PROTOCOL = 1;
var SEAM_REATTACH_GRACE_MS = 5e3;
var DAEMON_ENV = envName("BRIDGE_DAEMON");
var NO_DAEMON_ENV = envName("BRIDGE_NO_DAEMON");
var TOKEN_ENV = envName("BRIDGE_TOKEN");
var patShaOf = (pat) => pat ? createHash2("sha256").update(pat).digest("hex").slice(0, 16) : null;
var PASS_ENV = /* @__PURE__ */ new Set([
  "CLAUDE_PLUGIN_ROOT",
  "XDG_STATE_HOME",
  "NODE_EXTRA_CA_CERTS",
  "NODE_USE_ENV_PROXY",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy"
]);
var isSessionEnvKey = (k) => k !== TOKEN_ENV && (k.startsWith(ENV_PREFIX) || PASS_ENV.has(k));
function seamEnv(env2 = process.env) {
  const out7 = {};
  for (const [k, v] of Object.entries(env2)) if (v !== void 0 && isSessionEnvKey(k)) out7[k] = v;
  return out7;
}
var BASE_ENV = [
  "HOME",
  "USERPROFILE",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "LANG",
  "LC_ALL",
  "BUN_BE_BUN",
  TOKEN_ENV
];
function daemonEnv(env2 = process.env) {
  const out7 = seamEnv(env2);
  for (const k of BASE_ENV) if (env2[k] !== void 0) out7[k] = env2[k];
  return out7;
}
function helloFrame(o) {
  return {
    t: "hello",
    seam: SEAM_PROTOCOL,
    product: PRODUCT,
    build: o.build,
    path: o.path,
    argv: o.argv,
    env: seamEnv(),
    cwd: process.cwd(),
    pid: process.pid,
    session: o.session ?? null,
    patSha: o.patSha ?? null,
    ...o.probe ? { probe: true } : {}
  };
}
function checkHello(f) {
  const h = f;
  if (!h || h.t !== "hello") return "the first frame is not a hello";
  if (h.seam !== SEAM_PROTOCOL)
    return `seam protocol ${String(h.seam)} is not spoken here (this side speaks ${SEAM_PROTOCOL})`;
  if (h.product !== void 0 && h.product !== PRODUCT)
    return `the thin bridge belongs to the delivery ${String(h.product)} (this side is ${PRODUCT})`;
  if (!Array.isArray(h.argv) || typeof h.cwd !== "string" || typeof h.pid !== "number")
    return "the hello lacks argv, cwd or pid";
  return null;
}
function readFrames(socket, onFrame, onBad = () => {
}) {
  socket.setEncoding("utf8");
  let buf = "";
  socket.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let f;
      try {
        f = JSON.parse(line);
      } catch {
        onBad(line);
        continue;
      }
      onFrame(f);
    }
  });
}
function writeFrame(socket, frame2, cb) {
  if (socket.destroyed || !socket.writable) {
    cb?.(new Error("the seam socket is closed"));
    return false;
  }
  return socket.write(JSON.stringify(frame2) + "\n", cb);
}
var SeamError = class extends Error {
  kind;
  protocol;
  constructor(kind, message, protocol) {
    super(message);
    this.kind = kind;
    this.protocol = protocol;
  }
};
var ABSENT = /* @__PURE__ */ new Set(["ENOENT", "ECONNREFUSED", "ENOTSOCK", "ENOTDIR"]);
function connectSeam(path, hello, timeoutMs) {
  return new Promise((resolveLink, reject) => {
    const socket = connect(path);
    let welcome = null;
    const early = [];
    let frameCb = null;
    let closeCb = null;
    let closed = false;
    const fail2 = (e) => {
      clearTimeout(timer);
      socket.destroy();
      reject(e);
    };
    const timer = setTimeout(
      () => fail2(new SeamError("broken", `no welcome from the daemon in ${timeoutMs}ms`)),
      timeoutMs
    );
    timer.unref?.();
    socket.on("error", (e) => {
      if (welcome) return;
      fail2(new SeamError(ABSENT.has(e.code ?? "") ? "absent" : "broken", `${e.code ?? e.message}`));
    });
    socket.on("close", () => {
      if (!welcome) {
        fail2(new SeamError("broken", "the daemon closed the seam before its welcome"));
        return;
      }
      if (closed) return;
      closed = true;
      closeCb?.();
    });
    socket.on("connect", () => writeFrame(socket, hello));
    readFrames(socket, (f) => {
      if (!welcome) {
        if (f.t === "refuse") return fail2(new SeamError("refused", f.reason, f.seam));
        if (f.t !== "welcome") return fail2(new SeamError("broken", `expected welcome, got ${f.t}`));
        if (f.seam !== SEAM_PROTOCOL)
          return fail2(new SeamError("refused", "the daemon speaks another seam protocol", f.seam));
        welcome = f;
        clearTimeout(timer);
        resolveLink({
          welcome: f,
          send: (frame2, cb) => writeFrame(socket, frame2, cb),
          onFrame: (cb) => {
            frameCb = cb;
            for (const e of early.splice(0)) cb(e);
          },
          onClose: (cb) => {
            closeCb = cb;
            if (closed) cb();
          },
          close: () => {
            socket.end();
            setTimeout(() => socket.destroy(), 1e3).unref?.();
          }
        });
        return;
      }
      if (frameCb) frameCb(f);
      else early.push(f);
    });
  });
}

// js/shared/seam-entrance.ts
import { createHash as createHash4, randomBytes } from "node:crypto";
import { linkSync, mkdirSync as mkdirSync2, readFileSync as readFileSync3, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join as join4, resolve as resolve3 } from "node:path";

// js/shared/standings.ts
import { createHash as createHash3 } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join3, resolve as resolve2 } from "node:path";

// js/shared/lang.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
var isLang = (v) => LANGS.includes(v ?? "");
function forcedLang() {
  const v = envOf(envName("BRIDGE_LANG"))?.trim().toLowerCase();
  return isLang(v) ? v : null;
}
function resolve() {
  const forced = forcedLang();
  if (forced) return forced;
  const fromEnv = envOf(envName("BRIDGE_URL"))?.trim();
  if (fromEnv) return langOfServer(fromEnv);
  try {
    const text2 = readFileSync2(join2(authDirFromEnv(), "server"), "utf8").trim();
    if (text2) return langOfServer(text2);
  } catch {
  }
  return DEFAULT_LANG;
}
var S = scoped(() => ({ current: null }));
function setServerLang(serverUrl) {
  S.current = forcedLang() ?? langOfServer(serverUrl);
}
function setLang(l) {
  if (isLang(l)) S.current = l;
}
var lang = () => S.current ??= resolve();
var words = (dict) => dict[lang()];

// js/shared/standings.ts
var defaultAuthDir = () => join3(homedir2(), HOME_DIR);
var authDirFromEnv = () => envOf(envName("BRIDGE_AUTH_DIR"))?.trim() || defaultAuthDir();
var standingsDirOf = (authDir) => join3(authDir, "standings");
var hashOf = (key2) => createHash3("sha256").update(key2).digest("hex").slice(0, 16);
function socketPathOf(authDir, key2) {
  if (process.platform === "win32") return `\\\\.\\pipe\\${RUNTIME_PREFIX}-${hashOf(key2)}`;
  const near = join3(standingsDirOf(authDir), `${hashOf(key2)}.sock`);
  if (Buffer.byteLength(near) <= SOCKET_PATH_MAX) return near;
  return join3(shortSocketDir(), `${hashOf(resolve2(authDir) + "\0" + key2)}.sock`);
}
var SOCKET_PATH_MAX = 103;
var shortSocketDir = () => join3(
  "/tmp",
  `${RUNTIME_PREFIX}-${typeof process.getuid === "function" ? process.getuid() : "u"}`
);
function privateDirProblem(dir2, create = true) {
  let st;
  try {
    try {
      if (create) mkdirSync(dir2, { mode: 448 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    st = lstatSync(dir2);
  } catch (e) {
    return `${dir2}: ${e.message}`;
  }
  const W4 = words(STANDINGS);
  if (!st.isDirectory()) return W4.notDir(dir2);
  if (typeof process.getuid === "function" && st.uid !== process.getuid()) return W4.otherUser(dir2);
  if (st.mode & 63) return W4.openToOthers(dir2);
  return null;
}
var keyFilePathOf = (authDir, key2) => join3(standingsDirOf(authDir), `${hashOf(key2)}.key`);
var holdFilePathOf = (authDir, key2) => join3(standingsDirOf(authDir), `${hashOf(key2)}.hold`);
var baseFilePathOf = (authDir, key2) => join3(standingsDirOf(authDir), `${hashOf(key2)}.base`);
var takingFilePathOf = (authDir, key2) => join3(standingsDirOf(authDir), `${hashOf(key2)}.taking`);
var spoolFilePathOf = (authDir, key2) => join3(standingsDirOf(authDir), `${hashOf(key2)}.spool`);
function seenFilePathOf(authDir, key2, server = "") {
  if (!server) return join3(standingsDirOf(authDir), `${hashOf(key2)}.seen`);
  let origin2 = server;
  try {
    origin2 = new URL(server).origin;
  } catch {
  }
  return join3(standingsDirOf(authDir), `${hashOf(key2)}.${hashOf(origin2).slice(0, 8)}.seen`);
}

// js/shared/seam-entrance.ts
var seamKey = (authDir) => createHash4("sha256").update(resolve3(authDir)).digest("hex").slice(0, 16);
var seamRunDir = (authDir) => join4(resolve3(authDir), "run");
var SUN_PATH_MAX = 103;
function pipeNonce(authDir, create = true) {
  const run = seamRunDir(authDir);
  const file = join4(run, "pipe");
  if (!create) return readFileSync3(file, "utf8").trim();
  mkdirSync2(run, { recursive: true, mode: 448 });
  const tmp = `${file}.${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    writeFileSync(tmp, randomBytes(16).toString("hex"), { mode: 384 });
    linkSync(tmp, file);
  } catch {
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
    }
  }
  for (let i = 0; i < 50; i++) {
    const word3 = readFileSync3(file, "utf8").trim();
    if (word3) return word3;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  throw new Error(`${file} stays empty — the pipe name is unknown`);
}
function seamSocketPath(authDir, create = true) {
  const key2 = seamKey(authDir);
  if (process.platform === "win32")
    return `\\\\.\\pipe\\${RUNTIME_PREFIX}-daemon-${key2}-${pipeNonce(authDir, create)}`;
  const inRun = join4(seamRunDir(authDir), "daemon.sock");
  if (Buffer.byteLength(inRun) <= SUN_PATH_MAX) return inRun;
  return join4(shortSocketDir(), `daemon-${key2}.sock`);
}
function seamEntranceProblem(authDir, create = true) {
  if (process.platform === "win32") return null;
  const run = seamRunDir(authDir);
  try {
    if (create) mkdirSync2(dirname(run), { recursive: true, mode: 448 });
  } catch (e) {
    return `${dirname(run)}: ${e.message}`;
  }
  const bad = privateDirProblem(run, create);
  if (bad) return bad;
  const sockDir = dirname(seamSocketPath(authDir, create));
  return sockDir === run ? null : privateDirProblem(sockDir, create);
}
var seamRaiseLockPath = (authDir) => join4(seamRunDir(authDir), "daemon.raising");
var seamDaemonLockPath = (authDir) => join4(seamRunDir(authDir), "daemon.lock");
var ownPidAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
var readLock = (path) => {
  try {
    return JSON.parse(readFileSync3(path, "utf8"));
  } catch {
    return null;
  }
};
function takeFileLock(path, staleMs) {
  const token = `${process.pid}-${randomBytes(8).toString("hex")}`;
  const body = JSON.stringify({ pid: process.pid, token, started_at: Date.now() });
  const release = () => {
    if (readLock(path)?.token === token) {
      try {
        unlinkSync(path);
      } catch {
      }
    }
  };
  const claim = () => {
    const tmp = `${path}.${token}`;
    writeFileSync(tmp, body, { mode: 384 });
    try {
      linkSync(tmp, path);
      return true;
    } catch (e) {
      if (e.code === "EEXIST") return false;
      throw e;
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
      }
    }
  };
  try {
    if (claim()) return { held: true, release };
    const held2 = readLock(path);
    if (held2 && ownPidAlive(held2.pid) && Date.now() - held2.started_at < staleMs)
      return { held: false, fault: null, holder: { pid: held2.pid, started_at: held2.started_at } };
    const mistake = carryAwayStale(path, held2?.token);
    if (mistake) return { held: false, fault: mistake.putBack ? null : mistake.word };
    return claim() ? { held: true, release } : { held: false, fault: null };
  } catch (e) {
    return { held: false, fault: `${path}: ${e.message}` };
  }
}
function carryAwayStale(path, staleToken) {
  const away = `${path}.stale-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    renameSync(path, away);
  } catch {
    return null;
  }
  if (readLock(away)?.token !== staleToken) {
    try {
      linkSync(away, path);
    } catch {
      return {
        putBack: false,
        word: `a live lock was carried away by mistake and could not be put back (${path} is taken again); it is left as ${away}`
      };
    }
    try {
      unlinkSync(away);
    } catch {
    }
    return {
      putBack: true,
      word: `a live lock was carried away by mistake and put back — ${path} is held`
    };
  }
  try {
    unlinkSync(away);
  } catch {
  }
  return null;
}

// js/shared/seam-host.ts
import { chmodSync, unlinkSync as unlinkSync2 } from "node:fs";
import { connect as connect2, createServer } from "node:net";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
var HELLO_WAIT_MS = 5e3;
var graceTimers = /* @__PURE__ */ new Map();
var owners = /* @__PURE__ */ new Map();
function serveSeam(socket, host, graceMs = SEAM_REATTACH_GRACE_MS) {
  const say2 = (m) => host.log?.(m);
  let session = null;
  let helloSeen = false;
  let byeing = false;
  const early = [];
  const helloTimer = setTimeout(() => {
    if (!helloSeen) socket.destroy();
  }, HELLO_WAIT_MS);
  helloTimer.unref?.();
  socket.on("error", () => {
  });
  const refuse2 = (reason) => {
    say2(`seam refused: ${reason}`);
    writeFrame(socket, { t: "refuse", seam: SEAM_PROTOCOL, build: host.build, reason });
    socket.end();
  };
  let chain = Promise.resolve();
  const onFrame = (s2, f) => {
    if (f.t === "rpc") {
      const msg = f.msg;
      const request2 = msg.method !== void 0 && msg.id !== void 0 && msg.id !== null;
      if (request2 && host.draining?.()) {
        const late = host.answerDraining?.(s2.id, msg) ?? null;
        if (!late) {
          say2(`request ${JSON.stringify(msg.id)} not taken: the daemon is handing over`);
          return;
        }
        writeFrame(socket, { t: "ack", id: msg.id });
        void late.then((reply2) => writeFrame(socket, { t: "rpc", msg: reply2 })).catch((e) => say2(`request ${JSON.stringify(msg.id)} failed: ${e.message}`));
        return;
      }
      chain = chain.then(
        () => new Promise((done) => {
          if (!request2) {
            s2.deliver(msg);
            return done();
          }
          writeFrame(socket, { t: "ack", id: msg.id }, (err) => {
            if (!err) s2.deliver(msg);
            else say2(`request ${JSON.stringify(msg.id)} not taken: its ack did not go out`);
            done();
          });
        })
      );
    } else if (f.t === "bye") {
      byeing = true;
      owners.delete(s2);
      chain = chain.then(
        () => s2.end(f.why || "bye").then(() => {
          writeFrame(socket, { t: "bye-ok" });
          socket.end();
        })
      );
    }
  };
  readFrames(
    socket,
    (f) => {
      if (!helloSeen) {
        helloSeen = true;
        clearTimeout(helloTimer);
        const why = checkHello(f);
        if (why) return refuse2(why);
        void accept(f);
        return;
      }
      if (session) onFrame(session, f);
      else early.push(f);
    },
    (line) => say2(`unparseable seam line: ${line.slice(0, 120)}`)
  );
  const accept = async (hello) => {
    let snapshot;
    let snapshot_error;
    if (hello.snapshot && host.snapshot) {
      try {
        snapshot = host.snapshot();
      } catch {
        snapshot_error = "snapshot failed";
        say2("seam snapshot failed");
      }
    }
    const welcome = (id, resumed2) => writeFrame(socket, {
      t: "welcome",
      seam: SEAM_PROTOCOL,
      build: host.build,
      pid: process.pid,
      session: id,
      resumed: resumed2,
      ack: true,
      ...id === null && host.count ? { sessions: host.count() } : {},
      ...id === null && host.path ? { path: host.path } : {},
      ...snapshot ? { snapshot } : {},
      ...snapshot_error ? { snapshot_error } : {}
    });
    if (hello.probe || hello.snapshot) {
      welcome(null, false);
      socket.end();
      return;
    }
    if (host.draining?.()) {
      say2("seam hello dropped: the daemon is handing over to its successor");
      socket.destroy();
      return;
    }
    let s2 = hello.session ? host.find(hello.session) : null;
    const resumed = !!s2;
    if (!s2) {
      const opened = await host.open(hello);
      if (typeof opened === "string") return refuse2(opened);
      s2 = opened;
    }
    const grace = graceTimers.get(s2);
    if (grace) clearTimeout(grace);
    graceTimers.delete(s2);
    session = s2;
    owners.set(s2, socket);
    welcome(s2.id, resumed);
    s2.attach(
      (msg) => writeFrame(socket, { t: "rpc", msg }),
      (line) => writeFrame(socket, { t: "log", line })
    );
    say2(
      `seam session ${s2.id} ${resumed ? "resumed" : "opened"} for pid ${hello.pid} (${hello.build})`
    );
    for (const f of early.splice(0)) onFrame(s2, f);
  };
  socket.on("close", () => {
    clearTimeout(helloTimer);
    const s2 = session;
    if (!s2 || byeing || owners.get(s2) !== socket) return;
    owners.delete(s2);
    s2.attach(null, null);
    say2(`seam of session ${s2.id} closed without bye — ending it in ${graceMs}ms unless reattached`);
    const t = setTimeout(() => {
      graceTimers.delete(s2);
      void s2.end("the thin bridge is gone (seam closed without bye)");
    }, graceMs);
    t.unref?.();
    graceTimers.set(s2, t);
  });
}
function streamSeamSession(id, open, onLost, onLog) {
  const input = new PassThrough();
  const output = new PassThrough();
  let logSink = null;
  const engine = open({ input, output }, (line) => {
    onLog?.(line);
    logSink?.(line);
  });
  let sink = null;
  createInterface({ input: output, terminal: false }).on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (sink) sink(msg);
    else onLost?.(msg);
  });
  let ending = null;
  return {
    id,
    // Session gone — input closed: writing to an ended stream would be an error.
    deliver: (msg) => void (input.writableEnded || input.write(JSON.stringify(msg) + "\n")),
    attach: (s2, l) => {
      sink = s2;
      logSink = l ?? null;
    },
    end: (why) => ending ??= engine.leave(why).then(() => new Promise((r) => setImmediate(r))).then(() => void input.end())
  };
}
var fail = (code, message) => Object.assign(new Error(message), { code });
var DAEMON_RISE_MS = 15e3;
var socketAnswers = (path) => new Promise((r) => {
  const probe = connect2(path);
  probe.once("connect", () => {
    probe.destroy();
    r(true);
  });
  probe.once("error", () => r(false));
});
async function listenSeam(authDir, onSocket) {
  const bad = seamEntranceProblem(authDir);
  if (bad) throw fail("EUNSAFE", `the seam entrance is not private: ${bad}`);
  const path = seamSocketPath(authDir);
  if (await socketAnswers(path)) throw fail("EADDRINUSE", `a daemon already listens on ${path}`);
  const lockPath = seamDaemonLockPath(authDir);
  const lock = takeFileLock(lockPath, DAEMON_RISE_MS);
  if (!lock.held)
    throw fail(
      "EADDRINUSE",
      lock.fault ?? `the daemon lock ${lockPath} is held by pid ${lock.holder?.pid ?? "?"}, rising for ${Math.round((Date.now() - (lock.holder?.started_at ?? Date.now())) / 1e3)}s — its socket does not answer yet`
    );
  const win = process.platform === "win32";
  try {
    if (!win) {
      try {
        unlinkSync2(path);
      } catch {
      }
    }
    const server = createServer(onSocket);
    await new Promise((r, reject) => {
      server.once("error", reject);
      server.listen(path, () => r());
    });
    if (!win) chmodSync(path, 384);
    server.once("close", lock.release);
    process.once("exit", lock.release);
    return server;
  } catch (e) {
    lock.release();
    throw e;
  }
}

// js/shared/semver.ts
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec((v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// js/bridge/config.ts
import { mkdirSync as mkdirSync3, readFileSync as readFileSync4, renameSync as renameSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join5 } from "node:path";

// js/bridge/streams.ts
var FLUSH_STOP_MS = 5e3;
var deadStreams = /* @__PURE__ */ new WeakSet();
var out = scoped(() => ({ stream: null }));
var sessionStream = () => out.stream ?? process.stdout;
function setSessionOutput(s2) {
  out.stream = s2;
}
var processLog = null;
function setProcessLog(fn) {
  processLog = fn;
}
function canWrite(s2) {
  return !!s2 && !deadStreams.has(s2) && !s2.destroyed && s2.writable !== false;
}
function guardStream(s2) {
  if (s2) s2.on("error", () => deadStreams.add(s2));
}
var backlogged = /* @__PURE__ */ new WeakSet();
function writeTo(s2, text2) {
  if (!canWrite(s2)) return false;
  try {
    const fit = s2.write(text2);
    if (!fit && !backlogged.has(s2)) s2.once("drain", () => backlogged.delete(s2));
    if (fit) backlogged.delete(s2);
    else backlogged.add(s2);
    return true;
  } catch {
    deadStreams.add(s2);
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
function debug(msg) {
  if (CFG?.debug) log(`debug: ${msg}`);
}
function emit(msg) {
  if (!out.stream && processLog)
    return processLog(`emit outside of a session, dropped: ${JSON.stringify(msg).slice(0, 200)}
`);
  writeTo(sessionStream(), JSON.stringify(msg) + "\n");
}
function flushStdout(out7 = sessionStream()) {
  return new Promise((resolve11) => {
    if (!canWrite(out7)) return resolve11();
    let done = false;
    const finish2 = () => {
      if (done) return;
      done = true;
      out7.off("error", finish2);
      out7.off("close", finish2);
      resolve11();
    };
    out7.once("error", finish2);
    out7.once("close", finish2);
    if (backlogged.has(out7)) out7.once("drain", finish2);
    else out7.write("", finish2);
    setTimeout(finish2, FLUSH_STOP_MS).unref();
  });
}

// js/bridge/config.ts
var PRODUCTION_URLS = new Set(LANGS.map((l) => strip(SERVER_URLS[l])));
function strip(url) {
  return url.replace(/\/+$/, "");
}
var isProductionServer = (url) => PRODUCTION_URLS.has(strip(url));
function resolveServerChoice(word3) {
  const w = word3.trim();
  const chosen = LANGS.find((l) => SERVER_CHOICE[l].test(w));
  if (chosen) return SERVER_URLS[chosen];
  try {
    return new URL(w).href;
  } catch {
    return null;
  }
}
var serverChoicePath = (authDir) => join5(authDir, "server");
function readServerChoice(authDir) {
  try {
    const text2 = readFileSync4(serverChoicePath(authDir), "utf8").trim();
    return text2 ? new URL(text2).href : null;
  } catch {
    return null;
  }
}
function writeServerChoice(authDir, url) {
  const path = serverChoicePath(authDir);
  mkdirSync3(authDir, { recursive: true, mode: 448 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync2(tmp, url + "\n", { mode: 384 });
  renameSync2(tmp, path);
  return path;
}
var cfgSlot = scoped(() => ({ cfg: null }));
var CFG = new Proxy({}, {
  get: (_, k) => cfgSlot.cfg ? Reflect.get(cfgSlot.cfg, k) : void 0,
  has: (_, k) => !!cfgSlot.cfg && Reflect.has(cfgSlot.cfg, k)
});
function setConfig(cfg) {
  cfgSlot.cfg = cfg;
  setServerLang(cfg.serverUrl);
}
var ArgsError = class extends Error {
  code;
  /** Text for stdout instead of stderr (--version). */
  out;
  constructor(message, code, out7 = null) {
    super(message);
    this.code = code;
    this.out = out7;
  }
};
function parseArgs(argv2) {
  try {
    return readArgs(argv2);
  } catch (e) {
    if (!(e instanceof ArgsError)) throw e;
    if (e.out !== null) process.stdout.write(e.out);
    else log(e.message);
    process.exit(e.code);
  }
}
function readArgs(argv2) {
  const cfg = {
    serverUrl: "",
    timeoutMs: Number(envOf(envName("BRIDGE_TIMEOUT"))) || 12e4,
    authDir: envOf(envName("BRIDGE_AUTH_DIR")) || join5(homedir3(), HOME_DIR),
    clientName: BRIDGE_NAME,
    noBrowser: !!envOf(envName("BRIDGE_NO_BROWSER")),
    debug: !!envOf(envName("BRIDGE_DEBUG")),
    scope: envOf(envName("BRIDGE_SCOPE")) || null,
    resource: envOf(envName("BRIDGE_RESOURCE")) || null,
    staticClientId: envOf(envName("BRIDGE_CLIENT_ID")) || null,
    deviceClientId: envOf(envName("BRIDGE_DEVICE_CLIENT")) || null,
    deviceRegister: envOf(envName("BRIDGE_DEVICE_REGISTER")) === "1",
    pat: null,
    patSource: null,
    serverSource: "argument",
    // Flag only: an older bridge fails loudly on an unknown flag but would ignore a variable
    // and stand as a full seat with a hold record.
    satellite: false,
    tools: null
  };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--timeout") cfg.timeoutMs = Number(argv2[++i]);
    else if (a === "--tools") {
      const names2 = (argv2[++i] ?? "").split(",").map((s2) => s2.trim()).filter(Boolean);
      if (!names2.length) {
        log("--tools needs a comma-separated list of tool names");
        process.exit(2);
      }
      cfg.tools = new Set(names2.map((n) => n.startsWith(TOOL_PREFIX) ? n : tool(n)));
    } else if (a === "--auth-dir") cfg.authDir = argv2[++i];
    else if (a === "--client-name") cfg.clientName = argv2[++i];
    else if (a === "--no-browser") cfg.noBrowser = true;
    else if (a === "--debug") cfg.debug = true;
    else if (a === "--satellite") cfg.satellite = true;
    else if (a === "--version") throw new ArgsError("--version", 0, BUILD + "\n");
    else if (!a.startsWith("--") && !cfg.serverUrl) cfg.serverUrl = a;
    else throw new ArgsError(`unknown argument: ${a}`, 2);
  }
  if (!cfg.serverUrl) {
    const fromEnv = envOf(envName("BRIDGE_URL"))?.trim();
    const fromFile = fromEnv ? null : readServerChoice(cfg.authDir);
    cfg.serverUrl = fromEnv || fromFile || DEFAULT_SERVER_URL;
    cfg.serverSource = fromEnv ? "env" : fromFile ? "file" : "default";
  }
  try {
    new URL(cfg.serverUrl);
  } catch {
    throw new ArgsError(`not a URL: ${cfg.serverUrl}`, 2);
  }
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs < 1e3) cfg.timeoutMs = 12e4;
  readPat(cfg);
  return cfg;
}
function readPat(cfg) {
  const fromEnv = envOf(envName("BRIDGE_TOKEN"))?.trim();
  if (fromEnv) {
    cfg.pat = fromEnv;
    cfg.patSource = envName("BRIDGE_TOKEN");
    return;
  }
  const file = join5(cfg.authDir, "token");
  try {
    const text2 = readFileSync4(file, "utf8").trim();
    if (text2) {
      cfg.pat = text2;
      cfg.patSource = file;
    }
  } catch {
  }
}

// js/bridge/oauth/flow.ts
import { randomBytes as randomBytes2 } from "node:crypto";

// js/bridge/errors.ts
var NOT_SENT = "not-sent";
var UNKNOWN = "unknown";
var UpstreamError = class extends Error {
  static NOT_SENT = NOT_SENT;
  static UNKNOWN = UNKNOWN;
  kind;
  // `presented` carries the access token the refused request actually used —
  // knowledge only the caller has. The store may have moved on since, and a
  // token a sibling has already replaced must not be blamed for this refusal.
  presented;
  // `outcome` says whether the request this error ends could ALREADY have taken
  // effect upstream. NOT_SENT — it never reached the server, so a retry is free.
  // UNKNOWN — it went out and the answer was lost, so a blind retry may write a
  // second time. Nothing between those two is honest, and saying neither is what
  // made "retry the call" dangerous: under one sentence lived both outcomes, and
  // the caller could not tell them apart. Witnessed: an update reported as failed
  // had applied, and the retry advised by that sentence collided with its own
  // first write.
  outcome;
  // `retryable` marks a network failure worth another knock from the bridge
  // itself: a connection that failed outright. A timeout is not — it already
  // spent the whole deadline, and repeating it multiplies the wait.
  retryable;
  constructor(message, kind, presented = null, outcome = UNKNOWN, retryable = false) {
    super(message);
    this.kind = kind;
    this.presented = presented;
    this.outcome = outcome;
    this.retryable = retryable;
  }
};
var TokenError = class extends Error {
  oauthError;
  status;
  oauthMessage;
  constructor(message, oauthError, status, oauthMessage) {
    super(message);
    this.oauthError = oauthError;
    this.status = status;
    this.oauthMessage = oauthMessage;
  }
};
var DEFINITIVE_OAUTH_ERRORS = /* @__PURE__ */ new Set([
  "invalid_grant",
  "invalid_token",
  "invalid_client",
  "unauthorized_client"
]);
var TokenRefused = class extends Error {
};
var utcTime = (ms2) => new Date(ms2).toISOString().replace("T", " ").slice(0, 19) + " UTC";
var AuthPending = class extends Error {
  authorizeUrl;
  constructor(url, note3, device) {
    super(
      `authorization required — open in a browser: ${url}${note3 ? ` (${note3})` : ""}` + (typeof device === "string" ? ` — no sign-in by code: ${device}` : device ? ` — or sign in from another device: ${device.link} (code ${device.user_code}, valid until ${utcTime(device.expires_at)}; a call after that brings a new one)` : "") + ` — or give the bridge a personal access token instead (${envName("BRIDGE_TOKEN")}, or the file <auth-dir>/token)`
    );
    this.authorizeUrl = url;
  }
};
var HoldOffError = class extends Error {
  // retryNow marks the one flavor where an immediate retry is the honest move:
  // the FIRST early refusal of a needed refresh. The cooldown refusal and a
  // refusal that repeats both name waits that are real.
  retryNow;
  // When the hold ends, on the server-corrected clock — the refresh token's own
  // hour; null when nobody knows. A caller sits out a short one inside the call
  // and answers a long one with the login.
  until;
  constructor(message, retryNow = false, until = null) {
    super(message);
    this.retryNow = retryNow;
    this.until = until;
  }
};
var DeadGrantError = class extends Error {
  expired;
  constructor(message, expired = false) {
    super(message);
    this.expired = expired;
  }
};
var CLOSED = /* @__PURE__ */ new Set(["UND_ERR_SOCKET", "ECONNRESET", "EPIPE"]);
var closedUnder = (e) => {
  const err = e;
  return CLOSED.has(err?.code ?? "") || CLOSED.has(err?.cause?.code ?? "");
};
function errorCode(e) {
  const err = e;
  return err?.cause?.code ?? err?.code;
}
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}

// js/bridge/store.ts
import { createHash as createHash5 } from "node:crypto";
import {
  appendFileSync,
  mkdirSync as mkdirSync4,
  readFileSync as readFileSync5,
  renameSync as renameSync3,
  statSync,
  unlinkSync as unlinkSync3,
  writeFileSync as writeFileSync3
} from "node:fs";
import { join as join6 } from "node:path";
var b64url = (buf) => Buffer.from(buf).toString("base64url");
var sha256 = (s2) => createHash5("sha256").update(s2).digest();
var sleep = (ms2) => new Promise((r) => setTimeout(r, ms2));
function storePath() {
  const u = new URL(CFG.serverUrl);
  const h = b64url(sha256(u.origin + u.pathname)).slice(0, 10);
  return join6(CFG.authDir, `${u.hostname}_${h}.json`);
}
function loadStore() {
  try {
    return JSON.parse(readFileSync5(storePath(), "utf8"));
  } catch {
    return {};
  }
}
function saveStore(patch) {
  mkdirSync4(CFG.authDir, { recursive: true, mode: 448 });
  const next = {
    ...loadStore(),
    ...patch,
    server_url: CFG.serverUrl,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const tmp = `${storePath()}.tmp-${process.pid}`;
  try {
    writeFileSync3(tmp, JSON.stringify(next, null, 2), { mode: 384 });
    renameSync3(tmp, storePath());
  } catch (e) {
    try {
      unlinkSync3(tmp);
    } catch {
    }
    throw e;
  }
  return next;
}
function serverCachePath() {
  return storePath() + ".server-answers";
}
function loadServerCache() {
  try {
    return JSON.parse(readFileSync5(serverCachePath(), "utf8"));
  } catch {
    return {};
  }
}
function saveServerCache(patch) {
  try {
    mkdirSync4(CFG.authDir, { recursive: true, mode: 448 });
    const tmp = `${serverCachePath()}.tmp-${process.pid}`;
    writeFileSync3(tmp, JSON.stringify({ ...loadServerCache(), ...patch }), { mode: 384 });
    renameSync3(tmp, serverCachePath());
  } catch {
  }
}
function grantLogPath() {
  return join6(CFG.authDir, "grant.log");
}
function grantLog(msg) {
  appendJournal(grantLogPath(), msg);
}
function rotateJournal(path, max) {
  try {
    if (statSync(path).size > max) renameSync3(path, `${path}.1`);
  } catch {
  }
}
function appendJournal(path, msg) {
  try {
    mkdirSync4(CFG.authDir, { recursive: true, mode: 448 });
    rotateJournal(path, 128e3);
    appendFileSync(path, `${(/* @__PURE__ */ new Date()).toISOString()} pid=${process.pid} ${BUILD} ${msg}
`, {
      mode: 384
    });
  } catch {
  }
}
function standingsLogPath() {
  return join6(CFG.authDir, "standings.log");
}
function standingLog(msg) {
  appendJournal(standingsLogPath(), msg);
}
function grantStatePath() {
  return storePath() + ".grant-state";
}
function loadGrantState() {
  try {
    return JSON.parse(readFileSync5(grantStatePath(), "utf8"));
  } catch {
    return {};
  }
}
function saveGrantState(patch) {
  try {
    mkdirSync4(CFG.authDir, { recursive: true, mode: 448 });
    const next = { ...loadGrantState(), ...patch };
    const tmp = `${grantStatePath()}.tmp-${process.pid}`;
    writeFileSync3(tmp, JSON.stringify(next), { mode: 384 });
    renameSync3(tmp, grantStatePath());
  } catch {
  }
}
function clearGrantState() {
  try {
    unlinkSync3(grantStatePath());
  } catch {
  }
}

// js/bridge/oauth/authlock.ts
import {
  mkdirSync as mkdirSync5,
  readdirSync,
  readFileSync as readFileSync6,
  renameSync as renameSync4,
  unlinkSync as unlinkSync4,
  writeFileSync as writeFileSync4
} from "node:fs";
import { connect as connect3 } from "node:net";
import { basename, dirname as dirname2, join as join7 } from "node:path";

// js/bridge/clock.ts
var SKEW_NOISE_MS = 5e3;
var SKEW_MATERIAL_MS = 3e4;
var clockSkewMs = null;
function skewMs() {
  if (clockSkewMs === null) {
    const s2 = Number(loadStore().clock_skew_ms);
    clockSkewMs = Number.isFinite(s2) ? s2 : 0;
  }
  return clockSkewMs;
}
function now() {
  return Date.now() + skewMs();
}
function noteServerDate(res) {
  const d = Date.parse(res?.headers?.get("date") || "");
  if (!Number.isFinite(d)) return;
  const measured = d - Date.now();
  const skew = Math.abs(measured) < SKEW_NOISE_MS ? 0 : measured;
  const prev = skewMs();
  clockSkewMs = skew;
  if (Math.abs(skew - prev) >= SKEW_MATERIAL_MS) {
    try {
      saveStore({ clock_skew_ms: skew });
    } catch {
    }
    grantLog(
      skew === 0 ? "machine clock is back in step with the server" : `machine clock is ${Math.round(Math.abs(skew) / 1e3)}s ${skew > 0 ? "behind" : "ahead of"} the server — token hours are judged by the server's clock (fix NTP to stop paying a 401 per rotation)`
    );
  }
}

// js/bridge/oauth/devicecode.ts
var DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
var DeviceRefusal = class extends Error {
  error;
  status;
  constructor(message, error, status) {
    super(message);
    this.error = error;
    this.status = status;
  }
};
function deviceOffered(meta) {
  const endpoint = meta.as.device_authorization_endpoint;
  const grants = meta.as.grant_types_supported;
  return typeof endpoint === "string" && !!endpoint && (!Array.isArray(grants) || grants.includes(DEVICE_GRANT));
}
async function post(url, type, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": type === "json" ? "application/json" : "application/x-www-form-urlencoded"
    },
    body: type === "json" ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(15e3)
  });
  noteServerDate(res);
  const answer2 = await res.json().catch(() => null) ?? {};
  if (!res.ok) {
    const error = typeof answer2.error === "string" ? answer2.error : void 0;
    const said2 = answer2.error_description ?? answer2.message ?? "";
    throw new DeviceRefusal(
      `POST ${url} -> ${res.status} ${error ?? ""} ${said2}`.trim(),
      error,
      res.status
    );
  }
  return answer2;
}
async function issueDeviceCode(meta, clientId) {
  const form = { client_id: clientId };
  if (meta.scope) form.scope = meta.scope;
  const a = await post(String(meta.as.device_authorization_endpoint), "form", form);
  const complete = a.verification_uri_complete ?? a.verification_uri;
  if (typeof a.device_code !== "string" || typeof complete !== "string") {
    throw new DeviceRefusal("the device code answer carries no code or no page", void 0);
  }
  const code = {
    client_id: clientId,
    device_code: a.device_code,
    user_code: String(a.user_code ?? ""),
    link: complete,
    expires_at: Date.now() + (Number(a.expires_in) || 300) * 1e3,
    // RFC 8628 §3.2: five seconds when the server names no interval.
    interval_ms: (Number.isFinite(Number(a.interval)) ? Number(a.interval) : 5) * 1e3
  };
  log(
    `sign in from another device: ${code.link} (code ${code.user_code}, valid until ${utcTime(code.expires_at)})`
  );
  return code;
}

// js/bridge/oauth/authlock.ts
function authLockPath() {
  return storePath() + ".auth-pending";
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function portListening(port, timeoutMs = 700) {
  return new Promise((resolve11) => {
    if (!Number.isInteger(port)) return resolve11(false);
    const sock = connect3({ host: "127.0.0.1", port });
    const done = (v) => {
      sock.destroy();
      resolve11(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}
function readAuthLock() {
  try {
    return JSON.parse(readFileSync6(authLockPath(), "utf8"));
  } catch {
    return null;
  }
}
function writeAuthLock(fields) {
  mkdirSync5(CFG.authDir, { recursive: true, mode: 448 });
  const tmp = `${authLockPath()}.tmp-${process.pid}`;
  const body = JSON.stringify({
    ...fields,
    pid: fields.pid ?? process.pid,
    started_at: fields.started_at ?? Date.now()
  });
  try {
    writeFileSync4(tmp, body, { mode: 384 });
    renameSync4(tmp, authLockPath());
  } catch {
    try {
      unlinkSync4(tmp);
    } catch {
    }
    writeFileSync4(authLockPath(), body, { mode: 384 });
  }
}
function releaseAuthLock(owns) {
  try {
    const l = readAuthLock();
    if (owns && (!l || !owns(l))) return;
    unlinkSync4(authLockPath());
  } catch {
  }
}
var tabMarkPath = (state2) => `${authLockPath()}.tab-${state2}`;
function claimTab(state2) {
  try {
    mkdirSync5(CFG.authDir, { recursive: true, mode: 448 });
    writeFileSync4(tabMarkPath(state2), "", { flag: "wx", mode: 384 });
    return true;
  } catch {
    return false;
  }
}
function sweepTabMarks() {
  const prefix = `${basename(authLockPath())}.tab-`;
  try {
    for (const f of readdirSync(dirname2(authLockPath()))) {
      if (f.startsWith(prefix)) unlinkSync4(join7(dirname2(authLockPath()), f));
    }
  } catch {
  }
}
function installAuthLockExitHook() {
  process.on("exit", () => {
    try {
      const l = JSON.parse(readFileSync6(authLockPath(), "utf8"));
      if (l.pid === process.pid && !l.authorize_url) unlinkSync4(authLockPath());
    } catch {
    }
  });
}

// js/bridge/oauth/callback.ts
import { createServer as createServer2 } from "node:http";
var PAGE_HOLD_MS = 2e4;
function bindCallback(port) {
  return new Promise((resolve11, reject) => {
    let handOff = null;
    let received = null;
    let browser = null;
    let mint = null;
    let loginKey = "";
    const deliver2 = (v) => {
      if (handOff) handOff(v);
      else received = v;
    };
    const esc = (s2) => String(s2).replace(
      /[<>&"]/g,
      (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]
    );
    const tellBrowser = (line) => {
      if (!browser) return;
      const res = browser;
      browser = null;
      try {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<h3>${line}</h3>`);
      } catch {
      }
    };
    const server = createServer2((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (u.pathname === "/login" && mint && loginKey && u.searchParams.get("k") === loginKey) {
        mint().then(
          (to) => {
            res.writeHead(302, { location: to, "cache-control": "no-store" });
            res.end();
          },
          (e) => {
            res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
            res.end(words(CALLBACK).loginUnreachable(esc(errorMessage(e))));
          }
        );
        return;
      }
      if (u.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const err = u.searchParams.get("error");
      if (browser) tellBrowser(words(CALLBACK).anotherTab());
      browser = res;
      if (err) tellBrowser(words(CALLBACK).refused(esc(err)));
      else setTimeout(() => tellBrowser(words(CALLBACK).stillRunning()), PAGE_HOLD_MS).unref();
      deliver2({ code: u.searchParams.get("code"), state: u.searchParams.get("state"), err });
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      server.on("error", (e) => log(`callback server: ${e.message}`));
      resolve11({
        port,
        report: (failure) => tellBrowser(
          failure ? words(CALLBACK).failed(esc(failure)) : words(CALLBACK).authenticated()
        ),
        close: () => {
          tellBrowser(words(CALLBACK).abandoned());
          server.close();
        },
        serveLogin: (key2, fn) => {
          loginKey = key2;
          mint = fn;
        },
        // No deadline by default: the login lives as long as the bridge holding
        // it, so a human who comes back to the tab late still lands it (graph
        // @nks/nks-dev, node #4721). A bridge left by its harness bounds the wait itself.
        waitForCode: (expectedState, timeoutMs = 0) => new Promise((res, rej) => {
          const timer = timeoutMs > 0 ? setTimeout(
            () => rej(new Error("timed out waiting for the browser authorization")),
            timeoutMs
          ) : null;
          const settle2 = (v) => {
            if (v.state !== expectedState) {
              tellBrowser(words(CALLBACK).loginOver());
              return false;
            }
            if (timer) clearTimeout(timer);
            handOff = null;
            if (v.err) rej(new Error(`authorization refused: ${v.err}`));
            else if (!v.code) rej(new Error("callback missing code"));
            else res(v.code);
            return true;
          };
          if (received && settle2(received)) return;
          received = null;
          handOff = settle2;
        })
      });
    });
  });
}

// js/bridge/oauth/deviceclient.ts
var DEVICE_CLIENT_ID = BRIDGE_NAME;
var clientRefused = (e) => e instanceof DeviceRefusal && /^(invalid_client|unauthorized_client)$/.test(e.error ?? "");
var bareRefusal = (e) => e instanceof DeviceRefusal && e.error === void 0 && (e.status === 400 || e.status === 401);
var DeviceUnset = class extends DeviceRefusal {
};
async function codeThrough(meta, redirectUri, clientId) {
  const named = CFG.deviceClientId || DEVICE_CLIENT_ID;
  const id = clientId ?? named;
  try {
    return await issueDeviceCode(meta, id);
  } catch (e) {
    if (bareRefusal(e)) {
      throw new DeviceUnset(words(DEVICE_CLIENT).bareRefusal(id, e.status), void 0, e.status);
    }
    if (!clientRefused(e)) throw e;
    const word3 = e.error;
    if (id === CFG.deviceClientId) {
      throw new DeviceUnset(words(DEVICE_CLIENT).namedRefused(id, String(word3)), word3);
    }
    if (id !== named) return await codeThrough(meta, redirectUri, void 0);
    if (CFG.deviceRegister) {
      log(`device client ${id} refused (${errorMessage(e)}) — registering one`);
      return await issueDeviceCode(meta, await registerDeviceClient(meta, redirectUri));
    }
    throw new DeviceUnset(words(DEVICE_CLIENT).unset(id), word3);
  }
}
async function registerDeviceClient(meta, redirectUri) {
  if (CFG.staticClientId) return CFG.staticClientId;
  if (!meta.as.registration_endpoint) {
    throw new DeviceRefusal("server offers no dynamic client registration", void 0);
  }
  const reg = await post(meta.as.registration_endpoint, "json", {
    client_name: CFG.clientName,
    redirect_uris: [redirectUri],
    grant_types: [DEVICE_GRANT, "refresh_token"],
    token_endpoint_auth_method: "none"
  });
  if (typeof reg.client_id !== "string") {
    throw new DeviceRefusal("registration answered without a client_id", void 0);
  }
  log(`registered OAuth client ${reg.client_id} for sign-in from another device`);
  return reg.client_id;
}

// js/bridge/oauth/discovery.ts
import { spawn } from "node:child_process";
import { join as join8 } from "node:path";
async function fetchJson(url, opts = {}, timeoutMs = 15e3) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  noteServerDate(res);
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}`);
  return res.json();
}
async function discover(wwwAuthenticate) {
  const meta = await discoverMeta(wwwAuthenticate);
  saveStore({ meta });
  return meta;
}
async function discoverMeta(wwwAuthenticate) {
  const u = new URL(CFG.serverUrl);
  const candidates = [];
  const m = /resource_metadata="?([^",\s]+)"?/.exec(wwwAuthenticate || "");
  if (m) candidates.push(m[1]);
  const path = u.pathname === "/" ? "" : u.pathname;
  candidates.push(`${u.origin}/.well-known/oauth-protected-resource${path}`);
  candidates.push(`${u.origin}/.well-known/oauth-protected-resource`);
  let prm = null;
  for (const c of candidates) {
    try {
      prm = await fetchJson(c);
      debug(`protected-resource metadata: ${c}`);
      break;
    } catch (e) {
      debug(`no PRM at ${c}: ${errorMessage(e)}`);
    }
  }
  const asBase = prm?.authorization_servers?.[0] || u.origin;
  const asUrl = new URL(asBase);
  const asPath = asUrl.pathname === "/" ? "" : asUrl.pathname;
  const asCandidates = [
    `${asUrl.origin}/.well-known/oauth-authorization-server${asPath}`,
    `${asUrl.origin}${asPath}/.well-known/oauth-authorization-server`,
    `${asUrl.origin}/.well-known/openid-configuration${asPath}`,
    `${asUrl.origin}${asPath}/.well-known/openid-configuration`
  ];
  let as = null;
  for (const c of asCandidates) {
    try {
      as = await fetchJson(c);
      debug(`AS metadata: ${c}`);
      break;
    } catch (e) {
      debug(`no AS metadata at ${c}: ${errorMessage(e)}`);
    }
  }
  if (!as?.authorization_endpoint || !as?.token_endpoint) {
    throw new Error(
      `OAuth discovery failed for ${CFG.serverUrl}: no authorization server metadata reachable`
    );
  }
  const scope = CFG.scope || (prm?.scopes_supported?.length ? prm.scopes_supported.join(" ") : null);
  return { as, resource: CFG.resource || prm?.resource || CFG.serverUrl, scope };
}
var resourceOf = (meta) => CFG.resource || meta.resource;
var CALLBACK_PORT_RUNGS = 3;
function callbackPort(rung = 0) {
  const d = sha256(new URL(CFG.serverUrl).origin);
  return 42e3 + (d[0] * 256 + d[1] + rung * 613) % 2e3;
}
var REGISTRATION_REUSE_MS = 45 * 6e4;
function registrationReusable(client, redirectUri) {
  if (!client?.client_id || client.redirect_uri !== redirectUri) return false;
  return !!client.registered_at && now() - client.registered_at < REGISTRATION_REUSE_MS;
}
async function ensureClient(meta, redirectUri) {
  if (CFG.staticClientId) return { client_id: CFG.staticClientId };
  const stored = loadStore().client;
  if (registrationReusable(stored, redirectUri)) return stored;
  if (stored?.client_id && stored.redirect_uri === redirectUri) {
    log(
      stored.registered_at ? "the dynamic client registration is older than the server's cleanup horizon — registering anew for this login" : "the dynamic client registration carries no timestamp (an earlier build wrote it) — registering anew for this login"
    );
  }
  if (!meta.as.registration_endpoint) {
    throw new Error(
      `server offers no dynamic client registration; pass ${envName("BRIDGE_CLIENT_ID")}`
    );
  }
  const reg = await fetchJson(meta.as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: CFG.clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  const client = {
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    registered_at: now()
  };
  saveStore({ client });
  log(`registered OAuth client ${reg.client_id}`);
  return client;
}
function openBrowser(url) {
  log(`authorize in the browser:
  ${url}`);
  if (CFG.noBrowser) return;
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? windowsOpener(url) : ["xdg-open", [url]];
  const manually = (e) => log(`could not open a browser (${errorMessage(e)}) — open the URL above manually`);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", manually);
    child.unref();
  } catch (e) {
    manually(e);
  }
}
function windowsOpener(url) {
  const powershell = join8(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const command = `Start-Process -FilePath '${url.replace(/'/g, "''")}'`;
  return [
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64")
    ]
  ];
}

// js/bridge/oauth/pacing.ts
var pauses = (v, fallback2) => (v || fallback2).split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
var DEAD_RECHECK_MS = pauses(process.env[envName("BRIDGE_DEAD_RECHECK_MS")], "1000,2000");
var IN_CALL_WAIT_MS = Number(process.env[envName("BRIDGE_IN_CALL_WAIT_MS")]) || 1e4;
var ORPHAN_FLOW_MS = Number(process.env[envName("BRIDGE_ORPHAN_FLOW_MS")]) || 5 * 6e4;
var pauseUntil = (signal, ms2) => new Promise((r) => {
  const done = () => {
    clearTimeout(t);
    signal.removeEventListener("abort", done);
    r();
  };
  const t = setTimeout(done, ms2);
  signal.addEventListener("abort", done, { once: true });
});

// js/bridge/tokens.ts
function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString());
  } catch {
    return null;
  }
}
var CLOCK_SKEW_MS = 6e4;
function tokenSchedule(body, refresh) {
  const a = jwtClaims(body.access_token);
  const r = jwtClaims(refresh);
  const accessExp = Number.isFinite(a?.exp) ? a.exp * 1e3 : body.expires_in ? now() + body.expires_in * 1e3 : null;
  const skew = accessExp ? Math.min(CLOCK_SKEW_MS, Math.max(0, (accessExp - now()) / 2)) : 0;
  return {
    expires_at: accessExp ? accessExp - skew : null,
    refresh_not_before: Number.isFinite(r?.nbf) ? r.nbf * 1e3 : null,
    refresh_expires_at: Number.isFinite(r?.exp) ? r.exp * 1e3 : null
  };
}
function refreshHours(t) {
  const c = jwtClaims(t?.refresh_token);
  return {
    nbf: Number.isFinite(t?.refresh_not_before) ? t.refresh_not_before : Number.isFinite(c?.nbf) ? c.nbf * 1e3 : null,
    exp: Number.isFinite(t?.refresh_expires_at) ? t.refresh_expires_at : Number.isFinite(c?.exp) ? c.exp * 1e3 : null
  };
}
function tokenUsable(t, { rejected = null, marginMs = 0 } = {}) {
  if (!t?.access_token) return false;
  if (rejected && t.access_token === rejected) return false;
  if (t.expires_at && t.expires_at - now() <= marginMs) return false;
  return true;
}
function usableTokens(opts) {
  const t = loadStore().tokens;
  return tokenUsable(t, opts) ? t : null;
}

// js/bridge/oauth/tokenrequest.ts
async function tokenRequestOnce(meta, params) {
  const res = await fetch(meta.as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(3e4)
  });
  noteServerDate(res);
  const body = await res.json().catch(() => null) ?? {};
  if (!res.ok) {
    throw new TokenError(
      `token endpoint ${res.status}: ${body.error || ""} ${body.error_description || body.message || ""}`.trim(),
      body.error,
      res.status,
      body.message
    );
  }
  const before = loadStore().tokens;
  const refresh = body.refresh_token ?? before?.refresh_token;
  const byCode = params.grant_type === DEVICE_GRANT || params.grant_type === "refresh_token" && !!before?.by_code && before.client_id === params.client_id;
  const tokens = {
    access_token: body.access_token,
    refresh_token: refresh,
    ...tokenSchedule(body, refresh),
    ...params.client_id ? { client_id: params.client_id } : {},
    ...byCode ? { by_code: true } : {}
  };
  saveStore({ tokens });
  clearGrantState();
  grantLog(
    `tokens stored (${params.grant_type}); access good for ${tokens.expires_at ? Math.round((tokens.expires_at - now()) / 1e3) + "s" : "an unstated time"}${tokens.refresh_not_before ? `, refresh usable in ${Math.round((tokens.refresh_not_before - now()) / 1e3)}s` : ""}`
  );
  return tokens;
}
var tokenRequestsInFlight = /* @__PURE__ */ new Set();
async function tokenRequest(meta, params) {
  const p = tokenRequestOnce(meta, params);
  tokenRequestsInFlight.add(p);
  try {
    return await p;
  } finally {
    tokenRequestsInFlight.delete(p);
  }
}

// js/bridge/oauth/device.ts
var SLOW_DOWN_MS = Number(process.env[envName("BRIDGE_DEVICE_SLOW_DOWN_MS")]) || 5e3;
var REISSUE_PAUSE_MS = Number(process.env[envName("BRIDGE_DEVICE_REISSUE_MS")]) || 3e4;
var never = new Promise(() => {
});
function deviceSide(meta, redirectUri, resume, onCode, called) {
  const halt = new AbortController();
  let tellFirst = () => {
  };
  const first2 = new Promise((r) => tellFirst = r);
  let unset2;
  const pause = (ms2) => pauseUntil(halt.signal, ms2);
  const fresh2 = async (clientId) => {
    try {
      const code = await codeThrough(meta, redirectUri, clientId);
      return halt.signal.aborted ? null : code;
    } catch (e) {
      if (e instanceof DeviceUnset) unset2 = e.message;
      log(`sign-in from another device not offered: ${errorMessage(e)}`);
      return null;
    }
  };
  const giveUp = () => {
    onCode(null, unset2);
    return never;
  };
  const newer = (code) => {
    const r = called();
    return r && r.device_code !== code.device_code && r.expires_at > code.expires_at ? r : null;
  };
  const run = async () => {
    if (!deviceOffered(meta)) {
      tellFirst(null);
      return never;
    }
    let code = resume && resume.expires_at > Date.now() ? resume : await fresh2(resume?.client_id);
    tellFirst(code ?? unset2 ?? null);
    if (unset2) return giveUp();
    onCode(code);
    let clientId = code?.client_id ?? resume?.client_id;
    for (; ; ) {
      while (!code) {
        await pause(REISSUE_PAUSE_MS);
        if (halt.signal.aborted) return never;
        code = await fresh2(clientId);
        if (unset2) return giveUp();
        if (code) onCode(code);
      }
      clientId = code.client_id;
      await pause(code.interval_ms);
      if (halt.signal.aborted) return never;
      const taken2 = newer(code);
      if (taken2) {
        debug(`device poll: taking the code ${taken2.user_code} a caller issued`);
        code = { ...taken2, interval_ms: Math.max(taken2.interval_ms, code.interval_ms) };
        onCode(code);
        continue;
      }
      let renew = Date.now() >= code.expires_at;
      if (!renew) {
        try {
          await tokenRequest(meta, {
            grant_type: DEVICE_GRANT,
            device_code: code.device_code,
            client_id: code.client_id,
            resource: resourceOf(meta)
          });
          return;
        } catch (e) {
          const word3 = e instanceof TokenError ? e.oauthError : void 0;
          if (word3 === "access_denied") {
            throw new Error("authorization refused on the other device", { cause: e });
          }
          if (word3 === "slow_down") {
            code = { ...code, interval_ms: code.interval_ms + SLOW_DOWN_MS };
            onCode(code);
          } else if (word3 && word3 !== "authorization_pending") {
            renew = true;
          } else if (!word3) debug(`device poll: ${errorMessage(e)} — asking again`);
        }
      }
      if (renew) {
        code = newer(code) ?? await fresh2(clientId);
        if (halt.signal.aborted) return never;
        if (unset2) return giveUp();
        onCode(code);
      }
    }
  };
  const landed = run();
  landed.catch(() => {
  });
  return {
    first: first2,
    landed,
    stop: () => {
      halt.abort();
      tellFirst(null);
    }
  };
}

// js/bridge/oauth/devicehandout.ts
import { readFileSync as readFileSync7, renameSync as renameSync5, writeFileSync as writeFileSync5 } from "node:fs";
var freshPath = () => `${authLockPath()}.device`;
function callerCode(state2) {
  try {
    const f = JSON.parse(readFileSync7(freshPath(), "utf8"));
    return state2 && f.state === state2 ? f.code : void 0;
  } catch {
    return void 0;
  }
}
var later = (a, b) => !a || b && b.expires_at > a.expires_at ? b : a;
async function joinedPending(meta, l, note3) {
  const stale = later(l.device, callerCode(l.state));
  const device = stale && stale.expires_at <= Date.now() ? await renewed(meta, l, stale) : stale;
  return new AuthPending(l.authorize_url, note3, device ?? l.device_unset);
}
async function renewed(meta, l, stale) {
  const alive6 = (c) => c && c.expires_at > Date.now() ? c : void 0;
  let code;
  try {
    code = await issueDeviceCode(meta, stale.client_id);
  } catch (e) {
    log(`no fresh code for sign-in from another device: ${errorMessage(e)}`);
    return alive6(stale);
  }
  const other = callerCode(l.state);
  if (other && other.device_code !== stale.device_code) return alive6(other);
  const fresh2 = { ...code, interval_ms: Math.max(code.interval_ms, stale.interval_ms) };
  const tmp = `${freshPath()}.tmp-${process.pid}`;
  try {
    writeFileSync5(tmp, JSON.stringify({ state: l.state, code: fresh2 }), { mode: 384 });
    renameSync5(tmp, freshPath());
  } catch (e) {
    log(`fresh code for sign-in from another device not kept: ${errorMessage(e)}`);
    return alive6(stale);
  }
  return fresh2;
}

// js/bridge/oauth/flow.ts
var CLAIM_WAIT_MS = Number(process.env[envName("BRIDGE_CLAIM_WAIT_MS")]) || 15e3;
var CLAIM_GLANCE_MS = 1e3;
var LANDED_POLL_MS = Number(process.env[envName("BRIDGE_LANDED_POLL_MS")]) || 2e3;
var RELEASE_GAP_MS = Number(process.env[envName("BRIDGE_RELEASE_GAP_MS")]) || 0;
var DEVICE_FIRST_WAIT_MS = 1e4;
var flows = /* @__PURE__ */ new Set();
function pendingFlow() {
  return flows.size ? Promise.allSettled([...flows]).then(() => {
  }) : null;
}
var clicked = /* @__PURE__ */ new Set();
function clickPending() {
  return clicked.size ? Promise.allSettled([...clicked]).then(() => {
  }) : null;
}
var loginLink = (port, key2) => `http://127.0.0.1:${port}/login?k=${key2}`;
var linkPrefix = (port) => `http://127.0.0.1:${port}/login?k=`;
var redirectFor = (port) => `http://127.0.0.1:${port}/callback`;
var grantPrint = (t) => {
  const both = [t?.refresh_token, t?.access_token].filter(Boolean).join("|");
  return both ? b64url(sha256(both)).slice(0, 16) : "";
};
var grantBack = (judged) => {
  const now2 = loadStore().tokens;
  return now2?.access_token && grantPrint(now2) !== judged ? now2 : null;
};
function published(l) {
  if (!l?.authorize_url || !l.state || !l.verifier) return false;
  if (!l.authorize_url.startsWith(linkPrefix(l.callback_port))) return false;
  return l.grant === void 0 || grantPrint(loadStore().tokens) === l.grant;
}
function older(l) {
  return !!l?.authorize_url && !l.state;
}
var firstCode = (first2) => new Promise((resolve11) => {
  const t = setTimeout(() => resolve11(void 0), DEVICE_FIRST_WAIT_MS);
  t.unref?.();
  void first2.then((c) => {
    clearTimeout(t);
    resolve11(c ?? void 0);
  });
});
function loginPublished() {
  return published(readAuthLock());
}
function openTabOnce(l) {
  if (!CFG.noBrowser && claimTab(l.state)) openBrowser(l.authorize_url);
}
function showTab(l) {
  const current2 = readAuthLock();
  if (!published(current2)) return l;
  openTabOnce(current2);
  return current2;
}
function handOut(l, wantTab) {
  return wantTab && published(l) ? showTab(l) : l;
}
async function mootFreed(port) {
  const l = readAuthLock();
  if (!l || l.callback_port !== port || !l.state || published(l) || !pidAlive(l.pid)) return;
  const deadline = Date.now() + LANDED_POLL_MS * 2 + 1e3;
  while (Date.now() < deadline && await portListening(port)) await sleep(100);
}
async function bindOrNull(port) {
  try {
    return await bindCallback(port);
  } catch (e) {
    if (errorCode(e) !== "EADDRINUSE") throw e;
    return null;
  }
}
async function linkOn(port) {
  const glance = Date.now() + CLAIM_GLANCE_MS;
  const deadline = Date.now() + CLAIM_WAIT_MS;
  for (; ; ) {
    const l = readAuthLock();
    const ours = !!l && l.callback_port === port && pidAlive(l.pid);
    if (ours && (published(l) || older(l))) return l;
    const claimed = ours && !l?.authorize_url;
    if (!claimed && Date.now() > glance || Date.now() > deadline) return null;
    await sleep(100);
  }
}
async function interactiveFlow(meta, judged, note3, wantTab = true) {
  const over = grantPrint(judged);
  const back = grantBack(over);
  if (back) return back;
  const standing = readAuthLock();
  if ((published(standing) || older(standing)) && pidAlive(standing.pid) && await portListening(standing.callback_port)) {
    debug(`joining the login held by pid ${standing.pid}`);
    throw await joinedPending(meta, handOut(standing, wantTab), note3);
  }
  let callback = null;
  if (published(standing)) {
    const cb = await bindOrNull(standing.callback_port);
    const still = cb ? readAuthLock() : null;
    if (cb && published(still) && still.state === standing.state) {
      try {
        writeAuthLock({ ...still, pid: process.pid });
      } catch (e) {
        cb.close();
        throw e;
      }
      log(
        `the bridge that published this login (pid ${standing.pid}) is gone — listening on its link, so the tab the human has still lands:
  ${still.authorize_url}`
      );
      grantLog(
        `authorization flow of pid ${standing.pid} (gone) taken over on the same link — waiting for the human`
      );
      const first2 = runFlow(meta, cb, still, wantTab);
      throw new AuthPending(still.authorize_url, note3, await firstCode(first2));
    }
    if (cb && published(still)) {
      cb.close();
      return interactiveFlow(meta, judged, note3, wantTab);
    }
    callback = cb;
  }
  if (published(standing) && !callback) {
    const taken2 = readAuthLock();
    if (published(taken2) && taken2.state === standing.state && pidAlive(taken2.pid) && await portListening(taken2.callback_port)) {
      throw await joinedPending(meta, handOut(taken2, wantTab), note3);
    }
    debug(
      `the published login's port ${standing.callback_port} is held by a foreign process — its link can land nowhere; publishing a new login`
    );
  } else if (standing && !standing.authorize_url && pidAlive(standing.pid) && await portListening(standing.callback_port)) {
    const found = await linkOn(standing.callback_port);
    if (found) throw await joinedPending(meta, handOut(found, wantTab), note3);
  }
  for (let rung = 0; rung < CALLBACK_PORT_RUNGS && !callback; rung++) {
    callback = await bindOrNull(callbackPort(rung));
    if (callback) break;
    const found = await linkOn(callbackPort(rung));
    if (found) throw await joinedPending(meta, handOut(found, wantTab), note3);
    await mootFreed(callbackPort(rung));
    callback = await bindOrNull(callbackPort(rung));
    if (callback) break;
    debug(
      `callback port ${callbackPort(rung)} is held by a foreign process — trying the next rung`
    );
  }
  if (!callback) {
    const rungs = Array.from({ length: CALLBACK_PORT_RUNGS }, (_, k) => callbackPort(k)).join(", ");
    throw new Error(
      `all candidate callback ports (${rungs}) are held by other processes — free one, then retry`
    );
  }
  const landed = grantBack(over);
  if (landed) {
    callback.close();
    return landed;
  }
  let started = false;
  try {
    const login = {
      pid: process.pid,
      started_at: Date.now(),
      callback_port: callback.port,
      authorize_url: loginLink(callback.port, b64url(randomBytes2(18))),
      state: b64url(randomBytes2(24)),
      verifier: b64url(randomBytes2(48)),
      grant: over
    };
    sweepTabMarks();
    writeAuthLock(login);
    grantLog("authorization flow published — waiting for the human");
    const first2 = runFlow(meta, callback, login, wantTab);
    started = true;
    throw new AuthPending(login.authorize_url, note3, await firstCode(first2));
  } catch (e) {
    if (!started) {
      callback.close();
      releaseAuthLock((l) => l.pid === process.pid);
    }
    throw e;
  }
}
function runFlow(meta, cb, login, openTab) {
  const ours = (l) => l.pid === process.pid && l.state === login.state;
  const redirectUri = redirectFor(login.callback_port);
  const key2 = login.authorize_url.slice(linkPrefix(login.callback_port).length);
  cb.serveLogin(key2, async () => {
    if (flow) clicked.add(flow);
    const client = await ensureClient(meta, redirectUri);
    const current2 = readAuthLock();
    if (current2 && ours(current2)) writeAuthLock({ ...current2, client_id: client.client_id });
    const u = new URL(meta.as.authorization_endpoint);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", client.client_id);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", login.state);
    u.searchParams.set("code_challenge", b64url(sha256(login.verifier)));
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("resource", resourceOf(meta));
    if (meta.scope) u.searchParams.set("scope", meta.scope);
    return u.toString();
  });
  let watch2;
  const cameBack = new Promise((_, reject) => {
    watch2 = setInterval(() => {
      if (login.grant !== void 0 && grantPrint(loadStore().tokens) !== login.grant) {
        reject(new Error("the grant came back by itself — this login is no longer needed"));
      }
    }, LANDED_POLL_MS);
    watch2.unref?.();
  });
  cameBack.catch(() => {
  });
  const device = deviceSide(
    meta,
    redirectUri,
    login.device,
    (code, unset2) => {
      const current2 = readAuthLock();
      if (current2 && ours(current2)) {
        writeAuthLock({ ...current2, device: code ?? void 0, device_unset: unset2 });
      }
    },
    () => callerCode(login.state)
  );
  let flow = null;
  flow = (async () => {
    try {
      const codePromise = cb.waitForCode(login.state);
      if (openTab) openTabOnce(login);
      const code = await Promise.race([codePromise, cameBack, device.landed.then(() => null)]);
      if (code === null) {
        releaseAuthLock(ours);
        log("signed in from another device — tokens saved for every local agent");
        grantLog("authorization complete (another device)");
        return;
      }
      device.stop();
      const record2 = readAuthLock();
      const clientId = (record2?.state === login.state ? record2.client_id : void 0) || CFG.staticClientId || loadStore().client?.client_id || "";
      log("authorization code received — exchanging for tokens");
      await tokenRequest(meta, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: login.verifier,
        resource: resourceOf(meta)
      });
      releaseAuthLock(ours);
      log("authorization complete — tokens saved for every local agent");
      grantLog("authorization complete");
      cb.report(null);
    } catch (e) {
      const message = errorMessage(e);
      cb.report(message);
      log(`authorization flow failed: ${message}`);
      grantLog(
        `authorization not completed (${message}) — the next call that needs the graph offers a new login`
      );
    } finally {
      clearInterval(watch2);
      device.stop();
      releaseAuthLock(ours);
      if (RELEASE_GAP_MS) await sleep(RELEASE_GAP_MS);
      cb.close();
      if (flow) {
        flows.delete(flow);
        clicked.delete(flow);
      }
    }
  })();
  flows.add(flow);
  return device.first;
}

// js/bridge/daemon-idle.ts
var secs = (ms2) => Math.round(ms2 / 1e3);
function idleWatch(idleMs, busy, leave) {
  let timer = null;
  let round = 0;
  const hold = () => {
    round++;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    hold();
    if (busy()) return;
    const mine = round;
    timer = setTimeout(() => {
      timer = null;
      if (busy()) return;
      const flow = pendingFlow();
      if (!flow) {
        log(`no session for ${secs(idleMs)}s — the daemon leaves`);
        return leave();
      }
      log(
        `idle, but an authorization flow is pending — staying for the human's click, at most ${secs(ORPHAN_FLOW_MS)}s`
      );
      timer = setTimeout(() => {
        timer = null;
        if (round !== mine || busy()) return;
        log(
          `no session and the login unclicked for ${secs(ORPHAN_FLOW_MS)}s — the daemon leaves; the next bridge takes the login over on its link`
        );
        leave();
      }, ORPHAN_FLOW_MS);
      void flow.finally(() => {
        if (round === mine) arm();
      });
    }, idleMs);
  };
  return { arm, hold };
}

// js/bridge/oauth/refreshlock.ts
import { linkSync as linkSync2, mkdirSync as mkdirSync6, readFileSync as readFileSync8, unlinkSync as unlinkSync5, writeFileSync as writeFileSync6 } from "node:fs";
var REFRESH_LOCK_STALE_MS = 45e3;
function refreshLockPath() {
  return storePath() + ".refreshing";
}
function acquireRefreshLock() {
  const claim = () => {
    const tmp = `${refreshLockPath()}.${process.pid}`;
    writeFileSync6(tmp, JSON.stringify({ pid: process.pid, started_at: Date.now() }), {
      mode: 384
    });
    try {
      linkSync2(tmp, refreshLockPath());
      return true;
    } finally {
      try {
        unlinkSync5(tmp);
      } catch {
      }
    }
  };
  const notHeld = (e) => {
    if (errorCode(e) !== "EEXIST") {
      throw new Error(`cannot take the refresh lock: ${errorMessage(e)}`, { cause: e });
    }
  };
  try {
    mkdirSync6(CFG.authDir, { recursive: true, mode: 448 });
    return claim();
  } catch (e) {
    notHeld(e);
  }
  let held2 = null;
  try {
    held2 = JSON.parse(readFileSync8(refreshLockPath(), "utf8"));
  } catch {
  }
  if (held2 && pidAlive(held2.pid) && Date.now() - held2.started_at < REFRESH_LOCK_STALE_MS) {
    return false;
  }
  debug("breaking a refresh lock nobody is holding");
  try {
    unlinkSync5(refreshLockPath());
  } catch {
  }
  try {
    return claim();
  } catch (e) {
    notHeld(e);
    return false;
  }
}
function releaseRefreshLock() {
  try {
    const l = JSON.parse(readFileSync8(refreshLockPath(), "utf8"));
    if (l.pid === process.pid) unlinkSync5(refreshLockPath());
  } catch {
  }
}
function installRefreshLockExitHook() {
  process.on("exit", releaseRefreshLock);
}

// js/bridge/oauth/refresh.ts
var REFRESH_WAIT_MS = 6e4;
var REFRESH_POLL_MS = 120;
var EARLY_REFUSAL_COOLDOWN_MS = 15e3;
var REFUSED_KNOCK_MS = 5 * 6e4;
async function refreshOnce(meta, cur, proactive) {
  const hours = refreshHours(cur);
  const inTheWindow = hours.nbf && now() < hours.nbf;
  const cooling = inTheWindow && loadGrantState().early_refused_until;
  if (cooling && now() < cooling) {
    const left2 = Math.round((cooling - now()) / 1e3);
    throw new HoldOffError(
      `the token endpoint refused this grant as too early moments ago — not knocking again for ${left2}s; grant kept, will retry`,
      false,
      hours.nbf
    );
  }
  const clientId = CFG.staticClientId || cur.client_id || loadStore().client?.client_id || "";
  debug("refreshing access token");
  try {
    return await tokenRequest(meta, {
      grant_type: "refresh_token",
      refresh_token: cur.refresh_token ?? "",
      client_id: clientId,
      resource: resourceOf(meta)
    });
  } catch (e) {
    const message = errorMessage(e);
    const deadRefresh = e instanceof TokenError && e.status === 404 && e.oauthError === "NotFound" && e.oauthMessage === "Refresh Token does not exist";
    const gone = e instanceof TokenError ? !deadRefresh && [404, 405, 410].includes(e.status) : ["ENOTFOUND", "ECONNREFUSED"].includes(errorCode(e) ?? "");
    if (gone && e instanceof TokenError && e.status === 404 && !await tokenEndpointMoved(meta)) {
      log(
        "the token endpoint answers NotFound while discovery still names it — the server no longer knows this client; dropping the registration"
      );
      grantLog(
        `refresh refused by an endpoint discovery still names (${message}) — registration dropped`
      );
      dropRegistration(clientId);
      throw new DeadGrantError(message);
    }
    if (gone) {
      saveStore({ meta: null });
      grantLog(
        `token endpoint is gone (${message}) — cached discovery dropped, rediscovering on the next attempt`
      );
      throw new Error(
        `the token endpoint is gone (${message}) — rediscovering on the next attempt; grant kept, will retry`,
        { cause: e }
      );
    }
    const definitive = e instanceof TokenError && e.oauthError !== "temporarily_unavailable" && (deadRefresh || DEFINITIVE_OAUTH_ERRORS.has(e.oauthError ?? "") || e.status === 400 || e.status === 401);
    if (!definitive) {
      throw new Error(`token refresh failed transiently (${message}) — grant kept, will retry`, {
        cause: e
      });
    }
    const expired = hours.exp && now() >= hours.exp;
    const notYet = hours.nbf && now() < hours.nbf;
    const speculative = proactive && tokenUsable(cur);
    if (!expired && !deadRefresh && (notYet || speculative)) {
      const stamp = loadGrantState().early_refused_until;
      const repeated = !!notYet && !!stamp && stamp > now() - 12e4;
      const why = notYet ? `the refresh token's own hour is another ${Math.round((hours.nbf - now()) / 1e3)}s away on the server's clock` : "the access token in hand still works";
      let until = null;
      if (notYet) {
        until = Math.min(now() + EARLY_REFUSAL_COOLDOWN_MS, hours.nbf);
        saveGrantState({ early_refused_until: until });
      }
      grantLog(
        `refresh refused early — ${why}; grant kept` + (until ? `, not knocking again for ${Math.round((until - now()) / 1e3)}s` : "") + ` (${message})`
      );
      throw new HoldOffError(
        repeated ? `token refresh refused too early again (${message}) — the hour is real: ${why}; grant kept` : `token refresh refused too early (${message}) — ${why}; grant kept, will retry`,
        !!notYet && !repeated,
        notYet ? hours.nbf : null
      );
    }
    if (loadStore().tokens?.refresh_token !== cur.refresh_token) {
      debug("our refresh token was already rotated by a sibling — retrying with the stored one");
      return null;
    }
    if (e instanceof TokenError && e.oauthError === "invalid_client") {
      log("the server no longer knows this client — dropping the registration");
      grantLog("server no longer knows this client — registration dropped");
      dropRegistration(clientId);
    }
    const overdue = hours.exp && now() >= hours.exp;
    grantLog(
      `refresh refused${overdue ? " and the grant is past its own expiry" : ""}: ${message}`
    );
    throw new DeadGrantError(overdue ? `${message} (grant expired)` : message, !!overdue);
  }
}
var ENDPOINT_CHECK_BUDGET_MS = 1e4;
async function tokenEndpointMoved(meta) {
  try {
    const fresh2 = await Promise.race([
      discoverMeta(null),
      sleep(ENDPOINT_CHECK_BUDGET_MS).then(() => {
        throw new Error("discovery did not answer within the budget");
      })
    ]);
    return fresh2.as.token_endpoint !== meta.as.token_endpoint;
  } catch {
    return true;
  }
}
async function refreshShared(meta, rejected, proactive, interactive) {
  const deadline = Date.now() + REFRESH_WAIT_MS;
  for (; ; ) {
    const sibling = usableTokens({ rejected });
    if (sibling) {
      debug("a sibling refreshed the grant — reusing it");
      return sibling;
    }
    if (Date.now() > deadline) {
      throw new Error("the shared grant could not be refreshed in time — grant kept, will retry");
    }
    if (acquireRefreshLock()) {
      try {
        const late = usableTokens({ rejected });
        if (late) {
          debug("a sibling refreshed the grant — reusing it");
          return late;
        }
        if (!interactive && refusalStands()) {
          throw new DeadGrantError(
            "the grant stands refused on this machine — the background knock waits for the next stretch or a human's call"
          );
        }
        try {
          const cur = loadStore().tokens;
          if (!cur?.refresh_token) throw new DeadGrantError("no refresh grant on disk");
          const fresh2 = await refreshOnce(meta, cur, proactive);
          if (fresh2) return fresh2;
        } catch (e) {
          if (e instanceof DeadGrantError) noteRefusal(e.message);
          throw e;
        }
      } finally {
        releaseRefreshLock();
      }
    } else {
      await sleep(REFRESH_POLL_MS);
    }
  }
}
function dropRegistration(clientId) {
  if (clientId && loadStore().client?.client_id === clientId) saveStore({ client: null });
}
function noteRefusal(reason) {
  const local = Date.now();
  const first2 = !loadGrantState().refused_since;
  saveGrantState({ refused_at: local, ...first2 ? { refused_since: local, reason } : {} });
  if (first2) grantLog(`grant refused: ${reason}`);
}
function refusalStands() {
  const at2 = loadGrantState().refused_at;
  return !!at2 && Date.now() - at2 < REFUSED_KNOCK_MS;
}

// js/bridge/auth.ts
var authInFlight = /* @__PURE__ */ new Map();
function heldNote(until) {
  if (until === null) return "the grant itself is whole";
  const minutes = Math.max(1, Math.round((until - now()) / 6e4));
  return `the grant itself is whole and comes back on its own in about ${minutes} min`;
}
async function ensureAuth(wwwAuthenticate, opts = {}) {
  const { force = false, interactive = true, proactive = false } = opts;
  if (CFG.pat) {
    throw new TokenRefused(
      `the personal access token from ${CFG.patSource} is refused by the server — revoked, expired or without rights to this graph; mint a new one on the graph's token page and put it in ${CFG.patSource}`
    );
  }
  const grant = storePath();
  const flight = authInFlight.get(grant);
  if (flight) {
    if (!interactive || flight.interactive) return flight.promise;
    await flight.promise.catch(() => {
    });
    const again = authInFlight.get(grant);
    if (again) return again.promise;
    const s2 = loadStore();
    if (tokenUsable(s2.tokens)) return s2.tokens;
  }
  const promise = (async () => {
    try {
      const s2 = loadStore();
      const rejected = opts.rejected ?? (force ? s2.tokens?.access_token ?? null : null);
      if (!force && tokenUsable(s2.tokens)) return s2.tokens;
      const meta = s2.meta?.as ? s2.meta : await discover(wwwAuthenticate);
      meta.resource = resourceOf(meta);
      if (interactive && s2.tokens?.refresh_token && loginPublished() && refusalStands()) {
        const landed = usableTokens({ rejected });
        if (landed) return landed;
        return await interactiveFlow(meta, s2.tokens);
      }
      if (s2.tokens?.refresh_token) {
        let rechecks = 0;
        let waited = 0;
        for (; ; ) {
          try {
            return await refreshShared(meta, rejected, proactive, interactive);
          } catch (e) {
            if (!interactive) {
              if (e instanceof DeadGrantError) {
                throw new Error(
                  "authorization required (refresh grant dead, browser flow deferred)",
                  { cause: e }
                );
              }
              throw e;
            }
            if (e instanceof HoldOffError) {
              if (e.retryNow) throw e;
              const left2 = e.until === null ? Infinity : e.until - now();
              if (left2 + waited <= IN_CALL_WAIT_MS) {
                const pause = Math.max(left2, 0) + 100;
                waited += pause;
                debug(`${e.message} — sitting it out inside the call (${pause}ms)`);
                await sleep(pause);
                continue;
              }
              log(`${e.message} — offering the login beside the wait`);
              return await interactiveFlow(meta, s2.tokens, heldNote(e.until), false);
            }
            if (e instanceof DeadGrantError) {
              if (!e.expired && rechecks < DEAD_RECHECK_MS.length && !loginPublished()) {
                const pause = DEAD_RECHECK_MS[rechecks++] ?? 0;
                debug(`refresh refused (${e.message}) — knocking again in ${pause}ms`);
                await sleep(pause);
                continue;
              }
              log(`refresh grant is dead (${e.message}) — starting a fresh authorization`);
              return await interactiveFlow(meta, s2.tokens);
            }
            throw e;
          }
        }
      }
      if (!interactive)
        throw new Error(
          `authorization required (no tokens, browser flow deferred) — or give the bridge a personal access token (${envName("BRIDGE_TOKEN")}, or the file <auth-dir>/token)`
        );
      return await interactiveFlow(meta, s2.tokens);
    } finally {
      authInFlight.delete(grant);
    }
  })();
  authInFlight.set(grant, { promise, interactive });
  return promise;
}
var REFRESH_MARGIN_MS = 3 * 6e4;
function startTokenKeepalive() {
  if (CFG.pat) return;
  const tick = () => {
    const t = loadStore().tokens;
    if (!t?.refresh_token) return;
    const expiresAt = t.expires_at || 0;
    if (!expiresAt || expiresAt - now() >= REFRESH_MARGIN_MS) return;
    const hours = refreshHours(t);
    if (hours.nbf && now() < hours.nbf) {
      debug(
        `refresh token not in force for another ${Math.round((hours.nbf - now()) / 1e3)}s — waiting`
      );
      return;
    }
    if (hours.exp && now() >= hours.exp) {
      debug("the grant is past its own expiry — only a human can mend it now");
      return;
    }
    if (refusalStands()) {
      debug("the grant stands refused — the machine's control knock is not due yet");
      return;
    }
    ensureAuth(null, { force: true, interactive: false, proactive: true }).then(() => debug("background token refresh ok")).catch((e) => log(`background token refresh: ${errorMessage(e)}`));
  };
  tick();
  setInterval(tick, 6e4).unref();
}

// js/shared/channel.ts
import * as diagnostics from "node:diagnostics_channel";
var PING_CHANNEL = "undici:websocket:ping";
var SILENT_INTERVALS = 3;
var SILENT_FLOOR_MS = Number(process.env[envName("CHANNEL_SILENT_FLOOR_MS")]) || 6e4;
var DEAD_TOKEN_CODES = [4002];
var STOPPED_CODE = 4001;
var EVICTED_CODE = 4e3;
var ROLLOUT_CODE = 4003;
var FAST_DROP_MS = 5e3;
var ERROR_GUESS_DELAY_MS = 500;
var FLAP_PAUSES_MS = (process.env[envName("CHANNEL_FLAP_MS")] || "5000,10000,20000,40000,60000").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
function httpOrigin(socketUrl) {
  return new URL(socketUrl).origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}
function versionUrl(socketUrl) {
  return apiBase(socketUrl) + "/version";
}
function apiBase(socketUrl) {
  return httpOrigin(socketUrl) + "/api";
}
function statusUrl(socketUrl) {
  return socketUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace("/channel/ws/", "/channel/status/");
}
async function serviceUp(socketUrl) {
  return fetch(versionUrl(socketUrl), { signal: AbortSignal.timeout(5e3) }).then((r) => r.ok ? r.json() : null).catch(() => null);
}
function deadTokenAdvice(code) {
  return words(CHANNEL).deadTokenAdvice(code);
}
function classifyOrigin(frame2, myKarta) {
  const p = frame2.provenance ?? {};
  const noAuthor = p.via === "room" && p.from_karta_seq == null && !p.from_standing;
  if (p.via === "platform" || p.auth === "none" || p.auth === "platform" || noAuthor)
    return "platform";
  if (p.as_person === true) return "human";
  if (p.from_karta_seq != null && p.user_karta_seq != null && p.from_karta_seq === p.user_karta_seq)
    return "human";
  if (myKarta != null && p.from_karta_seq != null && String(p.from_karta_seq) === String(myKarta))
    return "sibling";
  return "peer";
}
function isDirectWord(frame2) {
  if (frame2?.type !== "message") return false;
  const f = frame2;
  if (f.room || typeof f.event_kind === "string" && f.event_kind.startsWith("room."))
    return false;
  const p = frame2.provenance ?? {};
  if (p.via === "graph" || p.via === "room") return false;
  const origin2 = frame2.origin ?? classifyOrigin(frame2);
  if (origin2 === "platform") return false;
  return origin2 === "human" || !!p.from_standing || p.from_karta_seq != null;
}
function holdSocket(o) {
  let fastDrops = 0;
  let slowdown = 0;
  let rolloutTold = false;
  let dead = false;
  let stopped = false;
  let retry = null;
  let ws = null;
  let handing = null;
  let lastLife = 0;
  let heardAt = 0;
  let pingMs = 0;
  let runtimeSeesPings = false;
  let lastTick = 0;
  let watch2 = null;
  const onPing = (m) => {
    const from = m?.websocket;
    if (!ws || from !== void 0 && from !== ws) return;
    lastLife = heardAt = Date.now();
    runtimeSeesPings = true;
  };
  diagnostics.subscribe?.(PING_CHANNEL, onPing);
  const unsubscribePing = () => {
    diagnostics.unsubscribe?.(PING_CHANNEL, onPing);
  };
  const stopWatch = () => {
    if (watch2) clearInterval(watch2);
    watch2 = null;
  };
  function open() {
    if (stopped) return;
    const startedAt = Date.now();
    const sock = new WebSocket(o.url);
    ws = sock;
    stopWatch();
    lastLife = startedAt;
    let gone = false;
    sock.addEventListener("ping", () => {
      if (ws !== sock) return;
      lastLife = heardAt = Date.now();
      runtimeSeesPings = true;
    });
    sock.addEventListener("message", (e) => {
      if (stopped || ws !== sock) return;
      lastLife = heardAt = Date.now();
      const raw = typeof e.data === "string" ? e.data : words(CHANNEL).binaryFrame();
      if (handing) return handing.onFrame(raw);
      let frame2 = null;
      if (typeof e.data === "string") {
        try {
          frame2 = JSON.parse(raw);
        } catch {
        }
      }
      if (frame2?.type === "hello") {
        rolloutTold = false;
        watchLife(Number(frame2.ping_interval_seconds) * 1e3);
      }
      o.onFrame(raw, frame2 && typeof frame2 === "object" ? frame2 : null);
    });
    sock.addEventListener(
      "error",
      () => setTimeout(() => void dropped(1006), ERROR_GUESS_DELAY_MS)
    );
    sock.addEventListener("close", (e) => {
      const c = e;
      void dropped(c.code, typeof c.reason === "string" ? c.reason : "");
    });
    function watchLife(interval) {
      stopWatch();
      if (!(interval > 0)) return;
      pingMs = interval;
      const every = Math.max(pingMs, 250);
      lastTick = Date.now();
      watch2 = setInterval(() => {
        const now2 = Date.now();
        if (now2 - lastTick > 2 * every + 1e3) lastLife = now2;
        lastTick = now2;
        if (stopped || ws !== sock || !runtimeSeesPings) return;
        const silent = now2 - lastLife;
        if (silent <= Math.max(SILENT_INTERVALS * pingMs + 1e3, SILENT_FLOOR_MS)) return;
        stopWatch();
        (o.onHung ?? o.onNote)?.(words(CHANNEL).hung(Math.round(silent / 1e3), pingMs / 1e3));
        try {
          sock.close();
        } catch {
        }
        void dropped(1006);
      }, every);
      watch2.unref?.();
    }
    function yieldTo(cb, code) {
      if (dead) return;
      dead = true;
      stopped = true;
      if (retry) clearTimeout(retry);
      stopWatch();
      unsubscribePing();
      cb(code);
    }
    async function dropped(code, reason = "") {
      if (stopped || ws !== sock) return;
      stopWatch();
      if (handing) {
        const h = handing;
        handing = null;
        stopped = true;
        ws = null;
        unsubscribePing();
        return h.onGone(code);
      }
      if (DEAD_TOKEN_CODES.includes(code)) return yieldTo(o.onDeadToken, code);
      if (code === STOPPED_CODE) return yieldTo((c) => o.onStopped(c, reason), code);
      if (code === EVICTED_CODE) return yieldTo(o.onEvicted ?? o.onDeadToken, code);
      if (gone) return;
      gone = true;
      o.onDropped?.();
      const fast = Date.now() - startedAt < FAST_DROP_MS;
      fastDrops = fast ? fastDrops + 1 : 0;
      if (!fast) slowdown = 0;
      if (fastDrops >= 3) {
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) {
          if (slowdown === 0) o.onServiceAlive(String(up.version ?? ""));
          const wait = FLAP_PAUSES_MS[Math.min(slowdown, FLAP_PAUSES_MS.length - 1)] ?? 6e4;
          slowdown++;
          fastDrops = 2;
          retry = setTimeout(open, wait);
          return;
        }
        if (!rolloutTold) o.onNote?.(words(CHANNEL).rollout());
        rolloutTold = true;
        fastDrops = 1;
      }
      retry = setTimeout(open, code === ROLLOUT_CODE ? 3e3 : 2e3);
    }
  }
  open();
  return {
    close(reason = "held no more") {
      stopped = true;
      handing = null;
      stopWatch();
      unsubscribePing();
      if (retry) clearTimeout(retry);
      retry = null;
      const sock = ws;
      ws = null;
      try {
        sock?.close(1e3, reason);
      } catch {
      }
    },
    handOff(onFrame, onGone) {
      if (stopped || !ws || ws.readyState !== 1) {
        this.close("handed off without a socket");
        return onGone(0);
      }
      if (retry) clearTimeout(retry);
      retry = null;
      stopWatch();
      handing = { onFrame, onGone };
    },
    send(text2) {
      if (stopped || handing || !ws || ws.readyState !== 1) return false;
      try {
        ws.send(text2);
        return true;
      } catch {
        return false;
      }
    },
    get alive() {
      return !stopped && !!ws && (ws.readyState === 0 || ws.readyState === 1);
    },
    get heardAt() {
      return heardAt;
    }
  };
}

// js/shared/seen.ts
import { appendFileSync as appendFileSync2, readFileSync as readFileSync9, renameSync as renameSync6, writeFileSync as writeFileSync7 } from "node:fs";

// js/shared/room-fields.ts
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var str = (v) => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
var after = (key2, prefix) => key2.startsWith(prefix) ? key2.slice(prefix.length) : key2;
var need = (v) => str(v) || "?";
var opt = (sep3, v) => {
  const x = str(v);
  return x ? sep3 + x : "";
};
var pick = (dict, key2) => Object.hasOwn(dict, key2) ? dict[key2] : void 0;
var mineOf = (frame2) => [str(frame2.to_standing_id), str(frame2.to_standing)].filter(Boolean);
function myRole(frame2, fields) {
  const ka = obj(fields.karta);
  const seq3 = str(ka.seq);
  if (!seq3 || seq3 !== str(frame2.karta_seq)) return false;
  const theirs = str(ka.realm);
  const mine = str(frame2.realm) || str(obj(frame2.room).realm);
  return !theirs || !mine || theirs === mine;
}
function addresseeOf(v) {
  if (typeof v === "string") return v ? { addr: [v], label: v } : null;
  const o = obj(v);
  const handle = str(o.handle).replace(/^@/, "");
  const standing = str(o.standing) || (handle ? `@${handle}${str(o.name) ? `:${str(o.name)}` : ""}` : "");
  const id = str(o.id);
  const name2 = str(o.standing) ? str(o.name) : "";
  const label = name2 && standing ? `${name2} (${standing})` : standing || str(o.name) || id;
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
var byMe = (frame2) => {
  const mine = mineOf(frame2);
  const author = obj(obj(frame2.line).author);
  return [str(author.id), str(author.standing)].some((a) => a && mine.includes(a));
};
var askFromPerson = (frame2) => {
  const line = obj(frame2.line);
  const kind = str(line.kind);
  const asking = ASK_KINDS.has(kind) || kind === "progress" && !!str(obj(line.fields).withdraws);
  return asking && classifyOrigin(frame2) === "human";
};
var handleOf = (address) => /^@([^:]+):/.exec(address)?.[1] ?? "";
function askedMine(frame2, fields) {
  const mine = mineOf(frame2);
  if (byMe(frame2)) return false;
  const to = toOf(fields);
  const place = addresseeOf(to.standing);
  if (place?.addr.some((a) => mine.includes(a))) return true;
  if (!myRole(frame2, { karta: to.karta })) return false;
  if (!place) return true;
  const theirs = handleOf(str(obj(to.standing).standing) || str(to.standing));
  return !!theirs && theirs === handleOf(str(frame2.to_standing));
}
function addressedMine(frame2) {
  if (frame2.addressee_left === true) return false;
  const to = addresseeOf(frame2.addressee) ?? addresseeOf(toOf(obj(obj(frame2.line).fields)));
  const mine = mineOf(frame2);
  return !!to && to.addr.some((a) => mine.includes(a));
}
var quote = (s2) => s2 ? words(CASE_LINE).quote(s2) : "";
function formOf(fields) {
  const W4 = words(ASK);
  const form = str(fields.form);
  if (form === "yes_no") return W4.yesNo();
  if (form === "free") return W4.free();
  if (form !== "choice" || !Array.isArray(fields.options)) return "";
  const options = fields.options.map((o) => {
    const x = obj(o);
    const ctx = str(x.context);
    return `${str(x.id)} ${quote(str(x.label))}${ctx ? ` (${ctx})` : ""}`;
  }).join(", ");
  return W4.choice(need(options));
}
function askValues(kind, line, fields) {
  if (kind !== "ask")
    return { reply: [str(fields.choice), quote(str(line.done))].filter(Boolean).join("; ") };
  const W4 = words(ASK);
  const to = toOf(fields);
  const k = obj(to.karta);
  const place = addresseeOf(to.standing)?.label ?? "";
  const rec5 = obj(fields.recommendation);
  return {
    to: str(k.name) || (str(k.seq) ? `#${str(k.seq)}` : ""),
    to_place: place ? W4.place(need(place)) : "",
    form: formOf(fields),
    advice: str(rec5.option) || str(rec5.why) ? W4.advice(need(str(rec5.option) || "—"), opt(" — ", rec5.why)) : ""
  };
}
function askText(kind, cause, v) {
  const W4 = words(ASK);
  const invite = cause ? pick(INVITE_CAUSES, cause) : void 0;
  if (invite) return W4[invite](need(v.who), need(v.standing));
  if (kind === "progress" && str(v.withdraws))
    return W4.withdrawn(
      need(v.withdraws),
      need(v.key),
      need(v.done),
      need(v.verdict),
      need(v.author)
    );
  if (kind === "ask")
    return W4.ask(
      need(v.author),
      need(v.to),
      opt(" ", v.to_place),
      need(v.key),
      need(v.done),
      opt("; ", v.form),
      opt("; ", v.advice)
    );
  if (kind === "answer") return W4.answer(need(v.author), need(v.refers_to), need(v.reply));
  if (kind === "ack") return W4.ack(need(v.refers_to), opt(": ", v.reply), need(v.author));
  return void 0;
}

// js/shared/numbering.ts
var numberingOf = (frame2) => frame2.numbering === "case" ? "case" : "";
var numberedKey = (frame2, key2) => key2 && numberingOf(frame2) ? `case:${key2}` : key2;

// js/shared/askmemory.ts
var baseOf = (frame2) => numberedKey(
  frame2,
  `${mineOf(frame2)[0] ?? ""}|${str(obj(frame2.room).id) || str(obj(frame2.room).seq)}|${str(obj(frame2.line).key)}`
);
var lineOf = (frame2) => obj(frame2.line);
var kindOf = (frame2) => str(lineOf(frame2).kind);
var numOf = (frame2) => str(lineOf(frame2).entry_id ?? frame2.entry_id);
function openOn(store, frame2) {
  const base = `${baseOf(frame2)}#`;
  const out7 = [];
  for (const s2 of store.keys())
    if (s2.startsWith(base) && !store.has(`off:${s2}`)) out7.push(s2.slice(base.length));
  return out7;
}
var namedOf = (frame2) => {
  const kind = kindOf(frame2);
  if (kind === "progress") return str(obj(lineOf(frame2).fields).withdraws);
  if (kind === "answer") return str(lineOf(frame2).refers_to) || str(frame2.in_reply_to);
  return "";
};
var isOpen = (store, frame2, n) => {
  const k = `${baseOf(frame2)}#${n}`;
  return !!n && store.has(k) && !store.has(`off:${k}`);
};
function closesMine(store, frame2) {
  if (byMe(frame2) || !str(lineOf(frame2).key)) return false;
  const kind = kindOf(frame2);
  if (kind === "progress" || kind === "answer") return isOpen(store, frame2, namedOf(frame2));
  return kind === "ask" && !askedMine(frame2, obj(lineOf(frame2).fields)) && openOn(store, frame2).length > 0;
}
function noteAsk(store, frame2) {
  if (!str(lineOf(frame2).key)) return;
  const kind = kindOf(frame2);
  const fields = obj(lineOf(frame2).fields);
  const base = `${baseOf(frame2)}#`;
  if (kind === "ask" && askedMine(frame2, fields)) {
    const own = numOf(frame2);
    if (store.has(`${base}${own}`)) return;
    for (const n of openOn(store, frame2)) store.add(`off:${base}${n}`);
    store.add(`${base}${own}`);
    return;
  }
  if (kind === "progress" || kind === "answer" && !byMe(frame2)) {
    const n = namedOf(frame2);
    if (isOpen(store, frame2, n)) store.add(`off:${base}${n}`);
  } else if ((kind === "ack" || kind === "ask") && !byMe(frame2))
    for (const n of openOn(store, frame2)) store.add(`off:${base}${n}`);
}
var ASKS_KEPT = 512;
var kept = /* @__PURE__ */ new Set();
var processAsks = {
  has: (s2) => kept.has(s2),
  add: (s2) => {
    kept.add(s2);
    for (const old of kept) {
      if (kept.size <= ASKS_KEPT) break;
      kept.delete(old);
    }
  },
  keys: () => kept
};

// js/shared/room-kinds.ts
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
  const name2 = str(a.name);
  const standing = str(a.standing);
  if (name2) return standing ? `${name2} (${standing})` : name2;
  if (standing) return standing;
  return a.kind === "platform" ? words(CASE_LINE).platform() : "?";
}
function roomOf(v) {
  const r = obj(v);
  return str(r.seq) || str(r.id) || str(v);
}
function whoOf(fields) {
  const st = obj(fields.standing);
  const ka = obj(fields.karta);
  const name2 = str(st.name) || str(ka.name);
  const addr = str(st.standing);
  return name2 && addr ? `${name2} (${addr})` : name2 || addr;
}
function kindText(kind, v, f, pending2, aborted) {
  const W4 = words(ROOM);
  const n = (k) => need(v[k]);
  const lapsed = obj(obj(f.line).author).kind === "platform";
  if (pending2) return W4.saidPending(n("author"));
  if (aborted) return lapsed ? W4.bodyLapsed(n("refers_to")) : W4.bodyAborted(n("refers_to"));
  if (kind === "auto")
    return pick(words(ROOM_AUTO), str(v.code))?.(n("room")) ?? W4.auto(n("code"), n("room"));
  const ask3 = askText(kind, str(v.cause), v);
  if (ask3 !== void 0) return ask3;
  const reasoning = opt("; ", v.reasoning);
  const op = kind === "node" ? pick(NODE_OPS, str(v.op)) : void 0;
  if (op) return W4[op](n("seq"), n("name"), reasoning);
  switch (kind) {
    case "said":
      return W4.said(n("author"));
    case "body":
      return W4.body(n("refers_to"), n("author"));
    case "closing":
      return W4.closing(n("author"), n("ends_at"), str(v.evidence));
    case "closed":
      return W4.closed(n("reason"));
    case "objection":
      return W4.objection(n("author"), n("reason"));
    case "late_objection":
      return W4.lateObjection(n("author"));
    case "progress":
      return W4.progress(n("key"), n("done"), n("verdict"), opt(" — ", v.note), n("author"));
    case "opened":
      return W4.opened(n("author"));
    case "joined":
      return W4.joined(n("who"));
    case "left":
      return W4.left(n("who"), str(v.reason));
    case "invite":
      return W4.invite(n("author"), n("who"));
    case "withdraw":
      return W4.withdraw(n("author"));
    case "node":
      return W4.node(n("seq"), n("name"), n("realm"), reasoning);
    case "link":
      return W4.link(n("room"), n("rel"));
    default:
      return "";
  }
}
function roomKind(frame2) {
  if (!frame2 || typeof frame2 !== "object") return null;
  const f = frame2;
  const ek = f.event_kind;
  if (typeof ek !== "string" || !ek.startsWith("room.")) return null;
  const kind = ek.slice(5);
  const line = obj(f.line);
  const fields = obj(line.fields);
  const key2 = str(line.key);
  const mine = mineOf(f);
  const node = obj(fields.node);
  const cause = kind === "invite" ? str(fields.cause) : "";
  const byWhom = authorOf(
    kind === "body" && Object.keys(obj(f.in_reply_to_from)).length ? f.in_reply_to_from : line.author
  );
  const values = {
    kind,
    cause,
    author: byWhom,
    key: key2,
    done: line.done,
    verdict: pick(words(VERDICT), str(line.verdict))?.() ?? line.verdict,
    note: line.note,
    ends_at: fields.ends_at,
    evidence: Array.isArray(fields.evidence) ? fields.evidence.map(str).join(", ") : "",
    entry_id: line.entry_id ?? f.entry_id,
    refers_to: str(line.refers_to) || str(f.in_reply_to) || str(obj(f.word).entry_id),
    reason: fields.reason,
    target: after(key2, "invite:"),
    // Observed live: the invite key carries the id, the invitee's name is in the line fields (standing/karta with name).
    // Joined and left — fields.standing (a timed-out leave is written by the platform, api 0.89.6), else the author;
    // a role call by cause — fields.karta (graph @nks/nks-dev, node #6870).
    who: kind === "joined" || kind === "left" ? whoOf({ standing: fields.standing }) || byWhom : (cause ? whoOf({ karta: fields.karta }) : whoOf(fields)) || after(key2, "invite:"),
    standing: str(fields.gone_standing) || addresseeOf(fields.gone_standing)?.label,
    ...ASK_KINDS.has(kind) ? askValues(kind, line, fields) : {},
    room: roomOf(fields.room) || after(key2, "link:"),
    rel: pick(words(ROOM_REL), str(fields.rel))?.() ?? fields.rel,
    code: fields.code,
    op: fields.op,
    seq: node.seq,
    name: node.name,
    realm: node.realm,
    // A node delta's reasoning is the record's body, not a field (graph @nks/nks-dev, node #6070).
    reasoning: kind === "node" ? line.done || f.body : void 0,
    withdraws: fields.withdraws
  };
  const W4 = words(ROOM);
  const rule = RULES[kind];
  const author = str(values.author);
  if (!rule)
    return {
      kind,
      rule: "batch",
      words: W4.unknown(need(kind)),
      author,
      phase: null,
      known: false
    };
  const word3 = kind === "said" || kind === "body";
  const withheld = word3 && f.body_withheld === true;
  const to = word3 ? addresseeOf(f.addressee) ?? (withheld ? { addr: ["?"], label: "?" } : null) : null;
  const addresseeLeft = f.addressee_left === true || fields.addressee_left === true;
  if (to && !addresseeLeft && (withheld || mine.length && !to.addr.some((a) => mine.includes(a)))) {
    const counts = kind === "said";
    const pair = JSON.stringify([roomOf(f.room), author, to.addr[0]]);
    const id = need(counts ? values.entry_id : values.refers_to);
    const by = need(values.author);
    const addressee = need(to.label);
    const run = (n) => n === 0 ? W4.asideBody(by, addressee, id) : n > 1 ? W4.asideRun(by, addressee, W4.messages(n), id) : W4.aside(by, addressee, id);
    const aside = { pair, counts, run };
    const words2 = run(counts ? 1 : 0);
    return { kind, rule: "batch", words: words2, author, phase: null, known: true, aside };
  }
  const pending2 = kind === "said" && f.body_pending === true && !str(f.body) && !str(line.done);
  const aborted = kind === "body" && fields.aborted === true;
  let text2 = kindText(kind, values, f, pending2, aborted);
  if (kind === "closing") {
    const may = Array.isArray(fields.may_object) ? fields.may_object.map((m) => typeof m === "string" ? m : str(obj(m).id)) : [];
    const myId = str(f.to_standing_id);
    const mayI = !!myId && may.includes(myId);
    text2 += "; " + (mayI ? W4.closingMay(need(values.entry_id)) : W4.closingNot());
  }
  const stack = rule === "stack" ? f.stack === "defer" ? "batch" : "interrupt" : rule === "mine" ? mine.includes(str(values.target)) || myRole(f, fields) ? "interrupt" : "batch" : rule === "addressed" ? addressedMine(f) ? "interrupt" : "batch" : rule;
  const phase = pending2 ? "pending" : aborted ? "aborted" : null;
  return { kind, rule: phase ? "batch" : stack, words: text2, author, phase, known: true };
}
var byKind = (frame2) => roomKind(frame2) !== null;
var stackOf = (frame2) => roomKind(frame2)?.rule ?? (frame2?.stack === "defer" ? "batch" : "interrupt");

// js/shared/addressed.ts
var LOUD_KINDS = /* @__PURE__ */ new Set(["closing", "closed", "objection", "late_objection"]);
var addressedWords = /* @__PURE__ */ new Set();
var WORDS_KEPT = 512;
function wordKeyOf(frame2) {
  const f = frame2;
  const line = obj(f.line);
  const entry = roomKind(frame2)?.kind === "body" ? str(line.refers_to) || str(f.in_reply_to) || str(obj(f.word).entry_id) : str(line.entry_id ?? f.entry_id);
  return numberedKey(
    frame2,
    `${mineOf(f)[0] ?? ""}|${str(obj(f.room).id) || str(obj(f.room).seq)}|${entry}`
  );
}
function rememberWord(key2) {
  addressedWords.add(key2);
  for (const old of addressedWords) {
    if (addressedWords.size <= WORDS_KEPT) break;
    addressedWords.delete(old);
  }
}
var ASK_CLOSERS = /* @__PURE__ */ new Set(["ask", "answer", "ack", "progress"]);
var askDecided = /* @__PURE__ */ new Map();
function askMemory(f) {
  if (f.asks_decided === true) return false;
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
function addressedToMine(frame2) {
  if (!frame2) return false;
  const f = frame2;
  const room = obj(f.room);
  if (!str(room.seq) && !str(room.id)) return true;
  if (!byKind(frame2)) return true;
  const line = obj(f.line);
  const fields = obj(line.fields);
  const rk = roomKind(frame2);
  if (rk?.aside) return false;
  const closesAsk = !!rk && ASK_CLOSERS.has(rk.kind) && askMemory(f);
  const mine = mineOf(f);
  const hit = (v) => {
    const a = addresseeOf(v);
    return !!a && mine.length > 0 && a.addr.some((x) => mine.includes(x));
  };
  if (rk?.kind === "body") {
    const word3 = obj(f.word);
    if (f.addressed === true || hit(f.addressee) || str(obj(obj(word3.line).fields).kind) === "important" || addressedWords.has(wordKeyOf(frame2)))
      return true;
  } else if (
    // A word to me, a reply to my record (#5954), marked important; a word in flight
    // is remembered, since its body comes as a second phase without these marks.
    hit(f.addressee) || hit(f.in_reply_to_from) || str(f.said) === "important" || str(fields.kind) === "important"
  ) {
    if (rk?.phase === "pending") rememberWord(wordKeyOf(frame2));
    return true;
  }
  if (rk?.kind === "ask" && askedMine(f, fields)) return true;
  if (closesAsk || rk && ASK_CLOSERS.has(rk.kind) && f.addressed === true) return true;
  if (rk?.kind === "invite" || rk?.kind === "withdraw") {
    if (mine.includes(after(str(line.key), "invite:"))) return true;
    if (rk.kind === "invite" && myRole(f, fields)) return true;
  }
  if (rk && LOUD_KINDS.has(rk.kind)) return true;
  if (rk && ASK_KINDS.has(rk.kind) || askFromPerson(f)) return false;
  return (frame2.origin ?? classifyOrigin(frame2, str(f.karta_seq) || void 0)) === "human";
}

// js/shared/seen.ts
var SEEN_KEEP = 5e3;
var SEEN_SLACK = 1e3;
var evOf = (v) => typeof v === "number" || typeof v === "string" && v ? `ev:${v}` : "";
function eventKeyOf(frame2) {
  const via2 = frame2?.provenance?.via;
  if (via2 === "room") return evOf(frame2?.event_id);
  if (via2 !== "graph") return "";
  const body = frame2?.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  return evOf(body.event_id);
}
var asText = (frame2) => addressedToMine(frame2);
function deliveryKeys(frame2, named = false) {
  const id = typeof frame2?.id === "string" ? frame2.id : "";
  const ev = frame2 && asText(frame2) ? eventKeyOf(frame2) : "";
  const mark = ev && frame2?.stale === true ? `evs:${ev.slice(3)}` : ev;
  return [id, mark && (named ? `c${mark}` : mark)].filter(Boolean);
}
function eventIn(frame2, has) {
  const ev = frame2 ? eventKeyOf(frame2) : "";
  if (!ev || !frame2) return false;
  const n = ev.slice(3);
  const stale = frame2.stale === true;
  const keys = !asText(frame2) ? [ev, `evs:${n}`] : stale ? [ev, `evs:${n}`, `cev:${n}`, `cevs:${n}`] : [ev, `cev:${n}`];
  return keys.some(has);
}
var isTact = (frame2) => frame2?.provenance?.wake === "look_up";
function foldedTacts(all2) {
  const tacts = all2.filter((f) => isTact(f));
  const last = tacts.reduce((a, f) => a && tactAt([a]) > tactAt([f]) ? a : f, null);
  return new Set(tacts.filter((f) => f !== last));
}
var tactAt = (frames) => (frames ?? []).filter(isTact).map((f) => typeof f.received_at === "string" ? f.received_at : "").reduce((a, b) => b > a ? b : a, "");
var sameCopy = (a, b) => !!a && eventKeyOf(a) === eventKeyOf(b) && asText(a) === asText(b);
function splitBatch(all2, keep, has) {
  const folded = foldedTacts(all2);
  let kept2 = all2.filter((f) => !folded.has(f) && !eventIn(f, has));
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
      keys: all2.flatMap((f) => deliveryKeys(f, !on.has(f)))
    };
  }
}
function seenIds(seenPath) {
  try {
    return new Set(readFileSync9(seenPath, "utf8").split("\n").filter(Boolean));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function noteSeen(seenPath, id, seen) {
  if (seen.has(id)) return;
  seen.add(id);
  try {
    appendFileSync2(seenPath, id + "\n");
    if (seen.size > SEEN_KEEP + SEEN_SLACK) compact(seenPath, seen);
  } catch {
  }
}
function compact(seenPath, seen) {
  const file = [...seenIds(seenPath)];
  const inFile = new Set(file);
  const tail2 = [...[...seen].filter((x) => !inFile.has(x)), ...file].slice(-SEEN_KEEP);
  const tmp = `${seenPath}.${process.pid}.tmp`;
  writeFileSync7(tmp, tail2.join("\n") + "\n");
  renameSync6(tmp, seenPath);
  seen.clear();
  for (const x of tail2) seen.add(x);
}

// js/bridge/askdisk.ts
import { appendFileSync as appendFileSync3, readFileSync as readFileSync10 } from "node:fs";
var asksPathOf = (seenPath) => seenPath.replace(/\.seen$/, "") + ".asks";
var loaded = /* @__PURE__ */ new Map();
function load(path) {
  try {
    return new Set(readFileSync10(path, "utf8").split("\n").filter(Boolean));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function diskAsks(seenPath) {
  const path = asksPathOf(seenPath);
  let set = loaded.get(path);
  if (!set) loaded.set(path, set = load(path));
  const s2 = set;
  return {
    has: (k) => s2.has(k),
    add: (k) => {
      if (s2.has(k)) return;
      s2.add(k);
      try {
        appendFileSync3(path, `${k}
`);
      } catch {
      }
    },
    keys: () => s2
  };
}

// js/bridge/addressmark.ts
var markOf = (frame2) => `word:${wordKeyOf(frame2)}`;
function markAddressed(frame2, seenPath, seen) {
  const rk = roomKind(frame2);
  if (rk?.kind === "said" && rk.phase === "pending") {
    if (addressedToMine(frame2)) noteSeen(seenPath, markOf(frame2), seen);
  } else if (rk?.kind === "body" && !rk.aside) {
    if (seen.has(markOf(frame2)) || addressedToMine(frame2)) frame2.addressed = true;
  } else if (rk && (ASK_KINDS.has(rk.kind) || rk.kind === "progress")) {
    const hit = `hit:${typeof frame2.id === "string" ? frame2.id : ""}`;
    const store = diskAsks(seenPath);
    if (store.has(hit)) frame2.addressed = true;
    else if (closesMine(store, frame2)) {
      frame2.addressed = true;
      if (typeof frame2.id === "string") store.add(hit);
    }
    noteAsk(store, frame2);
    frame2.asks_decided = true;
  }
}

// js/shared/clients.ts
var OPENCODE_CLIENT = CLIENTS.opencode;
var SURFACE_CLIENT = "export-surface";
var OWN_CLIENTS = /* @__PURE__ */ new Set([OPENCODE_CLIENT, SURFACE_CLIENT]);
var PI_CLIENT = CLIENTS.pi;
var NOTIFIED_CLIENTS = /* @__PURE__ */ new Set([PI_CLIENT, OPENCODE_CLIENT]);
var HARNESS_VERSION_ENV = envName("HARNESS_VERSION");
var SKILLS_ROOT_ENV = envName("SKILLS_ROOT");
var HOSTED_CLIENTS = /* @__PURE__ */ new Set([PI_CLIENT, OPENCODE_CLIENT]);

// js/shared/fields.ts
var FIELDS_CAPABILITY = STRUCTURED_CAPABILITY;
var FIELDS_CAPABILITIES = { experimental: { [FIELDS_CAPABILITY]: {} } };
var obj2 = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var asksFields = (initParams) => FIELDS_CAPABILITY in obj2(obj2(obj2(initParams).capabilities).experimental);
function withFieldsAsked(initParams) {
  const p = obj2(initParams);
  const caps = obj2(p.capabilities);
  const exp = obj2(caps.experimental);
  if (FIELDS_CAPABILITY in exp) return p;
  return { ...p, capabilities: { ...caps, experimental: { ...exp, [FIELDS_CAPABILITY]: {} } } };
}

// js/bridge/repeat.ts
var OWN_CALL_PREFIX = `${ID_PREFIX}bridge-call-`;
var READ_TOOLS = new Set(["look", "orient", "search", "semantic_search"].map(tool));
var SAFE_ACTIONS = {
  [tool("channel")]: /* @__PURE__ */ new Set(["list"]),
  [tool("realm")]: /* @__PURE__ */ new Set(["list"])
};
function repeatable(msg) {
  if (msg?.id === void 0 || msg?.id === null) return true;
  if (msg.method === "initialize" || msg.method === "tools/list") return true;
  if (msg.method !== "tools/call") return false;
  const name2 = String(msg.params?.name ?? "");
  if (READ_TOOLS.has(name2)) return true;
  const action = String(msg.params?.arguments?.action ?? "");
  if (ownPlaceEnd(msg, name2, action)) return true;
  return !!SAFE_ACTIONS[name2]?.has(action);
}
function ownPlaceEnd(msg, name2, action) {
  return name2 === tool("channel") && (action === "revoke" || action === "close") && String(msg.id ?? "").startsWith(OWN_CALL_PREFIX);
}

// js/bridge/toolsync.ts
import { createHash as createHash6 } from "node:crypto";
var LIST_CHANGED = "notifications/tools/list_changed";
var T = scoped(() => ({
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
  live: /* @__PURE__ */ new WeakSet()
  // …answered to the harness with the server's live list
}));
function toolsPrint(result) {
  const tools = result?.tools;
  if (!Array.isArray(tools)) return null;
  const shape = tools.map((t) => [t.name ?? "", JSON.stringify(t.inputSchema ?? null)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return createHash6("sha256").update(JSON.stringify(shape)).digest("hex");
}
function noteServedTools(result, liveFor) {
  const print = toolsPrint(result);
  if (!print) return;
  T.served = print;
  T.told = false;
  if (liveFor) T.live.add(liveFor);
}
var harnessListing = () => T.inFlight > 0;
function watchHarnessListing(msg, emit2) {
  T.inFlight++;
  const first2 = !msg.params?.cursor;
  if (first2) T.listing.add(msg);
  if (first2) T.told = false;
  return () => {
    T.inFlight--;
    if (T.heldBack.has(msg) && !T.live.has(msg))
      tell(emit2, "the server said its tool list changed, and no fresh list reached the harness");
  };
}
var isListChanged = (m) => m?.method === LIST_CHANGED && (m.id === void 0 || m.id === null);
function tell(emit2, why, again = false) {
  if (T.told && !again) return;
  T.told = true;
  log(`${why} — telling the harness (tools/list_changed)`);
  emit2({ jsonrpc: "2.0", method: LIST_CHANGED });
}
function heardListChanged(sent, emit2) {
  if (T.listing.has(sent)) return void T.heldBack.add(sent);
  tell(emit2, `the server said its tool list changed (answering ${sent?.method})`);
}
async function recheckTools(ask3, emit2) {
  if (!T.served) return;
  const fresh2 = toolsPrint((await ask3().catch(() => null))?.result);
  if (!fresh2 || fresh2 === T.served) return;
  T.served = fresh2;
  tell(emit2, "tool list changed under the re-opened session", true);
}

// js/bridge/names.ts
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { hostname } from "node:os";
import { basename as basename2, dirname as dirname3, resolve as resolve4 } from "node:path";

// js/shared/satname.ts
var NAME_MAX = 48;
var SUB_RE = /\.sub-([1-9]\d*)$/;
var satelliteName = (base, n) => base.slice(0, NAME_MAX - `.sub-${n}`.length).replace(/[-._]+$/, "") + `.sub-${n}`;
function isSatelliteOf(base, name2) {
  const m = SUB_RE.exec(name2);
  return !!m && satelliteName(base, Number(m[1])) === name2;
}

// js/shared/seat.ts
var normKarta = (k) => String(k ?? "").trim().replace(/^#/, "");

// js/bridge/names.ts
var nw = () => words(NAMES);
var normName = (n) => typeof n === "string" ? n.trim() : "";
var NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
var sanitize = (s2) => s2.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, NAME_MAX);
function nameFault(name2) {
  if (name2.length > NAME_MAX) return nw().overLimit(name2.length);
  if (!NAME_RE.test(name2)) return /[A-Z]/.test(name2) ? nw().capitals() : nw().badSigns();
  return null;
}
var PART_MIN = 3;
var CUT_ORDER = ["repo", "host", "model"];
function fitName(parts) {
  const p = { ...parts };
  const join36 = () => [p.host, p.repo, p.model].filter(Boolean).join(".").replace(/[-.]+$/, "");
  const cut = [];
  for (const k of CUT_ORDER) {
    const over = join36().length - NAME_MAX;
    if (over <= 0) break;
    const keep = Math.max(k === "model" ? 1 : PART_MIN, p[k].length - over);
    if (keep >= p[k].length) continue;
    p[k] = p[k].slice(0, keep).replace(/[-.]+$/, "");
    cut.push(k);
  }
  return {
    name: join36().slice(0, NAME_MAX).replace(/[-.]+$/, ""),
    cut
  };
}
var git = (args, cwd = sessionCwd()) => {
  try {
    return execFileSync("git", args, {
      cwd,
      timeout: 2e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
  } catch {
    return "";
  }
};
var real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
function repoName(cwd = sessionCwd()) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  const [gitDir, common] = git(["rev-parse", "--git-dir", "--git-common-dir"], cwd).split("\n");
  if (!gitDir || !common || real(resolve4(cwd, gitDir)) === real(resolve4(cwd, common)))
    return basename2(top || cwd);
  const shared = real(resolve4(cwd, common));
  if (basename2(shared) === ".git") return basename2(dirname3(shared));
  const origin2 = git(["remote", "get-url", "origin"], cwd).replace(/\/+$/, "");
  const fromOrigin = basename2(origin2.replace(/^.*:/, "/")).replace(/\.git$/, "");
  return fromOrigin || basename2(top || cwd);
}
function deriveParts(model, cwd = sessionCwd()) {
  const host = hostname().split(".")[0];
  const repo = repoName(cwd);
  const short2 = (model ?? "").trim().toLowerCase().replace(/^claude[-_]/, "");
  return { host: sanitize(host ?? ""), repo: sanitize(repo), model: sanitize(short2) };
}
var joinName = (p) => [p.host, p.repo, p.model].filter(Boolean).join(".");

// js/bridge/unnamed.ts
var SEAT_MOVES = /* @__PURE__ */ new Set(["connect", "mint", "register"]);
var HUMAN = /* @__PURE__ */ new Set(["me", "realm-owner"]);
function unnamedSeatRefusal(msg) {
  if (msg?.method !== "tools/call" || msg.params?.name !== tool("channel")) return null;
  const a = msg.params.arguments ?? {};
  const action = String(a.action);
  if (!SEAT_MOVES.has(action) || normName(a.name)) return null;
  if (envOf(envName("BRIDGE_OWNER_ROLE"))?.trim() === "1" && HUMAN.has(normKarta(a.karta)))
    return null;
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { isError: true, content: [{ type: "text", text: words(UNNAMED).refused(action) }] }
  };
}

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
  sessionToken: null
}));
function standingHeader() {
  const s2 = state.standing;
  if (!s2?.realm || s2.karta == null || !s2.name) return null;
  const h = `${s2.realm} ${s2.karta} ${s2.name}`;
  if (!/^[\x21-\x7e]+ [\x21-\x7e]+ [\x21-\x7e]+$/.test(h)) return null;
  return h;
}
var currentAccessToken = () => CFG.pat ?? loadStore().tokens?.access_token ?? null;
async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf)) !== null) {
      const raw = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const data = raw.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data) yield data;
    }
  }
}
var TLS_REFUSALS = /* @__PURE__ */ new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "ERR_TLS_CERT_ALTNAME_INVALID"
]);
var bearer = () => CFG.pat ?? loadStore().tokens?.access_token ?? null;
async function post2(msg, heard2) {
  const onMessage = (m) => isListChanged(m) ? heardListChanged(msg, emit) : heard2(m);
  const unnamed = unnamedSeatRefusal(msg);
  if (unnamed) return void onMessage(unnamed);
  const headers2 = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };
  const locale = SERVER_LOCALE[lang()];
  if (locale) headers2["accept-language"] = locale;
  const token = bearer();
  if (token) headers2.authorization = `Bearer ${token}`;
  else if (loginPublished())
    throw new UpstreamError("unauthorized (login pending)", "auth", null, UpstreamError.NOT_SENT);
  const isInit = msg?.method === "initialize";
  if (isInit && state.sessionId) {
    log(`initialize under a held session id (${state.sessionId}) — sent without it`);
    state.sessionId = null;
    state.sessionToken = null;
  }
  const sentSession = state.sessionId;
  if (sentSession) headers2["mcp-session-id"] = sentSession;
  if (state.protocolVersion) headers2["mcp-protocol-version"] = state.protocolVersion;
  const boundByHeader = isInit ? standingHeader() : null;
  if (boundByHeader) headers2["x-nks-standing"] = boundByHeader;
  const sent = isInit ? { ...msg, params: withFieldsAsked(msg.params) } : msg;
  const send2 = () => fetch(CFG.serverUrl, {
    method: "POST",
    headers: headers2,
    body: JSON.stringify(sent),
    signal: AbortSignal.timeout(CFG.timeoutMs)
  });
  let res;
  try {
    res = await send2().catch((e) => {
      if (!closedUnder(e) || !repeatable(msg)) throw e;
      log(
        `upstream connection closed under ${msg?.method} before the answer — sending it once more`
      );
      return send2();
    });
  } catch (e) {
    const err = e;
    const timedOut = err.name === "TimeoutError";
    const code = errorCode(e);
    const message = errorMessage(e);
    const tls = TLS_REFUSALS.has(code ?? "");
    const reason = timedOut ? `no answer within ${CFG.timeoutMs}ms` : (code && !message.includes(code) ? `${message} (${code})` : message) + (tls ? " — the server's certificate is not trusted on this machine (a corporate TLS inspection?); give the bridge the organisation's CA in NODE_EXTRA_CA_CERTS" : "");
    const neverLeft = !timedOut && (tls || [
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ERR_SOCKET_BAD_PORT",
      "ConnectionRefused"
    ].includes(code ?? ""));
    throw new UpstreamError(
      `upstream unreachable: ${reason}`,
      "network",
      null,
      neverLeft ? UpstreamError.NOT_SENT : UpstreamError.UNKNOWN,
      !timedOut && !tls
    );
  }
  noteServerDate(res);
  if (res.status === 401) {
    res.body?.cancel?.();
    throw new UpstreamError(
      res.headers.get("www-authenticate") || "unauthorized",
      "auth",
      token,
      UpstreamError.NOT_SENT
    );
  }
  if (res.status === 404 && sentSession) {
    res.body?.cancel?.();
    throw new UpstreamError("session expired upstream", "session", null, UpstreamError.NOT_SENT);
  }
  const sid = res.headers.get("mcp-session-id");
  if (sid) {
    if (sid !== state.sessionId && !isInit) {
      log(
        `upstream replaced the session mid-call (${state.sessionId} -> ${sid}) — this call may have gone unattributed`
      );
    }
    state.sessionId = sid;
    state.sessionToken = token;
  }
  if (res.status === 202 || res.status === 204) return;
  if (!res.ok) {
    const text3 = (await res.text().catch(() => "")).slice(0, 300);
    throw new UpstreamError(
      `upstream HTTP ${res.status}: ${text3}`,
      "http",
      null,
      res.status < 500 ? UpstreamError.NOT_SENT : UpstreamError.UNKNOWN
    );
  }
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("text/event-stream")) {
    try {
      if (!res.body) return;
      for await (const data of sseEvents(res.body)) {
        try {
          onMessage(JSON.parse(data));
        } catch {
          debug(`unparseable SSE data: ${data.slice(0, 120)}`);
        }
      }
    } catch (e) {
      throw new UpstreamError(
        `upstream stream broke mid-response: ${errorMessage(e)}`,
        "network",
        null,
        UpstreamError.UNKNOWN,
        true
      );
    }
    return;
  }
  const text2 = await res.text();
  if (!text2.trim()) return;
  try {
    onMessage(JSON.parse(text2));
  } catch {
    throw new UpstreamError(`upstream sent unparseable JSON: ${text2.slice(0, 200)}`, "http");
  }
}
var reinit = scoped(() => ({ inFlight: null }));
var reinitHooks = [];
var onReinitialized = (hook) => {
  reinitHooks.push(hook);
};
async function reinitialize() {
  if (reinit.inFlight) return reinit.inFlight;
  reinit.inFlight = (async () => {
    try {
      if (!state.initParams) throw new UpstreamError("session lost before initialize", "session");
      log("upstream session lost — re-initializing transparently");
      state.sessionId = null;
      state.sessionToken = null;
      const id = `${ID_PREFIX}bridge-reinit-${++state.reinitCounter}`;
      let result = null;
      await post2({ jsonrpc: "2.0", id, method: "initialize", params: state.initParams }, (m) => {
        if (m.id === id) result = m;
      });
      const got = result;
      if (!got || got.error) {
        throw new UpstreamError(
          `re-initialize refused: ${JSON.stringify(got?.error ?? null)}`,
          "session"
        );
      }
      if (got.result?.protocolVersion) state.protocolVersion = got.result.protocolVersion;
      if (got.result) saveServerCache({ init: got.result });
      await post2({ jsonrpc: "2.0", method: "notifications/initialized" }, () => {
      });
      log(`session re-established (${state.sessionId || "no session id"})`);
      for (const hook of reinitHooks) void hook();
    } finally {
      reinit.inFlight = null;
    }
  })();
  return reinit.inFlight;
}

// js/bridge/client.ts
var clientInfo = () => state.initParams?.clientInfo;
function harnessName() {
  const info = clientInfo();
  return typeof info?.name === "string" ? info.name : "";
}
function harnessVersion() {
  const v = HOSTED_CLIENTS.has(harnessName()) ? envOf(HARNESS_VERSION_ENV) : clientInfo()?.version;
  return typeof v === "string" && v.trim() ? v.trim() : "unknown";
}
var notifiedClient = () => NOTIFIED_CLIENTS.has(harnessName());

// js/bridge/complete.ts
function stampOrigin(frame2) {
  if (!frame2 || frame2.type !== "message") return frame2;
  return { ...frame2, origin: classifyOrigin(frame2, state.standing?.karta) };
}

// js/bridge/door.ts
import { chmodSync as chmodSync2, mkdirSync as mkdirSync8, unlinkSync as unlinkSync9, utimesSync } from "node:fs";
import { createServer as createServer3 } from "node:net";
import { dirname as dirname5 } from "node:path";

// js/shared/keyfold.ts
var rec = (v) => v && typeof v === "object" ? v : {};
var idOf = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
function superseded(frames) {
  const last = /* @__PURE__ */ new Map();
  const out7 = /* @__PURE__ */ new Set();
  frames.forEach((f, i) => {
    const r = f;
    const line = rec(r.line);
    const key2 = typeof line.key === "string" ? line.key : "";
    if (line.kind !== "progress" || !key2 || line.verdict === "bad" || addressedToMine(f)) return;
    const k = `${idOf(rec(r.room).id) || idOf(rec(r.room).seq)}|${key2}`;
    const e = Number(r.entry_id ?? line.entry_id);
    const at2 = Number.isFinite(e) ? e : i;
    const was = last.get(k);
    if (!was) return void last.set(k, { frame: f, at: at2 });
    if (at2 >= was.at) {
      out7.add(was.frame);
      last.set(k, { frame: f, at: at2 });
    } else out7.add(f);
  });
  return out7;
}

// js/shared/frame-text.ts
var W = () => words(ROOM);
var T2 = () => words(FRAME_TEXT);
var rec2 = (v) => v && typeof v === "object" ? v : {};
var idOf2 = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
var ZACHIN = 40;
function casesOf(frames) {
  const by = /* @__PURE__ */ new Map();
  for (const f of frames) {
    const key2 = caseKey(f) || idOf2(f.id) || "?";
    const got = by.get(key2);
    if (got) got.push(f);
    else by.set(key2, [f]);
  }
  return [...by.values()];
}
function caseOf(frame2) {
  const f = frame2;
  const room = rec2(f.room);
  const n = idOf2(room.seq) || idOf2(room.id);
  if (!n) return null;
  const z = typeof room.zachin === "string" ? [...room.zachin.trim()] : [];
  const zachin = z.length > ZACHIN ? z.slice(0, ZACHIN).join("") + "…" : z.join("");
  const realm = idOf2(room.realm) || idOf2(f.realm);
  return { room: n, zachin, realm };
}
var caseKey = (frame2) => caseOf(frame2)?.room ?? "";
function caseHead(frame2, withZachin) {
  const c = caseOf(frame2);
  if (!c) return "";
  const no = W().case(need(c.room));
  return withZachin && c.zachin ? `${no} «${c.zachin}»` : no;
}
function whoOf2(frame2, withPlace) {
  const p = frame2.provenance ?? {};
  const origin2 = frame2.origin ?? classifyOrigin(frame2);
  if (origin2 === "platform") return W().whoPlatform();
  if (p.via === "graph" && p.from_karta_seq == null && !p.from_standing) return W().whoGraph();
  const place = withPlace && p.from_standing ? ` (${p.from_standing})` : "";
  if (origin2 === "human") return W().whoHuman(opt(" @", p.user)) + place;
  const karta = p.from_karta_seq;
  if (karta == null) return p.from_standing ?? "";
  return (origin2 === "sibling" ? W().whoSibling : W().whoRole)(need(karta)) + place;
}
function textOf(frame2) {
  if (roomKind(frame2)?.aside) return "";
  const b = frame2.body;
  return typeof b === "string" ? b : b === void 0 ? "" : JSON.stringify(b);
}
function tail(frame2, withReply) {
  const f = frame2;
  const parts = [];
  const to = idOf2(f.in_reply_to) || idOf2(frame2.provenance?.in_reply_to);
  if (withReply && to) parts.push(W().replyTo(need(to)));
  if (frame2.stale === true) parts.push(W().stale());
  if (typeof frame2.body_read === "string" && frame2.body_read !== "history")
    parts.push(W().bodyRead(need(frame2.body_read)));
  return parts.length ? `, ${parts.join(", ")}` : "";
}
function frameToText(frame2, raw) {
  if (!frame2) return raw;
  const f = frame2;
  const origin2 = frame2.origin ?? classifyOrigin(frame2);
  const text2 = textOf(frame2);
  const c = caseOf(frame2);
  if (c) {
    if (!addressedToMine(frame2)) return caseCountLine([frame2]);
    const rk = roomKind(frame2);
    const line = rec2(f.line);
    const entry = idOf2(f.entry_id) || idOf2(line.entry_id);
    const words2 = rk ? rk.words : W().legacy(need(f.kind), typeof f.stack === "string" ? f.stack : "");
    const author = rk?.author && !words2.includes(rk.author) ? rk.author : "";
    const who = origin2 === "platform" ? "" : whoOf2(frame2, false);
    const by = [author, who].filter(Boolean).join(", ");
    const withReply = rk?.kind !== "body";
    const head = `${caseHead(frame2, true)}${entry ? ` [${entry}]` : ""} ${words2}${by ? ` — ${by}` : ""}${tail(frame2, withReply)}`;
    const lines2 = [head];
    if (text2 && !words2.includes(text2.trim())) lines2.push(text2);
    return lines2.join("\n");
  }
  const lines = [`${whoOf2(frame2, true) || "?"}${tail(frame2, true)}`];
  if (text2) lines.push(text2);
  return lines.join("\n");
}
var BATCH_TEXT = 160;
function batchLine(frame2, run, withZachin = true) {
  const f = frame2;
  const rk = roomKind(frame2);
  const head = caseHead(frame2, withZachin);
  const pre = head ? `${head} ` : "";
  if (rk?.aside) return pre + (run === void 0 ? rk.words : rk.aside.run(run));
  const line = rec2(f.line);
  const e = f.entry_id ?? line.entry_id ?? f.id;
  const entry = typeof e === "number" || typeof e === "string" ? e : "?";
  const words2 = rk?.words ?? T2().frame(typeof f.id === "string" ? f.id : "?");
  const author = rk?.author && !words2.includes(rk.author) ? ` — ${rk.author}` : "";
  const flat = [...textOf(frame2).replace(/\s+/g, " ").trim()];
  const text2 = flat.length > BATCH_TEXT ? flat.slice(0, BATCH_TEXT).join("") + "…" : flat.join("");
  const dup = !!text2 && words2.includes(text2);
  return `${pre}[${entry}] ${words2}${author}${tail(frame2, rk?.kind !== "body")}${text2 && !dup ? `: ${text2}` : ""}`;
}
function foldAsides(frames) {
  const asides = frames.map((f) => roomKind(f)?.aside ?? null);
  const out7 = [];
  let n = 0;
  asides.forEach((a, i) => {
    if (!a) {
      n = 0;
      out7.push(1);
      return;
    }
    n = (i > 0 && asides[i - 1]?.pair === a.pair ? n : 0) + (a.counts ? 1 : 0);
    out7.push(asides[i + 1]?.pair === a.pair ? null : n);
  });
  return out7;
}
function caseCountLine(frames) {
  const c = frames.length ? caseOf(frames[0]) : null;
  if (!c) return "";
  const mineN = frames.filter((f) => addressedToMine(f)).length;
  const gone = superseded(frames).size;
  const head = caseHead(frames[0], true);
  const yours = mineN ? T2().yoursBelow() : T2().noneYours();
  const n = frames.length - gone;
  return T2().count(head, n, mineN) + (gone ? T2().supersededLines(gone) : "") + yours + batchPointer(frames) + ".";
}
function caseCountLines(frames) {
  return casesOf(frames).map(caseCountLine).filter(Boolean);
}
function batchHead(frames) {
  return caseCountLines(frames).join("\n");
}
function batchPointer(frames) {
  const since = /* @__PURE__ */ new Map();
  for (const frame2 of frames) {
    const f = frame2;
    const room = f.room ?? {};
    const line = f.line ?? {};
    const n = room.seq ?? room.id;
    const e = Number(f.entry_id ?? line.entry_id);
    if (typeof n !== "number" && typeof n !== "string" || !Number.isFinite(e)) continue;
    const realm = room.realm ?? f.realm;
    const args = (typeof realm === "string" && realm ? `realm="${realm}", ` : "") + `action="history", room=${typeof n === "number" ? String(n) : JSON.stringify(n)}`;
    since.set(args, Math.min(since.get(args) ?? e, e));
  }
  return T2().inFull([...since].map(([args, e]) => T2().caseHistory(args, e - 1)).join("; "));
}

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env[envName("BRIDGE_BACKLOG_MS")]) || 1500;
var BACKLOG_KEEP = 20;
var BODY_CAP = 800;
var at = (f) => typeof f.received_at === "string" ? f.received_at : "";
var Backlog = class {
  /** Shows the first BACKLOG_KEEP, marks all as given (graph @nks/nks-dev, node #5831). */
  all = [];
  /** Direct words went out separately; the head only counts them. */
  direct = 0;
  pending = 0;
  timer = null;
  flush = null;
  /** The seat's marks: an event already in a turn is not repeated (seen.ts eventIn). */
  has;
  constructor(has) {
    this.has = has;
  }
  /** The frames the window holds (pulse.ts pending). */
  get frames() {
    return this.all;
  }
  /** An open window is not extended, only filled. */
  open(expected, emit2) {
    this.pending = Math.max(this.pending, expected);
    this.flush = emit2;
    if (this.timer) return;
    this.timer = setTimeout(() => this.close(), BACKLOG_MS).unref();
  }
  /** On releasing the standing: nothing ungiven is lost silently. */
  flushNow() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.close();
  }
  /** On the owner's stop: what waited is not given, the stopped agent is not woken (#7439). */
  drop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.flush = null;
    this.pending = 0;
    this.direct = 0;
    return this.all.splice(0).length;
  }
  /**
   * false — no window, or a direct word that goes its own way whole.
   * A repeated id already in the window is not counted.
   */
  note(frame2) {
    if (!this.timer) return false;
    if (isDirectWord(frame2)) {
      this.direct++;
      return false;
    }
    const id = typeof frame2.id === "string" ? frame2.id : "";
    if (id && this.all.some((f) => f.id === id)) return true;
    this.all.push(frame2);
    return true;
  }
  close() {
    this.timer = null;
    const all2 = this.all.splice(0);
    const { shown, kept: kept2, keys } = splitBatch(all2, BACKLOG_KEEP, this.has);
    const got = shown.sort((a, b) => at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0);
    const count = kept2.length;
    const expected = this.pending;
    const direct = this.direct;
    this.direct = 0;
    this.pending = 0;
    const emit2 = this.flush;
    this.flush = null;
    if (!got.length || !emit2) return;
    const bodies = [
      ...caseCountLines(got),
      ...got.filter((f) => addressedToMine(f)).map((f) => {
        const t = frameToText(f, JSON.stringify(f));
        return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
      })
    ];
    const head = words(BACKLOG).head(count, expected, got.length, direct);
    emit2({
      kind: "backlog",
      frames: got,
      marks: keys,
      pending: expected,
      text: `${head}

${bodies.join("\n\n")}`
    });
  }
};

// js/bridge/doorfiles.ts
import { lstatSync as lstatSync2, renameSync as renameSync7, unlinkSync as unlinkSync6, writeFileSync as writeFileSync8 } from "node:fs";
function stampOf(path) {
  try {
    const s2 = lstatSync2(path, { bigint: true });
    return `${s2.dev}:${s2.ino}:${s2.birthtimeNs}`;
  } catch {
    return null;
  }
}
function writeOwned(path, content) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync8(tmp, content, { mode: 384 });
  try {
    renameSync7(tmp, path);
  } catch (e) {
    try {
      unlinkSync6(tmp);
    } catch {
    }
    throw e;
  }
  return stampOf(path);
}
function unlinkOwned(path, stamp) {
  if (!stamp || stampOf(path) !== stamp) return;
  try {
    unlinkSync6(path);
  } catch {
  }
}
function closeServerKeeping(path, stamp, close) {
  const now2 = stampOf(path);
  if (!now2 || now2 === stamp) {
    close();
    unlinkOwned(path, stamp);
    return;
  }
  const aside = `${path}.${process.pid}.aside`;
  try {
    renameSync7(path, aside);
  } catch {
    close();
    return;
  }
  try {
    close();
  } finally {
    try {
      renameSync7(aside, path);
    } catch {
    }
  }
}

// js/bridge/fanout.ts
import { statSync as statSync2 } from "node:fs";
var lastRead = /* @__PURE__ */ new Map();
function givenIds(seenPath) {
  let stamp;
  try {
    const st = statSync2(seenPath);
    stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    lastRead.delete(seenPath);
    return /* @__PURE__ */ new Set();
  }
  const hit = lastRead.get(seenPath);
  if (hit?.stamp === stamp) return hit.ids;
  const ids = seenIds(seenPath);
  lastRead.set(seenPath, { stamp, ids });
  return ids;
}
function isDelivered(keys, seen, seenPath) {
  if (!keys.length) return false;
  if (keys.some((k) => seen.has(k))) return true;
  const given = givenIds(seenPath);
  return keys.some((k) => given.has(k));
}
var marksOf = (seen, seenPath) => (k) => isDelivered([k], seen, seenPath);
function redundantEvent(frame2, d) {
  const ev = frame2?.type === "message" ? eventKeyOf(frame2) : "";
  if (!ev || !frame2) return "";
  if (eventIn(frame2, marksOf(d.seen, d.seenPath))) return ev;
  if (d.ring.some((r) => sameCopy(r.frame, frame2))) return ev;
  if (frame2.stale === true) return d.stale.holdsCopy(frame2) ? ev : "";
  d.stale.dropCopies(frame2);
  return "";
}
function redundantCopy(frame2, d) {
  const ev = redundantEvent(frame2, d);
  const id = frame2?.id;
  if (ev)
    log(`frame ${typeof id === "string" ? id : "?"} carries ${ev} already offered — not raised`);
  return !!ev;
}

// js/bridge/humanwords.ts
var HUMAN_WORDS_KEEP = 200;
var rec3 = (v) => v && typeof v === "object" ? v : {};
var idOf3 = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
var entryOf = (frame2) => {
  const f = rec3(frame2);
  return idOf3(rec3(f.line).entry_id ?? f.entry_id);
};
var caseOf2 = (frame2) => {
  const room = rec3(rec3(frame2).room);
  return idOf3(room.id) || idOf3(room.seq);
};
var wordKey = (frame2, entry) => entry ? numberedKey(frame2, `${caseOf2(frame2)}|${entry}`) : "";
var isWordOf = (held2, body, word3) => !!word3 && wordKey(held2, entryOf(held2)) === wordKey(body, word3);
var HumanWords = class {
  words = /* @__PURE__ */ new Set();
  /** A human word in flight — by its own entry. */
  remember(said2) {
    const key2 = wordKey(said2, entryOf(said2));
    if (!key2) return;
    this.words.add(key2);
    const oldest = this.words.values().next();
    if (this.words.size > HUMAN_WORDS_KEEP && !oldest.done) this.words.delete(oldest.value);
  }
  /** true — the body carries a human word in flight (word — its entry in the body's case); forgotten. */
  forget(body, word3) {
    const key2 = wordKey(body, word3);
    return !!key2 && this.words.delete(key2);
  }
};

// js/bridge/roomstack.ts
var ROOM_BATCH_MS = Number(process.env[envName("BRIDGE_ROOM_BATCH_MS")]) || 6e4;
var ROOM_BATCH_CAP = 20;
var rec4 = (v) => v && typeof v === "object" ? v : {};
var RoomBatch = class {
  held = [];
  timer = null;
  emit = null;
  add(raw, frame2, emit2) {
    this.emit = emit2;
    this.held.push({ raw, frame: frame2 });
    if (this.held.length >= ROOM_BATCH_CAP) return this.flushNow();
    this.timer ??= setTimeout(() => this.flushNow(), ROOM_BATCH_MS).unref();
  }
  /** Human words in flight: their body is the human's word, not a batch frame. */
  humanWords = new HumanWords();
  /** Take a word in flight out of the pending batch once its body came. */
  dropWord(body, word3, dropped) {
    for (let i = this.held.length - 1; i >= 0; i--) {
      if (!isWordOf(this.held[i].frame, body, word3)) continue;
      dropped(this.held[i].frame);
      this.held.splice(i, 1);
    }
    if (!this.held.length && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  /** The frames the batch holds (pulse.ts pending). */
  get frames() {
    return this.held.map((h) => h.frame);
  }
  /** A batched frame is not handed out separately by the ring (door.ts). */
  holds(frame2) {
    return !!frame2 && this.held.some((h) => h.frame === frame2);
  }
  /** Flush now; `carrier` — the interrupting frame that follows as text (seen.ts splitBatch). */
  flushNow(carrier) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const got = this.held.splice(0);
    const emit2 = this.emit;
    if (!got.length || !emit2) return;
    const unit = [...got.map((h) => h.frame), ...carrier ? [carrier] : []];
    const kept2 = new Set(splitBatch(unit, Infinity, this.has).kept);
    const out7 = got.filter((h) => kept2.has(h.frame));
    if (out7.length) emitBatch(out7, emit2);
  }
  /** On the owner's stop: the pending batch is not given (#7439). */
  drop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit = null;
    return this.held.splice(0).length;
  }
  /** The seat's marks: an event already in the turn is not repeated (seen.ts eventIn). */
  has;
  constructor(has) {
    this.has = has;
  }
};
function emitBatch(got, emit2) {
  const of = got.length;
  const frames = got.map((h) => h.frame);
  const fold = foldAsides(frames);
  emit2({ kind: "note", text: batchHead(frames), batch: { at: 0, of } });
  got.forEach(
    (h, i) => emit2({
      kind: "frame",
      raw: h.raw,
      frame: h.frame,
      batch: {
        at: i + 1,
        of,
        ...fold[i] === null ? { folded: true } : roomKind(h.frame)?.aside ? { fold: fold[i] ?? 1 } : {}
      }
    })
  );
}
function countOnly(frame2) {
  return frame2?.type === "message" && !!byKind(frame2) && !addressedToMine(frame2);
}
function noteRoomKind(frame2) {
  const rk = roomKind(frame2);
  if (rk && !rk.known)
    log(`room frame ${String(frame2.id ?? "?")}: ${rk.words} — batched, not interrupting`);
}
function batchForWatchdogs(d, raw, frame2, emit2) {
  const rk = roomKind(frame2);
  const f = rec4(frame2);
  let human = (frame2.origin ?? classifyOrigin(frame2)) === "human" && !askFromPerson(frame2);
  if (rk?.kind === "said" && rk.phase === "pending" && human)
    d.roomBatch.humanWords.remember(frame2);
  if (rk?.kind === "body") {
    const word3 = idOf3(rec4(f.line).refers_to ?? f.in_reply_to);
    if (d.roomBatch.humanWords.forget(frame2, word3) && rk.phase !== "aborted") {
      human = true;
      frame2.origin = "human";
      d.roomBatch.dropWord(frame2, word3, (said2) => {
        for (const k of deliveryKeys(said2)) noteSeen(d.seenPath, k, d.seen);
      });
    }
  }
  if ((!human || rk?.phase || rk?.aside) && byKind(frame2) && (!addressedToMine(frame2) || stackOf(frame2) === "batch")) {
    d.roomBatch.add(raw, frame2, emit2);
    return true;
  }
  d.roomBatch.flushNow(frame2);
  return false;
}

// js/shared/stalebatch.ts
var STALE_BURST_KEEP = 20;
var BODY_CAP2 = 800;
function staleBatch(all2, has) {
  const { shown: frames, kept: kept2, keys } = splitBatch(all2, STALE_BURST_KEEP, has);
  const count = kept2.length;
  if (!count) return { text: "", keys };
  const bodies = [
    ...caseCountLines(frames),
    ...frames.filter((f) => addressedToMine(f)).map((f) => {
      const t = frameToText(f, JSON.stringify(f));
      return [...t].length > BODY_CAP2 ? [...t].slice(0, BODY_CAP2).join("") + "…" : t;
    })
  ];
  const head = words(STALE).head(count, frames.length);
  return { text: `${head}

${bodies.join("\n\n")}`, keys };
}

// js/bridge/stale.ts
var STALE_BURST_MS = 1500;
var StaleBurst = class {
  /** Every frame of the window; the batch shows the first STALE_BURST_KEEP, all are marked given (#5831). */
  burst = [];
  timer = null;
  /** The seat's marks: an event already in play is not repeated (seen.ts eventIn). */
  has;
  constructor(has) {
    this.has = has;
  }
  /** Add a stale frame; when the window ends `flush` gets one event. A repeated id is not a second frame. */
  note(frame2, flush) {
    const id = typeof frame2.id === "string" ? frame2.id : "";
    if (!id || !this.burst.some((f) => f.id === id)) this.burst.push(frame2);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const all2 = this.burst.splice(0);
      if (!all2.length) return;
      const { text: text2, keys } = staleBatch(all2, this.has);
      if (!text2) return;
      flush({ kind: "stale", frames: all2, marks: keys, text: text2 });
    }, STALE_BURST_MS).unref();
  }
  /** The frames the window holds (pulse.ts pending). */
  get frames() {
    return this.burst;
  }
  /** Whether the pending batch holds a copy of this event of the same kind (fanout.ts). */
  holdsCopy(frame2) {
    return this.burst.some((f) => sameCopy(f, frame2));
  }
  /** Take stale copies of the same kind out of the batch — the live one wakes, the batch does not (fanout.ts). */
  dropCopies(frame2) {
    for (let i = this.burst.length - 1; i >= 0; i--)
      if (sameCopy(this.burst[i], frame2)) this.burst.splice(i, 1);
  }
  /** Forget the accumulated batch when the standing is released. */
  drop() {
    this.burst.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
};

// js/bridge/sweep.ts
import { existsSync, readdirSync as readdirSync3, readFileSync as readFileSync12, statSync as statSync3, unlinkSync as unlinkSync8 } from "node:fs";
import { connect as connectLocal } from "node:net";
import { basename as basename3, join as join10 } from "node:path";

// js/bridge/holdrecord.ts
import { mkdirSync as mkdirSync7, readdirSync as readdirSync2, readFileSync as readFileSync11, unlinkSync as unlinkSync7, writeFileSync as writeFileSync9 } from "node:fs";
import { dirname as dirname4, join as join9 } from "node:path";
var holdFilePathFor = (key2) => holdFilePathOf(CFG.authDir, key2);
function keyOf(realm, karta, name2) {
  return `${name2 || "_"}--${karta}--${realm}`.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;
var H = scoped(() => ({ session: null }));
function noteHarnessSession(id) {
  if (id) H.session = id;
}
var sessionOfBridge = () => H.session;
function onDisk(key2) {
  try {
    return JSON.parse(readFileSync11(holdFilePathFor(key2), "utf8"));
  } catch {
    return null;
  }
}
var B = scoped(() => /* @__PURE__ */ new Map());
function noteSeatBase(key2, base) {
  B.set(key2, base);
  if (CFG.satellite) return;
  try {
    const path = baseFilePathOf(CFG.authDir, key2);
    mkdirSync7(dirname4(path), { recursive: true, mode: 448 });
    writeFileSync9(path, base + "\n", { mode: 384 });
  } catch (e) {
    log(`seat base not written: ${e.message}`);
  }
}
var baseOnDisk = (key2) => {
  try {
    return readFileSync11(baseFilePathOf(CFG.authDir, key2), "utf8").trim() || null;
  } catch {
    return null;
  }
};
function seatBaseOf(key2) {
  const known2 = B.get(key2);
  if (known2) return known2;
  const base = readHoldRecord(key2, true)?.base ?? baseOnDisk(key2);
  if (base) B.set(key2, base);
  return base ?? null;
}
function writeHoldRecord(key2, rec5, paused = false, at2 = Date.now()) {
  if (CFG.satellite && !paused) return;
  try {
    const was = onDisk(key2);
    const session = H.session ?? rec5.session ?? (was?.url === rec5.url ? was.session : void 0);
    const left2 = rec5.left ?? was?.left === true;
    writeOwned(
      holdFilePathFor(key2),
      JSON.stringify({
        ...rec5,
        session: session ?? void 0,
        left: left2 || void 0,
        provisional: rec5.provisional ?? (was?.url === rec5.url && was.session === session ? was.provisional : void 0),
        base: B.get(key2) ?? rec5.base ?? was?.base ?? baseOnDisk(key2) ?? void 0,
        at: at2
      }) + "\n"
    );
  } catch (e) {
    log(`hold record not written: ${e.message}`);
  }
}
function restoreHoldRecord(key2, rec5) {
  if (CFG.satellite) return;
  try {
    writeOwned(holdFilePathFor(key2), JSON.stringify(rec5) + "\n");
  } catch (e) {
    log(`hold record not restored: ${e.message}`);
  }
}
function markLeft(key2, on) {
  const r = readHoldRecord(key2);
  if (r && r.left === true !== on) writeHoldRecord(key2, { ...r, left: on });
}
function readHoldRecord(key2, anyAge = false) {
  try {
    const r = JSON.parse(readFileSync11(holdFilePathFor(key2), "utf8"));
    if (!r || typeof r.url !== "string" || !r.realm || r.karta == null) return null;
    if (anyAge) return r;
    if (typeof r.at !== "number" || Date.now() - r.at > HOLD_RECORD_MAX_AGE_MS) {
      dropHoldRecord(key2);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}
var holdRecordsNamed = (name2) => holdRecordsWhere((r) => r.name === name2);
function holdRecordsWhere(keep) {
  const dir2 = dirname4(holdFilePathFor("_"));
  try {
    return readdirSync2(dir2).filter((f) => f.endsWith(".hold")).map((f) => {
      try {
        return JSON.parse(readFileSync11(join9(dir2, f), "utf8"));
      } catch {
        return null;
      }
    }).filter((r) => !!r && r.karta != null && keep(r));
  } catch {
    return [];
  }
}
function dropOwnHoldRecord(key2, url) {
  const r = readHoldRecord(key2, true);
  if (!r || !url || r.url === url) dropHoldRecord(key2);
}
function dropHoldRecord(key2) {
  try {
    unlinkSync7(holdFilePathFor(key2));
  } catch {
  }
}

// js/bridge/sweep.ts
function localSocketAlive(sock) {
  return new Promise((resolve11) => {
    if (process.platform !== "win32" && !existsSync(sock)) return resolve11(false);
    const probe = connectLocal(sock);
    const done = (v) => {
      probe.destroy();
      resolve11(v);
    };
    probe.once("connect", () => done(true));
    probe.once("error", () => done(false));
    probe.setTimeout(1e3, () => done(false));
  });
}
var SEEN_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
function sweepStale(authDir, mine) {
  const dir2 = standingsDirOf(authDir);
  if (!existsSync(dir2)) return;
  const mineHash = basename3(seenFilePathOf(authDir, mine), ".seen");
  for (const f of readdirSync3(dir2).filter((x) => x.endsWith(".seen"))) {
    const p = join10(dir2, f);
    const [keyHash, serverHash] = f.split(".");
    if (keyHash === mineHash || existsSync(join10(dir2, `${keyHash}.key`))) continue;
    try {
      if (serverHash === "seen" || Date.now() - statSync3(p).mtimeMs > SEEN_FILE_MAX_AGE_MS)
        unlinkSync8(p);
    } catch {
    }
  }
  for (const f of readdirSync3(dir2).filter((x) => x.endsWith(".asks"))) {
    const keyHash = f.split(".")[0];
    if (keyHash === mineHash || existsSync(join10(dir2, `${keyHash}.key`))) continue;
    if (existsSync(join10(dir2, `${basename3(f, ".asks")}.seen`))) continue;
    try {
      unlinkSync8(join10(dir2, f));
    } catch {
    }
  }
  for (const f of readdirSync3(dir2).filter((x) => x.endsWith(".hold"))) {
    if (existsSync(join10(dir2, `${basename3(f, ".hold")}.key`))) continue;
    try {
      const rec5 = JSON.parse(readFileSync12(join10(dir2, f), "utf8"));
      if (typeof rec5.at !== "number" || Date.now() - rec5.at > HOLD_RECORD_MAX_AGE_MS)
        unlinkSync8(join10(dir2, f));
    } catch {
      try {
        unlinkSync8(join10(dir2, f));
      } catch {
      }
    }
  }
  for (const f of readdirSync3(dir2).filter((x) => x.endsWith(".spool"))) {
    try {
      if (Date.now() - statSync3(join10(dir2, f)).mtimeMs > HOLD_RECORD_MAX_AGE_MS)
        unlinkSync8(join10(dir2, f));
    } catch {
    }
  }
  if (process.platform === "win32") return;
  for (const f of readdirSync3(dir2).filter((x) => x.endsWith(".key"))) {
    const keyFile = join10(dir2, f);
    let key2;
    try {
      key2 = readFileSync12(keyFile, "utf8").trim();
    } catch {
      continue;
    }
    if (!key2 || key2 === mine) continue;
    const sock = socketPathOf(authDir, key2);
    const drop = () => {
      for (const p of [keyFile, sock, seenFilePathOf(authDir, key2)]) {
        try {
          unlinkSync8(p);
        } catch {
        }
      }
    };
    if (!existsSync(sock)) {
      drop();
      continue;
    }
    const probe = connectLocal(sock);
    probe.once("connect", () => probe.destroy());
    probe.once("error", drop);
    probe.setTimeout(1e3, () => probe.destroy());
  }
}

// js/bridge/door.ts
var RING = 20;
var ENV_KEY = "env";
var Door = class {
  key;
  clients = /* @__PURE__ */ new Set();
  ring = [];
  /** Delivered frames — the same memory the exit watchdog reads (../shared/seen.ts). */
  seen;
  /** Since when no local client listens; null — someone listens. */
  idleAt = Date.now();
  /** The bridge's memory plus the .seen file written by whoever delivered the frame. */
  marks = (k) => marksOf(this.seen, this.seenPath)(k);
  /** Stale and wake batches are per seat (#5838). */
  stale = new StaleBurst(this.marks);
  backlog = new Backlog(this.marks);
  /** Room batch for watchdogs, not notification clients (roomstack.ts, #5851). */
  roomBatch = new RoomBatch(this.marks);
  /** Platform seat id (hello standings[].standing_id): a frame finds its door by it. */
  standingId = null;
  /** Seat address @handle:name — from hello, or derived from the main seat's handle for a seat beside. */
  address = null;
  /** address derived by the bridge, not named by hello. */
  addressDerived = false;
  /** Why the local socket did not come up; null — up or still coming up. */
  listenError = null;
  server = null;
  freshen = null;
  /** Stamps of the .key and .sock this door laid (doorfiles.ts): close removes only those. */
  stamps = { key: null, sock: null };
  hooks;
  // Captured from the opening session's scope: the door may be closed from another scope (daemon exit).
  authDir;
  serverUrl;
  constructor(key2, hooks) {
    this.key = key2;
    this.hooks = {
      onAttach: bindScope(hooks.onAttach),
      lateEvent: bindScope(hooks.lateEvent),
      onError: bindScope(hooks.onError)
    };
    this.authDir = CFG.authDir;
    this.serverUrl = CFG.serverUrl;
    this.seen = seenIds(this.seenPath);
  }
  /** A seat keeps its delivered memory per server beyond the bridge; the "env" standing's memory dies with it. */
  get persistent() {
    return this.key !== ENV_KEY;
  }
  get seenPath() {
    return seenFilePathOf(this.authDir, this.key, this.persistent ? this.serverUrl : "");
  }
  get socketPath() {
    return socketPathOf(this.authDir, this.key);
  }
  /** The socket at the path is this door's, not one a successor laid over it. */
  get ownsSocket() {
    return !!this.stamps.sock && stampOf(this.socketPath) === this.stamps.sock;
  }
  push(raw, frame2) {
    this.ring.push({ raw, frame: frame2 });
    if (this.ring.length > RING) this.ring.shift();
  }
  broadcast(ev) {
    const line = JSON.stringify(ev) + "\n";
    for (const c of this.clients) {
      try {
        c.write(line);
      } catch {
        this.clients.delete(c);
      }
    }
  }
  open() {
    const path = this.socketPath;
    const key2 = this.key;
    const authDir = this.authDir;
    mkdirSync8(standingsDirOf(authDir), { recursive: true, mode: 448 });
    if (process.platform !== "win32" && dirname5(path) === shortSocketDir()) {
      const bad = privateDirProblem(dirname5(path));
      if (bad) {
        this.listenError = bad;
        this.hooks.onError(words(DOOR).privateDir(bad));
        return;
      }
    }
    sweepStale(authDir, key2);
    this.stamps = { key: writeOwned(keyFilePathOf(authDir, key2), key2 + "\n"), sock: null };
    if (process.platform !== "win32") {
      try {
        unlinkSync9(path);
      } catch {
      }
    }
    const gone = (sock) => {
      this.clients.delete(sock);
      if (this.clients.size === 0) this.idleAt = Date.now();
    };
    const srv = createServer3(
      bindScope((sock) => {
        this.clients.add(sock);
        this.idleAt = null;
        sock.on("close", () => gone(sock));
        sock.on("error", () => gone(sock));
        this.hooks.onAttach();
        const folded = foldedTacts(this.ring.map((r) => r.frame));
        for (const f of folded) if (f.id) noteSeen(this.seenPath, String(f.id), this.seen);
        const waiting2 = this.ring.filter(
          ({ frame: frame2 }) => frame2?.type !== "message" || !folded.has(frame2) && !this.marks(String(frame2.id ?? "")) && !this.roomBatch.holds(frame2)
        );
        const msgs = waiting2.flatMap(({ frame: frame2 }) => frame2?.type === "message" ? [frame2] : []);
        const kept2 = new Set(splitBatch(msgs, Infinity, this.marks).kept);
        const backlog = waiting2.filter(({ frame: frame2 }) => frame2?.type !== "message" || kept2.has(frame2));
        sock.write(
          JSON.stringify({
            kind: "attached",
            key: key2,
            buffered: backlog.length,
            seen: this.seenPath
          }) + "\n"
        );
        const counts = backlog.filter(
          (h) => countOnly(h.frame)
        );
        const put = (ev) => void sock.write(JSON.stringify(ev) + "\n");
        if (counts.length) emitBatch(counts, put);
        for (const { raw, frame: frame2 } of backlog) {
          if (!countOnly(frame2)) put({ kind: "frame", raw, frame: frame2 });
        }
        const late = this.hooks.lateEvent();
        if (late) sock.write(JSON.stringify(late) + "\n");
      })
    );
    srv.on("error", (e) => {
      this.listenError = e.message;
      this.hooks.onError(words(DOOR).listenFailed(e.message));
    });
    srv.listen(
      path,
      bindScope(() => {
        if (process.platform !== "win32") {
          try {
            chmodSync2(path, 384);
          } catch {
          }
        }
        this.stamps.sock = stampOf(path);
        log(`standing socket held; local listeners attach at ${path}`);
        if (dirname5(path) === shortSocketDir()) {
          const touch = () => {
            const now2 = /* @__PURE__ */ new Date();
            const mine = stampOf(path) === this.stamps.sock;
            for (const p of mine ? [dirname5(path), path] : [dirname5(path)])
              try {
                utimesSync(p, now2, now2);
              } catch {
              }
          };
          this.freshen = setInterval(touch, 6 * 36e5);
          this.freshen.unref?.();
        }
      })
    );
    this.server = srv;
  }
  flushBatches() {
    this.backlog.flushNow();
    this.roomBatch.flushNow();
  }
  /** The owner's stop (stophold.ts): unsent batches are dropped, not flushed; how many frames. */
  dropBatches() {
    return this.backlog.drop() + this.roomBatch.drop();
  }
  /**
   * Close the door: clients, server, key and socket files. Idempotent. A seat's
   * delivered memory stays: a new bridge gets the same queue again (#5831); sweep.ts
   * removes old files by age.
   */
  close() {
    this.flushBatches();
    this.stale.drop();
    for (const c of this.clients) {
      try {
        c.end();
      } catch {
      }
    }
    this.clients.clear();
    if (this.freshen) clearInterval(this.freshen);
    const srv = this.server;
    this.server = null;
    const shut = () => {
      try {
        srv?.close();
      } catch {
      }
    };
    if (process.platform === "win32" || !this.stamps.sock) shut();
    else closeServerKeeping(this.socketPath, this.stamps.sock, shut);
    unlinkOwned(keyFilePathOf(this.authDir, this.key), this.stamps.key);
    this.stamps = { key: null, sock: null };
    if (!this.persistent) {
      try {
        unlinkSync9(this.seenPath);
      } catch {
      }
    }
    this.ring.length = 0;
    this.idleAt = null;
  }
};

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
function noteTaken(a) {
  if (!H2.taken || a.action !== "connect" && a.action !== "register") return;
  const seat2 = {
    realm: String(a.realm ?? ""),
    karta: String(a.karta ?? ""),
    name: String(a.name ?? "")
  };
  if (!H2.taken.some((s2) => s2.realm === seat2.realm && s2.karta === seat2.karta && s2.name === seat2.name))
    H2.taken.push(seat2);
}
var stoppedSince = (before, key2) => H2.stopped.n !== before && H2.stopped.key === key2 ? H2.stopped.text : null;
var stopsNow = () => H2.stopped.n;
var stoppedDuring = (before) => H2.stopped.n !== before ? H2.stopped.text : null;
var stoppedInMove = () => H2.moveSince !== null && stoppedDuring(H2.moveSince) !== null;
var E = {
  next: null,
  stop: null,
  order: null,
  pulse: null
};
function whenPulsed(fn) {
  E.pulse = fn;
}
function whenOrdered(fn) {
  E.order = fn;
}
function whenEvicted(fn) {
  E.next = fn;
}
function whenStopped(fn) {
  E.stop = fn;
}
function noteResuming(delta) {
  H2.resuming += delta;
}
async function withSpoolHeld(fn) {
  H2.spoolHeld++;
  try {
    return await fn();
  } finally {
    if (--H2.spoolHeld === 0) {
      const later2 = [...H2.spoolLater ? [H2.spoolLater] : [], ...H2.liveLater];
      Object.assign(H2, { spoolLater: null, liveLater: [] });
      for (const fn2 of later2) fn2();
    }
  }
}
function drainWhenFree(drain) {
  if (H2.spoolHeld > 0) H2.spoolLater = drain;
  else drain();
}
function liveWhenFree(judge) {
  if (H2.spoolHeld === 0) return false;
  H2.liveLater.push(judge);
  return true;
}
function setRevokingOwn(v) {
  H2.revokingOwn = v;
}
function setClosingOwn(v) {
  H2.closingOwn = v;
}
function setRevokingBeside(key2, v) {
  if (v) H2.revokingBeside.add(key2);
  else H2.revokingBeside.delete(key2);
}
var handingOver = null;
function beginHandover(why) {
  handingOver = why;
}
function beginSessionHandover(why) {
  H2.handingOver = why;
}
var handoverReason = () => handingOver ?? H2.handingOver;
var handoverUnderway = () => handoverReason() !== null;

// js/bridge/realms.ts
var aliases = scoped(() => /* @__PURE__ */ new Map());
var R = scoped(() => ({ listing: null }));
var CANON_RE = /@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;
var trimmed = (r) => String(r ?? "").trim();
function canonRealm(r) {
  const t = trimmed(r);
  if (t.startsWith("@")) return t;
  return aliases.get(t) ?? t;
}
var resolvedRealm = (r) => canonRealm(r).startsWith("@");
function realmRelation(a, b) {
  const x = trimmed(a);
  const y = trimmed(b);
  if (x && x === y) return "same";
  if (!resolvedRealm(x) || !resolvedRealm(y)) return "unknown";
  return canonRealm(x) === canonRealm(y) ? "same" : "other";
}
var sameRealm = (a, b) => realmRelation(a, b) === "same";
var otherRealm = (a, b) => !!trimmed(a) && !!trimmed(b) && realmRelation(a, b) === "other";
var unknownRealm = (a, b) => !!trimmed(a) && !!trimmed(b) && realmRelation(a, b) === "unknown";
var unresolvedWord = (realm, held2) => words(REALMS).unresolved(trimmed(realm), held2.join(", "));
function learnRealm(alias, canonical) {
  const t = trimmed(alias);
  if (t && !t.startsWith("@") && CANON_RE.test(canonical)) aliases.set(t, canonical);
}
var LIST_LINE_RE = /^ {4}(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) {2}(r\d+) {2}.* · /;
function learnRealmList(text2) {
  const slugs = /* @__PURE__ */ new Map();
  for (const line of text2.split("\n")) {
    const m = LIST_LINE_RE.exec(line);
    if (!m) continue;
    const [, c, short2] = m;
    learnRealm(short2, c);
    const slug = c.replace(/^@[^/]+\//, "");
    slugs.set(slug, [.../* @__PURE__ */ new Set([...slugs.get(slug) ?? [], c])]);
  }
  for (const [slug, cs] of slugs) if (cs.length === 1) learnRealm(slug, cs[0]);
}
async function resolveRealms(names2, list3) {
  const open = names2.map(trimmed).filter((t) => t && !resolvedRealm(t));
  if (!open.length) return;
  R.listing ??= list3().then(
    (text2) => {
      if (text2) learnRealmList(text2);
    },
    () => {
    }
  ).finally(() => {
    R.listing = null;
  });
  await R.listing;
}

// js/bridge/places.ts
var extras = scoped(() => /* @__PURE__ */ new Map());
var keyOfPlace = (s2) => keyOf(s2.realm, s2.karta, s2.name ?? "");
var extraPlaces = () => [...extras.values()];
var extraIn = (realm) => extraPlaces().find((p) => sameRealm(p.standing.realm, realm));
function extraOf(realm, karta, name2) {
  const p = extraIn(realm);
  return p && String(p.standing.karta) === normKarta(karta) && (p.standing.name ?? "") === normName(name2) ? p : void 0;
}
function rememberPlace(s2) {
  state.places = state.places.filter((p) => !sameRealm(p.realm, s2.realm));
  state.places.push(s2);
}
function writeRecord(p, ch, status) {
  const s2 = p.standing;
  writeHoldRecord(p.door.key, {
    realm: s2.realm,
    karta: s2.karta,
    name: s2.name ?? "",
    url: ch.url,
    statusUrl: ch.statusUrl,
    status: status ?? readHoldRecord(p.door.key)?.status,
    cwd: ch.cwd ?? readHoldRecord(p.door.key)?.cwd,
    client: harnessName(),
    key: p.door.key
  });
}
function deriveAddress(p, primaryAddress) {
  const handle = primaryAddress?.match(/^(.*):/)?.[1];
  if (!handle || !p.standing.name) return;
  p.door.address = `${handle}:${p.standing.name}`;
  p.door.addressDerived = true;
}
function addExtra(s2, ch, hooks, primaryAddress = null) {
  const key2 = keyOfPlace(s2);
  const have = extras.get(key2);
  if (have) return key2;
  for (const p of extraPlaces())
    if (sameRealm(p.standing.realm, s2.realm))
      dropExtra(p.door.key, words(PLACES).anotherSeat(), true);
  const door = new Door(key2, hooks);
  const place = { standing: s2, door };
  deriveAddress(place, primaryAddress);
  door.open();
  extras.set(key2, place);
  writeRecord(place, ch);
  standingLog(`held ${key2} beside the channel`);
  besideWord({
    kind: "beside",
    key: key2,
    place: { realm: s2.realm, karta: String(s2.karta), name: s2.name ?? "" }
  });
  return key2;
}
var besideWord = (data) => emit({
  jsonrpc: "2.0",
  method: "notifications/message",
  params: { level: "info", logger: LOGGERS.channel, data }
});
function repointExtras(ch) {
  for (const p of extraPlaces()) writeRecord(p, ch);
}
function rememberExtraStatus(key2, ch, text2) {
  const p = extras.get(key2);
  if (p) writeRecord(p, ch, text2 || "");
}
function dropExtra(key2, reason, forget, as) {
  const p = extras.get(key2);
  if (!p) return;
  extras.delete(key2);
  const handover = !forget && !as ? handoverReason() : null;
  if (handover) {
    p.door.broadcast({ kind: "handover", key: key2, text: handover });
    p.door.close();
    return standingLog(`handed over ${key2} beside the channel: ${handover}`);
  }
  if (as === "own") {
    p.door.flushBatches();
    p.door.broadcast({ kind: "released", key: key2, text: reason, own: true });
  } else if (as === "beside")
    p.door.broadcast({ kind: "released", key: key2, text: reason, beside: true });
  p.door.close();
  if (forget) {
    dropHoldRecord(key2);
    state.places = state.places.filter((s2) => keyOfPlace(s2) !== key2);
  }
  standingLog(`released ${key2}: ${reason}${forget ? " (record dropped)" : ""}`);
  if (!handoverReason()) besideWord({ kind: "beside-gone", key: key2, text: reason });
}
function dropAllExtras(reason, forget, own = false) {
  for (const k of [...extras.keys()]) dropExtra(k, reason, forget, own ? "own" : void 0);
  if (forget) state.places = [];
}
var nameOfAddress = (a) => typeof a === "string" ? a.replace(/^.*:/, "") : "";
var all = (primary) => [...primary ? [primary] : [], ...extraPlaces()];
var unresolved = (realm) => !canonRealm(realm).startsWith("@");
function learnFromHello(hello, primary) {
  const listed = Array.isArray(hello?.standings) ? hello.standings : [];
  for (const p of all(primary)) {
    const same2 = listed.filter(
      (e2) => nameOfAddress(e2.standing) === (p.standing.name ?? "") && (e2.karta_seq == null || String(e2.karta_seq) === String(p.standing.karta))
    );
    const mine = same2.filter((e2) => sameRealm(e2.realm, p.standing.realm));
    const e = mine.length === 1 ? mine[0] : unresolved(p.standing.realm) && same2.length === 1 ? same2[0] : null;
    if (!e) continue;
    if (e.realm && unresolved(p.standing.realm)) learnRealm(p.standing.realm, e.realm);
    if (typeof e.standing_id === "string" && e.standing_id) p.door.standingId = e.standing_id;
    if (typeof e.standing === "string" && e.standing) {
      p.door.address = e.standing;
      p.door.addressDerived = false;
    }
  }
}
function fitsOf(frame2, places) {
  const id = typeof frame2.to_standing_id === "string" ? frame2.to_standing_id : "";
  const byId = id ? places.find((p) => p.door.standingId === id) : void 0;
  if (byId) return [byId];
  const to = nameOfAddress(frame2.to_standing);
  if (!id && !to && frame2.realm == null && frame2.karta_seq == null) return null;
  const fits = places.filter(
    (p) => (frame2.realm == null || sameRealm(frame2.realm, p.standing.realm)) && (!to || to === (p.standing.name ?? "")) && (frame2.karta_seq == null || String(frame2.karta_seq) === String(p.standing.karta))
  );
  if (fits.length === 1 && id && !fits[0].door.standingId) fits[0].door.standingId = id;
  return fits;
}
function strayOf(frame2, primary) {
  if (frame2?.type !== "message" || fitsOf(frame2, all(primary))?.length !== 0) return null;
  const back = state.places.find((s2) => frame2.realm != null && sameRealm(s2.realm, frame2.realm));
  return back ? keyOfPlace(back) : `${String(frame2.to_standing ?? "—")}, ${words(PLACES).graph()} ${String(frame2.realm ?? "—")}`;
}
function routeFrame(frame2, primary) {
  if (!frame2 || !extras.size) return { door: primary.door };
  const fits = fitsOf(frame2, all(primary));
  if (!fits) return { door: primary.door };
  if (fits.length === 1) return { door: fits[0].door };
  const id = typeof frame2.to_standing_id === "string" ? frame2.to_standing_id : "";
  return {
    door: primary.door,
    note: words(PLACES).unmatched(
      String(frame2.id ?? "?"),
      id || "—",
      frame2.to_standing ?? "—",
      frame2.realm ?? "—",
      fits.length > 0,
      primary.door.key
    )
  };
}

// js/bridge/spool.ts
import { appendFileSync as appendFileSync4, mkdirSync as mkdirSync9, readFileSync as readFileSync13, unlinkSync as unlinkSync10 } from "node:fs";
import { dirname as dirname6 } from "node:path";
var HANDOFF_MS = Number(process.env[envName("BRIDGE_DAEMON_HANDOFF_MS")]) || 12e3;
var DRAIN_MS = HANDOFF_MS + 5e3;
var DRAIN_TICK_MS = 200;
var SPOOL_LIVE_MS = DRAIN_MS;
function append(path, entry) {
  try {
    appendFileSync4(path, JSON.stringify(entry) + "\n", { mode: 384 });
  } catch (e) {
    const id = entry.frame === void 0 ? "" : `, frame ${String(parseFrame(entry.frame)?.id ?? "?")}`;
    log(`handover spool not written (${path}${id}): ${e.message}`);
  }
}
function openSpool(path) {
  try {
    mkdirSync9(dirname6(path), { recursive: true, mode: 448 });
  } catch {
  }
  append(path, { open: Date.now() });
}
var spoolFrame = (path, raw) => append(path, { frame: raw, at: Date.now() });
var closeSpool = (path) => append(path, { done: Date.now() });
var draining = /* @__PURE__ */ new Set();
function parseFrame(raw) {
  try {
    const f = JSON.parse(raw);
    return f && typeof f === "object" ? f : null;
  } catch {
    return null;
  }
}
function entries(path) {
  let text2;
  try {
    text2 = readFileSync13(path, "utf8");
  } catch {
    return null;
  }
  return text2.slice(0, text2.lastIndexOf("\n") + 1).split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return {};
    }
  });
}
function aged(raw, at2) {
  const frame2 = parseFrame(raw);
  if (Date.now() - at2 <= SPOOL_LIVE_MS || frame2?.type !== "message") return [raw, frame2];
  const stale = { ...frame2, stale: true };
  return [JSON.stringify(stale), stale];
}
function drainSpool(path, feed) {
  if (draining.has(path)) return;
  const give = bindScope((raw, at2) => feed(...aged(raw, at2)));
  const until = Date.now() + DRAIN_MS;
  let taken2 = 0;
  let openedAt = 0;
  const tick = () => {
    const all2 = entries(path);
    if (!all2) return void draining.delete(path);
    const fresh2 = [];
    for (const e of all2.slice(taken2)) {
      if (e.open) openedAt = e.open;
      if (typeof e.frame === "string") fresh2.push([e.frame, e.at ?? openedAt]);
    }
    if (fresh2.length) log(`handover spool: ${fresh2.length} frame(s) of the outgoing daemon`);
    for (const [raw, at2] of fresh2) give(raw, at2);
    taken2 = all2.length;
    const opened = all2.filter((e) => e.open).length;
    const done = all2.filter((e) => e.done).length;
    if (done < opened && Date.now() < until) {
      setTimeout(tick, DRAIN_TICK_MS).unref?.();
      return;
    }
    draining.delete(path);
    try {
      unlinkSync10(path);
    } catch {
    }
  };
  draining.add(path);
  tick();
}

// js/bridge/statuspost.ts
var TRIMMED = "trimmed_to_limit";
var LIMIT = 64;
var obj3 = (v) => v && typeof v === "object" ? v : {};
function trimToWord(text2, max) {
  const chars = [...text2];
  const head = chars.slice(0, max - 1).join("");
  const cut = chars[max - 1] === " " ? head.length : head.lastIndexOf(" ");
  return (cut > 0 ? head.slice(0, cut) : head).trimEnd() + "…";
}
function acceptedIn(body, sent) {
  let parsed = {};
  try {
    parsed = obj3(JSON.parse(body));
  } catch {
  }
  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings : [];
  const w = obj3(warnings.find((x) => obj3(x).code === TRIMMED));
  const told = typeof parsed.doing === "string" ? parsed.doing : null;
  if (!w.code) return told === null ? {} : { doing: told };
  const doing = told ?? trimToWord(sent, LIMIT);
  const message = typeof w.message === "string" ? w.message.trim() : "";
  return { doing, trimmed: { doing, message } };
}
function trimNudge(t) {
  if (t.message) return words(STATUS_POST).trimmedBy(t.message);
  return words(STATUS_POST).trimmed();
}
async function publishStatusTo(url, text2, timeoutMs = 5e3, standingId = null) {
  const signal = AbortSignal.timeout(timeoutMs);
  const post3 = () => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(standingId ? { text: text2, standing_id: standingId } : { text: text2 }),
    signal
  });
  let res;
  try {
    res = await post3().catch((e) => {
      if (!closedUnder(e) || signal.aborted) throw e;
      return post3();
    });
  } catch (e) {
    return { ok: false, body: words(STATUS_POST).noAnswer(e.message) };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 404) return { ok: false, code: 404, body: words(STATUS_POST).gone(body) };
  if (!res.ok)
    return { ok: false, code: res.status, body: words(STATUS_POST).refused(res.status, body) };
  return { ok: true, body, ...acceptedIn(body, text2) };
}

// js/bridge/handoff.ts
var pending = /* @__PURE__ */ new Set();
function keepUntilEvicted(holder, key2, statusUrl2) {
  const path = spoolFilePathOf(CFG.authDir, key2);
  const door = socketPathOf(CFG.authDir, key2);
  openSpool(path);
  let timer;
  let over = false;
  const done = new Promise((resolve11) => {
    const end = (why, after2) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      closeSpool(path);
      log(`place ${key2} handed over: ${why}`);
      void Promise.resolve(after2).then(() => resolve11());
    };
    timer = setTimeout(() => {
      const cleared = statusUrl2 ? clearBusy(key2, statusUrl2, door) : void 0;
      end(`no successor took the socket in ${HANDOFF_MS / 1e3}s — closed`, cleared);
      holder.close("the successor did not take the place");
    }, HANDOFF_MS);
    holder.handOff(
      (raw) => spoolFrame(path, raw),
      (code) => end(
        code === EVICTED_CODE ? "the successor took the socket (close 4000)" : `the socket closed (${code})`
      )
    );
  });
  pending.add(done);
}
async function clearBusy(key2, statusUrl2, door) {
  if (await localSocketAlive(door)) {
    log(`place ${key2}: busy line left — the successor's door is up`);
    return;
  }
  const st = await publishStatusTo(statusUrl2, "", 3e3);
  log(`place ${key2}: ${st.ok ? "busy line cleared" : `busy line not cleared — ${st.body}`}`);
}
function letGo(holder, keepFor, reason, statusUrl2 = null) {
  if (holder && keepFor) return keepUntilEvicted(holder, keepFor, statusUrl2);
  if (holder?.alive) E.pulse?.("last", holder);
  holder?.close(reason);
}
function takeSpool(key2, primary, feed) {
  drainSpool(spoolFilePathOf(CFG.authDir, key2), (raw, frame2) => {
    const p = primary();
    if (!p || !sayStray(raw, frame2, p)) feed(raw, frame2);
  });
}
function sayStray(raw, frame2, p) {
  const to = strayOf(frame2, p);
  if (!to) return false;
  const text2 = words(HANDOFF).strayFrame(String(frame2?.id ?? "?"), to, p.door.key, raw);
  log(text2);
  const ev = { kind: "note", text: text2 };
  p.door.broadcast(ev);
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "info", logger: LOGGERS.channel, data: ev }
  });
  return true;
}
function holdStray(raw, frame2, primary, feedAgain) {
  const p = primary();
  if (!p || !strayOf(frame2, p)) return false;
  return liveWhenFree(() => {
    const now2 = primary();
    if (now2 && !sayStray(raw, frame2, now2)) feedAgain();
  });
}
var handoffsSettled = () => Promise.all([...pending]).then(() => void 0);

// js/bridge/holdwords.ts
var holdWords = () => words(HOLD);
var deadWord = (code) => holdWords().dead(deadTokenAdvice(code));

// js/bridge/seatorigin.ts
import { AsyncLocalStorage as AsyncLocalStorage2 } from "node:async_hooks";

// js/shared/serviceid.ts
var SERVICE_ID = `${ID_PREFIX}service-`;

// js/bridge/seatorigin.ts
var origin = new AsyncLocalStorage2();
var automaticSeat = () => origin.getStore() ?? true;
var withSeatOrigin = (automatic, work) => origin.run(automatic, work);
var withCallOrigin = (id, work) => withSeatOrigin(typeof id === "string" && id.startsWith(SERVICE_ID), work);

// js/bridge/seatproof.ts
function seatProof(key2) {
  const r = key2 ? readHoldRecord(key2, true) : null;
  if (!r) return {};
  return {
    key: key2 ?? void 0,
    place: { realm: r.realm, karta: String(r.karta), name: r.name },
    provisional: r.provisional === true && !!r.session && r.session === sessionOfBridge()
  };
}
var heldProof = (key2, place) => ({
  kind: "held",
  key: key2,
  ...place ? { place } : {},
  ...seatProof(key2),
  automatic: automaticSeat()
});

// js/bridge/hold.ts
function keyFor() {
  const s2 = state.standing;
  return s2 ? keyOf(s2.realm, s2.karta, s2.name ?? "") : ENV_KEY;
}
function noteStandCwd(cwd) {
  const prev = H2.standCwd;
  H2.standCwd = cwd;
  if (cwd && H2.currentKey && H2.currentUrl)
    rememberStatus(readHoldRecord(H2.currentKey)?.status ?? "");
  return prev;
}
var channel = () => H2.currentUrl ? { url: H2.currentUrl, statusUrl: H2.currentStatusUrl, cwd: H2.standCwd } : null;
function rememberStatus(text2, realm) {
  const s2 = state.standing;
  const ch = channel();
  if (!s2 || !H2.currentKey || !ch) return;
  const extra = realm ? extraIn(realm) : void 0;
  if (extra) return rememberExtraStatus(extra.door.key, ch, text2);
  writeHoldRecord(H2.currentKey, {
    realm: s2.realm,
    karta: s2.karta,
    name: s2.name ?? "",
    url: ch.url,
    statusUrl: H2.currentStatusUrl,
    status: text2 || void 0,
    cwd: H2.standCwd ?? readHoldRecord(H2.currentKey)?.cwd,
    client: harnessName(),
    key: H2.currentKey
  });
}
var holdsKey = (key2) => !!H2.holder?.alive && H2.currentKey === key2;
var ledKey = () => H2.currentKey;
var holdsChannel = () => !!H2.holder?.alive && !!H2.currentKey;
var localSocketPathOf = (key2) => socketPathOf(CFG.authDir, key2);
var doorHooks = {
  onAttach: () => {
    for (const fn of H2.attachHooks) fn();
  },
  lateEvent: () => H2.evictedKey ? H2.evictedEvent : null,
  onError: (text2) => {
    log(text2);
    notify("error", { kind: "note", text: text2 });
  }
};
var doors = () => [
  ...H2.door ? [H2.door] : [],
  ...extraPlaces().map((p) => p.door)
];
function isOwn(realm, karta, name2) {
  const s2 = state.standing;
  if (!H2.currentKey) return false;
  if (extraOf(realm, karta, name2)) return true;
  return !!s2 && (s2.realm === realm || sameRealm(s2.realm, realm)) && String(s2.karta) === String(karta) && (s2.name ?? "") === name2 && H2.currentKey === keyFor();
}
function holdsStanding(realm, karta, name2) {
  return !!H2.holder?.alive && !H2.unheard && isOwn(realm, karta, name2);
}
function wasEvicted(realm, karta, name2) {
  return !!H2.evictedKey && H2.evictedKey === H2.currentKey && isOwn(realm, karta, name2);
}
var hasStatusAddressFor = (realm, karta, name2) => !!H2.currentStatusUrl && !!H2.currentKey && isOwn(realm, karta, name2);
var heldPlaces = () => [
  ...H2.door && state.standing ? [{ key: H2.door.key, realm: state.standing.realm, primary: true }] : [],
  ...extraPlaces().map((p) => ({ key: p.door.key, realm: p.standing.realm, primary: false }))
];
var besideKeyIn = (realm) => extraIn(realm)?.door.key ?? null;
var isParked = (realm, karta, name2) => H2.parked && isOwn(realm, karta, name2);
function listenerIdleSince() {
  if (!H2.holder?.alive) return null;
  const ds = doors();
  if (!ds.length || ds.some((d) => d.clients.size > 0)) return null;
  return Math.max(...ds.map((d) => d.idleAt ?? 0));
}
function onListenerAttached(fn) {
  H2.attachHooks.push(fn);
}
var localListeners = () => doors().reduce((n, d) => n + d.clients.size, 0);
function awaitHello(timeoutMs) {
  const seen = H2.door?.ring.find((r) => r.frame?.type === "hello")?.frame ?? null;
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve11) => {
    const done = (f) => {
      H2.helloWaiters.delete(done);
      resolve11(f);
    };
    H2.helloWaiters.add(done);
    setTimeout(() => done(null), timeoutMs).unref();
  });
}
var heldKey = (realm) => (realm ? besideKeyIn(realm) : null) ?? H2.currentKey;
function broadcast(ev) {
  for (const d of doors()) d.broadcast(ev);
}
function notify(level, data) {
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level, logger: LOGGERS.channel, data }
  });
}
function addPlace(s2) {
  const ch = channel();
  const primary = state.standing;
  if (!H2.holder?.alive || !ch || !primary || !otherRealm(primary.realm, s2.realm)) return null;
  return addExtra(s2, ch, doorHooks, H2.door?.address ?? null);
}
var standingIdIn = (realm) => (extraIn(realm)?.door ?? H2.door)?.standingId ?? null;
function noteStandingId(realm, id) {
  const d = extraIn(realm)?.door ?? (state.standing && !otherRealm(realm, state.standing.realm) ? H2.door : null);
  if (d && id) d.standingId = id;
}
var held = () => H2.door && state.standing ? { standing: state.standing, door: H2.door } : null;
function releaseStanding(reason, forget = false, keepBeside = false, own = false, keepBusy = false) {
  if (forget && H2.currentKey) dropOwnHoldRecord(H2.currentKey, H2.currentUrl);
  if (!keepBeside) dropAllExtras(reason, forget, own);
  if (!H2.holder && !H2.door) return;
  H2.door?.flushBatches();
  const key2 = H2.currentKey ?? void 0;
  const handover = handoverReason();
  if (handover && !forget) {
    standingLog(`handed over ${H2.currentKey ?? "?"}: ${handover}`);
    broadcast({ kind: "handover", key: key2, text: handover });
  } else {
    standingLog(`released ${H2.currentKey ?? "?"}: ${reason}${forget ? " (record dropped)" : ""}`);
    const released = { kind: "released", key: key2, text: reason, ...own && { own } };
    broadcast(released);
    notify("info", released);
  }
  const busy = keepBusy ? null : H2.currentStatusUrl;
  letGo(H2.holder, handover && !forget ? key2 ?? null : null, reason, busy);
  H2.holder = null;
  for (const w of [...H2.helloWaiters]) w(null);
  H2.door?.close();
  H2.door = null;
  Object.assign(H2, { parked: false, unheard: false });
  H2.currentKey = null;
  H2.currentUrl = null;
  H2.currentStatusUrl = null;
  H2.evictedKey = null;
  H2.evictedEvent = null;
}
function holdStanding(url, statusUrl2) {
  const key2 = keyFor();
  if (url === H2.currentUrl && key2 === H2.currentKey && H2.holder?.alive) return key2;
  const same2 = !!H2.currentKey && H2.currentKey === key2;
  releaseStanding(holdWords().newSocket(), !!H2.currentKey && H2.currentKey !== key2, same2);
  const status = statusUrl2 || statusUrl(url);
  Object.assign(H2, { currentKey: key2, currentUrl: url, currentStatusUrl: status });
  H2.door = new Door(key2, doorHooks);
  H2.door.open();
  const s2 = state.standing;
  if (s2)
    writeHoldRecord(key2, {
      status: readHoldRecord(key2)?.status,
      realm: s2.realm,
      karta: s2.karta,
      name: s2.name ?? "",
      url,
      statusUrl: H2.currentStatusUrl,
      cwd: H2.standCwd ?? readHoldRecord(key2)?.cwd,
      client: harnessName(),
      key: key2,
      left: false
      // held again: the leave mark is cleared
    });
  const ch = channel();
  if (same2 && ch) repointExtras(ch);
  openHolder(url, key2);
  standingLog(`held ${key2}${H2.standCwd ? ` cwd=${H2.standCwd}` : ""}`);
  const place = s2 ? { realm: s2.realm, karta: String(s2.karta), name: s2.name ?? "" } : void 0;
  notify("info", heldProof(key2, place));
  return key2;
}
function parkStanding(reason) {
  if (!H2.holder?.alive || !H2.currentKey) return null;
  H2.heardAt = Math.max(H2.heardAt, H2.holder.heardAt);
  letGo(H2.holder, null, reason);
  H2.holder = null;
  H2.parked = true;
  standingLog(`parked ${H2.currentKey}: ${reason}`);
  const text2 = holdWords().parked(reason);
  broadcast({ kind: "note", text: text2 });
  return H2.currentKey;
}
function expectHello() {
  H2.unheard = true;
  for (const d of doors())
    d.ring.splice(0, d.ring.length, ...d.ring.filter((r) => r.frame?.type !== "hello"));
}
function resumeStanding() {
  if (!H2.parked || !H2.currentUrl || !H2.currentKey) return false;
  H2.parked = false;
  expectHello();
  openHolder(H2.currentUrl, H2.currentKey);
  standingLog(`resumed ${H2.currentKey}: socket reopened on the same address`);
  return true;
}
function deliverTo(d, raw, frame2, full) {
  const seenPath = d.seenPath;
  const id = full?.type === "message" && typeof full.id === "string" ? full.id : "";
  if (redundantCopy(full, d)) return;
  if (full?.type === "message") markAddressed(full, seenPath, d.seen);
  const again = isDelivered(id ? [id] : [], d.seen, seenPath);
  if (full?.type === "message" && full.stale === true && !isDirectWord(full))
    return again ? log(`stale frame ${id} already delivered — dropped`) : d.stale.note(full, (ev2) => {
      if (notifiedClient()) for (const k of ev2.marks ?? []) noteSeen(seenPath, k, d.seen);
      d.broadcast(ev2);
      notify("info", keyed(d, ev2));
    });
  const text2 = full === frame2 && !full?.addressed ? raw : JSON.stringify(full);
  const hello = full?.type === "hello";
  for (const x of hello ? doors() : [d]) x.push(text2, full);
  if (hello) Object.assign(H2, { unheard: false, deafKey: null });
  if (hello) for (const w of [...H2.helloWaiters]) w(full);
  const ev = { kind: "frame", raw: text2, frame: full };
  const msg = full?.type === "message" && !again ? full : null;
  if (msg) noteRoomKind(msg);
  const toBatch = (b) => (d.broadcast(b), notify("info", keyed(d, b)));
  if (msg && !notifiedClient() && batchForWatchdogs(d, text2, msg, toBatch)) return;
  if (!again) for (const x of hello ? doors() : [d]) x.broadcast(ev);
  if (full?.type === "status") return;
  if (again) return log(`frame ${id} came again — already delivered, not raised`);
  if (notifiedClient()) {
    const flushBacklog = (b) => {
      for (const k of b.marks ?? []) noteSeen(seenPath, k, d.seen);
      notify("info", keyed(d, b));
    };
    if (hello && Number(full.pending) > 0) d.backlog.open(Number(full.pending), flushBacklog);
    if (full?.type === "message") {
      if (full.origin === "platform") d.backlog.open(0, flushBacklog);
      if (d.backlog.note(full)) return;
    }
    for (const k of deliveryKeys(full)) noteSeen(seenPath, k, d.seen);
  }
  notify("info", keyed(d, ev));
}
var keyed = (d, ev) => d === H2.door ? ev : { ...ev, key: d.key };
function forgetSeat(reason) {
  releaseStanding(reason, true, false, true);
  state.standing = null;
  state.standingSession = null;
}
function releasedAsOwn(what) {
  if (H2.revokingOwn) {
    log(
      `standing revoked by this session — released quietly, binding forgotten (${state.standing?.name ?? "unnamed"}; ${what} arrived before the answer)`
    );
    forgetSeat(holdWords().revokedOwn());
    return true;
  }
  if (H2.closingOwn) {
    log(`channel closed by this session — released quietly (${what} arrived before the answer)`);
    forgetSeat(holdWords().closedOwn());
    return true;
  }
  return false;
}
function openHolder(url, key2) {
  H2.holder = holdSocket(
    bindAll({
      url,
      onDropped: expectHello,
      onFrame: function onFrame(raw, frame2) {
        void Promise.resolve(stampOrigin(frame2)).then((full) => {
          if (full?.type === "standing_ended") return E.stop?.(key2, 0, "", full);
          if (E.order?.(url, full)) return;
          const primary = held();
          if (!primary) return H2.door ? deliverTo(H2.door, raw, frame2, full) : void 0;
          if (full?.type === "hello") learnFromHello(full, primary);
          if (holdStray(raw, full, held, () => onFrame(raw, frame2))) return;
          const { door: d, note: note3 } = routeFrame(full?.type === "hello" ? null : full, primary);
          if (note3) {
            log(note3);
            d.broadcast({ kind: "note", text: note3 });
          }
          deliverTo(d, raw, frame2, full);
          E.pulse?.(full?.type === "hello" ? "hello" : "frame");
          if (full?.type === "hello") drainWhenFree(() => takeSpool(key2, held, onFrame));
        });
      },
      onEvicted: (code) => {
        standingLog(`evicted ${key2}: close ${code}`);
        H2.evictedKey = key2;
        dropOwnHoldRecord(key2, url);
        E.next?.(key2, url, code);
      },
      onStopped: (code, reason) => {
        if (releasedAsOwn(`close ${code}`)) return;
        if (E.stop) E.stop(key2, code, reason);
        else forgetSeat(`close ${code}`);
      },
      onDeadToken: (code) => {
        if (H2.resuming > 0) {
          log(`hold record for ${key2} is dead at the platform (close ${code}) — dropped`);
          releaseStanding(holdWords().resumeFailed(), true);
          return;
        }
        const text2 = deadWord(code);
        log(text2);
        standingLog(`dead ${key2}: close ${code}`);
        const ev = { kind: "dead", code, text: text2 };
        broadcast(ev);
        notify("error", ev);
        Object.assign(H2, { deafKey: key2, deadPlaces: [...state.places] });
        releaseStanding(holdWords().tokenDead(), true);
      },
      onServiceAlive: (version) => {
        const text2 = holdWords().alive(version);
        log(text2);
        const ev = { kind: "alive", version, text: text2 };
        broadcast(ev);
        notify("warning", ev);
      },
      onNote: (text2) => {
        log(text2);
        broadcast({ kind: "note", text: text2 });
      },
      // Hang: a line waking the agent for the Monitor watchdog; pi and OpenCode show the human a notification that does not wake the agent (#5380).
      onHung: (text2) => {
        log(text2);
        broadcast({ kind: "note", text: text2 });
        notify("warning", { kind: "note", text: text2 });
      }
    })
  );
}

// js/bridge/status.ts
import { existsSync as existsSync6, readdirSync as readdirSync9, readFileSync as readFileSync21, statSync as statSync7 } from "node:fs";
import { isAbsolute, join as join18 } from "node:path";

// js/shared/busyargs.ts
var STATUS_ONLY_ARGS = /* @__PURE__ */ new Set([
  "realm",
  "karta",
  "name",
  "cwd",
  "status",
  "satellite_of"
]);
var unset = (v) => v == null || v === false || v === "";
var takingArgs = (args) => Object.keys(args).filter((k) => !STATUS_ONLY_ARGS.has(k) && !unset(args[k]));

// js/bridge/fields.ts
var LIVE_STATE = "active";
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var is = {
  str: (v) => v === void 0 || typeof v === "string",
  num: (v) => v === void 0 || typeof v === "number" && Number.isFinite(v),
  bool: (v) => v === void 0 || typeof v === "boolean",
  strOrNull: (v) => v === void 0 || v === null || typeof v === "string"
};
var SEAT_KEYS = {
  seat_id: is.str,
  karta_seq: is.num,
  karta_name: is.str,
  standing: is.str,
  listening: is.bool,
  state: is.str,
  pending: is.num,
  inbound: is.str,
  locale: is.str,
  satellite_of: is.strOrNull,
  realm: is.str,
  doing: is.str,
  opened: is.bool
};
var structuredOf = (reply2) => reply2?.result?.structuredContent;
var harnessAsksFields = () => asksFields(state.initParams);
function forHarness(reply2) {
  const r = reply2?.result;
  if (!r || !("structuredContent" in r) || harnessAsksFields()) return reply2;
  const { structuredContent: _, ...rest2 } = r;
  return { ...reply2, result: rest2 };
}
var incomplete = (sc) => isObj(sc) && (sc.incomplete === true || sc.dropped !== void 0 && sc.dropped !== 0);
var said = /* @__PURE__ */ new Set();
function fallback(what, sc) {
  const why = sc === void 0 ? "no field — the prose template" : incomplete(sc) ? "fields incomplete — the prose template" : "field off its form — the prose template";
  if (!said.has(`${what}|${why}`)) {
    said.add(`${what}|${why}`);
    log(`structuredContent ${what}: ${why}`);
  }
  return null;
}
var seat = (v) => isObj(v) && Object.entries(SEAT_KEYS).every(([k, ok]) => ok(v[k])) ? v : null;
function seats(sc, action) {
  const what = `${tool("channel")} ${action}`;
  if (!isObj(sc) || incomplete(sc) || sc.action !== action || !Array.isArray(sc.seats))
    return fallback(what, sc);
  const out7 = sc.seats.map(seat);
  return out7.every((s2) => s2) ? out7 : fallback(what, sc);
}
function boardField(sc) {
  const list3 = seats(sc, "list");
  if (!list3) return null;
  const folded = sc.folded;
  const whole = list3.every(
    (s2) => typeof s2.karta_seq === "number" && typeof s2.standing === "string" && s2.standing.startsWith("@") && typeof s2.listening === "boolean"
  );
  if (!whole || !is.num(folded)) return fallback(`${tool("channel")} list`, sc);
  return { seats: list3, folded: typeof folded === "number" ? folded : 0 };
}
function seatField(sc, action) {
  const list3 = seats(sc, action);
  if (!list3) return null;
  return list3.length === 1 ? list3[0] : fallback(`${tool("channel")} ${action}`, sc);
}

// js/bridge/board.ts
var fromField = (s2) => ({
  karta: String(s2.karta_seq),
  address: s2.standing ?? "",
  rest: "",
  incoming: s2.inbound ?? null,
  id: s2.seat_id ?? null,
  listening: s2.listening,
  undelivered: s2.pending ?? 0,
  // Liveness only from the api status; an unknown or missing value is not alive.
  alive: s2.state === LIVE_STATE
});
function readBoard(a) {
  const board = boardField(a.structured);
  if (board) {
    const entries3 = board.seats.map(fromField);
    const declared = board.folded > 0 ? entries3.length + board.folded : null;
    return { entries: entries3, recognized: true, declared };
  }
  const entries2 = parseBoard(a.text);
  const header = FORM.boardHeader.exec(a.text);
  const empty = FORM.boardEmpty.test(a.text);
  return {
    entries: entries2,
    recognized: !!header || empty || entries2.length > 0,
    declared: header?.[1] != null ? Number(header[1]) : null
  };
}
function parseBoard(text2) {
  const out7 = [];
  for (const line of text2.split("\n")) {
    const m = /^\s*#(\d+)\s.*?·\s(@\S+)\s—\s(.*)$/.exec(line);
    if (m) {
      out7.push({ karta: m[1], address: m[2], rest: m[3], incoming: null, id: null });
      continue;
    }
    const inc = /📥\s*(https?:\/\/\S+)/.exec(line);
    if (inc && out7.length) out7[out7.length - 1].incoming = inc[1];
    const id = /^\s*id\s+([0-9a-f][0-9a-f-]{7,})\s*$/i.exec(line);
    if (id && out7.length) out7[out7.length - 1].id = id[1];
  }
  return out7;
}
var nameOf = (address) => address.slice(address.indexOf(":") + 1);
var FORM = BOARD_FORM;
var listens = (e) => e.listening ?? FORM.listens.test(e.rest);
var alive = (e) => e.alive ?? FORM.alive.test(e.rest);
function undelivered(e) {
  if (e.undelivered != null) return e.undelivered;
  const m = FORM.undelivered.exec(e.rest);
  return m ? Number(m[1]) : 0;
}

// js/bridge/listen.ts
import { fileURLToPath as fileURLToPath2 } from "node:url";
function clientName() {
  const info = state.initParams?.clientInfo;
  return typeof info?.name === "string" ? info.name : "";
}
function listenBlock(realm) {
  const key2 = heldKey(realm);
  if (!key2) return null;
  return words(LISTEN).block(listenLine(key2));
}
function unheardListenBlock(realm) {
  const key2 = heldKey(realm);
  if (!key2 || NOTIFIED_CLIENTS.has(clientName())) return null;
  if ((doors().find((d) => d.key === key2)?.clients.size ?? 0) > 0) return null;
  return words(LISTEN).unheard(listenLine(key2));
}
function listenLine(key2) {
  const W4 = words(LISTEN);
  const self = fileURLToPath2(import.meta.url);
  const authArg = CFG.authDir === defaultAuthDir() ? "" : ` --auth-dir "${CFG.authDir}"`;
  const where = `${authArg} --lang ${lang()}`;
  const client = clientName();
  const monitor = W4.monitor(self, key2, where);
  const exit = W4.exit(self, key2, where);
  const codex = W4.codex(self, key2, where);
  return NOTIFIED_CLIENTS.has(client) ? W4.self(client === PI_CLIENT) : client === "claude-code" ? W4.claude(monitor, exit) : /codex/i.test(client) ? W4.codexLine(codex, exit) : W4.any(monitor, exit, codex);
}

// js/bridge/hearing.ts
import { readdirSync as readdirSync4, readFileSync as readFileSync14 } from "node:fs";
import { join as join11 } from "node:path";

// js/shared/canon.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { sep } from "node:path";
function canonDir(p) {
  let real2 = p;
  try {
    real2 = realpathSync2.native(p);
  } catch {
  }
  while (real2.length > 1 && (real2.endsWith("/") || real2.endsWith(sep))) real2 = real2.slice(0, -1);
  return real2;
}
var sameDir = (a, b) => !!a && !!b && (a === b || canonDir(a) === canonDir(b));

// js/bridge/hearing.ts
var isSentinel = (karta) => !/^\d+$/.test(karta);
function seatKarta(realm, karta, name2 = "") {
  const k = normKarta(karta);
  if (k !== "agent") return k;
  const r = String(realm ?? "").trim();
  const here = (x) => x === r || sameRealm(r, x);
  const led = [state.standing, ...state.places].find((p) => p && here(p.realm));
  if (led) return String(led.karta);
  const me = sessionOfBridge();
  const rec5 = me && name2 ? holdRecordsNamed(name2).find((x) => x.session === me && here(x.realm)) : null;
  return rec5 ? normKarta(rec5.karta) : k;
}
var unresolvedAgent = (karta, what) => karta !== "agent" ? null : words(HEARING).unresolvedAgent(what);
async function seatRealm(given, asked) {
  const realm = typeof given === "string" ? given.trim() : "";
  const name2 = normName(asked);
  const known2 = [
    ...[state.standing, ...state.places].flatMap((p) => p ? [p.realm] : []),
    ...name2 ? holdRecordsNamed(name2).flatMap((r) => r.realm ? [r.realm] : []) : []
  ];
  await resolveAgainstLed(realm);
  if (!realm || !known2.length || known2.includes(realm)) return realm;
  await resolveRealms([realm, ...known2], async () => {
    const r = await callTool(tool("realm"), { action: "list" });
    return r.isError ? null : r.text;
  });
  return known2.find((r) => sameRealm(r, realm)) ?? realm;
}
var ofSeat = (e, karta, name2) => (isSentinel(karta) || e.karta === karta) && nameOf(e.address) === name2;
function boardHearing(bd, karta, name2) {
  if (!bd?.recognized) return "unknown";
  const at2 = bd.entries.filter((e) => ofSeat(e, karta, name2));
  if (at2.some(listens)) return "other";
  const unread = bd.declared != null && bd.declared !== bd.entries.length;
  return unread && (at2.length === 0 || isSentinel(karta)) ? "unknown" : "free";
}
function keysNamed(realm, name2) {
  const dir2 = standingsDirOf(CFG.authDir);
  try {
    return readdirSync4(dir2).filter((f) => f.endsWith(".key")).map((f) => readFileSync14(join11(dir2, f), "utf8").trim()).filter((k) => {
      const m = /^.*?--(.+)--/.exec(k);
      return !!m && keyOf(realm, m[1], name2) === k;
    });
  } catch {
    return [];
  }
}
var unsignedHere = (rec5, cwd) => !rec5.session && !rec5.left && rec5.client === harnessName() && sameDir(rec5.cwd, cwd);
async function localHolder(key2, cwd) {
  if (!await localSocketAlive(localSocketPathOf(key2))) return null;
  if (doors().some((d) => d.key === key2 && d.ownsSocket)) return "self";
  const me = sessionOfBridge();
  const rec5 = me ? readHoldRecord(key2, true) : null;
  if (!rec5) return "other";
  return rec5.session === me || cwd != null && unsignedHere(rec5, cwd) ? "session" : "other";
}
async function heldLocally(realm, karta, name2, cwd) {
  let own = false;
  for (const key2 of isSentinel(karta) ? keysNamed(realm, name2) : [keyOf(realm, karta, name2)]) {
    const h = await localHolder(key2, cwd);
    if (h === "other") return "other";
    own ||= h === "session";
  }
  return own ? "session" : null;
}
async function askedHearing(realm, karta, name2, cwd = H2.standCwd ?? sessionCwd()) {
  const local = await heldLocally(realm, karta, name2, cwd);
  if (local === "other") return "other";
  if (local === "session") return "free";
  const b = await callTool(tool("channel"), { action: "list", realm }).catch(() => null);
  return boardHearing(b && !b.isError ? readBoard(b) : null, karta, name2);
}
async function rawSeatRefusal(msg) {
  if (msg?.method !== "tools/call" || msg.params?.name !== tool("channel")) return null;
  const a = msg.params.arguments ?? {};
  const action = String(a.action);
  if (!["connect", "mint", "register"].includes(action)) return null;
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const name2 = normName(a.name);
  const karta = seatKarta(realm, normKarta(a.karta) || "agent", name2);
  if (!realm) return null;
  const agent = unresolvedAgent(karta, action);
  if (agent) return agent;
  if (ledHere(realm, karta, name2)) return null;
  const hearing = await askedHearing(realm, karta, name2);
  if (hearing === "free") return null;
  const seat2 = keyOf(realm, karta, name2);
  const w = words(HEARING);
  const who = hearing === "other" ? w.otherListens(seat2) : w.unknownListens(seat2);
  return w.rawSeatRefusal(who, action);
}
function ledHere(realm, karta, name2) {
  if (holdsStanding(realm, karta, name2)) return true;
  return ledKey() === keyOf(realm, karta, name2) && !H2.unheard && // back on the same address without hello — another may have turned it
  !wasEvicted(realm, karta, name2) && !isParked(realm, karta, name2);
}

// js/bridge/deaf.ts
var UNSIGNED = /* @__PURE__ */ new Set(["list", "leave", "close", "revoke", "?"]);
function signedRealm(msg) {
  if (msg?.method !== "tools/call" || msg.params?.name === tool("stand")) return null;
  const a = msg.params?.arguments ?? {};
  if (msg.params?.name === tool("channel") && UNSIGNED.has(String(a.action))) return null;
  return typeof a.realm === "string" ? a.realm : null;
}
function deafPlaces() {
  const s2 = state.standing;
  if (!s2) return [];
  const name2 = s2.name ?? "";
  if (isParked(s2.realm, s2.karta, name2) || H2.unheard) return [s2, ...state.places];
  const letGo2 = !ledKey() && H2.deafKey === keyOf(s2.realm, s2.karta, name2);
  return letGo2 ? [s2, ...state.places, ...H2.deadPlaces] : [];
}
function deafPlaceIn(realm) {
  if (typeof realm !== "string") return null;
  return deafPlaces().find((p) => !otherRealm(realm, p.realm)) ?? null;
}
async function deafSeatTaken(p = deafPlaces()[0] ?? null) {
  if (!p) return null;
  const name2 = p.name ?? "";
  const hearing = await askedHearing(p.realm, String(p.karta), name2);
  if (hearing === "free") return null;
  return hearing === "other" ? words(DEAF).takenByOther(name2) : words(DEAF).unknownHearing(name2);
}
async function deafRefusal(msg) {
  const realm = signedRealm(msg);
  if (H2.unheard && deafPlaceIn(realm)) await awaitHello(4e3);
  const p = deafPlaceIn(realm);
  const why = p ? await deafSeatTaken(p) : null;
  return why ? words(DEAF).refusal(why) : null;
}

// js/bridge/satellite.ts
import { randomBytes as randomBytes3 } from "node:crypto";
import {
  mkdirSync as mkdirSync10,
  readFileSync as readFileSync17,
  renameSync as renameSync8,
  rmSync,
  statSync as statSync6,
  unlinkSync as unlinkSync11,
  writeFileSync as writeFileSync10
} from "node:fs";
import { join as join15 } from "node:path";

// js/bridge/orderhalt.ts
var HALT_WAIT_MS = Number(process.env[envName("ORDER_HALT_MS")]) || 2e4;
var SILENT = "harness_silent";
var CODE = /^[a-z][a-z0-9_]{0,63}$/;
var waiting = /* @__PURE__ */ new Map();
var obj4 = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var confirmsHalts = () => HALTS_CAPABILITY in obj4(obj4(obj4(state.initParams).capabilities).experimental);
function awaitHalt(order, ms2 = HALT_WAIT_MS) {
  return new Promise((resolve11) => {
    const t = setTimeout(() => done(SILENT), ms2);
    t.unref?.();
    const done = (code) => {
      clearTimeout(t);
      if (waiting.get(order) === done) waiting.delete(order);
      resolve11(code);
    };
    waiting.set(order, done);
  });
}
function localHalted(msg) {
  if (msg?.method !== method("halted")) return null;
  const p = obj4(msg.params);
  const order = typeof p.order === "string" ? p.order : "";
  const code = typeof p.code === "string" && CODE.test(p.code) ? p.code : "harness_refused";
  const done = waiting.get(order);
  done?.(p.ok === true ? null : code);
  return Promise.resolve({ jsonrpc: "2.0", id: msg.id, result: { taken: !!done } });
}

// js/bridge/skillwatch.ts
import { readdirSync as readdirSync6, statSync as statSync5 } from "node:fs";
import { join as join14 } from "node:path";

// js/shared/skilllock.ts
import { existsSync as existsSync2, readFileSync as readFileSync15, realpathSync as realpathSync3 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { basename as basename4, dirname as dirname7, join as join12, resolve as resolve5 } from "node:path";
var canon = (p) => {
  try {
    return realpathSync3(p);
  } catch {
    return resolve5(p);
  }
};
function lockPlaces(root, stateHome = process.env.XDG_STATE_HOME) {
  const places = [];
  if (stateHome && canon(root) === canon(join12(homedir4(), ".agents", "skills")))
    places.push(join12(stateHome, "skills", ".skill-lock.json"));
  places.push(join12(dirname7(root), ".skill-lock.json"));
  if (basename4(root) === "skills" && basename4(dirname7(root)) === ".agents")
    places.push(join12(dirname7(dirname7(root)), "skills-lock.json"));
  return places;
}
function skillLock(root, stateHome = process.env.XDG_STATE_HOME) {
  const place = lockPlaces(root, stateHome).find((p) => existsSync2(p));
  if (!place) return null;
  try {
    const lock = JSON.parse(readFileSync15(place, "utf8"));
    return lock.skills ?? {};
  } catch {
    return null;
  }
}

// js/bridge/skillset.ts
import { createHash as createHash7 } from "node:crypto";
import { existsSync as existsSync3, readdirSync as readdirSync5, readFileSync as readFileSync16, statSync as statSync4 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { dirname as dirname8, join as join13, resolve as resolve6 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var SET = SKILL_SET;
var BRIDGE_IN_SET = join13(BRIDGE_SKILL, "scripts", BRIDGE_FILE);
var env = (k) => envOf(k)?.trim() ?? "";
var R2 = scoped(() => ({ identity: "", root: null, missing: "" }));
function skillsRoot(self = currentScope().origin?.path || fileURLToPath3(import.meta.url)) {
  const plugin = env("CLAUDE_PLUGIN_ROOT");
  const explicit = env(SKILLS_ROOT_ENV);
  const identity = JSON.stringify([explicit, self, plugin]);
  if (identity !== R2.identity) {
    R2.identity = identity;
    R2.root = null;
  }
  const exists = (root) => existsSync3(join13(root, BRIDGE_IN_SET));
  if (!R2.root) {
    const candidates = [
      explicit && resolve6(explicit),
      resolve6(dirname8(self), "..", ".."),
      plugin && resolve6(plugin, "skills"),
      join13(homedir5(), ".agents", "skills")
    ];
    R2.root = candidates.find((c) => c && exists(c)) || null;
  }
  return R2.root && exists(R2.root) ? R2.root : null;
}
function skillsUnavailable() {
  if (skillsRoot() || !R2.root) return null;
  return existsSync3(R2.root) ? "bridge" : "root";
}
function skillsRefreshAllowed() {
  const self = currentScope().origin?.path || fileURLToPath3(import.meta.url);
  const root = skillsRoot(self);
  return !env("CLAUDE_PLUGIN_ROOT") && !self.includes("/plugins/cache/") && !(root && existsSync3(join13(root, "..", ".claude-plugin", "plugin.json")));
}
var sha8 = (h) => h.digest("hex").slice(0, 8);
function lockSet(root) {
  const skills = skillLock(root, env("XDG_STATE_HOME"));
  if (!skills) return { name: SET, stamp: null };
  const own = skills[BRIDGE_SKILL]?.source;
  const name2 = typeof own === "string" && own.trim() ? own.trim() : SET;
  const lines = Object.entries(skills).filter(([, s2]) => s2?.source === name2 && typeof s2.skillFolderHash === "string").map(([n, s2]) => `${n}:${String(s2?.skillFolderHash)}
`).sort();
  return { name: name2, stamp: lines.length ? sha8(createHash7("sha256").update(lines.join(""))) : null };
}
var isFileAt = (p) => {
  try {
    return statSync4(p).isFile();
  } catch {
    return false;
  }
};
function allFiles(dir2, at2 = "") {
  let entries2;
  try {
    entries2 = readdirSync5(join13(dir2, at2), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries2.flatMap((e) => {
    const rel = at2 ? `${at2}/${e.name}` : e.name;
    if (e.isDirectory()) return allFiles(dir2, rel);
    return e.isFile() || e.isSymbolicLink() && isFileAt(join13(dir2, rel)) ? [rel] : [];
  }).sort();
}
function treeStamp(root, mask = SKILL_STAMP_MASK) {
  const [head, ...restParts] = mask.split("/");
  const rest2 = restParts.join("/");
  if (head !== "*" || !rest2 || rest2.includes("*") && rest2 !== "**")
    throw new Error(`unsupported skill stamp mask: ${mask}`);
  const h = createHash7("sha256");
  let n = 0;
  let names2;
  try {
    names2 = readdirSync5(root).sort();
  } catch {
    return null;
  }
  for (const name2 of names2) {
    const files = rest2 === "**" ? allFiles(join13(root, name2)) : [rest2];
    const bodies = [];
    for (const rel of files) {
      try {
        bodies.push([rel, readFileSync16(join13(root, name2, rel))]);
      } catch {
      }
    }
    if (!bodies.length) continue;
    h.update(`${name2}\0`);
    for (const [rel, body] of bodies) {
      if (rest2 === "**") h.update(`${rel}\0`);
      h.update(body);
    }
    h.update("\0");
    n++;
  }
  return n ? sha8(h) : null;
}
function skillsAttr() {
  const root = skillsRoot();
  const missing = !root ? R2.root || "unidentified" : "";
  if (missing !== R2.missing) {
    R2.missing = missing;
    if (missing) log(`installed skills root is missing: ${missing}; not selecting another set`);
  }
  if (!root) return { name: SET, version: "unknown" };
  let version = "unknown";
  try {
    version = versionIn(readFileSync16(join13(root, BRIDGE_IN_SET), "utf8")) ?? "unknown";
  } catch {
    log(`installed skills root is missing or unreadable: ${root}; not selecting another set`);
  }
  const lock = lockSet(root);
  const stamp = lock.stamp ?? treeStamp(root);
  return { name: lock.name, version, ...stamp ? { stamp } : {} };
}

// js/bridge/skillwatch.ts
var W2 = scoped(() => ({
  announced: /* @__PURE__ */ new Map(),
  checkedAt: 0,
  disk: "",
  installed: void 0,
  pending: false,
  missingSince: null,
  unsettled: false
}));
var key = (p) => `${p.realm ?? ""}|${normKarta(p.karta)}|${normName(p.name)}`;
var announcedSkills = (p) => W2.announced.get(key(p));
function installedSkills(p, fresh2 = false) {
  if (!skillsRefreshAllowed()) return skillsAttr();
  checkInstalled(fresh2);
  return W2.installed ?? announcedSkills(p) ?? skillsAttr();
}
function skillsNeedRegister(p) {
  if (!skillsRefreshAllowed()) return false;
  checkInstalled();
  if (W2.unsettled) return false;
  return JSON.stringify(announcedSkills(p)) !== JSON.stringify(W2.installed);
}
function noteSkills(p, skills) {
  const s2 = safeSkills(skills);
  if (s2) W2.announced.set(key(p), s2);
}
var modified = (path) => {
  try {
    const s2 = statSync5(path);
    return `${path}:${s2.mtimeMs}:${s2.size}`;
  } catch {
    return `${path}:missing`;
  }
};
function diskVersion() {
  const root = skillsRoot();
  if (!root) return "missing";
  const locks = lockPlaces(root, envOf("XDG_STATE_HOME"));
  let names2 = [];
  try {
    names2 = readdirSync6(root).sort();
  } catch {
  }
  return [
    root,
    ...locks,
    ...names2.flatMap((n) => [join14(root, n), join14(root, n, "SKILL.md")]),
    join14(root, BRIDGE_SKILL, "scripts", BRIDGE_FILE)
  ].map(modified).join("|");
}
function checkInstalled(fresh2 = false) {
  if (!skillsRefreshAllowed()) return;
  const gap = Number(process.env[envName("SKILLS_GAP_MS")]) || 6e4;
  const now2 = Date.now();
  if (!fresh2 && W2.checkedAt && now2 - W2.checkedAt < gap) return;
  W2.checkedAt = now2;
  const disk = diskVersion();
  const missing = skillsUnavailable();
  W2.missingSince = missing ? W2.missingSince ?? now2 : null;
  W2.unsettled = W2.missingSince !== null && now2 - W2.missingSince < gap;
  if (W2.unsettled) return;
  if (disk === W2.disk) return;
  W2.disk = disk;
  W2.installed = skillsAttr();
  W2.pending = true;
}
function skillsCheckDue() {
  checkInstalled();
  const due = W2.pending;
  W2.pending = false;
  return due;
}
function retrySkillsCheck() {
  W2.disk = "";
}

// js/bridge/placefields.ts
var P = scoped(() => ({
  model: "",
  /** Session usage (usage.ts, #6271): the last snapshot rides in every register. */
  usage: null,
  satelliteOf: "",
  satelliteOfId: "",
  localeWarned: false
}));
var extras2 = scoped(() => /* @__PURE__ */ new Map());
var placeKey = (p) => `${String(p.realm ?? "")}|${normKarta(p.karta)}|${normName(p.name)}`;
function rememberUsage(u) {
  P.usage = u;
}
function observedPlaceAttrs() {
  return { usage: P.usage, satellite_of: P.satelliteOf };
}
function noteSatelliteOf(address, id) {
  P.satelliteOf = address;
  P.satelliteOfId = CFG.satellite && id ? id : "";
}
function rememberModel(m) {
  if (typeof m === "string" && m.trim()) P.model = m.trim().replace(/^[^/]*\//, "");
}
function rememberStandModel(m) {
  if (CFG.satellite) P.model = "";
  rememberModel(m);
}
var satelliteWithoutModel = () => CFG.satellite && !P.model;
function stopAttrs(place, move) {
  const ack = confirmsHalts() ? "confirmed" : "word";
  if (move !== "register") return { effect: "agent", ack };
  if (!H2.holder || !H2.currentKey || !H2.door) return null;
  if (extraIn(place.realm)) return { effect: "seat", ack };
  const prim = state.standing;
  if (!!prim && otherRealm(place.realm, prim.realm))
    return H2.holder.alive ? { effect: "seat", ack } : null;
  return { effect: "agent", ack };
}
function placeFields(place = {}, freshSkills = false, move = "register") {
  const harness = harnessName();
  const extra = extras2.get(placeKey(place)) ?? {};
  const { model, usage: usage2, satelliteOf, satelliteOfId } = P;
  const locale = SERVER_LOCALE[lang()];
  return {
    ...model ? { model } : {},
    // Seat language (#6080): asked only where the layer names a locale; otherwise the server default decides.
    ...locale ? { locale } : {},
    ...CFG.satellite && satelliteOfId ? { satellite_of: satelliteOfId } : {},
    attrs: {
      ...extra,
      build: { name: BRIDGE_NAME, version: VERSION, stamp: BUILD.split("+")[1] ?? "" },
      skills: installedSkills(place, freshSkills),
      ...harness ? { harness, harness_version: harnessVersion() } : {},
      ...satelliteOf ? { satellite_of: satelliteOf } : {},
      ...usage2 ? { usage: usage2 } : {},
      // The bridge's own word, over the agent's: no effect known — the key dropped (undefined).
      stop: stopAttrs(place, move) ?? void 0
    }
  };
}
var PLACE_ACTIONS = /* @__PURE__ */ new Set(["connect", "mint", "register"]);
function noteLocaleEcho(args, text2, structured) {
  const asked = args.locale;
  if (typeof asked !== "string" || P.localeWarned) return;
  const action = String(args.action);
  const field = PLACE_ACTIONS.has(action) ? seatField(structured, action)?.locale : void 0;
  const echo = (field ?? /\blocale\b["']?\s*[:=]\s*["']?([a-z]{2})\b/i.exec(text2)?.[1])?.toLowerCase();
  if (!echo || echo === asked) return;
  P.localeWarned = true;
  log(`locale: asked ${asked}, the server answered ${echo} — its prose stays in ${echo}`);
}
function withPlaceFields(args) {
  if (!PLACE_ACTIONS.has(String(args.action))) return args;
  rememberModel(args.model);
  if (args.attrs && typeof args.attrs === "object" && !Array.isArray(args.attrs))
    extras2.set(placeKey(args), { ...args.attrs });
  return { ...args, ...placeFields(args, true, String(args.action)) };
}

// js/bridge/satellite.ts
var SATELLITE_TTL_S = Number(process.env[envName("BRIDGE_SATELLITE_TTL")]) || 300;
var sw = () => words(SATELLITE);
var claimDir = () => join15(CFG.authDir, "satellites");
var claimFile = (name2) => join15(claimDir(), `${name2.replace(/[^A-Za-z0-9._-]+/g, "_")}.claim`);
var claims = scoped(() => /* @__PURE__ */ new Set());
var allClaims = /* @__PURE__ */ new Map();
var releaseOnExit = false;
var LOCK_STALE_MS = 1e4;
var LOCK_WAIT_MS = 3e3;
function alive2(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function claimName(name2) {
  const file = claimFile(name2);
  let pid = 0;
  try {
    pid = Number(readFileSync17(file, "utf8").trim());
  } catch {
  }
  const me = sessionPid();
  if (pid && pid !== me && alive2(pid)) return false;
  writeFileSync10(file, `${me}
`, { mode: 384 });
  if (!releaseOnExit) process.once("exit", releaseAllClaims);
  releaseOnExit = true;
  claims.add(file);
  allClaims.set(file, me);
  return true;
}
var dropClaim = (f, pid) => {
  try {
    if (Number(readFileSync17(f, "utf8").trim()) === pid) unlinkSync11(f);
  } catch {
  }
  allClaims.delete(f);
};
function releaseSatelliteClaims() {
  const me = sessionPid();
  for (const f of claims) dropClaim(f, me);
  claims.clear();
}
function releaseAllClaims() {
  for (const [f, pid] of [...allClaims]) dropClaim(f, pid);
}
var LOCK_OWNER = "owner";
function lockOwner(lock) {
  try {
    return readFileSync17(join15(lock, LOCK_OWNER), "utf8").trim();
  } catch {
    return null;
  }
}
function abandoned(lock, owner) {
  const pid = owner ? Number(owner.split(" ")[0]) : 0;
  if (pid && !alive2(pid)) return true;
  try {
    return Date.now() - statSync6(lock).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}
function takeLock(lock, owner) {
  const away = `${lock}.${process.pid}-${randomBytes3(6).toString("hex")}`;
  try {
    renameSync8(lock, away);
  } catch {
    return null;
  }
  if (lockOwner(away) !== owner)
    return `the claims lock of another bridge was taken by mistake and is left as ${away}`;
  rmSync(away, { recursive: true, force: true });
  return null;
}
async function underClaimLock(fn) {
  const lock = join15(claimDir(), ".lock");
  const token = `${process.pid} ${randomBytes3(8).toString("hex")}`;
  let fault = null;
  try {
    mkdirSync10(claimDir(), { recursive: true, mode: 448 });
  } catch (e) {
    fault = e.message;
  }
  for (const end = Date.now() + LOCK_WAIT_MS; !fault; ) {
    try {
      mkdirSync10(lock);
    } catch (e) {
      if (e.code !== "EEXIST") fault = e.message;
      else if (Date.now() > end) fault = `the claims lock ${lock} is held too long`;
      else {
        const owner = lockOwner(lock);
        if (abandoned(lock, owner)) fault = takeLock(lock, owner);
        if (!fault) await new Promise((r) => setTimeout(r, 20));
      }
      continue;
    }
    try {
      writeFileSync10(join15(lock, LOCK_OWNER), `${token}
`, { mode: 384 });
    } catch (e) {
      fault = e.message;
      rmSync(lock, { recursive: true, force: true });
    }
    break;
  }
  if (fault) {
    log(`satellite claims unavailable — the board alone picks the name: ${fault}`);
    return [fn(() => true), fault];
  }
  let unwritten = null;
  let value;
  try {
    value = fn((name2) => {
      try {
        return claimName(name2);
      } catch (e) {
        unwritten = `claim not written: ${e.message}`;
        log(`satellite ${unwritten}`);
        return true;
      }
    });
  } catch (e) {
    if (lockOwner(lock) === token) takeLock(lock, token);
    throw e;
  }
  const lost = lockOwner(lock) === token ? takeLock(lock, token) : `the claims lock ${lock} is no longer ours — left as it is; another bridge may have picked at the same time`;
  if (lost) log(`satellite ${lost}`);
  return [value, unwritten ?? lost];
}
function pickSatellite(entries2, of, karta, led, claim = () => true) {
  const address = of.startsWith("@") && of.includes(":") ? of : null;
  const base = address ? nameOf(address) : of.replace(/^@/, "");
  const fault = base ? nameFault(base) : sw().empty();
  if (fault) return { ok: false, refusal: sw().notSeatName(of, fault) };
  const callers = entries2.filter(
    (e) => address ? e.address === address : nameOf(e.address) === base
  );
  if (!callers.length) return { ok: false, refusal: sw().noCaller(of) };
  const same2 = callers.length > 1 ? callers.filter((e) => e.karta === normKarta(karta)) : callers;
  if (same2.length !== 1) return { ok: false, refusal: sw().ambiguous(callers.length, base) };
  const caller = same2[0].address;
  const callerKarta = same2[0].karta;
  const callerId = same2[0].id;
  const notes = [];
  if (led && isSatelliteOf(base, led)) {
    const word3 = sw().alreadyHolds(led);
    log(word3);
    notes.push(word3);
    return { ok: true, name: led, caller, callerKarta, callerId, notes };
  }
  const taken2 = new Set(entries2.map((e) => nameOf(e.address)));
  for (let n = 1; n <= 99; n++) {
    const name2 = satelliteName(base, n);
    if (taken2.has(name2) || !claim(name2)) continue;
    if (!name2.startsWith(`${base}.`)) notes.push(sw().nameCut(base, n, NAME_MAX, name2));
    return { ok: true, name: name2, caller, callerKarta, callerId, notes };
  }
  return { ok: false, refusal: sw().allTaken(caller) };
}
async function satelliteGate(a, realm, karta, asked) {
  const of = typeof a.satellite_of === "string" ? a.satellite_of.trim() : "";
  const refuse2 = (refusal2) => ({ ok: false, refusal: refusal2 });
  if (CFG.satellite && !of) return refuse2(sw().needSatelliteOf());
  if (!of) return null;
  if (!CFG.satellite) return refuse2(sw().notSatellite());
  if (asked || a.take === true || typeof a.room === "string" && a.room.trim())
    return refuse2(sw().derivesName());
  const b = await callTool(tool("channel"), { action: "list", realm });
  if (b.isError) return refuse2(sw().boardUnread(short(b.text)));
  const s2 = state.standing;
  const led = s2 && !otherRealm(s2.realm, realm) ? s2.name ?? null : null;
  const { entries: entries2 } = readBoard(b);
  const [pick3, unsure] = await underClaimLock(
    (claim) => pickSatellite(entries2, of, karta, led, claim)
  );
  if (!pick3.ok) return pick3;
  if (unsure && pick3.name !== led) pick3.notes.push(sw().claimsUnsure(unsure, pick3.name));
  if (!pick3.callerId) {
    const k = await callTool(tool("channel"), { action: "list", realm, karta: pick3.callerKarta });
    if (!k.isError)
      pick3.callerId = readBoard(k).entries.find((e) => e.address === pick3.caller)?.id ?? null;
  }
  noteSatelliteOf(pick3.caller, pick3.callerId);
  pick3.notes.push(sw().seat(pick3.caller, normKarta(karta), SATELLITE_TTL_S));
  if (!pick3.callerId) pick3.notes.push(sw().noCallerId(pick3.caller));
  return pick3;
}
var ttlRefused = (a) => a.refusal?.rule ? a.refusal.rule === "ttl_out_of_range" : /ttl/i.test(a.text) || /(^|\D)4\d\d(\D|$)/.test(a.text);
var PLACE_ACTIONS2 = /* @__PURE__ */ new Set(["connect", "mint", "register", "revoke"]);
function satelliteChannelRefusal(args) {
  if (!CFG.satellite) return null;
  const action = String(args.action ?? "");
  if (!PLACE_ACTIONS2.has(action)) return null;
  const s2 = state.standing;
  const own = s2?.name ?? "";
  if (!s2 || !SUB_RE.test(own)) return sw().bypass(action);
  const sameRealm2 = !otherRealm(args.realm, s2.realm);
  const karta = normKarta(args.karta ?? s2.karta);
  const target = action === "revoke" ? args.channel != null ? null : String(args.standing ?? "") : String(args.name ?? "").trim();
  const mine = target != null && (target === own || target.endsWith(`:${own}`) || action === "revoke" && target === "mine");
  if (sameRealm2 && karta === normKarta(s2.karta) && mine) return null;
  return sw().onlyOwn(action, own, normKarta(s2.karta), s2.realm);
}
var satelliteListenWord = () => sw().listen(SATELLITE_TTL_S);

// js/bridge/usagefields.ts
var SPENT = ["tokens", "input", "output", "cache_read", "cache_write"];
var num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : void 0;
function usageOf(p) {
  const u = {};
  for (const k of SPENT) {
    const v = num(p[k]);
    if (v !== void 0) u[k] = v;
  }
  if (typeof p.model === "string" && p.model.trim()) u.model = p.model.trim().slice(0, 120);
  const context2 = num(p.context);
  const window = num(p.window);
  if (context2 !== void 0) u.context = context2;
  if (window) u.window = window;
  if (context2 !== void 0 && window) u.percent = Math.round(100 * context2 / window);
  return Object.keys(u).length ? { ...u, at: (/* @__PURE__ */ new Date()).toISOString() } : null;
}
function moved(a, b) {
  if (!a) return true;
  if (a.percent !== void 0 && b.percent !== void 0 && Math.abs(b.percent - a.percent) >= 5)
    return true;
  if (b.tokens !== void 0 && (a.tokens === void 0 || b.tokens >= a.tokens * 1.1 + 1))
    return true;
  return a.window !== b.window || b.model !== void 0 && a.model !== b.model;
}

// js/bridge/usage.ts
var MIN_GAP_MS = Number(process.env[envName("USAGE_GAP_MS")] || 6e4);
var FLUSH_CAP_MS = Number(process.env[envName("CASE_LEAVE_MS")]) || 1500;
var U = scoped(() => ({
  published: null,
  latest: null,
  at: 0
}));
var isUsageCall = (msg) => msg?.method === method("usage");
function usagePlace() {
  const s2 = state.standing;
  return s2 && !isParked(s2.realm, s2.karta, s2.name ?? "") ? s2 : null;
}
async function publish(place, u) {
  U.at = Date.now();
  const got = await replayRegister(place, false);
  const ok = !!got && !got.error && !got.result?.isError;
  if (ok) {
    U.published = u;
  } else
    log(
      `usage: register did not take the attrs this time — ${JSON.stringify(got?.error ?? got?.result ?? null).slice(0, 200)}`
    );
  return ok;
}
async function runUsage(msg) {
  const answer2 = (result) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result
  });
  if (!HOSTED_CLIENTS.has(harnessName()))
    return answer2({
      pushed: false,
      usage: null,
      why: words(USAGE).notHosted()
    });
  const u = usageOf(msg.params ?? {});
  if (!u)
    return answer2({
      pushed: false,
      usage: null,
      why: words(USAGE).noNumbers()
    });
  U.latest = u;
  rememberUsage(u);
  const s2 = usagePlace();
  const due = !!s2 && Date.now() - U.at >= MIN_GAP_MS && (moved(U.published, u) || skillsNeedRegister(s2));
  return answer2({ pushed: due && s2 ? await publish(s2, u) : false, usage: u });
}
async function flushUsage(place) {
  const u = U.latest;
  if (!place || !u || u === U.published && !skillsNeedRegister(place)) return;
  let timer;
  const cap = new Promise((r) => timer = setTimeout(() => r("cap"), FLUSH_CAP_MS));
  const sent = publish(place, u).catch((e) => {
    log(`usage: the last snapshot did not land before the place went — ${e.message}`);
    return false;
  });
  const got = await Promise.race([sent, cap]);
  clearTimeout(timer);
  if (got === "cap")
    log(`usage: the last snapshot exceeded ${FLUSH_CAP_MS} ms before the place went`);
}

// js/bridge/leave.ts
var DEAF_MS = Number(process.env[envName("BRIDGE_DEAF_MS")]) || 15 * 6e4;
var TICK_MS = Math.min(6e4, Math.max(200, Math.floor(DEAF_MS / 5)));
var clearedLine = (st) => st.ok ? words(LEAVE).cleared() : words(LEAVE).notCleared(st.body);
var deafWithoutListener = () => !notifiedClient();
var K = scoped(() => ({
  /** Busy line cleared by the leave — restored with the seat. */
  status: "",
  /** Busy lines of seats in other graphs cleared by the same leave — each to its seat (#5838). */
  beside: []
}));
async function leaveStanding(reason, byWord = false) {
  const W4 = words(LEAVE);
  if (byWord && CFG.satellite) return leaveSatellite(reason);
  const beside = heldPlaces().filter((p) => !p.primary).map((p) => ({ realm: p.realm, text: readHoldRecord(p.key)?.status ?? "" })).filter((k) => k.text);
  const leaving = heldPlaces().map((p) => p.key);
  if (leaving.length) await flushUsage(usagePlace());
  const parked = parkStanding(reason);
  if (!parked) return W4.notHolding();
  K.beside = beside;
  K.status = publishedStatus();
  const st = await publishStatus("", void 0, true);
  if (st.ok && K.status) rememberStatus(K.status);
  if (byWord) for (const k of leaving) markLeft(k, true);
  const line = clearedLine(st);
  log(`left the standing: ${reason}; ${line}`);
  const which2 = leaving.length > 1 ? W4.seats(leaving.join(", ")) : W4.seat(parked);
  return byWord ? W4.leftByWord(which2, line) : W4.left(which2, line);
}
async function leaveSatellite(reason) {
  const W4 = words(LEAVE);
  const place = heldPlaces()[0]?.key;
  if (!place) return W4.notHolding();
  await flushUsage(usagePlace());
  const st = await publishStatus("", void 0, true);
  releaseStanding(`${reason}: ${W4.satelliteReleased()}`, true, false, true);
  releaseSatelliteClaims();
  const line = clearedLine(st);
  log(`left the satellite place: ${reason}; ${line}`);
  return W4.leftSatellite(place, line);
}
function returnToStanding(how2) {
  if (!resumeStanding()) return false;
  for (const p of heldPlaces()) markLeft(p.key, false);
  const text2 = words(LEAVE).returned(how2, K.status);
  log(text2);
  if (K.status) {
    const line = K.status;
    K.status = "";
    void publishStatus(line).then((st) => {
      if (!st.ok) log(`busy line not restored after the return: ${st.body}`);
    });
  }
  for (const k of K.beside.splice(0))
    void publishStatus(k.text, k.realm).then((st) => {
      if (!st.ok) log(`busy line of ${k.realm} not restored after the return: ${st.body}`);
    });
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "info", logger: LOGGERS.channel, data: { kind: "note", text: text2 } }
  });
  return true;
}
async function heardOnReturn() {
  if (!H2.unheard || await awaitHello(4e3)) return;
  const why = words(LEAVE).noHello();
  log(why);
  H2.deafKey = H2.currentKey;
  releaseStanding(why, false, false, true);
}
function startDeafnessWatch() {
  onListenerAttached(
    () => setTimeout(() => {
      if (localListeners() > 0) returnToStanding(words(LEAVE).watchdogAttached());
    }, 300).unref()
  );
  setInterval(() => {
    const since = listenerIdleSince();
    if (since == null || !deafWithoutListener()) return;
    if (Date.now() - since < DEAF_MS) return;
    const s2 = state.standing;
    if (!s2 || !holdsStanding(s2.realm, s2.karta, s2.name ?? "")) return;
    const min = Math.round(DEAF_MS / 6e4);
    void leaveStanding(words(LEAVE).nobodyListens(min));
  }, TICK_MS).unref();
}
function namesOwnSeat(standing) {
  const s2 = state.standing;
  if (!s2) return false;
  const address = H2.door?.address ?? null;
  if (standing === ledKey() || standing === address) return true;
  if (standing.startsWith("@")) return false;
  return !!s2.name && nameOf(standing) === s2.name;
}
function localLeave(msg) {
  if (msg?.method !== "tools/call" || msg?.params?.name !== tool("channel")) return null;
  if (msg.params?.arguments?.action !== "leave") return null;
  const realm = msg.params.arguments.realm;
  const answer2 = (text2, isError = false) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...isError ? { isError: true } : {}, content: [{ type: "text", text: text2 }] }
  });
  return (async () => {
    const W4 = words(LEAVE);
    await resolveAgainstLed(realm);
    const unresolved2 = unresolvedRefusal(realm);
    if (unresolved2) return answer2(unresolved2, true);
    const beside = besideKeyIn(realm);
    if (beside)
      return answer2(W4.refusedBeside(beside, String(ledKey()), state.standing?.realm), true);
    if (state.standing && otherRealm(realm, state.standing.realm))
      return answer2(W4.refusedOther(String(realm), String(ledKey()), state.standing.realm), true);
    const named = msg.params.arguments.standing;
    if (typeof named === "string" && named.trim() && !namesOwnSeat(named.trim()))
      return answer2(W4.refusedNamed(named.trim(), H2.door?.address ?? ledKey()), true);
    return answer2(await leaveStanding(W4.byDoerWord(), true));
  })();
}

// js/bridge/besideback.ts
import { existsSync as existsSync4, readdirSync as readdirSync7, readFileSync as readFileSync18 } from "node:fs";
import { join as join16 } from "node:path";
function besideRecords(url, primary) {
  const dir2 = standingsDirOf(CFG.authDir);
  if (!existsSync4(dir2)) return [];
  const out7 = [];
  for (const f of readdirSync7(dir2).filter((x) => x.endsWith(".hold"))) {
    try {
      const raw = JSON.parse(readFileSync18(join16(dir2, f), "utf8"));
      if (!raw || raw.url !== url || raw.client !== harnessName()) continue;
      if (sameRealm(primary.realm, raw.realm)) continue;
      const rec5 = readHoldRecord(keyOf(raw.realm, raw.karta, raw.name));
      if (rec5 && !rec5.left) out7.push(rec5);
    } catch {
    }
  }
  return out7;
}
async function resolveRecord(hello, rec5, primary) {
  if (resolvedRealm(rec5.realm)) return;
  const listed = Array.isArray(hello?.standings) ? hello.standings : [];
  const fits = listed.filter(
    (e) => typeof e.realm === "string" && !sameRealm(e.realm, primary.realm) && String(e.standing ?? "").replace(/^.*:/, "") === rec5.name && (e.karta_seq == null || String(e.karta_seq) === String(rec5.karta))
  );
  if (fits.length === 1 && resolvedRealm(primary.realm))
    learnRealm(rec5.realm, String(fits[0].realm));
  else await resolveAgainstLed(rec5.realm);
}
async function besideBack(url, primary) {
  if (CFG.satellite) return;
  const recs = besideRecords(url, primary);
  if (!recs.length) return;
  const hello = await awaitHello(0);
  for (const rec5 of recs) {
    const key2 = keyOf(rec5.realm, rec5.karta, rec5.name);
    await resolveRecord(hello, rec5, primary);
    if (!otherRealm(primary.realm, rec5.realm)) {
      log(`seat beside ${key2}: its graph is not known as another one — not registered`);
      continue;
    }
    const r = await callTool(tool("channel"), {
      action: "register",
      realm: rec5.realm,
      karta: rec5.karta,
      name: rec5.name,
      ...placeFields(rec5)
    });
    standingLog(r.isError ? `beside not resumed ${key2}` : `resumed-from-disk beside ${key2}`);
    log(
      `seat beside ${key2} with the main one: ${r.isError ? `not back — ${short(r.text)}` : "back"}`
    );
  }
}

// js/bridge/holdkeep.ts
function keepHoldRecord() {
  const s2 = state.standing;
  const key2 = H2.currentKey;
  if (!s2 || !key2 || !H2.currentUrl) return;
  const alive6 = !!H2.holder?.alive;
  const at2 = alive6 ? Date.now() : Math.max(H2.holder?.heardAt ?? 0, H2.heardAt);
  const ch = { url: H2.currentUrl, statusUrl: H2.currentStatusUrl, cwd: H2.standCwd };
  const was = readHoldRecord(key2, true);
  if (was && at2 > (was.at ?? 0))
    writeHoldRecord(
      key2,
      {
        ...was,
        realm: s2.realm,
        karta: s2.karta,
        name: s2.name ?? "",
        url: ch.url,
        statusUrl: ch.statusUrl,
        cwd: ch.cwd ?? was.cwd,
        client: harnessName(),
        key: key2
      },
      false,
      at2
    );
  if (!alive6) return;
  for (const p of extraPlaces()) {
    const r = readHoldRecord(p.door.key, true);
    if (r) rememberExtraStatus(p.door.key, { ...ch, cwd: ch.cwd ?? r.cwd }, r.status ?? "");
  }
}
function signHeldRecord() {
  const key2 = H2.currentKey;
  if (!key2 || !H2.holder?.alive || !sessionOfBridge()) return;
  for (const k of [key2, ...extraPlaces().map((p) => p.door.key)]) {
    const rec5 = readHoldRecord(k);
    if (rec5 && !rec5.session && rec5.url === H2.currentUrl) writeHoldRecord(k, rec5);
  }
}

// js/bridge/lostplaces.ts
function placeWord(msg) {
  if (msg.method !== "notifications/message" || msg.params?.logger !== LOGGERS.channel) return null;
  const data = msg.params?.data;
  const realm = typeof data?.place?.realm === "string" ? data.place.realm.trim() : "";
  return typeof data?.kind === "string" ? { kind: data.kind, key: typeof data.key === "string" ? data.key : void 0, realm } : null;
}
var harnessSession = null;
function seeSession(msg) {
  const s2 = msg.params?.session;
  if ((msg.method === method("resume") || msg.method === method("check")) && typeof s2 === "string")
    harnessSession = s2.trim() || harnessSession;
  return msg;
}
var THIN_RESUME_ID = `${ID_PREFIX}thin-resume-`;
var resumeParams = (key2) => harnessSession ? { key: key2, session: harnessSession } : { key: key2 };
var resumeCall = (key2, n) => ({
  jsonrpc: "2.0",
  id: `${THIN_RESUME_ID}${n}`,
  method: method("resume"),
  params: resumeParams(key2)
});
function lostPlaces(say2, log3) {
  const live = /* @__PURE__ */ new Map();
  const lost = /* @__PURE__ */ new Map();
  return {
    live,
    /**
     * The seat is taken again (held, beside) — its refusal lifted. A satellite's loss is
     * lifted by any satellite seat of the same graph: the bridge picks the .sub-N name.
     */
    regained(k, realm) {
      live.set(k, realm);
      for (const [lk, e] of lost)
        if (lk === k || e.satellite && sameRealm(e.realm, realm)) lost.delete(lk);
    },
    /** `stopped` — the owner took the seat off (#7439): `why` is the stop word, no retake advice. */
    lose(k, realm, why, satellite, stopped = false) {
      const text2 = stopped ? why : satellite ? words(LOST).satellite(k) : words(LOST).seat(k, realm, why);
      lost.set(k, { realm, satellite, text: text2 });
      live.delete(k);
      log3(text2);
      say2({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: {
          level: "warning",
          logger: LOGGERS.channel,
          data: { kind: stopped ? "stopped" : "lost", key: k, text: text2 }
        }
      });
    },
    /** The thin bridge decides by it whether to learn graph names. */
    lostCount() {
      return lost.size;
    },
    /**
     * Fold a seat word reaching the thin bridge; returns heldKey after it. held with
     * another key drops the old key from live, else the next break would call it lost.
     * released from the daemon session while the harness lives is a daemon ending
     * without successor, not the agent leaving: the key stays so the takeover resumes
     * the seat by its hold record. The agent's real leave goes through the thin
     * bridge's own leave; death and eviction come as dead and evicted.
     */
    seen(place, heldKey2, daemonSession) {
      if ((place?.kind === "held" || place?.kind === "beside") && place.key) {
        if (place.kind === "held") {
          if (heldKey2 && heldKey2 !== place.key) live.delete(heldKey2);
          heldKey2 = place.key;
        }
        this.regained(place.key, place.realm);
      } else if (place?.kind === "beside-gone" && place.key) live.delete(place.key);
      else if (place && ["released", "dead", "evicted", "stopped"].includes(place.kind) && (!place.key || place.key === heldKey2) && !(place.kind === "released" && daemonSession)) {
        if (heldKey2) live.delete(heldKey2);
        heldKey2 = null;
      }
      return heldKey2;
    },
    /**
     * Refusal of a tool call for a lost seat; null — let it pass. Only calls into a
     * lost graph; an unresolved name is refused asking for the full address (#5838).
     * The refusal carries the call's graph, not the first loss found.
     */
    refusal(msg) {
      if (!lost.size || msg.method !== "tools/call" || msg.params?.name === tool("stand"))
        return null;
      const r = msg.params?.arguments?.realm;
      if (typeof r !== "string" || !r.trim()) return null;
      const hit = [...lost.entries()].find(([, e]) => realmRelation(r, e.realm) === "same");
      if (hit) return hit[1].text;
      if ([...live.values()].some((x) => realmRelation(r, x) === "same")) return null;
      return [...lost.values()].some((e) => realmRelation(r, e.realm) === "unknown") ? unresolvedWord(r, [...live.values()]) : null;
    }
  };
}
function realmListAsk() {
  const asked = /* @__PURE__ */ new Set();
  return {
    /** The list call when losses exist; null — no losses or a call already in flight. */
    ask(lostCount, id) {
      if (!lostCount || asked.size) return null;
      const call = {
        jsonrpc: "2.0",
        id: id(),
        method: "tools/call",
        params: { name: tool("realm"), arguments: { action: "list" } }
      };
      asked.add(JSON.stringify(call.id));
      return call;
    },
    /** The answer to the own list call: true — consumed. */
    reply(msg, log3) {
      if (msg.method !== void 0 || msg.id === void 0 || msg.id === null) return false;
      if (!asked.delete(JSON.stringify(msg.id))) return false;
      const content = msg.result?.content;
      const text2 = (Array.isArray(content) ? content : []).map((c) => String(c?.text ?? "")).join("\n");
      if (msg.error || msg.result?.isError)
        log3(
          `the realm list came back refused instead of the list — rN and slugs stay unresolved: ${text2 || msg.error?.message || "?"}`
        );
      learnRealmList(text2);
      return true;
    },
    /** No answer will come (link broke) — allow asking again. */
    forget() {
      asked.clear();
    }
  };
}

// js/bridge/resumepick.ts
import { existsSync as existsSync5, readdirSync as readdirSync8, readFileSync as readFileSync19 } from "node:fs";
import { join as join17 } from "node:path";
function recordsFor(sel) {
  const dir2 = standingsDirOf(CFG.authDir);
  if (!existsSync5(dir2)) return { own: [], sameDir: [], legacy: [], left: [], neighbour: [] };
  const mine = harnessName();
  const led = ledKey();
  const byKey = [];
  const byCwd = [];
  const sameDir2 = [];
  const legacy = [];
  const left2 = [];
  const neighbour = [];
  for (const f of readdirSync8(dir2).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec5 = JSON.parse(readFileSync19(join17(dir2, f), "utf8"));
      if (!rec5 || rec5.client !== mine) continue;
      const key2 = keyOf(rec5.realm, rec5.karta, rec5.name);
      const keyed2 = !!sel.key && key2 === sel.key;
      const inDir = sameDir(rec5.cwd, sel.cwd);
      const stoodBy = !!sel.session && rec5.session === sel.session;
      if (!keyed2 && !inDir && !stoodBy) continue;
      const fresh2 = readHoldRecord(key2);
      if (!fresh2) continue;
      if (inDir) sameDir2.push(key2);
      if (fresh2.left) {
        left2.push(key2);
        continue;
      }
      const stoodHere = key2 === led || !!sel.session && fresh2.session === sel.session;
      const theirs = !!sel.session && !!fresh2.session && fresh2.session !== sel.session;
      if (keyed2 && theirs) neighbour.push(key2);
      else if (keyed2) byKey.push(fresh2);
      else if (stoodHere) byCwd.push(fresh2);
      else if (!fresh2.session) legacy.push(fresh2);
    } catch {
    }
  }
  return {
    own: [...byKey, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))],
    sameDir: sameDir2,
    legacy,
    left: left2,
    neighbour
  };
}

// js/bridge/resumewords.ts
var resumeWords = new Proxy({}, {
  get: (_, k) => words(RESUME)[k]
});

// js/bridge/refusal.ts
function refusalOf(reply2) {
  const r = reply2?.result?._meta?.[serverProtocol.refusal];
  if (!isObj(r) || !is.str(r.rule) || !is.num(r.status)) return null;
  return {
    ...typeof r.rule === "string" ? { rule: r.rule } : {},
    ...typeof r.status === "number" ? { status: r.status } : {},
    ...isObj(r.data) ? { data: r.data } : {}
  };
}
var SEAT_GONE_RULES = /* @__PURE__ */ new Set([
  "standing_already_ended",
  "standing_not_found",
  "standing_not_held"
]);
var seatAlreadyOff = (r) => !!r && (!!r.rule && SEAT_GONE_RULES.has(r.rule) || r.status === 410 || r.status === 404 && !r.rule);
var standingsInRealm = (r) => {
  if (r?.rule !== "channel_already_stands_in_realm") return [];
  const list3 = r.data?.your_standings;
  return Array.isArray(list3) ? list3.flatMap(
    (s2) => isObj(s2) && typeof s2.name === "string" && s2.name ? [s2.name] : []
  ) : [];
};
var openedConcurrently = (reply2) => {
  const r = reply2?.result?.isError ? refusalOf(reply2) : null;
  return !!r && !r.rule && r.status === 409;
};

// js/bridge/caseexit.ts
var LEAVE_CAP_MS = Number(process.env[envName("CASE_LEAVE_MS")]) || 1500;
var joined = scoped(() => /* @__PURE__ */ new Map());
var roomNo = (room) => room.replace(/^[#\u2116]\s*/, "");
function noteCaseEntry(name2, args, reply2) {
  if (reply2.result?.isError || name2 !== tool("case")) return;
  const a = args ?? {};
  if (a.action !== "join" && a.action !== "leave") return;
  const room = typeof a.room === "string" ? a.room.trim() : "";
  if (!room || a.action === "join" && room.startsWith("-")) return;
  const realm = typeof a.realm === "string" ? a.realm : void 0;
  const no = roomNo(room);
  for (const [k, c] of joined)
    if (roomNo(c.room) === no && !otherRealm(c.realm, realm)) joined.delete(k);
  if (a.action === "join") joined.set(`${realm ? canonRealm(realm) : ""}#${no}`, { realm, room });
}
var joinedCases = () => [...joined.values()];
function seedJoined(cases) {
  for (const c of cases ?? [])
    if (c?.room) joined.set(`${c.realm ? canonRealm(c.realm) : ""}#${roomNo(c.room)}`, c);
}
async function leaveJoinedCases() {
  if (!CFG.satellite || !joined.size) return;
  const cases = [...joined.values()];
  joined.clear();
  const leaves = cases.map(async (c) => {
    try {
      const r = await callTool(tool("case"), { action: "leave", ...c });
      log(
        r.isError ? `could not leave case ${c.room} at the run's end: ${r.text.slice(0, 120)}` : `left case ${c.room} at the run's end (#6573)`
      );
    } catch (e) {
      log(`could not leave case ${c.room} at the run's end: ${e.message}`);
    }
  });
  if (!await underCap(Promise.allSettled(leaves)))
    log(
      `case leave at the run's end exceeded ${LEAVE_CAP_MS} ms — the place goes, the rest lapse by term`
    );
}
var satellitePlaces = () => CFG.satellite ? [
  // An evicted (4000) seat belongs to its taker: revoking it would remove theirs.
  H2.evictedKey && H2.evictedKey === H2.currentKey ? null : state.standing,
  ...extraPlaces().map((p) => p.standing)
].filter((s2) => !!s2?.name) : [];
async function revokeSatellitePlaces(places) {
  const failed = new Set(places);
  const revoked = [];
  const revokes = places.map(
    (s2) => callTool(tool("channel"), { action: "revoke", realm: s2.realm, karta: s2.karta, standing: s2.name }).then((r) => {
      const how2 = revokeOutcome(r);
      if (how2 === "failed")
        return log(`place ${s2.name} NOT revoked at the run's end: ${r.text.slice(0, 120)}`);
      failed.delete(s2);
      if (how2 === "probably")
        return log(`${s2.name} probably revoked at the run's end: ${r.text.slice(0, 120)}`);
      revoked.push({ realm: canonRealm(s2.realm), karta: normKarta(s2.karta), name: s2.name ?? "" });
      log(`revoked ${s2.name} in ${s2.realm} at the run's end (#6593)`);
    }).catch((e) => log(`place ${s2.name} NOT revoked at the run's end: ${e.message}`))
  );
  if (places.length && !await underCap(Promise.allSettled(revokes)))
    log(
      `revoke at the run's end exceeded ${LEAVE_CAP_MS} ms — the place lapses by the channel's term`
    );
  return { failed: [...new Set([...failed].map((s2) => s2.name))], revoked: [...revoked] };
}
var revokeOutcome = (r) => {
  if (!r.isError) return "confirmed";
  if (r.refusal) return seatAlreadyOff(r.refusal) ? "confirmed" : "failed";
  return CASE_EXIT_CLOSED.test(r.text) ? "probably" : "failed";
};
async function underCap(work) {
  let timer;
  const cap = new Promise((r) => timer = setTimeout(() => r("cap"), LEAVE_CAP_MS));
  const got = await Promise.race([work, cap]);
  clearTimeout(timer);
  return got !== "cap";
}

// js/bridge/pauserecord.ts
var P2 = scoped(() => ({
  kind: null,
  /** the pause answer for a repeated request (already paused, seat released) */
  answer: null,
  /** the address turned by the re-arm connect (a lost ceiling too) */
  turned: null,
  /** the address last written into the pause record */
  written: "",
  write: null,
  connect: null
}));
var suspended = () => P2.kind !== null;
var handoverPauseKey = () => P2.kind === "handover" ? P2.answer?.key ?? null : null;
function pauseForHandover(why) {
  if (P2.kind) return;
  const key2 = pauseRecord("handover");
  if (key2)
    log(
      `satellite paused for the daemon handover (${why}): ${key2}, cases ${P2.answer?.cases ?? 0} — place and cases kept`
    );
}
function pauseRecord(kind) {
  const s2 = state.standing;
  const { currentKey: key2, currentUrl: url, currentStatusUrl: statusUrl2 } = H2;
  if (!CFG.satellite || !s2?.name || !key2 || !url) return null;
  const write = () => {
    const at2 = P2.turned ?? { url, statusUrl: statusUrl2 };
    const cases = joinedCases();
    P2.written = at2.url;
    P2.answer = { key: key2, cases: cases.length };
    writeHoldRecord(
      key2,
      {
        realm: s2.realm,
        karta: s2.karta,
        name: s2.name ?? "",
        url: at2.url,
        statusUrl: at2.statusUrl,
        client: harnessName(),
        key: key2,
        session: sessionOfBridge() ?? void 0,
        cases
      },
      true
    );
  };
  P2.write = write;
  write();
  P2.kind = kind;
  return key2;
}

// js/bridge/suspend.ts
function localSuspend(msg) {
  if (msg?.method !== method("suspend")) return null;
  const answer2 = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  const s2 = state.standing;
  const drained = P2.kind === "handover";
  if (drained) P2.kind = "suspend";
  else if (P2.kind && P2.answer) return Promise.resolve(answer2({ suspended: true, ...P2.answer }));
  const key2 = drained ? P2.answer?.key ?? null : pauseRecord("suspend");
  if (!key2 || !s2)
    return Promise.resolve(
      answer2({
        suspended: false,
        word: words(SUSPEND).noSeat()
      })
    );
  return rearmForPause(s2, drained).then((rearmed) => {
    if (rearmed) P2.write?.();
    log(
      `satellite paused for a plugin reload${drained ? " in the daemon handover" : ""}: ${key2}, cases ${P2.answer?.cases ?? 0} — place and cases kept, idle window ${rearmed ? `${PAUSE_TTL_S} s` : "unchanged"}`
    );
    return answer2({ suspended: true, ...P2.answer });
  });
}
var PAUSE_TTL_S = Math.floor(HOLD_RECORD_MAX_AGE_MS / 1e3);
var REARM_CAP_MS = 1e3;
async function rearmForPause(s2, drained) {
  const name2 = s2.name ?? "";
  if (!drained && !parkStanding(words(SUSPEND).reason())) return false;
  const args = {
    action: "connect",
    realm: s2.realm,
    karta: s2.karta,
    name: name2,
    ...placeFields({ realm: s2.realm, karta: String(s2.karta), name: name2 }, false, "connect"),
    ttl_seconds: PAUSE_TTL_S
  };
  const connect5 = callTool(tool("channel"), args).then((r2) => {
    if (!r2.isError && H2.currentUrl) P2.turned = { url: H2.currentUrl, statusUrl: H2.currentStatusUrl };
    if (drained) {
      releaseStanding(words(SUSPEND).reason(), false, false, false, true);
      P2.write?.();
    }
    return r2;
  });
  P2.connect = connect5;
  const r = await Promise.race([connect5, sleep(REARM_CAP_MS).then(() => null)]);
  if (!r || r.isError)
    log(`satellite pause: idle window not re-armed — ${r?.text ?? "no answer yet"}`);
  return !!r && !r.isError && !!P2.turned;
}
var SETTLE_CAP_MS = 3e3;
async function pauseSettled() {
  if (!P2.kind) return;
  if (P2.connect) await Promise.race([P2.connect.catch(() => {
  }), sleep(SETTLE_CAP_MS)]);
  const turned = !!P2.turned && P2.turned.url !== P2.written;
  P2.write?.();
  if (turned)
    log(`satellite pause: the late re-arm turned the address — the pause record follows it`);
}
function afterResume(key2) {
  if (!CFG.satellite || !key2) return;
  seedJoined(readHoldRecord(key2)?.cases);
}

// js/bridge/resume.ts
var RJ = scoped(() => ({ lapsed: false }));
function takeLapsed() {
  const was = RJ.lapsed;
  RJ.lapsed = false;
  return was;
}
async function busyBack(rec5) {
  if (!rec5.status) return "";
  const me = sessionOfBridge();
  if (!me || rec5.session !== me) {
    rememberStatus("");
    return resumeWords.busyForeign();
  }
  const st = await publishStatus(rec5.status);
  const kept2 = st.doing ?? rec5.status;
  return st.ok ? resumeWords.busyRestored(kept2) : resumeWords.busyNotRestored(short(st.body));
}
async function resumeFromDisk(realm, karta, name2) {
  const key2 = keyOf(realm, karta, name2);
  const rec5 = readHoldRecord(key2);
  if (!rec5) return null;
  if (holdsKey(key2)) return null;
  const led = ledKey();
  if (led && led !== key2) return null;
  if (await localSocketAlive(localSocketPathOf(key2))) return null;
  const prev = state.standing;
  state.standing = { realm, karta, name: name2 };
  const prevCwd = rec5.cwd ? noteStandCwd(rec5.cwd) : null;
  if (rec5.base) noteSeatBase(key2, rec5.base);
  noteResuming(1);
  try {
    holdStanding(rec5.url, rec5.statusUrl);
    const hello = await awaitHello(4e3);
    if (hello && holdsKey(key2)) {
      const pending2 = Number(hello.pending) || 0;
      const busy = await busyBack(rec5);
      log(`standing resumed from disk (${key2}), pending ${pending2}`);
      standingLog(`resumed-from-disk ${key2}: pending ${pending2}`);
      return { word: resumeWords.fromDisk(pending2, busy), pending: pending2 };
    }
  } finally {
    noteResuming(-1);
  }
  const onDisk2 = readHoldRecord(key2);
  const kept2 = onDisk2 !== null;
  log(
    kept2 ? `hold record for ${key2}: no hello in time — record kept as it was, the place is not taken` : `hold record for ${key2} is stale — dropped, the place is taken anew`
  );
  releaseStanding(holdWords().resumeFailed());
  if (onDisk2?.url === rec5.url) restoreHoldRecord(key2, rec5);
  state.standing = prev;
  if (rec5.cwd) noteStandCwd(prevCwd);
  return null;
}
async function registerBack(rec5) {
  const r = await callTool(tool("channel"), {
    action: "register",
    realm: rec5.realm,
    karta: rec5.karta,
    name: rec5.name,
    ...placeFields(rec5)
  });
  if (r.isError) return resumeWords.registerRefused(short(r.text));
  await besideBack(rec5.url, rec5);
  return "register";
}
var T3 = { takeOwn: null };
function wireTakeOwn(fn) {
  T3.takeOwn = fn;
}
var legacyWord = (names2) => names2.map((n) => resumeWords.legacy(n)).join("; ");
async function freeLegacy(recs) {
  const free = [];
  for (const r of recs) {
    const key2 = keyOf(r.realm, r.karta, r.name);
    if (!holdsKey(key2) && await localSocketAlive(localSocketPathOf(key2))) continue;
    free.push(r.name);
  }
  return free;
}
function stoppedOutcome(before, key2) {
  const word3 = stoppedSince(before, key2);
  return word3 ? { resumed: false, key: key2, stopped: true, word: word3 } : null;
}
async function backToParked(key2, how2) {
  const before = stopsNow();
  if (!returnToStanding(how2)) return { resumed: false, key: key2, word: resumeWords.failed() };
  const hello = await awaitHello(4e3);
  const stop = stoppedOutcome(before, key2);
  if (stop) return stop;
  return {
    resumed: true,
    key: key2,
    pending: Number(hello?.pending) || 0,
    word: resumeWords.returnedParked(hello ? Number(hello.pending) || 0 : null),
    own: true
  };
}
async function resumeBy(sel, register = true, takeOwn = false) {
  const { own: recs, sameDir: sameDir2, legacy: legacyRecs, left: left2, neighbour } = recordsFor(sel);
  if (!recs.length) {
    const legacy = await freeLegacy(legacyRecs);
    const said2 = [resumeWords.noRecord(sel.key, sel.cwd)];
    if (neighbour.length) said2.push(resumeWords.neighbourKey(neighbour.join(", ")));
    else if (sel.key) {
      said2.push(resumeWords.rejoin());
      RJ.lapsed = true;
    }
    const foreign = sameDir2.filter((k) => !left2.includes(k));
    if (foreign.length) said2.push(resumeWords.foreignDir(foreign.join(", ")));
    if (left2.length) said2.push(resumeWords.left(left2.join(", ")));
    if (legacy.length) said2.push(legacyWord(legacy));
    return {
      resumed: false,
      word: said2.join(" — "),
      ...legacy.length ? { legacy } : {}
    };
  }
  const led = ledKey();
  const skipped = [];
  const elsewhere = [];
  for (const rec5 of recs) {
    const key2 = keyOf(rec5.realm, rec5.karta, rec5.name);
    const before = stopsNow();
    if (holdsKey(key2))
      return { resumed: true, key: key2, pending: 0, word: resumeWords.alreadyHolding(), own: true };
    if (isParked(rec5.realm, rec5.karta, rec5.name)) return backToParked(key2, resumeWords.byRecord());
    if (led && led !== key2) {
      skipped.push(resumeWords.otherSeat(key2, led));
      continue;
    }
    const holder = await localHolder(key2, sel.cwd ?? sessionCwd());
    if (holder === "session" && takeOwn && !CFG.satellite && T3.takeOwn) {
      const said2 = await T3.takeOwn(rec5, sel.cwd);
      const stop = stoppedOutcome(before, key2);
      if (stop) return stop;
      const now2 = ledKey();
      if (now2 && holdsKey(now2)) {
        const hello = await awaitHello(4e3);
        const busy = now2 === key2 ? await busyBack(rec5) : "";
        return {
          resumed: true,
          key: now2,
          pending: Number(hello?.pending) || 0,
          word: busy ? said2.replace(/\.$/, "") + busy : said2,
          own: true
        };
      }
      skipped.push(resumeWords.ownNotTaken(key2, short(said2)));
      continue;
    }
    if (holder) {
      skipped.push(resumeWords.liveBridge(key2));
      elsewhere.push(key2);
      continue;
    }
    const me = sel.session ?? sessionOfBridge();
    const proven = !!me && rec5.session === me || key2 === led && !rec5.session;
    const { back, registered } = await withSpoolHeld(async () => {
      const b = await resumeFromDisk(rec5.realm, rec5.karta, rec5.name);
      return { back: b, registered: b && register ? await registerBack(rec5) : null };
    });
    if (!back) {
      const stop = stoppedOutcome(before, key2);
      if (stop) return stop;
      const kept2 = readHoldRecord(key2);
      skipped.push(kept2 ? resumeWords.noHello(key2) : resumeWords.stale(key2));
      if (!kept2) {
        skipped.push(resumeWords.rejoin());
        RJ.lapsed = true;
      }
      continue;
    }
    const lines = [back.word, ...registered ? [registered] : []];
    const others = [
      .../* @__PURE__ */ new Set([...recs.map((r) => keyOf(r.realm, r.karta, r.name)), ...sameDir2])
    ].filter((k) => k !== key2 && readHoldRecord(k) !== null);
    if (others.length) lines.push(resumeWords.othersInDir(others.join(", ")));
    if (!proven) lines.push(resumeWords.notYours());
    return {
      resumed: true,
      key: key2,
      pending: back.pending,
      word: lines.join("; "),
      others,
      own: proven
    };
  }
  return {
    resumed: false,
    word: resumeWords.nothingToReturn(skipped.join("; ")),
    ...elsewhere.length ? { elsewhere } : {}
  };
}
function holdFromEnv() {
  const url = envOf(envName("CHANNEL_SOCKET"))?.trim();
  if (url) holdStanding(url, envOf(envName("CHANNEL_STATUS"))?.trim() || null);
}
var reply = (msg, result) => {
  const r = result;
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: r && (r.resumed || r.holding) ? { ...r, ...seatProof(ledKey()) } : result
  };
};
var selectorOf = (msg) => ({
  key: typeof msg.params?.key === "string" && msg.params.key.trim() ? msg.params.key.trim() : void 0,
  cwd: typeof msg.params?.cwd === "string" && msg.params.cwd.trim() ? msg.params.cwd.trim() : void 0,
  session: typeof msg.params?.session === "string" && msg.params.session.trim() ? msg.params.session.trim() : void 0
});
function selectorFrom(msg) {
  const sel = selectorOf(msg);
  noteHarnessSession(sel.session);
  signHeldRecord();
  return sel;
}
var isResumeCall = (msg) => msg?.method === method("resume");
var isCheckCall = (msg) => msg?.method === method("check");
async function runResume(msg) {
  const sel = selectorFrom(msg);
  if (!sel.key && !sel.cwd) return reply(msg, { resumed: false, word: resumeWords.noKeyNoCwd() });
  const replay = typeof msg.id === "string" && msg.id.startsWith(THIN_RESUME_ID);
  const r = await resumeBy(sel, true, !replay);
  if (r.resumed) afterResume(r.key);
  return reply(msg, r);
}
async function runCheck(msg) {
  const sel = selectorFrom(msg);
  const s2 = state.standing;
  const key2 = s2 ? keyOf(s2.realm, s2.karta, s2.name ?? "") : null;
  if (!s2 || !key2 || !holdsKey(key2)) {
    if (s2 && key2 && isParked(s2.realm, s2.karta, s2.name ?? "")) {
      if (readHoldRecord(key2)?.left)
        return reply(msg, {
          holding: false,
          resumed: false,
          key: key2,
          word: resumeWords.leftByWord(key2)
        });
      const r2 = await backToParked(key2, resumeWords.watchdogReason());
      return reply(msg, { holding: r2.resumed, ...r2 });
    }
    if (!sel.key && !sel.cwd)
      return reply(msg, {
        holding: false,
        resumed: false,
        word: resumeWords.noSeatNoKeyNoCwd()
      });
    const r = await resumeBy(sel);
    return reply(msg, { holding: r.resumed, ...r });
  }
  const board = await callTool(tool("channel"), { action: "list", realm: s2.realm });
  if (board.isError)
    return reply(msg, { holding: true, key: key2, word: resumeWords.boardUnread(short(board.text)) });
  const mine = readBoard(board).entries.find(
    (e) => e.karta === String(s2.karta) && nameOf(e.address) === (s2.name ?? "")
  );
  if (!mine) return reply(msg, { holding: true, key: key2, word: resumeWords.noSeatOnBoard() });
  const pending2 = undelivered(mine);
  const listening = listens(mine);
  if (listening) {
    D.reopens = 0;
    return reply(msg, { holding: true, key: key2, listening, pending: pending2, word: resumeWords.listening() });
  }
  if (D.reopens >= REOPEN_LIMIT) {
    const text2 = resumeWords.gaveUp(key2, REOPEN_LIMIT);
    if (!D.said) {
      D.said = true;
      standingLog(`reopen ${key2}: gave up after ${REOPEN_LIMIT} — board still reads deaf`);
      emit({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "warning", logger: LOGGERS.channel, data: { kind: "lost", text: text2 } }
      });
    }
    return reply(msg, {
      holding: true,
      key: key2,
      listening,
      pending: pending2,
      reopened: false,
      stuck: true,
      word: text2
    });
  }
  D.reopens++;
  standingLog(`reopen ${key2}: board reads deaf${pending2 ? ` with ${pending2} pending` : ""}`);
  const before = stopsNow();
  parkStanding(resumeWords.deafBoard());
  resumeStanding();
  const hello = await awaitHello(4e3);
  const stop = stoppedOutcome(before, key2);
  if (stop) return reply(msg, { holding: false, ...stop });
  return reply(msg, {
    holding: true,
    key: key2,
    listening,
    pending: pending2,
    reopened: !!hello,
    word: resumeWords.reopened(hello ? Number(hello.pending) || 0 : null)
  });
}
var D = scoped(() => ({ reopens: 0, said: false }));
var REOPEN_LIMIT = 2;

// js/bridge/separate.ts
var sep2 = () => words(SEPARATE);
var baseOf2 = (realm, karta, name2) => seatBaseOf(keyOf(realm, karta, name2)) ?? name2;
var suffixed = (base, n) => base.slice(0, NAME_MAX - `.${n}`.length).replace(/[-._]+$/, "") + `.${n}`;
async function ownByRecord(realm, karta, name2, cwd) {
  const key2 = keyOf(realm, karta, name2);
  const rec5 = readHoldRecord(key2);
  const me = sessionOfBridge();
  if (!rec5) return false;
  const mine = me ? rec5.session === me || unsignedHere(rec5, cwd) : !rec5.session && rec5.client === harnessName() && sameDir(rec5.cwd, cwd);
  return mine && !await localSocketAlive(localSocketPathOf(key2));
}
var isTaken = (h) => h === "live" || h === "record" || h === "board" || h === "taken";
async function holderOf(realm, karta, name2, hearing, cwd) {
  await heardOnReturn();
  if (holdsStanding(realm, karta, name2) || isParked(realm, karta, name2)) return "mine";
  if (wasEvicted(realm, karta, name2)) return "board";
  const key2 = keyOf(realm, karta, name2);
  if (ledKey() === key2) return "mine";
  const local = await localHolder(key2, cwd);
  if (local) return local === "self" ? "mine" : local === "session" ? "session" : "live";
  if (theirsByRecord(key2)) return "record";
  const h = hearing(name2);
  if (h === "unknown") return "unknown";
  return h === "other" && !await ownByRecord(realm, karta, name2, cwd) ? "board" : "free";
}
function theirsByRecord(key2) {
  const rec5 = readHoldRecord(key2);
  return !!rec5?.session && !rec5.left && rec5.session !== sessionOfBridge();
}
async function placeFor(realm, karta, base, hearing, cwd, taken2 = /* @__PURE__ */ new Set(), root = base) {
  const holder = async (name2) => taken2.has(name2) ? "taken" : await holderOf(realm, karta, name2, hearing, cwd);
  const first2 = await holder(base);
  if (first2 === "unknown") return { refusal: sep2().unknown(base) };
  if (!isTaken(first2)) {
    const own = first2 === "session";
    return { name: base, own, note: own ? sep2().ownSession(base) : null };
  }
  const kin = first2 === "taken" ? null : first2;
  for (let n = 2; n <= 99; n++) {
    const cand = suffixed(root, n);
    if (cand === base) continue;
    const h = await holder(cand);
    if (isTaken(h)) continue;
    if (h === "unknown") return { refusal: sep2().unknown(cand) };
    const own = h === "session";
    return { name: cand, own, kin, note: sep2().beside(base, cand, own, kin) };
  }
  return { refusal: sep2().noFree(base) };
}
async function seatFor(realm, karta, base, hearing, besideRealm, cwd, root = base) {
  const taken2 = /* @__PURE__ */ new Set();
  for (; ; ) {
    const choice = await placeFor(realm, karta, base, hearing, cwd, taken2, root);
    if ("refusal" in choice || choice.own || besideRealm) return { choice, resumed: null };
    const at2 = choice.name;
    if (hearing(at2) !== "other" || !await ownByRecord(realm, karta, at2, cwd))
      return { choice, resumed: null };
    const resumed = await resumeFromDisk(realm, karta, at2);
    if (resumed)
      return {
        choice: at2 === base ? choice : { ...choice, note: sep2().beside(base, at2, true, choice.kin ?? null) },
        resumed
      };
    taken2.add(at2);
  }
}

// js/bridge/taking.ts
import { mkdirSync as mkdirSync11, readFileSync as readFileSync20, unlinkSync as unlinkSync12, writeFileSync as writeFileSync11 } from "node:fs";
import { dirname as dirname9 } from "node:path";
var pathOf = (key2) => takingFilePathOf(CFG.authDir, key2);
var alive3 = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
function takerOf(key2) {
  try {
    const t = JSON.parse(readFileSync20(pathOf(key2), "utf8"));
    return typeof t.session === "string" && alive3(t.pid) ? t.session : null;
  } catch {
    return null;
  }
}
var OWN = scoped(() => /* @__PURE__ */ new Map());
var ownTaking = (key2) => OWN.get(key2) ?? null;
function writeIntent(key2) {
  const session = sessionOfBridge();
  if (!session || CFG.satellite) return () => {
  };
  const path = pathOf(key2);
  try {
    mkdirSync11(dirname9(path), { recursive: true, mode: 448 });
    writeFileSync11(path, JSON.stringify({ session, pid: process.pid }) + "\n", { mode: 384 });
  } catch {
    return () => {
    };
  }
  return () => {
    try {
      unlinkSync12(path);
    } catch {
    }
  };
}
function beginTaking(args) {
  const action = String(args.action);
  const realm = typeof args.realm === "string" ? args.realm.trim() : "";
  if (!realm || action !== "connect" && action !== "mint") return () => {
  };
  const name2 = normName(args.name);
  const key2 = keyOf(realm, seatKarta(realm, args.karta, name2), name2);
  let settle2 = () => {
  };
  const done = new Promise((res) => settle2 = res);
  OWN.set(key2, done);
  const unfile = writeIntent(key2);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    if (OWN.get(key2) === done) OWN.delete(key2);
    unfile();
    settle2();
  };
}
async function takingSeat(args, fn) {
  const end = beginTaking(args);
  try {
    return await fn();
  } finally {
    end();
  }
}

// js/bridge/evicted.ts
var LOOK_MS = 100;
var RETRY_MS = 2e3;
function announceEvicted(code, text2) {
  log(text2);
  const ev = { kind: "evicted", code, text: text2 };
  H2.evictedEvent = ev;
  broadcast(ev);
  notify("warning", ev);
}
async function takenBySession(key2, url) {
  const me = sessionOfBridge();
  const ours = (r) => me ? r.session === me : !!r.session && r.client === harnessName() && sameDir(r.cwd, H2.standCwd ?? void 0);
  const changed = () => {
    const r = readHoldRecord(key2, true);
    return r && r.url !== url ? ours(r) : null;
  };
  for (; ; ) {
    const got = changed();
    if (got !== null) return got;
    const taker = takerOf(key2);
    if (me ? taker !== me : !taker) return changed() ?? false;
    await new Promise((res) => setTimeout(res, LOOK_MS));
  }
}
async function standBeside(key2, s2, name2, beside, once = false) {
  let moved2 = false;
  let reopened = false;
  let retry = once;
  for (; ; ) {
    if (!moved2 && !wasEvicted(s2.realm, s2.karta, name2)) return null;
    try {
      return await beside(s2, H2.standCwd);
    } catch (e) {
      moved2 ||= ledKey() !== key2;
      if (e instanceof UpstreamError && e.kind === "session" && !reopened) {
        reopened = true;
        const back = await reinitialize().then(
          () => true,
          () => false
        );
        if (back) continue;
      }
      const why = e instanceof Error ? e.message : String(e);
      standingLog(`evicted ${key2}: standing beside failed (${why})${retry ? "" : " — one retry"}`);
      if (retry) return { ok: false, text: why };
      retry = true;
      await new Promise((res) => setTimeout(res, RETRY_MS));
    }
  }
}
async function yieldPlace(key2, url, code) {
  const own = ownTaking(key2);
  if (own) {
    await own;
    if (H2.currentUrl !== url) return;
  }
  const s2 = state.standing;
  const beside = B2.beside;
  if (await takenBySession(key2, url)) {
    if (ledKey() !== key2) return;
    standingLog(`evicted ${key2} by this session's new bridge — released quietly`);
    releaseStanding(holdWords().takenBySession(), false, false, true);
    return;
  }
  const name2 = s2?.name ?? "";
  if (CFG.satellite || !s2 || !name2 || !beside)
    return announceEvicted(code, holdWords().evicted(code));
  const base = baseOf2(s2.realm, s2.karta, name2);
  announceEvicted(code, holdWords().evictedBeside(code, name2, base));
  F.failed = null;
  await besideAndSay(key2, s2, name2, base, beside, [...state.places]);
}
async function besideAndSay(key2, s2, name2, base, beside, extras3, once = false) {
  const r = await standBeside(key2, s2, name2, beside, once);
  if (!r) return;
  const others = [];
  if (r.ok)
    for (const x of extras3) {
      const again = await beside(x, H2.standCwd).catch((e) => ({
        ok: false,
        text: e instanceof Error ? e.message : String(e)
      }));
      others.push(
        holdWords().besideOther(`${x.name ?? ""} (${x.realm})`, !!again?.ok, again?.text ?? "")
      );
    }
  F.failed = r.ok ? null : { key: key2, s: s2, name: name2, base, extras: extras3 };
  const text2 = [
    r.ok ? holdWords().besideDone(name2, r.text) : holdWords().besideFailed(name2, base, r.text),
    ...others
  ].join("\n");
  log(text2);
  standingLog(`evicted ${key2}: ${r.ok ? "stood beside" : "could not stand beside"}`);
  notify("warning", { kind: "resumed", text: text2 });
}
var F = scoped(() => ({
  failed: null,
  again: null,
  /** The post-eviction move in flight — a harness call awaits it. */
  pending: null
}));
async function standBesideAgain() {
  if (F.pending) await F.pending;
  const s2 = state.standing;
  if (!s2 || !wasEvicted(s2.realm, s2.karta, s2.name ?? "")) {
    F.failed = null;
    return false;
  }
  const f = F.failed;
  const beside = B2.beside;
  if (f && beside && !F.again)
    F.again = besideAndSay(f.key, f.s, f.name, f.base, beside, f.extras, true).finally(() => {
      F.again = null;
    });
  if (F.again) await F.again;
  return !!state.standing && wasEvicted(state.standing.realm, state.standing.karta, state.standing.name ?? "");
}
function evictedRefusal(msg) {
  const s2 = state.standing;
  if (!s2 || !wasEvicted(s2.realm, s2.karta, s2.name ?? "")) return null;
  const realm = signedRealm(msg);
  if (realm == null || [s2, ...state.places].every((p) => otherRealm(realm, p.realm))) return null;
  return holdWords().evictedRefusal(s2.name ?? "", baseOf2(s2.realm, s2.karta, s2.name ?? ""));
}
var B2 = { beside: null };
whenEvicted((key2, url, code) => {
  F.pending = yieldPlace(key2, url, code).finally(() => {
    F.pending = null;
  });
});
function wireEviction(beside) {
  B2.beside = beside;
}

// js/bridge/standing.ts
var SEAT_EXPIRED = () => words(STANDING).seatExpired();
function noteStanding(msg, reply2) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel") || a?.action !== "register") return;
  if (reply2?.error || reply2?.result?.isError) return;
  const place = rememberedPlace(a.realm, a.karta, a.name);
  noteSkills(place, a.attrs?.skills);
  const prim = state.standing;
  if (prim && otherRealm(prim.realm, place.realm)) {
    rememberPlace(place);
    addPlace(place);
  } else state.standing = place;
  noteStandingId(place.realm, standingIdOf(reply2));
  state.standingSession = state.sessionId;
  debug(`standing remembered: ${a.name ?? "(unnamed)"} at karta ${a.karta} in ${a.realm}`);
}
function rememberedPlace(realm, karta, name2) {
  const k = normKarta(karta);
  const prev = [state.standing, ...state.places].find((p) => p && !otherRealm(p.realm, realm));
  const n = typeof name2 === "string" ? normName(name2) : void 0;
  return {
    realm: String(realm ?? ""),
    karta: k === "agent" && prev ? String(prev.karta) : k,
    ...n !== void 0 ? { name: n } : {}
  };
}
var R3 = scoped(() => ({ inFlight: null }));
async function ensureStanding() {
  if (state.standing && await standBesideAgain()) return;
  return replayStanding();
}
function replayStanding() {
  if (!state.standing || !state.sessionId) return Promise.resolve();
  if (state.standingSession === state.sessionId) return Promise.resolve();
  if (R3.inFlight) return R3.inFlight;
  R3.inFlight = (async () => {
    try {
      const deaf = await deafSeatTaken();
      if (deaf) return log(`standing not re-registered: ${deaf}`);
      const got = await replayRegister(state.standing);
      if (got && !got.error && !got.result?.isError) {
        if (await replayBeside()) state.standingSession = state.sessionId;
        log(`standing re-registered on the new session (${state.standing?.name ?? "unnamed"})`);
      } else if (seatIsGone(got)) {
        log(`the standing's seat is gone, forgetting it: ${replyText(got).slice(0, 200)}`);
        state.standing = null;
        releaseStanding(SEAT_EXPIRED(), true);
      } else {
        log(
          `could not re-register the standing this time, will retry before the next call: ${replyText(got).slice(0, 200)}`
        );
      }
    } catch (e) {
      log(`re-registering the standing failed: ${errorMessage(e)}`);
    } finally {
      R3.inFlight = null;
    }
  })();
  return R3.inFlight;
}
async function replayRegister(place, freshSkills = false) {
  const got = await registerOnce(place, freshSkills);
  if (!openedConcurrently(got)) return got;
  log("register refused by a concurrent opening (409, no rule) — registering again once");
  return registerOnce(place, freshSkills);
}
async function registerOnce(place, freshSkills) {
  const id = `${ID_PREFIX}bridge-restanding-${++state.reinitCounter}`;
  let reply2 = null;
  const arguments_ = { ...place, ...placeFields(place ?? {}, freshSkills), action: "register" };
  await post2(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: tool("channel"),
        arguments: arguments_
      }
    },
    (m) => {
      if (m.id === id) {
        reply2 = m;
        if (!m.error && !m.result?.isError && place) noteSkills(place, arguments_.attrs.skills);
      }
    }
  );
  return reply2;
}
async function replayBeside() {
  let whole = true;
  for (const place of [...state.places]) {
    const deaf = deafPlaceIn(place.realm) ? await deafSeatTaken(place) : null;
    if (deaf) {
      log(`place ${keyOfPlace(place)} not re-registered: ${deaf}`);
      continue;
    }
    const got = await replayRegister(place);
    if (got && !got.error && !got.result?.isError) continue;
    const key2 = keyOfPlace(place);
    if (seatIsGone(got)) {
      log(
        `the place ${key2} is gone at the platform, forgetting it: ${replyText(got).slice(0, 200)}`
      );
      dropExtra(key2, SEAT_EXPIRED(), true);
      state.places = state.places.filter((p) => keyOfPlace(p) !== key2);
    } else {
      whole = false;
      log(`could not re-register ${key2} this time, will retry: ${replyText(got).slice(0, 200)}`);
    }
  }
  return whole;
}
function standingIdOf(reply2) {
  return seatField(structuredOf(reply2), "register")?.seat_id ?? FORM.seatId.exec(replyText(reply2))?.[1] ?? null;
}
var replyText = (reply2) => {
  if (!reply2) return "";
  if (reply2.error) return JSON.stringify(reply2.error);
  const content = reply2.result?.content;
  return Array.isArray(content) ? content.map((c) => c?.text ?? "").join("\n") : JSON.stringify(reply2.result ?? "");
};
var seatIsGone = (reply2) => {
  const rule = refusalOf(reply2)?.rule;
  if (rule) return rule === "standing_not_held";
  return SEAT_GONE_RE.test(replyText(reply2));
};
var UNATTRIBUTED_CODE = /write_unattributed\w*|session_not_registered/;
var UNATTRIBUTED_REFUSAL = UNATTRIBUTED_RE;
var isUnattributed = (reply2) => {
  if (!reply2) return false;
  const rule = refusalOf(reply2)?.rule;
  if (rule) return UNATTRIBUTED_CODE.test(rule);
  const text2 = replyText(reply2);
  if (UNATTRIBUTED_CODE.test(text2)) return true;
  return !!reply2.result?.isError && UNATTRIBUTED_REFUSAL.test(text2);
};

// js/bridge/absorb.ts
var SOCKET_RE = /wss:\/\/[^\s"'`<>)\]]+|ws:\/\/(?:127\.0\.0\.1|\[?::1\]?|localhost)(?::\d+)?\/[^\s"'`<>)\]]+/;
var STATUS_RE = /https?:\/\/[^\s"'`<>)\]]+\/channel\/status\/[^\s"'`<>)\]]+/;
var trim = (s2) => s2.replace(/[.,;:!?»"')\]]+$/, "");
var hideAddresses = (text2) => text2.replace(new RegExp(SOCKET_RE.source, "g"), words(ABSORB).socketHidden()).replace(new RegExp(STATUS_RE.source, "g"), words(ABSORB).statusHidden());
function absorbChannelReply(msg, reply2) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel")) return reply2;
  if (a?.action !== "connect" && a?.action !== "mint") return reply2;
  if (reply2?.error || reply2?.result?.isError) return reply2;
  if (stoppedInMove()) return reply2;
  const text2 = replyText(reply2);
  const socket = SOCKET_RE.exec(text2)?.[0];
  if (!socket) return reply2;
  const status = STATUS_RE.exec(text2)?.[0];
  if (a.realm && a.karta != null) {
    state.standing = rememberedPlace(a.realm, a.karta, a.name);
  }
  holdStanding(trim(socket), status ? trim(status) : statusUrl(trim(socket)));
  const block = listenBlock() ?? "";
  const content = reply2.result?.content;
  if (Array.isArray(content)) {
    for (const c of content) if (typeof c?.text === "string") c.text = hideAddresses(c.text);
    content.push({ type: "text", text: block.trim() });
  }
  return reply2;
}
function revokesOwn(msg) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel") || a?.action !== "revoke") return false;
  const s2 = state.standing;
  if (!s2 || besideKeyIn(a.realm)) return false;
  return names(a, s2) && !otherRealm(a.realm, s2.realm);
}
function names(a, s2) {
  const asked = typeof a.standing === "string" ? a.standing.trim() : "";
  const own = asked === "" || asked === "mine" || asked === (s2.name ?? "") || asked.endsWith(`:${s2.name ?? ""}`);
  return own && normKarta(a.karta ?? s2.karta) === normKarta(s2.karta);
}
function expectOwnRevoke(msg) {
  if (revokesOwn(msg)) setRevokingOwn(true);
  if (closesOwn(msg)) setClosingOwn(true);
  const beside = revokesBeside(msg);
  if (beside) {
    besideRevokes.set(msg, beside);
    setRevokingBeside(beside, true);
  }
}
var besideRevokes = /* @__PURE__ */ new WeakMap();
function revokesBeside(msg) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel") || a?.action !== "revoke") return null;
  const beside = extraIn(a.realm);
  return beside && names(a, beside.standing) ? beside.door.key : null;
}
function settleBesideRevoke(msg) {
  const key2 = besideRevokes.get(msg);
  if (!key2) return;
  besideRevokes.delete(msg);
  setRevokingBeside(key2, false);
}
function closesOwn(msg) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== tool("channel") || a?.action !== "close") return false;
  const s2 = state.standing;
  return !!s2 && (!otherRealm(a.realm, s2.realm) || !!besideKeyIn(a.realm));
}
function settleOwnRevoke(msg) {
  if (msg?.params?.name !== tool("channel")) return;
  const action = msg.params.arguments?.action;
  if (action === "revoke") setRevokingOwn(false);
  if (action === "close") setClosingOwn(false);
  settleBesideRevoke(msg);
}
function absorbCloseReply(msg, reply2) {
  if (msg?.params?.name !== tool("channel") || msg?.params?.arguments?.action !== "close")
    return reply2;
  setClosingOwn(false);
  if (reply2?.error || reply2?.result?.isError || !closesOwn(msg)) return reply2;
  releaseStanding(holdWords().closedOwn(), true, false, true);
  state.standing = null;
  state.standingSession = null;
  log("channel closed by this session — released quietly, binding forgotten");
  return reply2;
}
function absorbRevokeReply(msg, reply2) {
  if (msg?.params?.name !== tool("channel") || msg?.params?.arguments?.action !== "revoke")
    return reply2;
  setRevokingOwn(false);
  settleBesideRevoke(msg);
  const a = msg.params.arguments;
  if (reply2?.error || reply2?.result?.isError) {
    const held2 = extraPlaces().map((p) => p.door.key);
    const content = reply2.result?.content;
    if (revokesOwn(msg) && held2.length && Array.isArray(content))
      content.push({
        type: "text",
        text: words(ABSORB).mainSeatHeld(state.standing?.name, held2.join(", "))
      });
    return reply2;
  }
  const beside = extraIn(a.realm);
  if (beside && names(a, beside.standing)) {
    dropExtra(beside.door.key, holdWords().revokedOwn(), true, "own");
    return reply2;
  }
  if (!revokesOwn(msg)) return reply2;
  const name2 = state.standing?.name ?? "unnamed";
  releaseStanding(holdWords().revokedOwn(), true, false, true);
  state.standing = null;
  state.standingSession = null;
  log(`standing revoked by this session — released quietly, binding forgotten (${name2})`);
  return reply2;
}

// js/bridge/call.ts
function leadsOtherPlace(realm, karta, name2) {
  const led = ledKey();
  const prim = state.standing;
  if (!led || !prim) return null;
  const ex = extraIn(realm);
  const beside = ex?.door.key;
  const s2 = ex ? ex.standing : prim;
  if (!ex && otherRealm(realm, prim.realm)) return null;
  const k = normKarta(karta);
  const n = normName(name2);
  const sameKarta = k === "agent" || k === String(s2.karta);
  return sameKarta && n === (s2.name ?? "") ? null : beside ?? led;
}
async function resolveAgainstLed(realm) {
  const prim = state.standing;
  if (!prim || !ledKey() || String(realm ?? "").trim() === prim.realm) return;
  await resolveRealms([realm, prim.realm, ...state.places.map((p) => p.realm)], async () => {
    const r = await callTool(tool("realm"), { action: "list" });
    return r.isError ? null : r.text;
  });
}
var heldRealms = () => [state.standing, ...state.places].filter((s2) => !!s2).map((s2) => canonRealm(s2?.realm));
function unresolvedRefusal(realm) {
  if (!ledKey() || !state.standing) return null;
  const held2 = [state.standing, ...state.places];
  return held2.some((s2) => unknownRealm(realm, s2.realm)) ? unresolvedWord(realm, heldRealms()) : null;
}
function otherPlaceWord(led, asked, sameName = false, hearing = "free") {
  const w = words(CALL);
  const same2 = sameName ? w.sameNamePrefix() : "";
  const advice = hearing !== "free" ? same2 + w.heardAdvice(hearing === "other", asked, led) : led === asked ? w.sameKeysAdvice() : sameName ? w.sameNameAdvice() : w.takeOtherAdvice();
  const Advice = `${advice.charAt(0).toUpperCase()}${advice.slice(1)}`;
  return w.otherPlace(led, asked, Advice);
}
function besideRefusal(realm, how2) {
  const prim = state.standing;
  const led = ledKey();
  if (!led || !prim || !otherRealm(realm, prim.realm)) return null;
  if (how2 === "stand" && holdsChannel()) return null;
  return how2 === "connect" ? words(CALL).besideConnect(led) : words(CALL).besideStand(led);
}
var refusal = (msg, text2) => ({
  jsonrpc: "2.0",
  id: msg.id,
  result: { isError: true, content: [{ type: "text", text: text2 }] }
});
function crossPlaceRefusal(msg) {
  if (msg?.method !== "tools/call" || msg.params?.name !== tool("channel")) return null;
  const a = msg.params.arguments ?? {};
  if (!["connect", "mint", "register"].includes(String(a.action))) return null;
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const unresolved2 = unresolvedRefusal(realm);
  if (unresolved2) return refusal(msg, unresolved2);
  if (a.action !== "register") {
    const word3 = besideRefusal(realm, "connect");
    if (word3) return refusal(msg, word3);
  }
  const karta = normKarta(a.karta ?? state.standing?.karta ?? "");
  const name2 = normName(a.name);
  const led = leadsOtherPlace(realm, karta, name2);
  if (!led) return null;
  const asked = keyOf(realm, karta, name2);
  const sameName = name2 === (state.standing?.name ?? "");
  return refusal(msg, otherPlaceWord(led, asked, sameName, "unknown"));
}
var seq = 0;
async function ask(name2, args) {
  const id = `${OWN_CALL_PREFIX}${++seq}`;
  const msg = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: name2, arguments: args }
  };
  let reply2 = null;
  await post2(msg, (m) => {
    if (m.id === id) reply2 = m;
  });
  return { msg, got: reply2 };
}
var callTool = (name2, args) => name2 === tool("channel") ? takingSeat(args, () => answer(name2, args)) : answer(name2, args);
async function answer(name2, args) {
  let { msg, got } = await ask(name2, args);
  if (name2 === tool("channel") && args.action === "register" && openedConcurrently(got))
    ({ msg, got } = await ask(name2, args));
  if (!got) return { text: words(CALL).noReply(), isError: true };
  const structured = structuredOf(got);
  const refusal2 = refusalOf(got);
  if (name2 === tool("channel")) {
    noteLocaleEcho(args, replyText(got), structured);
    if (!got.error && !got.result?.isError) noteTaken(args);
    if (args.action === "register") noteStanding(msg, got);
    if (args.action === "connect") got = absorbChannelReply(msg, got);
  }
  return {
    text: replyText(got),
    isError: !!got.error || !!got.result?.isError,
    ...structured !== void 0 ? { structured } : {},
    ...refusal2 ? { refusal: refusal2 } : {}
  };
}
var short = (s2, n = 300) => s2.length > n ? `${s2.slice(0, n)}…` : s2;
var Q = scoped(() => ({ chain: Promise.resolve() }));
function serialized(fn) {
  const p = Q.chain.then(fn, fn);
  Q.chain = p.then(
    () => void 0,
    () => void 0
  );
  return p;
}

// js/bridge/statusaddr.ts
function statusAddress(realm) {
  if (!H2.currentStatusUrl || !H2.currentKey) return null;
  const extra = realm ? extraIn(realm) : void 0;
  const d = extra?.door ?? H2.door;
  return {
    url: H2.currentStatusUrl,
    key: d?.key ?? H2.currentKey,
    standingId: d?.standingId ?? null,
    place: d?.address ?? null,
    derived: d?.addressDerived ?? false,
    name: (extra?.standing ?? state.standing)?.name ?? ""
  };
}

// js/bridge/status.ts
var isDirectory = (p) => {
  try {
    return isAbsolute(p) && statSync7(p).isDirectory();
  } catch {
    return false;
  }
};
var replyTo = (msg) => (body, isError = false) => ({
  jsonrpc: "2.0",
  id: msg.id,
  result: { ...isError ? { isError: true } : {}, content: [{ type: "text", text: body }] }
});
async function statusWord(text2, realm) {
  const st = await publishStatus(text2, realm);
  if (!st.ok && !statusAddress()) return [await notHeldHere(realm), true];
  if (st.code === 404) return [`${st.body} ${TURNED_GUIDANCE()}`, true];
  if (st.ok) return [busyLine(text2, realm), false];
  return [st.body, true];
}
function busyLine(text2, realm) {
  const a = S2.accepted.get(statusAddress(realm)?.key ?? "");
  const line = a?.sent === text2 ? a.doing : text2;
  const nudge = a?.sent === text2 && a.trimmed ? `; ${trimNudge(a.trimmed)}` : "";
  return words(STATUS).busyLine(placeLabel(realm), line, nudge);
}
function placeLabel(realm) {
  const a = statusAddress(realm);
  if (a?.place) return a.derived ? words(STATUS).placeDerived(a.place) : a.place;
  return words(STATUS).placeUnnamed(a?.name ?? "");
}
function localStatus(msg) {
  if (msg?.method !== "tools/call" || msg?.params?.name !== tool("channel")) return null;
  const a = msg.params?.arguments;
  if (a?.action !== "status") return null;
  const text2 = typeof a.text === "string" ? a.text : "";
  const reply2 = replyTo(msg);
  const realm = typeof a.realm === "string" ? a.realm : "";
  return (async () => {
    await resolveAgainstLed(realm);
    return reply2(...await statusWord(text2, realm));
  })();
}
async function standStatusOnly(msg) {
  const a = msg.params?.arguments ?? {};
  if (typeof a.status !== "string") return { miss: null };
  const unset2 = (v) => v == null || v === false || v === "";
  const extra = takingArgs(a);
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  if (!realm) return { miss: null };
  await resolveAgainstLed(realm);
  const held2 = ledIn(realm);
  if (!held2) return { miss: { why: "none" } };
  if (extra.length) return { miss: { why: "args", args: extra } };
  if (!unset2(a.karta) && normKarta(a.karta) !== String(held2.karta)) return { miss: null };
  const asked = normName(a.name);
  if (asked && asked !== (held2.name ?? ""))
    return { miss: { why: "name", asked, held: held2.name ?? "" } };
  const of = normName(a.satellite_of);
  const base = /^(.+)\.sub-[1-9]\d*$/.exec(held2.name ?? "")?.[1];
  if (of && !(base && nameOf(of).startsWith(base))) return { miss: { why: "satellite" }, of };
  const [r, k, n] = [held2.realm, held2.karta, held2.name ?? ""];
  const seat2 = { realm: r, karta: k, name: n };
  if (isParked(r, k, n)) return { miss: { why: "parked", seat: seat2 } };
  if (!hasStatusAddressFor(r, k, n)) return { miss: { why: "elsewhere", seat: seat2 } };
  const cwd = typeof a.cwd === "string" ? a.cwd.trim() : "";
  if (cwd) {
    if (cwd !== process.cwd() && !isDirectory(cwd)) return { miss: { why: "cwd", cwd } };
    noteStandCwd(cwd);
  }
  const [said2, isError] = await statusWord(a.status.trim(), realm);
  const heard2 = holdsStanding(r, k, n);
  const why = wasEvicted(r, k, n) ? words(STATUS).evictedWhy() : words(STATUS).reopeningWhy();
  const body = isError || heard2 ? said2 : `${said2}; ${why}`;
  const listen = isError || !heard2 ? null : unheardListenBlock(realm);
  return { reply: replyTo(msg)(listen ? `${body}
${listen}` : body, isError) };
}
function ledIn(realm) {
  const prim = state.standing;
  return prim && (prim.realm === realm || sameRealm(prim.realm, realm)) ? prim : extraIn(realm)?.standing;
}
var S2 = scoped(() => ({
  lastPublished: "",
  /** The last accepted line per seat (address key): sent, landed (the answer's doing) and trim. */
  accepted: /* @__PURE__ */ new Map()
}));
var publishedStatus = () => S2.lastPublished;
async function publishStatus(text2, realm, everyPlace = false) {
  const addr = statusAddress(realm);
  if (!addr) {
    return { ok: false, body: words(STATUS).notHeld() };
  }
  if (!everyPlace && !addr.standingId && heldPlaces().length > 1)
    return { ok: false, body: words(STATUS).noSeatId(addr.key) };
  const st = await publishStatusTo(addr.url, text2, 5e3, everyPlace ? null : addr.standingId);
  if (st.ok) {
    const kept2 = st.doing ?? text2;
    S2.accepted.set(addr.key, { sent: text2, doing: kept2, trimmed: st.trimmed });
    if (addr.key === statusAddress()?.key) S2.lastPublished = kept2;
    rememberStatus(kept2, realm);
  }
  return st;
}
var TAKE_PATH = () => words(STATUS).takePath();
var TURNED_GUIDANCE = () => words(STATUS).turnedGuidance();
var slugOf = (realm) => realm.replace(/^@[^/]+\//, "");
async function heldElsewhere(realm) {
  const dir2 = standingsDirOf(CFG.authDir);
  if (!existsSync6(dir2)) return [];
  const anyRealm = !realm || /^r\d+$/.test(realm);
  const out7 = [];
  for (const f of readdirSync9(dir2).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec5 = JSON.parse(readFileSync21(join18(dir2, f), "utf8"));
      if (!rec5?.realm || rec5.karta == null) continue;
      if (!anyRealm && slugOf(String(rec5.realm)) !== slugOf(realm)) continue;
      const key2 = keyOf(rec5.realm, rec5.karta, rec5.name ?? "");
      if (await localSocketAlive(socketPathOf(CFG.authDir, key2))) out7.push({ ...rec5, key: key2 });
    } catch {
    }
  }
  return out7;
}
async function notHeldHere(realm) {
  const others = await heldElsewhere(realm);
  if (!others.length) return words(STATUS).notHeldNone();
  const list3 = others.map((r) => {
    const where = [
      r.cwd && words(STATUS).whereCwd(r.cwd),
      r.client && words(STATUS).whereClient(r.client)
    ].filter(Boolean);
    return where.length ? `${r.key} (${where.join(", ")})` : r.key;
  }).join("; ");
  return words(STATUS).notHeldList(list3);
}

// js/bridge/update.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync7, lstatSync as lstatSync3, readFileSync as readFileSync23 } from "node:fs";
import { homedir as homedir6 } from "node:os";
import { dirname as dirname11, join as join20 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";

// js/bridge/releases.ts
import { mkdirSync as mkdirSync12, readFileSync as readFileSync22, renameSync as renameSync9, writeFileSync as writeFileSync12 } from "node:fs";
import { dirname as dirname10, join as join19 } from "node:path";
var rw = () => words(RELEASES);
var RELEASES_URL = process.env[envName("BRIDGE_RELEASES_URL")]?.trim() || `https://api.github.com/repos/${SKILL_SET}/releases/latest`;
var RELEASES_PAGE_URL = process.env[envName("BRIDGE_RELEASES_PAGE_URL")]?.trim() || (process.env[envName("BRIDGE_RELEASES_URL")]?.trim() ? null : `https://github.com/${SKILL_SET}/releases/latest`);
var TAG_TTL_MS = 60 * 60 * 1e3;
var releaseTagPath = () => join19(dirname10(homeBridgePath()), "release-tag.json");
function writeAtomic(path, bytes) {
  mkdirSync12(dirname10(path), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync12(tmp, bytes, { mode: 420 });
  renameSync9(tmp, path);
}
var RateLimitError = class extends Error {
  limit;
  resetAt;
  constructor(message, limit, resetAt) {
    super(message);
    this.limit = limit;
    this.resetAt = resetAt;
  }
};
function resetWord(resetAt) {
  const min = resetAt ? Math.max(0, Math.ceil((resetAt - Date.now()) / 6e4)) : 0;
  return resetAt ? rw().reset(new Date(resetAt).toISOString(), min) : rw().noReset();
}
function rateLimitWord(limit, resetAt) {
  const per = limit ? rw().perHour(limit) : rw().anyHourly();
  return rw().exhausted(per, resetWord(resetAt));
}
function rateLimitOf(res) {
  if (res.status !== 403 && res.status !== 429) return null;
  const remaining = res.headers.get("x-ratelimit-remaining");
  const retrySec = Number(res.headers.get("retry-after"));
  if (remaining === "0") {
    const limit = Number(res.headers.get("x-ratelimit-limit")) || null;
    const resetSec = Number(res.headers.get("x-ratelimit-reset"));
    const resetAt = resetSec > 0 ? resetSec * 1e3 : retrySec > 0 ? Date.now() + retrySec * 1e3 : null;
    return new RateLimitError(rateLimitWord(limit, resetAt), limit, resetAt);
  }
  if (retrySec > 0 || res.status === 429) {
    const resetAt = retrySec > 0 ? Date.now() + retrySec * 1e3 : null;
    return new RateLimitError(rw().secondary(resetWord(resetAt)), null, resetAt);
  }
  return null;
}
async function tagFromApi() {
  const res = await fetch(RELEASES_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": `${BRIDGE_NAME}/${VERSION}` },
    signal: AbortSignal.timeout(15e3)
  });
  const limited = rateLimitOf(res);
  if (limited) throw limited;
  if (!res.ok) throw new Error(rw().httpFrom(res.status, RELEASES_URL));
  const body = await res.json();
  return body.tag_name?.trim() || null;
}
async function tagFromPage(url) {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": `${BRIDGE_NAME}/${VERSION}` },
    signal: AbortSignal.timeout(15e3)
  });
  const location = res.headers.get("location") ?? "";
  const m = /\/releases\/tag\/([^/?#]+)/.exec(location);
  if (res.status < 300 || res.status >= 400 || !m)
    throw new Error(rw().noTag(res.status, url, location));
  return decodeURIComponent(m[1]);
}
function readReleaseTag() {
  try {
    const c = JSON.parse(readFileSync22(releaseTagPath(), "utf8"));
    return c.source === RELEASES_URL ? c : null;
  } catch {
    return null;
  }
}
function writeReleaseTag(c) {
  try {
    writeAtomic(releaseTagPath(), JSON.stringify(c, null, 2));
  } catch {
  }
}
async function resolveTag(force) {
  const cached = readReleaseTag();
  const now2 = Date.now();
  if (!force && cached?.tag && now2 - cached.checked_at < TAG_TTL_MS) return cached.tag;
  const knownLimit = cached?.api_limited_until && now2 < cached.api_limited_until ? new RateLimitError(
    cached.api_limit ? rateLimitWord(cached.api_limit, cached.api_limited_until) : rw().recordedByOther(resetWord(cached.api_limited_until)),
    cached.api_limit ?? null,
    cached.api_limited_until
  ) : null;
  let apiErr = knownLimit;
  if (!knownLimit) {
    try {
      const tag = await tagFromApi();
      writeReleaseTag({ source: RELEASES_URL, checked_at: Date.now(), tag, via: "api" });
      return tag;
    } catch (e) {
      apiErr = e;
    }
  }
  const limit = apiErr instanceof RateLimitError ? apiErr : null;
  const limitFields = limit?.resetAt ? { api_limited_until: limit.resetAt, api_limit: limit.limit } : {};
  if (RELEASES_PAGE_URL) {
    try {
      const tag = await tagFromPage(RELEASES_PAGE_URL);
      log(rw().fromPage(String(apiErr?.message), tag));
      writeReleaseTag({
        source: RELEASES_URL,
        checked_at: Date.now(),
        tag,
        via: "page",
        ...limitFields
      });
      return tag;
    } catch (e) {
      const both = `${apiErr?.message}; ${rw().fallback()} — ${e.message}`;
      apiErr = limit ? new RateLimitError(both, limit.limit, limit.resetAt) : new Error(both);
    }
  }
  if (limit?.resetAt)
    writeReleaseTag({
      source: RELEASES_URL,
      checked_at: cached?.checked_at ?? 0,
      tag: cached?.tag ?? null,
      ...cached?.via ? { via: cached.via } : {},
      ...limitFields
    });
  throw apiErr;
}

// js/bridge/update.ts
var uw = () => words(UPDATE);
var RAW_URL = process.env[envName("BRIDGE_RAW_URL")]?.trim() || `https://raw.githubusercontent.com/${SKILL_SET}`;
var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1e3;
var FAILED_RETRY_MS = 15 * 60 * 1e3;
var envMs = (name2, dflt) => {
  const v = Number(process.env[name2]);
  return process.env[name2]?.trim() && Number.isFinite(v) && v >= 0 ? v : dflt;
};
var RETRY_FLOOR_MS = envMs(envName("BRIDGE_RETRY_FLOOR_MS"), 6e4);
var RETRY_JITTER_MS = envMs(envName("BRIDGE_RETRY_JITTER_MS"), 6e4);
var updatesDisabled = () => !!process.env[envName("BRIDGE_NO_UPDATE")];
var selfPath = () => fileURLToPath4(import.meta.url);
var opencodePluginPath = () => join20(homedir6(), ".config", "opencode", "plugins", PLUGIN_COPY_FILE);
var setupPathOf = (authDir) => join20(authDir, "SETUP.md");
var latestPathOf = (authDir) => join20(authDir, "latest.json");
var isSymlink = (path) => {
  try {
    return lstatSync3(path).isSymbolicLink();
  } catch {
    return false;
  }
};
var readBytes = (path) => {
  try {
    return readFileSync23(path);
  } catch {
    return Buffer.alloc(0);
  }
};
var readText = (path) => readBytes(path).toString("utf8");
var versionOf = (path) => versionIn(readText(path));
function syncHome(self = selfPath()) {
  const out7 = { copied: [] };
  const home = homeBridgePath();
  let mine;
  try {
    mine = readFileSync23(self);
  } catch {
    return out7;
  }
  if (!versionIn(mine.toString("utf8"))) return out7;
  if (self === home) return out7;
  if (isSymlink(home)) return out7;
  const homeVersion = versionOf(home);
  const cmp = homeVersion ? compareVersions(VERSION, homeVersion) : 1;
  const healsDev = cmp === 0 && devBuildIn(readText(home)) && !mine.equals(readBytes(home));
  if ((cmp > 0 || healsDev) && releaseBuild()) {
    writeAtomic(home, mine);
    out7.copied.push(home);
    const plugin = opencodePluginPath();
    const packaged = join20(dirname11(self), PLUGIN_FILE);
    if (existsSync7(plugin) && existsSync7(packaged)) {
      const fresh2 = readFileSync23(packaged);
      if (!readFileSync23(plugin).equals(fresh2)) {
        writeAtomic(plugin, fresh2);
        out7.copied.push(plugin);
      }
    }
  } else if (cmp < 0 && homeVersion) {
    out7.reexec = home;
  }
  return out7;
}
function reexec(path, argv2) {
  log(uw().reexecNewer(versionOf(path) ?? "?", VERSION, path));
  const root = skillsRoot();
  const child = spawn2(process.execPath, [path, ...argv2], {
    stdio: "inherit",
    env: {
      ...process.env,
      [envName("BRIDGE_REEXEC")]: "1",
      ...root ? { [SKILLS_ROOT_ENV]: root } : {}
    }
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on("error", (e) => {
    log(uw().restartFailed(e.message));
    process.exit(1);
  });
}
function readLatest(authDir) {
  try {
    return JSON.parse(readFileSync23(latestPathOf(authDir), "utf8"));
  } catch {
    return null;
  }
}
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json, text/plain, */*",
      "user-agent": `${BRIDGE_NAME}/${VERSION}`
    },
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(words(RELEASES).httpFrom(res.status, url));
  return res.text();
}
async function downloadRelease(tag, version, authDir) {
  const written = [];
  const base = `${RAW_URL}/${tag}`;
  const bridge = await fetchText(`${base}/skills/${BRIDGE_SKILL}/scripts/${BRIDGE_FILE}`);
  const got = versionIn(bridge);
  if (got !== version) throw new Error(uw().versionMismatch(got ?? "?", version));
  const home = homeBridgePath();
  const current2 = versionOf(home);
  if (!isSymlink(home) && (!current2 || compareVersions(version, current2) > 0)) {
    writeAtomic(home, bridge);
    written.push(home);
  }
  const plugin = opencodePluginPath();
  if (existsSync7(plugin)) {
    const fresh2 = await fetchText(`${base}/skills/${BRIDGE_SKILL}/scripts/${PLUGIN_FILE}`);
    if (readFileSync23(plugin, "utf8") !== fresh2) {
      writeAtomic(plugin, fresh2);
      written.push(plugin);
    }
  }
  const setup = await fetchText(`${base}/SETUP.md`);
  writeAtomic(setupPathOf(authDir), setup);
  written.push(setupPathOf(authDir));
  return written;
}
function checkExpiresAt(latest) {
  if (!latest.error) return latest.checked_at + CHECK_INTERVAL_MS;
  if (latest.rate_limited_until) return latest.rate_limited_until;
  return latest.checked_at + FAILED_RETRY_MS;
}
async function checkLatest(authDir, force = false) {
  const cached = readLatest(authDir);
  if (!force && cached && Date.now() < checkExpiresAt(cached)) return cached;
  const latest = { checked_at: Date.now(), version: null, tag: null, downloaded: [] };
  try {
    const tag = await resolveTag(force);
    latest.tag = tag;
    latest.version = tag ? tag.replace(/^v/, "") : null;
    if (latest.version && compareVersions(latest.version, VERSION) > 0) {
      latest.downloaded = await downloadRelease(tag, latest.version, authDir);
    } else if (force && tag) {
      writeAtomic(setupPathOf(authDir), await fetchText(`${RAW_URL}/${tag}/SETUP.md`));
      latest.downloaded = [setupPathOf(authDir)];
    }
  } catch (e) {
    latest.error = e.message;
    if (e instanceof RateLimitError) {
      latest.rate_limited = true;
      if (e.resetAt) latest.rate_limited_until = e.resetAt;
    }
  }
  try {
    writeAtomic(latestPathOf(authDir), JSON.stringify(latest, null, 2));
  } catch {
  }
  return latest;
}
function staleNotice(latest, authDir) {
  if (!latest?.version || compareVersions(latest.version, VERSION) <= 0) return null;
  const self = String(process.argv[1]);
  const bridgeWord = latest.downloaded.some((p) => p === homeBridgePath()) ? uw().bridgeDownloaded() : latest.error ? uw().downloadFailed(latest.error, self) : isSymlink(homeBridgePath()) ? uw().homeSymlink() : versionOf(homeBridgePath()) && compareVersions(versionOf(homeBridgePath()), latest.version) >= 0 ? uw().bridgeAlreadyHome() : uw().bridgeNotHome(self);
  const m = skillMoves();
  return uw().stale(
    VERSION,
    latest.version,
    bridgeWord,
    m.claude,
    m.flat,
    m.pi,
    m.codex,
    setupPathOf(authDir)
  );
}
var skillMoves = () => ({
  claude: uw().moveClaude(),
  flat: uw().moveFlat(),
  pi: uw().movePi(),
  codex: uw().moveCodex()
});
var N = scoped(() => ({ pending: null }));
function takeNotice() {
  const n = N.pending;
  N.pending = null;
  return n;
}
function pendNotice(notice) {
  N.pending = notice;
}
function tellNotice(notice) {
  N.pending = notice;
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "warning", logger: LOGGERS.bridge, data: { kind: "stale", text: notice } }
  });
}
function startFreshnessWatch(authDir, serverUrl, tell2 = tellNotice, onChecked = () => {
}) {
  if (updatesDisabled()) return;
  const explicit = !!process.env[envName("BRIDGE_RELEASES_URL")]?.trim();
  if (!explicit && !isProductionServer(serverUrl)) {
    log(
      `releases not watched: ${serverUrl} is not a production address — another instance is another delivery`
    );
    return;
  }
  let retry = null;
  let told = null;
  const spread = Math.floor(Math.random() * RETRY_JITTER_MS);
  const tick = async () => {
    const latest = await checkLatest(authDir);
    if (retry) clearTimeout(retry);
    retry = null;
    if (latest?.error) {
      const wait = Math.min(
        CHECK_INTERVAL_MS,
        Math.max(RETRY_FLOOR_MS, checkExpiresAt(latest) - Date.now() + 1e3) + spread
      );
      retry = setTimeout(() => void tick(), wait);
      retry.unref();
    }
    onChecked();
    const notice = staleNotice(latest, authDir);
    if (!notice) return;
    if (latest?.error && notice === told) return;
    told = notice;
    log(notice);
    tell2(notice);
  };
  const delay = Number(process.env[envName("BRIDGE_UPDATE_DELAY_MS")] ?? 2e3);
  setTimeout(() => void tick(), Number.isFinite(delay) ? delay : 2e3).unref();
  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
}

// js/bridge/engine.ts
function proxyWord() {
  const env2 = process.env;
  const proxy = env2.HTTPS_PROXY || env2.https_proxy || env2.HTTP_PROXY || env2.http_proxy;
  if (!proxy || process.versions.bun) return null;
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const reads = major > 24 || major === 24 && minor >= 5;
  const flags = [...process.execArgv, ...(env2.NODE_OPTIONS ?? "").split(/\s+/)];
  const on = env2.NODE_USE_ENV_PROXY === "1" || flags.includes("--use-env-proxy");
  if (reads && on) return null;
  return reads ? "a proxy is set (HTTP(S)_PROXY), but Node reads it only under NODE_USE_ENV_PROXY=1 — add that variable to the bridge's env in the harness config; until then calls go around the proxy" : `a proxy is set (HTTP(S)_PROXY), but Node ${process.versions.node} does not read it at all — Node 24.5+ with NODE_USE_ENV_PROXY=1 or the Bun runtime does; until then calls go around the proxy`;
}
function installCrashWords() {
  process.on("uncaughtException", (e) => log(`uncaught: ${e?.stack || e}`));
  process.on(
    "unhandledRejection",
    (e) => log(`unhandled rejection: ${e?.stack || String(e)}`)
  );
}
function fullBridgeSigint(leave) {
  let interrupted = false;
  return () => {
    if (CFG.satellite && leave && !interrupted) {
      interrupted = true;
      void leave("SIGINT");
      return;
    }
    const addr = statusAddress();
    releaseStanding("SIGINT");
    if (interrupted) process.exit(0);
    interrupted = true;
    const clearing = addr ? publishStatusTo(addr.url, "", 2e3).catch(() => {
    }) : null;
    if (!clearing && tokenRequestsInFlight.size === 0) process.exit(0);
    Promise.allSettled([...tokenRequestsInFlight, ...clearing ? [clearing] : []]).then(
      () => process.exit(0)
    );
  };
}
function startEngine(cfg, opts = {}) {
  setConfig(cfg);
  installAuthLockExitHook();
  installRefreshLockExitHook();
  log(
    `${BUILD} -> ${CFG.serverUrl} (timeout ${CFG.timeoutMs}ms, ${CFG.pat ? `personal access token from ${CFG.patSource}` : `auth in ${storePath()}`})`
  );
  const proxy = proxyWord();
  if (proxy) log(proxy);
  startTokenKeepalive();
  if (opts.freshness !== false) startFreshnessWatch(CFG.authDir, CFG.serverUrl);
}

// js/bridge/fallback.ts
import { mkdirSync as mkdirSync13, readdirSync as readdirSync10, readFileSync as readFileSync24, unlinkSync as unlinkSync13, writeFileSync as writeFileSync13 } from "node:fs";
import { join as join21, resolve as resolve7 } from "node:path";
var fallbackDir = (authDir) => join21(resolve7(authDir), "fallback");
var alive4 = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
function pruneFallbacks(authDir) {
  let names2 = [];
  try {
    names2 = readdirSync10(fallbackDir(authDir));
  } catch {
  }
  for (const n of names2) {
    const pid = parseInt(n, 10);
    if (Number.isInteger(pid) && !alive4(pid))
      try {
        unlinkSync13(join21(fallbackDir(authDir), n));
      } catch {
      }
  }
}
function markFallback(authDir, f) {
  const file = join21(fallbackDir(authDir), `${process.pid}.json`);
  try {
    mkdirSync13(fallbackDir(authDir), { recursive: true, mode: 448 });
    pruneFallbacks(authDir);
    const rec5 = { pid: process.pid, since: (/* @__PURE__ */ new Date()).toISOString(), ...f };
    writeFileSync13(file, JSON.stringify(rec5), { mode: 384 });
    process.once("exit", () => {
      try {
        unlinkSync13(file);
      } catch {
      }
    });
  } catch {
  }
}
function readFallbacks(authDir) {
  let names2;
  try {
    names2 = readdirSync10(fallbackDir(authDir));
  } catch {
    return [];
  }
  const out7 = [];
  for (const n of names2) {
    try {
      const f = JSON.parse(readFileSync24(join21(fallbackDir(authDir), n), "utf8"));
      if (Number.isInteger(f.pid) && alive4(f.pid)) out7.push(f);
    } catch {
    }
  }
  return out7;
}

// js/bridge/runend.ts
var R4 = scoped(() => ({
  run: null,
  /** the run's seats and busy address while a handover pause lasts */
  held: null
}));
function closeRun(why, handover) {
  return R4.run ??= (async () => {
    const addr = statusAddress();
    const places = satellitePlaces();
    const paused = suspended();
    const closing = (!handover || CFG.satellite) && !paused;
    const spent = closing || paused ? usagePlace() : null;
    if (!CFG.satellite) keepHoldRecord();
    releaseStanding(why, CFG.satellite && !paused, false, false, paused);
    if (paused) R4.held = { places, addr };
    await Promise.all([paused ? null : leaveJoinedCases(), flushUsage(spent)]);
    const end = paused ? { failed: [], revoked: [] } : await revokeSatellitePlaces(places);
    if (addr && closing) await publishStatusTo(addr.url, "", 3e3).catch(() => {
    });
    return end;
  })();
}
async function endUnreturnedPause(bridgePid, waitMs) {
  const key2 = handoverPauseKey();
  const held2 = R4.held;
  if (!key2 || !held2) return;
  const until = Date.now() + waitMs;
  for (; ; ) {
    if (handoverPauseKey() !== key2 || !readHoldRecord(key2)) return;
    if (await localSocketAlive(localSocketPathOf(key2))) return;
    if (!ownPidAlive(bridgePid)) break;
    if (Date.now() > until) return log(`handover pause of ${key2}: the bridge lives on — kept`);
    await sleep(200);
  }
  log(`handover pause of ${key2}: the bridge left in the handover window — the run ends`);
  dropHoldRecord(key2);
  await leaveJoinedCases();
  const { failed } = await revokeSatellitePlaces(held2.places);
  if (failed.length) log(`handover pause of ${key2}: NOT revoked ${failed.join(", ")}`);
  if (held2.addr) await publishStatusTo(held2.addr.url, "", 3e3).catch(() => {
  });
}
function localEnd(msg) {
  if (msg?.method !== method("end")) return null;
  const answer2 = (result) => ({ jsonrpc: "2.0", id: msg.id, result });
  if (!CFG.satellite || suspended()) return Promise.resolve(answer2({ ended: false }));
  return closeRun(words(RUN_END).pluginEnd(), false).then(({ failed, revoked }) => answer2({ ended: true, failed, revoked })).catch((e) => answer2({ ended: false, word: e.message }));
}

// js/bridge/provisional.ts
import { randomBytes as randomBytes4 } from "node:crypto";

// js/bridge/standwords.ts
var sw2 = () => words(STAND);
function boardHeaders() {
  const own = words(BOARD_HEADER);
  return [
    own,
    LANGS.filter((l) => BOARD_HEADER[l] !== own).map((l) => BOARD_HEADER[l]).join(", ")
  ];
}
function missWord(m, of) {
  const w = words(STAND_MISS);
  switch (m.why) {
    case "none":
      return w.none();
    case "args":
      return w.args(m.args.join(", "));
    case "name":
      return w.name(m.asked, m.held);
    case "satellite":
      return w.satellite(of ?? "?");
    case "cwd":
      return w.cwd(m.cwd);
    case "parked":
      return w.parked();
    case "elsewhere":
      return w.elsewhere();
  }
}
var needRealmKarta = (miss, of) => sw2().needRealmKarta(miss ? ` ${missWord(miss, of)}` : "");

// js/bridge/standmoves.ts
var mw = () => words(STAND_MOVES);
var standCall = (realm, karta, name2) => `${tool("stand")}(realm="${realm}", karta=${karta}${name2 ? `, name="${name2}"` : ""})`;
function ledIn2(realm) {
  const prim = state.standing;
  return prim && sameRealm(prim.realm, realm) ? prim : extraIn(realm)?.standing;
}
var STANDS_IN_REALM = "channel_already_stands_in_realm";
async function releasePrior(realm, prior) {
  const name2 = prior.name ?? "";
  const beside = extraOf(realm, prior.karta, name2)?.door.key;
  const args = { action: "revoke", realm, karta: String(prior.karta), standing: name2 };
  if (beside) setRevokingBeside(beside, true);
  const r = await callTool(tool("channel"), args).finally(() => {
    if (beside) setRevokingBeside(beside, false);
  });
  if (!r.isError) {
    if (beside) dropExtra(beside, holdWords().revokedOwn(), true, "own");
    return { ok: true, note: mw().priorReleased(name2) };
  }
  return { ok: false, note: mw().priorKept(name2, short(r.text, 160), revokeCall(realm, prior)) };
}
var revokeCall = (realm, s2) => `${tool("channel")}(action="revoke", realm="${realm}", karta="${s2.karta}", standing="${s2.name ?? ""}")`;
function besideHoldsMain(realm, prior, asked) {
  const prim = state.standing;
  if (!prim || !sameRealm(prim.realm, realm) || prim.name !== prior.name) return null;
  const beside = extraPlaces().map((p) => p.standing);
  if (!beside.length) return null;
  return mw().besideHoldsMain(
    prior.name ?? "",
    asked,
    beside.map((s2) => `${s2.name ?? ""} (${s2.realm})`).join(", "),
    beside.map((s2) => revokeCall(s2.realm, s2)).join("; "),
    standCall(realm, prior.karta, prior.name ?? "")
  );
}
var REISSUE_MAX_S = 15;
function reissueThrottled(r) {
  if (!r.isError) return null;
  const rule = r.refusal?.rule;
  const hit = rule === "socket_reissue_throttled" || !rule && r.refusal?.status === 429 || r.text.includes("socket_reissue_throttled");
  if (!hit) return null;
  const said2 = Number(/retry in (\d+)\s*s/i.exec(r.text)?.[1] ?? NaN);
  return Math.min(Math.max(Number.isFinite(said2) ? said2 : 10, 1), REISSUE_MAX_S);
}
async function awaitReissue(seconds2, held2, stopped) {
  for (const end = Date.now() + seconds2 * 1e3; Date.now() < end; ) {
    const stop2 = stopped();
    if (stop2 || held2()) return { own: !stop2, stop: stop2 };
    await new Promise((r) => setTimeout(r, 200));
  }
  const stop = stopped();
  return { own: !stop && held2(), stop };
}
async function throughReissue(c, again, seat2, stopsBefore) {
  const throttle = reissueThrottled(c);
  if (!throttle) return { c, own: false, note: null };
  const t0 = Date.now();
  const { own, stop } = await awaitReissue(
    throttle,
    () => holdsStanding(seat2.realm, seat2.karta, seat2.name),
    () => stoppedDuring(stopsBefore)
  );
  if (stop) return { c, own, note: null };
  const seconds2 = Math.round((Date.now() - t0) / 1e3);
  return { c: own ? c : await again(), own, note: mw().reissueWaited(seconds2, own) };
}
function yourStandingsMove(r, realm) {
  const names2 = standingsInRealm(r.refusal);
  if (!names2.length) return null;
  const call = names2.map((n) => `${tool("stand")}(realm="${realm}", karta, name="${n}")`);
  return { call: call.join("; "), name: names2.join(", ") };
}
function refusedWord(what, r, realm, afterConnect) {
  if (r.refusal?.rule === STANDS_IN_REALM || r.text.includes(STANDS_IN_REALM)) {
    const yours = yourStandingsMove(r, realm);
    const led = yours || afterConnect !== void 0 ? void 0 : ledIn2(realm);
    const call = yours?.call ?? (led ? standCall(realm, led.karta, led.name ?? "") : "");
    const board = `${tool("channel")}(action="list", realm="${realm}")`;
    const leave = `${tool("channel")}(action="revoke", realm="${realm}", karta, standing=<${yours?.name ?? led?.name ?? "name"}>)`;
    return mw().standsInRealm(realm, call, board, leave, !!yours);
  }
  return afterConnect ?? sw2().refused(what, short(r.text));
}

// js/bridge/provisional.ts
function name(base) {
  const suffix = `.root-${randomBytes4(6).toString("hex")}`;
  return (base || "root").slice(0, NAME_MAX - suffix.length).replace(/[.-]+$/, "") + suffix;
}
var takesProvisional = (msg) => msg.params?.arguments?.provisional === true && typeof msg.id === "string" && msg.id.startsWith(SERVICE_ID);
function replacesProvisional(realm, own) {
  const led = ledIn2(realm);
  if (own || !led?.name) return false;
  const rec5 = readHoldRecord(keyOf(led.realm, led.karta, led.name), true);
  return rec5?.provisional === true && !!sessionOfBridge() && rec5.session === sessionOfBridge();
}
function noteStood(own, realm, karta, name2) {
  const key2 = keyOf(realm, karta, name2);
  const rec5 = readHoldRecord(key2, true);
  if (rec5) writeHoldRecord(key2, { ...rec5, provisional: own });
}
function restore(rec5) {
  if (rec5.provisional !== true || !rec5.session || rec5.session !== sessionOfBridge()) return;
  const led = ledIn2(rec5.realm);
  if (led?.name === rec5.name && String(led.karta) === String(rec5.karta))
    noteStood(true, led.realm, String(led.karta), rec5.name);
}
var releasedNote = (replaced, freed, prior) => replaced && freed.ok ? words(STAND_MOVES).provisionalReplaced(prior) : freed.note;

// js/bridge/stand.ts
import { statSync as statSync8 } from "node:fs";
import { isAbsolute as isAbsolute2 } from "node:path";

// js/bridge/knock.ts
var knocks = scoped(() => /* @__PURE__ */ new Map());
var KNOCK_REPEAT_AFTER_MS = Number(process.env[envName("STAND_KNOCK_REPEAT_MS")]) || 12e4;
var KNOCK_LIMIT = 2;
function resetKnocks(realm, karta, name2) {
  for (const k of [...knocks.keys()])
    if (k.startsWith(`${realm}|${karta}|${name2}|`)) knocks.delete(k);
}
async function knock(k) {
  const { realm, karta, name: name2, room, roomKarta } = k;
  const key2 = `${realm}|${karta}|${name2}|${room}`;
  const prior = knocks.get(key2);
  const waited = prior ? Date.now() - prior.at : Infinity;
  if (prior && prior.count >= KNOCK_LIMIT) return sw2().knockTwice(room);
  if (prior && !k.again) return sw2().knockSent(room, waited, KNOCK_REPEAT_AFTER_MS);
  if (prior && waited < KNOCK_REPEAT_AFTER_MS)
    return sw2().knockEarly(room, waited, KNOCK_REPEAT_AFTER_MS);
  if (!roomKarta) return sw2().knockNoRole(room, realm);
  const s2 = await callTool(tool("channel"), {
    action: "send",
    realm,
    karta: roomKarta,
    standing: room,
    text: "join"
  });
  if (s2.isError) return sw2().knockRefused(room, short(s2.text));
  knocks.set(key2, { at: Date.now(), count: (prior?.count ?? 0) + 1 });
  return sw2().knockDone(room, !!prior, short(s2.text, 200));
}

// js/bridge/orderjournal.ts
import {
  mkdirSync as mkdirSync14,
  readdirSync as readdirSync11,
  readFileSync as readFileSync25,
  renameSync as renameSync10,
  unlinkSync as unlinkSync14,
  writeFileSync as writeFileSync14
} from "node:fs";
import { join as join22 } from "node:path";
var ANSWER_WINDOW_MS = 6e4;
var RESTARTED = "bridge_restarted";
var alive5 = (pid) => {
  if (pid === process.pid) return true;
  if (typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
var KEEP_MS = 24 * 36e5;
var dir = () => join22(CFG.authDir, "orders");
var SAFE = /^[A-Za-z0-9_-]{1,80}$/;
var fileOf = (id) => SAFE.test(id) ? join22(dir(), `${id}.json`) : null;
function readOrder(id) {
  const f = fileOf(id);
  if (!f) return null;
  try {
    return JSON.parse(readFileSync25(f, "utf8"));
  } catch {
    return null;
  }
}
function writeOrder(e) {
  const f = fileOf(e.id);
  if (!f) return false;
  try {
    mkdirSync14(dir(), { recursive: true, mode: 448 });
    const tmp = `${f}.tmp-${process.pid}`;
    writeFileSync14(tmp, JSON.stringify(e), { mode: 384 });
    renameSync10(tmp, f);
    return true;
  } catch {
    return false;
  }
}
var isTerminal = (s2) => s2 !== "accepted";
var settled = (id) => {
  const e = readOrder(id);
  return !!e && isTerminal(e.state);
};
var sincePath = () => join22(dir(), "since");
function readSince(base) {
  try {
    const n = JSON.parse(readFileSync25(sincePath(), "utf8"))[base];
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
function writeSince(base, seq3) {
  let all2 = {};
  try {
    all2 = JSON.parse(readFileSync25(sincePath(), "utf8"));
  } catch {
  }
  try {
    mkdirSync14(dir(), { recursive: true, mode: 448 });
    const tmp = `${sincePath()}.tmp-${process.pid}`;
    writeFileSync14(tmp, JSON.stringify({ ...all2, [base]: seq3 }), { mode: 384 });
    renameSync10(tmp, sincePath());
  } catch {
  }
}
function unanswered(now2 = Date.now()) {
  let names2;
  try {
    names2 = readdirSync11(dir()).filter((n) => n.endsWith(".json"));
  } catch {
    return { left: [], watching: false };
  }
  const out7 = [];
  let watching = false;
  for (const n of names2) {
    const e = readOrder(n.slice(0, -".json".length));
    if (!e) continue;
    if (e.acked && now2 - e.at > KEEP_MS) {
      try {
        unlinkSync14(join22(dir(), n));
      } catch {
      }
      continue;
    }
    if (!isTerminal(e.state) && !alive5(e.pid)) {
      const end = { ...e, state: "unknown", reason: RESTARTED, acked: false };
      if (writeOrder(end)) out7.push(end);
      continue;
    }
    if (!isTerminal(e.state) && e.pid !== process.pid)
      watching ||= now2 < (e.until ?? e.at + ANSWER_WINDOW_MS);
    if (isTerminal(e.state) && !e.acked) out7.push(e);
  }
  return { left: out7, watching };
}

// js/bridge/orderack.ts
function windowEnd(o, at2) {
  const issued = Date.parse(o.issued_at ?? "");
  const seconds2 = o.ack_window_seconds ?? 0;
  const span = seconds2 > 0 ? seconds2 * 1e3 : ANSWER_WINDOW_MS;
  return (Number.isFinite(issued) ? issued : at2) + span;
}
var TIMEOUT_MS = 5e3;
var RETRY_MS2 = (process.env[envName("ORDER_RETRY_MS")] || "1000,2000,5000,15000,30000,60000").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
function headers() {
  const h = { "content-type": "application/json" };
  const token = bearer();
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}
async function sendAck(base, id, state2, reason) {
  try {
    const res = await fetch(`${base}/me/orders/${encodeURIComponent(id)}/ack`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        state: state2,
        ...reason ? { reason_code: reason } : {},
        client_id: `${id}-${state2}`
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const body = await res.text().catch(() => "");
    if (res.ok) return "taken";
    if ([404, 409, 422].includes(res.status)) {
      log(`stop order ${id}: answer ${state2} not taken (${res.status}) — ${body.slice(0, 160)}`);
      return "taken";
    }
    log(`stop order ${id}: answer ${state2} refused (${res.status}) — repeated later`);
  } catch (e) {
    log(
      `stop order ${id}: answer ${state2} did not reach the api (${e.message}) — repeated later`
    );
  }
  return "later";
}
async function answerOutcome(e) {
  if (await sendAck(e.base, e.id, e.state, e.reason) === "taken") markTaken(e.id);
  else repeatLater();
}
function markTaken(id) {
  const e = readOrder(id);
  if (e && !e.acked) writeOrder({ ...e, acked: true });
}
var P3 = scoped(() => ({ timer: null, step: 0 }));
function repeatLater(now2 = false) {
  if (P3.timer) {
    if (!now2) return;
    clearTimeout(P3.timer);
  }
  const pause = now2 ? 0 : RETRY_MS2[Math.min(P3.step, RETRY_MS2.length - 1)];
  P3.timer = setTimeout(() => {
    P3.timer = null;
    void (async () => {
      const { left: left2, watching } = unanswered();
      let open = watching;
      for (const e of left2) {
        if (await sendAck(e.base, e.id, e.state, e.reason) === "taken") markTaken(e.id);
        else open = true;
      }
      if (!open) return void (P3.step = 0);
      P3.step++;
      repeatLater();
    })();
  }, pause);
  P3.timer.unref?.();
}

// js/bridge/modelclear.ts
function clearingRegister(send2, realm) {
  let kept2 = null;
  const register = async () => {
    const r = await send2();
    if (!r.isError) kept2 = await clearSeatModel(realm);
    return r;
  };
  return { register, kept: () => kept2 };
}
async function clearSeatModel(realm) {
  if (!satelliteWithoutModel()) return null;
  const id = standingIdIn(realm);
  const url = H2.currentUrl;
  const fail2 = (why) => {
    log(`seat model in ${realm} not cleared: ${why}`);
    return why;
  };
  if (!id || !url) return fail2("no seat id or channel");
  try {
    const res = await fetch(`${apiBase(url)}/standings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { ...headers(), "x-nks-realm": canonRealm(realm) },
      body: JSON.stringify({ model: null }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.ok) return null;
    const body = (await res.text().catch(() => "")).trim().slice(0, 160);
    return fail2(body ? `${res.status}: ${body}` : String(res.status));
  } catch (e) {
    return fail2(e.message);
  }
}

// js/bridge/owner.ts
var OWNER_ENV = envName("BRIDGE_OWNER_ROLE");
var HUMAN2 = /* @__PURE__ */ new Set(["me", "realm-owner"]);
var OWNERS_PAGE = 100;
var known = scoped(() => /* @__PURE__ */ new Map());
var word2 = (what) => words(OWNER).refused(what, OWNER_ENV);
async function ownerRefusal(realm, karta) {
  if (envOf(OWNER_ENV)?.trim() === "1") return null;
  const k = normKarta(karta);
  if (!k || k === "agent") return null;
  if (HUMAN2.has(k)) return word2(words(OWNER).human(k));
  if (!/^\d+$/.test(k)) return null;
  const key2 = `${String(realm ?? "")}|${k}`;
  let owner = known.get(key2);
  if (owner === void 0) {
    const r = await ownersOf(realm, k);
    if (typeof r === "string") return words(OWNER).unread(k, short(r, 160));
    owner = r;
    known.set(key2, owner);
  }
  return owner ? word2(`karta=#${k}`) : null;
}
async function ownersOf(realm, k) {
  const s2 = await callTool(tool("search"), {
    realm,
    q: "",
    node_type: "karta",
    manifested_as: "svatantra",
    limit: OWNERS_PAGE,
    include_description: false
  });
  if (s2.isError) return s2.text;
  const seqs = [...s2.text.matchAll(/\(#(\d+)[,)]/g)].map((m) => m[1]);
  if (seqs.length >= OWNERS_PAGE) return words(OWNER).incomplete();
  return seqs.includes(k);
}

// js/bridge/standagain.ts
async function formerSeat(realm, karta) {
  const cwd = sessionCwd();
  const me = sessionOfBridge();
  const client = harnessName();
  const recs = holdRecordsWhere(
    (r) => !!r.realm && r.cwd === cwd && (!karta || String(r.karta) === karta) && (!r.client || !client || r.client === client) && (!r.session || r.session === me)
  );
  await resolveRealms([realm, ...recs.map((r) => r.realm)], async () => {
    const r = await callTool(tool("realm"), { action: "list" });
    return r.isError ? null : r.text;
  });
  const best = recs.filter((r) => sameRealm(r.realm, realm)).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0];
  return best ? { realm: best.realm, karta: best.karta, name: best.name } : null;
}
async function standAgainWord(realm, karta, miss) {
  if (!realm || !miss || !["none", "parked", "elsewhere"].includes(miss.why)) return "";
  const seat2 = "seat" in miss ? miss.seat : await formerSeat(realm, karta);
  const call = seat2 ? standCall(seat2.realm, seat2.karta, seat2.name ?? "") : "";
  return call ? ` ${words(STAND_MOVES).standAgain(call)}` : "";
}

// js/bridge/standundo.ts
var mw2 = () => words(STAND_MOVES);
var heldAddress = (realm, prior) => prior && holdsStanding(realm, prior.karta, prior.name ?? "") && H2.currentUrl ? { url: H2.currentUrl, statusUrl: H2.currentStatusUrl } : null;
async function connectInMove(before, seat2, again, first2) {
  const re = await throughReissue(await first2(), again, seat2, before);
  return { ...re, taken: !re.c.isError && !re.own ? seat2 : null };
}
async function dropTaken(seat2) {
  const { realm, karta, name: name2 } = seat2;
  const own = holdsStanding(realm, karta, name2);
  if (own) setRevokingOwn(true);
  const args = { action: "revoke", realm, karta: String(karta), standing: name2 };
  const r = await callTool(tool("channel"), args).finally(() => {
    if (own) setRevokingOwn(false);
  });
  if (r.isError && !own && H2.stopped.key === keyOf(realm, karta, name2)) return null;
  if (r.isError) return mw2().moveNotUndone(name2, short(r.text, 160), revokeCall(realm, seat2));
  if (own && holdsStanding(realm, karta, name2)) forgetSeat(holdWords().revokedOwn());
  return null;
}
async function stopGuard(msg, run) {
  const before = stopsNow();
  const outer = { since: H2.moveSince, taken: H2.taken };
  H2.moveSince = outer.since ?? before;
  H2.taken = [];
  let reply2;
  let taken2;
  try {
    reply2 = await run();
  } finally {
    taken2 = H2.taken ?? [];
    Object.assign(H2, { moveSince: outer.since, taken: outer.taken });
  }
  const stop = stoppedDuring(before);
  if (!stop) {
    outer.taken?.push(...taken2);
    return reply2;
  }
  const left2 = [];
  for (const seat2 of taken2) {
    const word3 = await dropTaken(seat2);
    if (word3) left2.push(word3);
  }
  forgetSeat(stop);
  const text2 = [stop, ...left2].join("\n");
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { isError: true, content: [{ type: "text", text: text2 }] }
  };
}
async function registerRefused(r, realm, taken2, prior, addr) {
  const text2 = short(r.text);
  if (!taken2 || !prior) return refusedWord("register", r, realm, sw2().takenButRegister(text2));
  const refusal2 = refusedWord("register", r, realm, sw2().refused("register", text2));
  if (stoppedInMove()) return refusal2;
  const left2 = await dropTaken(taken2);
  if (left2) return `${refusal2}
${left2}`;
  if (stoppedInMove()) return refusal2;
  state.standing = { ...prior };
  if (addr) holdStanding(addr.url, addr.statusUrl);
  const back = await callTool(tool("channel"), {
    action: "register",
    ...prior,
    ...placeFields(prior, true)
  });
  const word3 = mw2().moveUndone(taken2.name, prior.name ?? "");
  return `${refusal2}
${back.isError ? `${word3} register: ${short(back.text, 160)}` : word3}`;
}

// js/bridge/standtool.ts
var STAND_TOOL_NAME = tool("stand");
var str2 = (description) => ({ type: "string", description });
var standTool = () => {
  const w = words(STAND_TOOL);
  return {
    name: STAND_TOOL_NAME,
    description: w.description(),
    inputSchema: {
      type: "object",
      properties: {
        realm: str2(w.realm()),
        karta: str2(w.karta()),
        name: str2(w.name()),
        room: str2(w.room()),
        model: str2(w.model()),
        mute_siblings: { type: "boolean", description: w.muteSiblings() },
        take: { type: "boolean", description: w.take() },
        room_karta: str2(w.roomKarta()),
        repeat_knock: { type: "boolean", description: w.repeatKnock() },
        satellite_of: str2(w.satelliteOf()),
        status: str2(w.status()),
        cwd: str2(w.cwd())
      },
      required: ["realm"]
      // karta only takes a seat; busyness on a held seat goes without it (graph @nks/nks-dev, node #6509)
    }
  };
};

// js/bridge/stand.ts
var R5 = scoped(() => ({ again: false }));
var ledName = () => state.standing?.name ?? "";
var isDirectory2 = (p) => {
  try {
    return isAbsolute2(p) && statSync8(p).isDirectory();
  } catch {
    return false;
  }
};
var isStandCall = (msg) => msg?.method === "tools/call" && msg?.params?.name === tool("stand");
var runStand = (msg) => stopGuard(msg, () => standOnce(msg));
async function standOnce(msg) {
  const statusOnly = await standStatusOnly(msg);
  if ("reply" in statusOnly) return statusOnly.reply;
  const a = msg.params?.arguments ?? {};
  const auto = takesProvisional(msg);
  const stopsBefore = stopsNow();
  let realm = typeof a.realm === "string" ? a.realm.trim() : "";
  let karta = a.karta != null ? normKarta(a.karta) : "";
  const lines = [];
  const done = (isError = false) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: {
      ...isError ? { isError: true } : {},
      ...isError ? {} : { structuredContent: seatProof(heldKey(realm)) },
      content: [{ type: "text", text: lines.join("\n") }]
    }
  });
  if (!realm || !karta) {
    lines.push(
      needRealmKarta(statusOnly.miss, statusOnly.of) + await standAgainWord(realm, karta, statusOnly.miss)
    );
    return done(true);
  }
  const model = typeof a.model === "string" && a.model.trim() ? a.model : void 0;
  rememberStandModel(model);
  const cwd = typeof a.cwd === "string" && a.cwd.trim() ? a.cwd.trim() : sessionCwd();
  if (cwd !== sessionCwd() && !isDirectory2(cwd)) {
    lines.push(sw2().badCwd(cwd, !isAbsolute2(cwd)));
    return done(true);
  }
  const nameNotes = [];
  const asked = normName(a.name);
  if (asked) {
    const fault = nameFault(asked);
    if (fault) {
      lines.push(sw2().badName(asked, fault, NAME_MAX));
      return done(true);
    }
  }
  const notOwner = await ownerRefusal(realm, karta);
  if (notOwner) return lines.push(notOwner), done(true);
  const gate = await satelliteGate(a, realm, karta, asked);
  if (gate && !gate.ok) {
    lines.push(gate.refusal);
    return done(true);
  }
  const sat = gate?.ok ? { name: gate.name, caller: gate.caller } : null;
  if (gate?.ok) nameNotes.push(...gate.notes);
  const parts = asked || sat ? null : deriveParts(model, cwd);
  const fitted = parts ? fitName(parts) : null;
  const derived = asked || sat ? "" : fitted?.name ?? "";
  let name2 = asked || sat?.name || (auto ? name(derived) : derived);
  const base = sat ? "" : name2;
  realm = await seatRealm(realm, name2);
  karta = seatKarta(realm, karta, name2);
  const led0 = state.standing && !otherRealm(state.standing.realm, realm) ? state.standing : null;
  const ledSuffix = !!base && !!led0 && String(led0.karta) === String(karta) && led0.name !== base && baseOf2(led0.realm, led0.karta, led0.name ?? "") === base;
  const besideTaken = ledSuffix && !!led0 && wasEvicted(led0.realm, led0.karta, led0.name ?? "");
  if (ledSuffix && !besideTaken && a.take !== true) name2 = led0?.name ?? name2;
  const ledThere = sat ? void 0 : ledIn2(realm);
  const replaces = replacesProvisional(realm, auto);
  const prior = (a.take === true || replaces) && ledThere?.name && (ledThere.name !== name2 || String(ledThere.karta) !== karta) ? { ...ledThere } : null;
  if (parts && fitted && fitted.cut.length) {
    const what = fitted.cut.map((k) => sw2().cutPart(k)).join(", ");
    nameNotes.push(sw2().nameCut(joinName(parts), NAME_MAX, name2, what));
  }
  if (!asked && !sat && !model) nameNotes.push(sw2().noModel());
  const room = typeof a.room === "string" && a.room.trim() ? a.room.trim() : null;
  const unresolved2 = unresolvedRefusal(realm) ?? unresolvedAgent(karta, "connect");
  if (unresolved2) return lines.push(unresolved2), done(true);
  const led = besideTaken ? null : leadsOtherPlace(realm, karta, name2);
  if (led && a.take !== true && !replaces) {
    const hearing2 = await askedHearing(realm, karta, name2, cwd);
    lines.push(otherPlaceWord(led, keyOf(realm, karta, name2), name2 === ledName(), hearing2));
    return done(true);
  }
  const noChannel = besideRefusal(realm, "stand");
  if (noChannel) {
    lines.push(noChannel);
    return done(true);
  }
  const holdsMain = prior ? besideHoldsMain(realm, prior, name2) : null;
  if (holdsMain) return lines.push(holdsMain), done(true);
  const prim = state.standing;
  const beside = !!prim && otherRealm(realm, prim.realm) && !holdsStanding(realm, karta, name2);
  noteStandCwd(cwd);
  const here = (move = "register") => placeFields({ realm, karta, name: name2 }, true, move);
  const reg = () => callTool(tool("channel"), { action: "register", realm, karta, name: name2, ...here() });
  const { register, kept: modelKept } = clearingRegister(reg, realm);
  const board = await callTool(tool("channel"), { action: "list", realm });
  if (board.isError) {
    lines.push(sw2().boardUnread(short(board.text)));
    return done(true);
  }
  const bd = readBoard(board);
  const { entries: entries2, recognized, declared } = bd;
  let own = entries2.filter((e) => ofSeat(e, karta, name2));
  const unread = declared != null && declared !== entries2.length;
  const hearing = (n) => boardHearing(bd, karta, n);
  if (!recognized || own.length > 1 || hearing(name2) === "unknown" && a.take !== true) {
    lines.push(
      !recognized ? sw2().boardUnknown(short(board.text, 160), ...boardHeaders()) : own.length > 1 ? sw2().boardAmbiguous(own.length, name2, karta) : sw2().boardCount(declared ?? 0, entries2.length)
    );
    return done(true);
  }
  let ownSession = false;
  let byRecord = null;
  const root = !base ? "" : asked ? baseOf2(realm, karta, base) : base;
  if (base && (a.take !== true || beside) && name2 === base) {
    const seat2 = await seatFor(realm, karta, base, hearing, beside, cwd, root);
    const choice = seat2.choice;
    byRecord = seat2.resumed;
    if ("refusal" in choice) {
      lines.push(choice.refusal);
      return done(true);
    }
    name2 = choice.name;
    ownSession = choice.own;
    own = entries2.filter((e) => ofSeat(e, karta, name2));
    if (own.length > 1) {
      lines.push(sw2().boardAmbiguous(own.length, name2, karta));
      return done(true);
    }
    if (choice.note) nameNotes.push(choice.note);
  }
  if (base) noteSeatBase(keyOf(realm, karta, name2), root);
  const take2 = a.take === true || ownSession;
  const stem = name2.split(".").slice(0, 2).join(".");
  const branches = new Set(
    git(["branch", "--format=%(refname:short)"], cwd).split("\n").map((x) => sanitize(x.trim())).filter(Boolean)
  );
  const legacy = entries2.filter((e) => {
    if (sat) return false;
    if (e.karta !== karta || nameOf(e.address) === name2) return false;
    const own2 = nameOf(e.address);
    if (!own2.startsWith(`${stem}.`)) return false;
    const third = own2.slice(stem.length + 1);
    return branches.has(third) && alive(e);
  });
  for (const e of legacy) nameNotes.push(sw2().legacy(e.address, realm, karta));
  if (unread) lines.push(sw2().boardCountFound(declared ?? 0, entries2.length));
  const mine = own[0];
  let how2;
  let heardHere;
  const reopening = !sat && !holdsStanding(realm, karta, name2) && ledHere(realm, karta, name2);
  const listensElsewhere = !!mine && listens(mine) && !holdsStanding(realm, karta, name2) && !reopening;
  const fresh2 = !sat && !take2 && !reopening && !holdsStanding(realm, karta, name2) && !isParked(realm, karta, name2) && !theirsByRecord(keyOf(realm, karta, name2));
  const resumed = byRecord ?? (fresh2 && !listensElsewhere ? await resumeFromDisk(realm, karta, name2) : null);
  const stopped = stoppedSince(stopsBefore, keyOf(realm, karta, name2));
  if (stopped) {
    lines.push(stopped);
    return done(true);
  }
  const extra = [];
  let socketBefore = false;
  let priorKept = false;
  if (beside) {
    const freed = prior ? await releasePrior(realm, prior) : null;
    if (freed && !freed.ok) return lines.push(freed.note), done(true);
    if (freed) extra.push(sw2().note(freed.note));
    const r = await register();
    if (r.isError) {
      lines.push(refusedWord("register", r, realm));
      return done(true);
    }
    heardHere = holdsStanding(realm, karta, name2);
    if (heardHere && !standingIdIn(realm)) extra.push(sw2().noIdInRegister());
    how2 = sw2().howBeside(ledKey() ?? "");
  } else if (resumed) {
    const r = await register();
    if (r.isError) {
      lines.push(refusedWord("register", r, realm));
      return done(true);
    }
    heardHere = true;
    socketBefore = true;
    how2 = `${resumed.word}, register`;
  } else if (!take2 && isParked(realm, karta, name2) && returnToStanding(tool("stand"))) {
    await heardOnReturn();
    const stoppedBack = stoppedSince(stopsBefore, keyOf(realm, karta, name2));
    if (stoppedBack) {
      lines.push(stoppedBack);
      return done(true);
    }
    if (!holdsStanding(realm, karta, name2) && !R5.again) {
      R5.again = true;
      try {
        return await standOnce(msg);
      } finally {
        R5.again = false;
      }
    }
    const r = await register();
    if (r.isError) {
      lines.push(refusedWord("register", r, realm));
      return done(true);
    }
    heardHere = true;
    how2 = sw2().howReturned();
  } else if (!take2 && (holdsStanding(realm, karta, name2) || reopening)) {
    const r = await register();
    if (r.isError) {
      lines.push(refusedWord("register", r, realm));
      return done(true);
    }
    heardHere = true;
    socketBefore = true;
    how2 = sw2().howRegister();
  } else if (!take2 && listensElsewhere) {
    lines.push(sw2().otherHolder(mine?.address ?? name2));
    return done(true);
  } else {
    const args = { action: "connect", realm, karta, name: name2 };
    Object.assign(args, here("connect"));
    if (typeof a.mute_siblings === "boolean") args.mute_siblings = a.mute_siblings;
    if (sat) args.ttl_seconds = SATELLITE_TTL_S;
    const addr = heldAddress(realm, prior);
    const connect5 = () => callTool(tool("channel"), args);
    const re = await connectInMove(stopsBefore, { realm, karta, name: name2 }, connect5, async () => {
      const c0 = await connect5();
      if (!sat || !c0.isError || !ttlRefused(c0)) return c0;
      extra.push(sw2().ttlRefused(SATELLITE_TTL_S, short(c0.text, 120)));
      delete args.ttl_seconds;
      return connect5();
    });
    const { c, own: ownReopen, taken: taken2 } = re;
    if (re.note) extra.push(sw2().note(re.note));
    if (c.isError && !ownReopen) {
      lines.push(refusedWord("connect", c, realm));
      return done(true);
    }
    const r = await register();
    if (r.isError) {
      lines.push(await registerRefused(r, realm, taken2, prior, addr));
      return done(true);
    }
    resetKnocks(realm, karta, name2);
    heardHere = true;
    socketBefore = ownReopen;
    how2 = ownReopen ? sw2().howRegister() : ownSession ? sw2().howOwnSession() : sw2().howConnect(!!mine, listensElsewhere, a.take === true);
    if (takeLapsed()) extra.push(sw2().note(resumeWords.rejoin()));
    const freed = prior ? await releasePrior(realm, prior) : null;
    if (freed) extra.push(sw2().note(releasedNote(replaces, freed, prior?.name ?? "")));
    priorKept = !!freed && !freed.ok;
  }
  lines.push(
    sw2().head(mine?.address ?? name2, karta, realm, how2),
    ...nameNotes.map((n) => sw2().note(n)),
    ...extra,
    ...modelKept() ? [sw2().modelNotCleared(modelKept())] : []
  );
  const block = heardHere ? sat ? satelliteListenWord() : listenBlock(realm) : null;
  if (block) lines.push(block);
  else lines.push(heardHere ? sw2().noSocket() : sw2().noWatchdog());
  if (!heardHere) lines.push(sw2().besideNoDoor());
  else if (beside) lines.push(sw2().besideHeard());
  else if (socketBefore) lines.push(sw2().heldAlready());
  else {
    const hello = await awaitHello(4e3);
    lines.push(hello ? sw2().hello(String(hello.pending ?? 0)) : sw2().noHello());
  }
  const localFault = heardHere ? doors().find((d) => d.key === heldKey(realm))?.listenError ?? null : null;
  if (localFault) lines.push(sw2().noLocalSocket(localFault));
  if (room && !heardHere) {
    lines.push(sw2().knockNotHere(room));
  } else if (room) {
    const onBoard = entries2.find((e) => e.address === room);
    const roomKarta = onBoard?.karta ?? (typeof a.room_karta === "string" && a.room_karta.trim() ? a.room_karta.trim().replace(/^#/, "") : null);
    lines.push(
      await knock({ realm, karta, name: name2, room, roomKarta, again: a.repeat_knock === true })
    );
  }
  if (typeof a.status === "string" && a.status.trim() && !hasStatusAddressFor(realm, karta, name2)) {
    lines.push(sw2().statusElsewhere(TAKE_PATH()));
  } else if (typeof a.status === "string" && a.status.trim()) {
    const st = await publishStatus(a.status.trim(), realm);
    lines.push(
      st.ok ? busyLine(a.status.trim(), realm) : sw2().statusRefused(short(st.body), st.code === 404 ? ` ${TURNED_GUIDANCE()}` : "")
    );
  }
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  if (stale) lines.push(stale);
  if (!priorKept) noteStood(auto, realm, karta, name2);
  return done(priorKept);
}

// js/bridge/standwire.ts
async function standAs(id, place, cwd) {
  const { realm, karta, name: name2 } = place;
  const where = cwd && isDirectory2(cwd) ? { cwd } : {};
  const r = await withSeatOrigin(
    true,
    () => runStand({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: tool("stand"), arguments: { realm, karta: String(karta), name: name2, ...where } }
    })
  );
  const text2 = (r.result?.content ?? []).map((c) => c.text ?? "");
  return { ok: !r.result?.isError, text: text2.join("\n") };
}
wireEviction(
  (place, cwd) => serialized(
    () => standAs(
      `${ID_PREFIX}bridge-evicted`,
      { ...place, name: baseOf2(place.realm, place.karta, place.name ?? "") },
      // the base the seat was chosen from (#6706)
      cwd
    )
  )
);
wireTakeOwn(async (rec5, cwd) => {
  const r = await standAs(`${ID_PREFIX}bridge-resume`, rec5, cwd);
  if (r.ok) restore(rec5);
  return r.text.split("\n")[0];
});

// js/bridge/stophold.ts
var whoOf3 = (reason) => reason === "revoked:person" ? "person" : reason === "revoked:self" ? "self" : "other";
var stopWord = (name2, reason) => words(STOP).stopped(name2, whoOf3(reason));
function dropUnsent(key2, doors2) {
  const n = doors2.reduce((sum, d) => sum + (d?.dropBatches() ?? 0), 0);
  if (n) standingLog(`stopped ${key2}: ${n} undelivered frame(s) dropped, not given`);
}
function stopAgent(key2, how2, reason, order) {
  const text2 = stopWord(state.standing?.name ?? "", reason);
  log(text2);
  standingLog(`stopped ${key2}: ${how2}${reason ? ` (${reason})` : ""}`);
  dropUnsent(key2, [H2.door, ...extraPlaces().map((p) => p.door)]);
  H2.stopped = { n: H2.stopped.n + 1, key: key2, text: text2 };
  const ev = {
    kind: "stopped",
    key: key2,
    text: text2,
    ...reason ? { reason } : {},
    ...order ? { order } : {}
  };
  broadcast(ev);
  notify("error", ev);
  forgetSeat(text2);
}
function stopBeside(beside, reason) {
  const text2 = stopWord(beside.standing.name ?? "", reason);
  log(`${text2} — that seat beside is forgotten, the rest are held`);
  dropUnsent(beside.door.key, [beside.door]);
  dropExtra(beside.door.key, text2, true, "beside");
}
function stopSeatByOrder(id, by, order) {
  const reason = by ? `revoked:${by}` : "";
  const seat2 = seatOf(id);
  if (seat2 === "main" && H2.currentKey)
    stopAgent(H2.currentKey, `stop order ${order}`, reason, order);
  else if (seat2 && seat2 !== "main") stopBeside(seat2, reason);
  return seat2 === null ? null : seat2 === "main" ? "main" : "beside";
}
function seatOf(id) {
  const beside = extraPlaces().find((p) => p.door.standingId === id);
  if (beside) return beside;
  const main = H2.door?.standingId;
  if (!H2.door || !H2.currentKey || (main ? main !== id : extraPlaces().length > 0)) return null;
  return "main";
}
var holdsSeat = (id, framed) => framed ? seatOf(id) !== null : H2.door?.standingId === id || extraPlaces().some((p) => p.door.standingId === id);
function seatEnded(key2, frame2) {
  const id = typeof frame2.standing_id === "string" ? frame2.standing_id : "";
  const reason = typeof frame2.by === "string" ? `revoked:${frame2.by}` : "";
  const beside = id ? extraPlaces().find((p) => p.door.standingId === id) : void 0;
  if (beside) {
    const own = H2.closingOwn ? holdWords().closedOwn() : H2.revokingBeside.has(beside.door.key) ? holdWords().revokedOwn() : null;
    if (own) {
      log(
        `seat beside ${beside.door.key} released quietly (standing_ended arrived before the answer)`
      );
      return dropExtra(beside.door.key, own, true, "own");
    }
    return stopBeside(beside, reason);
  }
  const main = H2.door?.standingId;
  if (id && (main ? main !== id : extraPlaces().length > 0))
    return log(`standing_ended for seat ${id}, not one this bridge knows — ignored`);
  if (releasedAsOwn("standing_ended")) return;
  stopAgent(key2, "standing_ended", reason);
}
whenStopped(
  (key2, code, reason, ended) => ended ? seatEnded(key2, ended) : stopAgent(key2, `close ${code}`, reason)
);

// js/bridge/orderflight.ts
var WAIT_MS = Number(process.env[envName("BRIDGE_ORDER_WAIT_MS")]) || 4e3;
var F2 = scoped(() => ({ running: /* @__PURE__ */ new Map() }));
function fly(id, run) {
  const f = { done: Promise.resolve(), end: null };
  const running = F2.running;
  f.done = run(f).finally(() => running.delete(id));
  running.set(id, f);
  return f.done;
}
async function ordersSettled() {
  const running = F2.running;
  if (!running.size) return;
  await Promise.race([
    Promise.allSettled([...running.values()].map((f) => f.done)),
    sleep(WAIT_MS)
  ]);
  for (const [id, f] of running) {
    const known2 = readOrder(id);
    if (f.end && !(known2 && isTerminal(known2.state))) writeOrder(f.end);
    log(
      `stop order ${id}: the bridge ends before its answer — ${f.end ? "left in the journal" : "no outcome yet"}`
    );
  }
}

// js/bridge/orderread.ts
var PAGE = 200;
var MAX_PAGES = 50;
async function ordersPage(base, since) {
  try {
    const q = `open=true&limit=${PAGE}${since ? `&since=${since}` : ""}`;
    const res = await fetch(`${base}/me/orders?${q}`, {
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return null;
    const body = await res.json();
    const orders = (Array.isArray(body.items) ? body.items : []).map((x) => x).filter((x) => typeof x.id === "string" && typeof x.standing_id === "string").map((x) => ({
      id: x.id,
      standing_id: x.standing_id,
      ...typeof x.seq === "number" ? { seq: x.seq } : {},
      ...typeof x.reason_code === "string" ? { reason_code: x.reason_code } : {},
      ...typeof x.by === "string" ? { by: x.by } : {},
      ...typeof x.issued_at === "string" ? { issued_at: x.issued_at } : {},
      ...typeof x.ack_window_seconds === "number" ? { ack_window_seconds: x.ack_window_seconds } : {}
    }));
    const next = typeof body.next_since === "number" ? body.next_since : since;
    return { orders, next };
  } catch {
    return null;
  }
}
async function readOpenOrders(base, take2) {
  const start = readSince(base);
  const read = [];
  const running = [];
  let since = start;
  for (let n = 0; n < MAX_PAGES; n++) {
    const page = await ordersPage(base, since);
    if (!page?.orders.length) break;
    read.push(...page.orders);
    running.push(...take2(page.orders));
    if (page.next <= since) break;
    since = page.next;
  }
  await Promise.allSettled(running);
  let floor = start;
  for (const o of read) {
    if (typeof o.seq !== "number" || !settled(o.id)) break;
    floor = Math.max(floor, o.seq);
  }
  if (floor > start) writeSince(base, floor);
}

// js/bridge/stoporder.ts
var taken = /* @__PURE__ */ new Set();
var ACCEPT_CAP_MS = 2e3;
var str3 = (v) => typeof v === "string" ? v : "";
function orderOf(frame2) {
  const id = str3(frame2.order_id);
  const standing = str3(frame2.standing_id);
  if (!id || !standing) return null;
  const span = frame2.ack_window_seconds;
  return {
    id,
    standing_id: standing,
    reason_code: str3(frame2.reason_code),
    by: str3(frame2.by),
    issued_at: str3(frame2.issued_at),
    ...typeof span === "number" ? { ack_window_seconds: span } : {}
  };
}
function journalRefused(id, outcome) {
  const text2 = words(STOP).orderJournalRefused(id, outcome);
  log(text2);
  broadcast({ kind: "note", text: text2 });
  notify("warning", { kind: "note", text: text2 });
}
async function stopOf(o, entry) {
  const confirms = confirmsHalts();
  let seat2;
  try {
    seat2 = stopSeatByOrder(o.standing_id, o.by ?? "", o.id);
  } catch (e) {
    log(`stop order ${o.id}: the stop failed — ${e.message}`);
    return { ...entry, state: "failed", reason: "stop_failed" };
  }
  if (seat2 === null) return { ...entry, state: "unknown", reason: "seat_gone_before_stop" };
  if (seat2 === "beside") return { ...entry, state: "stopped", reason: "seat_beside" };
  if (!confirms) return { ...entry, state: "stopped", reason: "word_given" };
  const code = await awaitHalt(o.id);
  if (code === null) return { ...entry, state: "stopped", reason: "halt_confirmed" };
  log(`stop order ${o.id}: the harness's stop — ${code}`);
  return code === SILENT ? { ...entry, state: "unknown", reason: SILENT } : { ...entry, state: "failed", reason: code };
}
async function finish(end) {
  standingLog(
    `stop order ${end.id} for ${end.standing}: ${end.state}${end.reason ? ` (${end.reason})` : ""}`
  );
  if (writeOrder(end)) return answerOutcome(end);
  journalRefused(end.id, true);
  await sendAck(end.base, end.id, end.state, end.reason);
}
async function execute(o, base, framed) {
  const known2 = readOrder(o.id);
  if (known2 && isTerminal(known2.state)) {
    log(`stop order ${o.id} again — the same outcome ${known2.state}, no second stop`);
    return answerOutcome(known2);
  }
  if (taken.has(o.id) || !framed && !holdsSeat(o.standing_id, false)) return;
  taken.add(o.id);
  return fly(o.id, (f) => carry(o, base, f));
}
async function carry(o, base, f) {
  const at2 = Date.now();
  const entry = {
    id: o.id,
    standing: o.standing_id,
    state: "accepted",
    base,
    acked: false,
    at: at2,
    pid: process.pid,
    until: windowEnd(o, at2)
  };
  if (!holdsSeat(o.standing_id, true))
    return finish({ ...entry, state: "refused", reason: "seat_not_held" });
  const kept2 = writeOrder(entry);
  if (!kept2) journalRefused(o.id, false);
  const accepted = kept2 ? sendAck(base, o.id, "accepted") : null;
  if (accepted) await Promise.race([accepted, sleep(ACCEPT_CAP_MS)]);
  const end = f.end = await stopOf(o, entry);
  await accepted;
  await finish(end);
}
function onOrder(url, frame2) {
  const base = apiBase(url);
  if (frame2?.type === "hello") {
    repeatLater(true);
    void readOpenOrders(base, (orders) => orders.map((o2) => execute(o2, base, false)));
    return false;
  }
  if (frame2?.type !== "stop") return false;
  const o = orderOf(frame2);
  if (!o) log(`stop frame without order_id or standing_id — ignored, not given to the agent`);
  else void execute(o, base, true);
  return true;
}
whenOrdered(onOrder);

// js/bridge/session.ts
import { createInterface as createInterface2 } from "node:readline";

// js/bridge/audience.ts
function refusedAudience(upstream) {
  const head = `upstream refuses even a freshly obtained access token (${upstream}) — not an expiry; the token's audience/resource may not match what the server validates`;
  const s2 = loadStore();
  if (!s2.tokens?.by_code) {
    return `${head} (operator lever: ${envName("BRIDGE_RESOURCE")}), or the server's token validation is off`;
  }
  const resource = s2.meta ? resourceOf(s2.meta) : CFG.serverUrl;
  return `${head}: this grant came by sign-in by code through client ${s2.tokens.client_id ?? "?"}, so its audience is that client's default audience on the sign-in server, which must be ${resource} — a move for the operator of the sign-in server; ${envName("BRIDGE_RESOURCE")} does not reach a grant by code`;
}

// js/bridge/moment.ts
var statusLine = () => words(MOMENT).status();
var leaveLine = () => words(MOMENT).leave();
var WRITE_TOOL = new RegExp(`^${escapeRe(TOOL_PREFIX)}(add_[a-z_]+|batch)$`);
var FORMER_MOMENTS = Object.values(MOMENT).flatMap((w) => w.formerMoments());
function withoutFormerMoment(d) {
  for (let changed = true; changed; ) {
    changed = false;
    for (const line of FORMER_MOMENTS) {
      if (d.length <= line.length + 2) continue;
      if (d.startsWith(`${line}

`)) d = d.slice(line.length + 2);
      else if (d.endsWith(`

${line}`)) d = d.slice(0, d.length - line.length - 2);
      else continue;
      changed = true;
    }
  }
  return d;
}
function annotateToolList(reply2) {
  const tools = reply2?.result?.tools;
  if (!Array.isArray(tools)) return;
  const at2 = tools.findIndex((t) => t?.name === STAND_TOOL_NAME);
  if (at2 >= 0) tools[at2] = standTool();
  else tools.push(standTool());
  for (const t of tools) {
    if (t && typeof t.description === "string" && WRITE_TOOL.test(String(t.name)))
      t.description = withoutFormerMoment(t.description);
    if (!t || t.name !== tool("channel") || typeof t.description !== "string") continue;
    if (!t.description.includes(leaveLine())) t.description = `${leaveLine()}

${t.description}`;
    if (!t.description.includes(statusLine())) t.description = `${statusLine()}
${t.description}`;
  }
}

// js/bridge/narrow.ts
var PLACE_MOVES = /* @__PURE__ */ new Set(["mint", "connect", "sessions"]);
var PLACE_FIELDS = ["ttl_seconds", "mute_siblings"];
function clientName2() {
  const info = state.initParams?.clientInfo;
  return typeof info?.name === "string" ? info.name : "";
}
function toolSet() {
  return CFG.tools ? /* @__PURE__ */ new Set([...CFG.tools, STAND_TOOL_NAME]) : null;
}
var ownRealmList = (msg) => String(msg.id ?? "").startsWith(`${ID_PREFIX}thin-realms-`) && msg.params?.name === tool("realm") && String(msg.params?.arguments?.action ?? "") === "list";
function outsideSetRefusal(msg) {
  if (msg?.method !== "tools/call" || msg.id === void 0 || msg.id === null) return null;
  if (ownRealmList(msg)) return null;
  const set = toolSet();
  const name2 = String(msg.params?.name ?? "");
  if (!set || set.has(name2)) return null;
  const list3 = [...set].sort().join(", ");
  const text2 = words(NARROW).outsideSet(name2, list3);
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { isError: true, content: [{ type: "text", text: text2 }] }
  };
}
function withoutPlaceMoves(text2) {
  return text2.replace(
    ACTION_LIST_RE,
    (_, head, list3) => head + list3.split("|").map((s2) => s2.trim()).filter((s2) => !PLACE_MOVES.has(s2)).join(" | ")
  );
}
function withoutSchema(t) {
  const { outputSchema: _, ...rest2 } = t;
  return rest2;
}
function channelForHarness(t) {
  const schema = t.inputSchema;
  const props = schema?.properties;
  if (!schema || !props) return t;
  const kept2 = {};
  for (const [k, v] of Object.entries(props)) if (!PLACE_FIELDS.includes(k)) kept2[k] = v;
  const action = kept2.action;
  if (action) {
    const a = { ...action };
    if (typeof a.description === "string") a.description = withoutPlaceMoves(a.description);
    if (Array.isArray(a.enum)) a.enum = a.enum.filter((x) => !PLACE_MOVES.has(String(x)));
    kept2.action = a;
  }
  const next = { ...schema, properties: kept2 };
  if (Array.isArray(schema.required))
    next.required = schema.required.filter((r) => !PLACE_FIELDS.includes(String(r)));
  return { ...t, inputSchema: next };
}
function narrowToolList(reply2) {
  const tools = reply2?.result?.tools;
  if (!Array.isArray(tools) || clientName2() === SURFACE_CLIENT) return reply2;
  const set = toolSet();
  const fields = harnessAsksFields();
  const shown = tools.filter((t) => !set || set.has(String(t?.name))).map((t) => t?.name === tool("channel") ? channelForHarness(t) : t).map((t) => fields || !t || !("outputSchema" in t) ? t : withoutSchema(t));
  return { ...reply2, result: { ...reply2.result, tools: shown } };
}

// js/bridge/pending.ts
function pendingFrames() {
  let n = 0;
  for (const d of doors()) {
    const counted = /* @__PURE__ */ new Set();
    const held2 = [
      ...d.ring.map((r) => r.frame),
      ...d.stale.frames,
      ...d.backlog.frames,
      ...d.roomBatch.frames
    ];
    for (const frame2 of held2) {
      const one = typeof frame2?.id === "string" ? frame2.id : frame2;
      if (frame2?.type !== "message" || counted.has(one)) continue;
      counted.add(one);
      if (!isDelivered(deliveryKeys(frame2), d.seen, d.seenPath)) n++;
    }
  }
  return n;
}

// js/bridge/work.ts
var W3 = scoped(() => ({ at: 0 }));
var heard = null;
function noteAgentWork(at2 = Date.now()) {
  W3.at = at2;
  heard?.();
}
function onAgentWork(fn) {
  heard = fn;
}
var lastAgentWork = () => W3.at;

// js/bridge/pulse.ts
var GAP_MS = Number(process.env[envName("PULSE_GAP_MS")]) || 3e4;
var STATES = /* @__PURE__ */ new Set(["idle", "busy", "interrupted", "failed", "unknown"]);
var P4 = scoped(() => ({
  /** The harness's word: state and the moments it knows. */
  said: {},
  sent: null,
  sentAt: 0,
  timer: null,
  tick: null
}));
var iso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : void 0;
function current() {
  const { state: state2, turn_at, read_at } = P4.said;
  const work = lastAgentWork();
  return {
    type: "pulse",
    state: state2 ?? "unknown",
    pending: pendingFrames(),
    ...turn_at ? { turn_at } : {},
    ...read_at ? { read_at } : {},
    ...work ? { cycle_at: new Date(work).toISOString() } : {}
  };
}
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function send(p, holder = H2.holder) {
  if (P4.timer) clearTimeout(P4.timer);
  P4.timer = null;
  if (!holder?.send(JSON.stringify(p))) return;
  P4.sent = p;
  P4.sentAt = Date.now();
}
function consider(now2 = false) {
  if (!H2.holder?.alive || H2.unheard) return;
  const p = current();
  if (same(P4.sent, p)) return;
  const wait = now2 ? 0 : P4.sentAt + GAP_MS - Date.now();
  if (wait <= 0) return send(p);
  if (!P4.timer) {
    P4.timer = setTimeout(
      bindScope(() => {
        P4.timer = null;
        consider();
      }),
      wait
    );
    P4.timer.unref?.();
  }
}
function watch() {
  if (P4.tick) return;
  P4.tick = setInterval(
    bindScope(() => {
      if (H2.holder?.alive) return consider();
      if (H2.door) return;
      clearInterval(P4.tick ?? void 0);
      P4.tick = null;
    }),
    GAP_MS
  );
  P4.tick.unref?.();
}
whenPulsed((why, holder) => {
  if (why === "hello") {
    P4.sent = null;
    watch();
    return consider(true);
  }
  if (why === "frame") return consider();
  const p = current();
  if (!same(P4.sent, p)) send(p, holder);
  if (P4.timer) clearTimeout(P4.timer);
  P4.timer = null;
});
onAgentWork(() => consider());
var sentPulse = () => P4.sent ? { ...P4.sent, sent_at: new Date(P4.sentAt).toISOString() } : null;
var isPulseCall = (msg) => msg?.method === method("pulse");
function runPulse(msg) {
  const answer2 = (result) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result
  });
  if (!HOSTED_CLIENTS.has(harnessName())) return answer2({ taken: false, pulse: null });
  const p = msg.params ?? {};
  const said2 = { ...P4.said };
  if (typeof p.state === "string" && STATES.has(p.state)) said2.state = p.state;
  for (const k of ["turn_at", "read_at"]) {
    const v = iso(p[k]);
    if (v && (!said2[k] || v > said2[k])) said2[k] = v;
  }
  P4.said = said2;
  try {
    consider();
  } catch (e) {
    log(`pulse: not considered — ${e.message}`);
  }
  return answer2({ taken: true, pulse: current() });
}

// js/bridge/skillrefresh.ts
var S3 = scoped(() => ({ refreshing: null }));
async function refreshSkills() {
  if (S3.refreshing) return S3.refreshing;
  S3.refreshing = serialized(async () => {
    const primary = state.standing;
    if (!primary || !state.sessionId || !skillsCheckDue()) return;
    for (const place of [primary, ...state.places]) {
      if (isParked(place.realm, place.karta, place.name ?? "")) continue;
      if (wasEvicted(place.realm, place.karta, place.name ?? "")) continue;
      if (!skillsNeedRegister(place)) continue;
      if (deafPlaceIn(place.realm) && await deafSeatTaken(place)) {
        retrySkillsCheck();
        continue;
      }
      const got = await replayRegister(place, false);
      if (seatIsGone(got)) {
        if (place === primary ? state.standing !== place : !state.places.includes(place)) continue;
        const why = words(STANDING).seatExpired();
        log(`skills refresh: place ${keyOfPlace(place)} is gone, forgetting it`);
        if (place === primary) {
          state.standing = null;
          releaseStanding(why, true);
          break;
        }
        const key2 = keyOfPlace(place);
        dropExtra(key2, why, true);
        state.places = state.places.filter((p) => keyOfPlace(p) !== key2);
      } else if (!got || got.error || got.result?.isError) retrySkillsCheck();
    }
  }).catch((e) => {
    retrySkillsCheck();
    log(`skills refresh failed: ${errorMessage(e)}`);
  }).finally(() => {
    S3.refreshing = null;
  });
  return S3.refreshing;
}

// js/bridge/standdelivery.ts
var standForHarness = async (msg, notice) => forHarness(notice(await serialized(() => withCallOrigin(msg.id, () => runStand(msg)))));
var resumeByOrigin = (msg) => serialized(
  () => withSeatOrigin(true, () => isResumeCall(msg) ? runResume(msg) : runCheck(msg))
);

// js/bridge/deliver.ts
function syntheticError(id, message, outcome = UpstreamError.UNKNOWN, holdOff = false) {
  const kind = holdOff === true ? "wait" : holdOff;
  const verdict = outcome === UpstreamError.NOT_SENT ? kind === "wait" ? (
    // Safe and not-yet are different axes, and an agent told only "safe" reads
    // it as "now": it retries into the same wall, then goes looking for a
    // defect in what only time repairs. The interval itself stays where it was
    // measured — in the reason above — so one refusal never carries two.
    "Nothing was applied and the grant is whole — this clears itself by waiting, not by fixing: wait out the interval named above before retrying."
  ) : kind === "knock" ? "Nothing was applied and the grant is whole — a benign transition, not a broken authorization: retry the call now. Only a refusal that returns means the hour is real — that one names its own wait." : kind === "dead" ? "Nothing was applied, and no retry and no wait will change that — only a human with a new token can." : kind === "human" ? (
    // The agent reads this; the human does not. A retry buys nothing
    // and a wait shortens nothing — only handing the link over does.
    "Nothing was applied, and only the human can move this: hand them the link above — the local one opens only on this machine; from another, the sign-in page with the code, where one is named — the login is already waiting for their click. Once they finish, retry the call."
  ) : "The call never reached the server, so nothing was applied — retry freely." : "The call went out and its answer was lost, so THE OUTCOME IS UNKNOWN — re-read the target before retrying: a blind retry can apply a second time, and a write with no version guard duplicates silently.";
  const tail2 = kind ? "The bridge stays up." : "The bridge stays up; if this repeats, the server side needs attention.";
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32001,
      // BUILD is here for the field report: the error is quoted verbatim, and
      // the build string is what dates the code that produced it.
      message: `${BRIDGE_NAME} ${BUILD}: ${message}. ${verdict} ${tail2}`
    }
  };
}
var NET_BACKOFF_MS = (process.env[envName("BRIDGE_NET_BACKOFF_MS")] || "1000,2000,4000").split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
onReinitialized(() => {
  if (harnessListing()) return;
  return recheckTools(async () => {
    const id = `${ID_PREFIX}bridge-tools-${++state.reinitCounter}`;
    let got = null;
    await post2({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, (m) => {
      if (m.id === id) got = m;
    });
    const reply2 = got;
    if (!reply2?.result) return reply2;
    annotateToolList(reply2);
    saveServerCache({ tools: reply2.result });
    return narrowToolList(reply2);
  }, emit);
});
function isRead(msg) {
  if (msg?.method === "initialize" || msg?.method === "tools/list") return true;
  return msg?.method === "tools/call" && READ_TOOLS.has(String(msg.params?.name ?? ""));
}
function lastServerAnswer(msg) {
  const cache = loadServerCache();
  const result = msg?.method === "initialize" ? cache.init : msg?.method === "tools/list" && !msg.params?.cursor ? cache.tools : null;
  if (!result) return null;
  const reply2 = { jsonrpc: "2.0", id: msg.id, result };
  if (msg?.method !== "tools/list") return reply2;
  annotateToolList(reply2);
  const shown = narrowToolList(reply2);
  noteServedTools(shown.result);
  return shown;
}
function ownClient() {
  const info = state.initParams?.clientInfo;
  return typeof info?.name === "string" && OWN_CLIENTS.has(info.name);
}
function withNotice(reply2) {
  const content = reply2?.result?.content;
  if (!Array.isArray(content)) return reply2;
  const notice = takeNotice();
  if (notice && !content.some((c) => NOTICE_MARK.test(c?.text ?? ""))) {
    content.push({ type: "text", text: notice });
  }
  return reply2;
}
async function deliver(msg) {
  const listed = msg?.method === "tools/list" ? watchHarnessListing(msg, emit) : null;
  try {
    await deliverOne(msg);
  } finally {
    listed?.();
    settleOwnRevoke(msg);
    if (msg.method === "tools/call") void refreshSkills();
  }
}
async function deliverOne(msg) {
  const local = localStatus(msg) ?? localLeave(msg) ?? localSuspend(msg) ?? localEnd(msg) ?? localHalted(msg);
  if (local) {
    emit(await local);
    return;
  }
  const isInit = msg?.method === "initialize";
  if (isInit) state.initParams = msg.params;
  const harness = !ownClient();
  const hasId = msg?.id !== void 0 && msg?.id !== null;
  let authRetried = false;
  let heldRetried = false;
  let sessionRetried = false;
  let netTries = 0;
  let outcome = UpstreamError.NOT_SENT;
  const note3 = (e) => {
    if (!(e instanceof UpstreamError) || e.outcome === UpstreamError.UNKNOWN) {
      outcome = UpstreamError.UNKNOWN;
    }
  };
  const isToolCall = msg?.method === "tools/call";
  const isStand = isStandCall(msg);
  let heldReply;
  let standingRetried = false;
  const forward = (reply2) => {
    let m = reply2;
    if (isInit && m.id === msg.id && m.result?.protocolVersion) {
      state.protocolVersion = m.result.protocolVersion;
    }
    if (m.id === msg.id) noteStanding(msg, m);
    if (m.id === msg.id && m.result && isInit) saveServerCache({ init: m.result });
    if (m.id === msg.id && msg.method === "tools/list") {
      annotateToolList(m);
      if (m.result && !msg.params?.cursor) saveServerCache({ tools: m.result });
      m = narrowToolList(m);
      if (!msg.params?.cursor) noteServedTools(m.result, msg);
    }
    if (isToolCall && hasId && m.id === msg.id) {
      heldReply = m;
      return;
    }
    emit(m);
  };
  let endTaking = null;
  for (; ; ) {
    try {
      if (!isInit && state.sessionId && state.sessionToken && currentAccessToken() !== state.sessionToken) {
        log(
          "the access token changed since the session was opened — re-initializing before the call"
        );
        await reinitialize();
      }
      if (!isInit && !state.sessionId && state.initParams) {
        log("no upstream session yet — initializing before the call");
        await reinitialize();
      }
      if (!isInit) await ensureStanding();
      const taken2 = hasId ? evictedRefusal(msg) ?? await deafRefusal(msg) : null;
      if (taken2) {
        emit({
          jsonrpc: "2.0",
          id: msg.id,
          result: { isError: true, content: [{ type: "text", text: taken2 }] }
        });
        return;
      }
      if (isStand) {
        emit(await standForHarness(msg, withNotice));
        return;
      }
      if (isResumeCall(msg) || isCheckCall(msg)) {
        emit(await resumeByOrigin(msg));
        return;
      }
      if (isUsageCall(msg)) {
        emit(await serialized(() => runUsage(msg)));
        return;
      }
      if (isPulseCall(msg)) {
        emit(runPulse(msg));
        return;
      }
      heldReply = null;
      if (hasId && msg.method === "tools/call" && msg.params?.name === tool("channel"))
        await resolveAgainstLed(msg.params.arguments?.realm);
      const satWord = hasId && msg.method === "tools/call" && msg.params?.name === tool("channel") ? satelliteChannelRefusal(msg.params.arguments ?? {}) : null;
      const cross = satWord ? {
        jsonrpc: "2.0",
        id: msg.id,
        result: { isError: true, content: [{ type: "text", text: satWord }] }
      } : hasId ? outsideSetRefusal(msg) ?? crossPlaceRefusal(msg) : null;
      if (cross) {
        emit(cross);
        return;
      }
      const ch = msg.params?.arguments ?? {};
      const takes = hasId && msg.method === "tools/call" && msg.params?.name === tool("channel") && ["connect", "mint", "register"].includes(String(ch.action));
      if (takes && ch.realm != null) ch.realm = await seatRealm(ch.realm, ch.name);
      const notOwner = takes ? await ownerRefusal(ch.realm, ch.karta) ?? await rawSeatRefusal(msg) : null;
      if (notOwner) {
        emit({
          jsonrpc: "2.0",
          id: msg.id,
          result: { isError: true, content: [{ type: "text", text: notOwner }] }
        });
        return;
      }
      expectOwnRevoke(msg);
      if (msg.method === "tools/call" && msg.params?.name === tool("channel") && msg.params.arguments)
        msg.params.arguments = withPlaceFields(msg.params.arguments);
      endTaking = msg.params?.name === tool("channel") ? beginTaking(msg.params.arguments ?? {}) : null;
      await (takes ? withCallOrigin(msg.id, () => post2(msg, forward)) : post2(msg, forward));
      const held2 = heldReply;
      if (held2 && msg.params?.name === tool("channel") && msg.params.arguments)
        noteLocaleEcho(msg.params.arguments, replyText(held2), structuredOf(held2));
      if (held2) {
        if (state.standing && isUnattributed(held2)) {
          state.standingSession = null;
          const refused = !!held2.result?.isError;
          if (refused && !standingRetried) {
            standingRetried = true;
            log("the call ran unattributed — re-binding the standing and repeating it once");
            await ensureStanding();
            if (state.standingSession !== state.sessionId) await ensureStanding();
            if (state.standingSession === state.sessionId) {
              endTaking?.();
              continue;
            }
          } else {
            log(
              `a write went out unattributed (${replyText(held2).slice(0, 120)}) — the standing is re-bound before the next call`
            );
          }
        }
        noteCaseEntry(msg.params?.name, msg.params?.arguments, held2);
        const reply2 = absorbCloseReply(msg, absorbRevokeReply(msg, absorbChannelReply(msg, held2)));
        emit(forHarness(withNotice(reply2)));
      }
      endTaking?.();
      return;
    } catch (e) {
      endTaking?.();
      note3(e);
      if (e instanceof UpstreamError && e.kind === "network" && e.retryable && netTries < NET_BACKOFF_MS.length && (e.outcome === UpstreamError.NOT_SENT || isRead(msg))) {
        const pause = NET_BACKOFF_MS[netTries++];
        log(`${e.message} — knocking again in ${pause}ms (${netTries}/${NET_BACKOFF_MS.length})`);
        await new Promise((r) => setTimeout(r, pause));
        continue;
      }
      if (e instanceof UpstreamError && e.kind === "auth" && !authRetried) {
        authRetried = true;
        try {
          await ensureAuth(e.message, { force: true, rejected: e.presented });
          continue;
        } catch (authErr) {
          if (authErr instanceof HoldOffError && authErr.retryNow && !heldRetried) {
            heldRetried = true;
            authRetried = false;
            log(`${authErr.message} — repeating the call once`);
            await sleep(300);
            continue;
          }
          const standIn = hasId && harness ? lastServerAnswer(msg) : null;
          if (standIn) {
            log(`${msg.method} answered from the last server answer — ${errorMessage(authErr)}`);
            emit(standIn);
            return;
          }
          if (authErr instanceof TokenRefused) {
            if (hasId) emit(syntheticError(msg.id, authErr.message, outcome, "dead"));
            return;
          }
          if (authErr instanceof AuthPending) {
            if (hasId) emit(syntheticError(msg.id, authErr.message, outcome, "human"));
            return;
          }
          const held2 = authErr instanceof HoldOffError;
          const message = errorMessage(authErr);
          log(`${held2 ? "authorization holding off" : "authorization failed"}: ${message}`);
          if (hasId) {
            emit(
              syntheticError(
                msg.id,
                `${held2 ? "authorization holding off" : "authorization failed"}: ${message}`,
                outcome,
                held2 && (authErr.retryNow ? "knock" : "wait")
              )
            );
          }
          return;
        }
      }
      if (e instanceof UpstreamError && e.kind === "session" && !sessionRetried && !isInit) {
        sessionRetried = true;
        try {
          await reinitialize();
          continue;
        } catch (reErr) {
          if (hasId) {
            emit(
              syntheticError(msg.id, `session recovery failed: ${errorMessage(reErr)}`, outcome)
            );
          }
          return;
        }
      }
      if (e instanceof UpstreamError && (e.kind === "network" || e.kind === "auth" && harness) && hasId) {
        const cached = lastServerAnswer(msg);
        if (cached) {
          log(`${e.message} — ${msg.method} answered from the last server answer`);
          emit(cached);
          return;
        }
      }
      const reason = e instanceof UpstreamError ? e.kind === "auth" && authRetried ? refusedAudience(e.message) : e.message : `bridge internal error: ${errorMessage(e)}`;
      log(`request ${hasId ? msg.id : `(notification ${msg?.method})`} failed: ${reason}`);
      if (hasId) emit(syntheticError(msg.id, reason, outcome));
      return;
    }
  }
}

// js/bridge/session.ts
var HANDOVER_WAIT_MS = Number(process.env[envName("BRIDGE_HANDOVER_WAIT_MS")]) || 1e4;
var counter = 0;
function applyOrigin(origin2) {
  const cfg = readArgs(origin2.argv);
  if (origin2.patSha !== void 0 && patShaOf(cfg.pat) !== origin2.patSha)
    throw new Error(
      "this daemon signs in otherwise than the bridge asking (its personal token differs)"
    );
  setConfig(cfg);
}
function openSession(io, origin2, opts = {}) {
  if (!origin2) return openIn(io, null, null);
  const scope = newScope(
    opts.id ?? `s${++counter}`,
    { env: origin2.env, cwd: origin2.cwd, pid: origin2.pid, path: origin2.path ?? "" },
    isSessionEnvKey
  );
  scope.log = opts.log ?? null;
  return runIn(scope, () => {
    applyOrigin(origin2);
    return openIn(io, origin2, scope);
  });
}
function openIn(io, origin2, scope) {
  setSessionOutput(io.output);
  guardStream(io.output);
  holdFromEnv();
  repeatLater(true);
  if (!CFG.satellite) startDeafnessWatch();
  const rl = createInterface2({ input: io.input, terminal: false });
  const pending2 = /* @__PURE__ */ new Set();
  let handshake = null;
  rl.on(
    "line",
    bindScope((line) => {
      const trimmed2 = line.trim();
      if (!trimmed2) return;
      let msg;
      try {
        msg = JSON.parse(trimmed2);
      } catch {
        log(`unparseable line from harness: ${trimmed2.slice(0, 120)}`);
        return;
      }
      if (msg.method === "tools/call" && !String(msg.id ?? "").startsWith(ID_PREFIX))
        noteAgentWork();
      const run = () => deliver(msg).catch((e) => log(`unexpected: ${e?.stack || errorMessage(e)}`));
      let p;
      if (msg.method === "initialize") {
        p = run();
        handshake = p;
        p.finally(() => {
          if (handshake === p) handshake = null;
        });
      } else if (handshake) {
        const gate = handshake;
        p = gate.then(run, run);
      } else p = run();
      pending2.add(p);
      p.finally(() => pending2.delete(p));
    })
  );
  let leaving = null;
  let markEnded;
  const ended = new Promise((resolve11) => markEnded = resolve11);
  const leave = bindScope(
    (why) => leaving ??= windDown(why).finally(markEnded)
  );
  const windDown = async (why) => {
    debug(`${why} — winding down`);
    const handover = !!origin2 && handoverUnderway();
    const paused = suspended();
    await Promise.all([
      closeRun(why, handover).catch((e) => log(`the run's end failed: ${e.message}`)),
      ordersSettled()
    ]);
    if (handover) await Promise.race([Promise.allSettled([...pending2]), sleep(HANDOVER_WAIT_MS)]);
    else await Promise.allSettled([...pending2, ...tokenRequestsInFlight]);
    if (paused) await pauseSettled();
    await flushStdout(io.output);
    if (origin2) {
      releaseSatelliteClaims();
      return;
    }
    const flow = clickPending();
    if (flow) {
      log(
        `${why}, but an authorization flow is pending — staying up for the human's click, at most ${Math.round(ORPHAN_FLOW_MS / 1e3)}s`
      );
      await Promise.race([flow.catch(() => {
      }), sleep(ORPHAN_FLOW_MS)]);
    }
    await Promise.allSettled([...tokenRequestsInFlight]);
    await flushStdout(io.output);
  };
  rl.on(
    "close",
    bindScope(() => void leave("stdin closed, the harness is gone"))
  );
  return { leave, ended, origin: origin2, scope, lastWork: bindScope(lastAgentWork) };
}

// js/bridge/snapshot.ts
function sessionSnapshot(local_id, engine, thin_pid, attached, build) {
  const inspect = () => {
    const installed = skillsAttr();
    const declared = state.standing ? announcedSkills(state.standing) : void 0;
    const differs = (skills) => !!skills && JSON.stringify(skills) !== JSON.stringify(installed);
    return {
      local_id,
      thin_pid,
      attached,
      build,
      skills: declared,
      installed_skills: installed,
      skills_mismatch: differs(declared),
      cwd: engine.origin?.cwd ?? "",
      server: CFG.serverUrl,
      ...H2.currentUrl ? { api: apiBase(H2.currentUrl) } : {},
      harness: harnessName(),
      harness_session: sessionOfBridge(),
      places: heldPlaces().map((p) => {
        const standing = p.primary ? state.standing : extraPlaces().find((x) => x.door.key === p.key)?.standing;
        const door = doors().find((d) => d.key === p.key);
        const attrs = observedPlaceAttrs();
        const last = engine.lastWork();
        return safePlace({
          name: standing?.name,
          realm: standing?.realm,
          karta: standing?.karta,
          primary: p.primary,
          standing_id: door?.standingId ?? void 0,
          address: door?.address ?? void 0,
          satellite_of: attrs.satellite_of,
          listening: !H2.unheard && holdsChannel() && (notifiedClient() ? attached : !!door?.clients.size),
          ...last ? { last_work_at: new Date(last).toISOString() } : {},
          usage: attrs.usage,
          pulse: sentPulse(),
          skills: standing ? announcedSkills(standing) : void 0,
          skills_mismatch: differs(standing ? announcedSkills(standing) : void 0)
        });
      })
    };
  };
  return engine.scope ? runIn(engine.scope, inspect) : inspect();
}

// js/bridge/daemon.ts
var ms = (name2, dflt) => {
  const v = Number(process.env[name2]);
  return process.env[name2]?.trim() && Number.isFinite(v) && v >= 0 ? v : dflt;
};
var LOG_MARK = new RegExp(`\\[${escapeRe(BRIDGE_NAME)} [^\\]]*\\] `);
var IDLE_MS = ms(envName("BRIDGE_DAEMON_IDLE_MS"), 6e4);
var HOME_CHECK_MS = ms(envName("BRIDGE_DAEMON_HOME_CHECK_MS"), 6e4);
var SUCCESSOR_WAIT_MS = ms(envName("BRIDGE_DAEMON_SUCCESSOR_WAIT_MS"), 2e4);
var GRACE_MS = ms(envName("BRIDGE_DAEMON_GRACE_MS"), 5e3);
var RETURN_WAIT_MS = ms(envName("BRIDGE_DAEMON_RETURN_WAIT_MS"), 3e4);
var JOURNAL_MAX = 256e3;
var DAEMON_BUSY_EXIT = 75;
var SELF = (() => {
  try {
    return fileURLToPath5(import.meta.url);
  } catch {
    return process.argv[1] ?? "";
  }
})();
var versionOfFile = (path) => {
  try {
    return versionIn(readFileSync26(path, "utf8"));
  } catch {
    return null;
  }
};
async function daemonMain(argv2) {
  const successor = argv2.includes("--successor");
  const cfg = parseArgs(argv2.filter((a) => a !== "--successor"));
  const authDir = cfg.authDir;
  const run = seamRunDir(authDir);
  const journalPath = join23(run, "daemon.log");
  const journal = (line) => {
    try {
      mkdirSync15(run, { recursive: true, mode: 448 });
      rotateJournal(journalPath, JOURNAL_MAX);
      const text2 = line.trimEnd().replace(LOG_MARK, "");
      appendFileSync5(
        journalPath,
        `${(/* @__PURE__ */ new Date()).toISOString()} pid=${process.pid} ${BUILD} ${text2}
`,
        { mode: 384 }
      );
    } catch {
    }
  };
  setProcessLog(journal);
  installCrashWords();
  if (!updatesDisabled()) {
    const sync = syncHome();
    for (const p of sync.copied) log(`home updated by this build: ${p}`);
    if (sync.reexec) {
      log(`the home copy is newer — the daemon rises from it: ${sync.reexec}`);
      spawnDaemon(sync.reexec, authDir, successor);
      process.exit(0);
    }
  }
  const sessions = /* @__PURE__ */ new Map();
  const engines = /* @__PURE__ */ new Map();
  const attached = /* @__PURE__ */ new Set();
  const bridgePids = /* @__PURE__ */ new Map();
  const bridgeBuilds = /* @__PURE__ */ new Map();
  const sockets = /* @__PURE__ */ new Set();
  const handed = /* @__PURE__ */ new Map();
  const answering = /* @__PURE__ */ new Set();
  let draining2 = false;
  let counter2 = 0;
  let lastNotice = null;
  let server = null;
  const idle = idleWatch(
    IDLE_MS,
    () => draining2 || sessions.size > 0,
    () => {
      server?.close();
      process.exit(0);
    }
  );
  const armIdle = idle.arm;
  const handover = async (to, why) => {
    if (draining2) return;
    draining2 = true;
    idle.hold();
    log(`handing over to ${to}: ${why} — ${sessions.size} session(s)`);
    beginHandover(why);
    server?.close();
    for (const so of sockets) writeFrame(so, { t: "handover", why });
    spawnDaemon(to, authDir, true);
    const paused = [];
    for (const [id, e] of engines) {
      if (!e.scope) continue;
      handed.set(id, e.scope);
      const pid = bridgePids.get(id) ?? 0;
      if (!attached.has(id) && !ownPidAlive(pid)) continue;
      runIn(e.scope, () => pauseForHandover(why));
      paused.push([e.scope, pid]);
    }
    await Promise.allSettled([...sessions.values()].map((s2) => s2.end(`daemon handover: ${why}`)));
    await Promise.allSettled([...answering]);
    for (const so of sockets) so.end();
    await handoffsSettled();
    await Promise.allSettled([...answering]);
    await Promise.allSettled(
      paused.map(([scope, pid]) => runIn(scope, () => endUnreturnedPause(pid, RETURN_WAIT_MS)))
    );
    log("handed over — leaving");
    setTimeout(() => process.exit(0), 300);
  };
  const newer = (v) => !!v && compareVersions(v, VERSION) > 0;
  let homeSeen = "";
  const checkHome = () => {
    if (draining2 || updatesDisabled()) return;
    const home = homeBridgePath();
    let stamp;
    try {
      const st = statSync9(home);
      stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    } catch {
      return;
    }
    if (stamp === homeSeen) return;
    homeSeen = stamp;
    const v = versionOfFile(home);
    if (newer(v)) void handover(home, `the home copy is v${v}, this daemon v${VERSION}`);
  };
  const newerBridge = (hello) => {
    if (updatesDisabled()) return;
    const theirs = /^v(\d+\.\d+\.\d+)/.exec(hello.build)?.[1] ?? null;
    if (!newer(theirs)) return;
    const home = homeBridgePath();
    const homeV = versionOfFile(home);
    const to = homeV && compareVersions(homeV, theirs) >= 0 ? home : hello.path;
    if (!to || !newer(versionOfFile(to))) return;
    setImmediate(() => void handover(to, `a thin bridge ${hello.build} is newer than this daemon`));
  };
  const host = {
    build: BUILD,
    path: SELF,
    log: (m) => log(m),
    count: () => sessions.size,
    snapshot: () => ({
      daemon: { pid: process.pid, build: BUILD, path: SELF },
      sessions: [...engines].map(
        ([id, e]) => sessionSnapshot(
          id,
          e,
          bridgePids.get(id) ?? 0,
          attached.has(id),
          bridgeBuilds.get(id) ?? ""
        )
      )
    }),
    draining: () => draining2,
    // A pause asked during handover becomes a harness pause (suspend.ts), not a refusal.
    answerDraining(id, msg) {
      const scope = handed.get(id);
      const p = scope ? runIn(scope, () => localSuspend(msg)) : null;
      if (scope && p) {
        const settled2 = p.then(() => runIn(scope, pauseSettled));
        answering.add(settled2);
        void settled2.finally(() => answering.delete(settled2)).catch(() => {
        });
      }
      return p;
    },
    find: (id) => sessions.get(id) ?? null,
    open(hello) {
      const id = `s${++counter2}-${process.pid}`;
      let engine = null;
      let s2;
      try {
        s2 = streamSeamSession(
          id,
          (io, logTo) => engine = openSession(
            io,
            {
              argv: hello.argv,
              env: hello.env ?? {},
              cwd: hello.cwd,
              pid: hello.pid,
              path: hello.path,
              patSha: hello.patSha ?? null
            },
            { id, log: logTo }
          ),
          (msg) => log(
            `session ${id}: said while no thin bridge was attached — lost: ${JSON.stringify(msg).slice(0, 160)}`
          ),
          (line) => journal(`[${id}] ${line}`)
        );
      } catch (e) {
        return errorMessage(e);
      }
      const opened = engine;
      const traced = {
        ...s2,
        deliver: (msg) => {
          if (process.env[envName("BRIDGE_DAEMON_TRACE")])
            journal(`[${id}] rpc ${msg.method ?? "reply"} ${JSON.stringify(msg.id ?? null)}`);
          s2.deliver(msg);
        },
        attach: (sink, logSink) => {
          if (sink) attached.add(id);
          else attached.delete(id);
          s2.attach(sink, logSink);
        },
        end: (why) => {
          attached.delete(id);
          bridgePids.delete(id);
          bridgeBuilds.delete(id);
          return s2.end(why).then(() => {
            if (sessions.get(id) !== traced) return;
            sessions.delete(id);
            engines.delete(id);
            log(`session ${id} ended: ${why}`);
            armIdle();
          });
        }
      };
      sessions.set(id, traced);
      bridgePids.set(id, hello.pid);
      bridgeBuilds.set(id, hello.build);
      if (opened) engines.set(id, opened);
      idle.hold();
      log(
        `session ${id} for pid ${hello.pid} (${hello.build}, ${hello.path}) argv=${JSON.stringify(hello.argv)}`
      );
      if (lastNotice && opened?.scope) {
        const notice = lastNotice;
        runIn(opened.scope, () => pendNotice(notice));
      }
      newerBridge(hello);
      return traced;
    }
  };
  const started = Date.now();
  for (; ; ) {
    try {
      server = await listenSeam(authDir, (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        serveSeam(socket, host, GRACE_MS);
      });
      break;
    } catch (e) {
      const code = e.code;
      if (code === "EADDRINUSE" && successor && Date.now() - started < SUCCESSOR_WAIT_MS) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      log(`the daemon does not rise: ${errorMessage(e)}`);
      process.exit(code === "EADDRINUSE" ? DAEMON_BUSY_EXIT : 3);
    }
  }
  log(`listening ${seamSocketPath(authDir)}${successor ? " (successor)" : ""}`);
  pruneFallbacks(authDir);
  startEngine(cfg, { freshness: false });
  startFreshnessWatch(
    authDir,
    cfg.serverUrl,
    (notice) => {
      lastNotice = notice;
      for (const e of engines.values()) if (e.scope) runIn(e.scope, () => tellNotice(notice));
    },
    checkHome
  );
  const homeTimer = setInterval(checkHome, HOME_CHECK_MS);
  homeTimer.unref();
  checkHome();
  armIdle();
  const stop = (sig) => {
    if (draining2) return;
    draining2 = true;
    log(`${sig} — ending ${sessions.size} session(s)`);
    server?.close();
    for (const id of sessions.keys()) {
      if (!attached.has(id) && !ownPidAlive(bridgePids.get(id))) continue;
      const scope = engines.get(id)?.scope;
      if (scope) runIn(scope, () => beginSessionHandover(`daemon ${sig}`));
    }
    void Promise.allSettled([...sessions.values()].map((s2) => s2.end(sig))).then(() => {
      for (const so of sockets) so.destroy();
      return handoffsSettled();
    }).then(() => process.exit(0));
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
function spawnDaemon(file, authDir, successor) {
  try {
    const child = spawn3(
      process.execPath,
      [file, "daemon", "--auth-dir", authDir, ...successor ? ["--successor"] : []],
      {
        detached: true,
        stdio: "ignore",
        cwd: seamRunDir(authDir),
        env: process.env,
        windowsHide: true
      }
    );
    child.on("error", (e) => log(`the successor did not start: ${e.message}`));
    child.unref();
  } catch (e) {
    log(`the successor did not start: ${errorMessage(e)}`);
  }
}

// js/bridge/thin.ts
import { createInterface as createInterface3 } from "node:readline";
import { PassThrough as PassThrough2 } from "node:stream";

// js/bridge/raise.ts
import { spawn as spawn4 } from "node:child_process";
import { readFileSync as readFileSync27 } from "node:fs";
import { fileURLToPath as fileURLToPath6 } from "node:url";
var RAISE_STALE_MS = 15e3;
var SELF2 = (() => {
  try {
    return fileURLToPath6(import.meta.url);
  } catch {
    return process.argv[1] ?? "";
  }
})();
function daemonEntry() {
  const named = process.env[envName("BRIDGE_DAEMON_ENTRY")]?.trim();
  if (named) return named;
  if (updatesDisabled()) return SELF2;
  const home = homeBridgePath();
  try {
    const v = versionIn(readFileSync27(home, "utf8"));
    if (home !== SELF2 && compareVersions(v, VERSION) > 0) return home;
  } catch {
  }
  return SELF2;
}
function raiseDaemon(authDir) {
  const lock = takeFileLock(seamRaiseLockPath(authDir), RAISE_STALE_MS);
  if (!lock.held) return lock.fault ? { kind: "fault", why: lock.fault } : { kind: "other" };
  const entry = daemonEntry();
  log(`no bridge daemon for ${authDir} — raising one: ${entry} daemon`);
  try {
    const child = spawn4(process.execPath, [entry, "daemon", "--auth-dir", authDir], {
      detached: true,
      stdio: "ignore",
      cwd: seamRunDir(authDir),
      env: daemonEnv(),
      windowsHide: true
    });
    child.unref();
    const failed = new Promise((r) => {
      child.once("error", (e) => r({ code: null, why: `the daemon did not start: ${e.message}` }));
      child.once(
        "exit",
        (code, sig) => r({ code, why: `the daemon exited at once (${sig ?? `code ${code}`})` })
      );
    });
    return { kind: "raising", release: lock.release, failed };
  } catch (e) {
    lock.release();
    return { kind: "fault", why: `the daemon did not start: ${e.message}` };
  }
}

// js/bridge/thin.ts
var ATTACH_MS = ms(envName("BRIDGE_DAEMON_WAIT_MS"), 5e3);
var REATTACH_MS = ms(envName("BRIDGE_DAEMON_REATTACH_MS"), 3e4);
var BYE_MS = ms(envName("BRIDGE_BYE_MS"), 5e3);
var HELLO_MS = 3e3;
var POLL_MS = 100;
var SUCCESSOR_MS = 2e4;
var BUSY_RETRY_MS = 2e3;
var GATE_MS = 2e4;
function daemonWanted() {
  if (process.env[DAEMON_ENV]?.trim() === "0") return false;
  const off = process.env[NO_DAEMON_ENV]?.trim();
  return !off || off === "0";
}
function thinMain(argv2) {
  const cfg = parseArgs(argv2);
  setConfig(cfg);
  const authDir = cfg.authDir;
  const patSha = patShaOf(cfg.pat);
  installCrashWords();
  let mode = "attaching";
  let link = null;
  let sessionId = null;
  let local = null;
  let initCopy = null;
  let initSent = false;
  let initializedSeen = false;
  let word3 = null;
  let leaving = null;
  let byeDone = null;
  let heldKey2 = null;
  let paused = false;
  let everAttached = false;
  let successorAwaited = 0;
  const queue2 = [];
  const flights = /* @__PURE__ */ new Map();
  const verdicted = /* @__PURE__ */ new Set();
  const replayIds = /* @__PURE__ */ new Set();
  const realmIds = realmListAsk();
  const cancelled = /* @__PURE__ */ new Set();
  let replays = 0;
  const key2 = (id) => JSON.stringify(id);
  const writeHarness = (m) => writeTo(process.stdout, JSON.stringify(m) + "\n");
  const toHarness = (msg) => {
    if (msg.method === void 0 && msg.id !== void 0 && msg.id !== null) {
      const k = key2(msg.id);
      if (realmIds.reply(msg, log)) {
        openGate(k);
        return;
      }
      if (replayIds.delete(k)) {
        const back = resuming.get(k);
        resuming.delete(k);
        if (back) {
          if (msg.result?.resumed !== true) {
            const why = String(msg.result?.word ?? msg.error?.message ?? "?");
            placeLost(back.key, back.realm, why, msg.result?.stopped === true);
          }
          besideJudge();
          askRealms();
        }
        openGate(k);
        return;
      }
      cancelled.delete(k);
      if (verdicted.delete(k)) {
        debug(`a late answer to ${k} dropped — the harness already has its verdict`);
        return;
      }
      const f = flights.get(k);
      flights.delete(k);
      if (f?.msg.method === method("suspend") && msg.result?.suspended === true) paused = true;
      if (word3 && f?.msg.method === "tools/call" && Array.isArray(msg.result?.content)) {
        msg.result.content.push({ type: "text", text: word3 });
        word3 = null;
      }
    }
    const place = placeWord(msg);
    heldKey2 = places.seen(place, heldKey2, mode === "daemon" && !leaving);
    writeHarness(msg);
  };
  const gate = /* @__PURE__ */ new Set();
  let gateTimer = null;
  const openGate = (k) => {
    if (k) gate.delete(k);
    else gate.clear();
    if (gate.size) return;
    if (gateTimer) clearTimeout(gateTimer);
    gateTimer = null;
    for (const m of queue2.splice(0)) dispatch2(m);
  };
  const closeGate = (k) => {
    gate.add(k);
    gateTimer ??= setTimeout(() => {
      gateTimer = null;
      if (!gate.size) return;
      log(
        `the new session did not answer the bridge's own calls in ${GATE_MS}ms — letting calls through`
      );
      openGate();
    }, GATE_MS);
  };
  const places = lostPlaces(writeHarness, log);
  const live = places.live;
  const resuming = /* @__PURE__ */ new Map();
  const placeLost = (k, realm, why, stopped = false) => {
    places.lose(k, realm, why, cfg.satellite && k === heldKey2, stopped);
    if (k === heldKey2) heldKey2 = null;
  };
  const besideDue = /* @__PURE__ */ new Map();
  const besideJudge = () => {
    for (const [k, realm] of besideDue)
      if (!live.has(k)) placeLost(k, realm, words(THIN).besideNotBack());
    besideDue.clear();
  };
  const askRealms = () => {
    const m = realmIds.ask(places.lostCount(), () => `${ID_PREFIX}thin-realms-${++replays}`);
    if (!m) return;
    if (mode === "daemon" && link) toDaemon(link, m);
    else if (mode === "local") toLocal(m);
    else return;
    closeGate(key2(m.id));
  };
  const verdictAll = (why, acks, resend = false) => {
    const again = [];
    for (const [k, f] of flights) {
      if (resend && acks && !f.acked) {
        if (cancelled.delete(k)) flights.delete(k);
        else again.push(f.msg);
        continue;
      }
      writeHarness(syntheticError(f.id, why, !acks || f.acked ? UNKNOWN : NOT_SENT));
      verdicted.add(k);
      flights.delete(k);
    }
    return again;
  };
  const toDaemon = (l, msg) => {
    if (msg.method === "initialize") initSent = true;
    const f = msg.id !== void 0 && msg.id !== null ? flights.get(key2(msg.id)) : void 0;
    if (f && f.msg === msg) f.acked = false;
    l.send({ t: "rpc", msg });
  };
  const toLocal = (msg) => {
    if (msg.method === "initialize") initSent = true;
    local?.input.write(JSON.stringify(msg) + "\n");
  };
  const dispatch2 = (msg) => {
    const refusal2 = !gate.size && msg.id != null ? places.refusal(msg) : null;
    if (refusal2) {
      flights.delete(key2(msg.id));
      writeHarness({
        jsonrpc: "2.0",
        id: msg.id,
        result: { isError: true, content: [{ type: "text", text: refusal2 }] }
      });
    } else if (gate.size) queue2.push(msg);
    else if (mode === "daemon" && link) toDaemon(link, msg);
    else if (mode === "local") toLocal(msg);
    else queue2.push(msg);
  };
  const replay = (send2) => {
    if (!initCopy || !initSent) return;
    if (!queue2.some((m) => m.method === "initialize")) {
      const id = `${ID_PREFIX}thin-replay-${++replays}`;
      replayIds.add(key2(id));
      closeGate(key2(id));
      send2({ ...initCopy, id });
      if (initializedSeen) send2({ jsonrpc: "2.0", method: "notifications/initialized" });
    }
    const held2 = heldKey2 ? { key: heldKey2, realm: live.get(heldKey2) ?? "" } : null;
    for (const [k, realm] of live) if (k !== heldKey2) besideDue.set(k, realm);
    live.clear();
    if (!held2 || paused) besideJudge();
    if (held2 && paused)
      log(`the session is new — its place ${held2.key} is paused and waits on its pause record`);
    else if (held2) {
      const call = resumeCall(held2.key, ++replays);
      replayIds.add(key2(call.id));
      resuming.set(key2(call.id), held2);
      closeGate(key2(call.id));
      log(`the session is new — bringing its place ${held2.key} back from the hold record`);
      send2(call);
    }
  };
  const goLocal = (reason) => {
    if (mode === "local" || leaving) return;
    log(`${reason} — going as the full bridge inside this process`);
    markFallback(authDir, { build: BUILD, cwd: process.cwd(), why: reason });
    word3 = `${BRIDGE_NAME} ${BUILD}: ${reason}; this bridge runs as the full bridge in its own process (the machine's daemon is the default; ${DAEMON_ENV}=0 runs the full bridge on purpose).`;
    const input = new PassThrough2();
    const output = new PassThrough2();
    startEngine(cfg);
    const session = openSession({ input, output });
    createInterface3({ input: output, terminal: false }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        toHarness(JSON.parse(line));
      } catch {
      }
    });
    local = { session, input };
    mode = "local";
    replay(toLocal);
    askRealms();
    for (const m of queue2.splice(0)) dispatch2(m);
  };
  const onWelcome = (l) => {
    if (leaving) return l.close();
    const w = l.welcome;
    const resumed = w.resumed && !!sessionId && w.session === sessionId;
    sessionId = w.session;
    link = l;
    mode = "daemon";
    everAttached = true;
    log(
      `through the machine's bridge daemon ${w.build} (pid ${w.pid}), session ${sessionId}` + (resumed ? " — resumed" : "")
    );
    l.onFrame((f) => {
      if (f.t === "rpc") toHarness(f.msg);
      else if (f.t === "ack") {
        const fl = flights.get(key2(f.id));
        if (fl) fl.acked = true;
        cancelled.delete(key2(f.id));
      } else if (f.t === "log")
        writeTo(process.stderr, f.line.endsWith("\n") ? f.line : `${f.line}
`);
      else if (f.t === "handover") {
        successorAwaited = Date.now();
        log(
          `the machine's bridge daemon hands over to its successor (${f.why ?? "?"}) — waiting for it`
        );
      } else if (f.t === "bye-ok") byeDone?.();
    });
    l.onClose(() => {
      if (link !== l) return;
      link = null;
      if (leaving) return byeDone?.();
      lost(!!w.ack);
    });
    if (!resumed) replay((m) => toDaemon(l, m));
    askRealms();
    for (const m of queue2.splice(0)) dispatch2(m);
  };
  const lost = (acks) => {
    mode = "attaching";
    replayIds.clear();
    resuming.clear();
    realmIds.forget();
    gate.clear();
    if (gateTimer) clearTimeout(gateTimer);
    gateTimer = null;
    const inFlight = flights.size;
    const again = verdictAll(
      "the link to this machine's bridge daemon broke before the answer came back",
      acks,
      true
    );
    log(
      `the link to the machine's bridge daemon broke — ${inFlight} call(s) in flight: ${again.length} not taken by the daemon go again after the reattach, ${inFlight - again.length} get a verdict; reattaching`
    );
    queue2.unshift(...again);
    void attach2();
  };
  const attach2 = async () => {
    const unsafe = seamEntranceProblem(authDir);
    if (unsafe) return goLocal(`the daemon's entrance is not private (${unsafe})`);
    const socketPath = seamSocketPath(authDir);
    const wait = everAttached ? REATTACH_MS : ATTACH_MS;
    const deadline = Date.now() + wait;
    let raise = null;
    let raiseFailed = null;
    let raiseAgainAt = 0;
    try {
      for (; ; ) {
        if (leaving) return;
        try {
          const hello = helloFrame({ build: BUILD, path: SELF2, argv: argv2, session: sessionId, patSha });
          return onWelcome(await connectSeam(socketPath, hello, HELLO_MS));
        } catch (e) {
          if (!(e instanceof SeamError)) throw e;
          if (e.kind === "refused")
            return goLocal(`the machine's bridge daemon refused this bridge: ${e.message}`);
          const successorDue = !!successorAwaited && Date.now() - successorAwaited < SUCCESSOR_MS;
          if (e.kind === "absent" && !raise && !successorDue && Date.now() >= raiseAgainAt) {
            const r = raiseDaemon(authDir);
            raise = r;
            if (r.kind === "fault")
              return goLocal(`cannot raise the bridge daemon for ${authDir}: ${r.why}`);
            if (r.kind === "raising")
              void r.failed.then(({ code, why }) => {
                if (code !== DAEMON_BUSY_EXIT) return void (raiseFailed = why);
                r.release();
                if (raise === r) raise = null;
                raiseAgainAt = Date.now() + BUSY_RETRY_MS;
              });
          }
          if (raiseFailed) return goLocal(`no bridge daemon for ${authDir}: ${raiseFailed}`);
          if (Date.now() >= deadline)
            return goLocal(`no bridge daemon for ${authDir} answered in ${wait}ms (${e.message})`);
          await sleep(POLL_MS);
        }
      }
    } finally {
      if (raise?.kind === "raising") raise.release();
    }
  };
  const rl = createInterface3({ input: process.stdin, terminal: false });
  rl.on("line", (line) => {
    const trimmed2 = line.trim();
    if (!trimmed2) return;
    let msg;
    try {
      msg = JSON.parse(trimmed2);
    } catch {
      log(`unparseable line from harness: ${trimmed2.slice(0, 120)}`);
      return;
    }
    if (msg.method === "initialize") initCopy = msg;
    if (msg.method === "notifications/initialized") initializedSeen = true;
    if (msg.method === "notifications/cancelled") {
      const k = key2(msg.params?.requestId);
      const f = flights.get(k);
      if (f && !f.acked) {
        const i = queue2.indexOf(f.msg);
        if (i >= 0) {
          queue2.splice(i, 1);
          flights.delete(k);
        } else cancelled.add(k);
      }
    }
    if (msg.method && msg.id !== void 0 && msg.id !== null) {
      verdicted.delete(key2(msg.id));
      cancelled.delete(key2(msg.id));
      flights.set(key2(msg.id), { id: msg.id, msg, acked: false });
    }
    dispatch2(seeSession(msg));
  });
  const leave = (why) => leaving ??= windDown(why);
  const windDown = async (why) => {
    debug(`${why} — winding down`);
    let acks = false;
    if (mode === "local" && local) {
      await local.session.leave(why);
    } else if (link) {
      const l = link;
      acks = !!l.welcome.ack;
      await new Promise((resolve11) => {
        byeDone = resolve11;
        setTimeout(resolve11, BYE_MS).unref?.();
        l.send({ t: "bye", why });
      });
      l.close();
    } else acks = true;
    verdictAll("the bridge left before the machine's daemon answered", acks);
    await flushStdout(process.stdout);
    process.exit(0);
  };
  rl.on("close", () => void leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => void leave("SIGTERM"));
  const localSigint = fullBridgeSigint(leave);
  let interrupted = false;
  process.on("SIGINT", () => {
    if (mode === "local") return localSigint();
    if (interrupted) process.exit(0);
    interrupted = true;
    void leave("SIGINT");
  });
  void attach2().catch((e) => goLocal(`the seam failed: ${e?.message ?? String(e)}`));
}

// js/bridge/main.ts
function bridgeMain(argv2) {
  guardStream(process.stdout);
  guardStream(process.stderr);
  if (daemonWanted()) {
    thinMain(argv2);
    return;
  }
  const cfg = parseArgs(argv2);
  markFallback(cfg.authDir, {
    build: BUILD,
    cwd: process.cwd(),
    why: `the daemon switch is off (${envName("BRIDGE_DAEMON")}=0 or ${envName("BRIDGE_NO_DAEMON")})`
  });
  startEngine(cfg);
  const session = openSession({ input: process.stdin, output: process.stdout });
  void session.ended.then(() => process.exit(0));
  process.on("SIGTERM", () => void session.leave("SIGTERM"));
  process.on("SIGINT", fullBridgeSigint(session.leave));
  installCrashWords();
}

// js/bridge/probe.ts
import { fileURLToPath as fileURLToPath7 } from "node:url";
var HELLO_MS2 = 3e3;
var SELF3 = (() => {
  try {
    return fileURLToPath7(import.meta.url);
  } catch {
    return process.argv[1] ?? "";
  }
})();
async function versionLines(args) {
  const lines = [BUILD];
  if (!daemonWanted()) return lines;
  const d = await probeDaemon(args);
  lines.push(
    d.ok ? `daemon ${d.build} (pid ${d.pid}, ${d.socket})` : d.unsafe ? `daemon: the entrance is not private (${d.why})` : `daemon: none answering at ${d.socket} (${d.why})`
  );
  return lines;
}
async function probeDaemon(args) {
  const i = args.indexOf("--auth-dir");
  const authDir = (i >= 0 ? args[i + 1] : void 0) || process.env[envName("BRIDGE_AUTH_DIR")] || defaultAuthDir();
  const unsafe = seamEntranceProblem(authDir);
  if (unsafe) return { ok: false, socket: "", why: unsafe, unsafe: true };
  const socket = seamSocketPath(authDir);
  try {
    const l = await connectSeam(
      socket,
      helloFrame({ build: BUILD, path: SELF3, argv: args, probe: true }),
      HELLO_MS2
    );
    l.close();
    const w = l.welcome;
    return { ok: true, socket, build: w.build, pid: w.pid, sessions: w.sessions, path: w.path };
  } catch (e) {
    return { ok: false, socket, why: e.message };
  }
}

// js/watchdog/codex.ts
import { existsSync as existsSync9 } from "node:fs";
import { homedir as homedir7 } from "node:os";
import { join as join25 } from "node:path";

// js/shared/appserver.ts
import { randomBytes as randomBytes5 } from "node:crypto";
import { request } from "node:http";
function frame(data) {
  const mask = randomBytes5(4);
  let head;
  if (data.length < 126) head = Buffer.from([129, 128 | data.length]);
  else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 129;
    head[1] = 128 | 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 129;
    head[1] = 128 | 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([head, mask, masked]);
}
function openDoor(socketPath, onMessage, onClose) {
  return new Promise((resolve11, reject) => {
    const req = request({
      socketPath,
      path: "/",
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes5(16).toString("base64")
      }
    });
    req.on("upgrade", (_res, socket) => {
      let buf = Buffer.alloc(0);
      socket.on("data", (c) => {
        buf = Buffer.concat([buf, c]);
        for (; ; ) {
          if (buf.length < 2) return;
          const op = buf[0] & 15;
          let len = buf[1] & 127;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            off = 10;
          }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 1) {
            try {
              onMessage(JSON.parse(payload.toString("utf8")));
            } catch {
            }
          } else if (op === 8) socket.end();
        }
      });
      socket.on("close", () => onClose(words(APPSERVER).socketClosed()));
      socket.on("error", (e) => onClose(e.message));
      resolve11({
        send: (msg) => socket.write(frame(Buffer.from(JSON.stringify(msg)))),
        close: () => socket.end()
      });
    });
    req.on("response", (res) => reject(new Error(words(APPSERVER).doorNotOpened(res.statusCode))));
    req.on("error", reject);
    req.end();
  });
}

// js/watchdog/client.ts
import { existsSync as existsSync8, readdirSync as readdirSync12, readFileSync as readFileSync28 } from "node:fs";
import { connect as connect4 } from "node:net";
import { join as join24 } from "node:path";

// js/watchdog/words.ts
var wd = () => words(WATCHDOG);
var doer = (text2) => wd().doer(text2);

// js/watchdog/client.ts
var ATTACH_WINDOW_MS = Number(process.env[envName("WATCHDOG_ATTACH_MS")]) || 6e4;
var RETRY_MS3 = 1e3;
var SILENT_MS = 2 ** 30;
function parseWatchdogArgs(argv2) {
  const out7 = { authDir: authDirFromEnv() };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--auth-dir") out7.authDir = argv2[++i] ?? out7.authDir;
    else if (a === "--lang") setLang(argv2[++i]);
    else if (!a.startsWith("--") && !out7.key) out7.key = a;
  }
  return out7;
}
function resolveStanding(argv2) {
  const { key: key2, authDir } = parseWatchdogArgs(argv2);
  const dir2 = standingsDirOf(authDir);
  const pathFor = (k) => socketPathOf(authDir, k);
  if (key2) return { key: key2, path: pathFor(key2), authDir };
  const held2 = existsSync8(dir2) ? readdirSync12(dir2).filter((f) => f.endsWith(".key")).map((f) => {
    try {
      return readFileSync28(join24(dir2, f), "utf8").trim();
    } catch {
      return "";
    }
  }).filter(Boolean) : [];
  if (held2.length === 1) return { key: held2[0], path: pathFor(held2[0]), authDir };
  if (held2.length === 0) {
    return {
      error: wd().noHeld()
    };
  }
  return {
    error: wd().severalHeld(held2.join(", "))
  };
}
function adoptSeenPath(named, current2, seen) {
  if (!named || named === current2) return current2;
  seen.clear();
  for (const x of seenIds(named)) seen.add(x);
  return named;
}
function staleOf(ev, has) {
  if (!ev.unshown) return staleBatch(ev.frames ?? [], has);
  const shown = (ev.frames ?? []).flatMap((f) => deliveryKeys(f));
  const named = ev.unshown.map((k) => /^evs?:/.test(k) ? `c${k}` : k);
  return { text: ev.text ?? "", keys: [...shown, ...named] };
}
function heldHeads(groups, marks, carriers = []) {
  const own = new Set(carriers.flatMap((f) => deliveryKeys(f)));
  const has = (k) => marks(k) || own.has(k);
  return groups.map((g) => g.filter((f) => carriers.includes(f) || !eventIn(f, has))).filter((g) => g.length).map(batchHead);
}
function attach(path, o) {
  let startedAt = Date.now();
  let attached = false;
  let handover = false;
  let waitingBack = false;
  let ownRelease = false;
  let forgotten = false;
  function tryOnce() {
    const sock = connect4(path);
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
        o.onEvent(ev);
      }
    });
    sock.on("error", () => {
    });
    sock.on("close", () => {
      if (attached && handover) {
        attached = false;
        handover = false;
        waitingBack = true;
        startedAt = Date.now();
        return void setTimeout(tryOnce, RETRY_MS3);
      }
      if (ownRelease) return;
      if (forgotten) return void setInterval(() => {
      }, SILENT_MS);
      if (attached) return o.onGone(wd().bridgeLetGo());
      if (Date.now() - startedAt > ATTACH_WINDOW_MS) {
        const s2 = ATTACH_WINDOW_MS / 1e3;
        return o.onGone(waitingBack ? wd().seatNotBack(s2, path) : wd().noSocket(path, s2));
      }
      setTimeout(tryOnce, RETRY_MS3);
    });
  }
  tryOnce();
}

// js/watchdog/codex.ts
var FLUSH_WAIT_MS = 5e3;
var note = (s2) => {
  process.stderr.write(s2 + "\n");
};
function codexDoorPath() {
  const home = process.env.CODEX_HOME?.trim() || join25(homedir7(), ".codex");
  return join25(home, "app-server-control", "app-server-control.sock");
}
function runWatchdogCodex(argv2) {
  parseWatchdogArgs(argv2);
  const threadId = process.env.CODEX_THREAD_ID?.trim();
  if (!threadId) {
    note(wd().noThread());
    process.exit(2);
  }
  const socketPath = codexDoorPath();
  if (!existsSync9(socketPath)) {
    note(wd().noDoor(socketPath));
    process.exit(2);
  }
  const target = resolveStanding(argv2);
  if ("error" in target) {
    note(doer(target.error));
    process.exit(2);
  }
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  const waiting2 = /* @__PURE__ */ new Map();
  let door = null;
  let ready = null;
  let nextId = 1;
  let forgotten = false;
  function open() {
    if (ready) return ready;
    ready = openDoor(
      socketPath,
      (m) => {
        const ids = !m?.method && typeof m?.id === "number" ? waiting2.get(m.id) : void 0;
        if (!ids) return;
        waiting2.delete(m.id);
        settle2(m.id, !m.error);
        if (m.error) return note(wd().threadRefused(m.error.message ?? wd().refusal()));
        note(wd().framePut(threadId));
        for (const id of ids) noteSeen(seenPath, id, seen);
      },
      (why) => {
        door = null;
        ready = null;
        const lost = [...waiting2.values()].flat();
        const gone = [...waiting2.keys()];
        waiting2.clear();
        for (const r of gone) settle2(r, false);
        note(wd().doorClosed(why, lost.join(", ")));
      }
    ).then((d) => {
      door = d;
      d.send({
        method: "initialize",
        id: nextId++,
        params: { clientInfo: { name: CLIENTS.watchdog, title: PRODUCT, version: "1" } }
      });
      d.send({ method: "initialized" });
      const back = again.splice(0);
      if (back.length && !forgotten) putStale(back);
      return d;
    });
    ready.catch((e) => {
      note(wd().doorNotOpened(e.message));
      ready = null;
    });
    return ready;
  }
  const inFlight = /* @__PURE__ */ new Set();
  function deliver2(text2, ids = []) {
    if (forgotten) return Promise.resolve();
    const reqId = nextId++;
    waiting2.set(reqId, ids);
    const p = put(reqId, text2).finally(() => inFlight.delete(p));
    inFlight.add(p);
    return p;
  }
  async function put(reqId, text2) {
    try {
      const d = door ?? await open();
      if (forgotten) return void waiting2.delete(reqId);
      d.send({
        method: "turn/start",
        id: reqId,
        params: { threadId, input: [{ type: "text", text: text2 }], turnTrigger: LOGGERS.channel }
      });
      note(wd().frameSent(threadId));
    } catch (e) {
      if (waiting2.delete(reqId)) settle2(reqId, false);
      note(wd().frameNotPut(e.message));
    }
  }
  const heldBy = /* @__PURE__ */ new Map();
  const again = [];
  function holdOut(items) {
    return items.filter((h) => {
      if (eventIn(h.frame, (k) => seen.has(k))) return true;
      const r = [...waiting2].find(([, ids]) => eventIn(h.frame, (k) => ids.includes(k)))?.[0];
      if (r === void 0) return true;
      heldBy.set(r, [...heldBy.get(r) ?? [], h]);
      return false;
    });
  }
  function settle2(reqId, ok) {
    const held2 = heldBy.get(reqId) ?? [];
    heldBy.delete(reqId);
    if (ok) return held2.forEach((h) => h.ids.forEach((k) => noteSeen(seenPath, k, seen)));
    pend.unshift(...held2.filter((h) => !h.stale).map(({ frame: frame2, ids }) => ({ frame: frame2, ids })));
    const stale = held2.filter((h) => h.stale).map((h) => h.frame);
    if (!stale.length) return;
    if (door) putStale(stale);
    else again.push(...stale);
  }
  function putStale(frames, ev) {
    const rest2 = ev?.unshown ? frames : holdOut(frames.map((f) => ({ frame: f, ids: deliveryKeys(f), stale: true }))).map(
      (h) => h.frame
    );
    const b = staleOf({ ...ev ?? { kind: "stale" }, frames: rest2 }, (k) => seen.has(k));
    if (b.text) void deliver2(b.text, b.keys);
    else for (const k of b.keys) noteSeen(seenPath, k, seen);
  }
  let replay = 0;
  let pend = [];
  const withPend = (text2, ids, carrier) => {
    const got = holdOut(pend.map((p) => ({ ...p, stale: false })));
    pend = [];
    const head = heldHeads([got.map((g) => g.frame)], (k) => seen.has(k), carrier ? [carrier] : []);
    const keys = [...got.flatMap((g) => g.ids), ...ids];
    const lines = [...head, ...text2 ? [text2] : []];
    if (!lines.length) return void keys.forEach((k) => noteSeen(seenPath, k, seen));
    void deliver2(lines.join("\n"), keys);
  };
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const fromRing = replay > 0;
          if (fromRing) replay--;
          const type = ev.frame?.type;
          if (type !== "message") return note(wd().notWakeup(type));
          if (fromRing && typeof ev.frame?.id !== "string") return note(wd().noIdFromRing());
          if (typeof ev.frame?.id === "string" && seen.has(ev.frame.id))
            return note(wd().alreadyPut(ev.frame.id));
          if (ev.batch && ev.frame && !addressedToMine(ev.frame)) {
            pend.push({ frame: ev.frame, ids: deliveryKeys(ev.frame) });
            pend.splice(0, Math.max(0, pend.length - 500));
            return;
          }
          withPend(frameToText(ev.frame, ev.raw ?? ""), deliveryKeys(ev.frame), ev.frame);
          break;
        }
        case "stale":
          putStale(ev.frames ?? [], ev);
          break;
        case "dead":
        case "evicted":
          note(ev.text ?? wd().seatLost());
          void deliver2(ev.text ?? wd().codexLost()).then(() => process.exit(1));
          break;
        case "stopped":
          note(ev.text ?? wd().seatLost());
          process.exit(0);
          break;
        case "alive":
          note(ev.text ?? wd().aliveNote());
          void deliver2(ev.text ?? wd().codexAlive());
          break;
        case "attached":
          replay = ev.buffered ?? 0;
          seenPath = adoptSeenPath(ev.seen, seenPath, seen);
          note(wd().listeningCodex(ev.key, threadId));
          break;
        case "released":
          note(wd().bridgeReleasedSocket(ev.text ?? ""));
          if (ev.beside && !ev.own) {
            forgotten = true;
            pend = [];
            again.length = 0;
            break;
          }
          if (!ev.own) break;
          if (pend.length) withPend("", []);
          if (again.length) putStale(again.splice(0));
          setTimeout(() => {
            note(wd().flushNotPut(FLUSH_WAIT_MS / 1e3));
            process.exit(1);
          }, FLUSH_WAIT_MS);
          void Promise.allSettled([...inFlight]).then(() => process.exit(0));
          break;
        default:
          note(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note(doer(why));
      process.exit(1);
    }
  });
}

// js/watchdog/watchdog.ts
import { writeSync } from "node:fs";

// js/watchdog/replay.ts
var RingReplay = class {
  /** How many ring frames were printed as lines for the doer. */
  printed = 0;
  /** The ring's last hello, as a raw line. */
  hello = "";
  left = 0;
  release = null;
  /** A new attach: the attach-line gate opens when the ring is delivered or the time is up. */
  start(buffered, waitMs) {
    this.end();
    this.left = buffered;
    this.printed = 0;
    this.hello = "";
    let done = () => {
    };
    const ready = new Promise((r) => done = r);
    this.release = done;
    setTimeout(() => this.release === done && this.end(), waitMs);
    return ready;
  }
  /** A frame came: true if it is from the ring. */
  next() {
    if (this.left <= 0) return false;
    this.left--;
    return true;
  }
  /** An event is handled: once the ring is delivered, the gate opens. */
  settle() {
    if (this.release && this.left === 0) this.end();
  }
  /** Stop waiting for ring frames: the watchdog's last word does not stand behind the gate. */
  end() {
    this.left = 0;
    this.release?.();
    this.release = null;
  }
};

// js/watchdog/watchdog.ts
var LINE_MAX = 400;
function wrapLines(text2, max = LINE_MAX) {
  const out7 = [];
  for (const line of text2.split("\n")) {
    let rest2 = line;
    while ([...rest2].length > max) {
      const head = [...rest2].slice(0, max).join("");
      const cut = head.lastIndexOf(" ");
      const at2 = cut > max / 2 ? cut : head.length;
      out7.push(rest2.slice(0, at2).trimEnd());
      rest2 = rest2.slice(at2).trimStart();
    }
    out7.push(rest2);
  }
  return out7;
}
var ALONE_GAP_MS = Number(process.env[envName("WATCHDOG_ALONE_MS")]) || 300;
var RIDERS_MAX = 100;
var queue = Promise.resolve();
var lastAt = 0;
var lastAlone = false;
var REPLAY_WAIT_MS = 1e3;
var out2 = (lines, alone = false, after2, ready) => {
  queue = queue.then(async () => {
    await ready;
    const wait = lastAt && (alone || lastAlone) ? lastAt + ALONE_GAP_MS - Date.now() : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const text2 = typeof lines === "function" ? lines() : lines;
    if (!text2.length) return after2?.();
    const failed = await new Promise(
      (r) => process.stdout.write(text2.join("\n") + "\n", (e) => r(!!e))
    );
    lastAt = Date.now();
    lastAlone = alone;
    if (!failed) after2?.();
  });
};
var log2 = (s2) => out2([s2]);
var loudExit = (s2, code) => {
  queue = queue.then(() => exitNow(s2, code));
};
var exitNow = (s2, code) => {
  try {
    writeSync(1, s2 + "\n");
    process.exit(code);
  } catch {
    process.stdout.write(s2 + "\n", () => process.exit(code));
    setTimeout(() => process.exit(code), 1e3).unref();
  }
};
function runWatchdog(argv2) {
  const target = resolveStanding(argv2);
  if ("error" in target) {
    writeSync(2, `${doer(target.error)}
`);
    process.exit(2);
  }
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  const queued = /* @__PURE__ */ new Set();
  const folded = [];
  const cases = /* @__PURE__ */ new Set();
  let head = false;
  let fresh2 = false;
  let batch = [];
  const riders = [];
  const riderMarks = [];
  const hold = () => {
    if (head) riders.push(batch);
    riders.splice(0, Math.max(0, riders.length - RIDERS_MAX));
    head = false;
  };
  let block = {
    lines: [],
    marks: [],
    carriers: []
  };
  const take2 = (carriers) => {
    const groups = [...riders.splice(0), ...head ? [batch] : []];
    head = false;
    return {
      lines: () => heldHeads(groups, (k) => seen.has(k), carriers),
      marks: riderMarks.splice(0)
    };
  };
  const ring = new RingReplay();
  const leave = (s2, code) => {
    ring.end();
    loudExit(s2, code);
  };
  attach(target.path, {
    onEvent: (ev) => {
      const fromRing = ev.kind === "frame" && ring.next();
      switch (ev.kind) {
        case "attached": {
          seenPath = adoptSeenPath(ev.seen, seenPath, seen);
          const ready = ring.start(ev.buffered ?? 0, REPLAY_WAIT_MS);
          const key2 = ev.key;
          out2(
            () => [
              wd().listening(key2, ring.printed ? wd().backfilled(wd().frames(ring.printed)) : ""),
              ...ring.hello ? [ring.hello] : []
            ],
            false,
            void 0,
            ready
          );
          break;
        }
        case "frame": {
          const f = ev.frame;
          if (fromRing && f?.type === "hello") {
            ring.hello = ev.raw ?? "";
            break;
          }
          if (f?.type !== "message") {
            log2(ev.raw ?? "");
            break;
          }
          const id = typeof f.id === "string" ? f.id : "";
          const again = !!id && (seen.has(id) || queued.has(id));
          if (id && !again) queued.add(id);
          const mark = () => {
            for (const k of deliveryKeys(f)) noteSeen(seenPath, k, seen);
            queued.delete(id);
          };
          if (ev.batch) {
            if (ev.batch.at === 1) {
              cases.clear();
              fresh2 = false;
              batch = [];
              block = { lines: [], marks: [], carriers: [] };
            }
            batch.push(f);
            if (!again) fresh2 = true;
            if (ev.batch.folded) {
              if (!again) folded.push(mark);
            } else {
              const within = folded.splice(0);
              const all2 = () => [...within, mark].forEach((m) => m());
              if (!addressedToMine(f)) riderMarks.push(all2);
              else if (again) all2();
              else {
                const first2 = !cases.has(caseKey(f));
                cases.add(caseKey(f));
                if (fromRing) ring.printed++;
                block.lines.push(...wrapLines(batchLine(f, ev.batch.fold, first2)));
                block.marks.push(all2);
                block.carriers.push(f);
              }
            }
            if (ev.batch.at < ev.batch.of) break;
            if (!fresh2) head = false;
            if (!block.lines.length) {
              hold();
              break;
            }
            const r = take2(block.carriers);
            const { lines, marks } = block;
            out2(
              () => [...r.lines(), ...lines],
              false,
              () => [...r.marks, ...marks].forEach((m) => m())
            );
            break;
          }
          if (!again) {
            if (fromRing) ring.printed++;
            const r = take2([f]);
            out2(r.lines, false, () => r.marks.forEach((m) => m()));
            out2(wrapLines(frameToText(f, ev.raw ?? "")), true, mark);
          }
          break;
        }
        case "note":
          if (ev.batch)
            head = true;
          else log2(ev.text ?? "");
          break;
        case "stale": {
          let keys = [];
          const lines = () => {
            const b = staleOf(ev, (k) => seen.has(k));
            keys = b.keys;
            return b.text ? wrapLines(b.text) : [];
          };
          out2(lines, false, () => {
            for (const k of keys) noteSeen(seenPath, k, seen);
          });
          break;
        }
        case "dead":
        case "evicted":
          leave(ev.text ?? wd().seatLost(), 1);
          break;
        case "stopped":
          leave(ev.text ?? wd().seatLost(), 0);
          break;
        case "alive":
          log2(ev.text ?? wd().aliveNote());
          break;
        case "released":
          if (ev.own) leave(wd().bridgeReleasedSocket(ev.text ?? ""), 0);
          else if (ev.beside) process.stderr.write(wd().bridgeReleasedSocket(ev.text ?? "") + "\n");
          else log2(wd().bridgeReleasedSocket(ev.text ?? ""));
          break;
      }
      ring.settle();
    },
    onGone: (why) => leave(doer(why), 1)
  });
}

// js/watchdog/watchdog-exit.ts
import { createHash as createHash8 } from "node:crypto";
import { writeSync as writeSync2 } from "node:fs";
function frameId(ev) {
  const id = ev.frame?.id;
  return typeof id === "string" && id ? id : `raw:${createHash8("sha256").update(ev.raw ?? "").digest("hex").slice(0, 16)}`;
}
var wake = (s2) => {
  writeSync2(1, s2 + "\n");
};
var note2 = (s2) => {
  writeSync2(2, s2 + "\n");
};
function runWatchdogExit(argv2) {
  const target = resolveStanding(argv2);
  if ("error" in target) {
    note2(doer(target.error));
    process.exit(2);
  }
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  let head = false;
  let fresh2 = false;
  let block = { lines: [], shown: [], ids: [] };
  const folded = [];
  const cases = /* @__PURE__ */ new Set();
  let batch = [];
  const riders = [];
  const riderIds = [];
  const hold = () => {
    if (head) riders.push(batch);
    riders.splice(0, Math.max(0, riders.length - 100));
    head = false;
  };
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const type = ev.frame?.type;
          if (type !== "message") return note2(wd().notWakeup(type));
          const id = frameId(ev);
          const f = ev.frame ?? null;
          const has = (k) => seen.has(k);
          const deliver2 = (groups2, lines, shown, ids) => {
            for (const s2 of [...heldHeads(groups2, has, shown), ...lines]) wake(s2);
            const keys = [...riderIds.splice(0), ...ids, ...shown.flatMap((s2) => deliveryKeys(s2))];
            for (const k of keys) noteSeen(seenPath, k, seen);
            process.exit(0);
          };
          if (!ev.batch) {
            if (seen.has(id)) return note2(wd().seenEarlier(id));
            return deliver2(
              riders.splice(0),
              [f ? frameToText(f, ev.raw ?? "") : ev.raw ?? ""],
              f ? [f] : [],
              [id]
            );
          }
          if (ev.batch.at === 1) {
            batch = [];
            cases.clear();
            block = { lines: [], shown: [], ids: [] };
            fresh2 = false;
          }
          if (f) batch.push(f);
          if (seen.has(id)) note2(wd().seenEarlier(id));
          else {
            fresh2 = true;
            if (ev.batch.folded) folded.push(id);
            else if (!f || !addressedToMine(f)) riderIds.push(id, ...folded.splice(0));
            else {
              const first2 = !cases.has(caseKey(f));
              cases.add(caseKey(f));
              block.lines.push(batchLine(f, ev.batch.fold, first2));
              block.shown.push(f);
              block.ids.push(id, ...folded.splice(0));
            }
          }
          if (ev.batch.at < ev.batch.of) return;
          if (!fresh2) head = false;
          if (!block.lines.length) {
            hold();
            return note2(wd().unaddressed());
          }
          const groups = [...riders.splice(0), ...head ? [batch] : []];
          head = false;
          return deliver2(groups, block.lines, block.shown, block.ids);
        }
        case "stale":
          {
            const b = staleOf(ev, (k) => seen.has(k));
            if (b.text) note2(b.text);
            for (const k of b.keys) noteSeen(seenPath, k, seen);
          }
          break;
        case "dead":
        case "alive":
        case "evicted":
          note2(ev.text ?? wd().seatLost());
          process.exit(1);
          break;
        case "stopped":
          wake(ev.text ?? wd().seatLost());
          process.exit(0);
          break;
        case "attached":
          seenPath = adoptSeenPath(ev.seen, seenPath, seen);
          note2(wd().listening(ev.key));
          break;
        case "released":
          note2(wd().bridgeReleasedSocket(ev.text ?? ""));
          if (ev.own) process.exit(0);
          break;
        default:
          if (ev.kind === "note" && ev.batch) head = true;
          note2(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note2(doer(why));
      process.exit(1);
    }
  });
}

// js/cli/doctor.ts
import { createHash as createHash9 } from "node:crypto";
import { existsSync as existsSync15, readFileSync as readFileSync33 } from "node:fs";
import { homedir as homedir14 } from "node:os";
import { dirname as dirname15, join as join31 } from "node:path";
import { fileURLToPath as fileURLToPath8 } from "node:url";

// js/cli/codexcache.ts
import { existsSync as existsSync10, readdirSync as readdirSync13 } from "node:fs";
import { join as join26 } from "node:path";

// js/cli/installnames.ts
var PRODUCT_PATTERN = escapeRe(PRODUCT);
var PRODUCT_RE = new RegExp(PRODUCT_PATTERN);
var PLUGIN_KEY_RE = new RegExp(`^${escapeRe(PLUGIN_NAME)}@`);
var BRIDGE_FILE_RE = new RegExp(escapeRe(BRIDGE_FILE));

// js/cli/codexcache.ts
var list2 = (d) => {
  try {
    return readdirSync13(d);
  } catch {
    return [];
  }
};
var isCopy = (d) => existsSync10(join26(d, ".codex-plugin", "plugin.json"));
function codexCopies(home) {
  const cache = join26(home, "plugins", "cache");
  const out7 = [];
  for (const market of list2(cache))
    for (const plugin of list2(join26(cache, market))) {
      if (!PRODUCT_RE.test(plugin)) continue;
      const dir2 = join26(cache, market, plugin);
      const versions = isCopy(dir2) ? [] : list2(dir2).filter((v) => isCopy(join26(dir2, v)));
      if (!versions.length) out7.push({ market, plugin, dir: dir2 });
      for (const v of versions) out7.push({ market, plugin, dir: join26(dir2, v) });
    }
  return out7;
}

// js/cli/doctornode.ts
import { accessSync, constants } from "node:fs";
import { homedir as homedir10 } from "node:os";
import { basename as basename7, dirname as dirname13, isAbsolute as isAbsolute4 } from "node:path";

// js/cli/subagents.ts
import { existsSync as existsSync11, readdirSync as readdirSync14, readFileSync as readFileSync29, statSync as statSync10 } from "node:fs";
import { homedir as homedir9 } from "node:os";
import { basename as basename6, delimiter, dirname as dirname12, isAbsolute as isAbsolute3, join as join27, resolve as resolve8 } from "node:path";

// js/cli/frontmatter.ts
function frontmatterText(file) {
  const body = file.charCodeAt(0) === 65279 ? file.slice(1) : file;
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  return end < 0 ? null : lines.slice(1, end).join("\n");
}
function parseScalar(raw) {
  const s2 = raw.trim();
  if (s2.startsWith("[") && s2.endsWith("]")) return splitFlow(s2.slice(1, -1)).map(parseScalar);
  if (s2.startsWith("{") && s2.endsWith("}")) {
    const out7 = {};
    for (const part of splitFlow(s2.slice(1, -1))) {
      const m = KEY.exec(part);
      if (m) out7[unquoteKey(m[1].trim())] = m[2] === void 0 ? null : parseScalar(m[2]);
    }
    return out7;
  }
  if (s2.startsWith('"')) {
    try {
      return JSON.parse(s2);
    } catch {
      return s2.slice(1, s2.lastIndexOf('"') > 0 ? s2.lastIndexOf('"') : void 0);
    }
  }
  if (s2.startsWith("'"))
    return s2.slice(1, s2.lastIndexOf("'") > 0 ? s2.lastIndexOf("'") : void 0).replace(/''/g, "'");
  return s2.replace(/\s+#.*$/, "");
}
function splitFlow(body) {
  const parts = [];
  let depth = 0;
  let quote2 = null;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote2) {
      cur += c;
      if (c === "\\" && quote2 === '"') cur += body[++i] ?? "";
      else if (c === quote2) quote2 = null;
      continue;
    }
    if (c === '"' || c === "'") quote2 = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
var KEY = /^("[^"]*"|'[^']*'|[^\s"'#{[-][^:]*?|-[^\s:][^:]*?)\s*:(?:\s+(.*))?$/;
var BLOCK_SCALAR = /^[|>][-+0-9]*$/;
var unquoteKey = (k) => k.startsWith('"') && k.endsWith('"') || k.startsWith("'") && k.endsWith("'") ? k.slice(1, -1) : k;
function parseFrontmatter(text2) {
  const lines = [];
  for (const raw of text2.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: raw.trim() });
  }
  let i = 0;
  const isItem = (l) => l.text === "-" || l.text.startsWith("- ");
  const scalarAt = (raw, owner) => {
    const more = [];
    while (i < lines.length && lines[i].indent > owner) more.push(lines[i++].text);
    const head = raw.trim();
    if (BLOCK_SCALAR.test(head)) return more.join(head.startsWith("|") ? "\n" : " ");
    return more.length ? [head, ...more].join(" ") : parseScalar(head);
  };
  const block = (indent) => {
    const first2 = lines[i];
    if (!first2 || first2.indent < indent) return null;
    return isItem(first2) ? list3(first2.indent) : map(first2.indent);
  };
  const map = (indent) => {
    const outMap = {};
    while (i < lines.length && lines[i].indent === indent && !isItem(lines[i])) {
      const m = KEY.exec(lines[i].text);
      i++;
      if (!m) {
        while (i < lines.length && lines[i].indent > indent) i++;
        continue;
      }
      const key2 = unquoteKey(m[1].trim());
      if (m[2] !== void 0 && m[2].trim() !== "") outMap[key2] = scalarAt(m[2], indent);
      else {
        const next = lines[i];
        outMap[key2] = next && (next.indent > indent || next.indent === indent && isItem(next)) ? block(next.indent) : null;
      }
    }
    return outMap;
  };
  const list3 = (indent) => {
    const items = [];
    while (i < lines.length && lines[i].indent === indent && isItem(lines[i])) {
      const content = lines[i].text.slice(1).trimStart();
      if (!content) {
        i++;
        const next = lines[i];
        items.push(next && next.indent > indent ? block(next.indent) : null);
        continue;
      }
      if (KEY.test(content)) {
        lines[i] = { indent: indent + (lines[i].text.length - content.length), text: content };
        items.push(map(lines[i].indent));
        continue;
      }
      i++;
      items.push(scalarAt(content, indent));
    }
    return items;
  };
  const top = block(0);
  return top && typeof top === "object" && !Array.isArray(top) ? top : {};
}

// js/cli/satform.ts
import { homedir as homedir8 } from "node:os";
import { basename as basename5 } from "node:path";
var SATELLITE_ARGS = ["-e", SATELLITE_CODE, "--", "--satellite"];
var SHELLS = /* @__PURE__ */ new Set(["sh", "bash", "zsh", "dash"]);
var cmdBase = (c) => basename5(c.replace(/\\/g, "/")).replace(/\.exe$/i, "").toLowerCase();
var isToolList = (v) => !!v && v.split(",").some((s2) => s2.trim().length > 0);
function toolsTail(e) {
  const words2 = SHELLS.has(cmdBase(e.command)) ? (e.args[e.args.indexOf("-c") + 1] ?? "").split(/\s+/).map((w) => w.replace(/^["']|["']$/g, "")) : e.args;
  const at2 = words2.indexOf("--tools");
  const v = at2 >= 0 ? words2[at2 + 1] : void 0;
  return isToolList(v) ? ["--tools", v] : [];
}
function formOf2(e) {
  const base = cmdBase(e.command);
  if (base === "node" && (e.args[0] === "-e" || e.args[0] === "--eval")) {
    const sep3 = e.args.indexOf("--", 2);
    if (sep3 < 0) return e.args.slice(2).includes("--satellite") ? "eval-no-sep" : "session";
    const after2 = e.args.slice(sep3 + 1);
    const spliced = /process\.argv\.splice\(\s*1\s*,\s*0\s*,/.test(e.args[1] ?? "");
    if (!(spliced ? after2 : after2.slice(1)).includes("--satellite")) return "eval-session";
    const tail2 = after2.slice(1);
    const known2 = !tail2.length || tail2.length === 2 && tail2[0] === "--tools" && isToolList(tail2[1]);
    return e.args[1] === SATELLITE_CODE && after2[0] === "--satellite" && known2 ? "eval" : "eval-other";
  }
  if (SHELLS.has(base)) {
    const s2 = e.args[e.args.indexOf("-c") + 1] ?? "";
    return s2.includes("--satellite") ? "shell" : "session";
  }
  return e.args.includes("--satellite") ? "path" : "session";
}
var P5 = PRODUCT_PATTERN;
var HOME_DIR_RE = new RegExp(escapeRe(HOME_DIR));
var EVAL_PATH_RE = new RegExp(`['"\`]([^'"\`]*${P5}[^'"\`]*\\.mjs)['"\`]`);
var SHELL_PATH_RE = new RegExp(
  `"([^"]*${P5}[^"]*\\.mjs)"|'([^']*${P5}[^']*\\.mjs)'|(\\S*${P5}\\S*\\.mjs)`
);
var ARG_PATH_RE = new RegExp(`${P5}[^\\\\/]*\\.mjs$`, "i");
var expandHome = (p) => p.replace(/^~(?=[\\/])/, homedir8()).replace(/\$\{HOME\}|\$HOME|%USERPROFILE%|\$\{USERPROFILE\}|\$USERPROFILE/g, homedir8());
function bridgePathOf(e) {
  const base = cmdBase(e.command);
  if (base === "node" && (e.args[0] === "-e" || e.args[0] === "--eval")) {
    const code = e.args[1] ?? "";
    if (/homedir\(\)/.test(code) && HOME_DIR_RE.test(code)) return homeBridgePath();
    const m = EVAL_PATH_RE.exec(code);
    return m ? expandHome(m[1]) : null;
  }
  if (SHELLS.has(base)) {
    const s2 = e.args[e.args.indexOf("-c") + 1] ?? "";
    const m = SHELL_PATH_RE.exec(s2);
    const raw = m?.[1] ?? m?.[2] ?? m?.[3];
    return raw ? expandHome(raw) : null;
  }
  const arg = [e.command, ...e.args].find((a) => ARG_PATH_RE.test(a));
  return arg ? expandHome(arg) : null;
}
function readyEntry(name2, disallowed, tail2 = []) {
  return [
    "mcpServers:",
    `  - ${name2}:`,
    "      type: stdio",
    "      command: node",
    `      args: [${[...SATELLITE_ARGS, ...tail2].map((a) => JSON.stringify(a)).join(", ")}]`,
    `disallowedTools: ${disallowed.join(", ")}`
  ].join("\n");
}

// js/cli/satprobe.ts
import { spawn as spawn5 } from "node:child_process";
import { createInterface as createInterface4 } from "node:readline";
var sw3 = () => words(SAT_PROBE);
var PROBE_MS = Number(process.env[envName("DOCTOR_PROBE_MS")]) || 3e4;
var REQUEST_MS = 2e4;
var WIN_WAIT_MS = 4e4;
var loginAdvice = () => sw3().loginAdvice();
async function probeSatellite(label, e, cwd) {
  const lines = [];
  const findings = [];
  const env2 = {
    ...process.env,
    ...e.env,
    [envName("BRIDGE_NO_BROWSER")]: "1",
    [envName("BRIDGE_NO_UPDATE")]: "1",
    [envName("BRIDGE_ORPHAN_FLOW_MS")]: "1",
    [envName("BRIDGE_TIMEOUT")]: e.env[envName("BRIDGE_TIMEOUT")] ?? String(REQUEST_MS)
  };
  delete env2[envName("CHANNEL_SOCKET")];
  delete env2[envName("CHANNEL_STATUS")];
  const child = spawn5(e.command, e.args, { cwd, env: env2, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {
  });
  let stderr = "";
  child.stderr.on("data", (c) => stderr = (stderr + c.toString()).slice(-4e3));
  const replies = /* @__PURE__ */ new Map();
  let wake2 = null;
  createInterface4({ input: child.stdout }).on("line", (l) => {
    try {
      const m = JSON.parse(l);
      if (typeof m.id === "number") replies.set(m.id, m);
    } catch {
    }
    wake2?.();
  });
  let exited = null;
  child.on("error", (err) => {
    exited = err.message;
    wake2?.();
  });
  child.on("exit", (code, sig) => {
    exited ??= sw3().exited(String(code ?? sig));
    wake2?.();
  });
  const deadline = Date.now() + PROBE_MS;
  const ask3 = async (id, method2, params) => {
    if (!exited)
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: method2, params }) + "\n", () => {
      });
    while (!replies.has(id) && !exited && Date.now() < deadline)
      await new Promise((res) => {
        wake2 = res;
        setTimeout(res, 200);
      });
    return replies.get(id) ?? null;
  };
  const tail2 = () => stderr.trim().split("\n").slice(-2).map((s2) => s2.slice(0, 300)).join(" | ");
  const init = await ask3(1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: CLIENTS.doctor, version: "1" }
  });
  const refusal2 = (what, raw) => {
    const msg = String(raw ?? "");
    return SAT_LOGIN_RE.test(msg) ? sw3().refusalLogin(label, what, loginAdvice()) : sw3().refusal(label, what, msg.slice(0, 300));
  };
  if (!init) {
    const why = exited ?? sw3().silent(Math.round(PROBE_MS / 1e3));
    const flag = /unknown argument: --tools/.test(stderr) ? "--tools" : SAT_OLD_FLAG_RE.test(stderr) ? "--satellite" : null;
    const old = flag ? sw3().oldFlag(flag) : sw3().runByHand();
    const stderrNote = tail2() ? `; stderr: ${tail2()}` : "";
    findings.push(sw3().noInit(label, why, stderrNote, old));
  } else if (init.error) {
    findings.push(refusal2("initialize", init.error.message));
  } else {
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
      () => {
      }
    );
    const info = init.result?.serverInfo ?? {};
    const list3 = await ask3(2, "tools/list", {});
    const tools = list3?.result?.tools ?? [];
    const name2 = info.name ?? "?";
    const version = info.version ?? "?";
    if (!list3) findings.push(sw3().noList(label, name2, version, exited));
    else if (list3.error) findings.push(refusal2("tools/list", list3.error.message));
    else {
      lines.push(sw3().answered(label, name2, version, tools.length));
      for (const t of tools) {
        const bad = ["oneOf", "allOf", "anyOf"].filter((k) => t.inputSchema && k in t.inputSchema);
        if (bad.length) findings.push(sw3().schema(t.name, bad.join(", ")));
      }
    }
  }
  const gone = new Promise((res) => exited ? res() : child.once("exit", () => res()));
  const within = (ms2) => Promise.race([
    gone.then(() => true),
    new Promise((res) => setTimeout(() => res(false), ms2).unref())
  ]);
  child.stdin.end();
  if (process.platform === "win32") {
    if (!await within(WIN_WAIT_MS)) {
      child.kill();
      findings.push(sw3().winKilled(label, WIN_WAIT_MS / 1e3));
    }
    return { lines, findings };
  }
  if (!await within(1e4)) {
    child.kill("SIGTERM");
    if (!await within(REQUEST_MS + 1e4)) {
      child.kill("SIGKILL");
      const secs2 = Math.round((REQUEST_MS + 2e4) / 1e3);
      findings.push(sw3().sigKilled(label, secs2));
    }
  }
  return { lines, findings };
}

// js/cli/subwords.ts
var subWords = () => words(SUBAGENT);
var formWord = (form) => subWords().form(form);
var todo = () => subWords().todo();

// js/cli/subagents.ts
var PLATFORM_ENV = envName("DOCTOR_PLATFORM");
var platform = () => process.env[PLATFORM_ENV] || process.platform;
var BRIDGE_RE = new RegExp(
  `${escapeRe(BRIDGE_NAME)}|(^|[\\\\/"'\\s])${PRODUCT_PATTERN}[^\\\\/"'\\s]*\\.mjs`
);
var TEMPLATE_PARENTS = [
  `mcp__${BRIDGE_NAME}`,
  `mcp__plugin_${PLUGIN_NAME}_${PRODUCT}`,
  `mcp__${PRODUCT}`
];
var str4 = (v) => typeof v === "string" ? v : "";
function entriesOf(fm) {
  const raw = fm.mcpServers;
  const pairs = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") pairs.push([item, null]);
      else if (item && typeof item === "object" && !Array.isArray(item))
        for (const [k, v] of Object.entries(item)) pairs.push([k, v]);
    }
  } else if (raw && typeof raw === "object") pairs.push(...Object.entries(raw));
  return pairs.map(([name2, v]) => {
    const spec = v && typeof v === "object" && !Array.isArray(v) ? v : {};
    const args = Array.isArray(spec.args) ? spec.args.map((a) => str4(a)) : [];
    const env2 = {};
    if (spec.env && typeof spec.env === "object" && !Array.isArray(spec.env))
      for (const [k, e] of Object.entries(spec.env)) env2[k] = str4(e);
    return { name: name2, ref: v === null, command: str4(spec.command), args, env: env2 };
  });
}
var listOf = (v) => Array.isArray(v) ? v.map((x) => str4(x).trim()).filter(Boolean) : str4(v).split(",").map((x) => x.trim()).filter(Boolean);
function agentFiles(dir2, scope) {
  if (!existsSync11(dir2)) return [];
  let names2;
  try {
    names2 = readdirSync14(dir2).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  return names2.sort().map((f) => {
    const path = join27(dir2, f);
    let fm = {};
    try {
      const text2 = frontmatterText(readFileSync29(path, "utf8"));
      if (text2 !== null) fm = parseFrontmatter(text2);
    } catch {
    }
    return { path, agent: str4(fm.name) || basename6(f, ".md"), scope, fm };
  });
}
function projectRoot() {
  const home = resolve8(homedir9());
  let gitRoot = null;
  for (let d = process.cwd(); ; ) {
    if (resolve8(d) === home) break;
    if (existsSync11(join27(d, ".claude", "agents")) || existsSync11(join27(d, ".opencode", "agents")))
      return d;
    if (!gitRoot && existsSync11(join27(d, ".git"))) gitRoot = d;
    const up = dirname12(d);
    if (up === d) break;
    d = up;
  }
  return gitRoot ?? process.cwd();
}
function which(cmd, cwd) {
  if (isAbsolute3(cmd) || /[\\/]/.test(cmd)) {
    const p = resolve8(cwd, cmd);
    return existsSync11(p) ? p : null;
  }
  const exts = platform() === "win32" ? ["", ...(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  for (const dir2 of (process.env.PATH || "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join27(dir2, cmd + ext);
      try {
        if (statSync10(p).isFile()) return p;
      } catch {
      }
    }
  }
  return null;
}
function graphServer(url) {
  const norm = (u) => u.trim().replace(/\/+$/, "").toLowerCase();
  return isProductionServer(url) || norm(url) === norm(CFG.serverUrl);
}
function parentBridges(root) {
  const found = /* @__PURE__ */ new Set();
  const scan = (servers, prefix) => {
    if (!servers || typeof servers !== "object") return;
    for (const [n, v] of Object.entries(servers)) {
      const e = v ?? {};
      const hay = [e.command ?? "", ...e.args ?? []].join(" ");
      if (BRIDGE_RE.test(hay) && !hay.includes("--satellite")) found.add(prefix(n));
      else if (typeof e.url === "string" && graphServer(e.url)) found.add(prefix(n));
    }
  };
  const readJson2 = (p) => {
    try {
      return JSON.parse(readFileSync29(p, "utf8"));
    } catch {
      return null;
    }
  };
  const user = readJson2(join27(homedir9(), ".claude.json"));
  if (user) {
    scan(user.mcpServers, (n) => `mcp__${n}`);
    const projects = user.projects ?? {};
    const key2 = root.replace(/\\/g, "/");
    for (const [k, p] of Object.entries(projects))
      if (k.replace(/\\/g, "/") === key2) scan(p.mcpServers, (n) => `mcp__${n}`);
  }
  scan(readJson2(join27(root, ".mcp.json"))?.mcpServers, (n) => `mcp__${n}`);
  const registry = readJson2(join27(homedir9(), ".claude", "plugins", "installed_plugins.json"));
  const plugins = registry?.plugins ?? {};
  for (const [key2, installs] of Object.entries(plugins)) {
    const plugin = key2.split("@")[0];
    if (!PRODUCT_RE.test(plugin)) continue;
    for (const inst of installs)
      if (inst.installPath)
        scan(
          readJson2(join27(inst.installPath, ".mcp.json"))?.mcpServers,
          (n) => `mcp__plugin_${plugin}_${n}`
        );
  }
  return [...found];
}
function trustLine(root) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync29(join27(homedir9(), ".claude.json"), "utf8"));
  } catch {
    return null;
  }
  const keys = Object.entries(cfg.projects ?? {}).filter(([, p]) => p?.hasTrustDialogAccepted).map(([k]) => k.replace(/\\/g, "/").replace(/\/+$/, ""));
  const here = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const chain = [];
  for (let d = here; ; ) {
    chain.push(d);
    const up = d.slice(0, d.lastIndexOf("/"));
    if (!up || up === d) break;
    d = up;
  }
  if (chain.some((d) => keys.includes(d))) return null;
  const near = keys.find((k) => chain.some((d) => d.toLowerCase() === k.toLowerCase()));
  if (near) return subWords().trustNear(near, here);
  return subWords().trustNone(here);
}
function hasGrant() {
  if (CFG.pat) return true;
  try {
    if (!existsSync11(storePath())) return false;
    const t = loadStore().tokens;
    return Boolean(t?.access_token || t?.refresh_token);
  } catch {
    return false;
  }
}
async function subagentsReport(out7) {
  const root = projectRoot();
  const userDir = join27(homedir9(), ".claude", "agents");
  const atHome = resolve8(root) === resolve8(homedir9());
  const project = atHome ? [] : agentFiles(join27(root, ".claude", "agents"), "project");
  const shadowed = new Set(project.map((f) => f.agent));
  const user = agentFiles(userDir, "user");
  const claude = [...project, ...user.filter((f) => !shadowed.has(f.agent))];
  const opencode = [
    ...agentFiles(join27(root, ".opencode", "agents"), "project"),
    ...agentFiles(join27(root, ".opencode", "agent"), "project")
  ];
  const osNote = process.env[PLATFORM_ENV] ? subWords().osJudged(platform()) : platform();
  out7(subWords().header(root, osNote));
  if (!claude.length && !opencode.length) {
    const dirs = `${join27(root, ".claude", "agents")}, ${userDir}, ${join27(root, ".opencode", "agents")}`;
    out7(subWords().noFiles(dirs));
    return;
  }
  for (const f of user.filter((f2) => shadowed.has(f2.agent))) out7(subWords().shadowed(f.path, f.agent));
  const parents = parentBridges(root);
  const required = parents.length ? parents : TEMPLATE_PARENTS;
  const byName = /* @__PURE__ */ new Map();
  const reports = [];
  for (const f of claude) {
    const lines = [];
    const expected = `${SUB_ENTRY_PREFIX}-${f.agent}`;
    const entries2 = entriesOf(f.fm);
    const ours = entries2.filter((e) => BRIDGE_RE.test([e.command, ...e.args].join(" ")));
    const sat = ours.filter((e) => formOf2(e) !== "session");
    let probeEntry = null;
    const own = sat.map((e) => `mcp__${e.name}`);
    const disallowed = listOf(f.fm.disallowedTools).map((d) => d.replace(/__\*$/, ""));
    const block = (name2, e) => subWords().withBlock(
      readyEntry(
        name2,
        [.../* @__PURE__ */ new Set([...disallowed, ...required])].filter((p) => p !== `mcp__${name2}`),
        e ? toolsTail(e) : []
      )
    );
    const canonical = (e) => ({
      name: subWords().proposed(e.name),
      ref: false,
      command: "node",
      args: [...SATELLITE_ARGS, ...toolsTail(e)],
      env: e.env
    });
    const refs = entries2.filter((e) => e.ref && PRODUCT_RE.test(e.name));
    for (const r of refs) lines.push(subWords().refEntry(r.name, block(expected)));
    if (!sat.length) {
      if (ours.length)
        lines.push(subWords().formEntry(ours[0].name, formWord("session"), block(expected, ours[0])));
      else if (!refs.length) lines.push(subWords().noEntry(block(expected)));
    }
    for (const e of sat) {
      byName.set(e.name, [...byName.get(e.name) ?? [], f.path]);
      if (e.name === SUB_ENTRY_PREFIX) lines.push(subWords().sharedName(f.agent));
      const name2 = e.name === SUB_ENTRY_PREFIX ? expected : e.name;
      const form = formOf2(e);
      if (form !== "eval") {
        lines.push(subWords().replaceEntry(e.name, formWord(form), block(name2, e)));
        if (!probeEntry && existsSync11(homeBridgePath())) probeEntry = canonical(e);
        continue;
      }
      if (!which(e.command, root)) {
        lines.push(subWords().noCommand(e.name, e.command));
        continue;
      }
      const bridge = bridgePathOf(e);
      if (bridge && !existsSync11(resolve8(root, bridge))) {
        lines.push(subWords().noBridge(bridge, homeBridgePath()));
        continue;
      }
      if (!probeEntry) probeEntry = e;
    }
    const need2 = required.filter((p) => !own.includes(p) && !disallowed.includes(p));
    if (sat.length && (need2.length || !disallowed.length)) {
      const fix2 = [.../* @__PURE__ */ new Set([...disallowed, ...required])].filter((p) => !own.includes(p)).join(", ");
      lines.push(subWords().callerBridges(need2.join(", "), fix2));
    }
    for (const o of own.filter((o2) => disallowed.includes(o2))) lines.push(subWords().ownRemoved(o));
    reports.push({ f, lines, probe: probeEntry, names: sat.map((e) => e.name) });
  }
  for (const [name2, files] of byName) {
    if (files.length < 2) continue;
    for (const r of reports.filter((r2) => files.includes(r2.f.path)))
      r.lines.push(subWords().nameShared(name2, files.length, files.join(", "), r.f.agent));
  }
  const grant = hasGrant();
  let noGrantSaid = false;
  const probed = /* @__PURE__ */ new Map();
  for (const r of reports) {
    const seen = [];
    if (r.probe && !grant) {
      r.lines.push(noGrantSaid ? subWords().noGrantAgain() : subWords().noGrant(loginAdvice()));
      noGrantSaid = true;
    } else if (r.probe) {
      const key2 = JSON.stringify([r.probe.command, r.probe.args, r.probe.env]);
      const first2 = probed.get(key2);
      if (first2) {
        if (first2.failed) r.lines.push(subWords().sameFailed(first2.label));
        else seen.push(subWords().sameProbe(first2.label));
      } else {
        const res = await probeSatellite(r.probe.name, r.probe, root);
        probed.set(key2, { label: r.probe.name, failed: res.findings.length > 0 });
        seen.push(...res.lines);
        r.lines.push(...res.findings);
      }
    }
    const where = r.f.scope === "user" ? subWords().userScope() : "";
    const named = r.names.length ? subWords().named(...r.names) : subWords().unnamed();
    out7(`  ${r.f.path}${where}: ${named}${r.lines.length ? "" : subWords().fine()}`);
    for (const l of seen) out7(`    ${l}`);
    for (const l of r.lines) {
      const [head, ...rest2] = l.split("\n");
      out7(`    ${todo()} ${head}`);
      for (const b of rest2) out7(`      ${b}`);
    }
  }
  if (claude.length) {
    const t = trustLine(root);
    if (t && project.length) out7(`  ${todo()} ${t}`);
  }
  for (const f of opencode) {
    const keys = Object.keys(f.fm).filter((k) => k === "mcpServers" || k === "mcp");
    const keyNote = keys.length ? subWords().ocKeys(keys.join(", ")) : "";
    out7(subWords().ocAgent(f.path, keyNote));
  }
}

// js/cli/doctornode.ts
var hw = () => words(HARNESS);
var platform2 = () => process.env[envName("DOCTOR_PLATFORM")] || process.platform;
var SYSTEM_DIRS = {
  darwin: ["/usr/bin", "/bin", "/usr/sbin", "/sbin"],
  linux: ["/usr/local/bin", "/usr/bin", "/bin"]
};
var executable = (p) => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};
var fix = (l, node) => hw().launchFix(l.harness, l.entry, node, homeBridgePath().replace(homedir10(), "$HOME"));
function launchReport(out7, launches2) {
  for (const l of launches2) {
    const cmd = l.command || "node";
    const found = which(cmd, process.cwd());
    if (!found || !executable(found)) {
      out7(`${todo()} ${hw().launchNotFound(l.who, cmd, isAbsolute4(cmd))}`);
      const own = /^node/i.test(basename7(process.execPath)) ? process.execPath : null;
      out7(fix(l, own));
      continue;
    }
    if (isAbsolute4(cmd)) {
      out7(hw().launchAbsolute(l.who, cmd));
      continue;
    }
    const dir2 = dirname13(found);
    const system = SYSTEM_DIRS[platform2()];
    if (!system || system.includes(dir2)) {
      out7(hw().launchFound(l.who, cmd, found));
      continue;
    }
    out7(hw().launchProfile(l.who, cmd, found, dir2));
    out7(fix(l, found));
  }
}
var openCodeRuntimeWord = () => hw().openCodeRuntime();

// js/cli/doctorpaths.ts
import { existsSync as existsSync12, readFileSync as readFileSync30 } from "node:fs";
import { homedir as homedir11 } from "node:os";
import { join as join28 } from "node:path";
var hw2 = () => words(HARNESS);
var readJson = (p) => {
  try {
    return JSON.parse(readFileSync30(p, "utf8"));
  } catch {
    return null;
  }
};
var httpEntries = (servers) => Object.entries(servers ?? {}).filter(([, v]) => typeof v?.url === "string" && graphServer(v.url)).map(([n, v]) => [n, String(v.url)]);
var say = (out7, where, name2, url, remove) => out7(`${todo()} ${hw2().secondPath(where, name2, url, remove)}`);
var CONNECTOR_RE = CONNECTOR_PATTERN;
function claudeCode(out7) {
  const file = join28(homedir11(), ".claude.json");
  const cfg = readJson(file);
  if (!cfg) return;
  for (const [n, url] of httpEntries(cfg.mcpServers))
    say(out7, `Claude Code (${file})`, n, url, `claude mcp remove "${n}" --scope user`);
  const projects = cfg.projects ?? {};
  for (const [dir2, p] of Object.entries(projects))
    for (const [n, url] of httpEntries(p?.mcpServers))
      say(
        out7,
        `Claude Code (${file}, ${dir2})`,
        n,
        url,
        `cd "${dir2}" && claude mcp remove "${n}" --scope local`
      );
  const mcp = join28(projectRoot(), ".mcp.json");
  for (const [n, url] of httpEntries(readJson(mcp)?.mcpServers))
    say(out7, `Claude Code (${mcp})`, n, url, hw2().deleteFrom(mcp));
  const ever = Array.isArray(cfg.claudeAiMcpEverConnected) ? cfg.claudeAiMcpEverConnected : [];
  for (const c of ever.map(String).filter((c2) => CONNECTOR_RE.test(c2)))
    out7(hw2().connector(c, file));
}
function codexHttp(text2) {
  const found = [];
  let section = null;
  for (const line of text2.split("\n")) {
    const head = /^\s*\[mcp_servers\.(?:"([^"]+)"|([^\]\s.]+))\]\s*$/.exec(line);
    if (head) section = head[1] ?? head[2] ?? null;
    else if (/^\s*\[/.test(line)) section = null;
    const url = /^\s*url\s*=\s*"([^"]+)"/.exec(line)?.[1];
    if (section && url && graphServer(url)) found.push([section, url]);
  }
  return found;
}
function secondPathReport(out7, codexHomes2) {
  claudeCode(out7);
  for (const home of codexHomes2) {
    const file = join28(home, "config.toml");
    if (!existsSync12(file)) continue;
    let text2;
    try {
      text2 = readFileSync30(file, "utf8");
    } catch {
      continue;
    }
    for (const [n, url] of codexHttp(text2))
      say(out7, `Codex (${file})`, n, url, `codex mcp remove "${n}"`);
  }
}

// js/cli/doctorskills.ts
import { existsSync as existsSync13, readFileSync as readFileSync31 } from "node:fs";
import { homedir as homedir12 } from "node:os";
import { join as join29, resolve as resolve9 } from "node:path";
var hw3 = () => words(HARNESS);
var IN_SET = join29(BRIDGE_SKILL, "scripts", BRIDGE_FILE);
function sets(codexHomes2) {
  const found = [];
  try {
    const reg = JSON.parse(
      readFileSync31(join29(homedir12(), ".claude", "plugins", "installed_plugins.json"), "utf8")
    );
    for (const [key2, installs] of Object.entries(reg.plugins ?? {}))
      if (PLUGIN_KEY_RE.test(key2)) {
        for (const i of installs)
          if (i.installPath) found.push([join29(i.installPath, "skills"), "claude"]);
      }
  } catch {
  }
  for (const home of codexHomes2)
    for (const c of codexCopies(home)) found.push([join29(c.dir, "skills"), "codex"]);
  found.push([join29(homedir12(), ".agents", "skills"), "flat"]);
  const own = skillsRoot();
  if (own) found.push([own, "other"]);
  const seen = /* @__PURE__ */ new Set();
  return found.filter(([root]) => {
    const key2 = resolve9(root);
    if (seen.has(key2) || !existsSync13(join29(root, IN_SET))) return false;
    seen.add(key2);
    return true;
  });
}
var how = (kind) => {
  const m = skillMoves();
  if (kind === "claude") return `Claude Code — ${m.claude}`;
  if (kind === "codex") return `Codex — ${m.codex}`;
  if (kind === "flat") return m.flat;
  return hw3().skillsOtherChannel(m.pi);
};
function skillsReport(out7, codexHomes2) {
  const latest = readLatest(CFG.authDir)?.version ?? null;
  const target = latest && compareVersions(latest, VERSION) > 0 ? latest : VERSION;
  const found = sets(codexHomes2);
  if (!found.length) out7(hw3().skillsNone());
  for (const [root, kind] of found) {
    let v = null;
    try {
      v = versionIn(readFileSync31(join29(root, IN_SET), "utf8"));
    } catch {
    }
    if (!v) out7(hw3().skillsUnreadable(root));
    else if (compareVersions(v, target) >= 0) out7(hw3().skillsCurrent(root, v));
    else {
      const below = compareVersions(v, VERSION) < 0;
      const why = below ? hw3().skillsBelowBridge(VERSION) : hw3().skillsBelowRelease(target);
      out7(`${todo()} ${hw3().skillsBehind(root, v, why, how(kind))}`);
    }
  }
}

// js/cli/opencode-config.ts
import { existsSync as existsSync14, readFileSync as readFileSync32 } from "node:fs";
import { homedir as homedir13 } from "node:os";
import { dirname as dirname14, join as join30 } from "node:path";
var BRIDGE_PART_RE = new RegExp(
  `(^|[\\\\/])${PRODUCT_PATTERN}[^\\\\/]*\\.mjs$|${escapeRe(BRIDGE_NAME)}`
);
var hw4 = () => words(HARNESS);
function openCodeMcpEntries(out7) {
  const dirFiles = (d) => [
    join30(d, "opencode.json"),
    join30(d, "opencode.jsonc"),
    join30(d, ".opencode", "opencode.json"),
    join30(d, ".opencode", "opencode.jsonc")
  ];
  const upwards = [];
  if (!process.env.OPENCODE_CONFIG_PROJECT_DISABLE)
    for (let d = process.cwd(); ; ) {
      upwards.push(...dirFiles(d));
      const up = dirname14(d);
      if (up === d) break;
      d = up;
    }
  const files = [
    ...process.env.OPENCODE_CONFIG ? [process.env.OPENCODE_CONFIG] : [],
    // Whether this directory belongs to the switchable project layer was not observed (#5559).
    ...process.env.OPENCODE_CONFIG_DIR ? dirFiles(process.env.OPENCODE_CONFIG_DIR) : [],
    ...dirFiles(join30(homedir13(), ".config", "opencode")),
    ...upwards
  ];
  const kindOf2 = (v) => {
    const e = v ?? {};
    const parts = [
      ...Array.isArray(e.command) ? e.command : e.command ? [e.command] : [],
      ...e.args ?? []
    ];
    if (parts.some((p) => BRIDGE_PART_RE.test(String(p)))) return "bridge";
    if (e.url && isProductionServer(e.url)) return "http";
    return null;
  };
  const parse = (text2) => {
    const STRING = '"(?:[^"\\\\]|\\\\.)*"';
    const noComments = text2.replace(
      new RegExp(`${STRING}|/\\*[\\s\\S]*?\\*/|//[^\\n]*`, "g"),
      (m) => m.startsWith('"') ? m : ""
    );
    const noTrailing = noComments.replace(
      new RegExp(`${STRING}|,(\\s*[}\\]])`, "g"),
      (m, tail2) => m.startsWith('"') ? m : tail2 ?? ""
    );
    return JSON.parse(noTrailing);
  };
  const bridgePath = (v) => {
    const e = v ?? {};
    const parts = [
      ...Array.isArray(e.command) ? e.command : e.command ? [e.command] : [],
      ...e.args ?? []
    ].map(String);
    return parts.find((p) => BRIDGE_PART_RE.test(p)) ?? parts.join(" ");
  };
  let unreadable = 0;
  const sources = [];
  for (const f of new Set(files)) {
    if (!existsSync14(f)) continue;
    try {
      sources.push([f, readFileSync32(f, "utf8")]);
    } catch {
      unreadable++;
      out7(hw4().ocUnreadable(f));
    }
  }
  if (process.env.OPENCODE_CONFIG_CONTENT)
    sources.unshift(["OPENCODE_CONFIG_CONTENT", process.env.OPENCODE_CONFIG_CONTENT]);
  let found = 0;
  for (const [file, text2] of sources) {
    try {
      const cfg = parse(text2);
      for (const [name2, v] of Object.entries(cfg.mcp ?? {})) {
        const kind = kindOf2(v);
        if (!kind) continue;
        found++;
        if (v.enabled === false) {
          out7(hw4().ocDisabled(name2, file));
          continue;
        }
        out7(kind === "bridge" ? hw4().ocBridge(name2, file, bridgePath(v)) : hw4().ocHttp(name2, file));
      }
    } catch {
      unreadable++;
      out7(hw4().ocUnreadable(file));
    }
  }
  if (!found) out7(hw4().ocNone(unreadable, process.cwd()));
}

// js/cli/doctor.ts
var out3 = (s2) => {
  process.stdout.write(s2 + "\n");
};
var dw = () => words(DOCTOR);
var hashOf2 = (buf) => createHash9("sha256").update(buf).digest("hex").slice(0, 8);
var seconds = (ms2) => `${Math.round(ms2 / 1e3)}s`;
var ENTRY = escapeRe(PLUGIN_NAME);
var CODEX_ENTRY_RE = new RegExp(
  `^\\s*\\[mcp_servers\\."?${ENTRY}"?\\]|^\\s*mcp_servers\\."?${ENTRY}"?\\s*=`,
  "m"
);
function homeCopyReport() {
  const home = homeBridgePath();
  let self = null;
  try {
    self = readFileSync33(fileURLToPath8(import.meta.url));
  } catch {
  }
  if (!existsSync15(home)) {
    out3(dw().homeNone(home));
    return;
  }
  const bytes = readFileSync33(home);
  if (self && bytes.equals(self)) {
    out3(dw().homeSame(home));
    return;
  }
  const v = versionIn(bytes.toString("utf8"));
  out3(
    dw().homeDiffers(home, v ?? "?", hashOf2(bytes), self ? fileURLToPath8(import.meta.url) : null)
  );
}
function serverSourceWord() {
  switch (CFG.serverSource) {
    case "argument":
      return dw().srcArgument();
    case "env":
      return dw().srcEnv();
    case "file":
      return dw().srcFile(serverChoicePath(CFG.authDir));
    default:
      return dw().srcDefault(serverChoicePath(CFG.authDir));
  }
}
var freshnessWord = (url) => isProductionServer(url) ? dw().freshProd() : dw().freshOther();
async function serverReport() {
  out3(dw().server(CFG.serverUrl, serverSourceWord()));
  out3(`  ${freshnessWord(CFG.serverUrl)}`);
  let res;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "doctor", method: "ping" }),
      signal: AbortSignal.timeout(1e4)
    });
  } catch (e) {
    out3(dw().unreachable(errorMessage(e)));
    return;
  }
  res.body?.cancel?.();
  const www = res.headers.get("www-authenticate");
  const note3 = www ? dw().wantsOAuth() : res.status >= 400 && res.status < 500 ? dw().noTokenProbe() : "";
  out3(dw().answers(res.status, note3));
  try {
    const meta = await discoverMeta(www);
    out3(`  OAuth: token endpoint ${meta.as.token_endpoint}`);
    out3(`  resource: ${meta.resource}`);
  } catch (e) {
    out3(`  OAuth discovery: ${errorMessage(e)}`);
  }
}
async function patReport() {
  out3(dw().grantPat(String(CFG.patSource)));
  let res;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${CFG.pat}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "doctor",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: CLIENTS.doctor, version: "1" }
        }
      }),
      signal: AbortSignal.timeout(1e4)
    });
  } catch (e) {
    out3(dw().patCheckFailed(errorMessage(e)));
    return;
  }
  res.body?.cancel?.();
  if (res.status === 401) out3(dw().patRejected());
  else if (res.ok) out3(dw().patAccepted(res.status));
  else out3(dw().patOther(res.status));
  const path = storePath();
  if (existsSync15(path)) out3(dw().patStore(path));
}
function grantReport() {
  const path = storePath();
  out3(dw().grant(path));
  if (!existsSync15(path)) {
    out3(dw().noStore());
    return;
  }
  const store = loadStore();
  const t = store.tokens;
  if (!t?.access_token) {
    out3(dw().noTokens());
  } else {
    const usable = tokenUsable(t);
    const left2 = t.expires_at ? t.expires_at - now() : null;
    out3(dw().access(usable, left2, left2 !== null ? seconds(Math.abs(left2)) : ""));
    const hours = refreshHours(t);
    if (!t.refresh_token) out3(dw().refreshNone());
    else {
      const parts = [];
      if (hours.nbf)
        parts.push(
          now() < hours.nbf ? dw().refreshValidIn(seconds(hours.nbf - now())) : dw().refreshValid()
        );
      if (hours.exp)
        parts.push(
          now() >= hours.exp ? dw().refreshExpired() : dw().refreshExpiresIn(seconds(hours.exp - now()))
        );
      out3(dw().refresh(parts.join(", ")));
    }
  }
  if (store.client?.client_id) out3(`  client_id: ${store.client.client_id}`);
  const st = loadGrantState();
  if (st.refused_since)
    out3(dw().refusedSince(new Date(st.refused_since).toISOString(), st.reason ?? ""));
  for (const suffix of [".auth-pending", ".refreshing"]) {
    if (existsSync15(path + suffix)) out3(dw().lock(path + suffix));
  }
  const logPath = grantLogPath();
  if (existsSync15(logPath)) {
    const lines = readFileSync33(logPath, "utf8").trim().split("\n").slice(-3);
    out3(dw().grantLog());
    for (const l of lines) out3(`    ${l}`);
  }
}
function latestReport() {
  const latest = readLatest(CFG.authDir);
  if (!latest) {
    out3(dw().latestNotAsked());
    return;
  }
  const ago = Math.round((Date.now() - latest.checked_at) / 6e4);
  if (!latest.version) out3(dw().latestUnknown(latest.error, ago));
  else if (compareVersions(latest.version, VERSION) > 0)
    out3(dw().latestBehind(latest.version, VERSION, latest.downloaded.join(", "), ago));
  else out3(dw().latestCurrent(latest.version, ago));
}
function claudePluginReport() {
  const registry = join31(homedir14(), ".claude", "plugins", "installed_plugins.json");
  if (!existsSync15(registry)) return;
  try {
    const reg = JSON.parse(readFileSync33(registry, "utf8"));
    const mine = Object.entries(reg.plugins ?? {}).filter(([k]) => PLUGIN_KEY_RE.test(k));
    if (!mine.length) {
      out3(dw().pluginMissing(registry));
      return;
    }
    for (const [key2, installs] of mine) {
      for (const inst of installs) {
        const manifest = inst.installPath ? join31(inst.installPath, ".mcp.json") : "";
        let entry = dw().entryNotFound();
        if (manifest && existsSync15(manifest)) {
          try {
            const m = JSON.parse(readFileSync33(manifest, "utf8"));
            const hit = Object.entries(m.mcpServers ?? {}).find(
              ([, v]) => (v.args ?? []).some((a) => BRIDGE_FILE_RE.test(a))
            );
            if (hit) {
              entry = dw().entryFound(hit[0]);
              launches.push({
                who: `Claude Code ${key2}`,
                harness: "claude",
                command: hit[1].command ?? ""
              });
            }
          } catch {
            entry = dw().unreadable(manifest);
          }
        }
        out3(
          dw().pluginLine(
            key2,
            inst.version ?? "?",
            inst.scope ?? "?",
            entry,
            inst.installPath ?? ""
          )
        );
      }
    }
  } catch {
    out3(dw().claudeUnreadable(registry));
  }
}
function codexHomes() {
  const homes = [
    process.env.CODEX_HOME?.trim() || "",
    join31(homedir14(), ".codex"),
    ...process.platform === "darwin" ? [join31(homedir14(), "Library", "Application Support", "orca", "codex-runtime-home", "home")] : []
  ].filter(Boolean);
  return [...new Set(homes)].filter((h) => existsSync15(h));
}
function codexPluginReport(home) {
  const cache = join31(home, "plugins", "cache");
  if (!existsSync15(cache)) return;
  let found = 0;
  for (const { market, plugin, dir: dir2 } of codexCopies(home)) {
    const manifest = join31(dir2, ".codex-plugin", "plugin.json");
    let word3 = dw().codexNoManifest();
    if (existsSync15(manifest)) {
      try {
        const m = JSON.parse(readFileSync33(manifest, "utf8"));
        const hit = Object.values(m.mcpServers ?? {}).find(
          (v) => (v.args ?? []).some((a) => BRIDGE_FILE_RE.test(a))
        );
        word3 = dw().codexManifest(m.version ?? "?", !!hit);
        if (hit)
          launches.push({
            who: `Codex ${plugin}@${market}`,
            harness: "codex",
            command: hit.command ?? ""
          });
      } catch {
        word3 = dw().unreadable(manifest);
      }
    }
    found++;
    out3(dw().codexPlugin(plugin, market, word3, dir2));
  }
  if (!found) out3(dw().codexNoPlugin(cache));
}
var launches = [];
function harnessReport() {
  launches.length = 0;
  claudePluginReport();
  const claude = join31(homedir14(), ".claude.json");
  if (existsSync15(claude)) {
    try {
      const cfg = JSON.parse(readFileSync33(claude, "utf8"));
      const entries2 = Object.entries(cfg.mcpServers ?? {}).filter(
        ([, v]) => (v.args ?? []).some((a) => PRODUCT_RE.test(a))
      );
      if (entries2.length) {
        for (const [name2, v] of entries2) {
          out3(dw().claudeEntry(name2, v.command ?? "", (v.args ?? []).join(" ")));
          launches.push({
            who: `Claude Code «${name2}»`,
            harness: "claude",
            command: v.command ?? "",
            entry: name2
          });
        }
      } else out3(dw().claudeNoManual());
    } catch {
      out3(dw().claudeUnreadable(claude));
    }
  }
  const opencodeDir = join31(homedir14(), ".config", "opencode");
  if (existsSync15(opencodeDir)) {
    const copy = join31(opencodeDir, "plugins", PLUGIN_COPY_FILE);
    const packaged = join31(dirname15(fileURLToPath8(import.meta.url)), PLUGIN_FILE);
    if (!existsSync15(copy)) out3(dw().ocNoPlugin(copy));
    else if (!existsSync15(packaged)) out3(dw().ocNoPackaged(copy));
    else if (readFileSync33(copy).equals(readFileSync33(packaged))) out3(dw().ocSame(copy));
    else out3(dw().ocDiffers(copy, packaged));
    if (existsSync15(copy)) out3(openCodeRuntimeWord());
  }
  openCodeMcpEntries(out3);
  for (const codexHome of codexHomes()) {
    out3(dw().codexHome(codexHome));
    codexPluginReport(codexHome);
    const door = join31(codexHome, "app-server-control", "app-server-control.sock");
    if (existsSync15(door)) out3(dw().codexDoorOpen(door));
    else if (Buffer.byteLength(door) > 100) out3(dw().codexDoorNever());
    else out3(dw().codexDoorNone(door));
    const codex = join31(codexHome, "config.toml");
    if (existsSync15(codex)) {
      const text2 = readFileSync33(codex, "utf8");
      out3(dw().codexManual(CODEX_ENTRY_RE.test(text2)));
    }
  }
  launchReport(out3, launches);
  secondPathReport(out3, codexHomes());
}
async function daemonReport() {
  out3(daemonWanted() ? dw().daemonOn() : dw().daemonOff());
  out3(dw().daemonGrant(CFG.authDir));
  const fallbacks = readFallbacks(CFG.authDir);
  if (!fallbacks.length) out3(dw().fallbackNone());
  else {
    out3(dw().fallbackCount(fallbacks.length));
    for (const f of fallbacks) out3(dw().fallbackOne(f.pid, f.build, f.since, f.cwd, f.why));
  }
  if (!existsSync15(seamRunDir(CFG.authDir))) {
    out3(dw().daemonNeverUp(seamRunDir(CFG.authDir)));
    return;
  }
  const d = await probeDaemon(["--auth-dir", CFG.authDir]);
  if (d.ok) {
    out3(dw().daemonSocket(d.socket));
    out3(
      dw().daemonAnswers(
        d.pid,
        d.build,
        !d.build.startsWith(`v${VERSION}+`),
        VERSION,
        d.sessions,
        d.path
      )
    );
  } else if (d.unsafe) out3(dw().daemonUnsafe(d.why));
  else out3(dw().daemonSilent(d.socket, d.why));
}
async function runDoctor(argv2) {
  setConfig(parseArgs(argv2));
  out3(dw().title(BUILD));
  out3(dw().thisFile(fileURLToPath8(import.meta.url)));
  out3(`node: ${process.version}`);
  homeCopyReport();
  latestReport();
  await daemonReport();
  await serverReport();
  if (CFG.pat) await patReport();
  else grantReport();
  harnessReport();
  skillsReport(out3, codexHomes());
  await subagentsReport(out3);
}

// js/cli/rituals.ts
import { mkdtempSync as mkdtempSync2, readdirSync as readdirSync15, realpathSync as realpathSync4, rmSync as rmSync3, statSync as statSync11 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { join as join34, resolve as resolve10 } from "node:path";

// js/cli/ritualprobe.ts
import { mkdtempSync, rmSync as rmSync2, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as join33 } from "node:path";
import { pathToFileURL } from "node:url";

// js/cli/ritualcalls.ts
import { homedir as homedir15 } from "node:os";
import { join as join32 } from "node:path";
var memoryPath = join32(homedir15(), ".claude", "projects", "-probe", "memory", "MEMORY.md");
var pushed = "To github.com:o/r.git\n   1234567..89abcde  feat/x -> feat/x";
var seq2 = 0;
var fresh = (kind) => `${kind}-${++seq2}`;
var isPlain = (id) => id.startsWith("plain-");
var calls = (sessionID) => ({
  before: ["write", "edit"].map((tool2) => ({
    tool: tool2,
    sessionID,
    agent: "build",
    messageID: "msg",
    id: fresh(tool2),
    input: { filePath: memoryPath, content: "x" }
  })),
  plain: [
    {
      tool: "write",
      sessionID,
      agent: "build",
      messageID: "msg",
      id: fresh("plain"),
      input: { filePath: "README.md", content: "x" }
    }
  ],
  after: [
    ["git push -u origin feat/x", pushed],
    ["gh pr merge 12 --squash --delete-branch", ""]
  ].map(([command, content]) => ({
    tool: "bash",
    sessionID,
    agent: "build",
    messageID: "msg",
    id: fresh("bash"),
    status: "completed",
    input: { command },
    result: { content, metadata: { exit: 0 } }
  }))
});
var BROKEN = /* @__PURE__ */ new Set(["ReferenceError", "TypeError", "SyntaxError", "RangeError"]);
async function runHooks(hooks, sessionID) {
  const hit = [];
  const broken = [];
  const c = calls(sessionID);
  for (const [name2, inputs] of [
    ["execute.before", c.before],
    ["execute.before", c.plain],
    ["execute.after", c.after]
  ]) {
    for (const input of inputs) {
      const was = JSON.stringify(input);
      const what = `${name2} ${input.tool}${isPlain(input.id) ? " (not a memory path)" : ""}`;
      for (const fn of hooks[name2] ?? []) {
        try {
          await fn(input);
        } catch (e) {
          const err = e;
          const said2 = `${what}: throw (${err?.name ?? "?"}: ${String(err?.message ?? e)})`;
          hit.push(said2);
          if (BROKEN.has(err?.name) || isPlain(input.id) || name2 === "execute.after")
            broken.push(said2);
        }
      }
      if (JSON.stringify(input) !== was) hit.push(`${what}: changed`);
    }
  }
  return { hit, broken };
}

// js/cli/ritualprobe.ts
var SETTLE_MS = 200;
var SETUP_MS = 5e3;
var loose = (fields = {}) => new Proxy(fields, {
  get: (t, k) => k in t || typeof k === "symbol" || k === "then" ? t[k] : loose(async () => void 0)
});
var DOMAINS = new Set(
  "app location options agent aisdk command event experimental integration mcp model generate permission plugin provider reference rpc session shell skill storage tool vcs websearch worktree".split(
    " "
  )
);
var context = (fields) => new Proxy(fields, {
  get: (t, k) => k in t || typeof k === "symbol" || !DOMAINS.has(k) ? t[k] : loose(async () => void 0)
});
var baseline = new Set(Reflect.ownKeys(globalThis));
var dropPluginGlobals = () => {
  const g = globalThis;
  for (const k of Reflect.ownKeys(globalThis)) if (!baseline.has(k)) delete g[k];
};
var probes = 0;
var created = (sessionID, directory) => {
  const location = { directory };
  return {
    type: "session.created",
    location,
    data: { sessionID, projectID: `prj-${sessionID}`, location }
  };
};
var settle = (ms2 = SETTLE_MS) => new Promise((r) => setTimeout(r, ms2));
async function probeScope(file, own, foreign) {
  const aliasRoot = mkdtempSync(join33(tmpdir(), "ritual-scope-alias-"));
  try {
    const alias = join33(aliasRoot, "own");
    symlinkSync(own, alias, "dir");
    return await probeWith(file, own, alias, foreign);
  } finally {
    rmSync2(aliasRoot, { recursive: true, force: true });
  }
}
async function probeWith(file, own, alias, foreign) {
  dropPluginGlobals();
  const tag = ++probes;
  const who = ["mine", "twin", "theirs"];
  const id = Object.fromEntries(who.map((w) => [w, `${w}@${tag}`]));
  const whoOf4 = (sessionID) => who.find((w) => id[w] === sessionID);
  const dirs = { mine: own, twin: alias, theirs: foreign };
  const writes = { mine: 0, twin: 0, theirs: 0 };
  const hooks = {};
  const reads = /* @__PURE__ */ new Set(["get", "list", "messages", "children", "status"]);
  const session = new Proxy(
    {},
    {
      get: (_, k) => {
        if (typeof k === "symbol" || k === "then") return void 0;
        if (k === "get")
          return async ({ sessionID } = {}) => {
            const who2 = whoOf4(sessionID);
            return who2 ? { id: sessionID, location: { directory: dirs[who2] } } : null;
          };
        if (reads.has(k)) return async () => [];
        return async (arg) => {
          const who2 = whoOf4(arg?.sessionID);
          if (who2) writes[who2] += 1;
        };
      }
    }
  );
  let subscribed = false;
  const ctx = context({
    location: { directory: alias },
    session,
    tool: loose({ hook: async (name2, fn) => void (hooks[name2] ??= []).push(fn) }),
    event: loose({
      subscribe: ({ signal } = {}) => {
        subscribed = true;
        return (async function* () {
          for (const w of who) yield created(id[w], dirs[w]);
          if (signal) await new Promise((r) => signal.addEventListener("abort", r));
        })();
      }
    })
  });
  const mod = await import(`${pathToFileURL(file).href}?scope=${Date.now()}`);
  const plugin = mod.default ?? Object.values(mod).find((v) => typeof v?.setup === "function");
  if (typeof plugin?.setup !== "function") throw new Error("no default export { setup }");
  let timer;
  const cleanup = await Promise.race([
    plugin.setup(ctx),
    new Promise(
      (_, no) => timer = setTimeout(
        () => no(new Error(`setup did not return in ${SETUP_MS} ms`)),
        SETUP_MS
      )
    )
  ]).finally(() => clearTimeout(timer));
  await settle();
  const onEvents = { ...writes };
  const mine = await runHooks(hooks, id.mine);
  await settle(50);
  if (typeof cleanup === "function") await cleanup();
  return {
    writes: onEvents,
    subscribed,
    broken: mine.broken,
    ownBefore: mine.hit.some(
      (h) => h.startsWith("execute.before write: throw") && !mine.broken.includes(h)
    ),
    ownAfter: mine.hit.includes("execute.after bash: changed")
  };
}

// js/cli/rituals.ts
var out4 = (s2) => {
  process.stdout.write(s2 + "\n");
};
var rw2 = () => words(RITUALS);
async function auditRepo(repo) {
  const own = realpathSync4(repo);
  const dir2 = join34(own, ".opencode", "plugins");
  let names2;
  try {
    names2 = readdirSync15(dir2).filter((n) => /\.(m?js|ts)$/.test(n));
  } catch {
    return [];
  }
  const foreign = realpathSync4(mkdtempSync2(join34(tmpdir2(), "ritual-scope-foreign-")));
  const verdicts = [];
  try {
    for (const name2 of names2.sort()) {
      const file = join34(dir2, name2);
      try {
        const scope = await probeScope(file, own, foreign);
        const hole = scope.writes.theirs > 0 || lostSpelling(scope) || mute(scope) || scope.broken.length > 0;
        verdicts.push({ file, hole, scope });
      } catch (e) {
        verdicts.push({ file, hole: true, error: String(e?.message ?? e) });
      }
    }
  } finally {
    rmSync3(foreign, { recursive: true, force: true });
  }
  return verdicts;
}
var lostSpelling = (s2) => s2.writes.mine > 0 !== s2.writes.twin > 0;
var mute = (s2) => s2.subscribed && s2.writes.mine + s2.writes.twin === 0;
function verdictLines(v) {
  const s2 = v.scope;
  if (v.error || !s2) return [rw2().notChecked(v.file, v.error)];
  if (!v.hole) {
    const quiet = s2.subscribed ? "" : rw2().noSubscription();
    return [`ok  ${v.file}${quiet}`];
  }
  const lines = [rw2().hole(v.file)];
  if (s2.writes.theirs > 0) lines.push(rw2().foreignWrites(s2.writes.theirs));
  if (lostSpelling(s2)) lines.push(rw2().lostSpelling(s2.writes.mine, s2.writes.twin));
  if (mute(s2)) lines.push(rw2().mute());
  if (s2.writes.theirs > 0 || lostSpelling(s2) || mute(s2))
    lines.push(`  ${rw2().fixScope(words(HOOKS_SECTION))}`);
  for (const h of s2.broken) lines.push(rw2().broken(h));
  if (s2.broken.length) lines.push(`  ${rw2().fixBroken(words(HOOKS_SECTION))}`);
  return lines;
}
var RITUALS_USAGE = () => rw2().usage();
var isDir = (p) => {
  try {
    return statSync11(p).isDirectory();
  } catch {
    return false;
  }
};
var refuse = (word3) => {
  process.stderr.write(`check-rituals: ${word3}
${RITUALS_USAGE()}
`);
  process.exitCode = 2;
};
async function runCheckRituals(argv2) {
  const end = argv2.indexOf("--");
  const head = end < 0 ? argv2 : argv2.slice(0, end);
  const tail2 = end < 0 ? [] : argv2.slice(end + 1);
  if (head.includes("--help") || head.includes("-h")) return out4(RITUALS_USAGE());
  const flag = head.find((a) => a.startsWith("-") && a !== "--json");
  if (flag) return refuse(rw2().unknownFlag(flag));
  const json = head.includes("--json");
  const repos = [...head.filter((a) => a !== "--json"), ...tail2].map((a) => resolve10(a));
  const missing = repos.find((r) => !isDir(r));
  if (missing) return refuse(rw2().noDir(missing));
  const verdicts = [];
  for (const repo of repos.length ? repos : [resolve10(".")])
    verdicts.push(...await auditRepo(repo));
  if (json) out4(JSON.stringify(verdicts));
  else if (verdicts.length === 0) out4(rw2().noPlugins());
  else for (const v of verdicts) for (const line of verdictLines(v)) out4(line);
  const code = verdicts.some((v) => v.hole) ? 1 : 0;
  process.stdout.write("", () => process.exit(code));
}

// js/cli/status.ts
import { existsSync as existsSync16 } from "node:fs";

// js/cli/statusdisk.ts
import { readdirSync as readdirSync16, readFileSync as readFileSync34 } from "node:fs";
import { join as join35 } from "node:path";
async function diskPlaces(authDir, sessions = []) {
  const dir2 = join35(authDir, "standings");
  let names2;
  try {
    names2 = readdirSync16(dir2).filter((n) => n.endsWith(".hold")).sort();
  } catch {
    return [];
  }
  const rows = await Promise.all(
    names2.map(async (n) => {
      try {
        const p = record(JSON.parse(readFileSync34(join35(dir2, n), "utf8")));
        if (!text(p.name) || !text(p.realm) || !["string", "number"].includes(typeof p.karta))
          return null;
        if (sessions.some(
          (s2) => s2.places.some(
            (held2) => held2.name === p.name && held2.realm === p.realm && String(held2.karta) === String(p.karta)
          )
        ))
          return null;
        return {
          name: text(p.name),
          realm: text(p.realm),
          karta: p.karta,
          left: p.left === true,
          kind: "record"
        };
      } catch {
        return null;
      }
    })
  );
  return rows.filter((p) => p !== null);
}
var fallbackSnapshot = (authDir) => readFallbacks(authDir).map((f) => ({ pid: f.pid, build: text(f.build), cwd: text(f.cwd) }));

// js/cli/status.ts
async function machine(authDir) {
  let daemon_error = "no answer";
  if (!existsSync16(authDir)) daemon_error = "missing directory";
  else if (!seamEntranceProblem(authDir, false)) {
    try {
      const link = await connectSeam(
        seamSocketPath(authDir, false),
        {
          ...helloFrame({ build: BUILD, path: "", argv: [], probe: true }),
          env: {},
          snapshot: true
        },
        3e3
      );
      const w = link.welcome;
      link.close();
      if (w.snapshot) return { ...safeSnapshot(w.snapshot), snapshot_available: true };
      return {
        daemon: safeSnapshot({ daemon: w }).daemon,
        sessions: [],
        snapshot_available: false,
        ...w.snapshot_error === "snapshot failed" ? { snapshot_error: w.snapshot_error } : {},
        ...typeof w.sessions === "number" && Number.isInteger(w.sessions) && w.sessions >= 0 ? { session_count: w.sessions } : {}
      };
    } catch (e) {
      if (e instanceof SeamError && e.kind === "refused")
        daemon_error = e.protocol !== void 0 && e.protocol !== SEAM_PROTOCOL ? "different protocol" : "refused";
    }
  }
  return { daemon: null, sessions: [], snapshot_available: false, daemon_error };
}
var printable = (v) => [...String(v)].map(
  (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159 ? " " : c
).join("");
function formatSkills(label, skills) {
  return skills ? ` · ${label}=${printable(skills.name)} ${printable(skills.version)}${skills.stamp ? `+${printable(skills.stamp)}` : ""}` : "";
}
function render(s2) {
  const w = words(MACHINE_STATUS);
  const d = s2.daemon;
  const lines = [
    d ? `${w.daemon()}: pid=${d.pid} ${printable(d.build)} ${printable(d.path)}` : s2.daemon_error === "missing directory" ? w.missing() : s2.daemon_error === "different protocol" ? w.protocol() : s2.daemon_error === "refused" ? w.refused() : w.absent()
  ];
  if (d && !s2.snapshot_available)
    lines.push(s2.snapshot_error ? w.snapshotFailed() : w.unavailable());
  if (d && !s2.snapshot_available && s2.session_count !== void 0)
    lines.push(`${w.sessions()}: ${s2.session_count}`);
  if (!d || s2.snapshot_available) lines.push(`${w.sessions()}: ${s2.sessions.length}`);
  for (const session of s2.sessions) {
    const stamp = formatSkills("skills", session.skills);
    const diskStamp = formatSkills("installed_skills", session.installed_skills);
    lines.push(
      `  ${printable(session.local_id)} pid=${session.thin_pid} ${session.attached ? w.attached() : w.detached()} ${printable(session.harness)} ${printable(session.harness_session ?? "-")} ${printable(session.build)} ${printable(session.cwd)}${stamp}${diskStamp}${session.skills_mismatch ? " · skills_mismatch" : ""}`
    );
    for (const p of session.places) {
      const declaration = formatSkills("skills", p.skills);
      const mode = p.satellite_of ? `${w.satellite()} ${printable(p.satellite_of)}` : p.primary ? w.primary() : w.beside();
      lines.push(
        `    ${printable(p.name)} ${printable(p.realm)} #${printable(p.karta)} ${mode} · ${p.listening ? w.listening() : w.silent()} · ${w.lastWork()}: ${printable(p.last_work_at ?? w.unknown())}${p.usage ? ` · usage=${JSON.stringify(p.usage)}` : ""}${p.pulse ? ` · pulse=${JSON.stringify(p.pulse)}` : ""}${declaration}${p.skills_mismatch ? " · skills_mismatch" : ""}`
      );
    }
  }
  lines.push(`${w.fallback()}: ${s2.fallback.length}`);
  for (const f of s2.fallback)
    lines.push(`  pid=${f.pid} ${printable(f.build)} ${printable(f.cwd)}`);
  lines.push(`${w.disk()}: ${s2.disk_only.length}`);
  for (const p of s2.disk_only)
    lines.push(
      `  ${printable(p.name)} ${printable(p.realm)} #${printable(p.karta)} — ${w.record()} · ${w.left(p.left)}`
    );
  return lines.join("\n") + "\n";
}
async function runStatus(args) {
  const i = args.indexOf("--auth-dir");
  const authDir = (i >= 0 ? args[i + 1] : void 0) || process.env[envName("BRIDGE_AUTH_DIR")] || defaultAuthDir();
  setLang(args[args.indexOf("--lang") + 1]);
  const inspected = await machine(authDir);
  const snapshot = {
    ...inspected,
    fallback: fallbackSnapshot(authDir),
    disk_only: await diskPlaces(authDir, inspected.sessions)
  };
  process.stdout.write(
    args.includes("--json") ? JSON.stringify(snapshot, null, 2) + "\n" : render(snapshot)
  );
}

// js/cli/stop.ts
import { readFileSync as readFileSync35 } from "node:fs";

// js/cli/stopapi.ts
import { randomUUID } from "node:crypto";
var sw4 = () => words(STOP_CLI);
var TIMEOUT_MS2 = 1e4;
var sameServer = (a, b) => {
  const at2 = (u) => {
    const x = new URL(u);
    return `${x.origin}${x.pathname.replace(/\/+$/, "")}`;
  };
  try {
    return at2(a) === at2(b);
  } catch {
    return false;
  }
};
async function keyFor2(server) {
  if (CFG.pat) return { token: CFG.pat };
  if (!loadStore().tokens?.access_token) return { why: sw4().noKey(server) };
  try {
    return { token: (await ensureAuth(null, { interactive: false })).access_token };
  } catch (e) {
    return { why: sw4().signIn(server, errorMessage(e)) };
  }
}
async function ask2(url, method2, realm, token, body) {
  const res = await fetch(url, {
    method: method2,
    headers: {
      authorization: `Bearer ${token}`,
      "x-nks-realm": realm,
      ...body ? { "content-type": "application/json" } : {}
    },
    ...body ? { body: JSON.stringify(body) } : {},
    signal: AbortSignal.timeout(TIMEOUT_MS2)
  });
  return { status: res.status, text: (await res.text().catch(() => "")).slice(0, 300) };
}
async function stopSeat(p, id, base, token) {
  const seat2 = `${p.name} (${p.realm})`;
  const at2 = `${base}/standings/${encodeURIComponent(id)}`;
  try {
    const order = await ask2(`${at2}/stop`, "POST", p.realm, token, {
      reason_code: "person_request",
      client_id: `stop-${randomUUID()}`
    });
    if (order.status >= 200 && order.status < 300) {
      let orderId = "";
      try {
        const o = JSON.parse(order.text);
        if (typeof o.id === "string") orderId = o.id;
      } catch {
      }
      return { ok: true, said: sw4().ordered(seat2, orderId) };
    }
    if (order.status === 410) return { ok: true, said: sw4().gone(seat2) };
    if (order.status === 401)
      return { ok: false, said: sw4().signIn(CFG.serverUrl, `401 ${order.text}`) };
    if (order.status !== 404)
      return { ok: false, said: sw4().refused(seat2, "stop", order.status, order.text) };
    const revoke = await ask2(at2, "DELETE", p.realm, token);
    if (revoke.status >= 200 && revoke.status < 300) return { ok: true, said: sw4().revoked(seat2) };
    if (revoke.status === 410) return { ok: true, said: sw4().gone(seat2) };
    return { ok: false, said: sw4().refused(seat2, "revoke", revoke.status, revoke.text) };
  } catch (e) {
    return { ok: false, said: sw4().unreachable(seat2, e.message) };
  }
}

// js/cli/stop.ts
var sw5 = () => words(STOP_CLI);
function take(args, flag) {
  const i = args.indexOf(flag);
  if (i < 0) return void 0;
  return args.splice(i, 2)[1];
}
function pick2(sessions, target, realm) {
  const session = sessions.find((s2) => s2.local_id === target);
  const full = /^@[^:]+:/.test(target);
  const name2 = target.replace(/^@[^:]+:/, "");
  const found = session ? session.places.filter((p) => p.primary || session.places.length === 1).map((place) => ({ place, session })) : sessions.flatMap(
    (s2) => s2.places.filter((p) => p.name === name2).map((place) => ({ place, session: s2 }))
  );
  const inRealm = found.filter(
    ({ place: p }) => !realm || p.realm === realm || p.realm.endsWith(`/${realm}`)
  );
  const seats2 = full && !session ? inRealm.filter(({ place: p }) => p.address === target) : inRealm;
  if (!seats2.length && inRealm.length) {
    const known2 = inRealm.map(({ place: p }) => p.address).filter((x) => !!x);
    return known2.length ? sw5().otherOwner(target, known2.join(", ")) : sw5().noOwner(target);
  }
  if (!seats2.length) return sw5().notFound(target);
  if (seats2.length > 1)
    return sw5().ambiguous(target, seats2.map(({ place: p }) => `${p.name} (${p.realm})`).join(", "));
  return seats2[0];
}
function apiOf({ place: p, session }) {
  if (session.api) return session.api;
  try {
    const rec5 = JSON.parse(
      readFileSync35(holdFilePathOf(CFG.authDir, keyOf(p.realm, p.karta, p.name)), "utf8")
    );
    return typeof rec5.url === "string" && rec5.url ? apiBase(rec5.url) : null;
  } catch {
    return null;
  }
}
async function runStop(argv2) {
  const args = [...argv2];
  const lang2 = take(args, "--lang");
  const configure = (cfg2) => {
    setConfig(cfg2);
    setLang(lang2);
  };
  setLang(lang2);
  const realm = take(args, "--realm");
  const authDir = take(args, "--auth-dir") || process.env[envName("BRIDGE_AUTH_DIR")] || defaultAuthDir();
  const target = args.find((a) => !a.startsWith("--"));
  const fail2 = (text2) => {
    process.stderr.write(`${text2}
`);
    process.exitCode = 1;
  };
  if (!target) return fail2(sw5().usage().trimEnd());
  const rest2 = args.filter((a) => a !== target);
  configure(parseArgs(["--auth-dir", authDir, ...rest2]));
  const snap = await machine(authDir);
  if (!snap.snapshot_available) return fail2(sw5().noDaemon());
  const seat2 = pick2(snap.sessions, target, realm);
  if (typeof seat2 === "string") return fail2(seat2);
  const p = seat2.place;
  if (!p.standing_id) return fail2(sw5().noId(p.name));
  const server = seat2.session.server;
  if (!server) return fail2(sw5().noServer(p.name));
  const base = apiOf(seat2);
  if (!base) return fail2(sw5().noRecord(p.name));
  const patServer = CFG.serverUrl;
  const cfg = parseArgs([server, "--auth-dir", authDir, ...rest2]);
  if (!sameServer(patServer, server)) {
    cfg.pat = null;
    cfg.patSource = null;
  }
  configure(cfg);
  const key2 = await keyFor2(server);
  if ("why" in key2) return fail2(key2.why);
  const out7 = await stopSeat(p, p.standing_id, base, key2.token);
  if (!out7.ok) return fail2(out7.said);
  process.stdout.write(`${out7.said}
`);
}

// js/cli/update.ts
var out5 = (s2) => {
  process.stdout.write(s2 + "\n");
};
var cw = () => words(CLI);
async function runUpdate(argv2) {
  setConfig(parseArgs(argv2));
  out5(cw().updateTitle(BUILD));
  out5(cw().updateServer(CFG.serverUrl, serverSourceWord(), freshnessWord(CFG.serverUrl)));
  const latest = await checkLatest(CFG.authDir, true);
  if (!latest || !latest.version) {
    out5(
      latest?.rate_limited ? cw().rateLimited(latest.error, !!latest.rate_limited_until) : cw().latestUnknown(latest?.error)
    );
    process.exitCode = 1;
    return;
  }
  const lag = cw().lag(compareVersions(latest.version, VERSION));
  out5(cw().latest(latest.version, latest.tag, VERSION, lag));
  if (latest.error) out5(cw().downloadFailed(latest.error));
  if (latest.downloaded.length) for (const p of latest.downloaded) out5(cw().placed(p));
  else out5(cw().nothingPlaced(homeBridgePath()));
  harnessReport();
  out5("");
  out5(cw().next());
  const setup = setupPathOf(CFG.authDir);
  const fetched = latest.downloaded.includes(setup);
  out5(cw().stepSkills(setup, fetched));
  out5(cw().stepRestart());
  out5(cw().stepDoctor());
}

// js/cli/use.ts
var out6 = (s2) => {
  process.stdout.write(s2 + "\n");
};
var cw2 = () => words(CLI);
function runUse(argv2) {
  let word3;
  const rest2 = [];
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i] ?? "";
    if (a === "--auth-dir") rest2.push(a, argv2[++i] ?? "");
    else if (a.startsWith("--") || word3) rest2.push(a);
    else word3 = a;
  }
  setConfig(parseArgs(rest2));
  const url = word3 ? resolveServerChoice(word3) : null;
  if (!url) {
    out6(cw2().useNoAddress());
    process.exitCode = 2;
    return;
  }
  const path = writeServerChoice(CFG.authDir, url);
  setServerLang(url);
  out6(cw2().useWritten(url, path, freshnessWord(url)));
  out6(cw2().useEffect());
}

// js/cli/main.ts
var cw3 = () => words(CLI);
var usage = () => cw3().usage(BUILD, RITUALS_USAGE());
var argv = process.argv.slice(2);
var [first, ...rest] = argv;
var LONG_LIVED = /* @__PURE__ */ new Set([void 0, "bridge", "watchdog", "watchdog-exit", "watchdog-codex"]);
var longLived = LONG_LIVED.has(first) || first !== void 0 && !first.startsWith("--") && ![
  "doctor",
  "status",
  "stop",
  "update",
  "use",
  "check-rituals",
  "daemon",
  "version",
  "-h"
].includes(first);
if (longLived && !updatesDisabled() && !process.env[envName("BRIDGE_REEXEC")]) {
  const sync = syncHome();
  for (const p of sync.copied) process.stderr.write(cw3().homeUpdated(p));
  if (sync.reexec) reexec(sync.reexec, argv);
  else dispatch();
} else dispatch();
function dispatch() {
  switch (first) {
    case "status":
      void runStatus(rest);
      break;
    case "stop":
      void runStop(rest);
      break;
    case "watchdog":
      runWatchdog(rest);
      break;
    case "watchdog-exit":
      runWatchdogExit(rest);
      break;
    case "watchdog-codex":
      runWatchdogCodex(rest);
      break;
    case "doctor":
      void runDoctor(rest);
      break;
    case "update":
      void runUpdate(rest);
      break;
    case "use":
      runUse(rest);
      break;
    case "check-rituals":
      void runCheckRituals(rest);
      break;
    case "bridge":
      bridgeMain(rest);
      break;
    case "daemon":
      void daemonMain(rest);
      break;
    case "--version":
    case "version":
      void versionLines(rest).then((lines) => process.stdout.write(lines.join("\n") + "\n"));
      break;
    case "--help":
    case "-h":
      process.stdout.write(usage());
      break;
    default:
      bridgeMain(argv);
  }
}
