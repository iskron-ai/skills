// Обновление поставки — свойство самого моста, не памяти человека (граф
// nks-dev: #4509 под превращением #4504). Три движения:
//   • дом против себя при каждом старте: своя копия новее домашней — кладём
//     себя в дом (и плагин OpenCode рядом с ним); домашняя новее — запускаемся
//     ею (cli/iskron.ts), так что каким бы файлом ни запустил харнес, бежит
//     новейший;
//   • раз в шесть часов — вопрос релизам GitHub, что свежее; свежее есть —
//     скачать мост, плагин OpenCode и SETUP.md в дом и сказать об этом
//     уведомлением и строкой в ответе тула: скиллы обновляет канал харнеса,
//     о них надо сказать человеку;
//   • подкоманда update (cli/update.ts) — то же по требованию, без кэша.
// Источник свежести — только релизы репозитория поставки, не сервер графа:
// другой инстанс или форк сервера обновлений отсюда не получает.
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { homeBridgePath } from "../shared/home.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION, versionIn } from "../shared/version.ts";
import { DEFAULT_SERVER_URL } from "./config.ts";
import { emit, log } from "./streams.ts";

export const RELEASES_URL =
  process.env.ISKRON_BRIDGE_RELEASES_URL?.trim() ||
  "https://api.github.com/repos/iskron-ai/skills/releases/latest";
export const RAW_URL =
  process.env.ISKRON_BRIDGE_RAW_URL?.trim() || "https://raw.githubusercontent.com/iskron-ai/skills";
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Пробы и CI: ни дома не трогать, ни в сеть не ходить. */
export const updatesDisabled = (): boolean => !!process.env.ISKRON_BRIDGE_NO_UPDATE;

export const selfPath = (): string => fileURLToPath(import.meta.url);
export const opencodePluginPath = (): string =>
  join(homedir(), ".config", "opencode", "plugins", "iskron.js");
export const setupPathOf = (authDir: string): string => join(authDir, "SETUP.md");
export const latestPathOf = (authDir: string): string => join(authDir, "latest.json");

function writeAtomic(path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes, { mode: 0o644 });
  renameSync(tmp, path);
}

const isSymlink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

