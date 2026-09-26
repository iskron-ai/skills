// Словарь родов комнаты: технический кадр комнаты — слово и стопка (граф
// nks-dev: #5851, форма провода — #5893). Решает только `event_kind:
// "room.<род>"`. Кадр без event_kind (сегодняшний бой: верхний kind со своей
// стопкой) словарь не трогает: путь у него прежний — у каждого харнеса свой,
// как до словаря. Правила — кодом (RULES и stackOf), слова — ДАННЫМИ (WORDS):
// локализация заменит таблицу, не код.
import { type Frame } from "./channel.ts";
import { L, lang } from "./lang.ts";

/** Куда идёт кадр: прервать идущий ход или лечь в пачку. */
export type Stack = "interrupt" | "batch";

/**
 * Слова родов — данные, не код. `{имя}` — поле строки кадра; `{; имя}` —
 * необязательное поле с разделителем впереди: пустое поле уходит вместе с ним.
 */
export const WORDS: Readonly<Record<string, string>> = {
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
  closing_may:
    'ты можешь возразить — iskron_case(action="object", in_reply_to={entry_id}) (прежнее имя iskron_room)',
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
};

/**
 * Те же роды по-английски (#6080) — именами нормы #6075: case №N, ledger, line,
 * entered / left, invited, leads; ключи и поля — те же, что у WORDS.
 */
export const WORDS_EN: Readonly<Record<string, string>> = {
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
  closing_may:
    'you may object — iskron_case(action="object", in_reply_to={entry_id}) (former name iskron_room)',
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
};

/** Слова записи платформы auto по её code (#5893 §4.2, ступени — #5973); неизвестный code — WORDS.auto. */
export const AUTO_WORDS: Readonly<Record<string, string>> = {
  child_opened: "дочернее дело №{room} открыто",
  child_closing: "дочернее дело №{room} закрывается",
  child_closed: "дочернее дело №{room} закрыто",
  child_late_objection: "позднее возражение в дочернем деле №{room}",
};
export const AUTO_WORDS_EN: Readonly<Record<string, string>> = {
  child_opened: "child case №{room} opened",
  child_closing: "child case №{room} is closing",
  child_closed: "child case №{room} closed",
  child_late_objection: "late objection in child case №{room}",
};

/** Связь дел link по rel (#4915): чем это дело приходится делу №{room}; неизвестный rel — как пришёл. */
export const REL_WORDS: Readonly<Record<string, string>> = {
  parent: "дочернее к нему",
  child: "родительское к нему",
  continues: "продолжает его",
};
export const REL_WORDS_EN: Readonly<Record<string, string>> = {
  parent: "its child",
  child: "its parent",
  continues: "continues it",
};

/** Вердикт строки словом нормы (#744, #6075): провод несёт ok | partial | bad; неизвестный — как пришёл. */
export const VERDICT_WORDS: Readonly<Record<string, string>> = {
  ok: "ok",
  partial: "частично",
  bad: "slop",
};
export const VERDICT_WORDS_EN: Readonly<Record<string, string>> = {
  ok: "ok",
  partial: "partial",
  bad: "slop",
};

/** Таблицы языка поставки (shared/lang.ts). */
const words = () => (lang() === "en" ? WORDS_EN : WORDS);
const autoWords = () => (lang() === "en" ? AUTO_WORDS_EN : AUTO_WORDS);
const relWords = () => (lang() === "en" ? REL_WORDS_EN : REL_WORDS);

/** Слово записи node по op (#6070) — ключ таблицы слов; bound и неизвестный op — WORDS.node. */
const NODE_OPS: Readonly<Record<string, string>> = {
  updated: "node_updated",
  deleted: "node_deleted",
  undeleted: "node_undeleted",
};

/**
 * Правило рода: interrupt и batch — всегда так; stack — по стопке кадра
 * (said и body: стопка — метка слова); mine — прерывает, когда цель — своё
 * стояние или своя роль (invite). Слово в полёте и обрыв — в пачку (#5953).
 */
type Rule = Stack | "stack" | "mine";
const RULES: Readonly<Record<string, Rule>> = {
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
  auto: "batch",
};

