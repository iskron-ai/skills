// Нумерация записей дела (граф nks-dev: #6576): признак numbering "case" — номер
// записи свой в каждом деле; нет признака — прежний счёт. Памяти, ключённые
// номерами записей, несут нумерацию в ключе: номер иного счёта их не находит —
// смена признака забывает их разом в каждом процессе (мост, сторожа, плагины)
// и на диске (.seen), без сигнала между ними.
import { type Frame } from "./channel.ts";

/** Нумерация кадра: "case" — номер внутри дела, "" — прежний счёт. */
export const numberingOf = (frame: Frame): string =>
  (frame as Record<string, unknown>).numbering === "case" ? "case" : "";

/** Ключ памяти по номеру записи — в счёте кадра; прежний счёт — ключ как был, записанное до перехода цело. */
export const numberedKey = (frame: Frame, key: string): string =>
  key && numberingOf(frame) ? `case:${key}` : key;
