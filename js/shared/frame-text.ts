import { classifyOrigin, type Frame } from "./channel.ts";
import { L } from "./lang.ts";
import { phrase, roomKind } from "./room-kinds.ts";

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const idOf = (v: unknown): string =>
  typeof v === "number" || (typeof v === "string" && v) ? String(v) : "";

/** Роды записи дела, под которыми стоит строка ответа. */
const ANSWERABLE = new Set(["said", "body", "invite", "objection", "late_objection"]);

/** Зачин дела в строке — сколько знаков. */
const ZACHIN = 40;

/** Дело кадра: номер (seq, иначе id), зачин, граф; null — кадр не из дела. */
function caseOf(frame: Frame): { room: string; zachin: string; realm: string } | null {
  const f = frame as Rec;
  const room = rec(f.room);
  const n = idOf(room.seq) || idOf(room.id);
  if (!n) return null;
  const z = typeof room.zachin === "string" ? [...room.zachin.trim()] : [];
  const zachin = z.length > ZACHIN ? z.slice(0, ZACHIN).join("") + "…" : z.join("");
  const realm = idOf(room.realm) || idOf(f.realm);
  return { room: n, zachin, realm };
}

/** Ключ дела кадра — по нему сторож знает, было ли дело в пачке (зачин — при первом). */
export const caseKey = (frame: Frame): string => caseOf(frame)?.room ?? "";

/** «№N «зачин»» — начало строки кадра дела; зачин — по слову withZachin. */
function caseHead(frame: Frame, withZachin: boolean): string {
  const c = caseOf(frame);
  if (!c) return "";
  const no = phrase("case", { room: c.room });
  return withZachin && c.zachin ? `${no} «${c.zachin}»` : no;
}

