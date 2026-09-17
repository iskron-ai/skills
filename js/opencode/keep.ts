// Слух сессии OpenCode переживает простой, перезапуск плагина и вытеснение
// каталога (граф nks-dev: #5140). Три хода половины «тулы», собранные здесь:
//   • возврат места по каталогу сессии — мост нового экземпляра плагина сам
//     находит запись держания прежнего (`iskron/resume {cwd}`) и шлёт
//     hello.pending, а накопленное приходит пачкой побудки;
//   • маркер потери — плагин, который останавливают с держащими мостами, пишет
//     на диск, кого держал; следующий экземпляр озвучивает это в первую живую
//     сессию, а не молчит;
//   • сторож слуха — раз в N минут стоявшие сессии спрашивают мост
//     (`iskron/check {cwd}`): мёртвый мост поднимается заново и возвращает
//     место, глухой при ожидающих кадрах переоткрывает сокет.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
  /** Каталог сессии — ключ возврата места. */
  dir: string | null;
  /** Возврат места в полёте: вызов тула ждёт его, чтобы не занимать место дважды. */
  resume: Promise<void> | null;
}

interface Lost {
  at: string;
  entries: { session: string; dir: string | null }[];
}

const markerPath = (authDir: string): string => join(authDir, "opencode-lost.json");

/** Остановка плагина с держащими мостами — на диск, кого держал: следующий экземпляр скажет. */
export function writeLostMarker(authDir: string, slots: Iterable<KeptSlot>): void {
  const entries = [...slots]
    .filter((s) => s.holding && s.session)
    .map((s) => ({ session: s.session as string, dir: s.dir }));
  if (!entries.length) return;
  try {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const lost: Lost = { at: new Date().toISOString(), entries };
    writeFileSync(markerPath(authDir), JSON.stringify(lost), { mode: 0o600 });
  } catch {
    /* маркер — слово, не обязательство */
  }
}

/** Маркер прежнего экземпляра, прочитанный и стёртый: слово о потере слуха. */
export function takeLostMarker(authDir: string): string | null {
  let lost: Lost;
  try {
    lost = JSON.parse(readFileSync(markerPath(authDir), "utf8")) as Lost;
    unlinkSync(markerPath(authDir));
  } catch {
    return null;
  }
  if (!lost?.entries?.length) return null;
  const when = new Date(lost.at);
  const hhmm = Number.isNaN(when.getTime())
    ? lost.at
    : `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  const where = lost.entries.map((e) => e.dir ?? e.session).join(", ");
  return (
    `Искрон: слух был потерян в ${hhmm} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. ` +
    "Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand."
  );
}

export interface KeeperDoors<S extends KeptSlot> {
  say: Say;
  /** Слот корневой сессии: живой или поднятый заново. */
  slotFor: (root: string) => Promise<S>;
  ready: (slot: S) => Promise<void>;
  directoryOf: (root: string) => Promise<string | null>;
}

export interface Keeper<S extends KeptSlot> {
  /** Новая сессия получила мост: вернуть её место с диска, если прежний экземпляр его держал. */
  resume(slot: S, root: string): Promise<void>;
  /** Успешный stand/connect/register — сессия стоит: держащий мост не жнётся, сторож смотрит. */
  stood(slot: S): void;
  stop(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- ответы моста приходят без схемы */

export function createKeeper<S extends KeptSlot>(doors: KeeperDoors<S>): Keeper<S> {
  const roots = new Set<string>(); // стоявшие корневые сессии
  let stopped = false;

  async function resume(slot: S, root: string): Promise<void> {
    try {
      await doors.ready(slot);
      slot.dir ??= await doors.directoryOf(root);
      if (!slot.dir || stopped) return;
      const r: any = await slot.bridge.request(
        "iskron/resume",
        { cwd: slot.dir },
        { timeoutMs: 30_000 },
      );
      if (!r?.resumed) return;
      slot.holding = true;
      slot.stood = true;
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
    const slot = await doors.slotFor(root); // мёртвый мост здесь заменён живым
    if (slot.resume) await slot.resume;
    if (!slot.dir) slot.dir = await doors.directoryOf(root);
    await doors.ready(slot);
    const r: any = await slot.bridge.request(
      "iskron/check",
      { cwd: slot.dir ?? "" },
      { timeoutMs: 30_000 },
    );
    if (r?.holding) slot.holding = true;
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
    resume,
    stood(slot) {
      slot.holding = true;
      slot.stood = true;
      if (slot.session) roots.add(slot.session);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