export interface RoomKind {
  /** Род без приставки room. */
  kind: string;
  rule: Stack;
  /** Слово рода для шапки кадра. */
  words: string;
  /** Автор записи словами: имя (стояние), иначе стояние, иначе платформа. */
  author: string;
  /** Фаза слова (#5953): said в полёте — pending, обрыв — aborted; иначе null. */
  phase: "pending" | "aborted" | null;
  /** false — род мосту неизвестен: пачка и строка в лог моста. */
  known: boolean;
  /**
   * Адресное слово не мне (#6081) — said и его body: в пачку при любой стопке,
   * без тела. pair — ключ пары в деле (дело, автор слова, адресат); counts —
   * слово ли это (body — продолжение своего слова, счёт не растит); run(n) —
   * строка череды из n слов, закрытой этим кадром (0 — одно тело без слова).
   */
  aside?: { pair: string; counts: boolean; run: (n: number) => string };
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/** Кто написал: имя (стояние), иначе стояние, иначе платформа; a — author строки или место in_reply_to_from. */
function authorOf(author: unknown): string {
  const a = obj(author);
  const name = str(a.name);
  const standing = str(a.standing);
  if (name) return standing ? `${name} (${standing})` : name;
  if (standing) return standing;
  return a.kind === "platform" ? L("платформа", "platform") : "?";
}

const after = (key: string, prefix: string): string =>
  key.startsWith(prefix) ? key.slice(prefix.length) : key;

function fill(template: string, v: Rec): string {
  return template.replace(/\{([^\w{}]*)(\w+)\}/g, (_m, sep: string, name: string) => {
    const x = str(v[name]);
    if (sep) return x ? sep + x : "";
    return x || "?";
  });
}

/** Связанное дело в полях link и auto — {id, seq, zachin} (#5893 §4.3a): seq, иначе id; голая строка — как есть. */
function roomOf(v: unknown): string {
  const r = obj(v);
  return str(r.seq) || str(r.id) || str(v);
}

/** Своё стояние кадра для ключа invite — id места и его адрес: формат ключа (#5893 §4.2) ещё не подтверждён. */
const mineOf = (frame: Rec): string[] =>
  [str(frame.to_standing_id), str(frame.to_standing)].filter(Boolean);

/**
 * Приглашение моей роли (api 0.89.6): ключ несёт id узла роли, поля строки —
 * karta {id, name, seq, realm} (наблюдено на бою), кадр — мой karta_seq. seq
 * принадлежит графу: названные с обеих сторон графы обязаны совпасть.
 */
function myRole(frame: Rec, fields: Rec): boolean {
  const ka = obj(fields.karta);
  const seq = str(ka.seq);
  if (!seq || seq !== str(frame.karta_seq)) return false;
  const theirs = str(ka.realm);
  const mine = str(frame.realm) || str(obj(frame.room).realm);
  return !theirs || !mine || theirs === mine;
}

/** Имя приглашённого из полей строки: место, иначе роль. */
function whoOf(fields: Rec): string {
  const st = obj(fields.standing);
  const ka = obj(fields.karta);
  const name = str(st.name) || str(ka.name);
  const addr = str(st.standing);
  return name && addr ? `${name} (${addr})` : name || addr;
}

/**
 * Адресат слова (api 0.91.3, наблюдено на бою): верхний addressee конверта —
 * строка-адрес места; объект места {standing | handle+name, id, name} тоже
 * принимается. addr — чем сравнивать с моим местом, label — как назвать.
 */
function addresseeOf(v: unknown): { addr: string[]; label: string } | null {
  if (typeof v === "string") return v ? { addr: [v], label: v } : null;
  const o = obj(v);
  const handle = str(o.handle).replace(/^@/, "");
  const standing =
    str(o.standing) || (handle ? `@${handle}${str(o.name) ? `:${str(o.name)}` : ""}` : "");
  const id = str(o.id);
  const name = str(o.standing) ? str(o.name) : "";
  const label = name && standing ? `${name} (${standing})` : standing || str(o.name) || id;
  const addr = [standing, id].filter(Boolean);
  return addr.length ? { addr, label } : null;
}

/** Число слов словом таблицы языка: 1 слово, 3 слова, 5 слов. */
function wordsCount(n: number): string {
  const W = words();
  const m10 = n % 10;
  const m100 = n % 100;
  const w =
    lang() === "en"
      ? n === 1
        ? W.word_one
        : W.word_many
      : m10 === 1 && m100 !== 11
        ? W.word_one
        : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)
          ? W.word_few
          : W.word_many;
  return `${n} ${w}`;
}

