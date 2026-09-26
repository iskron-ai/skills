// js/shared/lang.ts
import { readFileSync } from "node:fs";
import { join as join2 } from "node:path";

// js/shared/standings.ts
import { homedir } from "node:os";
import { join } from "node:path";
var defaultAuthDir = () => join(homedir(), ".iskron-bridge");
var authDirFromEnv = () => process.env.ISKRON_BRIDGE_AUTH_DIR?.trim() || defaultAuthDir();

// js/shared/lang.ts
function langOfUrl(url) {
  try {
    return /\.ai\.?$/i.test(new URL(url).hostname) ? "en" : "ru";
  } catch {
    return "ru";
  }
}
function forcedLang() {
  const v = process.env.ISKRON_BRIDGE_LANG?.trim().toLowerCase();
  return v === "en" || v === "ru" ? v : null;
}
function resolve() {
  const forced = forcedLang();
  if (forced) return forced;
  const fromEnv = process.env.ISKRON_BRIDGE_URL?.trim();
  if (fromEnv) return langOfUrl(fromEnv);
  try {
    const text = readFileSync(join2(authDirFromEnv(), "server"), "utf8").trim();
    if (text) return langOfUrl(text);
  } catch {
  }
  return "ru";
}
var current = null;
var lang = () => current ??= resolve();
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
    const join6 = `iskron_case(action="join", room="${room}")`;
    return L(
      `Искрон: строка запуска — не встал: ${why}. Встань сам (iskron_stand) и войди в дело №${l.no}: ${join6}.`,
      `Iskron: launch line — not seated: ${why}. Take your seat yourself (iskron_stand) and enter case №${l.no}: ${join6}.`
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
var FLAP_PAUSES_MS = (process.env.ISKRON_CHANNEL_FLAP_MS || "5000,10000,20000,40000,60000").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
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

// js/shared/clients.ts
var OPENCODE_CLIENT = "opencode-iskron";

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.20.0";
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

// js/bridge/config.ts
var DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";
var ENGLISH_SERVER_URL = "https://mcp.iskron.ai/";
var PRODUCTION_URLS = new Set([DEFAULT_SERVER_URL, ENGLISH_SERVER_URL].map(strip));
function strip(url) {
  return url.replace(/\/+$/, "");
}

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
  legacy: "род {kind}{, стопка stack}",
  answer_case: "ответ: iskron_case({args})",
  answer_send: "ответ: iskron_channel({args})"
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
  legacy: "kind {kind}{ · stack}",
  answer_case: "answer: iskron_case({args})",
  answer_send: "answer: iskron_channel({args})"
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
function wordsCount(n) {
  const W = words();
  const m10 = n % 10;
  const m100 = n % 100;
  const w = lang() === "en" ? n === 1 ? W.word_one : W.word_many : m10 === 1 && m100 !== 11 ? W.word_one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? W.word_few : W.word_many;
  return `${n} ${w}`;
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
  if (to && (withheld || mine.length && !to.addr.some((a) => mine.includes(a)))) {
    const counts = kind === "said";
    const pair = JSON.stringify([roomOf(f.room), author, to.addr[0]]);
    const id = counts ? values.entry_id : values.refers_to;
    const run = (n) => fill(n === 0 ? W.aside_body : n > 1 ? W.aside_run : W.aside, {
      ...values,
      word: id,
      addressee: to.label,
      count: wordsCount(n)
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
var stackOf = (frame) => roomKind(frame)?.rule ?? (frame?.stack === "defer" ? "batch" : "interrupt");

// js/shared/frame-text.ts
var rec = (v) => v && typeof v === "object" ? v : {};
var idOf = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
var ANSWERABLE = /* @__PURE__ */ new Set(["said", "body", "invite", "objection", "late_objection"]);
var ZACHIN = 40;
function caseOf(frame) {
  const f = frame;
  const room = rec(f.room);
  const n = idOf(room.seq) || idOf(room.id);
  if (!n) return null;
  const z = typeof room.zachin === "string" ? [...room.zachin.trim()] : [];
  const zachin = z.length > ZACHIN ? z.slice(0, ZACHIN).join("") + "…" : z.join("");
  const realm = idOf(room.realm) || idOf(f.realm);
  return { room: n, zachin, realm };
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
    const answerable = !rk || ANSWERABLE.has(rk.kind);
    if (answerable && origin !== "platform" && c.realm && entry) {
      const args = `realm="${c.realm}", action="say", room="#${c.room}", in_reply_to=${entry}`;
      lines2.push(phrase("answer_case", { args }));
    }
    return lines2.join("\n");
  }
  const p = frame.provenance ?? {};
  const id = idOf(frame.id);
  const lines = [`${whoOf2(frame, true) || "?"}${tail(frame, true)}`];
  if (text) lines.push(text);
  if (origin !== "platform" && id && (p.from_standing || p.from_karta_seq != null)) {
    const karta = p.from_karta_seq ?? p.user_karta_seq;
    const args = `action="send"${frame.realm ? `, realm="${frame.realm}"` : ""}${karta != null ? `, karta=${karta}` : ""}${p.from_standing ? `, standing="${p.from_standing}"` : ""}, in_reply_to="${id}"`;
    lines.push(phrase("answer_send", { args }));
  }
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
function foldAsides(frames) {
  const asides = frames.map((f) => roomKind(f)?.aside ?? null);
  const out = [];
  let n = 0;
  asides.forEach((a, i) => {
    if (!a) {
      n = 0;
      out.push(1);
      return;
    }
    n = (i > 0 && asides[i - 1]?.pair === a.pair ? n : 0) + (a.counts ? 1 : 0);
    out.push(asides[i + 1]?.pair === a.pair ? null : n);
  });
  return out;
}
function batchLines(frames) {
  const fold = foldAsides(frames);
  const seen = /* @__PURE__ */ new Set();
  return frames.flatMap((f, i) => {
    const run = fold[i];
    if (run === null) return [];
    const key = caseKey(f);
    const first = !seen.has(key);
    seen.add(key);
    return [batchLine(f, roomKind(f)?.aside ? run : void 0, first)];
  });
}
function batchHead(frames) {
  return L(
    `Дело: кадров ${frames.length} — накопились, не прерывая хода; ${batchPointer(frames)}; следом по строке на кадр.`,
    `Case: ${frames.length} frames — gathered without interrupting the turn; ${batchPointer(frames)}; one line per frame follows.`
  );
}
function batchPointer(frames) {
  const since = /* @__PURE__ */ new Map();
  for (const frame of frames) {
    const f = frame;
    const room = f.room ?? {};
    const line = f.line ?? {};
    const n = room.seq ?? room.id;
    const e = Number(f.entry_id ?? line.entry_id);
    if (typeof n !== "number" && typeof n !== "string" || !Number.isFinite(e)) continue;
    const realm = room.realm ?? f.realm;
    const args = (typeof realm === "string" && realm ? `realm="${realm}", ` : "") + `action="history", room=${typeof n === "number" ? String(n) : JSON.stringify(n)}`;
    since.set(args, Math.min(since.get(args) ?? e, e));
  }
  const whole = L("целиком — ", "in full — ");
  if (!since.size) return `${whole}iskron_channel(action="history")`;
  return whole + [...since].map(([args, e]) => `iskron_case(${args}, since=${e - 1})`).join("; ") + L(
    " (старый тул без since — history с keep_cursor=true)",
    " (an older tool without since — history with keep_cursor=true)"
  );
}

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;

// js/bridge/roomstack.ts
var ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 6e4;

// js/bridge/holdrecord.ts
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;

// js/bridge/sweep.ts
var SEEN_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;

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
  start() {
    const rt = bridgeRuntime();
    const proc = spawn(rt.bin, [this.bin, ...this.args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: rt.env
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
      if (typeof msg?.id !== "number") {
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
    const id = this.nextId++;
    return new Promise((res, rej) => {
      let timer = null;
      const settle = (fn) => (v) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        fn(v);
      };
      const resolve3 = settle(res);
      const reject = settle(rej);
      function onAbort() {
        reject(new Error("вызов отменён"));
      }
      this.pending.set(id, { resolve: resolve3, reject });
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
  const out = blocks.map((b) => {
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
  if (out.length) return out;
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
  readdirSync,
  readFileSync as readFileSync3,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir as homedir3 } from "node:os";
import { join as join4, resolve as resolve2 } from "node:path";

// js/shared/home.ts
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
var homeBridgePath = () => join3(homedir2(), ".iskron-bridge", "iskron-bridge.mjs");

// js/opencode/bridge-io.ts
var HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 6e5);
var AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 2e3);
var AUTH_PENDING = /authorization required/i;
var PROTOCOL = "2025-06-18";
function findBridge() {
  const tried = [];
  const env = process.env.ISKRON_BRIDGE_PATH?.trim();
  if (env) tried.push(resolve2(env));
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
  return process.env.ISKRON_BRIDGE_AUTH_DIR || join4(homedir3(), ".iskron-bridge");
}
function cachePath() {
  return join4(authDir(), "opencode-tools.json");
}
function grantStamp() {
  const dir = authDir();
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "opencode-tools.json").map((f) => `${f}:${statSync(join4(dir, f)).mtimeMs}`).sort().join("|");
  } catch {
    return "";
  }
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    mkdirSync(join4(cachePath(), ".."), { recursive: true, mode: 448 });
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
      onLogin(loginUrlOf(message));
      while (grantStamp() === stamp) {
        if (Date.now() + AUTH_POLL_MS > deadline) throw e;
        await sleep(AUTH_POLL_MS);
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

// js/opencode/keep.ts
import { mkdirSync as mkdirSync2, readdirSync as readdirSync2, readFileSync as readFileSync4, unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join5 } from "node:path";
var WATCH_MS = Number(process.env.ISKRON_BRIDGE_WATCH_MS || 5 * 6e4);
var MARKER_PREFIX = "opencode-lost";
function writeLostMarker(authDir2, slots) {
  const entries = [...slots].filter((s) => s.holding && s.session).map((s) => ({ session: s.session, dir: s.dir, key: s.key, child: !!s.child }));
  if (!entries.length) return;
  try {
    mkdirSync2(authDir2, { recursive: true, mode: 448 });
    const lost = { at: (/* @__PURE__ */ new Date()).toISOString(), entries };
    const name = `${MARKER_PREFIX}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync2(join5(authDir2, name), JSON.stringify(lost), { mode: 384 });
  } catch {
  }
}
function takeLostMarker(authDir2) {
  const entries = [];
  let at = "";
  let files;
  try {
    files = readdirSync2(authDir2).filter((f) => f.startsWith(MARKER_PREFIX) && f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of files) {
    let text;
    try {
      text = readFileSync4(join5(authDir2, f), "utf8");
      unlinkSync(join5(authDir2, f));
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
  let stopped = false;
  function selector(slot) {
    const session = slot.session ? { session: slot.session } : {};
    if (slot.child) return slot.key ? { key: slot.key, ...session } : session;
    const key = slot.key ?? (slot.session ? hints.get(slot.session) : void 0);
    return { ...key ? { key } : {}, ...slot.dir ? { cwd: slot.dir } : {}, ...session };
  }
  async function resume(slot, root) {
    try {
      await doors.ready(slot);
      slot.dir ??= await doors.directoryOf(root);
      if (!slot.dir && !slot.key || slot.child && !slot.key || stopped) return;
      const r = await slot.bridge.request("iskron/resume", selector(slot), {
        timeoutMs: 3e4
      });
      if (!r?.resumed) {
        if (Array.isArray(r?.legacy) && r.legacy.length && typeof r.word === "string")
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
    }
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
      for (const e of entries) if (e.session && e.key && !e.child) hints.set(e.session, e.key);
    },
    resume,
    stood(slot) {
      slot.holding = true;
      slot.stood = true;
      if (slot.session) roots.add(slot.session);
    },
    forget(root) {
      roots.delete(root);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    }
  };
}

// js/opencode/satellite.ts
var STAND_TOOL = "iskron_stand";
function standsBy(name, args) {
  if (name === STAND_TOOL) return true;
  return name === "iskron_channel" && ["connect", "mint", "register"].includes(String(args.action));
}
function heldPlace(data) {
  const p = data?.place;
  if (typeof p?.name !== "string" || !p.name) return null;
  return { realm: String(p.realm), karta: String(p.karta), name: p.name };
}
function asSatellite(args, of) {
  if (!of) return;
  args.satellite_of ??= of.name;
  if (args.karta == null || args.karta === "") args.karta = of.karta;
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

// js/opencode/login.ts
function createLogin(say) {
  let pending = false;
  let url = null;
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
      `Искрон: нужен вход в граф — ${url ? `открой в браузере ${url}` : "заверши вход в браузере"} и повтори вызов. Адрес локальный для машины OpenCode: с другой — ssh -L <порт>:127.0.0.1:<порт>; на безголовой машине положи личный токен в ~/.iskron-bridge/token (скилл establish-mcp).`
    );
  }
  return {
    get pending() {
      return pending;
    },
    get url() {
      return url;
    },
    on(next) {
      for (const w of waiters) w();
      waiters.clear();
      if (pending && next === url) return;
      pending = true;
      url = next;
      say(
        `Искрон: нужен вход — ${next ? `открой ${next} и заверши его` : "заверши его в браузере"}; адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token. Тулы iskron_* поднимутся после входа сами.`,
        "warning"
      );
    },
    done() {
      pending = false;
      url = null;
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

// js/opencode/status.ts
function statusLines(path, builds, login, state2, sessions, spare) {
  return [
    `мост: ${path}`,
    builds,
    login.loginPending ? `вход: НЕ ВЫПОЛНЕН — ${login.loginUrl ? `открой в браузере ${login.loginUrl}` : "заверши вход в браузере"}. Адрес локальный: с другой машины — ssh -L <порт>:127.0.0.1:<порт>, либо личный токен в ~/.iskron-bridge/token (скилл establish-mcp).` : state2.serverSeen ? "вход: есть, сервер отвечает" : "вход: мост ещё не ответил (рукопожатие идёт)",
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
var STATUS_TOOL = "iskron_bridge";
var hhmm = () => (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5);
async function setupTools(ctx, say, onChannel, rootOf) {
  const found = findBridge();
  if (!found.path) {
    say(
      "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " + found.tried.join(", ") + ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
      "error"
    );
    return { forget() {
    }, launch: async () => null, stop() {
    } };
  }
  const path = found.path;
  const builds = buildsLine(path, import.meta.url);
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
        onChannel(slot.session, params, !!slot.child);
      },
      (e) => {
        if (slot.ownStop || stopped || !slot.holding) return;
        slot.holding = false;
        onChannel(slot.session, {
          logger: "iskron-channel",
          data: {
            kind: "lost",
            text: `Искрон: слух потерян в ${hhmm()} — мост стояния вышел (${e.message}). Сторож слуха поднимет мост и вернёт место с диска; не ждёшь — iskron_stand.`
          }
        });
      },
      args
    );
    slot.bridge.start();
    shake(slot);
    return slot;
  }
  const keeper = createKeeper({
    say,
    tell: (root, text, child) => onChannel(root, { logger: "iskron-channel", data: { kind: "resumed", text } }, !!child),
    slotFor: (root, touch) => slotFor(root, touch),
    ready: readyFor,
    directoryOf
  });
  const lost = takeLostMarker(authDir());
  let lostWord = lost?.text ?? null;
  if (lost) {
    say(lost.text, "warning");
    keeper.hint(lost.entries);
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
  async function directoryOf(sessionID) {
    try {
      const res = await ctx.session.get({ sessionID });
      const dir = res?.location?.directory ?? res?.data?.location?.directory;
      return typeof dir === "string" && dir.trim() ? dir : null;
    } catch {
      return null;
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
      slot = spare ?? spawn2();
      spare = null;
      slot.session = root;
      slot.dir = dead?.dir ?? slot.dir;
      slot.key = dead?.key ?? slot.key;
      slots.set(root, slot);
      if (lostWord) {
        onChannel(root, { logger: "iskron-channel", data: { kind: "lost", text: lostWord } });
        lostWord = null;
      }
      const s = slot;
      s.resume = keeper.resume(s, root).finally(() => s.resume = null);
    }
    if (touch) slot.lastCall = Date.now();
    return slot;
  }
  const reaper = setInterval(() => {
    const now = Date.now();
    for (const [session, slot] of slots) {
      if (slot.holding || slot.busy > 0 || now - slot.lastCall < IDLE_MS) continue;
      slot.ownStop = true;
      slot.bridge.stop();
      slots.delete(session);
    }
    if (spare && !spare.holding && now - spare.lastCall >= IDLE_MS && state2.serverSeen) {
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
    { loginPending: login.pending, loginUrl: login.url },
    state2,
    slots.size,
    spare ? 1 : 0
  );
  await ctx.tool.transform((editor) => {
    editor.add({
      name: STATUS_TOOL,
      description: "Состояние моста Искрона в этой сессии OpenCode: выполнен ли вход, адрес авторизации, сколько тулов iskron_* поднято. Зови, когда тулов iskron_* нет или они отвечают отказом входа.",
      input: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        return { content: statusText() };
      }
    });
    for (const t of state2.listed) {
      const name = String(t.name);
      editor.add({
        name,
        description: String(t.description ?? ""),
        // JSON Schema сервера без паспорта диалекта — той же срезкой, что у pi.
        input: toParameters(t.inputSchema),
        async execute(input, tool) {
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
  async function callThrough(slot, name, input, sessionID) {
    await awaitReady(slot);
    if (slot.resume) await slot.resume;
    const args = { ...input ?? {} };
    if (standsBy(name, args) && slot.session !== sessionID) {
      slot = childSlot(sessionID, slot);
      await awaitReady(slot);
    }
    if (name === STAND_TOOL) asSatellite(args, slot.satelliteOf);
    if (name === STAND_TOOL && !args.cwd) {
      const dir = slot.dir ??= await directoryOf(slot.session ?? sessionID);
      if (dir) args.cwd = dir;
    }
    const result = await slot.bridge.request("tools/call", { name, arguments: args });
    if (result?.isError) throw new Error(textOf2(result) || `${name}: отказ без текста`);
    if (standsBy(name, args)) keeper.stood(slot);
    return { content: textOf2(result) };
  }
  if (state2.listed.length)
    say(`Искрон: тулов из прошлого списка: ${state2.listed.length}; сверю с сервером.`, "info");
  spare = spawn2();
  let first = spare;
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
        } else {
          shake(first);
        }
        await sleep(AUTH_POLL_MS);
      }
    }
  })();
  const launcher = createLauncher({
    rootOf,
    childSlot: (sessionID, root) => childSlot(sessionID, slots.get(root)),
    async call(slot, name, args, sessionID) {
      slot.busy++;
      try {
        return (await callThrough(slot, name, args, sessionID)).content;
      } finally {
        slot.busy--;
        slot.lastCall = Date.now();
      }
    }
  });
  return {
    launch: launcher.launch,
    forget(session) {
      launcher.forget(session);
      keeper.forget(session);
      const slot = slots.get(session);
      if (!slot) return;
      slots.delete(session);
      slot.ownStop = true;
      slot.bridge.stop();
    },
    stop() {
      stopped = true;
      clearInterval(reaper);
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
  if (!frame || frame.type !== "message" || stackOf(frame) !== "batch" || isDirectWord(frame))
    return false;
  const rk = roomKind(frame);
  return (frame.origin ?? classifyOrigin(frame)) !== "human" || !!rk?.phase || !!rk?.aside;
}
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
    const at = Date.now();
    p.pending = { session: "", inbox: null, at };
    const text = [batchHead(frames), ...batchLines(frames)].join("\n");
    void deliver(p.session, text, `пачка дела (${frames.length})`, "queue", p.child).then((got) => {
      const inbox = got?.inbox && !takenEarly.delete(got.inbox) ? got.inbox : null;
      p.pending = got && inbox ? { session: got.session, inbox, at } : null;
      if (p.held.length) schedule(p);
    });
  }
  function pile(session, child, frame) {
    const key = `${child ? "child" : "root"}:${session ?? ""}`;
    let p = piles.get(key);
    if (!p) piles.set(key, p = { session, child, held: [], timer: null, pending: null });
    if (frame.id && p.held.some((f) => f.id === frame.id)) return;
    p.held.push(frame);
    if (!p.pending && p.held.length >= CASE_BATCH_CAP) return flush(p);
    if (!p.timer) schedule(p);
  }
  function loud(session, text) {
    say(text, "error");
    void deliver(session, text);
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
    onEvent(session, params, child = false) {
      const ev = params?.data;
      if (!ev || typeof ev !== "object") return;
      switch (ev.kind) {
        case "frame": {
          const frame = ev.frame ?? null;
          if (frame?.type === "hello") return say("Искрон: канал слушает", "info");
          if (frame?.type === "status") return;
          if (frame && toPile(frame)) return pile(session, child, frame);
          void deliver(
            session,
            frameToText(frame, ev.raw ?? ""),
            `кадр ${frame?.id ?? "без id"}`,
            "steer",
            child
          );
          return;
        }
        case "dead":
          loud(
            session,
            `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` + (ev.code === 4001 ? ' или action="mint"' : "") + ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен."
          );
          return;
        case "stale":
          if (ev.text) void deliver(session, ev.text, "пачка лежалых кадров", "queue");
          return;
        case "backlog":
          if (ev.text)
            void deliver(session, ev.text, `пачка побудки (${ev.frames?.length ?? 0})`, "queue");
          return;
        case "lost":
          if (ev.text) loud(session, ev.text);
          return;
        case "resumed":
          if (ev.text) {
            say(ev.text, "warning");
            void deliver(session, ev.text, "слово о возвращённом месте");
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
            `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. Привязка записей цела; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека.`
          );
          return;
        case "alive":
          loud(
            session,
            `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; не пройдёт — спроси о токене.`
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
  const out = [];
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
    out.push({ id, description: snippet(String(s?.description ?? "")) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
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
    launch: async () => null,
    stop() {
    }
  };
  try {
    half = await setupTools(ctx, say, onChannel, rootOf);
  } catch (e) {
    say(`Искрон: мост не поднялся — ${e.message}`, "error");
  }
  try {
    await ctx.session.hook("prompt", async (p) => {
      const word = await half.launch(String(p.sessionID), p.prompt.text);
      if (word) p.prompt.text = withWord(p.prompt.text, word);
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
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const ev = event;
        const id = ev?.data?.sessionID;
        switch (ev?.type) {
          case "session.deleted":
            if (!id) break;
            roots.delete(id);
            seen.delete(id);
            half.forget(id);
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
        }
      }
    } catch {
    }
  })();
  return () => {
    controller.abort();
    ch?.stop();
    half.stop();
  };
}
var plugin_default = { id: "iskron", setup };
export {
  plugin_default as default
};
