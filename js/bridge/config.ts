import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

// Конфиг процесса — один на мост, выставляется в main() до первого вызова.
// Живая привязка ES-модуля: импортёры видят значение после setConfig.
export let CFG: Config = null as unknown as Config;

export function setConfig(cfg: Config): void {
  CFG = cfg;
}

export function parseArgs(argv: string[]): Config {
  const cfg: Config = {
    serverUrl: "",
    timeoutMs: Number(process.env.ISKRON_BRIDGE_TIMEOUT) || 120_000,
    authDir: process.env.ISKRON_BRIDGE_AUTH_DIR || join(homedir(), ".iskron-bridge"),
    clientName: "iskron-bridge",
    noBrowser: !!process.env.ISKRON_BRIDGE_NO_BROWSER,
    debug: !!process.env.ISKRON_BRIDGE_DEBUG,
    scope: process.env.ISKRON_BRIDGE_SCOPE || null,
    resource: process.env.ISKRON_BRIDGE_RESOURCE || null,
    staticClientId: process.env.ISKRON_BRIDGE_CLIENT_ID || null,
    pat: null,
    patSource: null,
    serverSource: "argument",
    // Только флагом: мост старше спутника на незнакомом флаге падает громко, а
    // переменную пропустил бы молча и встал бы полным местом с записью держания.
    satellite: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--timeout") cfg.timeoutMs = Number(argv[++i]);
    else if (a === "--auth-dir") cfg.authDir = argv[++i];
    else if (a === "--client-name") cfg.clientName = argv[++i];
    else if (a === "--no-browser") cfg.noBrowser = true;
    else if (a === "--debug") cfg.debug = true;
    else if (a === "--satellite") cfg.satellite = true;
    else if (a === "--version") {
      process.stdout.write(BUILD + "\n");
      process.exit(0);
    } else if (!a.startsWith("--") && !cfg.serverUrl) cfg.serverUrl = a;
    else {
      log(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!cfg.serverUrl) {
    const fromEnv = process.env.ISKRON_BRIDGE_URL?.trim();
    const fromFile = fromEnv ? null : readServerChoice(cfg.authDir);
    cfg.serverUrl = fromEnv || fromFile || DEFAULT_SERVER_URL;
    cfg.serverSource = fromEnv ? "ISKRON_BRIDGE_URL" : fromFile ? "file" : "default";
  }
  try {
    new URL(cfg.serverUrl);
  } catch {
    log(`not a URL: ${cfg.serverUrl}`);
    process.exit(2);
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
  const fromEnv = process.env.ISKRON_BRIDGE_TOKEN?.trim();
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
