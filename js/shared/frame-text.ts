import { classifyOrigin, type Frame } from "./channel.ts";
import { roomKind } from "./room-kinds.ts";

/** Ключи кадра, которые печатаются не в конверте: тело — следом, провенанс и штампы моста — своими строками. */
const NOT_ENVELOPE = new Set(["body", "provenance", "type", "origin"]);
/** Порядок первых ключей конверта; остальное — как пришло (конверт комнаты: room, entry_id, event_kind, line, stack, …). */
const ENVELOPE_FIRST = ["id", "received_at", "stale", "content_type", "body_chars", "body_read"];

/**
 * Кадр стояния — текстом в ход агента; одинаково в pi, OpenCode и Codex.
 * Первая строка говорит, КТО это, словами, которые агент различает без разбора
 * JSON: платформа (побудка, не человек), человек, брат по роли, делатель другой
 * роли. Дальше шапка ТЕХНИЧЕСКАЯ и без перевода: провенанс — тем JSON, каким
 * платформа его наблюдала, конверт кадра — всеми верхними ключами, какие
 * пришли, а не перечнем: конверт комнаты (room, kind, stack и что придёт
 * следом) едет без правки этого файла. Тело следом, как есть.
 */
export function frameToText(frame: Frame | null | undefined, raw: string): string {
  if (!frame) return `Кадр канала Искрона:\n${raw}`;
  const p = frame.provenance ?? {};
  const origin = frame.origin ?? classifyOrigin(frame);
  const standing = p.from_standing ? ` — стояние ${p.from_standing}` : "";
  const role = p.from_karta_seq != null ? `роли #${p.from_karta_seq}` : "роли неизвестной";
  const who =
    origin === "platform"
      ? "от ПЛАТФОРМЫ — побудка, не человек и не делатель"
      : origin === "human"
        ? `от ЧЕЛОВЕКА${p.user ? ` @${p.user}` : ""} (${role})${standing}`
        : origin === "sibling"
          ? `от БРАТА по твоей роли (#${p.from_karta_seq})${standing} — другое стояние той же роли`
          : `от делателя ${role}${standing}`;
  const lines = [`Кадр канала Искрона ${who}`];
  const room = (frame as Record<string, unknown>).room as Record<string, unknown> | undefined;
  if (room && typeof room === "object") {
    // Слово комнаты: агенту важно узнать это прежде тела — обратного адреса у
    // такого кадра нет, ответ есть запись в ту же комнату, а не send стоянию.
    const zachin = typeof room.zachin === "string" ? ` «${room.zachin}»` : "";
    // Кадр с event_kind — род словами из словаря (room-kinds.ts); без него —
    // прежняя шапка: верхний kind и стопка. Ключи едут в конверте ниже без правки.
    const rk = roomKind(frame);
    const f = frame as Record<string, unknown>;
    const words = rk
      ? `: ${rk.words}`
      : (typeof f.kind === "string" ? `, род ${f.kind}` : "") +
        (typeof f.stack === "string" ? `, стопка ${f.stack}` : "");
    // Обратного адреса у кадра комнаты нет: send стоянию туда не доходит; ход
    // для комнат — в списке тулов сессии. Платформенная запись ответа не ждёт.
    lines.push(
      origin === "platform"
        ? `запись ДЕЛА${zachin}${words}`
        : `слово ДЕЛА${zachin}${words} — ответ идёт записью в то же дело с in_reply_to по id слова (ход для дел — в списке тулов сессии), не send стоянию`,
    );
  }
  if (frame.provenance) lines.push(`provenance: ${JSON.stringify(frame.provenance)}`);
  const envelope: Record<string, unknown> = {};
  const rec = frame as Record<string, unknown>;
  for (const k of ENVELOPE_FIRST) if (rec[k] !== undefined) envelope[k] = rec[k];
  for (const k of Object.keys(rec))
    if (!(k in envelope) && !NOT_ENVELOPE.has(k) && rec[k] !== undefined) envelope[k] = rec[k];
  if (Object.keys(envelope).length) lines.push(`frame: ${JSON.stringify(envelope)}`);
  // Тело не-строка (событие графа через хук — JSON): печатается само тело, не
  // весь кадр заново; конверт и провенанс уже стоят строками выше.
  const body =
    typeof frame.body === "string"
      ? frame.body
      : frame.body === undefined
        ? raw
        : JSON.stringify(frame.body, null, 1).replace(/\n\s*/g, " ");
  return `${lines.join("\n")}\n\n${body}`;
}

/** Начало текста кадра в строке пачки — сколько знаков. */
const BATCH_TEXT = 160;

/**
 * Кадр пачки дела у сторожа — одной строкой: [entry_id] род словами, автор,
 * начало текста. Конверта нет: целиком кадр читается по указателю batchPointer.
 */
export function batchLine(frame: Frame): string {
  const f = frame as Record<string, unknown>;
  const rk = roomKind(frame);
  const line = (f.line ?? {}) as Record<string, unknown>;
  const e = f.entry_id ?? line.entry_id ?? f.id;
  const entry = typeof e === "number" || typeof e === "string" ? e : "?";
  const words = rk?.words ?? `кадр ${typeof f.id === "string" ? f.id : "?"}`;
  const author = rk?.author && !words.includes(rk.author) ? ` — ${rk.author}` : "";
  const body =
    typeof frame.body === "string"
      ? frame.body
      : frame.body === undefined
        ? ""
        : JSON.stringify(frame.body);
  const flat = [...body.replace(/\s+/g, " ").trim()];
  const text = flat.length > BATCH_TEXT ? flat.slice(0, BATCH_TEXT).join("") + "…" : flat.join("");
  return `[${entry}] ${words}${author}${text ? `: ${text}` : ""}`;
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
  if (!since.size) return 'целиком — iskron_channel(action="history")';
  return (
    "целиком — " +
    [...since].map(([args, e]) => `iskron_case(${args}, since=${e - 1})`).join("; ") +
    " (старый тул без since — history с keep_cursor=true)"
  );
}
