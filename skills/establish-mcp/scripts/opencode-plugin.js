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
var defaultAuthDir = () => join(homedir(), ".iskron-bridge");
var authDirFromEnv = () => envOf("ISKRON_BRIDGE_AUTH_DIR")?.trim() || defaultAuthDir();

// js/shared/lang.ts
function langOfUrl(url) {
  try {
    return /\.ai\.?$/i.test(new URL(url).hostname) ? "en" : "ru";
  } catch {
    return "ru";
  }
}
function forcedLang() {
  const v = envOf("ISKRON_BRIDGE_LANG")?.trim().toLowerCase();
  return v === "en" || v === "ru" ? v : null;
}
function resolve2() {
  const forced = forcedLang();
  if (forced) return forced;
  const fromEnv = envOf("ISKRON_BRIDGE_URL")?.trim();
  if (fromEnv) return langOfUrl(fromEnv);
  try {
    const text = readFileSync(join2(authDirFromEnv(), "server"), "utf8").trim();
    if (text) return langOfUrl(text);
  } catch {
  }
  return "ru";
}
var S = scoped(() => ({ current: null }));
var lang = () => S.current ??= resolve2();
var L = (ru, en) => lang() === "en" ? en : ru;

// js/shared/launch.ts
var LINE = /^[ \t]*start\s+(\S+)\s+(\S+)\s+(?:(?:дело|case)\s+)?[№#]\s?(\d+)(?:[ \t]+(?:от|from)[ \t]+(@\S+))?(?=\s|$)/imu;
function parseLaunch(text) {
  const [, realm, karta, no, of] = LINE.exec(text) ?? [];
  return realm && karta && no ? { realm, karta, no, of: of ?? null } : null;
}
function withWord(text, word) {
  const m = LINE.exec(text);
  if (!m) return `${text}
${word}`;
  const nl = text.indexOf("\n", m.index);
  return nl < 0 ? `${text}
${word}` : `${text.slice(0, nl)}
${word}${text.slice(nl)}`;
}
async function enterCase(l, call, satelliteOf, placeName) {
  const room = `#${l.no}`;
  const stand = { realm: l.realm, karta: l.karta };
  if (satelliteOf) stand.satellite_of = satelliteOf;
  try {
    await call("iskron_stand", stand);
  } catch (e) {
    const why = e.message;
    const join7 = `iskron_case(action="join", room="${room}")`;
    return L(
      `Искрон: строка запуска — не встал: ${why}. Встань сам (iskron_stand) и войди в дело №${l.no}: ${join7}.`,
      `Iskron: launch line — not seated: ${why}. Take your seat yourself (iskron_stand) and enter case №${l.no}: ${join7}.`
    );
  }
  const place = placeName() || L("своим местом", "in a seat of its own");
  try {
    await call("iskron_case", { action: "join", realm: l.realm, room });
  } catch (e) {
    const why = e.message;
    return L(
      `Искрон: встал ${place}; в дело №${l.no} не вошёл — ${why}. Место остаётся.`,
      `Iskron: seated ${place}; did not enter case №${l.no} — ${why}. The seat stays.`
    );
  }
  return L(
    `Искрон: встал ${place}, вошёл в дело №${l.no} — первым словом перескажи бриф в деле.`,
    `Iskron: seated ${place}, entered case №${l.no} — retell the brief as your first message in the case.`
  );
}

// js/shared/channel.ts
var SILENT_FLOOR_MS = Number(process.env.ISKRON_CHANNEL_SILENT_FLOOR_MS) || 6e4;
var FLAP_PAUSES_MS = (process.env.ISKRON_CHANNEL_FLAP_MS || "5000,10000,20000,40000,60000").split(",").map(Number).filter((n2) => Number.isFinite(n2) && n2 > 0);
function classifyOrigin(frame, myKarta) {
  const p = frame.provenance ?? {};
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
function isDirectWord(frame) {
  if (frame?.type !== "message") return false;
  const f = frame;
  if (f.room || typeof f.event_kind === "string" && f.event_kind.startsWith("room."))
    return false;
  const p = frame.provenance ?? {};
  if (p.via === "graph" || p.via === "room") return false;
  const origin = frame.origin ?? classifyOrigin(frame);
  if (origin === "platform") return false;
  return origin === "human" || !!p.from_standing || p.from_karta_seq != null;
}

// js/shared/numbering.ts
var numberingOf = (frame) => frame.numbering === "case" ? "case" : "";
var numberedKey = (frame, key) => key && numberingOf(frame) ? `case:${key}` : key;

// js/shared/room-kinds.ts
var WORDS = {
  said: "слово от {author}",
  said_pending: "слово от {author} в полёте — текст придёт следом",
  // Адресное слово не мне (#6081): факт без тела; череда одной пары — одной строкой.
  aside: "{author} → {addressee}: слово [{word}]",
  aside_run: "{author} → {addressee}: {count} (последнее [{word}])",
  // Тело адресного слова не мне без самого слова в пачке — продолжение, не новое слово.
  aside_body: "{author} → {addressee}: текст слова [{word}]",
  word_one: "слово",
  word_few: "слова",
  word_many: "слов",
  body: "текст слова [{refers_to}] от {author}",
  body_aborted: "слово [{refers_to}] оборвано автором",
  body_lapsed: "слово [{refers_to}] оборвано платформой по сроку",
  closing: "ведущий {author} предлагает закрыть дело до {ends_at}{; свидетельства: evidence}",
  closing_may: 'ты можешь возразить — iskron_case(action="object", in_reply_to={entry_id}) (прежнее имя iskron_room)',
  closing_not: "возражать не тебе",
  closed: "дело закрыто: {reason}",
  objection: "{author} возражает против закрытия: {reason}",
  late_objection: "{author} возразил после закрытия",
  // Строка гроссбуха — ровно «[было] [сделал] = вердикт», примечание к не-ok, автор хвостом (норма владельца).
  progress: "[{key}] [{done}] = {verdict}{ — note} · {author}",
  opened: "дело открыл {author}",
  joined: "вошёл {who}",
  left: "вышел {who}{; причина: reason}",
  invite: "{author} зовёт {who} в дело",
  withdraw: "приглашение отозвано, отзывает {author}",
  node: "в деле узел #{seq} {name} ({realm}){; reasoning}",
  node_updated: "узел #{seq} {name} обновлён{; reasoning}",
  node_deleted: "узел #{seq} {name} удалён{; reasoning}",
  node_undeleted: "узел #{seq} {name} восстановлен{; reasoning}",
  link: "дело связано с №{room} ({rel})",
  auto: "запись платформы {code} о деле №{room}",
  unknown: "род {kind} мосту неизвестен",
  // Короткий кадр (frame-text.ts): дело, кто говорит, ответ — без сырого конверта.
  case: "№{room}",
  reply_to: "в ответ на [{id}]",
  stale: "лежалый",
  body_read: "тело: {how}",
  who_human: "человек{ @user}",
  who_role: "роль #{karta}",
  who_sibling: "брат по роли #{karta}",
  who_platform: "платформа — побудка",
  who_graph: "событие графа",
  legacy: "род {kind}{, стопка stack}"
};
var WORDS_EN = {
  said: "message from {author}",
  said_pending: "message from {author} in flight — the text follows",
  aside: "{author} → {addressee}: message [{word}]",
  aside_run: "{author} → {addressee}: {count} (last [{word}])",
  aside_body: "{author} → {addressee}: text of message [{word}]",
  word_one: "message",
  word_few: "messages",
  word_many: "messages",
  body: "text of message [{refers_to}] from {author}",
  body_aborted: "message [{refers_to}] cut off by its author",
  body_lapsed: "message [{refers_to}] cut off by the platform on its deadline",
  closing: "the lead {author} proposes to close the case by {ends_at}{; evidence: evidence}",
  closing_may: 'you may object — iskron_case(action="object", in_reply_to={entry_id}) (former name iskron_room)',
  closing_not: "the objection is not yours to make",
  closed: "case closed: {reason}",
  objection: "{author} objects to closing: {reason}",
  late_objection: "{author} objected after the close",
  progress: "[{key}] [{done}] = {verdict}{ — note} · {author}",
  opened: "case opened by {author}",
  joined: "entered {who}",
  left: "left {who}{; reason: reason}",
  invite: "{author} invites {who} to the case",
  withdraw: "invitation withdrawn by {author}",
  node: "node #{seq} {name} ({realm}) in the case{; reasoning}",
  node_updated: "node #{seq} {name} updated{; reasoning}",
  node_deleted: "node #{seq} {name} deleted{; reasoning}",
  node_undeleted: "node #{seq} {name} restored{; reasoning}",
  link: "case linked to case №{room} ({rel})",
  auto: "platform record {code} about case №{room}",
  unknown: "kind {kind} is unknown to the bridge",
  case: "case №{room}",
  reply_to: "in reply to [{id}]",
  stale: "stale",
  body_read: "body: {how}",
  who_human: "human{ @user}",
  who_role: "role #{karta}",
  who_sibling: "sibling of role #{karta}",
  who_platform: "platform — a wake-up",
  who_graph: "graph event",
  legacy: "kind {kind}{ · stack}"
};
var AUTO_WORDS = {
  child_opened: "дочернее дело №{room} открыто",
  child_closing: "дочернее дело №{room} закрывается",
  child_closed: "дочернее дело №{room} закрыто",
  child_late_objection: "позднее возражение в дочернем деле №{room}"
};
var AUTO_WORDS_EN = {
  child_opened: "child case №{room} opened",
  child_closing: "child case №{room} is closing",
  child_closed: "child case №{room} closed",
  child_late_objection: "late objection in child case №{room}"
};
var REL_WORDS = {
  parent: "дочернее к нему",
  child: "родительское к нему",
  continues: "продолжает его"
};
var REL_WORDS_EN = {
  parent: "its child",
  child: "its parent",
  continues: "continues it"
};
var VERDICT_WORDS = {
  ok: "ok",
  partial: "частично",
  bad: "slop"
};
var VERDICT_WORDS_EN = {
  ok: "ok",
  partial: "partial",
  bad: "slop"
};
var words = () => lang() === "en" ? WORDS_EN : WORDS;
var phrase = (key, values = {}) => fill(words()[key] ?? "", values);
var autoWords = () => lang() === "en" ? AUTO_WORDS_EN : AUTO_WORDS;
var relWords = () => lang() === "en" ? REL_WORDS_EN : REL_WORDS;
var NODE_OPS = {
  updated: "node_updated",
  deleted: "node_deleted",
  undeleted: "node_undeleted"
};
var RULES = {
  said: "stack",
  body: "stack",
  closing: "interrupt",
  closed: "interrupt",
  objection: "interrupt",
  late_objection: "interrupt",
  invite: "mine",
  progress: "batch",
  opened: "batch",
  joined: "batch",
  left: "batch",
  withdraw: "batch",
  node: "batch",
  link: "batch",
  // Запись платформы о связанном деле: признака прерывания у неё нет (#4925).
  auto: "batch"
};
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var str = (v) => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
function authorOf(author) {
  const a = obj(author);
  const name = str(a.name);
  const standing = str(a.standing);
  if (name) return standing ? `${name} (${standing})` : name;
  if (standing) return standing;
  return a.kind === "platform" ? L("платформа", "platform") : "?";
}
var after = (key, prefix) => key.startsWith(prefix) ? key.slice(prefix.length) : key;
function fill(template, v) {
  return template.replace(/\{([^\w{}]*)(\w+)\}/g, (_m, sep, name) => {
    const x = str(v[name]);
    if (sep) return x ? sep + x : "";
    return x || "?";
  });
}
function roomOf(v) {
  const r = obj(v);
  return str(r.seq) || str(r.id) || str(v);
}
var mineOf = (frame) => [str(frame.to_standing_id), str(frame.to_standing)].filter(Boolean);
function myRole(frame, fields) {
  const ka = obj(fields.karta);
  const seq = str(ka.seq);
  if (!seq || seq !== str(frame.karta_seq)) return false;
  const theirs = str(ka.realm);
  const mine = str(frame.realm) || str(obj(frame.room).realm);
  return !theirs || !mine || theirs === mine;
}
function whoOf(fields) {
  const st = obj(fields.standing);
  const ka = obj(fields.karta);
  const name = str(st.name) || str(ka.name);
  const addr = str(st.standing);
  return name && addr ? `${name} (${addr})` : name || addr;
}
function addresseeOf(v) {
  if (typeof v === "string") return v ? { addr: [v], label: v } : null;
  const o = obj(v);
  const handle = str(o.handle).replace(/^@/, "");
  const standing = str(o.standing) || (handle ? `@${handle}${str(o.name) ? `:${str(o.name)}` : ""}` : "");
  const id = str(o.id);
  const name = str(o.standing) ? str(o.name) : "";
  const label = name && standing ? `${name} (${standing})` : standing || str(o.name) || id;
  const addr = [standing, id].filter(Boolean);
  return addr.length ? { addr, label } : null;
}
function wordsCount(n2) {
  const W = words();
  const m10 = n2 % 10;
  const m100 = n2 % 100;
  const w = lang() === "en" ? n2 === 1 ? W.word_one : W.word_many : m10 === 1 && m100 !== 11 ? W.word_one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? W.word_few : W.word_many;
  return `${n2} ${w}`;
}
function roomKind(frame) {
  if (!frame || typeof frame !== "object") return null;
  const f = frame;
  const ek = f.event_kind;
  if (typeof ek !== "string" || !ek.startsWith("room.")) return null;
  const kind = ek.slice(5);
  const line = obj(f.line);
  const fields = obj(line.fields);
  const key = str(line.key);
  const mine = mineOf(f);
  const node = obj(fields.node);
  const byWhom = authorOf(
    kind === "body" && Object.keys(obj(f.in_reply_to_from)).length ? f.in_reply_to_from : line.author
  );
  const values = {
    kind,
    author: byWhom,
    key,
    done: line.done,
    verdict: (lang() === "en" ? VERDICT_WORDS_EN : VERDICT_WORDS)[str(line.verdict)] ?? line.verdict,
    note: line.note,
    ends_at: fields.ends_at,
    evidence: Array.isArray(fields.evidence) ? fields.evidence.map(str).join(", ") : "",
    entry_id: line.entry_id ?? f.entry_id,
    // Слово, которому body несёт текст или обрыв: refers_to строки, иначе in_reply_to конверта.
    refers_to: str(line.refers_to) || str(f.in_reply_to) || str(obj(f.word).entry_id),
    reason: fields.reason,
    target: after(key, "invite:"),
    // Ключ несёт id; имя приглашённого — в полях строки (наблюдено на бою: standing/karta с name).
    // Вошедший и ушедший — место fields.standing (уход по сроку пишет платформа, api 0.89.6), иначе автор.
    who: kind === "joined" || kind === "left" ? whoOf({ standing: fields.standing }) || byWhom : whoOf(fields) || after(key, "invite:"),
    room: roomOf(fields.room) || after(key, "link:"),
    rel: relWords()[str(fields.rel)] ?? fields.rel,
    code: fields.code,
    seq: node.seq,
    name: node.name,
    realm: node.realm,
    // reasoning дельты узла — тело записи node (line.done, body кадра), не поле (слово api, #6070).
    reasoning: kind === "node" ? line.done || f.body : void 0
  };
  const rule = RULES[kind];
  const author = str(values.author);
  if (!rule)
    return {
      kind,
      rule: "batch",
      words: fill(words().unknown, values),
      author,
      phase: null,
      known: false
    };
  const W = words();
  const word = kind === "said" || kind === "body";
  const withheld = word && f.body_withheld === true;
  const to = word ? addresseeOf(f.addressee) ?? (withheld ? { addr: ["?"], label: "?" } : null) : null;
  const addresseeLeft = f.addressee_left === true || fields.addressee_left === true;
  if (to && !addresseeLeft && (withheld || mine.length && !to.addr.some((a) => mine.includes(a)))) {
    const counts = kind === "said";
    const pair = JSON.stringify([roomOf(f.room), author, to.addr[0]]);
    const id = counts ? values.entry_id : values.refers_to;
    const run = (n2) => fill(n2 === 0 ? W.aside_body : n2 > 1 ? W.aside_run : W.aside, {
      ...values,
      word: id,
      addressee: to.label,
      count: wordsCount(n2)
    });
    const aside = { pair, counts, run };
    const words2 = run(counts ? 1 : 0);
    return { kind, rule: "batch", words: words2, author, phase: null, known: true, aside };
  }
  const pending = kind === "said" && f.body_pending === true && !str(f.body) && !str(line.done);
  const aborted = kind === "body" && fields.aborted === true;
  const wordsOf = pending ? W.said_pending : aborted ? obj(line.author).kind === "platform" ? W.body_lapsed : W.body_aborted : kind === "auto" ? autoWords()[str(values.code)] ?? W.auto : (
    // op узла (bound | updated | deleted | undeleted): без op и bound — прежнее слово.
    kind === "node" && NODE_OPS[str(fields.op)] ? W[NODE_OPS[str(fields.op)]] : W[kind]
  );
  let text = fill(wordsOf ?? "", values);
  if (kind === "closing") {
    const may = Array.isArray(fields.may_object) ? fields.may_object.map((m) => typeof m === "string" ? m : str(obj(m).id)) : [];
    const myId = str(f.to_standing_id);
    const mayI = !!myId && may.includes(myId);
    text += "; " + fill(mayI ? W.closing_may : W.closing_not, values);
  }
  const stack = rule === "stack" ? (
    // Стопка решает у said и body; слово без стопки — прежним путём, вставкой.
    f.stack === "defer" ? "batch" : "interrupt"
  ) : rule === "mine" ? mine.includes(str(values.target)) || myRole(f, fields) ? "interrupt" : "batch" : rule;
  const phase = pending ? "pending" : aborted ? "aborted" : null;
  return { kind, rule: phase ? "batch" : stack, words: text, author, phase, known: true };
}
var byKind = (frame) => roomKind(frame) !== null;
var stackOf = (frame) => roomKind(frame)?.rule ?? (frame?.stack === "defer" ? "batch" : "interrupt");

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
function rememberWord(key) {
  addressedWords.add(key);
  for (const old of addressedWords) {
    if (addressedWords.size <= WORDS_KEPT) break;
    addressedWords.delete(old);
  }
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
  if (rk?.aside) return false;
  const mine = mineOf(f);
  const hit = (v) => {
    const a = addresseeOf(v);
    return !!a && mine.length > 0 && a.addr.some((x) => mine.includes(x));
  };
  if (rk?.kind === "body") {
    const word = obj(f.word);
    if (f.addressed === true || hit(f.addressee) || str(obj(obj(word.line).fields).kind) === "important" || addressedWords.has(wordKeyOf(frame)))
      return true;
  } else if (
    // Слово мне, ответ на мою запись (#5954), помеченное важным: род слова
    // important на конверте или в полях строки. Слово в полёте запоминается —
    // его тело придёт второй фазой без этих признаков.
    hit(f.addressee) || hit(f.in_reply_to_from) || str(f.said) === "important" || str(fields.kind) === "important"
  ) {
    if (rk?.phase === "pending") rememberWord(wordKeyOf(frame));
    return true;
  }
  if (rk?.kind === "invite" || rk?.kind === "withdraw") {
    if (mine.includes(after(str(line.key), "invite:"))) return true;
    if (rk.kind === "invite" && myRole(f, fields)) return true;
  }
  if (rk && LOUD_KINDS.has(rk.kind)) return true;
  return (frame.origin ?? classifyOrigin(frame, str(f.karta_seq) || void 0)) === "human";
}

// js/shared/clients.ts
var OPENCODE_CLIENT = "opencode-iskron";
var HARNESS_VERSION_ENV = "ISKRON_HARNESS_VERSION";
var SKILLS_ROOT_ENV = "ISKRON_SKILLS_ROOT";

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "7.1.0";
function buildOf(selfUrl) {
  try {
    const src = readFileSync2(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}
function buildOfFile(path) {
  try {
    const src = readFileSync2(path);
    const v = versionIn(src.toString("utf8")) ?? "?";
    return `v${v}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return null;
  }
}
function versionIn(text) {
  const m = /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1] : null;
}

// js/bridge/build.ts
var BUILD = buildOf(import.meta.url);

// js/bridge/streams.ts
var out = scoped(() => ({ stream: null }));

// js/bridge/config.ts
var DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";
var ENGLISH_SERVER_URL = "https://mcp.iskron.ai/";
var PRODUCTION_URLS = new Set([DEFAULT_SERVER_URL, ENGLISH_SERVER_URL].map(strip));
function strip(url) {
  return url.replace(/\/+$/, "");
}
var cfgSlot = scoped(() => ({ cfg: null }));
var CFG = new Proxy({}, {
  get: (_, k) => cfgSlot.cfg ? Reflect.get(cfgSlot.cfg, k) : void 0,
  has: (_, k) => !!cfgSlot.cfg && Reflect.has(cfgSlot.cfg, k)
});

// js/bridge/oauth/discovery.ts
var REGISTRATION_REUSE_MS = 45 * 6e4;

// js/bridge/oauth/pacing.ts
var pauses = (v, fallback) => (v || fallback).split(",").map(Number).filter((n2) => Number.isFinite(n2) && n2 >= 0);
var DEAD_RECHECK_MS = pauses(process.env.ISKRON_BRIDGE_DEAD_RECHECK_MS, "1000,2000");
var IN_CALL_WAIT_MS = Number(process.env.ISKRON_BRIDGE_IN_CALL_WAIT_MS) || 1e4;
var ORPHAN_FLOW_MS = Number(process.env.ISKRON_BRIDGE_ORPHAN_FLOW_MS) || 5 * 6e4;

// js/bridge/oauth/device.ts
var SLOW_DOWN_MS = Number(process.env.ISKRON_BRIDGE_DEVICE_SLOW_DOWN_MS) || 5e3;
var REISSUE_PAUSE_MS = Number(process.env.ISKRON_BRIDGE_DEVICE_REISSUE_MS) || 3e4;
var never = new Promise(() => {
});

// js/bridge/oauth/flow.ts
var CLAIM_WAIT_MS = Number(process.env.ISKRON_BRIDGE_CLAIM_WAIT_MS) || 15e3;
var LANDED_POLL_MS = Number(process.env.ISKRON_BRIDGE_LANDED_POLL_MS) || 2e3;
var RELEASE_GAP_MS = Number(process.env.ISKRON_BRIDGE_RELEASE_GAP_MS) || 0;

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
var reinit = scoped(() => ({ inFlight: null }));

// js/shared/frame-text.ts
var rec = (v) => v && typeof v === "object" ? v : {};
var idOf = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
var ZACHIN = 40;
function casesOf(frames) {
  const by = /* @__PURE__ */ new Map();
  for (const f of frames) {
    const key = caseKey(f) || idOf(f.id) || "?";
    const got = by.get(key);
    if (got) got.push(f);
    else by.set(key, [f]);
  }
  return [...by.values()];
}
function caseOf(frame) {
  const f = frame;
  const room = rec(f.room);
  const n2 = idOf(room.seq) || idOf(room.id);
  if (!n2) return null;
  const z = typeof room.zachin === "string" ? [...room.zachin.trim()] : [];
  const zachin = z.length > ZACHIN ? z.slice(0, ZACHIN).join("") + "…" : z.join("");
  const realm = idOf(room.realm) || idOf(f.realm);
  return { room: n2, zachin, realm };
}
var caseKey = (frame) => caseOf(frame)?.room ?? "";
function caseHead(frame, withZachin) {
  const c = caseOf(frame);
  if (!c) return "";
  const no = phrase("case", { room: c.room });
  return withZachin && c.zachin ? `${no} «${c.zachin}»` : no;
}
function whoOf2(frame, withPlace) {
  const p = frame.provenance ?? {};
  const origin = frame.origin ?? classifyOrigin(frame);
  if (origin === "platform") return phrase("who_platform");
  if (p.via === "graph" && p.from_karta_seq == null && !p.from_standing) return phrase("who_graph");
  const place = withPlace && p.from_standing ? ` (${p.from_standing})` : "";
  if (origin === "human") return phrase("who_human", { user: p.user }) + place;
  const karta = p.from_karta_seq;
  if (karta == null) return p.from_standing ?? "";
  return phrase(origin === "sibling" ? "who_sibling" : "who_role", { karta }) + place;
}
function textOf(frame) {
  if (roomKind(frame)?.aside) return "";
  const b = frame.body;
  return typeof b === "string" ? b : b === void 0 ? "" : JSON.stringify(b);
}
function tail(frame, withReply) {
  const f = frame;
  const parts = [];
  const to = idOf(f.in_reply_to) || idOf(frame.provenance?.in_reply_to);
  if (withReply && to) parts.push(phrase("reply_to", { id: to }));
  if (frame.stale === true) parts.push(phrase("stale"));
  if (typeof frame.body_read === "string" && frame.body_read !== "history")
    parts.push(phrase("body_read", { how: frame.body_read }));
  return parts.length ? `, ${parts.join(", ")}` : "";
}
function frameToText(frame, raw) {
  if (!frame) return raw;
  const f = frame;
  const origin = frame.origin ?? classifyOrigin(frame);
  const text = textOf(frame);
  const c = caseOf(frame);
  if (c) {
    if (!addressedToMine(frame)) return caseCountLine([frame]);
    const rk = roomKind(frame);
    const line = rec(f.line);
    const entry = idOf(f.entry_id) || idOf(line.entry_id);
    const words2 = rk ? rk.words : phrase("legacy", { kind: f.kind, stack: typeof f.stack === "string" ? f.stack : "" });
    const author = rk?.author && !words2.includes(rk.author) ? rk.author : "";
    const who = origin === "platform" ? "" : whoOf2(frame, false);
    const by = [author, who].filter(Boolean).join(", ");
    const withReply = rk?.kind !== "body";
    const head = `${caseHead(frame, true)}${entry ? ` [${entry}]` : ""} ${words2}${by ? ` — ${by}` : ""}${tail(frame, withReply)}`;
    const lines2 = [head];
    if (text && !words2.includes(text.trim())) lines2.push(text);
    return lines2.join("\n");
  }
  const lines = [`${whoOf2(frame, true) || "?"}${tail(frame, true)}`];
  if (text) lines.push(text);
  return lines.join("\n");
}
var BATCH_TEXT = 160;
function batchLine(frame, run, withZachin = true) {
  const f = frame;
  const rk = roomKind(frame);
  const head = caseHead(frame, withZachin);
  const pre = head ? `${head} ` : "";
  if (rk?.aside) return pre + (run === void 0 ? rk.words : rk.aside.run(run));
  const line = rec(f.line);
  const e = f.entry_id ?? line.entry_id ?? f.id;
  const entry = typeof e === "number" || typeof e === "string" ? e : "?";
  const words2 = rk?.words ?? `${L("кадр", "frame")} ${typeof f.id === "string" ? f.id : "?"}`;
  const author = rk?.author && !words2.includes(rk.author) ? ` — ${rk.author}` : "";
  const flat = [...textOf(frame).replace(/\s+/g, " ").trim()];
  const text = flat.length > BATCH_TEXT ? flat.slice(0, BATCH_TEXT).join("") + "…" : flat.join("");
  const dup = !!text && words2.includes(text);
  return `${pre}[${entry}] ${words2}${author}${tail(frame, rk?.kind !== "body")}${text && !dup ? `: ${text}` : ""}`;
}
function batchLines(frames) {
  const seen = /* @__PURE__ */ new Set();
  return frames.flatMap((f) => {
    if (!addressedToMine(f)) return [];
    const key = caseKey(f);
    const first = !seen.has(key);
    seen.add(key);
    return [batchLine(f, void 0, first)];
  });
}
function caseCountLine(frames) {
  const c = frames.length ? caseOf(frames[0]) : null;
  if (!c) return "";
  const mineN = frames.filter((f) => addressedToMine(f)).length;
  const head = caseHead(frames[0], true);
  const yours = mineN ? L(` — адресованные строками ниже; `, ` — yours in the lines below; `) : L(` — адресованных месту нет; `, ` — none of them yours; `);
  return L(
    `${head}: записей ${frames.length}, тебе ${mineN}`,
    `${head}: ${frames.length} records, yours ${mineN}`
  ) + yours + batchPointer(frames) + ".";
}
function caseCountLines(frames) {
  return casesOf(frames).map(caseCountLine).filter(Boolean);
}
function batchHead(frames) {
  return caseCountLines(frames).join("\n");
}
function batchPointer(frames) {
  const since = /* @__PURE__ */ new Map();
  for (const frame of frames) {
    const f = frame;
    const room = f.room ?? {};
    const line = f.line ?? {};
    const n2 = room.seq ?? room.id;
    const e = Number(f.entry_id ?? line.entry_id);
    if (typeof n2 !== "number" && typeof n2 !== "string" || !Number.isFinite(e)) continue;
    const realm = room.realm ?? f.realm;
    const args = (typeof realm === "string" && realm ? `realm="${realm}", ` : "") + `action="history", room=${typeof n2 === "number" ? String(n2) : JSON.stringify(n2)}`;
    since.set(args, Math.min(since.get(args) ?? e, e));
  }
  const whole = L("целиком — ", "in full — ");
  if (!since.size) return `${whole}iskron_channel(action="history")`;
  return whole + [...since].map(([args, e]) => `iskron_case(${args}, since=${e - 1})`).join("; ");
}

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;

// js/bridge/roomstack.ts
var ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 6e4;

// js/bridge/holdrecord.ts
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;
var H = scoped(() => ({ session: null }));

// js/bridge/sweep.ts
var SEEN_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;

// js/bridge/holdstate.ts
var H2 = scoped(() => ({
  /** Каталог сессии, из которого занимается место (cwd в iskron_stand), — в запись держания, для возврата по каталогу (resume.ts). */
  standCwd: null,
  holder: null,
  /** дверь основного места — того, ради которого взят сокет */
  door: null,
  currentKey: null,
  currentUrl: null,
  currentStatusUrl: null,
  /** ключ места, отнятого у этого моста закрытием 4000 */
  evictedKey: null,
  /** прицепившийся после — узнаёт, а не молчит */
  evictedEvent: null,
  /** ушёл с места: сокет службы закрыт, ключ и адреса целы (leave.ts) */
  parked: false,
  attachHooks: [],
  helloWaiters: /* @__PURE__ */ new Set(),
  /** возвратов с диска в полёте: мёртвый токен при них — протухшая запись, не тревога */
  resuming: 0,
  /** своё снятие в полёте (absorb.ts): закрытие 4001 обгонит ответ revoke */
  revokingOwn: false,
  /** демон гаснет, а тонкий мост этой сессии жив: он вернёт место новому демону (daemon.ts, #6485) */
  handingOver: null
}));

// js/bridge/realms.ts
var aliases = scoped(() => /* @__PURE__ */ new Map());
var R = scoped(() => ({ listing: null }));

// js/bridge/places.ts
var extras = scoped(() => /* @__PURE__ */ new Map());

// js/bridge/spool.ts
var HANDOFF_MS = Number(process.env.ISKRON_BRIDGE_DAEMON_HANDOFF_MS) || 12e3;
var DRAIN_MS = HANDOFF_MS + 5e3;

// js/shared/bridge-client.ts
import { spawn } from "node:child_process";
import { basename } from "node:path";
function bridgeRuntime() {
  const own = process.env.ISKRON_NODE?.trim();
  if (own) return { bin: own, env: process.env };
  if (process.versions?.bun)
    return { bin: process.execPath, env: { ...process.env, BUN_BE_BUN: "1" } };
  if (!/^node/i.test(basename(process.execPath))) return { bin: "node", env: process.env };
  return { bin: process.execPath, env: process.env };
}
var SERVICE_ID = "iskron-service-";
var STOP_GRACE_MS = 5e3;
var Bridge = class {
  proc = null;
  buf = "";
  nextId = 1;
  pending = /* @__PURE__ */ new Map();
  tail = [];
  dead = null;
  bin;
  onLog;
  onNotification;
  onDie;
  args;
  constructor(bin, onLog, onNotification = () => {
  }, onDie = () => {
  }, args = []) {
    this.bin = bin;
    this.onLog = onLog;
    this.onNotification = onNotification;
    this.onDie = onDie;
    this.args = args;
  }
  /** Мост вышел или не запустился — вызовы к нему отвергаются этим отказом. */
  get failure() {
    return this.dead;
  }
  /** env — поверх рантайма: версия хоста для attrs.harness_version (#6226). */
  start(env = {}) {
    const rt = bridgeRuntime();
    const proc = spawn(rt.bin, [this.bin, ...this.args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...rt.env, ...env }
    });
    this.proc = proc;
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk) => this.feed(chunk));
    proc.stderr?.setEncoding("utf8");
    let errBuf = "";
    proc.stderr?.on("data", (chunk) => {
      errBuf += chunk;
      const lines = errBuf.split("\n");
      errBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        this.tail.push(line);
        if (this.tail.length > 20) this.tail.shift();
        this.onLog(line);
      }
    });
    proc.on("error", (e) => this.die(new Error(`мост не запустился: ${e.message}`)));
    proc.on(
      "exit",
      (code, signal) => this.die(new Error(`мост вышел (code=${code}, signal=${signal})${this.why()}`))
    );
  }
  why() {
    return this.tail.length ? `; последнее от моста: ${this.tail.slice(-3).join(" | ")}` : "";
  }
  die(e) {
    if (this.dead) return;
    this.dead = e;
    for (const [, p] of this.pending) p.reject(e);
    this.pending.clear();
    try {
      this.onDie(e);
    } catch {
    }
  }
  feed(chunk) {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.replace(/\r$/, "").trim();
      if (!trimmed) continue;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const service = typeof msg?.id === "string" && msg.id.startsWith(SERVICE_ID);
      if (typeof msg?.id !== "number" && !service) {
        if (typeof msg?.method === "string") this.onNotification(msg.method, msg.params);
        continue;
      }
      const waiter = this.pending.get(msg.id);
      if (!waiter) continue;
      this.pending.delete(msg.id);
      if (msg.error)
        waiter.reject(
          Object.assign(new Error(msg.error.message || JSON.stringify(msg.error)), {
            code: msg.error.code
          })
        );
      else waiter.resolve(msg.result);
    }
  }
  notify(method, params) {
    if (this.dead || !this.proc?.stdin?.writable) return;
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  request(method, params, opts = {}) {
    if (this.dead) return Promise.reject(this.dead);
    const id = opts.service ? `${SERVICE_ID}${this.nextId++}` : this.nextId++;
    return new Promise((res, rej) => {
      let timer = null;
      const settle = (fn) => (v) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      const resolve4 = settle(res);
      const reject = settle(rej);
      function onAbort() {
        reject(new Error("вызов отменён"));
      }
      this.pending.set(id, { resolve: resolve4, reject });
      if (opts.signal) {
        if (opts.signal.aborted) return onAbort();
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      if (opts.timeoutMs) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${method}: нет ответа за ${opts.timeoutMs} мс${this.why()}`));
        }, opts.timeoutMs);
        timer.unref?.();
      }
      if (!this.proc?.stdin?.writable) return reject(new Error("мост не принимает запись"));
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  stop() {
    this.die(new Error("сессия закрыта"));
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.killed || proc.exitCode !== null) return;
    try {
      proc.stdin?.end();
      proc.kill("SIGTERM");
      const hard = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
        }
      }, STOP_GRACE_MS);
      hard.unref?.();
      proc.on("exit", () => clearTimeout(hard));
    } catch {
    }
  }
};
function toParameters(inputSchema) {
  const schema = inputSchema && typeof inputSchema === "object" ? { ...inputSchema } : { type: "object", properties: {} };
  delete schema.$schema;
  if (!schema.type) schema.type = "object";
  if (schema.type === "object" && !schema.properties) schema.properties = {};
  return schema;
}
function snippet(description) {
  const first = (description || "").split("\n").find((l) => l.trim()) ?? "";
  const cut = first.trim().split(/(?<=[.。!?])\s/)[0] ?? first.trim();
  return cut.length > 160 ? cut.slice(0, 157) + "…" : cut;
}
function resultToContent(result) {
  const blocks = Array.isArray(result?.content) ? result.content : [];
  const out2 = blocks.map((b) => {
    if (b?.type === "text") return { type: "text", text: String(b.text ?? "") };
    if (b?.type === "image" && b.data) {
      return {
        type: "image",
        data: String(b.data),
        mimeType: String(b.mimeType ?? "image/png")
      };
    }
    return { type: "text", text: JSON.stringify(b) };
  });
  if (out2.length) return out2;
  const structured = result?.structuredContent;
  return [
    { type: "text", text: structured ? JSON.stringify(structured) : "(пустой ответ)" }
  ];
}

