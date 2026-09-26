// Язык поставки (граф nks-dev: #6080; имена — нормой #6075): то, что пишет сам
// мост и его харнесы — ответ iskron_stand, шапки кадров, слово о входе в дело, —
// говорит на языке сервера. Хост на .ai — английский Искрон, иначе русский;
// ISKRON_BRIDGE_LANG=en|ru перебивает. Проза api и кадры, которые платформа
// рождает сама, — на языке сервера и без нас.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { authDirFromEnv } from "./standings.ts";

export type Lang = "ru" | "en";

/** Язык по адресу сервера: хост на .ai — en, иначе ru. */
export function langOfUrl(url: string): Lang {
  try {
    return /\.ai\.?$/i.test(new URL(url).hostname) ? "en" : "ru";
  } catch {
    return "ru";
  }
}

/** Язык, названный переменной ISKRON_BRIDGE_LANG; иначе null. */
export function forcedLang(): Lang | null {
  const v = process.env.ISKRON_BRIDGE_LANG?.trim().toLowerCase();
  return v === "en" || v === "ru" ? v : null;
}

/**
 * Язык там, где адреса сервера в руках нет (плагин, расширение, сторож): тот же
 * порядок, каким мост выбирает адрес без аргумента — ISKRON_BRIDGE_URL, файл
 * `server` рядом с грантом, умолчание (русский).
 */
function resolve(): Lang {
  const forced = forcedLang();
  if (forced) return forced;
  const fromEnv = process.env.ISKRON_BRIDGE_URL?.trim();
  if (fromEnv) return langOfUrl(fromEnv);
  try {
    const text = readFileSync(join(authDirFromEnv(), "server"), "utf8").trim();
    if (text) return langOfUrl(text);
  } catch {
    /* файла нет — умолчание */
  }
  return "ru";
}

let current: Lang | null = null;

/** Мост ставит язык по своему адресу сервера (аргумент мог назвать его сам); переменная всё равно старше. */
export function setServerLang(serverUrl: string): void {
  current = forcedLang() ?? langOfUrl(serverUrl);
}

export const lang = (): Lang => (current ??= resolve());

/** Слово на языке поставки: русское или английское. */
export const L = (ru: string, en: string): string => (lang() === "en" ? en : ru);
