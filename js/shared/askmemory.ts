// Память вопросов мне (граф nks-dev: роды #6867, доля моста #6868): какой вопрос
// на ключе дела задан мне и ещё открыт. Вопрос гаснет, когда последняя строка
// его ключа больше не он (#6867): снятие (progress с fields.withdraws), ответ
// другого места моей роли (адресован спросившему), переспрос другому (новый ask
// на ключе) — их месту несут словами; «принята» гасит молча. Свежий вопрос на
// ключе, где мой уже погас, — не мне.
//
// Хранилище — набор строк: у процесса своя память, у моста — .seen места, чтобы
// сторож выхода и перезапущенный мост узнали гасящее (bridge/addressmark.ts).
// Записи: open — `<основа>#<номер ask>`, погасший — `off:<основа>#<номер>`;
// основа — место читателя, дело и ключ строки в счёте кадра (#6576).
import { askedMine, byMe } from "./asks.ts";
import { type Frame } from "./channel.ts";
import { numberedKey } from "./numbering.ts";
import { mineOf, obj, type Rec, str } from "./room-fields.ts";

/** Хранилище памяти: что есть, что добавить, что перебрать. */
export interface AskStore {
  has(s: string): boolean;
  add(s: string): void;
  keys(): Iterable<string>;
}

const baseOf = (frame: Rec): string =>
  numberedKey(
    frame as Frame,
    `${mineOf(frame)[0] ?? ""}|${str(obj(frame.room).id) || str(obj(frame.room).seq)}|${str(obj(frame.line).key)}`,
  );
const lineOf = (frame: Rec): Rec => obj(frame.line);
const kindOf = (frame: Rec): string => str(lineOf(frame).kind);
const numOf = (frame: Rec): string => str(lineOf(frame).entry_id ?? frame.entry_id);

/** Номера моих открытых вопросов на ключе кадра. */
function openOn(store: AskStore, frame: Rec): string[] {
  const base = `${baseOf(frame)}#`;
  const out: string[] = [];
  for (const s of store.keys())
    if (s.startsWith(base) && !store.has(`off:${s}`)) out.push(s.slice(base.length));
  return out;
}

/**
 * Кадр гасит мой открытый вопрос: снятие его номера, ответ на него, переспрос
 * другому на его ключе. Своя запись — эхо, гасить у меня нечего.
 */
export function closesMine(store: AskStore, frame: Rec): boolean {
  if (byMe(frame) || !str(lineOf(frame).key)) return false;
  const open = openOn(store, frame);
  if (!open.length) return false;
  const kind = kindOf(frame);
  if (kind === "progress") return open.includes(str(obj(lineOf(frame).fields).withdraws));
  if (kind === "answer")
    return open.includes(str(lineOf(frame).refers_to) || str(frame.in_reply_to));
  return kind === "ask" && !askedMine(frame, obj(lineOf(frame).fields));
}

/**
 * Записать кадр в память: вопрос мне — открыт; снятие его номера — погас;
 * «принята» и переспрос на ключе — погас весь ключ. Ответ ключ не гасит:
 * отвеченный вопрос ещё переспрашивают (#6778).
 */
export function noteAsk(store: AskStore, frame: Rec): void {
  if (!str(lineOf(frame).key)) return;
  const kind = kindOf(frame);
  const fields = obj(lineOf(frame).fields);
  const base = `${baseOf(frame)}#`;
  if (kind === "ask" && askedMine(frame, fields)) {
    // Один открытый вопрос на ключ: новый вопрос мне гасит прежний; повтор того
    // же кадра — не новый вопрос, себя не гасит.
    const own = numOf(frame);
    if (store.has(`${base}${own}`)) return;
    for (const n of openOn(store, frame)) store.add(`off:${base}${n}`);
    store.add(`${base}${own}`);
    return;
  }
  if (kind === "progress" && str(fields.withdraws))
    store.add(`off:${base}${str(fields.withdraws)}`);
  else if ((kind === "ack" || kind === "ask") && !byMe(frame))
    for (const n of openOn(store, frame)) store.add(`off:${base}${n}`);
}

const ASKS_KEPT = 512;
const kept = new Set<string>();
/** Память этого процесса — старшие записи уходят за пределом. */
export const processAsks: AskStore = {
  has: (s) => kept.has(s),
  add: (s) => {
    kept.add(s);
    for (const old of kept) {
      if (kept.size <= ASKS_KEPT) break;
      kept.delete(old);
    }
  },
  keys: () => kept,
};
