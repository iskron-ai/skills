import { type Frame } from "./channel.ts";

/**
 * Кадр стояния — текстом в ход агента; одинаково в pi, OpenCode и Codex.
 * Провенанс идёт первой строкой и ЦЕЛИКОМ: по нему кадр судят — кто говорит
 * (стояние, роль, человек), чем удостоверен (auth), каким путём пришёл (via),
 * ответ ли это (in_reply_to), лежалый ли (stale). Тело следом, как есть:
 * телу любой держатель адреса придаст любой вид, происхождению — нет.
 */
export function frameToText(frame: Frame | null | undefined, raw: string): string {
  if (!frame) return `Кадр канала Искрона:\n${raw}`;
  const p = (frame.provenance ?? {}) as Record<string, unknown>;
  const from = p.from_standing || (p.from_karta_seq != null ? `#${p.from_karta_seq}` : null);
  const head = from ? `Кадр канала Искрона от ${from}` : "Кадр канала Искрона";
  const facts: string[] = [];
  if (p.from_karta_seq != null) facts.push(`роль #${p.from_karta_seq}`);
  if (p.user)
    facts.push(`человек @${p.user}` + (p.user_karta_seq != null ? ` (#${p.user_karta_seq})` : ""));
  if (p.auth) facts.push(`auth ${p.auth}`);
  if (p.via) facts.push(`via ${p.via}`);
  if (p.in_reply_to) facts.push(`ответ на ${p.in_reply_to}`);
  if (frame.id) facts.push(`id ${frame.id}`);
  if (frame.received_at) facts.push(`принят ${frame.received_at}`);
  if (frame.stale) facts.push("stale: унаследован от другого места");
  const body = typeof frame.body === "string" ? frame.body : raw;
  return `${head}${facts.length ? ` [${facts.join(" · ")}]` : ""}:\n\n${body}`;
}
