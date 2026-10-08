// Набор скиллов, УСТАНОВЛЕННЫЙ у держателя в миг занятия места, — attrs.skills
// (граф nks-dev: #6226, форма — #6211): не тексты, загруженные в контекст сессии.
// version — версия файла моста внутри набора, не работающего моста: build и
// skills расходятся ровно тогда, когда мост обновился, а набор нет. stamp —
// 8 hex, различает наборы внутри версии.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BRIDGE_FILE, BRIDGE_SKILL, SKILL_SET } from "../delivery/index.ts";
import { SKILLS_ROOT_ENV } from "../shared/clients.ts";
import { currentScope, envOf } from "../shared/scope.ts";
import { skillLock } from "../shared/skilllock.ts";
import { versionIn } from "../shared/version.ts";

/** Корень набора окружением: домашняя копия лежит вне набора и узнаёт его только так. */
export { SKILLS_ROOT_ENV };
const SET = SKILL_SET;
const BRIDGE_IN_SET = join(BRIDGE_SKILL, "scripts", BRIDGE_FILE);

// Окружение и файл — моста харнеса (shared/scope.ts): у сессии демона машины
// набор узнаётся по тонкому мосту, которым запустил харнес, а не по демону.
const env = (k: string): string => envOf(k)?.trim() ?? "";

/**
 * Каталог, в котором лежат скиллы набора (`<корень>/<скилл>/SKILL.md`), или null.
 * Порядок: окружение; раскладка собственного файла (…/establish-mcp/scripts/);
 * корень плагина Claude Code; плоская установка ~/.agents/skills.
 */
export function skillsRoot(
  self = currentScope().origin?.path || fileURLToPath(import.meta.url),
): string | null {
  const plugin = env("CLAUDE_PLUGIN_ROOT");
  const candidates = [
    env(SKILLS_ROOT_ENV),
    resolve(dirname(self), "..", ".."),
    plugin ? join(plugin, "skills") : "",
    join(homedir(), ".agents", "skills"),
  ];
  for (const c of candidates) if (c && existsSync(join(c, BRIDGE_IN_SET))) return resolve(c);
  return null;
}

const sha8 = (h: ReturnType<typeof createHash>): string => h.digest("hex").slice(0, 8);

/**
 * Плоская установка: источник набора — source записи establish-mcp в
 * локе там, где его кладёт npx skills (shared/skilllock.ts; она несёт мост; граф nks-dev: #6226), без
 * неё — SET; stamp — свёртка skillFolderHash записей этого источника.
 */
function lockSet(root: string): { name: string; stamp: string | null } {
  const skills = skillLock(root, env("XDG_STATE_HOME"));
  if (!skills) return { name: SET, stamp: null };
  const own = skills[BRIDGE_SKILL]?.source;
  const name = typeof own === "string" && own.trim() ? own.trim() : SET;
  const lines = Object.entries(skills)
    .filter(([, s]) => s?.source === name && typeof s.skillFolderHash === "string")
    .map(([n, s]) => `${n}:${String(s?.skillFolderHash)}\n`)
    .sort();
  return { name, stamp: lines.length ? sha8(createHash("sha256").update(lines.join(""))) : null };
}

/** Плагин и всякий другой корень: хеш SKILL.md каждого скилла корня, по порядку имён. */
function treeStamp(root: string): string | null {
  const h = createHash("sha256");
  let n = 0;
  let names: string[];
  try {
    names = readdirSync(root).sort();
  } catch {
    return null;
  }
  for (const name of names) {
    let body: Buffer;
    try {
      body = readFileSync(join(root, name, "SKILL.md"));
    } catch {
      continue;
    }
    h.update(`${name}\0`);
    h.update(body);
    h.update("\0");
    n++;
  }
  return n ? sha8(h) : null;
}

/** attrs.skills — читается заново при каждом занятии: обновлённый набор виден следующим. */
export function skillsAttr(): { name: string; version: string; stamp?: string } {
  const root = skillsRoot();
  if (!root) return { name: SET, version: "unknown" };
  let version = "unknown";
  try {
    version = versionIn(readFileSync(join(root, BRIDGE_IN_SET), "utf8")) ?? "unknown";
  } catch {
    /* файл моста исчез между поиском и чтением — версия неизвестна */
  }
  const lock = lockSet(root);
  const stamp = lock.stamp ?? treeStamp(root);
  return { name: lock.name, version, ...(stamp ? { stamp } : {}) };
}
