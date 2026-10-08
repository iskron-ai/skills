// Слова check-rituals (граф @nks/nks-dev, узлы #6686, #5048): вердикт ревизора плагинов
// ритуалов OpenCode, ход починки, справка и отказ вызова.
import type { Lang } from "../lang.ts";

export interface RitualWords {
  usage: () => string;
  /** section — имя раздела хуков скилла iskronify (HOOKS_SECTION), как оно стоит в скилле. */
  fixScope: (section: string) => string;
  fixBroken: (section: string) => string;
  notChecked: (file: string, error: string | undefined) => string;
  noSubscription: () => string;
  hole: (file: string) => string;
  foreignWrites: (count: number) => string;
  lostSpelling: (mine: number, twin: number) => string;
  mute: () => string;
  broken: (hit: string) => string;
  unknownFlag: (flag: string) => string;
  noDir: (dir: string) => string;
  noPlugins: () => string;
}

const ruleRu = (section: string): string =>
  `правило — скилл iskronify, Шаг 4 «${section}», образец — его references/harness-surfaces.md`;
const ruleEn = (section: string): string =>
  `the rule is skill iskronify, Step 4 «${section}», the sample is its references/harness-surfaces.md`;

export const RITUALS: Readonly<Record<Lang, RitualWords>> = {
  ru: {
    usage: () =>
      "node iskron.mjs check-rituals [репо...] [--json] [-- репо...]   (плагины .opencode/plugins не пишут в сессии чужих каталогов и не ломаются; без репо — текущий каталог)",
    fixScope: (section) =>
      `починка: подписка на поток событий берёт каталог события (location.directory события или его data), канонизирует его и ctx.location.directory (realpath, при ошибке — строка, без завершающего разделителя) и пропускает чужой; ${ruleRu(section)}`,
    fixBroken: (section) =>
      `починка: хук тула исполняется в своей сессии как написан — имена определены, бросает только guard на пути памяти; ${ruleRu(section)}`,
    notChecked: (file, error) => `не проверен  ${file}: ${error}`,
    noSubscription: () => " (на поток событий не подписан — только хуки тулов)",
    hole: (file) => `ДЫРА  ${file}`,
    foreignWrites: (count) =>
      `  пишет в сессию чужого каталога: ${count} записей на session.created — та сессия получит адреса этого репо`,
    lostSpelling: (mine, twin) =>
      `  своя сессия под другим написанием каталога без приветствия (настоящий путь: ${mine}, написание экземпляра: ${twin}) — каталоги сравниваются сырой строкой, а одна папка приходит то /tmp/…, то /private/tmp/…`,
    mute: () =>
      "  подписан на поток событий, а своя корневая сессия приветствия не получила — каталог экземпляра берётся не из ctx.location.directory (поля ctx.directory в Context нет) или условие не пропускает свою",
    broken: (hit) => `  хук тула сломан в своей сессии (плагин исполнен как есть) — ${hit}`,
    unknownFlag: (flag) =>
      `неизвестный флаг ${flag} (каталог с таким именем — ./${flag} или после --)`,
    noDir: (dir) => `нет такого каталога: ${dir}`,
    noPlugins: () => "плагинов в .opencode/plugins нет",
  },
  en: {
    usage: () =>
      "node iskron.mjs check-rituals [repo...] [--json] [-- repo...]   (.opencode/plugins write into no session of another directory and do not break; no repo — the current directory)",
    fixScope: (section) =>
      `fix: the event-stream subscriber takes the event's directory (location.directory of the event or its data), canonicalises it and ctx.location.directory (realpath, the string on failure, no trailing separator) and skips a foreign one; ${ruleEn(section)}`,
    fixBroken: (section) =>
      `fix: a tool hook runs in its own session as written — its names defined, only the guard throws, on a memory path; ${ruleEn(section)}`,
    notChecked: (file, error) => `not checked  ${file}: ${error}`,
    noSubscription: () => " (no event-stream subscription — tool hooks only)",
    hole: (file) => `HOLE  ${file}`,
    foreignWrites: (count) =>
      `  writes into a session of another directory: ${count} writes on session.created — that session gets this repo's addresses`,
    lostSpelling: (mine, twin) =>
      `  its own session under another spelling of the folder gets no greeting (the real path: ${mine}, the instance's spelling: ${twin}) — directories are compared as raw strings, while one folder comes as /tmp/… and as /private/tmp/…`,
    mute: () =>
      "  subscribed to the event stream, yet its own root session got no greeting — the instance's directory is not taken from ctx.location.directory (Context has no ctx.directory) or the condition drops its own",
    broken: (hit) => `  a tool hook breaks in its own session (the plugin is run as is) — ${hit}`,
    unknownFlag: (flag) =>
      `unknown flag ${flag} (a directory of that name — ./${flag} or after --)`,
    noDir: (dir) => `no such directory: ${dir}`,
    noPlugins: () => "no plugins in .opencode/plugins",
  },
};
