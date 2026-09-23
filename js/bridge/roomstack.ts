// Кадр комнаты по словарю родов — у моста (граф nks-dev: #5851). Клиенты
// уведомлений (pi, OpenCode) решают путь кадра сами; сторожам (Claude Code под
// Monitor, Codex, сторож выхода) пачку копит мост: кадр с event_kind рода
// «в пачку» ложится в пачку своей двери и уходит по окну, по полной пачке или
// перед прерывающим кадром — порядок цел. Пачка уходит залпом обычных событий
// frame (слово шапки у каждого своё) за одной строкой note: сторож любой
// редакции печатает их как кадры. Кадр без event_kind словарь не трогает: он
// идёт сразу, как прежде. Кольцо двери при этом получает каждый кадр (hold.ts).
import { type Frame } from "../shared/channel.ts";
import { byKind, roomKind, stackOf } from "../shared/room-kinds.ts";
import { type ChannelEvent, type Door } from "./door.ts";
import { log } from "./streams.ts";

/** Окно пачки; переменная — шов для проб, не ручка человека. */
const ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 60_000;
/** Полная пачка уходит сразу, не дожидаясь окна: кадр не отбрасывается никогда. */
const ROOM_BATCH_CAP = 20;

export class RoomBatch {
  private readonly held: { raw: string; frame: Frame }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private emit: ((ev: ChannelEvent) => void) | null = null;

  add(raw: string, frame: Frame, emit: (ev: ChannelEvent) => void): void {
    this.emit = emit;
    this.held.push({ raw, frame });
    if (this.held.length >= ROOM_BATCH_CAP) return this.flushNow();
    this.timer ??= setTimeout(() => this.flushNow(), ROOM_BATCH_MS).unref();
  }

  /** Лежит ли кадр в копящейся пачке — кольцо не отдаёт его прицепившемуся отдельно (door.ts). */
  holds(frame: Frame | null): boolean {
    return !!frame && this.held.some((h) => h.frame === frame);
  }

  /** Отдать накопленное сейчас: по окну, по полной пачке, перед прерывающим, при отпускании. */
  flushNow(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const got = this.held.splice(0);
    const emit = this.emit;
    if (!got.length || !emit) return;
    const of = got.length;
    emit({
      kind: "note",
      text:
        `Комната: кадров ${of} — накопились, не прерывая хода; следом все по порядку; ` +
        'полностью — iskron_channel(action="history").',
    });
    got.forEach((h, i) =>
      emit({ kind: "frame", raw: h.raw, frame: h.frame, batch: { at: i + 1, of } }),
    );
  }
}

/** Род, мосту неизвестный, — строкой в лог моста: новый род должен быть замечен. */
export function noteRoomKind(frame: Frame): void {
  const rk = roomKind(frame);
  if (rk && !rk.known)
    log(`room frame ${String(frame.id ?? "?")}: ${rk.words} — batched, not interrupting`);
}

/** Кадр-сообщение для сторожей: true — лёг в пачку и сейчас не рассылается; false — идёт сейчас, после накопленного. */
export function batchForWatchdogs(
  d: Door,
  raw: string,
  frame: Frame,
  emit: (ev: ChannelEvent) => void,
): boolean {
  if (byKind(frame) && stackOf(frame) === "batch") {
    d.roomBatch.add(raw, frame, emit);
    return true;
  }
  d.roomBatch.flushNow();
  return false;
}
