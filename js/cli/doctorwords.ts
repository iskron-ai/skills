// Слова doctor (граф nks-dev: #6080): всё, что он печатает человеку, на языке поставки.
// Русские строки — те же байты, что были; английские — их перевод.
import { L } from "../shared/lang.ts";

export const dw = {
  homeNone: (home: string) =>
    L(
      `домашняя копия: нет (${home}) — её кладёт establish-mcp при подключении`,
      `home copy: none (${home}) — establish-mcp places it on connect`,
    ),
  homeSame: (home: string) =>
    L(
      `домашняя копия: ${home} — та же сборка, что и этот файл`,
      `home copy: ${home} — the same build as this file`,
    ),
  homeDiffers: (home: string, v: string, hash: string, selfPath: string | null) => {
    const fix = selfPath
      ? L(
          `обнови её из поставки: cp "${selfPath}" ${home}`,
          `update it from the delivery: cp "${selfPath}" ${home}`,
        )
      : L("этот файл не читается", "this file is unreadable");
    return L(
      `домашняя копия: ${home} — v${v}+${hash}, ДРУГИЕ байты: ${fix}`,
      `home copy: ${home} — v${v}+${hash}, DIFFERENT bytes: ${fix}`,
    );
  },
  srcArgument: () => L("аргумент запуска", "launch argument"),
  srcEnv: () => L("переменная ISKRON_BRIDGE_URL", "the ISKRON_BRIDGE_URL variable"),
  srcFile: (p: string) => L(`файл выбора ${p}`, `choice file ${p}`),
  srcDefault: (p: string) =>
    L(
      `по умолчанию; сменить — node <мост> use en | ru | <url>, файл ${p}`,
      `the default; to change — node <bridge> use en | ru | <url>, file ${p}`,
    ),
  freshProd: () =>
    L(
      "продовый адрес: самообновление с релизов поставки включено",
      "production address: self-update from the delivery releases is on",
    ),
  freshOther: () =>
    L(
      "другой инстанс: обновлений с релизов поставки нет",
      "another instance: there are no updates from the delivery releases",
    ),
  server: (url: string, source: string) =>
    L(`сервер: ${url} (${source})`, `server: ${url} (${source})`),
  unreachable: (why: string) => L(`  недостижим: ${why}`, `  unreachable: ${why}`),
  wantsOAuth: () => L(" (просит OAuth)", " (asks for OAuth)"),
  noTokenProbe: () =>
    L(
      " (пробник без токена — отказ ожидаем)",
      " (a probe without a token — a refusal is expected)",
    ),
  answers: (status: number, note: string) =>
    L(`  отвечает: HTTP ${status}${note}`, `  answers: HTTP ${status}${note}`),
  grantPat: (source: string) =>
    L(
      `грант: личный токен (PAT) из ${source} — OAuth не используется`,
      `grant: a personal token (PAT) from ${source} — OAuth is not used`,
    ),
  patCheckFailed: (why: string) => L(`  проверить не вышло: ${why}`, `  the check failed: ${why}`),
  patRejected: () =>
    L(
      "  ТОКЕН ОТВЕРГНУТ (HTTP 401) — отозван, истёк или без прав на этот граф: выпусти новый на странице токенов графа",
      "  TOKEN REJECTED (HTTP 401) — revoked, expired or without rights to this graph: issue a new one on the graph's token page",
    ),
  patAccepted: (status: number) =>
    L(
      `  токен принят сервером (HTTP ${status})`,
      `  the token is accepted by the server (HTTP ${status})`,
    ),
  patOther: (status: number) =>
    L(
      `  сервер ответил HTTP ${status} — не отказ токена, смотри строку «сервер»`,
      `  the server answered HTTP ${status} — not a token refusal, see the "server" line`,
    ),
  patStore: (path: string) =>
    L(
      `  хранилище OAuth ${path} есть, но не читается, пока стоит PAT`,
      `  the OAuth store ${path} exists but is not read while a PAT is set`,
    ),
  grant: (path: string) => L(`грант: ${path}`, `grant: ${path}`),
  noStore: () =>
    L(
      "  хранилища нет — мост ещё ни разу не входил на этот сервер",
      "  no store — the bridge has never logged in to this server",
    ),
  noTokens: () => L("  токенов нет", "  no tokens"),
  access: (usable: boolean, left: number | null, secs: (ms: number) => string) =>
    L(
      `  access: ${usable ? "годен" : "не годен"}${left !== null ? ` (${left > 0 ? "истекает через" : "истёк"} ${secs(Math.abs(left))})` : ""}`,
      `  access: ${usable ? "usable" : "not usable"}${left !== null ? ` (${left > 0 ? "expires in" : "expired"} ${secs(Math.abs(left))})` : ""}`,
    ),
  refreshNone: () => L("  refresh: нет", "  refresh: none"),
  refreshValidIn: (s: string) => L(`в силе через ${s}`, `valid in ${s}`),
  refreshValid: () => L("в силе", "valid"),
  refreshExpired: () => L("ИСТЁК — нужен вход", "EXPIRED — a login is needed"),
  refreshExpiresIn: (s: string) => L(`истекает через ${s}`, `expires in ${s}`),
  refresh: (parts: string[]) =>
    L(
      `  refresh: есть${parts.length ? ` (${parts.join(", ")})` : ""}`,
      `  refresh: present${parts.length ? ` (${parts.join(", ")})` : ""}`,
    ),
  refusedSince: (since: string, reason: string) =>
    L(`  отказ стоит с ${since}: ${reason}`, `  a refusal stands since ${since}: ${reason}`),
  lock: (p: string) => L(`  замок: ${p}`, `  lock: ${p}`),
  grantLog: () => L("  grant.log, последнее:", "  grant.log, latest:"),
  latestNotAsked: () =>
    L(
      "свежий релиз: мост ещё не спрашивал релизы (спросит через пару секунд после старта сессии; руками — подкоманда update)",
      "latest release: the bridge has not asked about releases yet (it will in a couple of seconds after the session starts; by hand — the update subcommand)",
    ),
  latestUnknown: (why: string | undefined, ago: number) =>
    L(
      `свежий релиз: не узнан (${why ?? "без причины"}), спрашивал ${ago} мин назад`,
      `latest release: unknown (${why ?? "no reason"}), asked ${ago} min ago`,
    ),
  latestBehind: (latest: string, v: string, downloaded: string[], ago: number) =>
    L(
      `свежий релиз: v${latest} — ЭТОТ ФАЙЛ ОТСТАЛ (v${v}); в дом скачано: ${downloaded.join(", ") || "ничего"}; спрашивал ${ago} мин назад`,
      `latest release: v${latest} — THIS FILE IS BEHIND (v${v}); downloaded to the home: ${downloaded.join(", ") || "nothing"}; asked ${ago} min ago`,
    ),
  latestCurrent: (latest: string, ago: number) =>
    L(
      `свежий релиз: v${latest}, этот файл не отстал; спрашивал ${ago} мин назад`,
      `latest release: v${latest}, this file is not behind; asked ${ago} min ago`,
    ),
  pluginMissing: (registry: string) =>
    L(
      `Claude Code: плагин iskron не установлен (${registry})`,
      `Claude Code: the iskron plugin is not installed (${registry})`,
    ),
  entryNotFound: () =>
    L("запись моста в манифесте не найдена", "no bridge entry found in the manifest"),
  entryFound: (name: string) =>
    L(`запись «${name}» → мост из плагина`, `entry "${name}" → the bridge from the plugin`),
  unreadable: (p: string) => L(`${p} не читается`, `${p} is unreadable`),
  pluginLine: (key: string, v: string, scope: string, entry: string, path: string) =>
    L(
      `Claude Code: плагин ${key} v${v} (${scope}) — ${entry}; ${path}`,
      `Claude Code: plugin ${key} v${v} (${scope}) — ${entry}; ${path}`,
    ),
  claudeUnreadable: (p: string) =>
    L(`Claude Code: ${p} не читается`, `Claude Code: ${p} is unreadable`),
  codexNoManifest: () => L("манифеста нет", "no manifest"),
  codexManifest: (v: string, hit: boolean) =>
    L(
      `v${v}, ${hit ? "запись моста в манифесте есть" : "записи моста в манифесте нет"}`,
      `v${v}, ${hit ? "the bridge entry is in the manifest" : "no bridge entry in the manifest"}`,
    ),
  codexPlugin: (plugin: string, market: string, word: string, dir: string) =>
    L(
      `Codex: плагин ${plugin}@${market} — ${word}; ${dir}`,
      `Codex: plugin ${plugin}@${market} — ${word}; ${dir}`,
    ),
  codexNoPlugin: (cache: string) =>
    L(
      `Codex: плагина iskron в кэше нет (${cache})`,
      `Codex: no iskron plugin in the cache (${cache})`,
    ),
  claudeEntry: (name: string, cmd: string, args: string) =>
    L(
      `Claude Code: запись «${name}» → ${cmd} ${args}`,
      `Claude Code: entry "${name}" → ${cmd} ${args}`,
    ),
  claudeNoManual: () =>
    L(
      "Claude Code: ручной записи моста в пользовательском конфиге нет (штатная — в плагине)",
      "Claude Code: no manual bridge entry in the user config (the standard one is in the plugin)",
    ),
  ocNoPlugin: (copy: string) =>
    L(
      `OpenCode: плагина нет (${copy}) — его кладёт establish-mcp при подключении`,
      `OpenCode: no plugin (${copy}) — establish-mcp places it on connect`,
    ),
  ocNoPackaged: (copy: string) =>
    L(
      `OpenCode: плагин ${copy} стоит; рядом с этим файлом поставки плагина нет, сверить не с чем`,
      `OpenCode: the plugin ${copy} is installed; there is no plugin next to this delivery file, nothing to compare with`,
    ),
  ocSame: (copy: string) =>
    L(
      `OpenCode: плагин ${copy} — та же сборка, что в поставке`,
      `OpenCode: the plugin ${copy} — the same build as in the delivery`,
    ),
  ocDiffers: (copy: string, packaged: string) =>
    L(
      `OpenCode: плагин ${copy} — ДРУГИЕ байты, обнови из поставки: cp "${packaged}" ${copy}`,
      `OpenCode: the plugin ${copy} — DIFFERENT bytes, update from the delivery: cp "${packaged}" ${copy}`,
    ),
  codexHome: (h: string) => L(`Codex: дом ${h}`, `Codex: home ${h}`),
  codexDoorOpen: (door: string) =>
    L(`Codex: дверь app-server открыта (${door})`, `Codex: the app-server door is open (${door})`),
  codexDoorNever: () =>
    L(
      "Codex: двери нет и не будет — дом длиннее предела unix-сокета; нужен короткий дом для демона и сессий",
      "Codex: there is no door and there will not be — the home is longer than the unix socket limit; a short home is needed for the daemon and sessions",
    ),
  codexDoorNone: (door: string) =>
    L(
      `Codex: двери нет (${door}) — демон app-server не поднят; без неё кадр доставляет watchdog-exit`,
      `Codex: no door (${door}) — the app-server daemon is not up; without it the frame is delivered by watchdog-exit`,
    ),
  codexManual: (has: boolean) =>
    L(
      `Codex: ${has ? "ручная запись моста в config.toml есть" : "ручной записи моста в config.toml нет (штатная — в плагине)"}`,
      `Codex: ${has ? "there is a manual bridge entry in config.toml" : "no manual bridge entry in config.toml (the standard one is in the plugin)"}`,
    ),
  daemonOn: () =>
    L(
      "демон машины: тонкий мост включён — умолчание (выключатель — ISKRON_BRIDGE_DAEMON=0 в окружении моста)",
      "machine daemon: the thin bridge is on — the default (the switch is ISKRON_BRIDGE_DAEMON=0 in the bridge environment)",
    ),
  daemonOff: () =>
    L(
      "демон машины: выключен — мост идёт полным (выключатель стоит в окружении этого процесса: ISKRON_BRIDGE_DAEMON=0 или ISKRON_BRIDGE_NO_DAEMON)",
      "machine daemon: off — the bridge runs full (the switch is set in this process environment: ISKRON_BRIDGE_DAEMON=0 or ISKRON_BRIDGE_NO_DAEMON)",
    ),
  daemonNeverUp: (dir: string) =>
    L(
      `  не поднимался: каталога шва ${dir} нет`,
      `  never started: the seam directory ${dir} does not exist`,
    ),
  daemonSocket: (s: string) => L(`  сокет: ${s}`, `  socket: ${s}`),
  daemonAnswers: (
    pid: unknown,
    build: string,
    other: boolean,
    v: string,
    sessions: unknown,
    path?: string,
  ) =>
    L(
      `  отвечает: pid ${pid}, сборка ${build}${other ? ` — ДРУГАЯ, чем этот файл (v${v})` : ""}, сессий ${sessions ?? "?"}${path ? `, файл ${path}` : ""}`,
      `  answers: pid ${pid}, build ${build}${other ? ` — DIFFERENT from this file (v${v})` : ""}, sessions ${sessions ?? "?"}${path ? `, file ${path}` : ""}`,
    ),
  daemonUnsafe: (why: unknown) =>
    L(
      `  вход не личный: ${why} — тонкий мост пойдёт полным`,
      `  the entrance is not private: ${why} — the thin bridge will go full`,
    ),
  daemonSilent: (socket: unknown, why: unknown) =>
    L(`  сокет: ${socket} — не отвечает (${why})`, `  socket: ${socket} — not answering (${why})`),
  thisFile: (p: string) => L(`этот файл: ${p}`, `this file: ${p}`),
};
