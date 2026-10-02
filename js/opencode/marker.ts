// Маркер потери (граф nks-dev: #5140, #6626): остановленный с держащими мостами
// плагин пишет, кого держал; следующий экземпляр возвращает эти места (keep.ts).
// Экземпляр один на локацию OpenCode, тулы сессии идут через экземпляр её локации,
// а обновление поставки перезагружает все разом: файл несёт метку локации, и берутся
// только файлы своей — взяв чужой, экземпляр вернул бы место своим мостом и сказал
// сессии «вернул», а её занятость шла бы мостом её экземпляра, места не держащим.
// Файл прежней сборки без метки читают все, беря записи своего каталога; снимает его срок.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { KeptSlot } from "./keep.ts";

/** Локация экземпляра плагина (ctx.location): каталог и рабочее пространство. */
export interface Home {
  directory: string;
  workspace?: string | null;
}

export interface LostEntry {
  session: string;
  dir: string | null;
  key: string | null;
  child?: boolean;
  of?: { realm: string; karta: string; name: string } | null;
  room?: string | null;
  noted?: boolean;
}
type Lost = { at: string; entries: LostEntry[] };

const PREFIX = "opencode-lost";
/** Срок файла прежней сборки: экземпляры одной перезагрузки встают за секунды. */
const LEGACY_MS = 2 * 60_000;

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** Метка локации в имени файла; экземпляр без локации — «any». */
const tagOf = (home: Home | null): string =>
  home ? hash(`${home.directory}\0${home.workspace ?? ""}`) : "any";
/** Метка файла `opencode-lost.@<метка>.…`; null — файл прежней сборки. */
const tagIn = (f: string): string | null => /^opencode-lost\.@([^.]+)\./.exec(f)?.[1] ?? null;

/** Поля детской записи маркера: место корня, дело поручения, сказанный ход. */
const childPart = (e: { of?: LostEntry["of"]; room?: string | null; noted?: boolean }) => ({
  of: e.of ?? null,
  room: e.room ?? null,
  ...(e.noted ? { noted: true } : {}),
});

/** Остановка плагина с держащими мостами — на диск, кого держал: следующий экземпляр скажет. */
export function writeLostMarker(
  authDir: string,
  slots: Iterable<KeptSlot>,
  home: Home | null,
): void {
  const entries = [...slots]
    .filter((s) => s.holding && s.session)
    .map((s) => ({
      session: s.session as string,
      dir: s.dir,
      key: s.key,
      child: !!s.child,
      ...(s.child ? childPart({ of: s.satelliteOf, room: s.room, noted: s.noted }) : {}),
    }));
  if (!entries.length) return;
  try {
    mkdirSync(authDir, { recursive: true, mode: 0o700 });
    const lost: Lost = { at: new Date().toISOString(), entries };
    const rand = Math.random().toString(36).slice(2, 8);
    const name = `${PREFIX}.@${tagOf(home)}.${process.pid}.${rand}.json`;
    writeFileSync(join(authDir, name), JSON.stringify(lost), { mode: 0o600 });
  } catch {
    /* маркер — слово, не обязательство */
  }
}

/** Записи файла, которые берёт этот экземпляр; файл своей метки снимается, прежней сборки — по сроку. */
function readOwn(path: string, tag: string | null, home: Home | null): Lost | null {
  const drop = () => {
    try {
      unlinkSync(path);
    } catch {
      /* снял другой экземпляр */
    }
  };
  let lost: Lost | null = null;
  try {
    const text = readFileSync(path, "utf8");
    if (tag !== null) drop(); // сперва снять, потом разбирать: битый иначе лежал бы вечно
    lost = JSON.parse(text) as Lost;
  } catch {
    /* снят другим или битый — не слово */
  }
  if (tag === null && !(Date.now() - Date.parse(lost?.at ?? "") < LEGACY_MS)) drop();
  if (!lost) return null;
  // Прежняя сборка писала файл без метки: своя запись в нём — запись своего каталога.
  const mine = (e: LostEntry) => tag !== null || !home || !e.dir || e.dir === home.directory;
  return { at: lost.at, entries: (lost.entries ?? []).filter(mine) };
}

/** Маркеры прежних экземпляров своей локации, прочитанные и стёртые: слово о потере слуха и ключи мест. */
export function takeLostMarker(
  authDir: string,
  home: Home | null,
): { text: string | null; entries: LostEntry[] } | null {
  const entries: LostEntry[] = [];
  const seen = new Set<string>();
  let at = "";
  let files: string[];
  try {
    files = readdirSync(authDir).filter((f) => f.startsWith(PREFIX) && f.endsWith(".json"));
  } catch {
    return null;
  }
  const mine = tagOf(home);
  // Файлы своей метки — первыми: запись сессии из файла прежней сборки их не перебивает.
  files.sort((a, b) => Number(tagIn(b) !== null) - Number(tagIn(a) !== null));
  for (const f of files) {
    const tag = tagIn(f);
    if (tag !== null && tag !== mine) continue; // маркер другой локации — её экземпляру
    const lost = readOwn(join(authDir, f), tag, home);
    for (const e of lost?.entries ?? []) {
      if (!e?.session || seen.has(e.session)) continue;
      seen.add(e.session);
      if (lost && lost.at > at) at = lost.at;
      entries.push({
        session: e.session,
        dir: e.dir ?? null,
        key: e.key ?? null,
        child: !!e.child,
        ...(e.child ? childPart(e) : {}),
      });
    }
  }
  if (!entries.length) return null;
  const when = new Date(at);
  const hhmm = Number.isNaN(when.getTime()) ? at : when.toTimeString().slice(0, 5);
  // Слово — корням: места детей возвращаются тихо своими мостами (children.ts); без корней слова нет.
  const where = entries
    .filter((e) => !e.child)
    .map((e) => e.key ?? e.dir ?? e.session)
    .join(", ");
  return {
    text: where
      ? `Искрон: слух был потерян в ${hhmm} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. ` +
        "Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand."
      : null,
    entries,
  };
}