const versionOf = (path: string): string | null => {
  try {
    return versionIn(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

export interface HomeSync {
  /** Домашняя копия новее — этим файлом и надо бежать. */
  reexec?: string;
  /** Что положено в дом этим стартом. */
  copied: string[];
}

/**
 * Дом против себя. Своя версия строго новее домашней (или дома нет) — своя
 * копия ложится в дом; строго старше — дом побеждает и возвращается путём для
 * перезапуска; равная версия оставляет всё как есть: между релизами байты
 * различаются хешем, и по хешу старшинства нет.
 */
export function syncHome(self = selfPath()): HomeSync {
  const out: HomeSync = { copied: [] };
  const home = homeBridgePath();
  let mine: Buffer;
  try {
    mine = readFileSync(self);
  } catch {
    return out;
  }
  if (!versionIn(mine.toString("utf8"))) return out; // не сборка поставки — не выравниваем
  if (self === home) return out;
  if (isSymlink(home)) return out; // дом, наведённый руками на рабочую копию, — не наш
  const homeVersion = versionOf(home);
  const cmp = homeVersion ? compareVersions(VERSION, homeVersion) : 1;
  if (cmp > 0) {
    writeAtomic(home, mine);
    out.copied.push(home);
    const plugin = opencodePluginPath();
    const packaged = join(dirname(self), "opencode-plugin.js");
    if (existsSync(plugin) && existsSync(packaged)) {
      const fresh = readFileSync(packaged);
      if (!readFileSync(plugin).equals(fresh)) {
        writeAtomic(plugin, fresh);
        out.copied.push(plugin);
      }
    }
  } else if (cmp < 0 && homeVersion) {
    out.reexec = home;
  }
  return out;
}

/**
 * Перезапуск более свежей копией: тот же рантайм, те же аргументы, те же stdio,
 * сигналы вперёд, код выхода назад. Ограда от петли — переменная окружения:
 * дочерний не перезапускается снова, чем бы ни оказался его дом.
 */
export function reexec(path: string, argv: string[]): void {
  log(
    `домашняя копия новее этой сборки (v${versionOf(path) ?? "?"} > v${VERSION}) — запускаюсь ею: ${path}`,
  );
  const child = spawn(process.execPath, [path, ...argv], {
    stdio: "inherit",
    env: { ...process.env, ISKRON_BRIDGE_REEXEC: "1" },
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on("error", (e) => {
    log(`перезапуск не удался: ${e.message}`);
    process.exit(1);
  });
}

export interface Latest {
  checked_at: number;
  version: string | null;
  tag: string | null;
  /** Что скачано в дом при этой проверке. */
  downloaded: string[];
  error?: string;
}

export function readLatest(authDir: string): Latest | null {
  try {
    return JSON.parse(readFileSync(latestPathOf(authDir), "utf8")) as Latest;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json, text/plain, */*",
      "user-agent": `iskron-bridge/${VERSION}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} от ${url}`);
  return res.text();
}

/** Скачать релиз в дом: мост (только если дом старше), плагин OpenCode (если он стоит), SETUP.md. */
export async function downloadRelease(
  tag: string,
  version: string,
  authDir: string,
): Promise<string[]> {
  const written: string[] = [];
  const base = `${RAW_URL}/${tag}`;
  const bridge = await fetchText(`${base}/skills/establish-mcp/scripts/iskron.mjs`);
  const got = versionIn(bridge);
  if (got !== version)
    throw new Error(`скачанный мост называет v${got ?? "?"}, релиз — v${version}`);
  const home = homeBridgePath();
  const current = versionOf(home);
  if (!isSymlink(home) && (!current || compareVersions(version, current) > 0)) {
    writeAtomic(home, bridge);
    written.push(home);
  }
  const plugin = opencodePluginPath();
  if (existsSync(plugin)) {
    const fresh = await fetchText(`${base}/skills/establish-mcp/scripts/opencode-plugin.js`);
    if (readFileSync(plugin, "utf8") !== fresh) {
      writeAtomic(plugin, fresh);
      written.push(plugin);
    }
  }
  const setup = await fetchText(`${base}/SETUP.md`);
  writeAtomic(setupPathOf(authDir), setup);
  written.push(setupPathOf(authDir));
  return written;
}

/**
 * Что свежее: по кэшу, пока ему меньше шести часов, иначе — вопрос релизам.
 * Свежее есть — скачивается в дом тем же ходом. Отказ сети — не ошибка моста:
 * записывается в кэш словом и не повторяется до следующего окна.
 */
export async function checkLatest(authDir: string, force = false): Promise<Latest | null> {
  const cached = readLatest(authDir);
  if (!force && cached && Date.now() - cached.checked_at < CHECK_INTERVAL_MS) return cached;
  const latest: Latest = { checked_at: Date.now(), version: null, tag: null, downloaded: [] };
  try {
    const body = JSON.parse(await fetchText(RELEASES_URL)) as { tag_name?: string };
    const tag = body.tag_name?.trim() || null;
    latest.tag = tag;
    latest.version = tag ? tag.replace(/^v/, "") : null;
    if (latest.version && compareVersions(latest.version, VERSION) > 0) {
      latest.downloaded = await downloadRelease(tag as string, latest.version, authDir);
    } else if (force && tag) {
      // По требованию установщик берётся всегда: шаги установки могли смениться и без новой сборки моста.
      writeAtomic(setupPathOf(authDir), await fetchText(`${RAW_URL}/${tag}/SETUP.md`));
      latest.downloaded = [setupPathOf(authDir)];
    }
  } catch (e) {
    latest.error = (e as Error).message;
  }
  try {
    writeAtomic(latestPathOf(authDir), JSON.stringify(latest, null, 2));
  } catch {
    /* дом не пишется — скажем строкой, кэша не будет */
  }
  return latest;
}

/** Строка отставания — то, что агент обязан передать человеку. null — поставка свежа или неизвестна. */
export function staleNotice(latest: Latest | null, authDir: string): string | null {
  if (!latest?.version || compareVersions(latest.version, VERSION) <= 0) return null;
  const bridgeWord = latest.downloaded.some((p) => p === homeBridgePath())
    ? "Свежий мост уже скачан в ~/.iskron-bridge и поднимется новой сессией."
    : latest.error
      ? `Скачать свежий мост не вышло (${latest.error}); повтори: node ~/.iskron-bridge/iskron-bridge.mjs update.`
      : isSymlink(homeBridgePath())
        ? "Свежий мост в дом не положен: дом — симлинк на чужую копию, его не трогаю; обнови эту копию сам."
        : versionOf(homeBridgePath()) &&
            compareVersions(versionOf(homeBridgePath()), latest.version) >= 0
          ? "Свежий мост уже лежит в ~/.iskron-bridge и поднимется новой сессией."
          : "Свежий мост в дом не положен; повтори: node ~/.iskron-bridge/iskron-bridge.mjs update.";
  return (
    `[iskron-bridge] ПОСТАВКА ОТСТАЛА: этот мост v${VERSION}, свежий релиз v${latest.version}. ${bridgeWord} ` +
    `Скиллы обновляет канал харнеса, и об этом надо СКАЗАТЬ ЧЕЛОВЕКУ: Claude Code — /plugin marketplace update iskron, затем /reload-plugins; ` +
    `плоская установка — npx skills update --global; pi — pi update git:github.com/iskron-ai/skills; Codex — codex plugin update. ` +
    `Полный порядок — свежий установщик ${setupPathOf(authDir)} (кладёт update); по слову человека «обнови» исполни его.`
  );
}

let pendingNotice: string | null = null;

/** Строка отставания для первого ответа тула — отдаётся один раз. */
export function takeNotice(): string | null {
  const n = pendingNotice;
  pendingNotice = null;
  return n;
}

/**
 * Фоновая сверка с релизами: через пару секунд после старта и дальше раз в
 * шесть часов, только у моста, смотрящего на продовый инстанс (другой сервер —
 * другая поставка), и никогда под ISKRON_BRIDGE_NO_UPDATE. Отставание уходит
 * уведомлением MCP и строкой в ближайший ответ тула.
 */
export function startFreshnessWatch(authDir: string, serverUrl: string): void {
  if (updatesDisabled()) return;
  const explicit = !!process.env.ISKRON_BRIDGE_RELEASES_URL?.trim();
  if (!explicit && serverUrl.replace(/\/+$/, "") !== DEFAULT_SERVER_URL.replace(/\/+$/, "")) return;
  const tick = async (): Promise<void> => {
    const latest = await checkLatest(authDir);
    const notice = staleNotice(latest, authDir);
    if (!notice) return;
    pendingNotice = notice;
    log(notice);
    emit({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "warning", logger: "iskron-bridge", data: { kind: "stale", text: notice } },
    });
  };
  const delay = Number(process.env.ISKRON_BRIDGE_UPDATE_DELAY_MS ?? 2000);
  setTimeout(() => void tick(), Number.isFinite(delay) ? delay : 2000).unref();
  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
}
