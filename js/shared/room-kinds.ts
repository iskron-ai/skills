// Словарь родов комнаты: технический кадр комнаты — слово и стопка (граф
// nks-dev: #5851, форма провода — #5893). Решает `event_kind: "room.<род>"`;
// верхний `kind` — лишь переходный запасной путь, когда event_kind нет.
// Правила — кодом (RULES и stackOf), слова — ДАННЫМИ (WORDS): локализация
// заменит таблицу, не код. Одно решение о пути кадра — stackOf, его читают
// мост (пачка для сторожей), плагин OpenCode и расширение pi.
import { type Frame } from "./channel.ts";

/** Куда идёт кадр: прервать идущий ход или лечь в пачку. */
export type Stack = "interrupt" | "batch";

/**
 * Слова родов — данные, не код. `{имя}` — поле строки кадра; `{; имя}` —
 * необязательное поле с разделителем впереди: пустое поле уходит вместе с ним.
 */
export const WORDS: Readonly<Record<string, string>> = {
  said: "слово от {author}",
  closing: "ведущий {author} предлагает закрыть комнату до {ends_at}; свидетельства: {evidence}",
  closing_may: "ты можешь возразить — objection, in_reply_to={entry_id}",
  closing_not: "возражать не тебе",
  closed: "комната закрыта: {reason}",
  objection: "{author} возражает против закрытия: {reason}",
  late_objection: "{author} возразил после закрытия",
  progress: "{author}: [{key}] {done} = {verdict}{; note}",
  lead: "ведёт {author}",
  opened: "комнату открыл {author}",
  joined: "вошёл {author}",
  left: "вышел {author}",
  invite: "{target} приглашён",
  withdraw: "приглашение отозвано",
  accepted: "{target} принял приглашение",
  node: "в комнате узел #{seq} {name} ({realm})",
  link: "комната связана с {room}",
  unknown: "род {kind} мосту неизвестен",
};

/**
 * Правило рода: interrupt и batch — всегда так; stack — по стопке кадра
 * (только у said); mine — прерывает, когда цель — своё стояние (invite).
 */
type Rule = Stack | "stack" | "mine";
const RULES: Readonly<Record<string, Rule>> = {
  said: "stack",
  closing: "interrupt",
  closed: "interrupt",
  objection: "interrupt",
  late_objection: "interrupt",
  invite: "mine",
  progress: "batch",
  lead: "batch",
  opened: "batch",
  joined: "batch",
  left: "batch",
  withdraw: "batch",
  accepted: "batch",
  node: "batch",
  link: "batch",
};

export interface RoomKind {
  /** Род без приставки room. */
  kind: string;
  rule: Stack;
  /** Слово рода для шапки кадра. */
  words: string;
  /** false — род мосту неизвестен: пачка и строка в лог моста. */
  known: boolean;
}

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {};
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";

/** Род кадра комнаты; "" — кадр не технический кадр комнаты. */
function kindOf(frame: Rec): string {
  const ek = frame.event_kind;
  if (typeof ek === "string") return ek.startsWith("room.") ? ek.slice(5) : "";
  // Переходно: event_kind нет — верхний kind конверта комнаты.
  if (typeof frame.room === "object" && frame.room && typeof frame.kind === "string")
    return frame.kind.replace(/^room\./, "");
  return "";
}

/** Кто написал строку: имя (стояние), иначе стояние, иначе платформа. */
function authorOf(line: Rec): string {
  const a = obj(line.author);
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

/** Свои стояния кадра: место, которому он пришёл. */
const mineOf = (frame: Rec): string[] => {
  const to = str(frame.to_standing);
  return to ? [to] : [];
};

/** Технический кадр комнаты — род, правило, слово; null — кадр не такой. */
export function roomKind(frame: Frame | null | undefined): RoomKind | null {
  if (!frame || typeof frame !== "object") return null;
  const f = frame as Rec;
  const kind = kindOf(f);
  if (!kind) return null;
  const line = obj(f.line);
  const fields = obj(line.fields);
  const key = str(line.key);
  const mine = mineOf(f);
  const node = obj(fields.node);
  const values: Rec = {
    kind,
    author: authorOf(line),
    key,
    done: line.done,
    verdict: line.verdict,
    note: line.note,
    ends_at: fields.ends_at,
    evidence: Array.isArray(fields.evidence) ? fields.evidence.map(str).join(", ") : "",
    entry_id: line.entry_id ?? f.entry_id,
    reason: fields.reason,
    target: after(key, "invite:"),
    room: after(key, "link:"),
    seq: node.seq,
    name: node.name,
    realm: node.realm,
  };
  const rule = RULES[kind];
  if (!rule) return { kind, rule: "batch", words: fill(WORDS.unknown, values), known: false };
  let words = fill(WORDS[kind] ?? WORDS.unknown, values);
  if (kind === "closing") {
    const may = Array.isArray(fields.may_object) ? fields.may_object.map(str) : [];
    const mayI = mine.some((m) => may.includes(m));
    words += "; " + fill(mayI ? WORDS.closing_may : WORDS.closing_not, values);
  }
  const stack: Stack =
    rule === "stack"
      ? // Стопка решает только у said; слово без стопки — прежним путём, вставкой.
        f.stack === "defer"
        ? "batch"
        : "interrupt"
      : rule === "mine"
        ? mine.includes(str(values.target))
          ? "interrupt"
          : "batch"
        : rule;
  return { kind, rule: stack, words, known: true };
}

/** Единственное решение о пути кадра: прервать ход или в пачку. Не кадр комнаты — прерывает, как прежде. */
export const stackOf = (frame: Frame | null | undefined): Stack =>
  roomKind(frame)?.rule ?? "interrupt";