/** Кто говорит — одно слово из провенанса: человек, роль с местом, брат, платформа. */
function whoOf(frame: Frame, withPlace: boolean): string {
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

/** Текст кадра: строка как есть, JSON-тело (событие графа) — одной строкой. */
function textOf(frame: Frame): string {
  if (roomKind(frame)?.aside) return ""; // адресное слово не мне (#6081) — без тела
  const b = frame.body;
  return typeof b === "string" ? b : b === undefined ? "" : JSON.stringify(b);
}

/** Хвост первой строки: ответ на запись, лежалость, судьба тела. */
function tail(frame: Frame, withReply: boolean): string {
  const f = frame as Rec;
  const parts: string[] = [];
  const to = idOf(f.in_reply_to) || idOf(frame.provenance?.in_reply_to);
  if (withReply && to) parts.push(phrase("reply_to", { id: to }));
  if (frame.stale === true) parts.push(phrase("stale"));
  if (typeof frame.body_read === "string" && frame.body_read !== "history")
    parts.push(phrase("body_read", { how: frame.body_read }));
  return parts.length ? `, ${parts.join(", ")}` : "";
}

/**
 * Кадр стояния — коротко в ход агента, одинаково в pi, OpenCode и сторожах
 * (граф nks-dev: #6081, слово владельца — кадр уже проверен мостом): первая
 * строка — дело, запись, род словами и кто; следом текст один раз; последней —
 * вызов ответа. Провенанс и конверт сырым JSON не печатаются: целиком кадр
 * читается history дела или канала.
 */
export function frameToText(frame: Frame | null | undefined, raw: string): string {
  if (!frame) return raw;
  const f = frame as Rec;
  const origin = frame.origin ?? classifyOrigin(frame);
  const text = textOf(frame);
  const c = caseOf(frame);
  if (c) {
    const rk = roomKind(frame);
    const line = rec(f.line);
    const entry = idOf(f.entry_id) || idOf(line.entry_id);
    const words = rk
      ? rk.words
      : phrase("legacy", { kind: f.kind, stack: typeof f.stack === "string" ? f.stack : "" });
    const author = rk?.author && !words.includes(rk.author) ? rk.author : "";
    const who = origin === "platform" ? "" : whoOf(frame, false);
    const by = [author, who].filter(Boolean).join(", ");
    const withReply = rk?.kind !== "body"; // у тела in_reply_to — его слово, уже в словах
    const head =
      `${caseHead(frame, true)}${entry ? ` [${entry}]` : ""} ${words}` +
      `${by ? ` — ${by}` : ""}${tail(frame, withReply)}`;
    const lines = [head];
    if (text && !words.includes(text.trim())) lines.push(text);
    // Ответ — у слова и записи, ждущей слова; строки гроссбуха, входы, узлы его не ждут,
    // закрытие несёт свой ход (object) в словах.
    const answerable = !rk || ANSWERABLE.has(rk.kind);
    if (answerable && origin !== "platform" && c.realm && entry) {
      const args = `realm="${c.realm}", action="say", room="№${c.room}", in_reply_to=${entry}`;
      lines.push(phrase("answer_case", { args }));
    }
    return lines.join("\n");
  }
  // Прямое слово, побудка, событие графа.
  const p = frame.provenance ?? {};
  const id = idOf(frame.id);
  const lines = [`${whoOf(frame, true) || "?"}${tail(frame, true)}`];
  if (text) lines.push(text);
  if (origin !== "platform" && id && (p.from_standing || p.from_karta_seq != null)) {
    const karta = p.from_karta_seq ?? p.user_karta_seq;
    const args =
      `action="send"${frame.realm ? `, realm="${frame.realm}"` : ""}` +
      `${karta != null ? `, karta=${karta}` : ""}` +
      `${p.from_standing ? `, standing="${p.from_standing}"` : ""}, in_reply_to="${id}"`;
    lines.push(phrase("answer_send", { args }));
  }
  return lines.join("\n");
}

/** Начало текста кадра в строке пачки — сколько знаков. */
const BATCH_TEXT = 160;

/**
 * Кадр пачки дела у сторожа — одной строкой: «№N [entry_id] род словами, автор,
 * начало текста»; зачин дела — при первом его появлении в пачке. Конверта нет:
 * целиком кадр читается по указателю batchPointer. Адресное слово не мне
 * (#6081) — «№N А → Б: слово [id]» без тела; run — число слов череды этой
 * пары, закрытой этим кадром (foldAsides); без него — сам кадр.
 */
export function batchLine(frame: Frame, run?: number, withZachin = true): string {
  const f = frame as Rec;
  const rk = roomKind(frame);
  const head = caseHead(frame, withZachin);
  const pre = head ? `${head} ` : "";
  if (rk?.aside) return pre + (run === undefined ? rk.words : rk.aside.run(run));
  const line = rec(f.line);
  const e = f.entry_id ?? line.entry_id ?? f.id;
  const entry = typeof e === "number" || typeof e === "string" ? e : "?";
  const words = rk?.words ?? `${L("кадр", "frame")} ${typeof f.id === "string" ? f.id : "?"}`;
  const author = rk?.author && !words.includes(rk.author) ? ` — ${rk.author}` : "";
  const flat = [...textOf(frame).replace(/\s+/g, " ").trim()];
  const text = flat.length > BATCH_TEXT ? flat.slice(0, BATCH_TEXT).join("") + "…" : flat.join("");
  const dup = !!text && words.includes(text);
  return `${pre}[${entry}] ${words}${author}${tail(frame, rk?.kind !== "body")}${text && !dup ? `: ${text}` : ""}`;
}

/**
 * Свёртка пачки (#6081): подряд идущие адресные слова не мне одной пары и их
 * тела — одна строка. На кадр: null — свёрнут в строку следующего; n — строка
 * череды из n слов (тело слова не считается; 0 — одно тело без слова). У кадра
 * не из череды — 1.
 */
export function foldAsides(frames: Frame[]): (number | null)[] {
  const asides = frames.map((f) => roomKind(f)?.aside ?? null);
  const out: (number | null)[] = [];
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

/** Строки пачки со свёрткой адресных слов не мне; зачин дела — у первой его строки. */
export function batchLines(frames: Frame[]): string[] {
  const fold = foldAsides(frames);
  const seen = new Set<string>();
  return frames.flatMap((f, i) => {
    const run = fold[i];
    if (run === null) return [];
    const key = caseKey(f);
    const first = !seen.has(key);
    seen.add(key);
    return [batchLine(f, roomKind(f)?.aside ? run : undefined, first)];
  });
}

/** Шапка пачки дела: число кадров и как прочесть их целиком — в шапке, не в конце: обрезка режет хвост. */
export function batchHead(frames: Frame[]): string {
  return L(
    `Дело: кадров ${frames.length} — накопились, не прерывая хода; ` +
      `${batchPointer(frames)}; следом по строке на кадр.`,
    `Case: ${frames.length} frames — gathered without interrupting the turn; ` +
      `${batchPointer(frames)}; one line per frame follows.`,
  );
}

/**
 * Как прочесть пачку целиком: по делу — history с since перед первой записью
 * пачки. since есть у mcp с 0.84.2; старому — запасной ход keep_cursor.
 */
export function batchPointer(frames: Frame[]): string {
  // Дело — граф плюс номер; realm iskron_case требует всегда.
  const since = new Map<string, number>();
  for (const frame of frames) {
    const f = frame as Record<string, unknown>;
    const room = (f.room ?? {}) as Record<string, unknown>;
    const line = (f.line ?? {}) as Record<string, unknown>;
    const n = room.seq ?? room.id;
    const e = Number(f.entry_id ?? line.entry_id);
    if ((typeof n !== "number" && typeof n !== "string") || !Number.isFinite(e)) continue;
    const realm = room.realm ?? f.realm;
    const args =
      (typeof realm === "string" && realm ? `realm="${realm}", ` : "") +
      `action="history", room=${typeof n === "number" ? String(n) : JSON.stringify(n)}`;
    since.set(args, Math.min(since.get(args) ?? e, e));
  }
  const whole = L("целиком — ", "in full — ");
  if (!since.size) return `${whole}iskron_channel(action="history")`;
  return (
    whole +
    [...since].map(([args, e]) => `iskron_case(${args}, since=${e - 1})`).join("; ") +
    L(
      " (старый тул без since — history с keep_cursor=true)",
      " (an older tool without since — history with keep_cursor=true)",
    )
  );
}
