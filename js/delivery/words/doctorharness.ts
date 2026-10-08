// Слова doctor о харнесах (граф @nks/nks-dev, узлы #6080, #6727, #6728, #4509): команда
// записи моста в PATH, второй путь мимо моста, отставание набора скиллов, записи mcp OpenCode.
import type { Lang } from "../lang.ts";

export interface HarnessWords {
  /** Ход починки команды записи; node — найденный node, иначе null; bridge — путь домашнего моста. */
  launchFix: (
    harness: "claude" | "codex",
    entry: string | undefined,
    node: string | null,
    bridge: string,
  ) => string;
  launchNotFound: (who: string, cmd: string, absolute: boolean) => string;
  launchAbsolute: (who: string, cmd: string) => string;
  launchFound: (who: string, cmd: string, found: string) => string;
  launchProfile: (who: string, cmd: string, found: string, dir: string) => string;
  openCodeRuntime: () => string;
  secondPath: (where: string, name: string, url: string, remove: string) => string;
  deleteFrom: (file: string) => string;
  connector: (name: string, file: string) => string;
  skillsOtherChannel: (pi: string) => string;
  skillsNone: () => string;
  skillsUnreadable: (root: string) => string;
  skillsCurrent: (root: string, v: string) => string;
  skillsBelowBridge: (bridge: string) => string;
  skillsBelowRelease: (release: string) => string;
  skillsBehind: (root: string, v: string, why: string, how: string) => string;
  ocUnreadable: (file: string) => string;
  ocDisabled: (name: string, file: string) => string;
  ocBridge: (name: string, file: string, path: string) => string;
  ocHttp: (name: string, file: string) => string;
  ocNone: (unreadable: number, cwd: string) => string;
}

