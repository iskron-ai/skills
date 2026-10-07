// Лежалые кадры — одной пачкой на полосу, с телами (граф nks-dev: #4881, #5033).
// Кадр со stale: true — и почта предшественника после revoke, и повтор службы
// после пересборки сессии: хода не стоит, но и не теряется. Пачка уходит одним
// событием — под Monitor одним залпом, в pi и OpenCode одним промптом, сторожу
// выхода в лог и .seen. Пачка у каждого места своя (door.ts, #5838): лежалое
// одного графа не уходит сторожу другого.
import { type Frame } from "../shared/channel.ts";
import { type Marks, sameCopy } from "../shared/seen.ts";
import { staleBatch } from "../shared/stalebatch.ts";
import { type ChannelEvent } from "./door.ts";

const STALE_BURST_MS = 1500;

export class StaleBurst {
  /** Все кадры полосы — пачка показывает первые STALE_BURST_KEEP, отданными метятся все (#5831). */
  private readonly burst: Frame[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** `has` — метки места: событие, уже вошедшее в ход, пачка не повторяет (seen.ts eventIn). */
  private readonly has: Marks;
  constructor(has: Marks) {
    this.has = has;
  }

  /**
   * Положить лежалый кадр в пачку; по истечении полосы `flush` получает одно событие.
   * Повтор id, уже лежащего в пачке, — не второй кадр.
   */
  note(frame: Frame, flush: (ev: ChannelEvent) => void): void {
    const id = typeof frame.id === "string" ? frame.id : "";
    if (!id || !this.burst.some((f) => f.id === id)) this.burst.push(frame);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const all = this.burst.splice(0);
      if (!all.length) return; // все копии вынула живая копия того же события
      // Текст и метки — по памяти места сейчас: так пачку отдаёт мост (pi, OpenCode). Сторожа
      // судят её сами в миг печати или вложения — по кадрам полосы (shared/stalebatch.ts).
      const { text, keys } = staleBatch(all, this.has);
      if (!text) return; // всё уже в ходе: метки места только растут, сторож решит так же
      flush({ kind: "stale", frames: all, marks: keys, text });
    }, STALE_BURST_MS).unref();
  }

  /** Лежит ли в копящейся пачке копия этого события того же рода (fanout.ts). */
  holdsCopy(frame: Frame): boolean {
    return this.burst.some((f) => sameCopy(f, frame));
  }

  /** Вынуть из копящейся пачки лежалые копии того же рода — живая будит, пачка нет (fanout.ts). */
  dropCopies(frame: Frame): void {
    for (let i = this.burst.length - 1; i >= 0; i--)
      if (sameCopy(this.burst[i], frame)) this.burst.splice(i, 1);
  }

  /** Забыть накопленное — при отпускании стояния. */
  drop(): void {
    this.burst.length = 0;
    if (this.timer) clearTimeout(this.timer); // иначе пустая пачка ушла бы промптом «Лежалых кадров: 0»
    this.timer = null;
  }
}
