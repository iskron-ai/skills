// Слух сессии OpenCode переживает простой, перезапуск плагина и вытеснение
// каталога (граф nks-dev: #5140). Три хода половины «тулы», собранные здесь:
//   • возврат места — мост нового экземпляра плагина сам находит СВОЮ запись
//     держания (`iskron/resume {key?, cwd}`: ключ, если плагин его знает — из
//     `held` прежнего моста или из маркера потери, иначе каталог сессии) и шлёт
//     hello.pending, а накопленное приходит пачкой побудки;
//   • маркер потери — плагин, который останавливают с держащими мостами, пишет
//     на диск, кого держал (файл на экземпляр: локаций сервиса несколько);
//     следующий экземпляр озвучивает это в первую живую сессию, а не молчит;
//   • сторож слуха — раз в N минут стоявшие сессии спрашивают мост
//     (`iskron/check {key?, cwd}`): мёртвый мост поднимается заново и возвращает
//     место, глухой переоткрывает сокет; мост, места не ведущий, из-под сторожа
//     выходит — его простой снова считает жнец.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Bridge } from "../shared/bridge-client.ts";
import type { Say } from "./tools.ts";

/** Такт сторожа слуха; переменная — шов для проб, не ручка человека. */
const WATCH_MS = Number(process.env.ISKRON_BRIDGE_WATCH_MS || 5 * 60_000);

export interface KeptSlot {
  bridge: Bridge;
  session: string | null;
  /** Мост держит стояние — такой не отпускают по простою. */
  holding: boolean;
  /** Сессия стояла хоть раз — за ней смотрит сторож слуха. */
  stood: boolean;
  /** Каталог сессии — ключ возврата места, когда ключ стояния неизвестен. */
  dir: string | null;
  /** Ключ стояния, которое держал мост (из `held` или возврата) — точный адрес записи. */
  key: string | null;
  /** Возврат места в полёте: вызов тула ждёт его, чтобы не занимать место дважды. */
  resume: Promise<void> | null;
}

export interface LostEntry {
  session: string;
  dir: string | null;
  key: string | null;
}
interface Lost {
  at: string;
  entries: LostEntry[];
}

const MARKER_PREFIX = "opencode-lost";

