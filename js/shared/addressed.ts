// Адресованность записи дела месту читателя — закон доставки (граф nks-dev:
// #6574): в ход текстом входит только адресованное, прочее — числом.
import { classifyOrigin, type Frame } from "./channel.ts";
import { addresseeOf, after, byKind, mineOf, myRole, obj, roomKind, str } from "./room-kinds.ts";

type Rec = Record<string, unknown>;

/** Роды, важные сами по себе: требуют действия читателя (окно возражения — #4928). */
const LOUD_KINDS = new Set(["closing", "closed", "objection", "late_objection"]);

/** Слова в полёте, адресованные месту: ключ — место, дело, запись слова. */
const addressedWords = new Set<string>();
const WORDS_KEPT = 512;
/** Ключ слова в две фазы: место, дело, запись слова — у said в полёте его запись, у body та, на которую оно. */
export function wordKeyOf(frame: Frame): string {
  const f = frame as Rec;
  const line = obj(f.line);
  const entry =
    roomKind(frame)?.kind === "body"
      ? str(line.refers_to) || str(f.in_reply_to) || str(obj(f.word).entry_id)
      : str(line.entry_id ?? f.entry_id);
  return `${mineOf(f)[0] ?? ""}|${str(obj(f.room).id) || str(obj(f.room).seq)}|${entry}`;
}
function rememberWord(key: string): void {
  addressedWords.add(key);
  for (const old of addressedWords) {
    if (addressedWords.size <= WORDS_KEPT) break;
    addressedWords.delete(old);
  }
}

/**
 * Адресовано ли кадр места читателя — закон #6574: в ход текстом входит только
 * адресованное месту — слово ему (addressee), ответ на его запись
 * (in_reply_to_from, #5954), приглашение или его отзыв мне — либо важное:
 * слово рода important (#4939: text | important | direct), роды закрытия и
 * возражения, слово человека; тело слова в две фазы — как его слово (#5953).
 * Адресное слово не мне (#6081) и прочие записи
 * дел текстом не доставляются — числом и указателем (frame-text.ts). Не кадр
 * дела (прямое слово, событие графа) — текстом: закон о записях дел. Кадр
 * дела прежней формы, без event_kind, словарь не трогает — путь прежний.
 */
export function addressedToMine(frame: Frame | null | undefined): boolean {
  if (!frame) return false;
  const f = frame as Rec;
  const room = obj(f.room);
  if (!str(room.seq) && !str(room.id)) return true; // не запись дела — закон о записях дел
  if (!byKind(frame)) return true; // прежняя форма — прежний путь
  const line = obj(f.line);
  const fields = obj(line.fields);
  const rk = roomKind(frame);
  if (rk?.aside) return false; // слово не мне (#6081): факт без тела
  const mine = mineOf(f);
  const hit = (v: unknown): boolean => {
    const a = addresseeOf(v);
    return !!a && mine.length > 0 && a.addr.some((x) => mine.includes(x));
  };
  if (rk?.kind === "body") {
    // У body in_reply_to_from — автор САМОГО слова (#5893 §4.6), а род слова — в
    // его строке (word.line): тело адресовано, когда адресовано его слово —
    // запомненное на фазе said в полёте; эхо своего слова месту не адресовано.
    // Пометка addressed — мостом, видевшим обе фазы (bridge/addressmark.ts):
    // сторож выхода получает тело новым процессом, память ниже его не помнит.
    const word = obj(f.word);
    if (
      f.addressed === true ||
      hit(f.addressee) ||
      str(obj(obj(word.line).fields).kind) === "important" ||
      addressedWords.has(wordKeyOf(frame))
    )
      return true;
  } else if (
    // Слово мне, ответ на мою запись (#5954), помеченное важным: род слова
    // important на конверте или в полях строки. Слово в полёте запоминается —
    // его тело придёт второй фазой без этих признаков.
    hit(f.addressee) ||
    hit(f.in_reply_to_from) ||
    str(f.said) === "important" ||
    str(fields.kind) === "important"
  ) {
    if (rk?.phase === "pending") rememberWord(wordKeyOf(frame));
    return true;
  }
  // Приглашение мне или его отзыв: ключ invite:<моё место>, приглашение роли — моей роли.
  if (rk?.kind === "invite" || rk?.kind === "withdraw") {
    if (mine.includes(after(str(line.key), "invite:"))) return true;
    if (rk.kind === "invite" && myRole(f, fields)) return true;
  }
  // Роды закрытия и возражения важны сами по себе; слово человека — всегда целиком.
  if (rk && LOUD_KINDS.has(rk.kind)) return true;
  // Тело слова человека мост метит origin (roomstack.ts, #5953): провенанс тела его не несёт.
  return (frame.origin ?? classifyOrigin(frame, str(f.karta_seq) || undefined)) === "human";
}
