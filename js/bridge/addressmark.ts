// Адресованность тела слова в две фазы и гасящего вопрос мне — на самом кадре
// (граф nks-dev: #6574, роды вопроса — #6867, память вопросов — askmemory.ts).
//
// Тело слова признаков адресованности не несёт: им адресовано слово в полёте.
// Так же гасящее вопрос мне — снятие, ответ другого места моей роли, переспрос
// другому: адресата у них нет. Сторож выхода выходит на первом кадре, второй
// приходит новому процессу — память процесса его не узнает. Мост видит оба:
// метит второй addressed; первый помнит на диске — слово в .seen места, вопрос
// в его .asks (askdisk.ts), — чтобы узнать второй и после своего перезапуска.
// Решение моста о кадре вопроса — единственное: кадр несёт asks_decided, и
// плагины и сторожа своей памятью вопросов его не перерешают.
import { addressedToMine, wordKeyOf } from "../shared/addressed.ts";
import { closesMine, noteAsk } from "../shared/askmemory.ts";
import { ASK_KINDS } from "../shared/asks.ts";
import { type Frame } from "../shared/channel.ts";
import { roomKind } from "../shared/room-kinds.ts";
import { noteSeen } from "../shared/seen.ts";
import { diskAsks } from "./askdisk.ts";

const markOf = (frame: Frame): string => `word:${wordKeyOf(frame)}`;

/** Слово в полёте и вопрос мне — в память; тело и гасящее вопрос — пометкой addressed. */
export function markAddressed(frame: Frame, seenPath: string, seen: Set<string>): void {
  const rk = roomKind(frame);
  if (rk?.kind === "said" && rk.phase === "pending") {
    if (addressedToMine(frame)) noteSeen(seenPath, markOf(frame), seen);
  } else if (rk?.kind === "body" && !rk.aside) {
    if (seen.has(markOf(frame)) || addressedToMine(frame)) frame.addressed = true;
  } else if (rk && (ASK_KINDS.has(rk.kind) || rk.kind === "progress")) {
    // Решение — один раз на кадр, в .asks рядом с вопросами: повтор того же кадра
    // платформой (мост умер в окне пачки) находит его, хотя вопрос уже погашен.
    const hit = `hit:${typeof frame.id === "string" ? frame.id : ""}`;
    const store = diskAsks(seenPath);
    if (store.has(hit)) frame.addressed = true;
    else if (closesMine(store, frame as Record<string, unknown>)) {
      frame.addressed = true;
      if (typeof frame.id === "string") store.add(hit);
    }
    noteAsk(store, frame as Record<string, unknown>);
    (frame as Record<string, unknown>).asks_decided = true;
  }
}
