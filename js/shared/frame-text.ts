import { classifyOrigin, type Frame } from "./channel.ts";
import { L } from "./lang.ts";
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
  if (!frame) return `${L("Кадр канала Искрона", "Iskron channel frame")}:\n${raw}`;
  const p = frame.provenance ?? {};
  const origin = frame.origin ?? classifyOrigin(frame);
  const standing = p.from_standing
    ? L(` — стояние ${p.from_standing}`, ` — standing ${p.from_standing}`)
    : "";
  const role =
    p.from_karta_seq != null
      ? L(`роли #${p.from_karta_seq}`, `role #${p.from_karta_seq}`)
      : L("роли неизвестной", "unknown role");
  const who =
    origin === "platform"
      ? L(
          "от ПЛАТФОРМЫ — побудка, не человек и не делатель",
          "from the PLATFORM — a wake-up, not a human and not a doer",
        )
      : origin === "human"
        ? L(`от ЧЕЛОВЕКА`, `from a HUMAN`) + `${p.user ? ` @${p.user}` : ""} (${role})${standing}`
        : origin === "sibling"
          ? L(
              `от БРАТА по твоей роли (#${p.from_karta_seq})${standing} — другое стояние той же роли`,
              `from a SIBLING of your role (#${p.from_karta_seq})${standing} — another standing of the same role`,
            )
          : L(`от делателя ${role}${standing}`, `from a doer of ${role}${standing}`);
  const lines = [`${L("Кадр канала Искрона", "Iskron channel frame")} ${who}`];
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
      : (typeof f.kind === "string" ? L(`, род ${f.kind}`, `, kind ${f.kind}`) : "") +
        (typeof f.stack === "string" ? L(`, стопка ${f.stack}`, `, stack ${f.stack}`) : "");
    // Обратного адреса у кадра комнаты нет: send стоянию туда не доходит; ход
    // для комнат — в списке тулов сессии. Платформенная запись ответа не ждёт.
    lines.push(
      origin === "platform"
        ? L(`запись ДЕЛА${zachin}${words}`, `CASE record${zachin}${words}`)
        : L(
            `слово ДЕЛА${zachin}${words} — ответ идёт записью в то же дело с in_reply_to по id слова (ход для дел — в списке тулов сессии), не send стоянию`,
            `CASE message${zachin}${words} — answer with a record in the same case, in_reply_to the message id (the case move is in the session's tool list), not a send to the standing`,
          ),
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
  const words = rk?.words ?? `${L("кадр", "frame")} ${typeof f.id === "string" ? f.id : "?"}`;
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
