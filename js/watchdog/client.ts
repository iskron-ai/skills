// Клиент локального сокета стояния, который держит мост (граф nks-dev: #4234).
// Сторож больше ничего не держит и не переоткрывает: он читает события моста и
// превращает их в то, что понимает харнес — строку под Monitor или выход процесса.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import { type ChannelEvent } from "../bridge/hold.ts";
import { type Frame } from "../shared/channel.ts";
import { batchHead } from "../shared/frame-text.ts";
import { setLang } from "../shared/lang.ts";
import { deliveryKeys, eventIn, type Marks, seenIds } from "../shared/seen.ts";
import { staleBatch } from "../shared/stalebatch.ts";
import { authDirFromEnv, socketPathOf, standingsDirOf } from "../shared/standings.ts";
import { wd } from "./words.ts";

// Мост может подняться чуть позже сторожа, место — вернуться после смены демона.
// Переменная — шов для проб, не ручка человека.
const ATTACH_WINDOW_MS = Number(process.env.ISKRON_WATCHDOG_ATTACH_MS) || 60_000;
const RETRY_MS = 1000;

export interface Resolved {
  key: string;
  path: string;
  authDir: string;
}

export interface WatchdogArgs {
  key?: string;
  authDir: string;
}

/** `[ключ] [--auth-dir <dir>] [--lang en|ru]` — каталог тот же, что у моста, иначе сторож ищет не там; язык мост называет сам. */
export function parseWatchdogArgs(argv: string[]): WatchdogArgs {
  const out: WatchdogArgs = { authDir: authDirFromEnv() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auth-dir") out.authDir = argv[++i] ?? out.authDir;
    else if (a === "--lang") setLang(argv[++i]);
    else if (!a.startsWith("--") && !out.key) out.key = a;
  }
  return out;
}

/** Какое стояние слушать: названное, либо единственное, которое держит мост. */
export function resolveStanding(argv: string[]): Resolved | { error: string } {
  const { key, authDir } = parseWatchdogArgs(argv);
  const dir = standingsDirOf(authDir);
  const pathFor = (k: string) => socketPathOf(authDir, k);
  if (key) return { key, path: pathFor(key), authDir };
  // Читаемые ключи лежат рядом с сокетами файлами <хеш>.key — их и перечисляем.
  const held = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".key"))
        .map((f) => {
          try {
            return readFileSync(join(dir, f), "utf8").trim();
          } catch {
            return "";
          }
        })
        .filter(Boolean)
    : [];
  if (held.length === 1) return { key: held[0], path: pathFor(held[0]), authDir };
  if (held.length === 0) {
    return {
      error: wd.noHeld(),
    };
  }
  return {
    error: wd.severalHeld(held),
  };
}

/**
 * Файл памяти отданного, который мост назвал в attached (память места — по его
 * серверу, а сервер сторожу не известен); мост, не назвавший его, оставляет
 * выведенный путь. Память перечитывается из названного файла.
 */
export function adoptSeenPath(
  named: string | undefined,
  current: string,
  seen: Set<string>,
): string {
  if (!named || named === current) return current;
  seen.clear();
  for (const x of seenIds(named)) seen.add(x);
  return named;
}

/**
 * Пачка лежалых в миг отдачи — по памяти сторожа `has` (shared/stalebatch.ts). Кадр
 * старого моста несёт лишь показанные кадры и метки сверх них (unshown): тогда — его
 * текст со счётом «не вошло» и его метки, показанные — метками доставки (#5831). Сверх
 * показанных событие вошло лишь числом: его `ev:`/`evs:` метятся `cev:`/`cevs:` (seen.ts).
 */
export function staleOf(ev: ChannelEvent, has: Marks): { text: string; keys: string[] } {
  if (!ev.unshown) return staleBatch(ev.frames ?? [], has);
  const shown = (ev.frames ?? []).flatMap((f) => deliveryKeys(f));
  const named = ev.unshown.map((k) => (/^evs?:/.test(k) ? `c${k}` : k));
  return { text: ev.text ?? "", keys: [...shown, ...named] };
}

/**
 * Шапки пачек — строками в момент печати (#6574): пачка ждёт кадрами, и копия, чьё
 * событие уже в ходе по памяти сторожа или входит текстом этого же вывода — кадрами
 * `carriers`, — не считается (seen.ts eventIn). Сами они в своей шапке остаются.
 */
export function heldHeads(groups: Frame[][], marks: Marks, carriers: Frame[] = []): string[] {
  const own = new Set(carriers.flatMap((f) => deliveryKeys(f)));
  const has: Marks = (k) => marks(k) || own.has(k);
  return groups
    .map((g) => g.filter((f) => carriers.includes(f) || !eventIn(f, has)))
    .filter((g) => g.length)
    .map(batchHead);
}

export interface AttachOptions {
  onEvent: (ev: ChannelEvent) => void;
  /** Мост ушёл (или так и не поднялся за окно): сокета больше нет. */
  onGone: (why: string) => void;
}

/**
 * Прицепиться к локальному сокету и читать NDJSON-события, пока мост жив.
 * Событие handover — демон машины передаёт место преемнику (обновление или SIGTERM
 * при тонком мосте на связи): дверь закроется и
 * откроется тем же путём, и сторож переподхватывает её в том же окне, что и на
 * старте, а не уходит словом «мост отпустил стояние».
 */
export function attach(path: string, o: AttachOptions): void {
  let startedAt = Date.now();
  let attached = false;
  let handover = false;
  let waitingBack = false; // место передано и ждёт возврата
  let ownRelease = false; // мост отпустил место своим close/revoke сессии

  function tryOnce(): void {
    const sock = connect(path);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      attached = true;
      waitingBack = false;
    });
    sock.on("data", (chunk: string) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: ChannelEvent;
        try {
          ev = JSON.parse(line) as ChannelEvent;
        } catch {
          continue; // не наша строка
        }
        // Кадр, пришедший без разбора (мост отдал только raw), разбираем здесь:
        // клиент судит по type, и судить должен по кадру, а не по его отсутствию.
        if (ev.kind === "frame" && ev.frame === undefined && typeof ev.raw === "string") {
          try {
            ev.frame = JSON.parse(ev.raw) as ChannelEvent["frame"];
          } catch {
            ev.frame = null;
          }
        }
        if (ev.kind === "handover") {
          handover = true; // закрытие, которое последует, — не уход моста
          continue;
        }
        if (ev.kind === "released" && ev.own) ownRelease = true; // своё close/revoke: сторож уходит сам
        o.onEvent(ev);
      }
    });
    sock.on("error", () => {
      /* закрытие скажет своё */
    });
    sock.on("close", () => {
      if (attached && handover) {
        // Место уходит к преемнику демона: та же дверь откроется снова — ждём её окном старта.
        attached = false;
        handover = false;
        waitingBack = true;
        startedAt = Date.now();
        return void setTimeout(tryOnce, RETRY_MS);
      }
      if (ownRelease) return; // своё отпускание сказано событием released — не уход моста (#6638)
      if (attached) return o.onGone(wd.bridgeLetGo());
      if (Date.now() - startedAt > ATTACH_WINDOW_MS) {
        const s = ATTACH_WINDOW_MS / 1000;
        return o.onGone(waitingBack ? wd.seatNotBack(s, path) : wd.noSocket(path, s));
      }
      setTimeout(tryOnce, RETRY_MS);
    });
  }
  tryOnce();
}
