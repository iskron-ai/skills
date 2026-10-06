// check-rituals — ревизор плагинов ритуалов OpenCode в репо (граф nks-dev,
// узлы #6686, #5048): каждый .opencode/plugins/* грузится против подставного
// ctx (cli/ritualprobe.ts); подписка на поток событий не пишет в сессию чужого
// каталога, приветствует свою корневую и не теряет её под другим написанием,
// хуки тулов не ломаются в своей. Код 1 — дыра, поломка или плагин не загрузился. Временные каталоги
// прогона убираются за собой.
import { mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { L } from "../shared/lang.ts";
import { probeScope, type Scope } from "./ritualprobe.ts";

const out = (s: string): void => {
  process.stdout.write(s + "\n");
};

export interface Verdict {
  file: string;
  hole: boolean;
  scope?: Scope;
  error?: string;
}

export async function auditRepo(repo: string): Promise<Verdict[]> {
  const own = realpathSync(repo);
  const dir = join(own, ".opencode", "plugins");
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => /\.(m?js|ts)$/.test(n));
  } catch {
    return [];
  }
  const foreign = realpathSync(mkdtempSync(join(tmpdir(), "ritual-scope-foreign-")));
  const verdicts: Verdict[] = [];
  try {
    for (const name of names.sort()) {
      const file = join(dir, name);
      try {
        const scope = await probeScope(file, own, foreign);
        const hole =
          scope.writes.theirs > 0 || lostSpelling(scope) || mute(scope) || scope.broken.length > 0;
        verdicts.push({ file, hole, scope });
      } catch (e) {
        verdicts.push({ file, hole: true, error: String((e as Error)?.message ?? e) });
      }
    }
  } finally {
    rmSync(foreign, { recursive: true, force: true });
  }
  return verdicts;
}

/** Своя сессия приветствована под одним написанием каталога и потеряна под другим. */
const lostSpelling = (s: Scope): boolean => s.writes.mine > 0 !== s.writes.twin > 0;

/** Подписан на поток событий, а своей корневой сессии не приветствует ни под каким написанием. */
const mute = (s: Scope): boolean => s.subscribed && s.writes.mine + s.writes.twin === 0;

const RULE = (): string =>
  L(
    "правило — скилл iskronify, Шаг 4 «Хуки», образец — его references/harness-surfaces.md",
    "the rule is skill iskronify, Step 4 «Хуки», the sample is its references/harness-surfaces.md",
  );
const FIX_SCOPE = (): string =>
  L(
    `починка: подписка на поток событий берёт каталог события (location.directory события или его data), канонизирует его и ctx.location.directory (realpath, при ошибке — строка, без завершающего разделителя) и пропускает чужой; ${RULE()}`,
    `fix: the event-stream subscriber takes the event's directory (location.directory of the event or its data), canonicalises it and ctx.location.directory (realpath, the string on failure, no trailing separator) and skips a foreign one; ${RULE()}`,
  );
const FIX_BROKEN = (): string =>
  L(
    `починка: хук тула исполняется в своей сессии как написан — имена определены, бросает только guard на пути памяти; ${RULE()}`,
    `fix: a tool hook runs in its own session as written — its names defined, only the guard throws, on a memory path; ${RULE()}`,
  );

