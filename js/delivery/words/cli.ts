// Слова подкоманд исполняемого файла (граф @nks/nks-dev, узел #6080): справка --help,
// строка выравнивания дома, update и use.
import type { Lang } from "../lang.ts";

export interface CliWords {
  /** rituals — строка справки check-rituals (RITUALS.usage). */
  usage: (build: string, rituals: string) => string;
  homeUpdated: (path: string) => string;
  updateTitle: (build: string) => string;
  updateServer: (url: string, source: string, fresh: string) => string;
  /** reset — лимит назвал время сброса. */
  rateLimited: (error: string | undefined, reset: boolean) => string;
  latestUnknown: (error: string | undefined) => string;
  /** cmp — сравнение релиза с этим файлом: >0 отстал, <0 новее. */
  lag: (cmp: number) => string;
  latest: (version: string, tag: string | null, mine: string, lag: string) => string;
  downloadFailed: (error: string) => string;
  placed: (path: string) => string;
  nothingPlaced: (home: string) => string;
  next: () => string;
  stepSkills: (setup: string, fetched: boolean) => string;
  stepRestart: () => string;
  stepDoctor: () => string;
  useNoAddress: () => string;
  useWritten: (url: string, path: string, fresh: string) => string;
  useEffect: () => string;
}

export const CLI: Readonly<Record<Lang, CliWords>> = {
  ru: {
    usage: (build, rituals) => `iskron ${build}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug] [--satellite] [--tools <a,b,c>]
      (--satellite — мост прогона субагента из файла агента: только место-спутник <место позвавшего>.sub-N)
      (--tools — какие тулы видит харнес, iskron_stand всегда; без флага — все)
  node iskron.mjs watchdog [ключ] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-exit [ключ] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-codex [ключ] [--auth-dir <dir>] [--lang en|ru]   (из оболочки Codex: CODEX_THREAD_ID, CODEX_HOME)
      (--lang — язык поверхности; команду сторожа с ним печатает блок моста)
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs use <en|ru|url> [--auth-dir <dir>]   (en — mcp.iskron.ai, ru — mcp.iskron.ru)
  ${rituals}
  node iskron.mjs daemon --auth-dir <dir>   (демон машины; его поднимает тонкий мост — мост по умолчанию)
  node iskron.mjs version   (или --version)
  env: ISKRON_BRIDGE_TOKEN — личный токен вместо OAuth (или файл <auth-dir>/token);
       ISKRON_BRIDGE_DAEMON=0 — полный мост в своём процессе, без демона машины;
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`,
    homeUpdated: (path) => `[iskron-bridge] дом обновлён этой сборкой: ${path}\n`,
    updateTitle: (build) => `iskron update — ${build}`,
    updateServer: (url, source, fresh) => `сервер: ${url} (${source}) — ${fresh}`,
    rateLimited: (error, reset) =>
      `свежий релиз не узнан: ${error} — лимит GitHub; повтори ${reset ? "после сброса" : "позже"}`,
    latestUnknown: (error) =>
      `свежий релиз не узнан: ${error ?? "нет ответа"} — сеть или GitHub; повтори позже`,
    lag: (cmp) =>
      cmp > 0 ? " — отстал" : cmp < 0 ? " — новее релиза (сборка из ветки)" : " — не отстал",
    latest: (version, tag, mine, lag) =>
      `свежий релиз: v${version} (${tag}); этот файл: v${mine}${lag}`,
    downloadFailed: (error) => `скачать не вышло: ${error}`,
    placed: (path) => `положено: ${path}`,
    nothingPlaced: (home) => `в дом ничего не клалось: ${home} не старше релиза`,
    next: () => "Дальше:",
    stepSkills: (setup, fetched) =>
      `  1. Скиллы обновляет канал харнеса — порядок в свежем установщике ${setup}${fetched ? "" : " (не скачан — возьми из релиза)"}: прочти его и исполни шаги обновления для этого харнеса.`,
    stepRestart: () =>
      "  2. Перезапусти сессии харнеса: мост, поднятый прежней сборкой, живёт до конца своей сессии.",
    stepDoctor: () =>
      "  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — сверка, что стоит и работает.",
    useNoAddress: () =>
      "use: назови адрес — en (mcp.iskron.ai), ru (mcp.iskron.ru) или полный URL инстанса",
    useWritten: (url, path, fresh) => `мост смотрит на ${url} — записано в ${path}; ${fresh}`,
    useEffect: () =>
      "Действует с нового процесса моста: перезапусти сессии харнеса. Грант раздельный по адресу — первый вызов на новом адресе ведёт во вход.",
  },
  en: {
    usage: (build, rituals) => `iskron ${build}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug] [--satellite] [--tools <a,b,c>]
      (--satellite — the bridge of a subagent run from an agent file: only the satellite seat <caller's seat>.sub-N)
      (--tools — which tools the harness sees, iskron_stand always; without the flag — all)
  node iskron.mjs watchdog [key] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-exit [key] [--auth-dir <dir>] [--lang en|ru]
  node iskron.mjs watchdog-codex [key] [--auth-dir <dir>] [--lang en|ru]   (from the Codex shell: CODEX_THREAD_ID, CODEX_HOME)
      (--lang — the surface language; the bridge block prints the watchdog command with it)
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs use <en|ru|url> [--auth-dir <dir>]   (en — mcp.iskron.ai, ru — mcp.iskron.ru)
  ${rituals}
  node iskron.mjs daemon --auth-dir <dir>   (the machine daemon; the thin bridge raises it — the default bridge)
  node iskron.mjs version   (or --version)
  env: ISKRON_BRIDGE_TOKEN — a personal token instead of OAuth (or the file <auth-dir>/token);
       ISKRON_BRIDGE_DAEMON=0 — the full bridge in its own process, without the machine daemon;
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`,
    homeUpdated: (path) => `[iskron-bridge] home updated by this build: ${path}\n`,
    updateTitle: (build) => `iskron update — ${build}`,
    updateServer: (url, source, fresh) => `server: ${url} (${source}) — ${fresh}`,
    rateLimited: (error, reset) =>
      `latest release unknown: ${error} — GitHub rate limit; retry ${reset ? "after the reset" : "later"}`,
    latestUnknown: (error) =>
      `latest release unknown: ${error ?? "no answer"} — network or GitHub; retry later`,
    lag: (cmp) =>
      cmp > 0
        ? " — behind"
        : cmp < 0
          ? " — newer than the release (a branch build)"
          : " — not behind",
    latest: (version, tag, mine, lag) =>
      `latest release: v${version} (${tag}); this file: v${mine}${lag}`,
    downloadFailed: (error) => `download failed: ${error}`,
    placed: (path) => `placed: ${path}`,
    nothingPlaced: (home) =>
      `nothing was placed in the home: ${home} is not older than the release`,
    next: () => "Next:",
    stepSkills: (setup, fetched) =>
      `  1. Skills are updated by the harness channel — the order is in the fresh installer ${setup}${fetched ? "" : " (not downloaded — take it from the release)"}: read it and carry out the update steps for this harness.`,
    stepRestart: () =>
      "  2. Restart the harness sessions: a bridge started by the previous build lives until the end of its session.",
    stepDoctor: () =>
      "  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — a check of what is installed and working.",
    useNoAddress: () =>
      "use: name an address — en (mcp.iskron.ai), ru (mcp.iskron.ru) or the full URL of an instance",
    useWritten: (url, path, fresh) => `the bridge looks at ${url} — written to ${path}; ${fresh}`,
    useEffect: () =>
      "Takes effect from a new bridge process: restart the harness sessions. The grant is separate per address — the first call at a new address leads to login.",
  },
};