// js/opencode/bridge-io.ts
import {
  accessSync,
  constants,
  mkdirSync,
  readdirSync as readdirSync2,
  readFileSync as readFileSync3,
  statSync as statSync2,
  writeFileSync
} from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join5, resolve as resolve3 } from "node:path";

// js/shared/home.ts
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
var homeBridgePath = () => join3(homedir2(), ".iskron-bridge", "iskron-bridge.mjs");

// js/opencode/devicewait.ts
import { readdirSync, statSync } from "node:fs";
import { join as join4 } from "node:path";
var RENEW_BEFORE_MS = 6e4;
var UNTIL = /valid until (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC/;
function deviceOf(message) {
  const link = /from another device: (\S+)/.exec(message)?.[1];
  if (!link) return /no sign-in by code: (.+?) — or give the bridge/.exec(message)?.[1] ?? null;
  const until = UNTIL.exec(message)?.[1];
  return until ? `${link} (код действует до ${until} UTC)` : link;
}
function loginStamp(dir) {
  try {
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".auth-pending") || f.endsWith(".auth-pending.device")
    );
    if (!files.some((f) => f.endsWith(".auth-pending"))) return null;
    return files.map((f) => `${f}:${statSync(join4(dir, f)).mtimeMs}`).sort().join("|");
  } catch {
    return null;
  }
}
function codeWatch(dir, message) {
  const before = loginStamp(dir);
  const until = UNTIL.exec(message)?.[1];
  const end = until ? Date.parse(`${until.replace(" ", "T")}Z`) : NaN;
  return {
    moved: () => {
      const now2 = loginStamp(dir);
      if (now2 !== null && now2 !== before) return true;
      return now2 !== null && end - Date.now() < RENEW_BEFORE_MS;
    }
  };
}

