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
  closing: "ведущий {author} предлагает закрыть дело до {ends_at}{; свидетельства: evidence}",
  closing_may: 'ты можешь возразить — iskron_case(action="object", in_reply_to={entry_id})',
  closing_not: "возражать не тебе",
  closed: "дело закрыто: {reason}",
  objection: "{author} возражает против закрытия: {reason}",
  late_objection: "{author} возразил после закрытия",
  progress: "{author}: [{key}] {done} = {verdict}{; note}",
  lead: "ведёт {author}",
  opened: "дело открыл {author}",
  joined: "вошёл {author}",
  left: "вышел {author}",
  invite: "{who} приглашён",
  withdraw: "приглашение отозвано",
  accepted: "{who} принял приглашение",
  node: "в деле узел #{seq} {name} ({realm})",
  link: "дело связано с {room}",
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

/** Своё стояние кадра для ключа invite — id места и его адрес: формат ключа (#5893 §4.2) ещё не подтверждён. */
const mineOf = (frame: Rec): string[] =>
  [str(frame.to_standing_id), str(frame.to_standing)].filter(Boolean);

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
    // Ключ несёт id; имя приглашённого — в полях строки (наблюдено на бою: standing/karta с name).
    who: whoOf(fields) || after(key, "invite:"),
    room: after(key, "link:"),
    seq: node.seq,
    name: node.name,
    realm: node.realm,
  };
  const rule = RULES[kind];
  if (!rule) return { kind, rule: "batch", words: fill(WORDS.unknown, values), known: false };
  let words = fill(WORDS[kind], values);
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

/** Решает ли путь кадра словарь: только у кадра с event_kind room.*; прочим — прежний путь харнеса. */
export const byKind = (frame: Frame | null | undefined): boolean => roomKind(frame) !== null;

/**
 * Путь кадра: у кадра с event_kind — правило рода; у прочих — своя стопка
 * кадра, как читал её плагин OpenCode до словаря (defer — в пачку).
 */
export const stackOf = (frame: Frame | null | undefined): Stack =>
  roomKind(frame)?.rule ??
  ((frame as Rec | null | undefined)?.stack === "defer" ? "batch" : "interrupt");
