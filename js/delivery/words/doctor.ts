// Слова doctor (граф @nks/nks-dev, узел #6080): сборка, дом, сервер, грант, релиз,
// плагины харнесов и демон машины — то, что он печатает человеку.
import type { Lang } from "../lang.ts";

export interface DoctorWords {
  title: (build: string) => string;
  homeNone: (home: string) => string;
  homeSame: (home: string) => string;
  /** selfPath — путь этого файла; null — он не читается. */
  homeDiffers: (home: string, v: string, hash: string, selfPath: string | null) => string;
  srcArgument: () => string;
  srcEnv: () => string;
  srcFile: (p: string) => string;
  srcDefault: (p: string) => string;
  freshProd: () => string;
  freshOther: () => string;
  server: (url: string, source: string) => string;
  unreachable: (why: string) => string;
  wantsOAuth: () => string;
  noTokenProbe: () => string;
  answers: (status: number, note: string) => string;
  grantPat: (source: string) => string;
  patCheckFailed: (why: string) => string;
  patRejected: () => string;
  patAccepted: (status: number) => string;
  patOther: (status: number) => string;
  patStore: (path: string) => string;
  grant: (path: string) => string;
  noStore: () => string;
  noTokens: () => string;
  /** left — мс до истечения (null — срока нет), span — его модуль готовой строкой. */
  access: (usable: boolean, left: number | null, span: string) => string;
  refreshNone: () => string;
  refreshValidIn: (s: string) => string;
  refreshValid: () => string;
  refreshExpired: () => string;
  refreshExpiresIn: (s: string) => string;
  /** parts — части через запятую; пусто — без скобок. */
  refresh: (parts: string) => string;
  refusedSince: (since: string, reason: string) => string;
  lock: (p: string) => string;
  grantLog: () => string;
  latestNotAsked: () => string;
  latestUnknown: (why: string | undefined, ago: number) => string;
  /** downloaded — скачанное через запятую. */
  latestBehind: (latest: string, v: string, downloaded: string, ago: number) => string;
  latestCurrent: (latest: string, ago: number) => string;
  pluginMissing: (registry: string) => string;
  entryNotFound: () => string;
  entryFound: (name: string) => string;
  unreadable: (p: string) => string;
  pluginLine: (key: string, v: string, scope: string, entry: string, path: string) => string;
  claudeUnreadable: (p: string) => string;
  codexNoManifest: () => string;
  codexManifest: (v: string, hit: boolean) => string;
  codexPlugin: (plugin: string, market: string, word: string, dir: string) => string;
  codexNoPlugin: (cache: string) => string;
  claudeEntry: (name: string, cmd: string, args: string) => string;
  claudeNoManual: () => string;
  ocNoPlugin: (copy: string) => string;
  ocNoPackaged: (copy: string) => string;
  ocSame: (copy: string) => string;
  ocDiffers: (copy: string, packaged: string) => string;
  codexHome: (h: string) => string;
  codexDoorOpen: (door: string) => string;
  codexDoorNever: () => string;
  codexDoorNone: (door: string) => string;
  codexManual: (has: boolean) => string;
  daemonOn: () => string;
  daemonOff: () => string;
  daemonNeverUp: (dir: string) => string;
  daemonGrant: (dir: string) => string;
  daemonSocket: (s: string) => string;
  fallbackNone: () => string;
  fallbackCount: (n: number) => string;
  fallbackOne: (pid: number, build: string, since: string, cwd: string, why: string) => string;
  daemonAnswers: (
    pid: unknown,
    build: string,
    other: boolean,
    v: string,
    sessions: unknown,
    path?: string,
  ) => string;
  daemonUnsafe: (why: unknown) => string;
  daemonSilent: (socket: unknown, why: unknown) => string;
  thisFile: (p: string) => string;
}

