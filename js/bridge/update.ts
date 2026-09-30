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
import { L } from "../shared/lang.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION, versionIn } from "../shared/version.ts";
import { isProductionServer } from "./config.ts";
import { SKILLS_ROOT_ENV, skillsRoot } from "./skillset.ts";
import { emit, log } from "./streams.ts";

export const RELEASES_URL =
  process.env.ISKRON_BRIDGE_RELEASES_URL?.trim() ||
  "https://api.github.com/repos/iskron-ai/skills/releases/latest";
/**
 * Страница релизов — не REST API и не его анонимный лимит (60 в час на внешний
 * адрес, общий всем мостам за ним): её 302 называет свежий тег. Запасной путь,
 * когда API не ответил. API, наведённый переменной не на GitHub, без своей
 * страницы запасного пути не имеет — на прод отсюда не сворачиваем.
 */
export const RELEASES_PAGE_URL: string | null =
  process.env.ISKRON_BRIDGE_RELEASES_PAGE_URL?.trim() ||
  (process.env.ISKRON_BRIDGE_RELEASES_URL?.trim()
    ? null
    : "https://github.com/iskron-ai/skills/releases/latest");
export const RAW_URL =
  process.env.ISKRON_BRIDGE_RAW_URL?.trim() || "https://raw.githubusercontent.com/iskron-ai/skills";
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Сколько свежий тег из общего на машину кэша годен фоновой сверке любого моста. */
export const TAG_TTL_MS = 60 * 60 * 1000;
/** Пробы и CI: ни дома не трогать, ни в сеть не ходить. */
export const updatesDisabled = (): boolean => !!process.env.ISKRON_BRIDGE_NO_UPDATE;

export const selfPath = (): string => fileURLToPath(import.meta.url);
export const opencodePluginPath = (): string =>
  join(homedir(), ".config", "opencode", "plugins", "iskron.js");
export const setupPathOf = (authDir: string): string => join(authDir, "SETUP.md");
export const latestPathOf = (authDir: string): string => join(authDir, "latest.json");
/** Общий на машину ответ «свежий тег» — в доме моста, не в каталоге гранта. */
export const releaseTagPath = (): string => join(dirname(homeBridgePath()), "release-tag.json");

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

/** Отказ API GitHub по анонимному лимиту — со словом, какой лимит и когда сброс. */
export class RateLimitError extends Error {
  readonly limit: number | null;
  readonly resetAt: number | null;
  constructor(message: string, limit: number | null, resetAt: number | null) {
    super(message);
    this.limit = limit;
    this.resetAt = resetAt;
  }
}

function rateLimitWord(limit: number | null, resetAt: number | null): string {
  const per = limit ? `${limit} запросов в час` : "лимит в час";
  const reset = resetAt
    ? `сброс ${new Date(resetAt).toISOString()} (через ${Math.max(0, Math.ceil((resetAt - Date.now()) / 60_000))} мин)`
    : "время сброса GitHub не назвал";
  return `лимит анонимного API GitHub исчерпан: ${per} на внешний адрес машины, общий всем мостам и клиентам за ним; ${reset}`;
}

/** 403 с x-ratelimit-remaining: 0 или 429 — лимит; иначе null. */
function rateLimitOf(res: Response): RateLimitError | null {
  const remaining = res.headers.get("x-ratelimit-remaining");
  if (!(res.status === 429 || (res.status === 403 && remaining === "0"))) return null;
  const limit = Number(res.headers.get("x-ratelimit-limit")) || null;
  const resetSec = Number(res.headers.get("x-ratelimit-reset"));
  const retrySec = Number(res.headers.get("retry-after"));
  const resetAt =
    resetSec > 0 ? resetSec * 1000 : retrySec > 0 ? Date.now() + retrySec * 1000 : null;
  return new RateLimitError(rateLimitWord(limit, resetAt), limit, resetAt);
}

async function tagFromApi(): Promise<string | null> {
  const res = await fetch(RELEASES_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": `iskron-bridge/${VERSION}` },
    signal: AbortSignal.timeout(15_000),
  });
  const limited = rateLimitOf(res);
  if (limited) throw limited;
  if (!res.ok) throw new Error(`HTTP ${res.status} от ${RELEASES_URL}`);
  const body = (await res.json()) as { tag_name?: string };
  return body.tag_name?.trim() || null;
}

