// Свежий тег релиза поставки (граф nks-dev: вимарша #6467). Анонимный REST API
// GitHub даёт 60 запросов в час на внешний адрес, и всё за ним — мосты, update,
// прочие клиенты — делит этот лимит. Запись сверки latest.json и так общая
// мостам под одним каталогом гранта (по умолчанию ~/.iskron-bridge, спутники
// тоже). Здесь новое: страница релизов — запасной путь мимо API; память
// известного лимита в доме моста — до сброса API не спрашивает ни один мост
// машины и ни одна подкоманда update; тот же файл отдаёт тег мостам с другим
// каталогом гранта; отказ по лимиту называет лимит и сброс.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { homeBridgePath } from "../shared/home.ts";
import { L } from "../shared/lang.ts";
import { VERSION } from "../shared/version.ts";
import { log } from "./streams.ts";

export const RELEASES_URL =
  process.env.ISKRON_BRIDGE_RELEASES_URL?.trim() ||
  "https://api.github.com/repos/iskron-ai/skills/releases/latest";
/**
 * Страница релизов — не REST API и не его анонимный лимит: её 302 называет
 * свежий тег. Запасной путь, когда API не ответил. API, наведённый переменной
 * не на GitHub, без своей страницы запасного пути не имеет — на прод отсюда не
 * сворачиваем.
 */
export const RELEASES_PAGE_URL: string | null =
  process.env.ISKRON_BRIDGE_RELEASES_PAGE_URL?.trim() ||
  (process.env.ISKRON_BRIDGE_RELEASES_URL?.trim()
    ? null
    : "https://github.com/iskron-ai/skills/releases/latest");
/** Сколько свежий тег из общего на машину кэша годен фоновой сверке любого моста. */
export const TAG_TTL_MS = 60 * 60 * 1000;
/** Общий на машину ответ «свежий тег» — в доме моста, не в каталоге гранта. */
export const releaseTagPath = (): string => join(dirname(homeBridgePath()), "release-tag.json");

export function writeAtomic(path: string, bytes: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, bytes, { mode: 0o644 });
  renameSync(tmp, path);
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

function resetWord(resetAt: number | null): string {
  const min = resetAt ? Math.max(0, Math.ceil((resetAt - Date.now()) / 60_000)) : 0;
  return resetAt
    ? L(
        `сброс ${new Date(resetAt).toISOString()} (через ${min} мин)`,
        `reset ${new Date(resetAt).toISOString()} (in ${min} min)`,
      )
    : L("время сброса GitHub не назвал", "GitHub did not name the reset time");
}

function rateLimitWord(limit: number | null, resetAt: number | null): string {
  const per = limit
    ? L(`${limit} запросов в час`, `${limit} requests an hour`)
    : L("лимит в час", "an hourly limit");
  return L(
    `лимит анонимного API GitHub исчерпан: ${per} на внешний адрес машины, общий всем мостам и клиентам за ним; ${resetWord(resetAt)}`,
    `the anonymous GitHub API limit is exhausted: ${per} per the machine's external address, shared by all bridges and clients behind it; ${resetWord(resetAt)}`,
  );
}

/**
 * Лимит или нет. Первичный — 403 с x-ratelimit-remaining: 0, срок —
 * x-ratelimit-reset. Вторичный (частота запросов) — 403 или 429 с retry-after
 * при оставшемся первичном, срок — retry-after. 429 без обоих — лимит без
 * названного срока. Прочее — null.
 */
function rateLimitOf(res: Response): RateLimitError | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const remaining = res.headers.get("x-ratelimit-remaining");
  const retrySec = Number(res.headers.get("retry-after"));
  if (remaining === "0") {
    const limit = Number(res.headers.get("x-ratelimit-limit")) || null;
    const resetSec = Number(res.headers.get("x-ratelimit-reset"));
    const resetAt =
      resetSec > 0 ? resetSec * 1000 : retrySec > 0 ? Date.now() + retrySec * 1000 : null;
    return new RateLimitError(rateLimitWord(limit, resetAt), limit, resetAt);
  }
  if (retrySec > 0 || res.status === 429) {
    const resetAt = retrySec > 0 ? Date.now() + retrySec * 1000 : null;
    return new RateLimitError(
      L(
        `вторичный лимит API GitHub: слишком частые запросы с внешнего адреса машины; ${resetWord(resetAt)}`,
        `GitHub API secondary limit: too frequent requests from the machine's external address; ${resetWord(resetAt)}`,
      ),
      null,
      resetAt,
    );
  }
  return null;
}

async function tagFromApi(): Promise<string | null> {
  const res = await fetch(RELEASES_URL, {
    headers: { accept: "application/vnd.github+json", "user-agent": `iskron-bridge/${VERSION}` },
    signal: AbortSignal.timeout(15_000),
  });
  const limited = rateLimitOf(res);
  if (limited) throw limited;
  if (!res.ok)
    throw new Error(
      L(`HTTP ${res.status} от ${RELEASES_URL}`, `HTTP ${res.status} from ${RELEASES_URL}`),
    );
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
    throw new Error(
      L(
        `HTTP ${res.status} от ${url}${location ? ` → ${location}` : ""} — тега нет`,
        `HTTP ${res.status} from ${url}${location ? ` → ${location}` : ""} — no tag`,
      ),
    );
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
export async function resolveTag(force: boolean): Promise<string | null> {
  const cached = readReleaseTag();
  const now = Date.now();
  if (!force && cached?.tag && now - cached.checked_at < TAG_TTL_MS) return cached.tag;
  const knownLimit =
    cached?.api_limited_until && now < cached.api_limited_until
      ? new RateLimitError(
          cached.api_limit
            ? rateLimitWord(cached.api_limit, cached.api_limited_until)
            : L(
                `лимит API GitHub, записанный другим мостом машины; ${resetWord(cached.api_limited_until)}`,
                `a GitHub API limit recorded by another bridge of the machine; ${resetWord(cached.api_limited_until)}`,
              ),
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
      log(
        L(
          `релизы: API не ответил (${apiErr?.message}) — тег ${tag} со страницы релизов`,
          `releases: the API did not answer (${apiErr?.message}) — tag ${tag} from the releases page`,
        ),
      );
      writeReleaseTag({
        source: RELEASES_URL,
        checked_at: Date.now(),
        tag,
        via: "page",
        ...limitFields,
      });
      return tag;
    } catch (e) {
      const both = `${apiErr?.message}; ${L("запасной путь", "fallback")} — ${(e as Error).message}`;
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
