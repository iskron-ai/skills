// Лежалые кадры — одной пачкой на полосу, с телами (граф nks-dev: #4881, #5033).
// Кадр со stale: true — и почта предшественника после revoke, и повтор службы
// после пересборки сессии: хода не стоит, но и не теряется. Пачка уходит одним
// событием — под Monitor одним залпом, в pi и OpenCode одним промптом, сторожу
// выхода в лог и .seen. Пачка у каждого места своя (door.ts, #5838): лежалое
// одного графа не уходит сторожу другого.
import { addressedToMine } from "../shared/addressed.ts";
import { type Frame } from "../shared/channel.ts";
import { caseCountLines, frameToText } from "../shared/frame-text.ts";
import { L } from "../shared/lang.ts";
import { countedKeys, eventKeyOf, isRoomCopy, takeRoomCopies } from "../shared/seen.ts";
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
      // Закон #6574: адресованные месту — текстом, прочие записи дел — счётом; копия
      // дела события, чья копия инбокса показана здесь текстом, счётом не повторяется.
      const counted = [...frames];
      takeRoomCopies(counted, frames, (f) => f);
      // И сверх показанных такая копия — не в «не вошло»; отданной метится со всеми (unshown).
      const left = all.slice(frames.length);
      const count = all.length - takeRoomCopies([...left], frames, (f) => f).length;
      const bodies = [
        ...caseCountLines(counted),
        ...frames
          .filter((f) => addressedToMine(f))
          .map((f) => {
            const t = frameToText(f, JSON.stringify(f));
            return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
          }),
      ];
      flush(
        {
          kind: "stale",
          frames,
          // Сторож метит отданным и то, что пачка назвала числом: иначе оно вернётся с повтором (#5831);
          // метками счёта — текстом его событие не вошло (seen.ts countedKeys).
          ...(left.length ? { unshown: left.flatMap((f) => countedKeys(f)) } : {}),
          text:
            L(
              `Лежалых кадров: ${count}` +
                (count > frames.length
                  ? `, здесь первые ${frames.length}, не вошло ${count - frames.length}`
                  : "") +
                " — принятые, пока место не слушали, или повтор службы после пересборки сессии; " +
                "адресованные месту — текстом, прочие — счётом; " +
                'полностью и не вошедшее — iskron_channel(action="history").',
              `Stale frames: ${count}` +
                (count > frames.length
                  ? `, the first ${frames.length} here, ${count - frames.length} left out`
                  : "") +
                " — taken while the seat was not listening, or the service repeating after a session rebuild; " +
                "those addressed to the seat as text, the rest by count; " +
                'in full and the rest — iskron_channel(action="history").',
            ) +
            "\n\n" +
            bodies.join("\n\n"),
        },
        all,
      );
    }, STALE_BURST_MS).unref();
  }

  /** Лежит ли в копящейся пачке копия этого события графа того же рода — копия дела либо инбокса (fanout.ts). */
  hasEvent(evKey: string, room: boolean): boolean {
    return this.burst.some((f) => eventKeyOf(f) === evKey && isRoomCopy(f) === room);
  }

  /**
   * Вынуть из копящейся пачки лежалые копии инбокса события — живая копия будит, пачка
   * нет (fanout.ts). Копии дела остаются: их гасит только показанный текстом (takeCopies).
   */
  dropEvent(evKey: string): void {
    for (let i = this.burst.length - 1; i >= 0; i--)
      if (eventKeyOf(this.burst[i]) === evKey && !isRoomCopy(this.burst[i]))
        this.burst.splice(i, 1);
  }

  /** Вынуть копии дела событий, вошедших в ход текстом кадров `shown` (seen.ts takeRoomCopies). */
  takeCopies(shown: readonly (Frame | null)[]): Frame[] {
    return takeRoomCopies(this.burst, shown, (f) => f);
  }

  /** Забыть накопленное — при отпускании стояния. */
  drop(): void {
    this.burst.length = 0;
    if (this.timer) clearTimeout(this.timer); // иначе пустая пачка ушла бы промптом «Лежалых кадров: 0»
    this.timer = null;
  }
}
