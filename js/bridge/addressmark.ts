// Адресованность тела слова в две фазы — на самом кадре (граф nks-dev: #6574).
//
// Тело слова признаков адресованности не несёт: им адресовано слово в полёте.
// Сторож выхода выходит на первой фазе, тело приходит новому процессу — память
// процесса его не узнает. Мост видит обе фазы и метит тело addressed; слово в
// полёте помнит в памяти отданного места (.seen), чтобы узнать тело и после
// своего перезапуска и в лежалых.
import { addressedToMine, wordKeyOf } from "../shared/addressed.ts";
import { type Frame } from "../shared/channel.ts";
import { roomKind } from "../shared/room-kinds.ts";
import { noteSeen } from "../shared/seen.ts";

const markOf = (frame: Frame): string => `word:${wordKeyOf(frame)}`;

/** Слово в полёте, адресованное месту, — в память; его тело — пометкой addressed. */
export function markAddressed(frame: Frame, seenPath: string, seen: Set<string>): void {
  const rk = roomKind(frame);
  if (rk?.kind === "said" && rk.phase === "pending") {
    if (addressedToMine(frame)) noteSeen(seenPath, markOf(frame), seen);
  } else if (rk?.kind === "body" && !rk.aside) {
    if (seen.has(markOf(frame)) || addressedToMine(frame)) frame.addressed = true;
  }
}
