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
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { homeBridgePath } from "../shared/home.ts";
import { L } from "../shared/lang.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION, versionIn } from "../shared/version.ts";
import { isProductionServer } from "./config.ts";
import { RateLimitError, resolveTag, writeAtomic } from "./releases.ts";
import { SKILLS_ROOT_ENV, skillsRoot } from "./skillset.ts";
import { emit, log } from "./streams.ts";

export const RAW_URL =
  process.env.ISKRON_BRIDGE_RAW_URL?.trim() || "https://raw.githubusercontent.com/iskron-ai/skills";
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Неудачная сверка без названного сброса повторяется через это время, не через шесть часов. */
export const FAILED_RETRY_MS = 15 * 60 * 1000;
/**
 * Повтор после неудачи: не раньше пола (часы машины могут спешить против
 * сброса, названного GitHub, — без пола повтор шёл бы каждую секунду) и с
 * разбросом на мост, чтобы мосты машины не шли к API в одну секунду сброса.
 * Переменные — только для проб.
 */
const envMs = (name: string, dflt: number): number => {
  const v = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(v) && v >= 0 ? v : dflt;
};
export const RETRY_FLOOR_MS = envMs("ISKRON_BRIDGE_RETRY_FLOOR_MS", 60_000);
export const RETRY_JITTER_MS = envMs("ISKRON_BRIDGE_RETRY_JITTER_MS", 60_000);
/** Пробы и CI: ни дома не трогать, ни в сеть не ходить. */
export const updatesDisabled = (): boolean => !!process.env.ISKRON_BRIDGE_NO_UPDATE;

export const selfPath = (): string => fileURLToPath(import.meta.url);
export const opencodePluginPath = (): string =>
  join(homedir(), ".config", "opencode", "plugins", "iskron.js");
