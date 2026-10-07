// Текст пачки лежалых (граф nks-dev: #4881, #5033) — составляется тем, кто её отдаёт,
// в миг отдачи (seen.ts): мостом, уведомляя pi и OpenCode, сторожем — печатая или
// вкладывая в тред. Событие, вошедшее в ход до этого мига, пачка не повторяет (eventIn).
import { addressedToMine } from "./addressed.ts";
import { type Frame } from "./channel.ts";
import { caseCountLines, frameToText } from "./frame-text.ts";
import { L } from "./lang.ts";
import { type Marks, splitBatch } from "./seen.ts";

const STALE_BURST_KEEP = 20;
const BODY_CAP = 800;

/**
 * Пачка лежалых по памяти отдающего `has`: текст ("" — всё уже в ходе) и метки её
 * доставки — пишет их отдающий, когда текст ушёл (#5831). Закон #6574: адресованные
 * месту — текстом, прочие записи дел — счётом; событие — один раз (seen.ts splitBatch).
 */
export function staleBatch(all: readonly Frame[], has: Marks): { text: string; keys: string[] } {
  const { shown: frames, kept, keys } = splitBatch(all, STALE_BURST_KEEP, has);
  const count = kept.length;
  if (!count) return { text: "", keys };
  const bodies = [
    ...caseCountLines(frames),
    ...frames
      .filter((f) => addressedToMine(f))
      .map((f) => {
        const t = frameToText(f, JSON.stringify(f));
        return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
      }),
  ];
  const cut = count > frames.length;
  const head = L(
    `Лежалых кадров: ${count}` +
      (cut ? `, здесь первые ${frames.length}, не вошло ${count - frames.length}` : "") +
      " — принятые, пока место не слушали, или повтор службы после пересборки сессии; " +
      "адресованные месту — текстом, прочие — счётом; " +
      'полностью и не вошедшее — iskron_channel(action="history").',
    `Stale frames: ${count}` +
      (cut ? `, the first ${frames.length} here, ${count - frames.length} left out` : "") +
      " — taken while the seat was not listening, or the service repeating after a session rebuild; " +
      "those addressed to the seat as text, the rest by count; " +
      'in full and the rest — iskron_channel(action="history").',
  );
  return { text: `${head}\n\n${bodies.join("\n\n")}`, keys };
}
