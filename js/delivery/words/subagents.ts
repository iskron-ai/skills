// Слова раздела «субагенты» doctor (граф @nks/nks-dev, узел #6080): файлы агентов,
// форма записи моста-спутника, мосты позвавшего, доверие к папке; метка строки-действия.
import type { SatForm } from "../../cli/satform.ts";
import type { Lang } from "../lang.ts";

export interface SubagentWords {
  /** Метка строки, которую надо исполнить: doctor гоняют, пока в разделе остаётся хоть одна. */
  todo: () => string;
  /** Что не так с формой записи — и почему её заменяет единая. */
  form: (form: Exclude<SatForm, "eval">) => string;
  osJudged: (platform: string) => string;
  header: (root: string, os: string) => string;
  noFiles: (dirs: string) => string;
  shadowed: (path: string, agent: string) => string;
  /** ready — готовый блок записи. */
  withBlock: (ready: string) => string;
  proposed: (name: string) => string;
  refEntry: (name: string, block: string) => string;
  formEntry: (name: string, form: string, block: string) => string;
  noEntry: (block: string) => string;
  sharedName: (agent: string) => string;
  replaceEntry: (name: string, form: string, block: string) => string;
  noCommand: (name: string, command: string) => string;
  noBridge: (bridge: string, home: string) => string;
  /** need — неснятые мосты через запятую; пусто — disallowedTools нет. */
  callerBridges: (need: string, fix: string) => string;
  ownRemoved: (own: string) => string;
  /** files — файлы через запятую. */
  nameShared: (name: string, count: number, files: string, agent: string) => string;
  noGrantAgain: () => string;
  noGrant: (advice: string) => string;
  sameFailed: (label: string) => string;
  sameProbe: (label: string) => string;
  userScope: () => string;
  named: (first: string, ...rest: string[]) => string;
  unnamed: () => string;
  fine: () => string;
  /** keys — ключи через запятую. */
  ocKeys: (keys: string) => string;
  ocAgent: (path: string, keyNote: string) => string;
  trustNear: (near: string, here: string) => string;
  trustNone: (here: string) => string;
}