export const setupPathOf = (authDir: string): string => join(authDir, "SETUP.md");
export const latestPathOf = (authDir: string): string => join(authDir, "latest.json");

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
  // Дом лежит вне набора скиллов: корень набора этой копии едет ему окружением (#6226).
  const root = skillsRoot();
  const child = spawn(process.execPath, [path, ...argv], {
    stdio: "inherit",
    env: {
      ...process.env,
      ISKRON_BRIDGE_REEXEC: "1",
      ...(root ? { [SKILLS_ROOT_ENV]: root } : {}),
    },
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
  /** Отказ — исчерпанный лимит API GitHub: до этой минуты (мс эпохи) спрашивать бессмысленно. */
  rate_limited_until?: number;
  /** Отказ — лимит API GitHub (первичный или вторичный), назван ли срок или нет. */
  rate_limited?: boolean;
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
 * Когда записанная сверка перестаёт быть ответом. Удачная — через шесть
 * часов; неудачная — не «проверено»: лимит держит её до своего сброса, прочий
 * отказ (сеть, скачивание) — четверть часа.
 */
export function checkExpiresAt(latest: Latest): number {
  if (!latest.error) return latest.checked_at + CHECK_INTERVAL_MS;
  if (latest.rate_limited_until) return latest.rate_limited_until;
  return latest.checked_at + FAILED_RETRY_MS;
}

/**
 * Что свежее: по кэшу, пока он в силе (checkExpiresAt), иначе — вопрос релизам
 * (resolveTag: общий на машину тег, API, страница релизов).
 * Свежее есть — скачивается в дом тем же ходом. Отказ сети — не ошибка моста:
 * записывается в кэш словом и повторяется коротко, не через шесть часов.
 */
export async function checkLatest(authDir: string, force = false): Promise<Latest | null> {
  const cached = readLatest(authDir);
  if (!force && cached && Date.now() < checkExpiresAt(cached)) return cached;
  const latest: Latest = { checked_at: Date.now(), version: null, tag: null, downloaded: [] };
  try {
    const tag = await resolveTag(force);
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
    if (e instanceof RateLimitError) {
      latest.rate_limited = true;
      if (e.resetAt) latest.rate_limited_until = e.resetAt;
    }
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
  const self = process.argv[1];
  const bridgeWord = latest.downloaded.some((p) => p === homeBridgePath())
    ? L(
        "Свежий мост уже скачан в ~/.iskron-bridge и поднимется новой сессией.",
        "The fresh bridge is already downloaded into ~/.iskron-bridge and comes up with a new session.",
      )
    : latest.error
      ? L(
          `Скачать свежий мост не вышло (${latest.error}); повтори: node "${self}" update.`,
          `Downloading the fresh bridge failed (${latest.error}); repeat: node "${self}" update.`,
        )
      : isSymlink(homeBridgePath())
        ? L(
            "Свежий мост в дом не положен: дом — симлинк на чужую копию, его не трогаю; обнови эту копию сам.",
            "The fresh bridge is not put home: home is a symlink to another copy, left alone; update that copy yourself.",
          )
        : versionOf(homeBridgePath()) &&
            compareVersions(versionOf(homeBridgePath()), latest.version) >= 0
          ? L(
              "Свежий мост уже лежит в ~/.iskron-bridge и поднимется новой сессией.",
              "The fresh bridge already lies in ~/.iskron-bridge and comes up with a new session.",
            )
          : L(
              `Свежий мост в дом не положен; повтори: node "${self}" update (мост, который отвечает, — тот и обновляет дом; в пакетной поставке OpenCode мост живёт в пакете и обновляется с ним).`,
              `The fresh bridge is not put home; repeat: node "${self}" update (the bridge that answers is the one that updates home; in OpenCode's packaged delivery the bridge lives in the package and updates with it).`,
            );
  return L(
    `[iskron-bridge] ПОСТАВКА ОТСТАЛА: этот мост v${VERSION}, свежий релиз v${latest.version}. ${bridgeWord} ` +
      `Скиллы обновляет канал харнеса, и об этом надо СКАЗАТЬ ЧЕЛОВЕКУ: Claude Code — /plugin marketplace update iskron, затем /reload-plugins; ` +
      `плоская установка — npx skills update --global; pi — pi update git:github.com/iskron-ai/skills; Codex — codex plugin marketplace upgrade iskron, затем codex plugin remove iskron@iskron и codex plugin add iskron@iskron. ` +
      `Полный порядок — свежий установщик ${setupPathOf(authDir)} (кладёт update); по слову человека «обнови» исполни его.`,
    `[iskron-bridge] DELIVERY BEHIND: this bridge is v${VERSION}, the fresh release is v${latest.version}. ${bridgeWord} ` +
      `The harness channel updates the skills, and this must be TOLD TO THE HUMAN: Claude Code — /plugin marketplace update iskron, then /reload-plugins; ` +
      `flat install — npx skills update --global; pi — pi update git:github.com/iskron-ai/skills; Codex — codex plugin marketplace upgrade iskron, then codex plugin remove iskron@iskron and codex plugin add iskron@iskron. ` +
      `The full order — the fresh installer ${setupPathOf(authDir)} (update puts it); on the human's word "update" run it.`,
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
  if (!explicit && !isProductionServer(serverUrl)) {
    log(
      `releases not watched: ${serverUrl} is not a production address — another instance is another delivery`,
    );
    return;
  }
  let retry: ReturnType<typeof setTimeout> | null = null;
  let told: string | null = null;
  const spread = Math.floor(Math.random() * RETRY_JITTER_MS); // свой у каждого моста
  const tick = async (): Promise<void> => {
    const latest = await checkLatest(authDir);
    if (retry) clearTimeout(retry);
    retry = null;
    if (latest?.error) {
      // Неудача — не «проверено»: следующая сверка после сброса лимита либо через
      // четверть часа, а не на шестичасовом такте (+1 с — сброс назван секундами),
      // не раньше пола и со своим разбросом (RETRY_FLOOR_MS, RETRY_JITTER_MS).
      const wait = Math.min(
        CHECK_INTERVAL_MS,
        Math.max(RETRY_FLOOR_MS, checkExpiresAt(latest) - Date.now() + 1000) + spread,
      );
      retry = setTimeout(() => void tick(), wait);
      retry.unref();
    }
    const notice = staleNotice(latest, authDir);
    if (!notice) return;
    if (latest?.error && notice === told) return; // короткий повтор той же неудачи не твердит то же слово
    told = notice;
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
