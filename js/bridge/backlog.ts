// Пачка побудки — накопленное уходит одним событием, не по кадру (граф nks-dev: #5140).
//
// Два повода открыть окно: hello с pending > 0 (платформа отдаёт всё ожидавшее
// разом, а плагин вкладывал каждый кадр отдельным ходом) и кадр самой платформы
// (побудка: «подними голову, разбери инбокс» — с ней должно прийти и всё, что
// пришло рядом). Пока окно открыто, живые кадры копятся; по его истечении —
// одно событие kind=backlog с кадрами по received_at, телами (обрезанными,
// как у лежалых) и указанием на history за остальным.
import { type Frame } from "../shared/channel.ts";
import { frameToText } from "../shared/frame-text.ts";
import { type ChannelEvent } from "./hold.ts";

/** Окно накопления; переменная — шов для проб, не ручка человека. */
const BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;
const BACKLOG_KEEP = 20;
const BODY_CAP = 800;

const frames: Frame[] = [];
let total = 0;
let pending = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let flush: ((ev: ChannelEvent) => void) | null = null;

/** Открыто ли окно — кадр, пришедший сейчас, пойдёт в пачку. */
export const backlogOpen = (): boolean => timer !== null;

/** Открыть окно — по hello с pending либо по кадру платформы; открытое не продлевается, только пополняется. */
export function openBacklog(expected: number, emit: (ev: ChannelEvent) => void): void {
  pending = Math.max(pending, expected);
  flush = emit;
  if (timer) return;
  timer = setTimeout(close, BACKLOG_MS).unref();
}

/** Отдать накопленное сейчас — при отпускании стояния: неотданное не теряется молча. */
export function flushBacklogNow(): void {
  if (!timer) return;
  clearTimeout(timer);
  close();
}

/** Положить живой кадр в пачку; false — окна нет, кадр идёт своим путём. */
export function noteBacklog(frame: Frame): boolean {
  if (!timer) return false;
  total++;
  if (frames.length < BACKLOG_KEEP) frames.push(frame);
  return true;
}

const at = (f: Frame): string => (typeof f.received_at === "string" ? f.received_at : "");

function close(): void {
  timer = null;
  const got = frames.splice(0).sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0));
  const count = total;
  const expected = pending;
  total = 0;
  pending = 0;
  const emit = flush;
  flush = null;
  if (!got.length || !emit) return;
  const bodies = got.map((f) => {
    const t = frameToText(f, JSON.stringify(f));
    return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
  });
  const head =
    `Побудка: кадров ${count}` +
    (expected ? ` (ожидало в очереди: ${expected})` : "") +
    (count > got.length ? `, здесь первые ${got.length}` : "") +
    " — пришли одной пачкой; разбери все, а не последний: " +
    'полностью и остальное — iskron_channel(action="history", view="log").';
  emit({
    kind: "backlog",
    frames: got,
    pending: expected,
    text: `${head}\n\n${bodies.join("\n\n")}`,
  });
}
