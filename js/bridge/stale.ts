// Лежалые кадры — одной пачкой на полосу, с телами (граф nks-dev: #4881, #5033).
// Кадр со stale: true — и почта предшественника после revoke, и повтор службы
// после пересборки сессии: хода не стоит, но и не теряется. Пачка уходит одним
// событием — под Monitor одним залпом, в pi и OpenCode одним промптом, сторожу
// выхода в лог и .seen. Пачка у каждого места своя (door.ts, #5838): лежалое
// одного графа не уходит сторожу другого.
import { type Frame } from "../shared/channel.ts";
import { frameToText } from "../shared/frame-text.ts";
import { eventKeyOf } from "../shared/seen.ts";
import { type ChannelEvent } from "./door.ts";

const STALE_BURST_KEEP = 20;
const STALE_BURST_MS = 1500;
const BODY_CAP = 800;

export class StaleBurst {
  /** Все кадры полосы — пачка показывает первые STALE_BURST_KEEP, отданными метятся все (#5831). */
  private readonly burst: Frame[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Положить лежалый кадр в пачку; по истечении полосы `flush` получает одно событие
   * и все кадры полосы, показанные и нет. Повтор id, уже лежащего в пачке, — не второй кадр.
   */
  note(frame: Frame, flush: (ev: ChannelEvent, all: Frame[]) => void): void {
    const id = typeof frame.id === "string" ? frame.id : "";
    if (!id || !this.burst.some((f) => f.id === id)) this.burst.push(frame);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const all = this.burst.splice(0);
      if (!all.length) return; // все копии вынула живая копия того же события
      const frames = all.slice(0, STALE_BURST_KEEP);
      const bodies = frames.map((f) => {
        const t = frameToText(f, JSON.stringify(f));
        return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
      });
      flush(
        {
          kind: "stale",
          frames,
          text:
            `Лежалых кадров: ${all.length}` +
            (all.length > frames.length ? `, здесь первые ${frames.length}` : "") +
            " — принятое, пока место не слушали, или повтор службы после пересборки сессии; " +
            'хода не стоят, но прочти; полностью — iskron_channel(action="history").\n\n' +
            bodies.join("\n\n"),
        },
        all,
      );
    }, STALE_BURST_MS).unref();
  }

  /** Лежит ли в копящейся пачке копия этого события графа (fanout.ts). */
  hasEvent(evKey: string): boolean {
    return this.burst.some((f) => eventKeyOf(f) === evKey);
  }

  /** Вынуть из копящейся пачки копии события — живая копия будит, пачка нет (fanout.ts). */
  dropEvent(evKey: string): void {
    for (let i = this.burst.length - 1; i >= 0; i--)
      if (eventKeyOf(this.burst[i]) === evKey) this.burst.splice(i, 1);
  }

  /** Забыть накопленное — при отпускании стояния. */
  drop(): void {
    this.burst.length = 0;
    if (this.timer) clearTimeout(this.timer); // иначе пустая пачка ушла бы промптом «Лежалых кадров: 0»
    this.timer = null;
  }
}
