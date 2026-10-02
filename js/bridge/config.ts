import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { setServerLang } from "../shared/lang.ts";
import { envOf, scoped } from "../shared/scope.ts";
import { BUILD } from "./build.ts";
import { log } from "./streams.ts";
import { type Config } from "./types.ts";

export const DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";
/** Английский Искрон (граф nks-dev: #5040): тот же продовый контур, второй адрес. */
export const ENGLISH_SERVER_URL = "https://mcp.iskron.ai/";
/** Продовые адреса — только за ними мост следит за релизами поставки; другой инстанс — другая поставка. */
const PRODUCTION_URLS = new Set([DEFAULT_SERVER_URL, ENGLISH_SERVER_URL].map(strip));
function strip(url: string): string {
  return url.replace(/\/+$/, "");
}
export const isProductionServer = (url: string): boolean => PRODUCTION_URLS.has(strip(url));
/** Слово человека об адресе: `ru` и `en` — два продовых, иначе полный URL. */
export function resolveServerChoice(word: string): string | null {
  const w = word.trim();
  if (/^(ru|russian|русский)$/i.test(w)) return DEFAULT_SERVER_URL;
  if (/^(en|ai|english|английский)$/i.test(w)) return ENGLISH_SERVER_URL;
  try {
    return new URL(w).href;
  } catch {
    return null;
  }
}

/**
 * Постоянный выбор адреса на машине — файл рядом с грантом: плагинная запись
 * харнеса аргументов не несёт, и иначе выбор до неё не доехал бы. Читается,
 * когда ни аргумент, ни окружение адреса не назвали.
 */
export const serverChoicePath = (authDir: string): string => join(authDir, "server");
export function readServerChoice(authDir: string): string | null {
  try {
    const text = readFileSync(serverChoicePath(authDir), "utf8").trim();
    return text ? new URL(text).href : null;
  } catch {
    return null;
  }
}
export function writeServerChoice(authDir: string, url: string): string {
  const path = serverChoicePath(authDir);
  mkdirSync(authDir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, url + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  return path;
}

// Конфиг моста — один на сессию (shared/scope.ts): у полного моста сессия одна,
// и конфиг лежит в области процесса; демон машины выставляет конфиг каждой
// сессии в её области из argv и окружения моста харнеса. Импортёры читают
// CFG.x как прежде — прокси отдаёт конфиг своей области.
const cfgSlot = scoped(() => ({ cfg: null as Config | null }));
export const CFG: Config = new Proxy({} as Config, {
  get: (_, k) => (cfgSlot.cfg ? Reflect.get(cfgSlot.cfg, k) : undefined),
  has: (_, k) => !!cfgSlot.cfg && Reflect.has(cfgSlot.cfg, k),
});

export function setConfig(cfg: Config): void {
  cfgSlot.cfg = cfg;
  setServerLang(cfg.serverUrl); // язык моста — по его серверу (shared/lang.ts)
}

/** Аргументы не годятся (или просят только версию): процесс уходит этим кодом, демон отказывает сессии. */
export class ArgsError extends Error {
  readonly code: number;
  /** Что сказать в stdout вместо слова в stderr (--version). */
  readonly out: string | null;
  constructor(message: string, code: number, out: string | null = null) {
    super(message);
    this.code = code;
    this.out = out;
  }
}

/** Разбор аргументов процесса: негодный — слово и выход, как всегда. */
export function parseArgs(argv: string[]): Config {
  try {
    return readArgs(argv);
  } catch (e) {
    if (!(e instanceof ArgsError)) throw e;
    if (e.out !== null) process.stdout.write(e.out);
    else log(e.message);
    process.exit(e.code);
  }
}

/** Разбор аргументов без выхода: негодный — ArgsError (демон — отказ сессии, не смерть). */
export function readArgs(argv: string[]): Config {
  const cfg: Config = {
    serverUrl: "",
    timeoutMs: Number(envOf("ISKRON_BRIDGE_TIMEOUT")) || 120_000,
    authDir: envOf("ISKRON_BRIDGE_AUTH_DIR") || join(homedir(), ".iskron-bridge"),
    clientName: "iskron-bridge",
    noBrowser: !!envOf("ISKRON_BRIDGE_NO_BROWSER"),
    debug: !!envOf("ISKRON_BRIDGE_DEBUG"),
    scope: envOf("ISKRON_BRIDGE_SCOPE") || null,
    resource: envOf("ISKRON_BRIDGE_RESOURCE") || null,
    staticClientId: envOf("ISKRON_BRIDGE_CLIENT_ID") || null,
    deviceClientId: envOf("ISKRON_BRIDGE_DEVICE_CLIENT") || null,
    pat: null,
    patSource: null,
    serverSource: "argument",
    // Только флагом: мост старше спутника на незнакомом флаге падает громко, а
    // переменную пропустил бы молча и встал бы полным местом с записью держания.
    satellite: false,
    tools: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--timeout") cfg.timeoutMs = Number(argv[++i]);
    else if (a === "--tools") {
      // Набор тулов харнеса (narrow.ts): имена через запятую, префикс iskron_ можно опустить.
      const names = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!names.length) {
        log("--tools needs a comma-separated list of tool names");
        process.exit(2);
      }
      cfg.tools = new Set(names.map((n) => (n.startsWith("iskron_") ? n : `iskron_${n}`)));
    } else if (a === "--auth-dir") cfg.authDir = argv[++i];
    else if (a === "--client-name") cfg.clientName = argv[++i];
    else if (a === "--no-browser") cfg.noBrowser = true;
    else if (a === "--debug") cfg.debug = true;
    else if (a === "--satellite") cfg.satellite = true;
    else if (a === "--version") throw new ArgsError("--version", 0, BUILD + "\n");
    else if (!a.startsWith("--") && !cfg.serverUrl) cfg.serverUrl = a;
    else throw new ArgsError(`unknown argument: ${a}`, 2);
  }
  if (!cfg.serverUrl) {
    const fromEnv = envOf("ISKRON_BRIDGE_URL")?.trim();
    const fromFile = fromEnv ? null : readServerChoice(cfg.authDir);
    cfg.serverUrl = fromEnv || fromFile || DEFAULT_SERVER_URL;
    cfg.serverSource = fromEnv ? "ISKRON_BRIDGE_URL" : fromFile ? "file" : "default";
  }
  try {
    new URL(cfg.serverUrl);
  } catch {
    throw new ArgsError(`not a URL: ${cfg.serverUrl}`, 2);
  }
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs < 1000) cfg.timeoutMs = 120_000;
  readPat(cfg);
  return cfg;
}

/**
 * Личный токен доступа (PAT) — второй вход моста, в обход OAuth (граф nks-dev:
 * #4267). Источники по старшинству: переменная ISKRON_BRIDGE_TOKEN, затем файл
 * `token` рядом с хранилищем гранта. Файл, а не флаг: в argv токен виден в ps.
 * С PAT мост не открывает discovery, не ходит в браузер и не обновляет ничего —
 * 401 при нём означает одно: токен отвергнут, и починит его только человек.
 */
function readPat(cfg: Config): void {
  const fromEnv = envOf("ISKRON_BRIDGE_TOKEN")?.trim();
  if (fromEnv) {
    cfg.pat = fromEnv;
    cfg.patSource = "ISKRON_BRIDGE_TOKEN";
    return;
  }
  const file = join(cfg.authDir, "token");
  try {
    const text = readFileSync(file, "utf8").trim();
    if (text) {
      cfg.pat = text;
      cfg.patSource = file;
    }
  } catch {
    /* файла нет — вход по OAuth, как прежде */
  }
}
