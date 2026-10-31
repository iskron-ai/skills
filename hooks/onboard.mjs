// js/cli/onboard-hook.ts
import { readFileSync as readFileSync4 } from "node:fs";

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
  /** Формы обложки по языку репозитория: действует та, чьи ключи стоят во фронтматтере. */
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

// js/delivery/words/compaction.ts
var role = (karta, none) => {
  const seq = karta.replace(/^#/, "");
  return seq && seq !== "undefined" ? `#${seq}` : none;
};
var COMPACTION = {
  ru: {
    keep: (karta, name, realm) => `Искрон: сводка этого сжатия обязана сохранить роль агента ${role(karta, "<роль>")} в графе ${realm}, его место ${name} (стояние держит мост), живые дела — номером и тем, чего в них ждут, — и указание первым ходом после сжатия перечитать дверь (скилл iskron) и скиллы роли.`,
    back: (karta, name, realm) => `Искрон: контекст сжат. Ты — роль ${role(karta, "<роль>")} в графе ${realm}, место ${name} держит мост. До первого содержательного хода загрузи дверь (скилл iskron) и скиллы роли — их называет дверь; только их, не все прежние. Сводка — указатель, не запись: решение, основание или факт из неё, на который опираешься, прочти в графе заново (скилл recall).`,
    bare: () => `Искрон: контекст сжат. До первого содержательного хода загрузи дверь (скилл iskron) и скиллы роли — их называет дверь; только их, не все прежние. Сводка — указатель, не запись: решение, основание или факт из неё, на который опираешься, прочти в графе заново (скилл recall).`,
    returned: (sessionID) => `Искрон: слово о роли после сжатия положено в первый запрос сессии ${sessionID}`
  },
  en: {
    keep: (karta, name, realm) => `Iskron: the summary of this compaction must keep the agent's role ${role(karta, "<role>")} in graph ${realm}, its seat ${name} (the bridge holds the standing), the live cases — by number and what they wait for — and the instruction to reread the door (the iskron skill) and the role's skills as the first move after the compaction.`,
    back: (karta, name, realm) => `Iskron: the context was compacted. You are role ${role(karta, "<role>")} in graph ${realm}, the bridge holds seat ${name}. Before the first substantive move load the door (the iskron skill) and the role's skills — the door names them; only those, not all the earlier ones. The summary is a pointer, not the record: a decision, ground or fact from it you lean on — read it in the graph again (the recall skill).`,
    bare: () => `Iskron: the context was compacted. Before the first substantive move load the door (the iskron skill) and the role's skills — the door names them; only those, not all the earlier ones. The summary is a pointer, not the record: a decision, ground or fact from it you lean on — read it in the graph again (the recall skill).`,
    returned: (sessionID) => `Iskron: the role word after the compaction was laid into the first request of session ${sessionID}`
  }
};

// js/delivery/words/onboardstart.ts
var ONBOARD_START = {
  ru: {
    start: () => "Этот репозиторий ещё не выровнен под агента — начни со скилла onboarding (ветвь iskronify «Первый граф»)."
  },
  en: {
    start: () => "This repository is not yet aligned for the agent — start with the onboarding skill."
  }
};

// js/delivery/words/status.ts
var TAKE_PATH_RU = `iskron_stand с take=true (${TAKE.ru.rule()}) переносит слух и статусный адрес сюда ОДИН раз: адрес остаётся у ЭТОГО экземпляра моста, и поднятый следом сторож его не уносит — по устройству: сторож есть локальный клиент сокета, своего connect он не делает (замер: два вызова занятости подряд при живом стороже, сборка 6.10.1; путь take наблюдала сторона nks-mcp на своей). Прежний держатель получит закрытие 4000 (вытесненному отбивать место назад тем же ходом не нужно — ему место рядом, имя.N); входной адрес и очередь места connect не трогает, ждавшее придёт в hello (справка iskron_channel action="?", connect); после переноса перевзведи сторожа командой из ответа`;
var TAKE_PATH_EN = `iskron_stand with take=true (${TAKE.en.rule()}) moves the hearing and the status address here ONCE: the address stays with THIS bridge instance, and a watchdog raised after it does not carry it off — by design: the watchdog is a local client of the socket and makes no connect of its own. The former holder gets close 4000 (the evicted one need not take the seat back the same way — it gets a seat beside, name.N); connect does not touch the seat's incoming address and queue, what waited comes in hello (help: iskron_channel action="?", connect); after the move re-arm the watchdog with the command from the answer`;
var TWO_ENTRIES_RU = "Если место — твоё и держит его мост этой же сессии (в ней две записи iskron, плагинная и пользовательская), зови status тем же набором тулов, которым звал iskron_stand: передача не нужна.";
var TWO_ENTRIES_EN = "If the seat is yours and a bridge of this same session holds it (the session has two iskron entries, the plugin's and the user's), call status with the same tool set you called iskron_stand with: no move is needed.";
var TURNED_RU = `${TWO_ENTRIES_RU} Иначе ${TAKE_PATH_RU}.`;
var TURNED_EN = `${TWO_ENTRIES_EN} Otherwise ${TAKE_PATH_EN}.`;

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
var standingsDirOf = (authDir) => join(authDir, "standings");
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
var words = (dict) => dict[lang()];

// js/shared/reposigns.ts
import { readFileSync as readFileSync2, statSync } from "node:fs";
import { dirname, join as join3, resolve as resolve3 } from "node:path";

// js/shared/graphslot.ts
var SLUG = String.raw`@[\w.-]+\/[\w.-]*\w`;
var ADDRESS = String.raw`(?:${SLUG}(?=[.-]*(?:$|[\s)\x60'",;.:]))|r\d+(?=$|[\s)\x60'",;.:]))`;
var FRAME = String.raw`[\s\x60'"]*`;
var HEAD = new RegExp(String.raw`^(${ADDRESS})(?:${FRAME}\(${FRAME}(${ADDRESS})${FRAME}\))?`);
var ANY = new RegExp(String.raw`${SLUG}|(?<![\w/])r\d+(?!\w)`, "gu");
var PROSE = new RegExp("^[—–\\-:.(]*\\s*(?!r\\d)\\p{L}", "u");

// js/shared/cover.ts
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
function frontMatter(text2) {
  const lines = text2.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return null;
  const raw = /* @__PURE__ */ new Map();
  let last = null;
  for (const line2 of lines.slice(1, end)) {
    const kv = /^\s*('(?:[^']|'')*'|"(?:[^"\\]|\\.)*"|[^\s'"#][^:]*?)\s*:(?:\s+(.*))?$/.exec(line2);
    if (kv) raw.set(last = unquote(kv[1]), kv[2] ?? "");
    else if (last !== null && /^\s+[^\s#]/.test(line2))
      raw.set(last, `${raw.get(last)}
${line2.trim()}`);
  }
  return new Map([...raw].map(([k, v]) => [k, unquote(v)]));
}
var formsIn = (pairs, cover) => Object.entries(cover.forms).filter(([, f]) => pairs.has(f.graph) || pairs.has(f.role));
function stampOf(text2, cover = COVER) {
  if (Object.values(cover.forms).some((f) => f.stamp.test(text2))) return "own";
  return cover.stampShape.test(text2) ? "foreign" : null;
}
var hasForm = (pairs, cover = COVER) => formsIn(pairs, cover).length > 0;

// js/shared/reposigns.ts
var exists = (path) => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};
var text = (path) => {
  try {
    return readFileSync2(path, "utf8");
  } catch {
    return null;
  }
};
function repoRoot(dir2) {
  let at = resolve3(dir2);
  for (; ; ) {
    if (exists(join3(at, ".git"))) return at;
    const up = dirname(at);
    if (up === at) return null;
    at = up;
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
function repoSigns(dir2, harness, keys = REPO_SIGNS, cover = COVER) {
  const root = repoRoot(dir2);
  const hooks = { "claude-code": false, opencode: false };
  if (root === null) return { root, cover: false, stamp: false, hooks, verdict: "outside" };
  const agents = text(join3(root, cover.file));
  const pairs = agents === null ? null : frontMatter(agents);
  const stamped = agents === null ? null : stampOf(agents, cover);
  const signs = {
    cover: !!pairs && stamped !== "foreign" && hasForm(pairs, cover),
    stamp: stamped === "own",
    hooks: {
      "claude-code": startHook(text(join3(root, keys.settings)), keys.startMark),
      opencode: exists(join3(root, keys.rituals))
    }
  };
  const hooked = signs.hooks["claude-code"] || signs.hooks.opencode;
  const any = signs.cover || signs.stamp || hooked;
  const complete = signs.cover && signs.stamp && (harness === null || signs.hooks[harness]);
  const verdict = stamped === "foreign" && !hooked ? "foreign" : !any ? "invite" : complete ? "aligned" : "partial";
  return { root, ...signs, verdict };
}

// js/shared/seatbydir.ts
import { readdirSync, readFileSync as readFileSync3 } from "node:fs";
import { join as join4 } from "node:path";

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

// js/shared/seatbydir.ts
function seatByDir(authDir, cwd, client, now = Date.now()) {
  const seats = /* @__PURE__ */ new Map();
  let files;
  try {
    files = readdirSync(standingsDirOf(authDir)).filter((f) => f.endsWith(".hold"));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const r = JSON.parse(readFileSync3(join4(standingsDirOf(authDir), f), "utf8"));
      if (r?.client !== client || r.left === true || !sameDir(r.cwd, cwd)) continue;
      if (typeof r.at !== "number" || now - r.at > HOLD_RECORD_MAX_AGE_MS) continue;
      if (typeof r.realm !== "string" || !r.realm || r.karta == null) continue;
      if (typeof r.name !== "string" || !r.name) continue;
      const seat = { realm: r.realm, karta: String(r.karta), name: r.name };
      seats.set(`${seat.realm}\0${seat.karta}\0${seat.name}`, seat);
    } catch {
    }
  }
  return seats.size === 1 ? [...seats.values()][0] : null;
}

// js/cli/onboard-hook.ts
function hookInput() {
  try {
    if (!process.stdin.isTTY) return JSON.parse(readFileSync4(0, "utf8")) ?? {};
  } catch {
  }
  return {};
}
var input = hookInput();
var dir = typeof input.cwd === "string" && input.cwd ? input.cwd : process.env.CLAUDE_PROJECT_DIR || process.cwd();
function line() {
  if (input.source === "compact") {
    const W = words(COMPACTION);
    const seat = seatByDir(authDirFromEnv(), dir, "claude-code");
    if (seat) return W.back(seat.karta, seat.name, seat.realm);
    const { verdict } = repoSigns(dir, "claude-code");
    return verdict === "aligned" || verdict === "partial" ? W.bare() : null;
  }
  return repoSigns(dir, "claude-code").verdict === "invite" ? words(ONBOARD_START).start() : null;
}
try {
  const text2 = line();
  if (text2) process.stdout.write(`${text2}
`);
} catch {
}
process.exitCode = 0;
