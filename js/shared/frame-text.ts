import { classifyOrigin, type Frame } from "./channel.ts";

/** Ключи кадра, которые печатаются не в конверте: тело — следом, провенанс и штампы моста — своими строками. */
const NOT_ENVELOPE = new Set(["body", "provenance", "type", "origin"]);
/** Порядок первых ключей конверта; остальное — как пришло (конверт комнаты: room, entry_id, kind, stack, …). */
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
    const f = frame as Record<string, unknown>;
    const zachin = typeof room.zachin === "string" ? ` «${room.zachin}»` : "";
    const kind = typeof f.kind === "string" ? `, род ${f.kind}` : "";
    const stack = typeof f.stack === "string" ? `, стопка ${f.stack}` : "";
    // Обратного адреса у кадра комнаты нет: send стоянию туда не доходит; ход
    // для комнат — в списке тулов сессии. Платформенная запись ответа не ждёт.
    lines.push(
      origin === "platform"
        ? `запись КОМНАТЫ${zachin}${kind}${stack}`
        : `слово КОМНАТЫ${zachin}${kind}${stack} — ответ идёт записью в ту же комнату с in_reply_to по id слова (ход для комнат — в списке тулов сессии), не send стоянию`,
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
