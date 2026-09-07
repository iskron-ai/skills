// Клиент локального сокета стояния, который держит мост (граф nks-dev: #4234).
// Сторож больше ничего не держит и не переоткрывает: он читает события моста и
// превращает их в то, что понимает харнес — строку под Monitor или выход процесса.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import { type ChannelEvent } from "../bridge/hold.ts";
import { authDirFromEnv, socketPathOf, standingsDirOf } from "../shared/standings.ts";

const ATTACH_WINDOW_MS = 60_000; // мост может подняться чуть позже сторожа
const RETRY_MS = 1000;

export interface Resolved {
  key: string;
  path: string;
}

export interface WatchdogArgs {
  key?: string;
  authDir: string;
}

/** `[ключ] [--auth-dir <dir>]` — тот же каталог, что у моста, иначе сторож ищет не там. */
export function parseWatchdogArgs(argv: string[]): WatchdogArgs {
  const out: WatchdogArgs = { authDir: authDirFromEnv() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auth-dir") out.authDir = argv[++i] ?? out.authDir;
    else if (!a.startsWith("--") && !out.key) out.key = a;
  }
  return out;
}

/** Какое стояние слушать: названное, либо единственное, которое держит мост. */
export function resolveStanding(argv: string[]): Resolved | { error: string } {
  const { key, authDir } = parseWatchdogArgs(argv);
  const dir = standingsDirOf(authDir);
  const pathFor = (k: string) => socketPathOf(authDir, k);
  if (key) return { key, path: pathFor(key) };
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
  if (held.length === 1) return { key: held[0], path: pathFor(held[0]) };
  if (held.length === 0) {
    return {
      error:
        'мост не держит ни одного стояния — сперва iskron_channel(action="connect") (и register): ' +
        "ответ connect назовёт команду слушания",
    };
  }
  return {
    error: `мост держит несколько стояний — назови нужное: ` + held.join(", "),
  };
}

export interface AttachOptions {
  onEvent: (ev: ChannelEvent) => void;
  /** Мост ушёл (или так и не поднялся за окно): сокета больше нет. */
  onGone: (why: string) => void;
}

/** Прицепиться к локальному сокету и читать NDJSON-события, пока мост жив. */
export function attach(path: string, o: AttachOptions): void {
  const startedAt = Date.now();
  let attached = false;

  function tryOnce(): void {
    const sock = connect(path);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      attached = true;
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
        o.onEvent(ev);
      }
    });
    sock.on("error", () => {
      /* закрытие скажет своё */
    });
    sock.on("close", () => {
      if (attached) return o.onGone("мост отпустил стояние или ушёл — сессия кончилась?");
      if (Date.now() - startedAt > ATTACH_WINDOW_MS) {
        return o.onGone(`мост не поднял локальный сокет ${path} за ${ATTACH_WINDOW_MS / 1000}s`);
      }
      setTimeout(tryOnce, RETRY_MS);
    });
  }
  tryOnce();
}