// js/opencode/bridge-io.ts
var HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 6e5);
var AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 2e3);
var retryPause = (n2) => Math.min(AUTH_POLL_MS * 2 ** n2, 6e4);
var AUTH_PENDING = /authorization required/i;
var PROTOCOL = "2025-06-18";
function findBridge() {
  const tried = [];
  const env = process.env.ISKRON_BRIDGE_PATH?.trim();
  if (env) tried.push(resolve3(env));
  tried.push(homeBridgePath());
  for (const candidate of tried) {
    try {
      accessSync(candidate, constants.R_OK);
      return { path: candidate, tried };
    } catch {
    }
  }
  return { path: null, tried };
}
function buildsLine(bridgePath, pluginUrl) {
  return `сборка: мост ${buildOfFile(bridgePath) ?? "не читается"}, плагин ${buildOf(pluginUrl)}`;
}
function authDir() {
  return process.env.ISKRON_BRIDGE_AUTH_DIR || join5(homedir3(), ".iskron-bridge");
}
function cachePath() {
  return join5(authDir(), "opencode-tools.json");
}
function grantStamp() {
  const dir = authDir();
  try {
    return readdirSync2(dir).filter((f) => f.endsWith(".json") && f !== "opencode-tools.json").map((f) => `${f}:${statSync2(join5(dir, f)).mtimeMs}`).sort().join("|");
  } catch {
    return "";
  }
}
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
function readCache() {
  try {
    const list = JSON.parse(readFileSync3(cachePath(), "utf8"));
    return Array.isArray(list) && list.length ? list : null;
  } catch {
    return null;
  }
}
function writeCache(tools) {
  try {
    mkdirSync(join5(cachePath(), ".."), { recursive: true, mode: 448 });
    writeFileSync(cachePath(), JSON.stringify(tools), { mode: 384 });
  } catch {
  }
}
function loginUrlOf(message) {
  return /open in a browser: (\S+)/.exec(message)?.[1] ?? null;
}
async function handshake(b, onLogin, onReady) {
  const deadline = Date.now() + HANDSHAKE_MS;
  for (; ; ) {
    const stamp = grantStamp();
    try {
      await b.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: OPENCODE_CLIENT, version: "1" }
        },
        { timeoutMs: Math.max(1, deadline - Date.now()) }
      );
      break;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!AUTH_PENDING.test(message)) throw e;
      onLogin(loginUrlOf(message), deviceOf(message));
      const code = codeWatch(authDir(), message);
      while (grantStamp() === stamp) {
        if (Date.now() + AUTH_POLL_MS > deadline) throw e;
        await sleep2(AUTH_POLL_MS);
        if (code.moved()) break;
      }
    }
  }
  onReady();
  b.notify("notifications/initialized");
}
async function listTools(b) {
  const tools = [];
  let cursor;
  do {
    const page = await b.request("tools/list", cursor ? { cursor } : {}, {
      timeoutMs: HANDSHAKE_MS
    });
    for (const t of page?.tools ?? []) tools.push(t);
    cursor = page?.nextCursor;
  } while (cursor);
  return tools;
}
function textOf2(result) {
  return resultToContent(result).map((c) => c.type === "text" ? c.text : "[image]").join("\n");
}
async function refreshToolList(b, state2, reload, say, live) {
  try {
    const list = await listTools(b);
    if (!live() || JSON.stringify(list) === JSON.stringify(state2.listed)) return;
    state2.listed = list;
    state2.source = "с сервера";
    writeCache(list);
    await reload();
    say(`Искрон: сервер сменил тулы — в сессии теперь ${list.length}.`, "info");
  } catch (e) {
    if (!live()) return;
    say(
      `Искрон: список тулов после смены на сервере не перечитан — ${e.message}`,
      "warning"
    );
  }
}