/** Остановка плагина с держащими мостами — на диск, кого держал: следующий экземпляр скажет. */
export function writeLostMarker(authDir: string, slots: Iterable<KeptSlot>): void {
  const entries = [...slots]
    .filter((s) => s.holding && s.session)
    .map((s) => ({ session: s.session as string, dir: s.dir, key: s.key }));
  if (!entries.length) return;
  try {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const lost: Lost = { at: new Date().toISOString(), entries };
    // Свой файл на экземпляр: два плагина одного сервиса не затирают друг друга.
    const name = `${MARKER_PREFIX}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(join(authDir, name), JSON.stringify(lost), { mode: 0o600 });
  } catch {
    /* маркер — слово, не обязательство */
  }
}

/** Маркеры прежних экземпляров, прочитанные и стёртые: слово о потере слуха и ключи мест. */
export function takeLostMarker(authDir: string): { text: string; entries: LostEntry[] } | null {
  const entries: LostEntry[] = [];
  let at = "";
  let files: string[];
  try {
    files = readdirSync(authDir).filter((f) => f.startsWith(MARKER_PREFIX) && f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const lost = JSON.parse(readFileSync(join(authDir, f), "utf8")) as Lost;
      unlinkSync(join(authDir, f));
      if (lost?.at > at) at = lost.at;
      for (const e of lost?.entries ?? [])
        entries.push({ session: e.session, dir: e.dir ?? null, key: e.key ?? null });
    } catch {
      /* битый маркер — не слово */
    }
  }
  if (!entries.length) return null;
  const when = new Date(at);
  const hhmm = Number.isNaN(when.getTime())
    ? at
    : `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const where = entries.map((e) => e.key ?? e.dir ?? e.session).join(", ");
  return {
    text:
      `Искрон: слух был потерян в ${hhmm} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. ` +
      "Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand.",
    entries,
  };
}

export interface KeeperDoors<S extends KeptSlot> {
  say: Say;
  /** Слот корневой сессии: живой или поднятый заново; touch=false — простой не освежать (сторож — не вызов). */
  slotFor: (root: string, touch: boolean) => Promise<S>;
  ready: (slot: S) => Promise<void>;
  directoryOf: (root: string) => Promise<string | null>;
}

export interface Keeper<S extends KeptSlot> {
  /** Ключи мест из маркера потери — по каталогу: возврат по ключу точнее, чем по каталогу. */
  hint(entries: LostEntry[]): void;
  /** Новая сессия получила мост: вернуть её место с диска, если прежний экземпляр его держал. */
  resume(slot: S, root: string): Promise<void>;
  /** Успешный stand/connect/register — сессия стоит: держащий мост не жнётся, сторож смотрит. */
  stood(slot: S): void;
  /** Сессия удалена — сторожу за ней не смотреть: иначе он поднимал бы ей мост каждый такт. */
  forget(root: string): void;
  stop(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

export function createKeeper<S extends KeptSlot>(doors: KeeperDoors<S>): Keeper<S> {
  const roots = new Set<string>(); // стоявшие корневые сессии
  const hints = new Map<string, string>(); // каталог → ключ из маркера потери
  let stopped = false;

  function selector(slot: S): { key?: string; cwd?: string } {
    const key = slot.key ?? (slot.dir ? hints.get(slot.dir) : undefined);
    return { ...(key ? { key } : {}), ...(slot.dir ? { cwd: slot.dir } : {}) };
  }

  async function resume(slot: S, root: string): Promise<void> {
    try {
      await doors.ready(slot);
      slot.dir ??= await doors.directoryOf(root);
      if ((!slot.dir && !slot.key) || stopped) return;
      const r: any = await slot.bridge.request("iskron/resume", selector(slot), {
        timeoutMs: 30_000,
      });
      if (!r?.resumed) return;
      slot.holding = true;
      slot.stood = true;
      if (typeof r.key === "string") slot.key = r.key;
      roots.add(root);
      // Ожидавшие кадры придут пачкой побудки и разбудят сессию сами; слово о возврате — в лог.
      doors.say(`Искрон: сессия ${root} — ${r.word}`, "info");
    } catch (e) {
      doors.say(
        `Искрон: возврат места сессии ${root} не удался — ${(e as Error).message}`,
        "warning",
      );
    }
  }

  async function check(root: string): Promise<void> {
    const slot = await doors.slotFor(root, false); // мёртвый мост здесь заменён живым; простой не освежается
    if (slot.resume) await slot.resume;
    if (!slot.dir) slot.dir = await doors.directoryOf(root);
    await doors.ready(slot);
    const r: any = await slot.bridge.request("iskron/check", selector(slot), {
      timeoutMs: 30_000,
    });
    if (typeof r?.key === "string") slot.key = r.key;
    if (r?.holding) slot.holding = true;
    else if (r?.holding === false) {
      // Места мост не ведёт и вернуть нечего: сторожу здесь делать нечего, жнец
      // снова считает простой; новое стояние вернёт сессию под сторож через stood.
      slot.holding = false;
      if (!r.resumed) roots.delete(root);
    }
    if (r?.resumed)
      doors.say(`Искрон: сторож слуха вернул место сессии ${root} — ${r.word}`, "info");
    else if (r?.reopened)
      doors.say(`Искрон: сторож слуха переоткрыл сокет сессии ${root} — ${r.word}`, "warning");
  }

  const timer = setInterval(() => {
    if (stopped) return;
    for (const root of roots)
      void check(root).catch((e: Error) =>
        doors.say(`Искрон: сторож слуха сессии ${root} — ${e.message}`, "warning"),
      );
  }, WATCH_MS);
  timer.unref?.();

  return {
    hint(entries) {
      for (const e of entries) if (e.dir && e.key) hints.set(e.dir, e.key);
    },
    resume,
    stood(slot) {
      slot.holding = true;
      slot.stood = true;
      if (slot.session) roots.add(slot.session);
    },
    forget(root) {
      roots.delete(root);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
