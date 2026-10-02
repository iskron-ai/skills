// Слова человека в полёте (#5953) — память двери моста: тело такого слова —
// слово человека, не кадр пачки (roomstack.ts). Ключ — нумерация, дело и номер
// записи: номер свой в каждом деле (граф nks-dev: #6576, shared/numbering.ts).
import { type Frame } from "../shared/channel.ts";
import { numberedKey } from "../shared/numbering.ts";

/** Сколько слов человека в полёте помнить до их тела. */
const HUMAN_WORDS_KEEP = 200;

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
export const idOf = (v: unknown): string =>
  typeof v === "number" || (typeof v === "string" && v) ? String(v) : "";
/** entry_id записи дела: из строки журнала, иначе из конверта. */
const entryOf = (frame: Frame): string => {
  const f = rec(frame);
  return idOf(rec(f.line).entry_id ?? f.entry_id);
};
/** Дело кадра (id, иначе seq); "" — кадр без дела, и запись узнаётся одним номером. */
const caseOf = (frame: Frame): string => {
  const room = rec(rec(frame).room);
  return idOf(room.id) || idOf(room.seq);
};
const wordKey = (frame: Frame, entry: string): string =>
  entry ? numberedKey(frame, `${caseOf(frame)}|${entry}`) : "";
/** Кадр held — то слово, чьё тело body несёт (word — запись слова в деле тела). */
export const isWordOf = (held: Frame, body: Frame, word: string): boolean =>
  !!word && wordKey(held, entryOf(held)) === wordKey(body, word);

export class HumanWords {
  private readonly words = new Set<string>();

  /** Слово человека в полёте — по его собственной записи. */
  remember(said: Frame): void {
    const key = wordKey(said, entryOf(said));
    if (!key) return;
    this.words.add(key);
    const oldest = this.words.values().next();
    if (this.words.size > HUMAN_WORDS_KEEP && !oldest.done) this.words.delete(oldest.value);
  }

  /** true — тело несёт слово человека в полёте (word — запись слова в деле тела); память снята. */
  forget(body: Frame, word: string): boolean {
    const key = wordKey(body, word);
    return !!key && this.words.delete(key);
  }
}
