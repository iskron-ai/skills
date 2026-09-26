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

// js/shared/standings.ts
import { homedir } from "node:os";
import { join } from "node:path";
var defaultAuthDir = () => join(homedir(), ".iskron-bridge");
var authDirFromEnv = () => process.env.ISKRON_BRIDGE_AUTH_DIR?.trim() || defaultAuthDir();

// js/shared/clients.ts
var PI_CLIENT = "pi-iskron";

// js/shared/lang.ts
import { readFileSync } from "node:fs";
import { join as join2 } from "node:path";
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

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync as readFileSync2 } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.22.0";
function buildOf(selfUrl) {
  try {
    const src = readFileSync2(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
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
var byKind = (frame) => roomKind(frame) !== null;
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

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;

// js/bridge/roomstack.ts
var ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 6e4;

// js/bridge/holdrecord.ts
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;

// js/bridge/sweep.ts
var SEEN_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;

// js/extension/channel.ts
var ASIDE_MS = Number(process.env.ISKRON_PI_ASIDE_MS) || 3e3;
function setupChannel(pi) {
  let ctxRef = null;
  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
  });
  pi.on("session_shutdown", async () => {
    ctxRef = null;
  });
  function loud(text, fatal = true) {
    if (ctxRef?.hasUI) ctxRef.ui.notify(text, fatal ? "error" : "warning");
    pi.sendMessage(
      { customType: "iskron-channel", content: text, display: true, details: { fatal } },
      { triggerTurn: true, deliverAs: "steer" }
    );
  }
  const asides = [];
  let asideTimer = null;
  function flushAsides() {
    if (asideTimer) clearTimeout(asideTimer);
    asideTimer = null;
    const got = asides.splice(0);
    if (!got.length) return;
    pi.sendMessage(
      {
        customType: "iskron-channel",
        content: batchLines(got).join("\n"),
        display: true,
        details: { aside: got.map((f) => f.id ?? null) }
      },
      { triggerTurn: false, deliverAs: "nextTurn" }
    );
  }
  return (params) => {
    const ev = params?.data;
    if (!ev || typeof ev !== "object") return;
    switch (ev.kind) {
      case "frame": {
        const frame = ev.frame ?? null;
        const raw = ev.raw ?? "";
        if (frame?.type === "hello") {
          if (ctxRef?.hasUI) ctxRef.ui.setStatus?.("iskron", "Искрон: канал слушает");
          return;
        }
        if (frame?.type === "status") return;
        if (roomKind(frame)?.aside && frame) {
          asides.push(frame);
          asideTimer ??= setTimeout(flushAsides, ASIDE_MS);
          asideTimer.unref?.();
          return;
        }
        flushAsides();
        const later = byKind(frame) && stackOf(frame) === "batch";
        pi.sendMessage(
          {
            customType: "iskron-channel",
            content: frameToText(frame, raw),
            display: true,
            details: frame ?? { raw }
          },
          { triggerTurn: true, deliverAs: later ? "followUp" : "steer" }
        );
        return;
      }
      case "dead":
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — токен мёртв. Зови iskron_channel(action="connect")` + (ev.code === 4001 ? ' или action="mint"' : "") + ", затем register тем же именем: новый сокет мост возьмёт из ответа сам, перезапуск не нужен."
        );
        return;
      case "stale":
      case "backlog":
        if (ev.text)
          pi.sendMessage(
            {
              customType: "iskron-channel",
              content: ev.text,
              display: true,
              details: ev.kind === "stale" ? { stale: true } : { backlog: true }
            },
            { triggerTurn: true, deliverAs: "steer" }
          );
        return;
      case "evicted":
        loud(
          `Искрон: канал закрыт кодом ${ev.code} — место отняли, слушает другой держатель. Привязка записей цела; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека.`
        );
        return;
      case "alive":
        loud(
          `Искрон: сокет рвут, а служба отвечает (${ev.version ?? ""}) — мост держит место и переоткрывает реже; не пройдёт — спроси о токене.`,
          false
        );
        return;
      case "note":
        if (ctxRef?.hasUI && ev.text) ctxRef.ui.notify(`Искрон: ${ev.text}`, "warning");
        return;
      case "attached":
      case "held":
      case "released":
      case "lost":
      case "resumed":
        return;
    }
  };
}

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
    const join4 = `iskron_case(action="join", room="${room}")`;
    return L(
      `Искрон: строка запуска — не встал: ${why}. Встань сам (iskron_stand) и войди в дело №${l.no}: ${join4}.`,
      `Iskron: launch line — not seated: ${why}. Take your seat yourself (iskron_stand) and enter case №${l.no}: ${join4}.`
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

// js/extension/home-copy.ts
import {
  accessSync,
  chmodSync,
  constants,
  readFileSync as readFileSync3,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, resolve as resolve2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// js/shared/home.ts
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";
var homeBridgePath = () => join3(homedir2(), ".iskron-bridge", "iskron-bridge.mjs");

// js/extension/home-copy.ts
function newer(a, b) {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  if (pa.length !== 3 || pb.length !== 3 || [...pa, ...pb].some((n) => !Number.isInteger(n)))
    return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}
function packagedBridgePath() {
  return resolve2(
    dirname(fileURLToPath2(import.meta.url)),
    "..",
    "skills",
    "establish-mcp",
    "scripts",
    "iskron.mjs"
  );
}
function refreshHomeBridge(notify, canSpeak) {
  if (process.env.ISKRON_BRIDGE_PATH?.trim()) return;
  if (!canSpeak) return;
  let packagedPath;
  try {
    packagedPath = packagedBridgePath();
  } catch {
    return;
  }
  const homePath = homeBridgePath();
  let packaged;
  try {
    packaged = readFileSync3(packagedPath);
  } catch {
    return;
  }
  const vPackaged = versionIn(packaged.toString("utf8"));
  if (!vPackaged) {
    notify(
      "Искрон: в поставке мост есть, но его версия не читается — домашнюю копию не трогаю.",
      "warning"
    );
    return;
  }
  let home;
  try {
    home = readFileSync3(homePath);
  } catch {
    return;
  }
  if (home.equals(packaged)) return;
  const vHome = versionIn(home.toString("utf8"));
  if (vHome && newer(vHome, vPackaged) > 0) {
    notify(
      `Искрон: дома мост ${vHome}, в поставке ${vPackaged} — домашний новее, не трогаю.`,
      "warning"
    );
    return;
  }
  const was = vHome ?? "версия не читается";
  const tmp = `${homePath}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, packaged);
    chmodSync(tmp, 493);
    renameSync(tmp, homePath);
    notify(
      vHome === vPackaged ? `Искрон: мост дома заменён на привезённый поставкой — версия та же (${vPackaged}), байты другие. Грант не тронут.` : `Искрон: мост дома обновлён ${was} → ${vPackaged}. Грант не тронут, он лежит рядом отдельными файлами.`,
      "info"
    );
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    notify(
      `Искрон: мост дома ${was}, в поставке ${vPackaged}, заменить не вышло (${e.message}). Работаю тем, что есть.`,
      "warning"
    );
  }
}
function findBridge() {
  const tried = [];
  const push = (p) => {
    if (!p) return;
    tried.push(p);
  };
  push(
    process.env.ISKRON_BRIDGE_PATH?.trim() ? resolve2(process.env.ISKRON_BRIDGE_PATH.trim()) : null
  );
  try {
    push(packagedBridgePath());
  } catch {
  }
  push(homeBridgePath());
  for (const candidate of tried) {
    try {
      accessSync(candidate, constants.R_OK);
      return { path: candidate, tried };
    } catch {
    }
  }
  return { path: null, tried };
}

// js/extension/tools.ts
var READY_WAIT_MS = Number(process.env.ISKRON_MCP_READY_WAIT_MS || 2e4);
var HANDSHAKE_MS = Number(process.env.ISKRON_MCP_HANDSHAKE_MS || 6e5);
var TICK_MS = 15e3;
var AUTH_POLL_MS = Number(process.env.ISKRON_MCP_AUTH_POLL_MS || 3e3);
var AUTH_PENDING = /authorization required/i;
var PROTOCOL = "2025-06-18";
function textOrThrow(name, result) {
  const text = resultToContent(result).map((c) => c.type === "text" ? c.text : "[image]").join("\n");
  if (result?.isError) throw new Error(text || `${name}: отказ без текста`);
  return text;
}
var callVia = (b) => async (name, args) => textOrThrow(name, await b.request("tools/call", { name, arguments: args }));
function setupBridge(pi, onChannel) {
  let bridge = null;
  const offByUs = /* @__PURE__ */ new Set();
  const known = /* @__PURE__ */ new Set();
  let notify = () => {
  };
  let canSpeak = false;
  let heldName = null;
  let satellite = false;
  async function raise(args = []) {
    refreshHomeBridge(notify, canSpeak);
    const found = findBridge();
    if (!found.path) {
      notify(
        "Искрон: мост не найден — тулов iskron_* в этой сессии не будет. Искал: " + found.tried.join(", ") + ". Задай ISKRON_BRIDGE_PATH или поставь мост скиллом establish-mcp.",
        "error"
      );
      return;
    }
    const b = new Bridge(
      found.path,
      (line) => notify(`Искрон/мост: ${line}`, "info"),
      (method, params) => {
        if (method === "notifications/message" && params?.logger === "iskron-channel") {
          const name = params?.data?.kind === "held" ? params?.data?.place?.name : null;
          if (typeof name === "string" && name) heldName = name;
          onChannel(params);
        }
        if (method === "notifications/tools/list_changed") void relist(b);
      },
      void 0,
      args
    );
    bridge = b;
    satellite = args.includes("--satellite");
    b.start();
    let toldLogin = false;
    const deadline = Date.now() + HANDSHAKE_MS;
    const untilAuthed = async (ask) => {
      for (; ; ) {
        try {
          return await ask();
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (!AUTH_PENDING.test(message) || bridge !== b || Date.now() + AUTH_POLL_MS > deadline)
            throw e;
          if (!toldLogin) {
            toldLogin = true;
            notify(`Искрон: нужен вход — ${message}`, "warning");
          }
          await new Promise((r) => setTimeout(r, AUTH_POLL_MS));
        }
      }
    };
    const init = await untilAuthed(
      () => b.request(
        "initialize",
        {
          protocolVersion: PROTOCOL,
          capabilities: {},
          clientInfo: { name: PI_CLIENT, version: "1" }
        },
        { timeoutMs: HANDSHAKE_MS }
      )
    );
    if (bridge !== b) return b.stop();
    b.notify("notifications/initialized");
    const tools = [];
    let cursor;
    do {
      const page = await untilAuthed(
        () => b.request("tools/list", cursor ? { cursor } : {}, {
          timeoutMs: HANDSHAKE_MS
        })
      );
      for (const t of page?.tools ?? []) tools.push(t);
      cursor = page?.nextCursor;
    } while (cursor);
    if (bridge !== b) return b.stop();
    function registerAll(list) {
      for (const t of list) known.add(String(t.name));
      for (const tool of list) {
        const name = String(tool.name);
        pi.registerTool({
          name,
          label: name,
          description: String(tool.description ?? ""),
          promptSnippet: snippet(String(tool.description ?? "")),
          parameters: toParameters(tool.inputSchema),
          async execute(_toolCallId, params, signal, onUpdate, _c) {
            const live = bridge;
            if (!live) throw new Error(`${name}: мост не поднят в этой сессии`);
            const started = Date.now();
            onUpdate?.({ content: [{ type: "text", text: `Искрон: ${name}…` }], details: {} });
            const tick = setInterval(() => {
              onUpdate?.({
                content: [
                  {
                    type: "text",
                    text: `Искрон: ${name} — ещё жду, ${Math.round((Date.now() - started) / 1e3)} с`
                  }
                ],
                details: {}
              });
            }, TICK_MS);
            tick.unref?.();
            try {
              const result = await live.request(
                "tools/call",
                { name, arguments: params ?? {} },
                { signal }
                // потолка нет: первый вызов может уйти в браузер к человеку
              );
              if (result?.isError) textOrThrow(name, result);
              const content = resultToContent(result);
              return {
                content,
                details: { tool: name, structuredContent: result?.structuredContent }
              };
            } finally {
              clearInterval(tick);
            }
          }
        });
      }
    }
    async function relist(from) {
      if (bridge !== from) return;
      try {
        const fresh = [];
        let next;
        do {
          const page = await from.request("tools/list", next ? { cursor: next } : {}, {
            timeoutMs: HANDSHAKE_MS
          });
          for (const t of page?.tools ?? []) fresh.push(t);
          next = page?.nextCursor;
        } while (next);
        if (bridge !== from) return;
        const kept = new Set(fresh.map((t) => String(t.name)));
        const dropped = tools.map((t) => String(t.name)).filter((n) => !kept.has(n));
        registerAll(fresh);
        const back = [...offByUs].filter((n) => kept.has(n));
        for (const n of dropped) offByUs.add(n);
        for (const n of back) offByUs.delete(n);
        if (dropped.length || back.length)
          pi.setActiveTools([
            .../* @__PURE__ */ new Set([...pi.getActiveTools().filter((n) => !dropped.includes(n)), ...back])
          ]);
        tools.splice(0, tools.length, ...fresh);
        notify(`Искрон: сервер сменил тулы — в сессии зарегистрировано ${fresh.length}.`, "info");
      } catch (e) {
        if (bridge !== from) return;
        notify(
          `Искрон: список тулов после смены на сервере не перечитан — ${e.message}`,
          "warning"
        );
      }
    }
    const listed = new Set(tools.map((t) => String(t.name)));
    const gone = [...known].filter((n) => !listed.has(n));
    const returned = [...offByUs].filter((n) => listed.has(n));
    registerAll(tools);
    for (const n of gone) offByUs.add(n);
    for (const n of returned) offByUs.delete(n);
    if (gone.length || returned.length)
      pi.setActiveTools([
        .../* @__PURE__ */ new Set([...pi.getActiveTools().filter((n) => !gone.includes(n)), ...returned])
      ]);
    const server = init?.serverInfo;
    notify(
      `Искрон: мост поднят (${server?.name ?? "сервер"} ${server?.version ?? ""}), тулов в сессии: ${tools.length}${toldLogin ? " — вход состоялся" : ""}.`,
      "info"
    );
  }
  let raising = Promise.resolve();
  const raiseLoud = (args = []) => raise(args).catch((e) => {
    notify(`Искрон: мост не поднялся — ${e.message}`, "error");
    bridge?.stop();
    bridge = null;
  });
  let prompted = false;
  pi.on("input", async (event) => {
    if (prompted) return { action: "continue" };
    prompted = true;
    const l = parseLaunch(event.text);
    if (!l) return { action: "continue" };
    const of = l.of ?? (process.env.ISKRON_SATELLITE_OF?.trim() || null);
    if (of && !satellite) {
      bridge?.stop();
      bridge = null;
      raising = raiseLoud(["--satellite"]);
    }
    await raising;
    const live = bridge;
    const word = live ? await enterCase(l, callVia(live), of, () => heldName) : `Искрон: строка запуска — мост не поднят, в дело №${l.no} не вошёл.`;
    return { action: "transform", text: withWord(event.text, word) };
  });
  pi.on("session_start", async (_event, ctx) => {
    notify = ctx.hasUI ? (t, l) => ctx.ui.notify(t, l ?? "info") : () => {
    };
    canSpeak = Boolean(ctx.hasUI);
    bridge?.stop();
    bridge = null;
    prompted = false;
    heldName = null;
    const work = raiseLoud();
    raising = work;
    let done = false;
    void work.then(() => {
      done = true;
    });
    await Promise.race([
      work,
      new Promise((r) => {
        const t = setTimeout(() => {
          if (!done) {
            notify(
              "Искрон: мост ещё поднимается — тулы iskron_* появятся, как только ответит.",
              "info"
            );
          }
          r();
        }, READY_WAIT_MS);
        t.unref?.();
      })
    ]);
  });
  pi.on("session_shutdown", async () => {
    bridge?.stop();
    bridge = null;
  });
}

// js/extension/iskron.ts
function iskron_default(pi) {
  const broken = [];
  pi.on("session_start", async (_event, ctx) => {
    if (!broken.length || !ctx.hasUI) return;
    ctx.ui.notify(`Искрон: не встало — ${broken.join("; ")}`, "error");
  });
  let onChannel = () => {
  };
  try {
    onChannel = setupChannel(pi);
  } catch (e) {
    broken.push(`канал: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    setupBridge(pi, (params) => onChannel(params));
  } catch (e) {
    broken.push(`тулы: ${e instanceof Error ? e.message : String(e)}`);
  }
}
export {
  iskron_default as default
};
