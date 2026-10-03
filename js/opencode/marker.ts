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
import { entryOf, type Home, type LostEntry } from "./records.ts";

type Lost = { at: string; entries: LostEntry[] };
type Held = KeptSlot & { place?: { name: string } | null; moved?: boolean };

const PREFIX = "opencode-lost";
/** Срок файла прежней сборки и записи переноса: экземпляры встают за секунды. */
const LEGACY_MS = 2 * 60_000;

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
/** Метка локации в имени файла; экземпляр без локации — «any». */
const tagOf = (home: Home | null): string =>
  home ? hash(`${home.directory}\0${home.workspace ?? ""}`) : "any";
/** Метка файла `opencode-lost.@<метка>.…`; null — файл прежней сборки. */
const tagIn = (f: string): string | null => /^opencode-lost\.@([^.]+)\./.exec(f)?.[1] ?? null;
/**
 * Файл живого другого сервера OpenCode: на машине их бывает несколько, и каждый
 * грузит плагин для той же папки. Маркер пишет процесс сервера (pid в имени); его
 * сессии зовут тулы через его экземпляр — взяв чужой, этот вернул бы место своим
 * мостом, а сессия пошла бы мостом своего сервера (наблюдено 7.2.1→7.2.2, #6626).
 * Сервер, которого нет (перезапуск), чужим не считается.
 */
const otherLive = (f: string): boolean => {
  const pid = Number(/\.(\d+)\.[^.]+\.json$/.exec(f)?.[1]);
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
};

/** Держащие мосты — на диск, кого держали: остановка плагина либо перенос сессии в другую папку (home — её локация). */
export function writeLostMarker(authDir: string, slots: Iterable<Held>, home: Home | null): void {
  const entries = [...slots]
    .filter((s) => s.holding && s.session)
    .map((s) =>
      entryOf({ ...s, session: s.session as string, of: s.satelliteOf, name: s.place?.name }),
    );
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
): { text: string | null; entries: LostEntry[]; wordFor: (s: string) => string | null } | null {
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
    if (otherLive(f)) continue; // маркер другого живого сервера — его экземпляру
    const lost = readOwn(join(authDir, f), tag, home);
    // Перенос, не взятый экземпляром новой папки сразу, устарел: сессия ушла дальше.
    const stale = !(Date.now() - Date.parse(lost?.at ?? "") < LEGACY_MS);
    for (const e of lost?.entries ?? []) {
      if (!e?.session || seen.has(e.session) || (e.moved && stale)) continue;
      seen.add(e.session);
      if (lost && lost.at > at) at = lost.at;
      entries.push(entryOf(e));
    }
  }
  if (!entries.length) return null;
  const when = new Date(at);
  const hhmm = Number.isNaN(when.getTime()) ? at : when.toTimeString().slice(0, 5);
  // Слово — корням, не перенесённым: места детей возвращаются тихо (children.ts), перенос — не потеря.
  // Каждой сессии — только её места: чужой ключ в её слове звал бы её возвращать чужое.
  const word = (of: LostEntry[]): string | null => {
    const where = of
      .filter((e) => !e.child && !e.moved)
      .map((e) => e.key ?? e.dir ?? e.session)
      .join(", ");
    return where
      ? `Искрон: слух был потерян в ${hhmm} — плагин остановили (перезапуск, вытеснение каталога) с держащим мостом: ${where}. ` +
          "Место возвращается с диска само; ожидавшие кадры придут пачкой. Не вернулось — iskron_stand."
      : null;
  };
  return {
    text: word(entries), // журналу — все
    entries,
    wordFor: (s) => word(entries.filter((e) => e.session === s)),
  };
}
