// Пачка побудки — накопленное уходит одним событием, не по кадру (граф nks-dev: #5140).
//
// Два повода открыть окно: hello с pending > 0 (платформа отдаёт всё ожидавшее
// разом, а плагин вкладывал каждый кадр отдельным ходом) и кадр самой платформы
// (побудка: «подними голову, разбери инбокс» — с ней должно прийти и всё, что
// пришло рядом). Пока окно открыто, живые кадры копятся; по его истечении —
// одно событие kind=backlog с кадрами по received_at, телами (обрезанными,
// как у лежалых) и указанием на history за остальным. Окно у каждого места
// своё (door.ts, #5838): пачка одного графа метится в .seen своего места.
import { type Frame, isDirectWord } from "../shared/channel.ts";
import { frameToText } from "../shared/frame-text.ts";
import { type ChannelEvent } from "./door.ts";

/** Окно накопления; переменная — шов для проб, не ручка человека. */
const BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;
const BACKLOG_KEEP = 20;
const BODY_CAP = 800;

const at = (f: Frame): string => (typeof f.received_at === "string" ? f.received_at : "");

export class Backlog {
  private readonly frames: Frame[] = [];
  /** Все кадры окна — пачка показывает первые BACKLOG_KEEP, отданными метятся все (#5831). */
  private readonly all: Frame[] = [];
  private total = 0;
  /** Прямые слова окна — ушли отдельно; шапка называет их числом. */
  private direct = 0;
  private pending = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flush: ((ev: ChannelEvent, all: Frame[]) => void) | null = null;

  /** Открыть окно — по hello с pending либо по кадру платформы; открытое не продлевается, только пополняется. */
  open(expected: number, emit: (ev: ChannelEvent, all: Frame[]) => void): void {
    this.pending = Math.max(this.pending, expected);
    this.flush = emit;
    if (this.timer) return;
    this.timer = setTimeout(() => this.close(), BACKLOG_MS).unref();
  }

  /** Отдать накопленное сейчас — при отпускании стояния: неотданное не теряется молча. */
  flushNow(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.close();
  }

  /**
   * Положить живой кадр в пачку; false — окна нет или это прямое слово: кадр идёт
   * своим путём, отдельно и целиком. Повтор id, уже лежащего в окне, не считается.
   */
  note(frame: Frame): boolean {
    if (!this.timer) return false;
    if (isDirectWord(frame)) {
      this.direct++;
      return false;
    }
    const id = typeof frame.id === "string" ? frame.id : "";
    if (id && this.all.some((f) => f.id === id)) return true;
    this.total++;
    this.all.push(frame);
    if (this.frames.length < BACKLOG_KEEP) this.frames.push(frame);
    return true;
  }

  private close(): void {
    this.timer = null;
    const got = this.frames.splice(0).sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
    const all = this.all.splice(0);
    const count = this.total;
    const expected = this.pending;
    const direct = this.direct;
    this.total = 0;
    this.direct = 0;
    this.pending = 0;
    const emit = this.flush;
    this.flush = null;
    if (!got.length || !emit) return;
    const bodies = got.map((f) => {
      const t = frameToText(f, JSON.stringify(f));
      return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
    });
    const head =
      `Побудка: кадров ${count}` +
      (expected ? ` (ожидало в очереди: ${expected})` : "") +
      (count > got.length ? `, здесь первые ${got.length}, не вошло ${count - got.length}` : "") +
      " — пришли одной пачкой; разбери все, а не последний: " +
      'полностью и не вошедшее — iskron_channel(action="history", view="log").' +
      (direct ? ` Прямых слов ${direct} — не здесь: каждое пришло отдельно и целиком.` : "");
    emit(
      {
        kind: "backlog",
        frames: got,
        pending: expected,
        text: `${head}\n\n${bodies.join("\n\n")}`,
      },
      all,
    );
  }
}
