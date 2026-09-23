// Пачка побудки — накопленное уходит одним событием, не по кадру (граф nks-dev: #5140).
//
// Два повода открыть окно: hello с pending > 0 (платформа отдаёт всё ожидавшее
// разом, а плагин вкладывал каждый кадр отдельным ходом) и кадр самой платформы
// (побудка: «подними голову, разбери инбокс» — с ней должно прийти и всё, что
// пришло рядом). Пока окно открыто, живые кадры копятся; по его истечении —
// одно событие kind=backlog с кадрами по received_at, телами (обрезанными,
// как у лежалых) и указанием на history за остальным. Окно у каждого места
// своё (door.ts, #5838): пачка одного графа метится в .seen своего места.
// Тем же классом копится пачка кадров комнаты для сторожей (roomstack.ts, #5851).
import { type Frame } from "../shared/channel.ts";
import { frameToText } from "../shared/frame-text.ts";
import { type ChannelEvent } from "./door.ts";

/** Окно накопления; переменная — шов для проб, не ручка человека. */
const BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;
/**
 * Окно пачки кадров комнаты для сторожей (словарь родов, #5851): кадр рода
 * «в пачку» ждёт до минуты, прерывающий отдаёт накопленное раньше себя.
 */
export const ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 60_000;
const BACKLOG_KEEP = 20;
const BODY_CAP = 800;

const at = (f: Frame): string => (typeof f.received_at === "string" ? f.received_at : "");

/** Шапка пачки: сколько пришло, сколько ждало по hello, сколько здесь. */
type Head = (count: number, expected: number, kept: number) => string;

const wakeHead: Head = (count, expected, kept) =>
  `Побудка: кадров ${count}` +
  (expected ? ` (ожидало в очереди: ${expected})` : "") +
  (count > kept ? `, здесь первые ${kept}` : "") +
  " — пришли одной пачкой; разбери все, а не последний: " +
  'полностью и остальное — iskron_channel(action="history", view="log").';

export const roomHead: Head = (count, _expected, kept) =>
  `Комната: кадров ${count}` +
  (count > kept ? `, здесь первые ${kept}` : "") +
  " — накопились, не прерывая хода; разбери по порядку; " +
  'полностью — iskron_channel(action="history").';

export class Backlog {
  private readonly frames: Frame[] = [];
  private total = 0;
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flush: ((ev: ChannelEvent) => void) | null = null;

  private readonly windowMs: number;
  private readonly head: Head;

  constructor(windowMs = BACKLOG_MS, head: Head = wakeHead) {
    this.windowMs = windowMs;
    this.head = head;
  }

  /** Открыть окно — по hello с pending либо по кадру платформы; открытое не продлевается, только пополняется. */
  open(expected: number, emit: (ev: ChannelEvent) => void): void {
    this.pending = Math.max(this.pending, expected);
    this.flush = emit;
    if (this.timer) return;
    this.timer = setTimeout(() => this.close(), this.windowMs).unref();
  }

  /** Лежит ли кадр в копящейся пачке — кольцо не отдаёт его прицепившемуся отдельно (door.ts). */
  holds(frame: Frame | null): boolean {
    return !!frame && this.frames.includes(frame);
  }

  /** Отдать накопленное сейчас — при отпускании стояния: неотданное не теряется молча. */
  flushNow(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.close();
  }

  /** Положить живой кадр в пачку; false — окна нет, кадр идёт своим путём. */
  note(frame: Frame): boolean {
    if (!this.timer) return false;
    this.total++;
    if (this.frames.length < BACKLOG_KEEP) this.frames.push(frame);
    return true;
  }

  private close(): void {
    this.timer = null;
    const got = this.frames.splice(0).sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
    const count = this.total;
    const expected = this.pending;
    this.total = 0;
    this.pending = 0;
    const emit = this.flush;
    this.flush = null;
    if (!got.length || !emit) return;
    const bodies = got.map((f) => {
      const t = frameToText(f, JSON.stringify(f));
      return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
    });
    const head = this.head(count, expected, got.length);
    emit({
      kind: "backlog",
      frames: got,
      pending: expected,
      text: `${head}\n\n${bodies.join("\n\n")}`,
    });
  }
}