export const DOCTOR: Readonly<Record<Lang, DoctorWords>> = {
  ru: {
    title: (build) => `iskron doctor — ${build}`,
    homeNone: (home) => `домашняя копия: нет (${home}) — её кладёт establish-mcp при подключении`,
    homeSame: (home) => `домашняя копия: ${home} — та же сборка, что и этот файл`,
    homeDiffers: (home, v, hash, selfPath) => {
      const fix = selfPath
        ? `обнови её из поставки: cp "${selfPath}" ${home}`
        : "этот файл не читается";
      return `домашняя копия: ${home} — v${v}+${hash}, ДРУГИЕ байты: ${fix}`;
    },
    srcArgument: () => "аргумент запуска",
    srcEnv: () => "переменная ISKRON_BRIDGE_URL",
    srcFile: (p) => `файл выбора ${p}`,
    srcDefault: (p) => `по умолчанию; сменить — node <мост> use en | ru | <url>, файл ${p}`,
    freshProd: () => "продовый адрес: самообновление с релизов поставки включено",
    freshOther: () => "другой инстанс: обновлений с релизов поставки нет",
    server: (url, source) => `сервер: ${url} (${source})`,
    unreachable: (why) => `  недостижим: ${why}`,
    wantsOAuth: () => " (просит OAuth)",
    noTokenProbe: () => " (пробник без токена — отказ ожидаем)",
    answers: (status, note) => `  отвечает: HTTP ${status}${note}`,
    grantPat: (source) => `грант: личный токен (PAT) из ${source} — OAuth не используется`,
    patCheckFailed: (why) => `  проверить не вышло: ${why}`,
    patRejected: () =>
      "  ТОКЕН ОТВЕРГНУТ (HTTP 401) — отозван, истёк или без прав на этот граф: выпусти новый на странице токенов графа",
    patAccepted: (status) => `  токен принят сервером (HTTP ${status})`,
    patOther: (status) =>
      `  сервер ответил HTTP ${status} — не отказ токена, смотри строку «сервер»`,
    patStore: (path) => `  хранилище OAuth ${path} есть, но не читается, пока стоит PAT`,
    grant: (path) => `грант: ${path}`,
    noStore: () => "  хранилища нет — мост ещё ни разу не входил на этот сервер",
    noTokens: () => "  токенов нет",
    access: (usable, left, span) =>
      `  access: ${usable ? "годен" : "не годен"}${left !== null ? ` (${left > 0 ? "истекает через" : "истёк"} ${span})` : ""}`,
    refreshNone: () => "  refresh: нет",
    refreshValidIn: (s) => `в силе через ${s}`,
    refreshValid: () => "в силе",
    refreshExpired: () => "ИСТЁК — нужен вход",
    refreshExpiresIn: (s) => `истекает через ${s}`,
    refresh: (parts) => `  refresh: есть${parts ? ` (${parts})` : ""}`,
    refusedSince: (since, reason) => `  отказ стоит с ${since}: ${reason}`,
    lock: (p) => `  замок: ${p}`,
    grantLog: () => "  grant.log, последнее:",
    latestNotAsked: () =>
      "свежий релиз: мост ещё не спрашивал релизы (спросит через пару секунд после старта сессии; руками — подкоманда update)",
    latestUnknown: (why, ago) =>
      `свежий релиз: не узнан (${why ?? "без причины"}), спрашивал ${ago} мин назад`,
    latestBehind: (latest, v, downloaded, ago) =>
      `свежий релиз: v${latest} — ЭТОТ ФАЙЛ ОТСТАЛ (v${v}); в дом скачано: ${downloaded || "ничего"}; спрашивал ${ago} мин назад`,
    latestCurrent: (latest, ago) =>
      `свежий релиз: v${latest}, этот файл не отстал; спрашивал ${ago} мин назад`,
    pluginMissing: (registry) => `Claude Code: плагин iskron не установлен (${registry})`,
    entryNotFound: () => "запись моста в манифесте не найдена",
    entryFound: (name) => `запись «${name}» → мост из плагина`,
    unreadable: (p) => `${p} не читается`,
    pluginLine: (key, v, scope, entry, path) =>
      `Claude Code: плагин ${key} v${v} (${scope}) — ${entry}; ${path}`,
    claudeUnreadable: (p) => `Claude Code: ${p} не читается`,
    codexNoManifest: () => "манифеста нет",
    codexManifest: (v, hit) =>
      `v${v}, ${hit ? "запись моста в манифесте есть" : "записи моста в манифесте нет"}`,
    codexPlugin: (plugin, market, word, dir) =>
      `Codex: плагин ${plugin}@${market} — ${word}; ${dir}`,
    codexNoPlugin: (cache) => `Codex: плагина iskron в кэше нет (${cache})`,
    claudeEntry: (name, cmd, args) => `Claude Code: запись «${name}» → ${cmd} ${args}`,
    claudeNoManual: () =>
      "Claude Code: ручной записи моста в пользовательском конфиге нет (штатная — в плагине)",
    ocNoPlugin: (copy) =>
      `OpenCode: плагина нет (${copy}) — его кладёт establish-mcp при подключении`,
    ocNoPackaged: (copy) =>
      `OpenCode: плагин ${copy} стоит; рядом с этим файлом поставки плагина нет, сверить не с чем`,
    ocSame: (copy) => `OpenCode: плагин ${copy} — та же сборка, что в поставке`,
    ocDiffers: (copy, packaged) =>
      `OpenCode: плагин ${copy} — ДРУГИЕ байты, обнови из поставки: cp "${packaged}" ${copy}`,
    codexHome: (h) => `Codex: дом ${h}`,
    codexDoorOpen: (door) => `Codex: дверь app-server открыта (${door})`,
    codexDoorNever: () =>
      "Codex: двери нет и не будет — дом длиннее предела unix-сокета; нужен короткий дом для демона и сессий",
    codexDoorNone: (door) =>
      `Codex: двери нет (${door}) — демон app-server не поднят; без неё кадр доставляет watchdog-exit`,
    codexManual: (has) =>
      `Codex: ${has ? "ручная запись моста в config.toml есть" : "ручной записи моста в config.toml нет (штатная — в плагине)"}`,
    daemonOn: () =>
      "демон машины: тонкий мост включён — умолчание (выключатель — ISKRON_BRIDGE_DAEMON=0 в окружении моста)",
    daemonOff: () =>
      "демон машины: выключен — мост идёт полным (выключатель стоит в окружении этого процесса: ISKRON_BRIDGE_DAEMON=0 или ISKRON_BRIDGE_NO_DAEMON)",
    daemonNeverUp: (dir) => `  не поднимался: каталога шва ${dir} нет`,
    daemonGrant: (dir) => `  каталог гранта: ${dir} — один демон на каталог`,
    daemonSocket: (s) => `  вход, сокет: ${s}`,
    fallbackNone: () =>
      "  мимо демона (полным мостом в своём процессе — запасным путём или выключателем) не идёт ни одна сессия",
    fallbackCount: (n) =>
      `  мимо демона (полным мостом в своём процессе — запасным путём или выключателем) идут сессий: ${n} — демон их не видит и в «сессий» не считает`,
    fallbackOne: (pid, build, since, cwd, why) =>
      `    pid ${pid}, сборка ${build}, с ${since}, каталог ${cwd}: ${why}`,
    daemonAnswers: (pid, build, other, v, sessions, path) =>
      `  отвечает: pid ${String(pid)}, сборка ${build}${other ? ` — ДРУГАЯ, чем этот файл (v${v})` : ""}, сессий ${String(sessions ?? "?")}${path ? `, файл ${path}` : ""}`,
    daemonUnsafe: (why) => `  вход не личный: ${String(why)} — тонкий мост пойдёт полным`,
    daemonSilent: (socket, why) => `  сокет: ${String(socket)} — не отвечает (${String(why)})`,
    thisFile: (p) => `этот файл: ${p}`,
  },
  en: {
    title: (build) => `iskron doctor — ${build}`,
    homeNone: (home) => `home copy: none (${home}) — establish-mcp places it on connect`,
    homeSame: (home) => `home copy: ${home} — the same build as this file`,
    homeDiffers: (home, v, hash, selfPath) => {
      const fix = selfPath
        ? `update it from the delivery: cp "${selfPath}" ${home}`
        : "this file is unreadable";
      return `home copy: ${home} — v${v}+${hash}, DIFFERENT bytes: ${fix}`;
    },
    srcArgument: () => "launch argument",
    srcEnv: () => "the ISKRON_BRIDGE_URL variable",
    srcFile: (p) => `choice file ${p}`,
    srcDefault: (p) => `the default; to change — node <bridge> use en | ru | <url>, file ${p}`,
    freshProd: () => "production address: self-update from the delivery releases is on",
    freshOther: () => "another instance: there are no updates from the delivery releases",
    server: (url, source) => `server: ${url} (${source})`,
    unreachable: (why) => `  unreachable: ${why}`,
    wantsOAuth: () => " (asks for OAuth)",
    noTokenProbe: () => " (a probe without a token — a refusal is expected)",
    answers: (status, note) => `  answers: HTTP ${status}${note}`,
    grantPat: (source) => `grant: a personal token (PAT) from ${source} — OAuth is not used`,
    patCheckFailed: (why) => `  the check failed: ${why}`,
    patRejected: () =>
      "  TOKEN REJECTED (HTTP 401) — revoked, expired or without rights to this graph: issue a new one on the graph's token page",
    patAccepted: (status) => `  the token is accepted by the server (HTTP ${status})`,
    patOther: (status) =>
      `  the server answered HTTP ${status} — not a token refusal, see the "server" line`,
    patStore: (path) => `  the OAuth store ${path} exists but is not read while a PAT is set`,
    grant: (path) => `grant: ${path}`,
    noStore: () => "  no store — the bridge has never logged in to this server",
    noTokens: () => "  no tokens",
    access: (usable, left, span) =>
      `  access: ${usable ? "usable" : "not usable"}${left !== null ? ` (${left > 0 ? "expires in" : "expired"} ${span})` : ""}`,
    refreshNone: () => "  refresh: none",
    refreshValidIn: (s) => `valid in ${s}`,
    refreshValid: () => "valid",
    refreshExpired: () => "EXPIRED — a login is needed",
    refreshExpiresIn: (s) => `expires in ${s}`,
    refresh: (parts) => `  refresh: present${parts ? ` (${parts})` : ""}`,
    refusedSince: (since, reason) => `  a refusal stands since ${since}: ${reason}`,
    lock: (p) => `  lock: ${p}`,
    grantLog: () => "  grant.log, latest:",
    latestNotAsked: () =>
      "latest release: the bridge has not asked about releases yet (it will in a couple of seconds after the session starts; by hand — the update subcommand)",
    latestUnknown: (why, ago) =>
      `latest release: unknown (${why ?? "no reason"}), asked ${ago} min ago`,
    latestBehind: (latest, v, downloaded, ago) =>
      `latest release: v${latest} — THIS FILE IS BEHIND (v${v}); downloaded to the home: ${downloaded || "nothing"}; asked ${ago} min ago`,
    latestCurrent: (latest, ago) =>
      `latest release: v${latest}, this file is not behind; asked ${ago} min ago`,
    pluginMissing: (registry) => `Claude Code: the iskron plugin is not installed (${registry})`,
    entryNotFound: () => "no bridge entry found in the manifest",
    entryFound: (name) => `entry "${name}" → the bridge from the plugin`,
    unreadable: (p) => `${p} is unreadable`,
    pluginLine: (key, v, scope, entry, path) =>
      `Claude Code: plugin ${key} v${v} (${scope}) — ${entry}; ${path}`,
    claudeUnreadable: (p) => `Claude Code: ${p} is unreadable`,
    codexNoManifest: () => "no manifest",
    codexManifest: (v, hit) =>
      `v${v}, ${hit ? "the bridge entry is in the manifest" : "no bridge entry in the manifest"}`,
    codexPlugin: (plugin, market, word, dir) =>
      `Codex: plugin ${plugin}@${market} — ${word}; ${dir}`,
    codexNoPlugin: (cache) => `Codex: no iskron plugin in the cache (${cache})`,
    claudeEntry: (name, cmd, args) => `Claude Code: entry "${name}" → ${cmd} ${args}`,
    claudeNoManual: () =>
      "Claude Code: no manual bridge entry in the user config (the standard one is in the plugin)",
    ocNoPlugin: (copy) => `OpenCode: no plugin (${copy}) — establish-mcp places it on connect`,
    ocNoPackaged: (copy) =>
      `OpenCode: the plugin ${copy} is installed; there is no plugin next to this delivery file, nothing to compare with`,
    ocSame: (copy) => `OpenCode: the plugin ${copy} — the same build as in the delivery`,
    ocDiffers: (copy, packaged) =>
      `OpenCode: the plugin ${copy} — DIFFERENT bytes, update from the delivery: cp "${packaged}" ${copy}`,
    codexHome: (h) => `Codex: home ${h}`,
    codexDoorOpen: (door) => `Codex: the app-server door is open (${door})`,
    codexDoorNever: () =>
      "Codex: there is no door and there will not be — the home is longer than the unix socket limit; a short home is needed for the daemon and sessions",
    codexDoorNone: (door) =>
      `Codex: no door (${door}) — the app-server daemon is not up; without it the frame is delivered by watchdog-exit`,
    codexManual: (has) =>
      `Codex: ${has ? "there is a manual bridge entry in config.toml" : "no manual bridge entry in config.toml (the standard one is in the plugin)"}`,
    daemonOn: () =>
      "machine daemon: the thin bridge is on — the default (the switch is ISKRON_BRIDGE_DAEMON=0 in the bridge environment)",
    daemonOff: () =>
      "machine daemon: off — the bridge runs full (the switch is set in this process environment: ISKRON_BRIDGE_DAEMON=0 or ISKRON_BRIDGE_NO_DAEMON)",
    daemonNeverUp: (dir) => `  never started: the seam directory ${dir} does not exist`,
    daemonGrant: (dir) => `  grant directory: ${dir} — one daemon per directory`,
    daemonSocket: (s) => `  entrance, socket: ${s}`,
    fallbackNone: () =>
      "  no session goes around the daemon (the full bridge in its own process — the fallback path or the switch)",
    fallbackCount: (n) =>
      `  sessions around the daemon (the full bridge in its own process — the fallback path or the switch): ${n} — the daemon does not see them nor count them in "sessions"`,
    fallbackOne: (pid, build, since, cwd, why) =>
      `    pid ${pid}, build ${build}, since ${since}, directory ${cwd}: ${why}`,
    daemonAnswers: (pid, build, other, v, sessions, path) =>
      `  answers: pid ${String(pid)}, build ${build}${other ? ` — DIFFERENT from this file (v${v})` : ""}, sessions ${String(sessions ?? "?")}${path ? `, file ${path}` : ""}`,
    daemonUnsafe: (why) =>
      `  the entrance is not private: ${String(why)} — the thin bridge will go full`,
    daemonSilent: (socket, why) => `  socket: ${String(socket)} — not answering (${String(why)})`,
    thisFile: (p) => `this file: ${p}`,
  },
};
