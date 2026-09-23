// Кадр комнаты по словарю родов — у моста (граф nks-dev: #5851). Клиенты
// уведомлений (pi, OpenCode) решают путь кадра сами тем же stackOf; сторожам
// (Claude Code под Monitor, Codex, сторож выхода) пачку копит мост: кадр рода
// «в пачку» ложится в пачку своей двери и уходит одним событием backlog по
// окну, прерывающий сперва отдаёт накопленное — порядок цел. Кольцо двери при
// этом получает каждый кадр (hold.ts).
import { type Frame } from "../shared/channel.ts";
import { roomKind, stackOf } from "../shared/room-kinds.ts";
import { type ChannelEvent, type Door } from "./door.ts";
import { log } from "./streams.ts";

/** Род, мосту неизвестный, — строкой в лог моста: новый род должен быть замечен. */
export function noteRoomKind(frame: Frame): void {
  const rk = roomKind(frame);
  if (rk && !rk.known)
    log(`room frame ${String(frame.id ?? "?")}: ${rk.words} — batched, not interrupting`);
}

/** Кадр-сообщение для сторожей: true — лёг в пачку и сейчас не рассылается; false — идёт сейчас, после накопленного. */
export function batchForWatchdogs(
  d: Door,
  frame: Frame,
  flush: (ev: ChannelEvent) => void,
): boolean {
  if (stackOf(frame) === "batch") {
    d.roomBatch.open(0, flush);
    return d.roomBatch.note(frame);
  }
  d.roomBatch.flushNow();
  return false;
}
