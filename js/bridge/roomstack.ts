// Кадр комнаты по словарю родов — у моста (граф nks-dev: #5851). Клиенты
// уведомлений (pi, OpenCode) решают путь кадра сами; сторожам (Claude Code под
// Monitor, Codex, сторож выхода) пачку копит мост: кадр с event_kind рода
// «в пачку» ложится в пачку своей двери и уходит по окну, по полной пачке или
// перед прерывающим кадром — порядок цел. Пачка уходит залпом обычных событий
// frame с меткой batch за строкой-шапкой note (at: 0) с указателем на history:
// сторож печатает кадры по строке, без конвертов. Слово человека в пачку не
// ложится. Кадр без event_kind словарь не трогает: он
// идёт сразу, как прежде. Кольцо двери при этом получает каждый кадр (hold.ts).
import { classifyOrigin, type Frame } from "../shared/channel.ts";
import { batchHead, foldAsides } from "../shared/frame-text.ts";
import { byKind, roomKind, stackOf } from "../shared/room-kinds.ts";
import { deliveredKeys, noteSeen } from "../shared/seen.ts";
import { type ChannelEvent, type Door } from "./door.ts";
import { log } from "./streams.ts";

/** Окно пачки; переменная — шов для проб, не ручка человека. */
const ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 60_000;
/** Полная пачка уходит сразу, не дожидаясь окна: кадр не отбрасывается никогда. */
const ROOM_BATCH_CAP = 20;
/** Сколько слов человека в полёте помнить до их тела. */
const HUMAN_WORDS_KEEP = 200;

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const idOf = (v: unknown): string =>
  typeof v === "number" || (typeof v === "string" && v) ? String(v) : "";
/** entry_id записи дела: из строки журнала, иначе из конверта. */
const entryOf = (frame: Frame): string => {
  const f = rec(frame);
  return idOf(rec(f.line).entry_id ?? f.entry_id);
};

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

  /** entry_id слов человека в полёте: их тело — слово человека, не кадр пачки. */
  private readonly humanWords = new Set<string>();

  rememberHumanWord(entry: string): void {
    if (!entry) return;
    this.humanWords.add(entry);
    const oldest = this.humanWords.values().next();
    if (this.humanWords.size > HUMAN_WORDS_KEEP && !oldest.done)
      this.humanWords.delete(oldest.value);
  }

  /** true — это было слово человека в полёте; память о нём снята. */
  forgetHumanWord(entry: string): boolean {
    return !!entry && this.humanWords.delete(entry);
  }

  /** Вынуть из копящейся пачки слово в полёте, чей текст пришёл: отдан он будет своим телом. */
  dropWord(entry: string, dropped: (frame: Frame) => void): void {
    for (let i = this.held.length - 1; i >= 0; i--) {
      if (entryOf(this.held[i].frame) !== entry) continue;
      dropped(this.held[i].frame);
      this.held.splice(i, 1);
    }
    if (!this.held.length && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
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
    const frames = got.map((h) => h.frame);
    const fold = foldAsides(frames);
    emit({ kind: "note", text: batchHead(frames), batch: { at: 0, of } });
    got.forEach((h, i) =>
      emit({
        kind: "frame",
        raw: h.raw,
        frame: h.frame,
        batch: {
          at: i + 1,
          of,
          ...(fold[i] === null
            ? { folded: true }
            : roomKind(h.frame)?.aside
              ? { fold: fold[i] ?? 1 }
              : {}),
        },
      }),
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
  const rk = roomKind(frame);
  const f = rec(frame);
  let human = (frame.origin ?? classifyOrigin(frame)) === "human";
  // Слово в две фазы (#5953): слово человека в полёте и обрыв идут по словарю,
  // в пачку; тело его слова — слово человека: отдельным событием, а само слово
  // в полёте из копящейся пачки вынимается — будит одно событие, и в нём текст.
  if (rk?.kind === "said" && rk.phase === "pending" && human)
    d.roomBatch.rememberHumanWord(entryOf(frame));
  if (rk?.kind === "body") {
    const word = idOf(rec(f.line).refers_to ?? f.in_reply_to);
    if (d.roomBatch.forgetHumanWord(word) && rk.phase !== "aborted") {
      human = true;
      frame.origin = "human"; // шапка кадра называет человека, а не место его моста
      d.roomBatch.dropWord(word, (said) => {
        for (const k of deliveredKeys(said)) noteSeen(d.seenPath, k, d.seen);
      });
    }
  }
  // Слово человека в пачку не ложится: какая бы ни была стопка, оно идёт сейчас.
  // Кроме адресного не мне (#6081): оно и от человека — фактом в пачку.
  if ((!human || rk?.phase || rk?.aside) && byKind(frame) && stackOf(frame) === "batch") {
    d.roomBatch.add(raw, frame, emit);
    return true;
  }
  d.roomBatch.flushNow();
  return false;
}