/** Страница релизов отвечает 302 на …/releases/tag/<тег>; редиректу не следуем — тег в Location. */
async function tagFromPage(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "user-agent": `iskron-bridge/${VERSION}` },
    signal: AbortSignal.timeout(15_000),
  });
  const location = res.headers.get("location") ?? "";
  const m = /\/releases\/tag\/([^/?#]+)/.exec(location);
  if (res.status < 300 || res.status >= 400 || !m)
    throw new Error(`HTTP ${res.status} от ${url}${location ? ` → ${location}` : ""} — тега нет`);
  return decodeURIComponent(m[1] as string);
}

interface ReleaseTag {
  /** Адрес API, чей это ответ: наведённый на другой источник мост чужим тегом не пользуется. */
  source: string;
  checked_at: number;
  tag: string | null;
  via?: "api" | "page";
  /** API сказал «лимит исчерпан» — до сброса его не спрашивает ни один мост машины. */
  api_limited_until?: number;
  api_limit?: number | null;
}

function readReleaseTag(): ReleaseTag | null {
  try {
    const c = JSON.parse(readFileSync(releaseTagPath(), "utf8")) as ReleaseTag;
    return c.source === RELEASES_URL ? c : null;
  } catch {
    return null;
  }
}

function writeReleaseTag(c: ReleaseTag): void {
  try {
    writeAtomic(releaseTagPath(), JSON.stringify(c, null, 2));
  } catch {
    /* дом не пишется — каждый мост спросит сам */
  }
}

/**
 * Свежий тег. Фоновая сверка берёт его из общего на машину кэша, пока тому
 * меньше часа (force — подкоманда update — спрашивает всегда). Первым
 * спрашивается API: это документированный ответ, а с общим кэшем машина
 * тратит из анонимного лимита около запроса в час. Отказ API — любой — ведёт
 * на страницу релизов; известный лимит до своего сброса API не тревожит вовсе.
 */
async function resolveTag(force: boolean): Promise<string | null> {
  const cached = readReleaseTag();
  const now = Date.now();
  if (!force && cached?.tag && now - cached.checked_at < TAG_TTL_MS) return cached.tag;
  const knownLimit =
    cached?.api_limited_until && now < cached.api_limited_until
      ? new RateLimitError(
          rateLimitWord(cached.api_limit ?? null, cached.api_limited_until),
          cached.api_limit ?? null,
          cached.api_limited_until,
        )
      : null;
  let apiErr: Error | null = knownLimit;
  if (!knownLimit) {
    try {
      const tag = await tagFromApi();
      writeReleaseTag({ source: RELEASES_URL, checked_at: Date.now(), tag, via: "api" });
      return tag;
    } catch (e) {
      apiErr = e as Error;
    }
  }
  const limit = apiErr instanceof RateLimitError ? apiErr : null;
  const limitFields = limit?.resetAt
    ? { api_limited_until: limit.resetAt, api_limit: limit.limit }
    : {};
  if (RELEASES_PAGE_URL) {
    try {
      const tag = await tagFromPage(RELEASES_PAGE_URL);
      log(`релизы: API не ответил (${apiErr?.message}) — тег ${tag} со страницы релизов`);
      writeReleaseTag({
        source: RELEASES_URL,
        checked_at: Date.now(),
        tag,
        via: "page",
        ...limitFields,
      });
      return tag;
    } catch (e) {
      const both = `${apiErr?.message}; запасной путь — ${(e as Error).message}`;
      apiErr = limit ? new RateLimitError(both, limit.limit, limit.resetAt) : new Error(both);
    }
  }
  if (limit?.resetAt)
    writeReleaseTag({
      source: RELEASES_URL,
      checked_at: cached?.checked_at ?? 0,
      tag: cached?.tag ?? null,
      ...(cached?.via ? { via: cached.via } : {}),
      ...limitFields,
    });
  throw apiErr as Error;
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
 * Что свежее: по кэшу, пока ему меньше шести часов, иначе — вопрос релизам
 * (resolveTag: общий на машину тег, API, страница релизов).
 * Свежее есть — скачивается в дом тем же ходом. Отказ сети — не ошибка моста:
 * записывается в кэш словом и не повторяется до следующего окна.
 */
export async function checkLatest(authDir: string, force = false): Promise<Latest | null> {
  const cached = readLatest(authDir);
  if (!force && cached && Date.now() - cached.checked_at < CHECK_INTERVAL_MS) return cached;
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
    if (e instanceof RateLimitError && e.resetAt) latest.rate_limited_until = e.resetAt;
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
