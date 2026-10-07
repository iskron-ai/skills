// Отставание набора скиллов от моста (граф nks-dev: #4509, ключи — #6226):
// версия набора — версия файла моста внутри него (как attrs.skills.version), и
// она расходится с build.version ровно тогда, когда мост обновился, а набор нет.
// Скиллы мост не обновляет — их кладёт канал харнесса, его ход и называется.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { CFG } from "../bridge/config.ts";
import { skillsRoot } from "../bridge/skillset.ts";
import { readLatest, skillMoves } from "../bridge/update.ts";
import { BRIDGE_FILE, BRIDGE_SKILL } from "../shared/clients.ts";
import { L } from "../shared/lang.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION, versionIn } from "../shared/version.ts";
import { todo } from "./subwords.ts";

type Out = (s: string) => void;
type Kind = "claude" | "codex" | "flat" | "other";

const IN_SET = join(BRIDGE_SKILL, "scripts", BRIDGE_FILE);

function sets(codexHomes: string[]): [string, Kind][] {
  const found: [string, Kind][] = [];
  try {
    const reg = JSON.parse(
      readFileSync(join(homedir(), ".claude", "plugins", "installed_plugins.json"), "utf8"),
    ) as { plugins?: Record<string, { installPath?: string }[]> };
    for (const [key, installs] of Object.entries(reg.plugins ?? {}))
      if (/^iskron@/.test(key))
        for (const i of installs)
          if (i.installPath) found.push([join(i.installPath, "skills"), "claude"]);
  } catch {}
  for (const home of codexHomes) {
    const cache = join(home, "plugins", "cache");
    let markets: string[] = [];
    try {
      markets = readdirSync(cache);
    } catch {}
    for (const m of markets) {
      let plugins: string[] = [];
      try {
        plugins = readdirSync(join(cache, m)).filter((p) => /iskron/.test(p));
      } catch {}
      for (const p of plugins) found.push([join(cache, m, p, "skills"), "codex"]);
    }
  }
  found.push([join(homedir(), ".agents", "skills"), "flat"]);
  const own = skillsRoot();
  if (own) found.push([own, "other"]);
  const seen = new Set<string>();
  return found.filter(([root]) => {
    const key = resolve(root);
    if (seen.has(key) || !existsSync(join(root, IN_SET))) return false;
    seen.add(key);
    return true;
  });
}

// Ходы — те же, что у строки отставания моста (update.ts); набор вне трёх каналов
// (pi, ручная копия) — каналом, которым его ставили.
const how = (kind: Kind): string => {
  const m = skillMoves();
  if (kind === "claude") return `Claude Code — ${m.claude}`;
  if (kind === "codex") return `Codex — ${m.codex}`;
  if (kind === "flat") return m.flat;
  return L(
    `тем каналом, которым набор ставили (pi — ${m.pi}; порядок — SETUP.md, раздел «Обновление»)`,
    `by the channel the set was installed with (pi — ${m.pi}; the order — SETUP.md, section «Update»)`,
  );
};

/** Каждый набор поставки на машине против сборки моста и известного релиза. */
export function skillsReport(out: Out, codexHomes: string[]): void {
  const latest = readLatest(CFG.authDir)?.version ?? null;
  const target = latest && compareVersions(latest, VERSION) > 0 ? latest : VERSION;
  const found = sets(codexHomes);
  if (!found.length)
    out(
      L(
        "скиллы: набора поставки не нашёл (плагин Claude Code, плагин Codex, ~/.agents/skills, ISKRON_SKILLS_ROOT)",
        "skills: no delivery set found (the Claude Code plugin, the Codex plugin, ~/.agents/skills, ISKRON_SKILLS_ROOT)",
      ),
    );
  for (const [root, kind] of found) {
    let v: string | null = null;
    try {
      v = versionIn(readFileSync(join(root, IN_SET), "utf8"));
    } catch {}
    if (!v)
      out(
        L(
          `скиллы: ${root} — версия набора не читается`,
          `skills: ${root} — the set's version is unreadable`,
        ),
      );
    else if (compareVersions(v, target) >= 0)
      out(
        L(
          `скиллы: ${root} — v${v}, не ниже моста`,
          `skills: ${root} — v${v}, not behind the bridge`,
        ),
      );
    else {
      // Ниже моста — метод старше моста; вровень с мостом, но ниже релиза — отстали оба.
      const below = compareVersions(v, VERSION) < 0;
      const why = below
        ? L(
            `НИЖЕ моста v${VERSION}: метод в контексте агента старше моста`,
            `BEHIND the bridge v${VERSION}: the method in the agent's context is older than the bridge`,
          )
        : L(
            `НИЖЕ релиза v${target}, вровень с мостом: отстала поставка целиком (мост — подкоманда update)`,
            `BEHIND the release v${target}, level with the bridge: the whole delivery is behind (the bridge — the update subcommand)`,
          );
      out(
        L(
          `${todo()} скиллы: ${root} — v${v}, ${why} → обнови набор: ${how(kind)}; затем новая сессия`,
          `${todo()} skills: ${root} — v${v}, ${why} → update the set: ${how(kind)}; then a new session`,
        ),
      );
    }
  }
}