function words(v: Verdict): string[] {
  const s = v.scope;
  if (v.error || !s)
    return [L(`не проверен  ${v.file}: ${v.error}`, `not checked  ${v.file}: ${v.error}`)];
  if (!v.hole) {
    const quiet = s.subscribed
      ? ""
      : L(
          " (на поток событий не подписан — только хуки тулов)",
          " (no event-stream subscription — tool hooks only)",
        );
    return [`ok  ${v.file}${quiet}`];
  }
  const lines = [L(`ДЫРА  ${v.file}`, `HOLE  ${v.file}`)];
  if (s.writes.theirs > 0)
    lines.push(
      L(
        `  пишет в сессию чужого каталога: ${s.writes.theirs} записей на session.created — та сессия получит адреса этого репо`,
        `  writes into a session of another directory: ${s.writes.theirs} writes on session.created — that session gets this repo's addresses`,
      ),
    );
  if (lostSpelling(s))
    lines.push(
      L(
        `  своя сессия под другим написанием каталога без приветствия (настоящий путь: ${s.writes.mine}, написание экземпляра: ${s.writes.twin}) — каталоги сравниваются сырой строкой, а одна папка приходит то /tmp/…, то /private/tmp/…`,
        `  its own session under another spelling of the folder gets no greeting (the real path: ${s.writes.mine}, the instance's spelling: ${s.writes.twin}) — directories are compared as raw strings, while one folder comes as /tmp/… and as /private/tmp/…`,
      ),
    );
  if (mute(s))
    lines.push(
      L(
        "  подписан на поток событий, а своя корневая сессия приветствия не получила — каталог экземпляра берётся не из ctx.location.directory (поля ctx.directory в Context нет) или условие не пропускает свою",
        "  subscribed to the event stream, yet its own root session got no greeting — the instance's directory is not taken from ctx.location.directory (Context has no ctx.directory) or the condition drops its own",
      ),
    );
  if (s.writes.theirs > 0 || lostSpelling(s) || mute(s)) lines.push(`  ${FIX_SCOPE()}`);
  for (const h of s.broken)
    lines.push(
      L(
        `  хук тула сломан в своей сессии (плагин исполнен как есть) — ${h}`,
        `  a tool hook breaks in its own session (the plugin is run as is) — ${h}`,
      ),
    );
  if (s.broken.length) lines.push(`  ${FIX_BROKEN()}`);
  return lines;
}

export const RITUALS_USAGE = (): string =>
  `node iskron.mjs check-rituals [${L("репо", "repo")}...] [--json] [-- ${L("репо", "repo")}...]   ${L("(плагины .opencode/plugins не пишут в сессии чужих каталогов и не ломаются; без репо — текущий каталог)", "(.opencode/plugins write into no session of another directory and do not break; no repo — the current directory)")}`;

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Слово ошибки вызова и код 2 — без стектрейса. */
const refuse = (word: string): void => {
  process.stderr.write(`check-rituals: ${word}\n${RITUALS_USAGE()}\n`);
  process.exitCode = 2;
};

export async function runCheckRituals(argv: string[]): Promise<void> {
  // После `--` флагов нет: всё — каталоги, и те, чьё имя начинается с «-».
  const end = argv.indexOf("--");
  const head = end < 0 ? argv : argv.slice(0, end);
  const tail = end < 0 ? [] : argv.slice(end + 1);
  if (head.includes("--help") || head.includes("-h")) return out(RITUALS_USAGE());
  const flag = head.find((a) => a.startsWith("-") && a !== "--json");
  if (flag)
    return refuse(
      L(
        `неизвестный флаг ${flag} (каталог с таким именем — ./${flag} или после --)`,
        `unknown flag ${flag} (a directory of that name — ./${flag} or after --)`,
      ),
    );
  const json = head.includes("--json");
  const repos = [...head.filter((a) => a !== "--json"), ...tail].map((a) => resolve(a));
  const missing = repos.find((r) => !isDir(r));
  if (missing) return refuse(L(`нет такого каталога: ${missing}`, `no such directory: ${missing}`));
  const verdicts: Verdict[] = [];
  for (const repo of repos.length ? repos : [resolve(".")])
    verdicts.push(...(await auditRepo(repo)));
  if (json) out(JSON.stringify(verdicts));
  else if (verdicts.length === 0)
    out(L("плагинов в .opencode/plugins нет", "no plugins in .opencode/plugins"));
  else for (const v of verdicts) for (const line of words(v)) out(line);
  // Плагин мог оставить таймеры и подписки: выход — когда вывод слит.
  const code = verdicts.some((v) => v.hole) ? 1 : 0;
  process.stdout.write("", () => process.exit(code));
}
