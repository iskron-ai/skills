// check-rituals — ревизор плагинов ритуалов OpenCode в репо (граф nks-dev,
// узлы #6686, #5048): каждый .opencode/plugins/* грузится против подставного
// ctx (cli/ritualprobe.ts); подписка на поток событий не пишет в сессию чужого
// каталога, хуки тулов не ломаются в своей. Код 1 — дыра, поломка или плагин
// не загрузился.
import { mkdtempSync, readdirSync, realpathSync } from "node:fs";
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
  for (const name of names.sort()) {
    const file = join(dir, name);
    try {
      const scope = await probeScope(file, own, foreign);
      const hole = scope.writes.theirs > 0 || scope.broken.length > 0;
      verdicts.push({ file, hole, scope });
    } catch (e) {
      verdicts.push({ file, hole: true, error: String((e as Error)?.message ?? e) });
    }
  }
  return verdicts;
}

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
    const quiet =
      s.writes.mine === 0
        ? L(" (в свою сессию не пишет)", " (writes nothing into its own session)")
        : "";
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
  if (s.writes.theirs > 0) lines.push(`  ${FIX_SCOPE()}`);
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

export async function runCheckRituals(argv: string[]): Promise<void> {
  const json = argv.includes("--json");
  const repos = argv.filter((a) => a !== "--json");
  const verdicts: Verdict[] = [];
  for (const repo of repos.length ? repos : ["."])
    verdicts.push(...(await auditRepo(resolve(repo))));
  if (json) out(JSON.stringify(verdicts));
  else if (verdicts.length === 0)
    out(L("плагинов в .opencode/plugins нет", "no plugins in .opencode/plugins"));
  else for (const v of verdicts) for (const line of words(v)) out(line);
  // Плагин мог оставить таймеры и подписки: выход — когда вывод слит.
  const code = verdicts.some((v) => v.hole) ? 1 : 0;
  process.stdout.write("", () => process.exit(code));
}