export const SUBAGENT: Readonly<Record<Lang, SubagentWords>> = {
  ru: {
    todo: () => "НАДО:",
    form: (form) => {
      switch (form) {
        case "eval-no-sep":
          return "--satellite стоит без `--` после кода `node -e` — node примет его за свой флаг («bad option») и не запустится";
        case "eval-session":
          return "мост не увидит --satellite в своём argv (нет `--` перед ним или путь моста не положен в argv[1]) и встанет мостом сессии, не спутником";
        case "eval-other":
          return "код `node -e` не совпадает с эталонной формой записи — рабочей признаётся только она, сверенная живьём";
        case "shell":
          return "форма прежнего контракта (sh -c): на Windows sh нет, а переменных в args фронтматтера Claude Code не раскрывает";
        case "path":
          return "путь к мосту записан прямо в args — машинный путь в общем файле, на другой машине его нет";
        case "session":
          return "запись зовёт мост без --satellite — субагент встал бы мостом сессии, а не спутником";
      }
    },
    osJudged: (platform) => `ОС под суд: ${platform}`,
    header: (root, os) => `субагенты: проект ${root} (${os})`,
    noFiles: (dirs) =>
      `  файлов агентов нет (${dirs}) — позови doctor из каталога проекта, если субагенты там`,
    shadowed: (path, agent) =>
      `  ${path}: затенён файлом проекта с тем же именем «${agent}» — Claude Code берёт проектный`,
    withBlock: (ready) => `блоком ниже вместо прежних mcpServers и disallowedTools:\n${ready}`,
    proposed: (name) => `${name} (предложенная форма)`,
    refEntry: (name, block) =>
      `запись «${name}» — ссылка на сервер из конфига сессии, не свой мост на прогон → замени встроенной записью, ${block}`,
    formEntry: (name, form, block) => `запись «${name}»: ${form} → ${block}`,
    noEntry: (block) =>
      `записи моста-спутника нет — у субагента нет тулов графа → вставь во фронтматтер ${block}`,
    sharedName: (agent) =>
      `запись названа «iskron-sub» — общим именем прежнего контракта: второй файл с ним поведёт свои прогоны тем же процессом моста → переименуй запись в iskron-sub-${agent}`,
    replaceEntry: (name, form, block) => `запись «${name}»: ${form} → замени ${block}`,
    noCommand: (name, command) =>
      `команда записи «${name}» «${command}» на этой машине не находится (PATH) → поставь Node 22+ либо добавь каталог node в PATH: Claude Code запускает его по PATH`,
    noBridge: (bridge, home) =>
      `моста по пути записи нет: ${bridge} → поставь его (скилл establish-mcp кладёт домашнюю копию ${home}), затем повтори doctor`,
    callerBridges: (need, fix) =>
      `мосты позвавшего не сняты (${need || "disallowedTools нет"}) — субагент унаследует их тулы, и его записи уйдут местом позвавшего → замени строку: disallowedTools: ${fix}`,
    ownRemoved: (own) =>
      `disallowedTools снимает свой же мост ${own} → убери ${own} из disallowedTools`,
    nameShared: (name, count, files, agent) =>
      `имя записи «${name}» делят ${count} файла(ов): ${files} — Claude Code держит одно соединение на имя записи, их прогоны пойдут одним процессом моста, и первый закончивший погасит место другим → переименуй запись в этом файле: iskron-sub-${agent}`,
    noGrantAgain: () =>
      "проба спутника не шла — входа в граф на этой машине нет (действие — строкой выше)",
    noGrant: (advice) => `проба спутника не шла — входа в граф на этой машине нет → ${advice}`,
    sameFailed: (label) => `проба той же команды, что у «${label}», не прошла — действие выше`,
    sameProbe: (label) => `проба: та же команда, что у «${label}» выше`,
    userScope: () => " (пользовательский)",
    named: (...names) => `запись «${names.join("», «")}»`,
    unnamed: () => "без записи моста-спутника",
    fine: () => " — в порядке",
    ocKeys: (keys) => `; НАДО: ключ ${keys} OpenCode в файле агента не читает → убери его`,
    ocAgent: (path, keyNote) =>
      `  ${path}: OpenCode — мост-спутник даёт дочерней сессии плагин поставки (строка OpenCode выше), записи в файле не нужно${keyNote}`,
    trustNear: (near, here) =>
      `доверие к папке принято для «${near}», а проект открыт как «${here}» — Claude Code сравнивает путь буква в букву (C:/ и c:/ — разные папки), и в недоверенной папке сервер из фронтматтера не поднимается без диалога → запусти claude в терминале из этой папки и прими диалог доверия либо открой папку тем же написанием пути`,
    trustNone: (here) =>
      `доверие к папке «${here}» и её родителям в ~/.claude.json не отмечено — в недоверенной папке сервер из фронтматтера не поднимается, и диалога об этом нет → запусти claude в этой папке и прими диалог доверия`,
  },
  en: {
    todo: () => "TODO:",
    form: (form) => {
      switch (form) {
        case "eval-no-sep":
          return '--satellite stands without `--` after the `node -e` code — node takes it for its own flag ("bad option") and will not start';
        case "eval-session":
          return "the bridge will not see --satellite in its argv (no `--` before it, or the bridge path is not put into argv[1]) and will stand as a session bridge, not a satellite";
        case "eval-other":
          return "the `node -e` code does not match the reference form — only that form, verified live, is accepted as working";
        case "shell":
          return "the form of the former contract (sh -c): Windows has no sh, and Claude Code does not expand variables in frontmatter args";
        case "path":
          return "the bridge path is written straight into args — a machine path in a shared file, absent on another machine";
        case "session":
          return "the entry calls the bridge without --satellite — the subagent would stand as a session bridge, not a satellite";
      }
    },
    osJudged: (platform) => `OS under judgment: ${platform}`,
    header: (root, os) => `subagents: project ${root} (${os})`,
    noFiles: (dirs) =>
      `  no agent files (${dirs}) — call doctor from the project directory if the subagents are there`,
    shadowed: (path, agent) =>
      `  ${path}: shadowed by the project file with the same name "${agent}" — Claude Code takes the project one`,
    withBlock: (ready) =>
      `with the block below instead of the former mcpServers and disallowedTools:\n${ready}`,
    proposed: (name) => `${name} (proposed form)`,
    refEntry: (name, block) =>
      `entry "${name}" is a reference to a server from the session config, not its own bridge per run → replace it with an inline entry, ${block}`,
    formEntry: (name, form, block) => `entry "${name}": ${form} → ${block}`,
    noEntry: (block) =>
      `no satellite bridge entry — the subagent has no graph tools → insert into the frontmatter ${block}`,
    sharedName: (agent) =>
      `the entry is named "iskron-sub" — the shared name of the former contract: a second file with it would run its runs through the same bridge process → rename the entry to iskron-sub-${agent}`,
    replaceEntry: (name, form, block) => `entry "${name}": ${form} → replace ${block}`,
    noCommand: (name, command) =>
      `the command of entry "${name}" "${command}" is not found on this machine (PATH) → install Node 22+ or add the node directory to PATH: Claude Code launches it via PATH`,
    noBridge: (bridge, home) =>
      `no bridge at the entry path: ${bridge} → install it (the establish-mcp skill places a home copy at ${home}), then repeat doctor`,
    callerBridges: (need, fix) =>
      `the caller's bridges are not removed (${need || "no disallowedTools"}) — the subagent would inherit their tools, and its writes would go out under the caller's seat → replace the line: disallowedTools: ${fix}`,
    ownRemoved: (own) =>
      `disallowedTools removes the entry's own bridge ${own} → remove ${own} from disallowedTools`,
    nameShared: (name, count, files, agent) =>
      `the entry name "${name}" is shared by ${count} file(s): ${files} — Claude Code keeps one connection per entry name, their runs would go through one bridge process, and the first to finish would put out the seat for the others → rename the entry in this file: iskron-sub-${agent}`,
    noGrantAgain: () =>
      "the satellite probe did not run — there is no graph login on this machine (the action is in the line above)",
    noGrant: (advice) =>
      `the satellite probe did not run — there is no graph login on this machine → ${advice}`,
    sameFailed: (label) =>
      `the probe of the same command as "${label}" failed — the action is above`,
    sameProbe: (label) => `probe: the same command as "${label}" above`,
    userScope: () => " (user)",
    named: (...names) => `entry "${names.join('", "')}"`,
    unnamed: () => "no satellite bridge entry",
    fine: () => " — fine",
    ocKeys: (keys) =>
      `; TODO: the key ${keys} is not read by OpenCode in an agent file → remove it`,
    ocAgent: (path, keyNote) =>
      `  ${path}: OpenCode — the delivery plugin gives the child session a satellite bridge (the OpenCode line above), no entry is needed in the file${keyNote}`,
    trustNear: (near, here) =>
      `folder trust was accepted for "${near}", but the project is opened as "${here}" — Claude Code compares the path letter for letter (C:/ and c:/ are different folders), and in an untrusted folder the frontmatter server does not start without a dialog → run claude in a terminal from this folder and accept the trust dialog, or open the folder with the same spelling of the path`,
    trustNone: (here) =>
      `trust for the folder "${here}" and its parents is not marked in ~/.claude.json — in an untrusted folder the frontmatter server does not start, and there is no dialog about it → run claude in this folder and accept the trust dialog`,
  },
};
