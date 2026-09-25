// Словарь родов комнаты: технический кадр комнаты — слово и стопка (граф
// nks-dev: #5851, форма провода — #5893). Решает только `event_kind:
// "room.<род>"`. Кадр без event_kind (сегодняшний бой: верхний kind со своей
// стопкой) словарь не трогает: путь у него прежний — у каждого харнеса свой,
// как до словаря. Правила — кодом (RULES и stackOf), слова — ДАННЫМИ (WORDS):
// локализация заменит таблицу, не код.
import { type Frame } from "./channel.ts";

/** Куда идёт кадр: прервать идущий ход или лечь в пачку. */
export type Stack = "interrupt" | "batch";

/**
 * Слова родов — данные, не код. `{имя}` — поле строки кадра; `{; имя}` —
 * необязательное поле с разделителем впереди: пустое поле уходит вместе с ним.
 */
export const WORDS: Readonly<Record<string, string>> = {
  said: "слово от {author}",
  said_pending: "слово от {author} в полёте — текст придёт следом",
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
  progress: "{author}: [{key}] {done} = {verdict}{; note}",
  opened: "дело открыл {author}",
  joined: "вошёл {who}",
  left: "вышел {who}{; причина: reason}",
  invite: "{author} зовёт {who} в дело",
  withdraw: "приглашение отозвано, отзывает {author}",
  node: "в деле узел #{seq} {name} ({realm}){; reasoning}",
  node_updated: "узел #{seq} {name} обновлён{; reasoning}",
  node_deleted: "узел #{seq} {name} удалён{; reasoning}",
  node_undeleted: "узел #{seq} {name} восстановлен{; reasoning}",
  link: "дело связано с #{room} ({rel})",
  auto: "запись платформы {code} о деле #{room}",
  unknown: "род {kind} мосту неизвестен",
};

/** Слова записи платформы auto по её code (#5893 §4.2, ступени — #5973); неизвестный code — WORDS.auto. */
export const AUTO_WORDS: Readonly<Record<string, string>> = {
  child_opened: "дочернее дело #{room} открыто",
  child_closing: "дочернее дело #{room} закрывается",
  child_closed: "дочернее дело #{room} закрыто",
  child_late_objection: "позднее возражение в дочернем деле #{room}",
};

/** Связь дел link по rel (#4915): чем это дело приходится делу #{room}; неизвестный rel — как пришёл. */
export const REL_WORDS: Readonly<Record<string, string>> = {
  parent: "дочернее к нему",
  child: "родительское к нему",
  continues: "продолжает его",
};

/** Слово записи node по op (#6070); bound и неизвестный op — WORDS.node. */
const NODE_OPS: Readonly<Record<string, string>> = {
  updated: WORDS.node_updated,
  deleted: WORDS.node_deleted,
  undeleted: WORDS.node_undeleted,
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
  return a.kind === "platform" ? "платформа" : "?";
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
    verdict: line.verdict,
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
    rel: REL_WORDS[str(fields.rel)] ?? fields.rel,
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
      words: fill(WORDS.unknown, values),
      author,
      phase: null,
      known: false,
    };
  // Слово в две фазы (#5953): said в полёте — признак body_pending в конверте, текста нет;
  // обрыв — body с fields.aborted, автор-платформа — обрыв по сроку.
  const pending = kind === "said" && f.body_pending === true && !str(f.body) && !str(line.done);
  const aborted = kind === "body" && fields.aborted === true;
  const wordsOf = pending
    ? WORDS.said_pending
    : aborted
      ? obj(line.author).kind === "platform"
        ? WORDS.body_lapsed
        : WORDS.body_aborted
      : kind === "auto"
        ? (AUTO_WORDS[str(values.code)] ?? WORDS.auto)
        : // op узла (bound | updated | deleted | undeleted): без op и bound — прежнее слово.
          kind === "node" && NODE_OPS[str(fields.op)]
          ? NODE_OPS[str(fields.op)]
          : WORDS[kind];
  let words = fill(wordsOf, values);
  if (kind === "closing") {
    // На бою (api 0.88.0) may_object — массив объектов {id, standing, name, karta};
    // id — тот же, что to_standing_id. Голую строку id принимаем тоже.
    const may = Array.isArray(fields.may_object)
      ? fields.may_object.map((m) => (typeof m === "string" ? m : str(obj(m).id)))
      : [];
    const myId = str(f.to_standing_id);
    const mayI = !!myId && may.includes(myId);
    words += "; " + fill(mayI ? WORDS.closing_may : WORDS.closing_not, values);
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
  return { kind, rule: phase ? "batch" : stack, words, author, phase, known: true };
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