// js/opencode/host.ts
import { dirname } from "node:path";
async function hostEnvOf(ctx) {
  const env = {};
  const v = ctx.app?.version;
  if (typeof v === "string" && v.trim()) env[HARNESS_VERSION_ENV] = v.trim();
  try {
    const res = await ctx.skill.list();
    const list = Array.isArray(res) ? res : res?.data ?? [];
    const own = list.find((s) => s?.id === "establish-mcp");
    if (typeof own?.path === "string" && own.path)
      env[SKILLS_ROOT_ENV] = dirname(dirname(own.path));
  } catch {
  }
  return env;
}
async function sessionDirectory(ctx, sessionID) {
  try {
    const res = await ctx.session.get({ sessionID });
    const dir = res?.location?.directory ?? res?.data?.location?.directory;
    return typeof dir === "string" && dir.trim() ? dir : null;
  } catch {
    return null;
  }
}

// js/opencode/keep.ts
import { mkdirSync as mkdirSync2, readdirSync as readdirSync3, readFileSync as readFileSync4, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join6 } from "node:path";
var WATCH_MS = Number(process.env.ISKRON_BRIDGE_WATCH_MS || 5 * 6e4);
var MARKER_PREFIX = "opencode-lost";
function writeLostMarker(authDir2, slots) {
  const entries = [...slots].filter((s) => s.holding && s.session).map((s) => ({ session: s.session, dir: s.dir, key: s.key, child: !!s.child }));
  if (!entries.length) return;
  try {
    mkdirSync2(authDir2, { recursive: true, mode: 448 });
    const lost = { at: (/* @__PURE__ */ new Date()).toISOString(), entries };
    const name = `${MARKER_PREFIX}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync2(join6(authDir2, name), JSON.stringify(lost), { mode: 384 });
  } catch {
  }
}
function takeLostMarker(authDir2) {
  const entries = [];
  let at = "";
  let files;
  try {
    files = readdirSync3(authDir2).filter((f) => f.startsWith(MARKER_PREFIX) && f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of files) {
    let text;
    try {
      text = readFileSync4(join6(authDir2, f), "utf8");
      unlinkSync(join6(authDir2, f));
    } catch {
      continue;
    }
    try {
      const lost = JSON.parse(text);
      if (lost?.at > at) at = lost.at;
      for (const e of lost?.entries ?? [])
        entries.push({
          session: e.session,
          dir: e.dir ?? null,
          key: e.key ?? null,
          child: !!e.child
        });
    } catch {
    }
  }
  if (!entries.length) return null;
  const when = new Date(at);
  const hhmm2 = Number.isNaN(when.getTime()) ? at : `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const where = entries.map((e) => e.key ?? e.dir ?? e.session).join(", ");
  return {
    text: `Искрон: слух был потерян в ${hhmm2} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand.`,
    entries
  };
}
function resumedWord(key, others) {
  const rest = Array.isArray(others) ? others.filter((k) => typeof k === "string") : [];
  return `Искрон: мост поднялся и сам вернул место ${key} — по своей записи держания (каталог сессии либо ключ прежнего места), без твоего хода. ` + (rest.length ? `В том же каталоге записи и других мест: ${rest.join(", ")} — каталог их не различает; возврат взял место, на котором стояла эта сессия. ` : "") + 'Сверь имя с выведенным для этой сессии: чужое — отпусти его iskron_channel(action="leave") (канал цел; revoke места, основавшего канал, платформа отвергает) и займи своё одним iskron_stand; запись, уже ушедшую этим ходом, проверь по автору в истории узла — слово под чужим именем ляжет другому месту, а мост ответит успехом.';
}
function createKeeper(doors) {
  const roots = /* @__PURE__ */ new Set();
  const hints = /* @__PURE__ */ new Map();
  const marked = /* @__PURE__ */ new Map();
  const retrying = /* @__PURE__ */ new Map();
  let stopped = false;
  function notBack(root, mark, why) {
    const place = mark.key ?? mark.dir ?? root;
    roots.add(root);
    retrying.set(root, place);
    doors.tell(
      root,
      `Искрон: место ${place} с диска не вернулось: ${why}. Сторож слуха повторит возврат один раз; не ждёшь — iskron_stand.`
    );
  }
  function selector(slot) {
    const session = slot.session ? { session: slot.session } : {};
    if (slot.child) return slot.key ? { key: slot.key, ...session } : session;
    const key = slot.key ?? (slot.session ? hints.get(slot.session) : void 0);
    return { ...key ? { key } : {}, ...slot.dir ? { cwd: slot.dir } : {}, ...session };
  }
  async function resume(slot, root) {
    const mark = slot.child ? void 0 : marked.get(root);
    marked.delete(root);
    try {
      await doors.ready(slot);
      slot.dir ??= mark?.dir ?? await doors.directoryOf(root);
      if (stopped) return;
      if (!slot.dir && !slot.key || slot.child && !slot.key) {
        if (mark) notBack(root, mark, "ни ключа места, ни каталога сессии");
        return;
      }
      const r = await slot.bridge.request("iskron/resume", selector(slot), {
        timeoutMs: 3e4
      });
      if (!r?.resumed) {
        if (mark) notBack(root, mark, typeof r?.word === "string" ? r.word : "мост не ответил");
        else if (Array.isArray(r?.legacy) && r.legacy.length && typeof r.word === "string")
          doors.tell(root, `Искрон: ${r.word}.`, slot.child);
        return;
      }
      slot.holding = true;
      slot.stood = true;
      if (typeof r.key === "string") slot.key = r.key;
      roots.add(root);
      doors.say(`Искрон: сессия ${root} — ${r.word}`, "info");
      if (typeof r.key === "string") doors.tell(root, resumedWord(r.key, r.others), slot.child);
    } catch (e) {
      doors.say(
        `Искрон: возврат места сессии ${root} не удался — ${e.message}`,
        "warning"
      );
      if (mark && !stopped) notBack(root, mark, e.message);
    }
  }
  async function check(root) {
    const slot = await doors.slotFor(root, false);
    if (slot.resume) await slot.resume;
    if (!slot.dir) slot.dir = await doors.directoryOf(root);
    await doors.ready(slot);
    const r = await slot.bridge.request("iskron/check", selector(slot), {
      timeoutMs: 3e4
    });
    if (typeof r?.key === "string") slot.key = r.key;
    if (r?.holding) slot.holding = true;
    else if (r?.holding === false) {
      slot.holding = false;
      roots.delete(root);
      const place = retrying.get(root);
      if (place && !r?.resumed)
        doors.tell(
          root,
          `Искрон: место ${place} не вернулось и на повторе сторожа: ${r?.word ?? "мост не сказал почему"}. Сам сторож его больше не поднимает — займи место iskron_stand.`,
          slot.child
        );
    }
    retrying.delete(root);
    if (r?.resumed) {
      doors.say(`Искрон: сторож слуха вернул место сессии ${root} — ${r.word}`, "info");
      if (typeof r.key === "string") doors.tell(root, resumedWord(r.key, r.others), slot.child);
    } else if (r?.reopened)
      doors.say(`Искрон: сторож слуха переоткрыл сокет сессии ${root} — ${r.word}`, "warning");
    else if (r?.stuck) doors.say(r.word, "error");
  }
  const timer = setInterval(() => {
    if (stopped) return;
    for (const root of roots)
      void check(root).catch(
        (e) => doors.say(`Искрон: сторож слуха сессии ${root} — ${e.message}`, "warning")
      );
  }, WATCH_MS);
  timer.unref?.();
  return {
    hint(entries) {
      for (const e of entries) {
        if (!e.session || e.child) continue;
        if (e.key) hints.set(e.session, e.key);
        marked.set(e.session, e);
      }
    },
    async resumeLost(entries, word) {
      const seen = /* @__PURE__ */ new Set();
      let said = false;
      for (const e of entries) {
        if (stopped) break;
        if (e.child || !e.session || seen.has(e.session)) continue;
        seen.add(e.session);
        if (!await doors.exists(e.session)) continue;
        if (word) doors.lost(e.session, word);
        said = true;
        await doors.slotFor(e.session, false);
      }
      return said;
    },
    resume,
    stood(slot) {
      slot.holding = true;
      slot.stood = true;
      if (slot.session) roots.add(slot.session);
    },
    forget(root) {
      roots.delete(root);
      retrying.delete(root);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

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

// js/opencode/satellite.ts
var STAND_TOOL = "iskron_stand";
function standsBy(name, args) {
  if (name === STAND_TOOL) return true;
  return name === "iskron_channel" && ["connect", "mint", "register"].includes(String(args.action));
}
var busyOnly = (args) => typeof args.status === "string" && takingArgs(args).length === 0;
function heldPlace(data) {
  const p = data?.place;
  if (typeof p?.name !== "string" || !p.name) return null;
  return { realm: String(p.realm), karta: String(p.karta), name: p.name };
}
function asSatellite(args, of, leads = false) {
  const busy = busyOnly(args);
  if (!of) return busy;
  args.satellite_of ??= of.name;
  if (!(leads && busy) && (args.karta == null || args.karta === "")) args.karta = of.karta;
  return busy;
}

// js/opencode/launch.ts
function createLauncher(d) {
  const prompted = /* @__PURE__ */ new Set();
  return {
    forget: (id) => void prompted.delete(id),
    async launch(sessionID, text) {
      if (prompted.has(sessionID)) return null;
      prompted.add(sessionID);
      const l = parseLaunch(text);
      if (!l) return null;
      const root = await d.rootOf(sessionID);
      if (root === sessionID) return null;
      const slot = d.childSlot(sessionID, root);
      return enterCase(
        l,
        (name, args) => d.call(slot, name, args, sessionID),
        null,
        () => slot.place?.name
      );
    }
  };
}

// js/opencode/leadwords.ts
var SUMMARY_MAX = 4e3;
var endWord = (who, why, last) => {
  const said = last.length > SUMMARY_MAX ? `${last.slice(0, SUMMARY_MAX)}…` : last;
  return `Искрон: субагент ${who} КОНЧЕН — ${why}. Это конец поручения, не ход: мост субагента погашен, из дел он вышел, место снято. Итог — его последнее слово:
${said || "(текста он не оставил — смотри его дело)"}`;
};
var turnWord = (place) => `Искрон: субагент ${place} сдал ход, не поручение — он продолжает и ждёт кадров своего дела; итог ляжет сюда по его концу. Отпустить раньше — iskron_channel(action="revoke", standing="${place}").`;
var releaseWord = (who) => `Искрон: субагент ${who} отпущен — его мост погашен: выход из дел и снятие места делает он; итог лёг сюда синтетикой.`;
var lostWord = (who) => `Искрон: субагент ${who} снят перезагрузкой плагина — его мост ушёл с местом при остановке; итога нет, его ход — в его сессии. Встанет заново (iskron_stand) — продолжит.`;
function leadDoors(ctx, say, flush, end) {
  return {
    say,
    async end(child) {
      await flush(child).catch(() => {
      });
      end(child);
    },
    async parentOf(child) {
      const s = await ctx.session.get({ sessionID: child });
      return s?.parentID ?? s?.data?.parentID ?? null;
    },
    async tell(sessionID, text, wake) {
      const s = ctx.session;
      try {
        if (typeof s.synthetic === "function")
          await s.synthetic({ sessionID, text, delivery: "queue", resume: wake });
        else await s.prompt({ sessionID, text, delivery: "queue" });
        say(`Искрон: слово о субагенте вложено в сессию ${sessionID}`, "info");
      } catch (e) {
        say(
          `Искрон: слово о субагенте не вложилось в ${sessionID}: ${e.message}`,
          "error"
        );
      }
    }
  };
}

// js/opencode/leads.ts
var LEAD_IDLE_MS = Number(process.env.ISKRON_LEAD_IDLE_MS) || 45 * 6e4;
var TICK_MS = Math.min(6e4, Math.max(100, Math.floor(LEAD_IDLE_MS / 5)));
var roomNo = (room) => String(room ?? "").replace(/^\s*[#№]\s*|\s+$/g, "");
var names = (place, child, s) => s === child || !!place?.name && (s === place.name || s.endsWith(`:${place.name}`));
function createLeads(d) {
  const leads = /* @__PURE__ */ new Map();
  const who = (l, child) => l.place?.name ?? `сессии ${child}`;
  const parentOf = (child) => d.parentOf(child).catch(() => null);
  async function finish(child, why, gone = false) {
    const l = leads.get(child);
    if (!l) return;
    leads.delete(child);
    if (!gone) await d.end(child).catch(() => {
    });
    const parent = await l.parent;
    const word = endWord(who(l, child), why, (l.last ?? "").trim());
    if (parent) await d.tell(parent, word, true);
    else d.say(`${word}
(родителя плагин не знает — итог некому)`, "warning");
  }
  function leave(child, l, why) {
    l.leaving = why;
    if (!l.running) void finish(child, why);
  }
  function stood(child) {
    const l = leads.get(child) ?? { parent: parentOf(child), at: 0 };
    leads.set(child, l);
    return l;
  }
  function touch(l, place) {
    if (!l) return false;
    l.at = Date.now();
    if (place) l.place = place;
    return true;
  }
  const tick = setInterval(() => {
    const now2 = Date.now();
    const why = `потолок простоя: ${Math.round(LEAD_IDLE_MS / 6e4)} мин без хода и без кадра`;
    for (const [child, l] of leads)
      if (!l.running && now2 - l.at >= LEAD_IDLE_MS) void finish(child, why);
  }, TICK_MS);
  tick.unref?.();
  return {
    called(child, name, args, place) {
      const l = standsBy(name, args) ? stood(child) : leads.get(child);
      if (!touch(l, place)) return;
      const room = name === "iskron_case" || name === "iskron_room" ? roomNo(args.room) : "";
      if (args.action === "join" && room) l.room ??= room;
      if (args.action !== "leave") return;
      if (name === "iskron_channel") leave(child, l, "ушёл с места по исходу");
      else if (room && room === l.room) leave(child, l, `вышел из дела №${l.room} по исходу`);
    },
    async release(caller, name, args) {
      const s = String(args.standing ?? "").trim();
      if (name !== "iskron_channel" || args.action !== "revoke" || !s) return null;
      for (const [child, l] of leads) {
        if (!names(l.place, child, s) || await l.parent !== caller) continue;
        await finish(child, "отпущен словом запустившего");
        return releaseWord(who(l, child));
      }
      return null;
    },
    heard(child, kind, place) {
      touch(kind === "held" ? stood(child) : leads.get(child), place);
    },
    lost(entries) {
      const children = entries.filter((e) => e.child && e.session);
      for (const e of children)
        void parentOf(e.session).then(async (p) => {
          if (p) await d.tell(p, lostWord(e.key ?? e.session), false);
        });
      return children.map((e) => e.session);
    },
    onEvent(ev) {
      const child = ev?.data?.sessionID;
      const l = typeof child === "string" ? leads.get(child) : void 0;
      if (!touch(l) || typeof child !== "string") return;
      switch (ev.type) {
        case "session.execution.started":
          l.running = true;
          return;
        case "session.text.ended":
          if (typeof ev.data?.text === "string" && ev.data.text.trim()) l.last = ev.data.text;
          return;
        case "session.execution.succeeded":
        case "session.execution.failed":
          l.running = false;
          if (l.leaving) return void finish(child, l.leaving);
          if (l.noted) return;
          l.noted = true;
          void l.parent.then(async (p) => {
            if (p && leads.has(child)) await d.tell(p, turnWord(l.place?.name ?? child), false);
          });
          return;
        case "session.deleted":
          return void finish(child, "сессия субагента удалена", true);
      }
    },
    stop: () => clearInterval(tick)
  };
}

// js/opencode/login.ts
function elsewhere(device) {
  return device && /^https?:/.test(device) ? `с другого устройства (телефон подойдёт) — ${device}; либо личный токен в ~/.iskron-bridge/token` : (device ? `${device}; ` : "") + "с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token";
}
function createLogin(say) {
  let pending = false;
  let url = null;
  let device = null;
  const waiters = /* @__PURE__ */ new Set();
  function started() {
    if (pending) return { promise: Promise.resolve(), cancel() {
    } };
    let waiter = () => {
    };
    const promise = new Promise((r) => waiter = r);
    waiters.add(waiter);
    return { promise, cancel: () => waiters.delete(waiter) };
  }
  function error() {
    return new Error(
      `Искрон: нужен вход в граф — ${url ? `открой в браузере ${url}` : "заверши вход в браузере"} и повтори вызов. Адрес локальный для машины OpenCode: ${elsewhere(device)} (скилл establish-mcp).`
    );
  }
  return {
    get pending() {
      return pending;
    },
    get url() {
      return url;
    },
    get device() {
      return device;
    },
    on(next, nextDevice = null) {
      for (const w of waiters) w();
      waiters.clear();
      if (pending && next === url && nextDevice === device) return;
      pending = true;
      url = next;
      device = nextDevice;
      say(
        `Искрон: нужен вход — ${next ? `открой ${next} и заверши его` : "заверши его в браузере"}; адрес локальный: ${elsewhere(device)}. Тулы iskron_* поднимутся после входа сами.`,
        "warning"
      );
    },
    done() {
      pending = false;
      url = null;
      device = null;
    },
    async race(ready) {
      if (pending) throw error();
      const login = started();
      try {
        await Promise.race([
          ready(),
          login.promise.then(() => {
            throw error();
          })
        ]);
      } finally {
        login.cancel();
      }
    }
  };
}

// js/opencode/runends.ts
var READ_TOOLS = /* @__PURE__ */ new Set([
  "iskron_look",
  "iskron_orient",
  "iskron_search",
  "iskron_semantic_search"
]);
var READ_ACTIONS = {
  iskron_channel: /* @__PURE__ */ new Set(["list"]),
  iskron_realm: /* @__PURE__ */ new Set(["list"]),
  iskron_org: /* @__PURE__ */ new Set(["list", "get", "realms", "list_members", "list_grants"]),
  iskron_me: /* @__PURE__ */ new Set(["whoami", "orgs", "kartas", "usage"]),
  iskron_history: /* @__PURE__ */ new Set(["realm", "node", "delta"])
};
function createRunEnds() {
  const ended = /* @__PURE__ */ new Map();
  return {
    end(session, of, forget) {
      forget(session);
      ended.set(session, of ?? null);
    },
    clear: (session) => void ended.delete(session),
    guard(session, name, args) {
      if (!ended.has(session) || name === STAND_TOOL || READ_TOOLS.has(name)) return;
      const action = String(args.action ?? "");
      if (action === "?" || READ_ACTIONS[name]?.has(action)) return;
      const of = ended.get(session)?.name ?? "<место запустившего>";
      throw new Error(
        `Отказано (плагин): эта дочерняя сессия кончена, её место-спутник отпущено — ${name}${action ? ` (${action})` : ""} пошёл бы мостом и местом запустившего. Встань заново: iskron_stand(realm, karta, satellite_of="${of}"), затем повтори вызов.`
      );
    }
  };
}

// js/opencode/status.ts
var STATUS_TOOL = "iskron_bridge";
var statusTool = (text) => ({
  name: STATUS_TOOL,
  description: "Состояние моста Искрона в этой сессии OpenCode: выполнен ли вход, адрес авторизации, сколько тулов iskron_* поднято. Зови, когда тулов iskron_* нет или они отвечают отказом входа.",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- схема входа SDK без типа
  input: { type: "object", properties: {}, additionalProperties: false },
  async execute() {
    return { content: text() };
  }
});
function statusLines(path, builds, login, state2, sessions, spare) {
  return [
    `мост: ${path}`,
    builds,
    login.loginPending ? `вход: НЕ ВЫПОЛНЕН — ${login.loginUrl ? `открой в браузере ${login.loginUrl}` : "заверши вход в браузере"}. Адрес локальный: ${elsewhere(login.loginDevice)} (скилл establish-mcp).` : state2.serverSeen ? "вход: есть, сервер отвечает" : "вход: мост ещё не ответил (рукопожатие идёт)",
    `тулов iskron_*: ${state2.listed.length} (${state2.source})`,
    `мостов живых: ${sessions + spare}, сессий с мостом: ${sessions}`
  ].join("\n");
}

// js/opencode/tools.ts
var IDLE_MS = Number(process.env.ISKRON_BRIDGE_IDLE_MS || 30 * 6e4);
if (IDLE_MS <= WATCH_MS)
  process.stderr.write(
    `[iskron/warning] ISKRON_BRIDGE_IDLE_MS (${IDLE_MS}) не длиннее такта сторожа слуха (${WATCH_MS}): слот может быть сжат прежде возврата места
`
  );
var REAP_MS = Number(process.env.ISKRON_BRIDGE_REAP_MS || 6e4);
var hhmm = () => (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5);
async function setupTools(ctx, say, onChannel, rootOf, flushUsage = async () => {
}) {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " + found.tried.join(", ") + ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error"
    );
    return { forget() {
    }, onEvent() {
    }, launch: async () => null, stop() {
    }, bridgeOf: () => null };
  }
  const path = found.path;
  const builds = buildsLine(path, import.meta.url);
  const hostEnv = await hostEnvOf(ctx);
  const slots = /* @__PURE__ */ new Map();
  let spare = null;
  let stopped = false;
  const login = createLogin(say);
  function spawn2(args = []) {
    const slot = {
      bridge: null,
      ready: Promise.resolve(),
      session: null,
      holding: false,
      stood: false,
      dir: null,
      key: null,
      resume: null,
      lastCall: Date.now(),
      busy: 0,
      ownStop: false
    };
    slot.bridge = new Bridge(
      path,
      (line) => say(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        if (method === "notifications/tools/list_changed") return void relist(slot.bridge);
        if (method !== "notifications/message" || params?.logger !== "iskron-channel") return;
        const kind = params?.data?.kind;
        if (kind === "held" || kind === "attached" || params?.data?.frame?.type === "hello")
          keeper.stood(slot);
        if ((kind === "held" || kind === "released") && typeof params?.data?.key === "string")
          slot.key = params.data.key;
        if (kind === "held") slot.place = heldPlace(params?.data) ?? slot.place;
        if (kind === "released" || kind === "dead" || kind === "evicted") slot.holding = false;
        if (slot.child && slot.session) leads.heard(slot.session, kind, slot.place);
        onChannel(slot.session, params, !!slot.child);
      },
      (e) => {
        if (slot.ownStop || stopped || !slot.holding) return;
        slot.holding = false;
        const text = `Искрон: слух потерян в ${hhmm()} — мост стояния вышел (${e.message}). Сторож слуха поднимет мост и вернёт место с диска; не ждёшь — iskron_stand.`;
        const lost2 = { logger: "iskron-channel", data: { kind: "lost", text } };
        onChannel(slot.session, lost2, !!slot.child);
      },
      args
    );
    slot.bridge.start(hostEnv);
    shake(slot);
    return slot;
  }
  const directoryOf = (sessionID) => sessionDirectory(ctx, sessionID);
  const runEnds = createRunEnds();
  const endChild = (c) => runEnds.end(c, slots.get(c)?.satelliteOf, forget);
  const leads = createLeads(leadDoors(ctx, say, flushUsage, endChild));
  const keeper = createKeeper({
    say,
    tell: (root, text, child) => onChannel(root, { logger: "iskron-channel", data: { kind: "resumed", text } }, !!child),
    lost: (root, text) => onChannel(root, { logger: "iskron-channel", data: { kind: "lost", text } }),
    slotFor: (root, touch) => slotFor(root, touch),
    ready: readyFor,
    directoryOf,
    exists: (sessionID) => Promise.resolve().then(() => ctx.session.get({ sessionID })).then(
      () => true,
      () => false
    )
  });
  const lost = takeLostMarker(authDir());
  let lostWord2 = lost?.text ?? null;
  if (lost) {
    say(lost.text, "warning");
    keeper.hint(lost.entries);
    for (const child of leads.lost(lost.entries)) runEnds.end(child, null, () => {
    });
  }
  function shake(slot) {
    slot.ready = handshake(slot.bridge, login.on, login.done);
    slot.ready.catch(() => {
    });
  }
  async function readyFor(slot) {
    try {
      await slot.ready;
    } catch {
      shake(slot);
      await slot.ready;
    }
  }
  async function slotFor(sessionID, touch = true) {
    const root = await rootOf(sessionID);
    const own = root !== sessionID ? slots.get(sessionID) : void 0;
    if (own) {
      const live = own.bridge.failure ? childSlot(sessionID) : own;
      if (touch) live.lastCall = Date.now();
      return live;
    }
    let slot = slots.get(root);
    let dead;
    if (slot?.bridge.failure) {
      dead = slot;
      slots.delete(root);
      slot = void 0;
    }
    if (!slot) {
      slot = spare && !spare.bridge.failure ? spare : spawn2();
      spare = null;
      slot.session = root;
      slot.dir = dead?.dir ?? slot.dir;
      slot.key = dead?.key ?? slot.key;
      slots.set(root, slot);
      if (lostWord2) {
        onChannel(root, { logger: "iskron-channel", data: { kind: "lost", text: lostWord2 } });
        lostWord2 = null;
      }
      const s = slot;
      s.resume = keeper.resume(s, root).finally(() => s.resume = null);
    }
    if (touch) slot.lastCall = Date.now();
    return slot;
  }
  const reaper = setInterval(() => {
    const now2 = Date.now();
    for (const [session, slot] of slots) {
      if (slot.holding || slot.busy > 0 || now2 - slot.lastCall < IDLE_MS) continue;
      slot.ownStop = true;
      slot.bridge.stop();
      slots.delete(session);
    }
    if (spare && !spare.holding && now2 - spare.lastCall >= IDLE_MS && state2.serverSeen) {
      spare.ownStop = true;
      spare.bridge.stop();
      spare = null;
    }
  }, REAP_MS);
  reaper.unref?.();
  const state2 = {
    listed: readCache() ?? [],
    source: "из прошлого списка",
    serverSeen: false
  };
  const relist = (b) => b && refreshToolList(
    b,
    state2,
    () => ctx.tool.reload(),
    say,
    () => !stopped
  );
  const statusText = () => statusLines(
    path,
    builds,
    { loginPending: login.pending, loginUrl: login.url, loginDevice: login.device },
    state2,
    slots.size,
    spare ? 1 : 0
  );
  await ctx.tool.transform((editor) => {
    editor.add(statusTool(statusText));
    for (const t of state2.listed) {
      const name = String(t.name);
      editor.add({
        name,
        description: String(t.description ?? ""),
        // JSON Schema сервера без паспорта диалекта — той же срезкой, что у pi.
        input: toParameters(t.inputSchema),
        async execute(input, tool) {
          const word = await leads.release(String(tool.sessionID), name, input ?? {});
          if (word) return { content: word };
          runEnds.guard(String(tool.sessionID), name, input ?? {});
          const slot = await slotFor(String(tool.sessionID));
          slot.busy++;
          try {
            return await callThrough(slot, name, input, String(tool.sessionID));
          } finally {
            slot.busy--;
            slot.lastCall = Date.now();
          }
        }
      });
    }
  });
  function childSlot(sessionID, parent) {
    const have = slots.get(sessionID);
    if (have && !have.bridge.failure) return have;
    const of = have?.satelliteOf ?? parent?.place ?? null;
    const own = spawn2(of ? ["--satellite"] : []);
    own.satelliteOf = of;
    own.session = sessionID;
    own.child = true;
    own.dir = have?.dir ?? null;
    own.key = have?.key ?? null;
    slots.set(sessionID, own);
    if (have?.stood && own.key)
      own.resume = keeper.resume(own, sessionID).finally(() => own.resume = null);
    return own;
  }
  const awaitReady = (slot) => login.race(() => readyFor(slot));
  async function callThrough(slot, name, input, sessionID, service = false) {
    await awaitReady(slot);
    if (slot.resume) await slot.resume;
    const args = { ...input ?? {} };
    if (standsBy(name, args) && slot.session !== sessionID) {
      slot = childSlot(sessionID, slot);
      await awaitReady(slot);
    }
    const busy = name === STAND_TOOL && asSatellite(args, slot.satelliteOf, !!slot.place);
    if (name === STAND_TOOL && !args.cwd) {
      const dir = slot.dir ??= await directoryOf(slot.session ?? sessionID);
      if (dir) args.cwd = dir;
    }
    const result = await slot.bridge.request("tools/call", { name, arguments: args }, { service });
    if (result?.isError) throw new Error(textOf2(result) || `${name}: отказ без текста`);
    if (standsBy(name, args) && !busy) keeper.stood(slot);
    if (standsBy(name, args)) runEnds.clear(sessionID);
    if (slot.child && slot.session === sessionID) leads.called(sessionID, name, args, slot.place);
    return { content: textOf2(result) };
  }
  if (state2.listed.length)
    say(`Искрон: тулов из прошлого списка: ${state2.listed.length}; сверю с сервером.`, "info");
  spare = spawn2();
  let first = spare;
  let [misses, deaths] = [0, 0];
  void (async () => {
    for (; ; ) {
      if (stopped) return;
      try {
        await first.ready;
        const list = await listTools(first.bridge);
        state2.serverSeen = true;
        const same = JSON.stringify(list) === JSON.stringify(state2.listed);
        state2.listed = list;
        state2.source = "с сервера";
        writeCache(list);
        if (!same) await ctx.tool.reload();
        say(`Искрон: мост поднят, тулов в сессии: ${list.length} (с сервера).`, "info");
        return;
      } catch (e) {
        if (stopped) return;
        if (first.bridge.failure) {
          if (first.session === null)
            say(`Искрон: мост умер (${e.message}) — поднимаю новый.`, "warning");
          if (spare === first) spare = null;
          first = spare ?? spawn2();
          spare = first;
          await sleep2(retryPause(deaths++));
        } else {
          await sleep2(retryPause(misses++));
          shake(first);
        }
      }
    }
  })();
  if (lost) {
    const word = lostWord2;
    lostWord2 = null;
    void keeper.resumeLost(lost.entries, word).then((said) => {
      if (!said) lostWord2 ??= word;
    });
  }
  const launcher = createLauncher({
    rootOf,
    childSlot: (sessionID, root) => childSlot(sessionID, slots.get(root)),
    async call(slot, name, args, sessionID) {
      slot.busy++;
      try {
        return (await callThrough(slot, name, args, sessionID, true)).content;
      } finally {
        slot.busy--;
        slot.lastCall = Date.now();
      }
    }
  });
  function forget(session) {
    runEnds.clear(session);
    launcher.forget(session);
    keeper.forget(session);
    const slot = slots.get(session);
    if (!slot) return;
    slots.delete(session);
    slot.ownStop = true;
    slot.bridge.stop();
  }
  return {
    launch: launcher.launch,
    bridgeOf: (s) => [slots.get(s)].find((x) => x?.holding)?.bridge ?? null,
    forget,
    onEvent: (ev) => leads.onEvent(ev),
    stop() {
      stopped = true;
      clearInterval(reaper);
      leads.stop();
      keeper.stop();
      writeLostMarker(authDir(), slots.values());
      if (spare) spare.ownStop = true;
      spare?.bridge.stop();
      spare = null;
      for (const slot of slots.values()) {
        slot.ownStop = true;
        slot.bridge.stop();
      }
      slots.clear();
    }
  };
}

// js/opencode/channel.ts
var CASE_BATCH_MS = Number(process.env.ISKRON_OPENCODE_BATCH_MS) || 5e3;
var CASE_BATCH_CAP = 20;
var PENDING_MAX_MS = Number(process.env.ISKRON_OPENCODE_PENDING_MS) || 12e4;
function toPile(frame) {
  if (!frame || frame.type !== "message" || isDirectWord(frame)) return false;
  const rk = roomKind(frame);
  if ((frame.origin ?? classifyOrigin(frame)) === "human" && !rk?.phase && !rk?.aside) return false;
  return !addressedToMine(frame) || stackOf(frame) === "batch";
}
var RIDERS_MAX = 500;
function setupChannel(ctx, say, freshestRoot) {
  async function accepting(id) {
    try {
      const info = await ctx.session.get({ sessionID: id });
      return !(info?.time?.archived ?? info?.data?.time?.archived);
    } catch {
      return false;
    }
  }
  async function deliver(session, text, frame = "кадр", delivery = "steer", child = false) {
    let id = session;
    if (child && (!id || !await accepting(id))) {
      say(
        `Искрон: ${frame} на место дочерней сессии ${id ?? "?"}, которой больше нет, — корню не переадресую; кадр остаётся в истории стояния (iskron_channel history); место дочерней сессии — лишнее на канале, где корень стоит дальше: снимать ли его revoke, решай, зная цену (standing) —${text.slice(0, 120)}`,
        "error"
      );
      return null;
    }
    if (id && !await accepting(id)) {
      say(
        `Искрон: сессия ${id} закрыта или в архиве — ${frame} идёт в свежайшую виденную`,
        "warning"
      );
      id = null;
    }
    id ??= freshestRoot();
    if (id && id !== session && !await accepting(id)) id = null;
    if (!id) {
      say(
        `Искрон: ${frame} ВЛОЖИТЬ НЕКУДА — плагин не видел живой корневой сессии; кадр остаётся в истории стояния — ` + text.slice(0, 120),
        "error"
      );
      return null;
    }
    try {
      const r = await ctx.session.prompt({ sessionID: id, text, delivery });
      say(`Искрон: ${frame} вложен в сессию ${id}`, "info");
      const inbox = r?.id ?? r?.data?.id;
      return { session: id, inbox: typeof inbox === "string" ? inbox : null };
    } catch (e) {
      say(`Искрон: ${frame} не вложился в сессию ${id}: ${e.message}`, "error");
      return null;
    }
  }
  const piles = /* @__PURE__ */ new Map();
  const takenEarly = /* @__PURE__ */ new Set();
  function schedule(p) {
    if (p.timer) clearTimeout(p.timer);
    const wait = p.pending ? Math.max(0, p.pending.at + PENDING_MAX_MS - Date.now()) : CASE_BATCH_MS;
    p.timer = setTimeout(() => {
      p.timer = null;
      p.pending = null;
      flush(p);
    }, wait);
    p.timer.unref?.();
  }
  function flush(p) {
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    if (!p.held.length) return;
    const frames = p.held.splice(0);
    if (!frames.some((f) => addressedToMine(f))) {
      p.riders.push(...frames);
      p.riders.splice(0, Math.max(0, p.riders.length - RIDERS_MAX));
      return;
    }
    const at = Date.now();
    p.pending = { session: "", inbox: null, at };
    const text = [batchHead([...p.riders.splice(0), ...frames]), ...batchLines(frames)].join("\n");
    void deliver(p.session, text, `пачка дела (${frames.length})`, "queue", p.child).then((got) => {
      const inbox = got?.inbox && !takenEarly.delete(got.inbox) ? got.inbox : null;
      p.pending = got && inbox ? { session: got.session, inbox, at } : null;
      if (p.held.length) schedule(p);
    });
  }
  function pile(session, child, frame) {
    const key = `${child ? "child" : "root"}:${session ?? ""}`;
    let p = piles.get(key);
    if (!p)
      piles.set(key, p = { session, child, held: [], riders: [], timer: null, pending: null });
    if (frame.id && p.held.some((f) => f.id === frame.id)) return;
    p.held.push(frame);
    if (!p.pending && p.held.length >= CASE_BATCH_CAP) return flush(p);
    if (!p.timer) schedule(p);
  }
  function riding(ps) {
    const got = ps.flatMap((p) => p.riders.splice(0));
    return got.length ? [batchHead(got)] : [];
  }
  function loud(session, text, child = false) {
    say(text, "error");
    void deliver(session, text, "кадр", "steer", child);
  }
  return {
    taken(session, inbox) {
      let matched = false;
      for (const p of piles.values()) {
        if (!p.pending || (inbox ? p.pending.inbox !== inbox : p.pending.session !== session))
          continue;
        matched = true;
        p.pending = null;
        flush(p);
      }
      if (inbox && !matched) {
        takenEarly.add(inbox);
        for (const old of takenEarly) if (takenEarly.size > 100) takenEarly.delete(old);
      }
    },
    stop() {
      for (const p of piles.values()) {
        p.pending = null;
        flush(p);
      }
    },
    ride(session) {
      const own = [...piles.values()].filter(
        (p) => !p.child && (p.session === session || !p.session && freshestRoot() === session)
      );
      return riding(own).join("\n") || null;
    },
    onEvent(session, params, child = false) {
      const ev = params?.data;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          if (frame && toPile(frame)) return pile(session, child, frame);
          const own = piles.get(`${child ? "child" : "root"}:${session ?? ""}`);
          void deliver(
            session,
            [...riding(own ? [own] : []), frameToText(frame, ev.raw ?? "")].join("\n"),
            `кадр ${frame?.id ?? "без id"}`,
            "steer",
            child
          );
          return;
        }
        // Слово моста ребёнка — только ему (child): корню оно не адресовано (#6625).
        case "dead":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect"), затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен.`,
            child
          );
          return;
        case "stale":
          if (ev.text) void deliver(session, ev.text, "пачка лежалых кадров", "queue", child);
          return;
        case "backlog":
          if (ev.text)
            void deliver(
              session,
              ev.text,
              `пачка побудки (${ev.frames?.length ?? 0})`,
              "queue",
              child
            );
          return;
        case "lost":
          if (ev.text) loud(session, ev.text, child);
          return;
        case "resumed":
          if (ev.text) {
            say(ev.text, "warning");
            void deliver(session, ev.text, "слово о возвращённом месте", "steer", child);
          }
          return;
        case "held":
          say(`Искрон: мост держит стояние ${ev.key ?? ""}`, "info");
          return;
        case "released":
          say(`Искрон: мост отпустил стояние ${ev.key ?? ""} — ${ev.text ?? ""}`, "warning");
          return;
        case "evicted":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. Привязка записей цела; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека.`,
            child
          );
          return;
        case "alive":
          loud(
            session,
            `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; не пройдёт — спроси о токене.`,
            child
          );
          return;
        case "note":
          if (ev.text) say(`Искрон: ${ev.text}`, "warning");
          return;
        default:
          return;
      }
    }
  };
}

// js/opencode/commands.ts
import { readFileSync as readFileSync5 } from "node:fs";
function slashOf(markdown) {
  if (!markdown.startsWith("---")) return false;
  const end = markdown.indexOf("\n---", 3);
  if (end < 0) return false;
  const head = markdown.slice(3, end);
  return /^slash:\s*true\s*$/m.test(head);
}
function commandText(id, args) {
  return `Загрузи скилл \`${id}\` инструментом \`skill\` (id: \`${id}\`) и действуй строго по нему. Это набрал человек, а не ты; его слова — ниже.

` + args.trim();
}
async function listSkills(ctx) {
  const res = await ctx.skill.list();
  const list = Array.isArray(res) ? res : res?.data ?? [];
  const out2 = [];
  for (const s of list) {
    const id = String(s?.id ?? "");
    const path = typeof s?.path === "string" ? s.path : null;
    if (!id || !path) continue;
    let text;
    try {
      text = readFileSync5(path, "utf8");
    } catch {
      continue;
    }
    if (!slashOf(text)) continue;
    out2.push({ id, description: snippet(String(s?.description ?? "")) });
  }
  return out2.sort((a, b) => a.id.localeCompare(b.id));
}
async function setupCommands(ctx, say) {
  const state2 = { commands: await listSkills(ctx) };
  await ctx.command.transform((editor) => {
    for (const { id, description } of state2.commands) {
      editor.add({
        name: id,
        description,
        async execute({ sessionID, prompt, delivery }) {
          await ctx.session.prompt({
            ...prompt,
            sessionID,
            text: commandText(id, String(prompt?.text ?? "")),
            delivery
          });
        }
      });
    }
  });
  if (state2.commands.length)
    say(`Искрон: команд «/» по скиллам поставки: ${state2.commands.length}.`, "info");
  return {
    async refresh() {
      const next = await listSkills(ctx);
      const same = next.length === state2.commands.length && next.every((c, i) => c.id === state2.commands[i]?.id);
      state2.commands = next;
      if (!same) await ctx.command.reload();
    }
  };
}

// js/opencode/usage.ts
var DEBOUNCE_MS = Number(process.env.ISKRON_USAGE_DEBOUNCE_MS || 1e4);
var n = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
var spent = (t) => n(t?.input) + n(t?.output) + n(t?.reasoning) + n(t?.cache?.write);
var inWindow = (t) => n(t?.input) + n(t?.cache?.read) + n(t?.cache?.write);
var kinds = (t) => ({
  input: n(t?.input),
  output: n(t?.output) + n(t?.reasoning),
  cache_read: n(t?.cache?.read),
  cache_write: n(t?.cache?.write)
});
function createUsageFeed(opts) {
  const bySession = /* @__PURE__ */ new Map();
  const timers = /* @__PURE__ */ new Map();
  const windows = /* @__PURE__ */ new Map();
  let listed = null;
  const loadWindows = () => listed ??= (async () => {
    try {
      const out2 = await opts.listModels();
      const list = Array.isArray(out2) ? out2 : out2?.data ?? out2?.models ?? [];
      for (const m of list) {
        const ctx = n(m?.limit?.context);
        const id = m?.id ?? m?.modelID;
        const prov = m?.providerID ?? m?.provider?.id;
        if (ctx && id) windows.set(`${prov ?? ""}/${id}`, ctx);
      }
    } catch {
      listed = null;
    }
  })();
  const inFlight = /* @__PURE__ */ new Map();
  const send = async (session, timeoutMs) => {
    const u = bySession.get(session);
    if (!u) return;
    const { ref, ...p } = u;
    if (ref && windows.has(ref)) p.window = windows.get(ref);
    await opts.bridgeOf(session)?.request("iskron/usage", p, { timeoutMs }).catch(() => {
    });
  };
  const flush = (session, timeoutMs = 1e4) => {
    clearTimeout(timers.get(session));
    timers.delete(session);
    const p = (inFlight.get(session) ?? Promise.resolve()).then(() => send(session, timeoutMs));
    inFlight.set(session, p);
    void p.finally(() => {
      if (inFlight.get(session) === p) inFlight.delete(session);
    });
    return p;
  };
  const schedule = (session) => {
    if (!timers.has(session)) {
      const t = setTimeout(() => void flush(session), DEBOUNCE_MS);
      t.unref?.();
      timers.set(session, t);
    }
  };
  return {
    onEvent(ev) {
      const session = ev?.data?.sessionID;
      if (typeof session !== "string") return;
      const u = bySession.get(session) ?? {};
      switch (ev?.type) {
        case "session.step.started": {
          const m = ev.data?.model;
          if (m?.id) {
            u.ref = `${m.providerID ?? ""}/${m.id}`;
            u.model = String(m.id);
          }
          void loadWindows();
          break;
        }
        case "session.step.ended":
          if (!ev.data?.tokens) return;
          u.context = inWindow(ev.data.tokens);
          break;
        case "session.usage.updated":
          if (!ev.data?.tokens) return;
          Object.assign(u, { tokens: spent(ev.data.tokens), ...kinds(ev.data.tokens) });
          break;
        default:
          return;
      }
      bySession.set(session, u);
      schedule(session);
    },
    // Ждущего снимка нет — дождаться ушедшего: мост не уходит с местом раньше его ответа.
    flush: (session) => timers.has(session) ? flush(session, 3e3) : inFlight.get(session) ?? Promise.resolve(),
    forget(session) {
      clearTimeout(timers.get(session));
      timers.delete(session);
      bySession.delete(session);
    },
    stop() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      bySession.clear();
    }
  };
}

// js/opencode/plugin.ts
async function setup(ctx) {
  const say = (text, level) => {
    process.stderr.write(`[iskron${level === "info" ? "" : "/" + level}] ${text}
`);
  };
  const roots = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Map();
  async function rootOf(sessionID) {
    const known = roots.get(sessionID);
    if (known) {
      seen.set(known, Date.now());
      return known;
    }
    let root = sessionID;
    try {
      const visited = /* @__PURE__ */ new Set();
      for (; ; ) {
        visited.add(root);
        const res = await ctx.session.get({ sessionID: root });
        const parent = res?.parentID ?? res?.data?.parentID;
        if (!parent || visited.has(parent)) break;
        root = parent;
      }
    } catch {
      seen.set(root, Date.now());
      return root;
    }
    roots.set(sessionID, root);
    seen.set(root, Date.now());
    return root;
  }
  function freshestRoot() {
    let best = null;
    let at = -1;
    for (const [id, t] of seen) {
      if (t <= at) continue;
      best = id;
      at = t;
    }
    return best;
  }
  let onChannel = () => {
  };
  let ch = null;
  try {
    const c0 = setupChannel(ctx, say, freshestRoot);
    ch = c0;
    onChannel = (s, p, c) => c0.onEvent(s, p, c);
  } catch (e) {
    say(`Искрон: канал не встал — ${e.message}`, "error");
  }
  let half = {
    forget() {
    },
    onEvent() {
    },
    launch: async () => null,
    stop() {
    },
    bridgeOf: () => null
  };
  let flushUsage = (_s) => Promise.resolve();
  try {
    half = await setupTools(ctx, say, onChannel, rootOf, (s) => flushUsage(s));
  } catch (e) {
    say(`Искрон: мост не поднялся — ${e.message}`, "error");
  }
  try {
    await ctx.session.hook("prompt", async (p) => {
      const word = await half.launch(String(p.sessionID), p.prompt.text);
      if (word) p.prompt.text = withWord(p.prompt.text, word);
      const sid = String(p.sessionID);
      const counts = await rootOf(sid) === sid ? ch?.ride(sid) : null;
      if (counts) p.prompt.text = `${p.prompt.text}

${counts}`;
    });
  } catch (e) {
    say(`Искрон: строка запуска не встала — ${e.message}`, "error");
  }
  let commands = { refresh: async () => {
  } };
  try {
    commands = await setupCommands(ctx, say);
  } catch (e) {
    say(`Искрон: команды скиллов не встали — ${e.message}`, "error");
  }
  const usage = createUsageFeed({
    listModels: () => ctx.model.list(),
    bridgeOf: (s) => half.bridgeOf(s)
  });
  flushUsage = (s) => usage.flush(s);
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const ev = event;
        const id = ev?.data?.sessionID;
        half.onEvent(ev);
        switch (ev?.type) {
          case "session.deleted":
            if (!id) break;
            roots.delete(id);
            seen.delete(id);
            void usage.flush(id).finally(() => {
              usage.forget(id);
              half.forget(id);
            });
            break;
          case "session.created": {
            if (!id) break;
            const parent = ev.data?.parentID;
            if (typeof parent === "string")
              void rootOf(parent).then((root) => {
                roots.set(id, root);
                seen.set(root, Date.now());
              });
            else void rootOf(id);
            break;
          }
          case "skill.updated":
            void commands.refresh();
            break;
          // Очередь сессии сдвинулась: ждущая пачка дела уходит одним промптом.
          case "session.inbox.delivered":
          case "session.inbox.cancelled":
            if (id && typeof ev.data?.inboxID === "string") ch?.taken(id, ev.data.inboxID);
            break;
          case "session.idle":
            if (id) ch?.taken(id);
            break;
          // Конец хода — не конец субагента (#6625): ребёнок ждёт кадров своего дела,
          // кончает его явный акт (leads.ts). Здесь — лишь ждущий снимок расхода.
          case "session.execution.succeeded":
          case "session.execution.failed":
            if (id) void usage.flush(id);
            break;
          default:
            usage.onEvent(ev);
        }
      }
    } catch {
    }
  })();
  return () => {
    controller.abort();
    usage.stop();
    ch?.stop();
    half.stop();
  };
}
var plugin_default = { id: "iskron", setup };
export {
  plugin_default as default
};