/** Технический кадр комнаты (event_kind room.*) — род, правило, слово; null — словарь кадр не решает. */
export function roomKind(frame: Frame | null | undefined): RoomKind | null {
  if (!frame || typeof frame !== "object") return null;
  const f = frame as Rec;
  const ek = f.event_kind;
  if (typeof ek !== "string" || !ek.startsWith("room.")) return null;
  const kind = ek.slice(5);
  const line = obj(f.line);
  const fields = obj(line.fields);
  const key = str(line.key);
  const mine = mineOf(f);
  const node = obj(fields.node);
  // У body строка — запись тела (у обрыва по сроку её автор — платформа);
  // автор самого слова — in_reply_to_from конверта (#5893 §4.5b, §4.6).
  const byWhom = authorOf(
    kind === "body" && Object.keys(obj(f.in_reply_to_from)).length
      ? f.in_reply_to_from
      : line.author,
  );
  const values: Rec = {
    kind,
    author: byWhom,
    key,
    done: line.done,
    verdict:
      (lang() === "en" ? VERDICT_WORDS_EN : VERDICT_WORDS)[str(line.verdict)] ?? line.verdict,
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
    who:
      kind === "joined" || kind === "left"
        ? whoOf({ standing: fields.standing }) || byWhom
        : whoOf(fields) || after(key, "invite:"),
    room: roomOf(fields.room) || after(key, "link:"),
    rel: relWords()[str(fields.rel)] ?? fields.rel,
    code: fields.code,
    seq: node.seq,
    name: node.name,
    realm: node.realm,
    // reasoning дельты узла — тело записи node (line.done, body кадра), не поле (слово api, #6070).
    reasoning: kind === "node" ? line.done || f.body : undefined,
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
      known: false,
    };
  // Слово в две фазы (#5953): said в полёте — признак body_pending в конверте, текста нет;
  // обрыв — body с fields.aborted, автор-платформа — обрыв по сроку.
  const W = words();
  // Адресное слово (#6081): мне — как всякое слово; не мне — фактом в пачку, без тела.
  // Тело (body) несёт addressee своего слова и идёт тем же путём, в ту же пару.
  const to = kind === "said" || kind === "body" ? addresseeOf(f.addressee) : null;
  if (to && mine.length && !to.addr.some((a) => mine.includes(a))) {
    const counts = kind === "said";
    const pair = JSON.stringify([roomOf(f.room), author, to.addr[0]]);
    const word = counts ? values.entry_id : values.refers_to;
    const run = (n: number): string =>
      fill(n === 0 ? W.aside_body : n > 1 ? W.aside_run : W.aside, {
        ...values,
        word,
        addressee: to.label,
        count: wordsCount(n),
      });
    const aside = { pair, counts, run };
    const words = run(counts ? 1 : 0);
    return { kind, rule: "batch", words, author, phase: null, known: true, aside };
  }
  const pending = kind === "said" && f.body_pending === true && !str(f.body) && !str(line.done);
  const aborted = kind === "body" && fields.aborted === true;
  const wordsOf = pending
    ? W.said_pending
    : aborted
      ? obj(line.author).kind === "platform"
        ? W.body_lapsed
        : W.body_aborted
      : kind === "auto"
        ? (autoWords()[str(values.code)] ?? W.auto)
        : // op узла (bound | updated | deleted | undeleted): без op и bound — прежнее слово.
          kind === "node" && NODE_OPS[str(fields.op)]
          ? W[NODE_OPS[str(fields.op)]]
          : W[kind];
  let text = fill(wordsOf ?? "", values);
  if (kind === "closing") {
    // На бою (api 0.88.0) may_object — массив объектов {id, standing, name, karta};
    // id — тот же, что to_standing_id. Голую строку id принимаем тоже.
    const may = Array.isArray(fields.may_object)
      ? fields.may_object.map((m) => (typeof m === "string" ? m : str(obj(m).id)))
      : [];
    const myId = str(f.to_standing_id);
    const mayI = !!myId && may.includes(myId);
    text += "; " + fill(mayI ? W.closing_may : W.closing_not, values);
  }
  const stack: Stack =
    rule === "stack"
      ? // Стопка решает у said и body; слово без стопки — прежним путём, вставкой.
        f.stack === "defer"
        ? "batch"
        : "interrupt"
      : rule === "mine"
        ? mine.includes(str(values.target)) || myRole(f, fields)
          ? "interrupt"
          : "batch"
        : rule;
  // Слово в полёте (текста нет) и обрыв не будят: в пачку при любой стопке.
  const phase = pending ? "pending" : aborted ? "aborted" : null;
  return { kind, rule: phase ? "batch" : stack, words: text, author, phase, known: true };
}

/** Решает ли путь кадра словарь: только у кадра с event_kind room.*; прочим — прежний путь харнеса. */
export const byKind = (frame: Frame | null | undefined): boolean => roomKind(frame) !== null;

/**
 * Путь кадра: у кадра с event_kind — правило рода; у прочих — своя стопка
 * кадра, как читал её плагин OpenCode до словаря (defer — в пачку).
 */
export const stackOf = (frame: Frame | null | undefined): Stack =>
  roomKind(frame)?.rule ??
  ((frame as Rec | null | undefined)?.stack === "defer" ? "batch" : "interrupt");
