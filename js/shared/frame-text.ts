import { classifyOrigin, type Frame } from "./channel.ts";

const ENVELOPE_KEYS = ["id", "received_at", "stale", "content_type", "body_chars", "body_read"];

/**
 * Кадр стояния — текстом в ход агента; одинаково в pi, OpenCode и Codex.
 * Первая строка говорит, КТО это, словами, которые агент различает без разбора
 * JSON: платформа (побудка, не человек), человек, брат по роли, делатель другой
 * роли. Дальше шапка ТЕХНИЧЕСКАЯ и без перевода: провенанс — тем JSON, каким
 * платформа его наблюдала, конверт кадра — своими ключами; по ним кадр судят.
 * Тело следом, как есть.
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
  if (frame.provenance) lines.push(`provenance: ${JSON.stringify(frame.provenance)}`);
  const envelope: Record<string, unknown> = {};
  for (const k of ENVELOPE_KEYS) if (frame[k] !== undefined) envelope[k] = frame[k];
  if (Object.keys(envelope).length) lines.push(`frame: ${JSON.stringify(envelope)}`);
  const body = typeof frame.body === "string" ? frame.body : raw;
  return `${lines.join("\n")}\n\n${body}`;
}
