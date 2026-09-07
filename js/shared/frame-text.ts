import { type Frame } from "./channel.ts";

/** Кадр стояния — текстом в ход агента; одинаково в pi и в OpenCode. */
export function frameToText(frame: Frame | null | undefined, raw: string): string {
  if (!frame) return `Кадр канала Искрона:\n${raw}`;
  const from = frame.provenance?.from_standing || frame.provenance?.from_karta_seq;
  const head = from ? `Кадр канала Искрона от ${from}` : "Кадр канала Искрона";
  const body = typeof frame.body === "string" ? frame.body : raw;
  // Провенанс несут отдельной строкой: кто говорит, читается из происхождения
  // кадра, никогда из тела — телу любой держатель адреса придаст любой вид.
  return `${head}:\n\n${body}`;
}
