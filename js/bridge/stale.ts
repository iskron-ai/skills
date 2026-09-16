// Лежалые кадры — одной пачкой на полосу, с телами (граф nks-dev: #4881, #5033).
// Кадр со stale: true — и почта предшественника после revoke, и повтор службы
// после пересборки сессии: хода не стоит, но и не теряется. Пачка уходит одним
// событием — под Monitor одним залпом, в pi и OpenCode одним промптом, сторожу
// выхода в лог и .seen.
import { type Frame } from "../shared/channel.ts";
import { frameToText } from "../shared/frame-text.ts";
import { type ChannelEvent } from "./hold.ts";

const STALE_BURST_KEEP = 20;
const STALE_BURST_MS = 1500;
const BODY_CAP = 800;

const burst: Frame[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

/** Положить лежалый кадр в пачку; по истечении полосы `flush` получает одно событие. */
export function noteStale(frame: Frame, flush: (ev: ChannelEvent) => void): void {
  if (burst.length < STALE_BURST_KEEP) burst.push(frame);
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const frames = burst.splice(0);
    const bodies = frames.map((f) => {
      const t = frameToText(f, JSON.stringify(f));
      return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
    });
    flush({
      kind: "stale",
      frames,
      text:
        `Лежалых кадров: ${frames.length} — принятое, пока место не слушали, или повтор службы после пересборки сессии; ` +
        'хода не стоят, но прочти; полностью — iskron_channel(action="history").\n\n' +
        bodies.join("\n\n"),
    });
  }, STALE_BURST_MS).unref();
}

/** Забыть накопленное — при отпускании стояния. */
export function dropStale(): void {
  burst.length = 0;
}
