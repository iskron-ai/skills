// Спул передачи места (граф nks-dev: #6586): уходящий демон держит сокет места до
// вытеснения преемником (handoff.ts), а кадры, пришедшие после закрытия двери,
// кладёт сюда — строкой JSON на запись, рядом с ключом места (0600). Записи:
// {open} — передача началась, {frame} — кадр как пришёл, {done} — сокет ушёл
// (вытеснен или закрыт по пределу). Преемник после hello досылает кадры тем же
// путём доставки (hold.ts); повтор отсекает память отданного (.seen).
import { appendFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { type Frame } from "../shared/channel.ts";
import { bindScope } from "../shared/scope.ts";
import { log } from "./streams.ts";

/** Сколько уходящий демон держит сокет места, ожидая вытеснения преемником. */
export const HANDOFF_MS = Number(process.env.ISKRON_BRIDGE_DAEMON_HANDOFF_MS) || 12_000;
/** Сколько преемник ждёт конца спула: предел уходящего и запас на его выход. */
const DRAIN_MS = HANDOFF_MS + 5_000;
const DRAIN_TICK_MS = 200;

interface Entry {
  open?: number;
  frame?: string;
  done?: number;
}

function append(path: string, entry: Entry): void {
  try {
    appendFileSync(path, JSON.stringify(entry) + "\n", { mode: 0o600 });
  } catch (e) {
    log(`handover spool not written (${path}): ${(e as Error).message}`);
  }
}

/** Завести спул до того, как преемник прочтёт hello: открытый спул ждут, а не пропускают. */
export function openSpool(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch {}
  append(path, { open: Date.now() });
}

export const spoolFrame = (path: string, raw: string): void => append(path, { frame: raw });
export const closeSpool = (path: string): void => append(path, { done: Date.now() });

const draining = new Set<string>();

function parseFrame(raw: string): Frame | null {
  try {
    const f = JSON.parse(raw) as unknown;
    return f && typeof f === "object" ? (f as Frame) : null;
  } catch {
    return null; // не JSON — донесём как есть, как сокет
  }
}

/** Записи спула, дописанные целиком (строка с переводом), — недописанная читается следующим проходом. */
function entries(path: string): Entry[] | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  return text
    .slice(0, text.lastIndexOf("\n") + 1)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as Entry;
      } catch {
        return {};
      }
    });
}

/**
 * Дослать спул места (преемник, по hello): кадры — feed по порядку, пока каждая
 * начатая передача не допишет конец; конец или предел — файл прочь. Спула нет — ничего.
 */
export function drainSpool(path: string, feed: (raw: string, frame: Frame | null) => void): void {
  if (draining.has(path)) return;
  const give = bindScope((raw: string) => feed(raw, parseFrame(raw)));
  const until = Date.now() + DRAIN_MS;
  let taken = 0;
  const tick = (): void => {
    const all = entries(path);
    if (!all) return void draining.delete(path);
    const fresh = all.slice(taken).filter((e) => typeof e.frame === "string");
    if (fresh.length) log(`handover spool: ${fresh.length} frame(s) of the outgoing daemon`);
    for (const e of fresh) give(e.frame as string);
    taken = all.length;
    const opened = all.filter((e) => e.open).length;
    const done = all.filter((e) => e.done).length;
    if (done < opened && Date.now() < until) {
      setTimeout(tick, DRAIN_TICK_MS).unref?.();
      return;
    }
    draining.delete(path);
    try {
      unlinkSync(path);
    } catch {}
  };
  draining.add(path);
  tick();
}