export const HARNESS: Readonly<Record<Lang, HarnessWords>> = {
  ru: {
    launchFix: (harness, entry, node, bridge) => {
      const abs = node ?? "<абсолютный путь к node: command -v node>";
      const shell = "запускай харнесс из оболочки, где node находится";
      const alt =
        harness === "codex"
          ? "плагинной записи Codex абсолютного пути не вписать, а вторая запись рядом дала бы два моста"
          : `либо запись с абсолютным путём к node, от PATH не зависящая: ${entry ? `claude mcp remove "${entry}" --scope user, затем ` : ""}claude mcp add --scope user "${entry ?? "iskron-bridge"}" -- ${abs} "${bridge}"${entry ? "" : " — и выключи запись плагина plugin:iskron:iskron в /mcp, чтобы мост был один"}; путь привязан к этой установке node — сменишь её, перепиши запись`;
      return `    ход: ${shell}; ${alt}`;
    },
    launchNotFound: (who, cmd, absolute) =>
      `НАДО: ${who}: команда «${cmd}» не найдена${absolute ? "" : " в PATH этой оболочки"} или не исполнима — харнесс мост не поднимет (spawn ENOENT)`,
    launchAbsolute: (who, cmd) => `${who}: команда ${cmd} — исполнима, от PATH не зависит`,
    launchFound: (who, cmd, found) => `${who}: «${cmd}» → ${found}`,
    launchProfile: (who, cmd, found, dir) =>
      `${who}: «${cmd}» → ${found} — в PATH этой оболочки; каталог ${dir} кладёт туда профиль оболочки или менеджер версий, и харнесс, запущенный не из оболочки (приложение, сервис), его может не увидеть. Какой PATH у харнесса, отсюда не видно; пишет харнесс spawn ENOENT — ход строкой ниже`,
    openCodeRuntime: () =>
      "OpenCode: мост плагина бежит на рантайме самого OpenCode — от node в PATH не зависит",
    secondPath: (where, name, url, remove) =>
      `НАДО: ${where}: запись «${name}» ведёт ${url} напрямую по http, мимо моста — второй путь к тому же серверу: тулы двоятся, записи этого пути уходят без места. Путь к графу один — мост → убери её: ${remove}`,
    deleteFrom: (file) => `удали её из ${file}`,
    connector: (name, file) =>
      `Claude Code: коннектор «${name}» в истории подключений (${file}, claudeAiMcpEverConnected; строка останется и после снятия) — коннекторы claude.ai приходят в каждую сессию Claude Code рядом с мостом, а адреса коннектора на диске нет. Если он стоит и ведёт на сервер графа — это второй путь мимо моста → убери его в claude.ai (Настройки → Коннекторы) или выключи в Claude Code (/mcp)`,
    skillsOtherChannel: (pi) =>
      `тем каналом, которым набор ставили (pi — ${pi}; порядок — SETUP.md, раздел «Обновление»)`,
    skillsNone: () =>
      "скиллы: набора поставки не нашёл (плагин Claude Code, плагин Codex, ~/.agents/skills, ISKRON_SKILLS_ROOT)",
    skillsUnreadable: (root) => `скиллы: ${root} — версия набора не читается`,
    skillsCurrent: (root, v) => `скиллы: ${root} — v${v}, не ниже моста`,
    skillsBelowBridge: (bridge) => `НИЖЕ моста v${bridge}: метод в контексте агента старше моста`,
    skillsBelowRelease: (release) =>
      `НИЖЕ релиза v${release}, вровень с мостом: отстала поставка целиком (мост — подкоманда update)`,
    skillsBehind: (root, v, why, how) =>
      `НАДО: скиллы: ${root} — v${v}, ${why} → обнови набор: ${how}; затем новая сессия`,
    ocUnreadable: (file) => `OpenCode: ${file} не читается`,
    ocDisabled: (name, file) =>
      `OpenCode: запись mcp «${name}» в ${file} ведёт Искрон, но выключена — не в игре`,
    ocBridge: (name, file, path) =>
      `OpenCode: запись mcp «${name}» в ${file} зовёт ${path} — похоже на мост поставки. Если это он, её тулы namespaced, а мост общий для сессий сервиса: запись может уйти под подписью соседней сессии. Тогда убери её из этого файла руками: у opencode mcp есть list, add, auth, logout — команды remove нет. Поверхность поставки это плагин`,
    ocHttp: (name, file) =>
      `OpenCode: запись mcp «${name}» в ${file} ведёт Искрон напрямую по http, мимо моста — её тулы namespaced, стояния канала у неё нет, и записи уходят без места. Путь к графу один — мост, его приносит плагин поставки. Убери её из этого файла руками: у opencode mcp есть list, add, auth, logout — команды remove нет`,
    ocNone: (unreadable, cwd) =>
      `OpenCode: записей mcp Искрона не нашёл${unreadable ? ` в том, что прочёл (${unreadable} файл(а) не разобрались — смотри строки выше)` : ""} — смотрел вверх от ${cwd}, глобальный слой и переменные; запись в другом дереве этим не проверена, позови doctor из каталога проекта`,
  },
  en: {
    launchFix: (harness, entry, node, bridge) => {
      const abs = node ?? "<absolute node path: command -v node>";
      const shell = "start the harness from a shell where node is found";
      const alt =
        harness === "codex"
          ? "the Codex plugin entry takes no absolute path, and a second entry beside it would make two bridges"
          : `or an entry with the absolute node path, independent of PATH: ${entry ? `claude mcp remove "${entry}" --scope user, then ` : ""}claude mcp add --scope user "${entry ?? "iskron-bridge"}" -- ${abs} "${bridge}"${entry ? "" : " — and disable the plugin entry plugin:iskron:iskron in /mcp so the bridge is one"}; the path is tied to this node install — change it, rewrite the entry`;
      return `    fix: ${shell}; ${alt}`;
    },
    launchNotFound: (who, cmd, absolute) =>
      `TODO: ${who}: the command "${cmd}" is not found${absolute ? "" : " in this shell's PATH"} or not executable — the harness will not raise the bridge (spawn ENOENT)`,
    launchAbsolute: (who, cmd) =>
      `${who}: the command ${cmd} is executable and independent of PATH`,
    launchFound: (who, cmd, found) => `${who}: "${cmd}" → ${found}`,
    launchProfile: (who, cmd, found, dir) =>
      `${who}: "${cmd}" → ${found} — in this shell's PATH; the directory ${dir} is put there by the shell profile or a version manager, and a harness started outside a shell (an app, a service) may not see it. The harness's PATH cannot be seen from here; if the harness says spawn ENOENT — the fix is on the next line`,
    openCodeRuntime: () =>
      "OpenCode: the plugin's bridge runs on OpenCode's own runtime — independent of node in PATH",
    secondPath: (where, name, url, remove) =>
      `TODO: ${where}: the entry "${name}" leads to ${url} directly over http, around the bridge — a second path to the same server: the tools double, and writes on this path go out without a seat. The one path to the graph is the bridge → remove it: ${remove}`,
    deleteFrom: (file) => `delete it from ${file}`,
    connector: (name, file) =>
      `Claude Code: the connector "${name}" is in the connection history (${file}, claudeAiMcpEverConnected; the line stays after removal) — claude.ai connectors come into every Claude Code session next to the bridge, and the connector's address is not on disk. If it is installed and leads to the graph server, it is a second path around the bridge → remove it in claude.ai (Settings → Connectors) or disable it in Claude Code (/mcp)`,
    skillsOtherChannel: (pi) =>
      `by the channel the set was installed with (pi — ${pi}; the order — SETUP.md, section «Update»)`,
    skillsNone: () =>
      "skills: no delivery set found (the Claude Code plugin, the Codex plugin, ~/.agents/skills, ISKRON_SKILLS_ROOT)",
    skillsUnreadable: (root) => `skills: ${root} — the set's version is unreadable`,
    skillsCurrent: (root, v) => `skills: ${root} — v${v}, not behind the bridge`,
    skillsBelowBridge: (bridge) =>
      `BEHIND the bridge v${bridge}: the method in the agent's context is older than the bridge`,
    skillsBelowRelease: (release) =>
      `BEHIND the release v${release}, level with the bridge: the whole delivery is behind (the bridge — the update subcommand)`,
    skillsBehind: (root, v, why, how) =>
      `TODO: skills: ${root} — v${v}, ${why} → update the set: ${how}; then a new session`,
    ocUnreadable: (file) => `OpenCode: ${file} is unreadable`,
    ocDisabled: (name, file) =>
      `OpenCode: the mcp entry "${name}" in ${file} leads to Iskron but is disabled — not in play`,
    ocBridge: (name, file, path) =>
      `OpenCode: the mcp entry "${name}" in ${file} calls ${path} — it looks like the delivery bridge. If it is, its tools are namespaced, and the bridge is shared by the service's sessions: the entry may go out under a neighbouring session's signature. Then remove it from this file by hand: opencode mcp has list, add, auth, logout — there is no remove command. The delivery surface is the plugin`,
    ocHttp: (name, file) =>
      `OpenCode: the mcp entry "${name}" in ${file} leads to Iskron directly over http, around the bridge — its tools are namespaced, it has no channel standing, and its writes go out without a seat. The one path to the graph is the bridge, brought by the delivery plugin. Remove it from this file by hand: opencode mcp has list, add, auth, logout — there is no remove command`,
    ocNone: (unreadable, cwd) =>
      `OpenCode: found no Iskron mcp entries${unreadable ? ` in what I read (${unreadable} file(s) could not be parsed — see the lines above)` : ""} — looked upward from ${cwd}, the global layer and variables; an entry in another tree is not checked by this, call doctor from the project directory`,
  },
};
