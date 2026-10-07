// Адресованность тела слова в две фазы и снятия вопроса — на самом кадре
// (граф nks-dev: #6574, роды вопроса — #6867).
//
// Тело слова признаков адресованности не несёт: им адресовано слово в полёте.
// Так же гасящее вопрос мне — снятие (progress с номером ask) и ответ другого
// места моей роли (адресован спросившему).
// Сторож выхода выходит на первом кадре, второй приходит новому процессу —
// память процесса его не узнает. Мост видит оба: метит второй addressed;
// первый помнит в памяти отданного места (.seen), чтобы узнать второй и после
// своего перезапуска и в лежалых.
import { addressedToMine, wordKeyOf } from "../shared/addressed.ts";
import { askedMine, askFromPerson, askKeyOf, askLineKeyOf, closedKeyOf } from "../shared/asks.ts";
import { type Frame } from "../shared/channel.ts";
import { roomKind } from "../shared/room-kinds.ts";
import { noteSeen } from "../shared/seen.ts";

const markOf = (frame: Frame): string => `word:${wordKeyOf(frame)}`;
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const fieldsOf = (frame: Frame): Record<string, unknown> => rec(rec(rec(frame).line).fields);

/** Слово в полёте и вопрос, адресованные месту, — в память; тело и снятие — пометкой addressed. */
export function markAddressed(frame: Frame, seenPath: string, seen: Set<string>): void {
  const rk = roomKind(frame);
  // Пачка сторожей узнаёт слово человека по origin (#6867, askFromPerson).
  if (askFromPerson(frame)) frame.origin = "peer";
  if (rk?.kind === "said" && rk.phase === "pending") {
    if (addressedToMine(frame)) noteSeen(seenPath, markOf(frame), seen);
  } else if (rk?.kind === "body" && !rk.aside) {
    if (seen.has(markOf(frame)) || addressedToMine(frame)) frame.addressed = true;
  } else if (rk?.kind === "ask" && askedMine(frame, fieldsOf(frame))) {
    noteSeen(seenPath, `ask:${askKeyOf(frame)}`, seen);
    noteSeen(seenPath, `ask:${askLineKeyOf(frame)}`, seen);
  } else if (rk?.kind === "ask" || rk?.kind === "progress" || rk?.kind === "answer") {
    const k = closedKeyOf(frame);
    if (k && seen.has(`ask:${k}`)) frame.addressed = true;
  }
}
