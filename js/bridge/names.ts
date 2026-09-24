// Имя стояния — адрес места (граф nks-dev: #5068). Явное имя либо принимается
// ровно таким, либо отвергается вслух с названной причиной: молча укороченное
// имя адресует ДРУГОЕ место. Выведенное имя — машина.репо.модель — из того,
// что свежая сессия восстановит без памяти; длиннее предела сервера оно
// укорачивается с пометкой сразу после шапки ответа.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, resolve } from "node:path";

/** Правило имени стояния у сервера (наблюдено отказом 400). */
export const NAME_MAX = 48;

/**
 * Роль как печатает доска — голые цифры либо сентинел (agent, me, realm-owner);
 * имя — без полей. Одна нормализация на запись привязки (register, connect) и
 * на сравнение (iskron_stand, правило «стояние одно на мост»): записанное
 * сырым расходилось с нормализованным, и мост не узнавал свой же сокет (#5154).
 */
export const normKarta = (k: unknown): string =>
  String(k ?? "")
    .trim()
    .replace(/^#/, "");
export const normName = (n: unknown): string => (typeof n === "string" ? n.trim() : "");
const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

/** Одна часть выведенного имени — к правилу: строчные, допустимые знаки, без краевых точек и дефисов. */
export const sanitize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, NAME_MAX);

/** Чем явное имя нарушает правило — словами, или null, если ничем. */
export function nameFault(name: string): string | null {
  if (name.length > NAME_MAX) return `длиннее предела: ${name.length} знаков`;
  if (!NAME_RE.test(name))
    return /[A-Z]/.test(name)
      ? "заглавные буквы не допускаются"
      : "недопустимые знаки или первый знак не буква и не цифра";
  return null;
}

/** Части выведенного имени по местам: машина, репо, модель (модель может нести точки — `glm-5.3`, — потому имя не режется по точкам). */
export interface NameParts {
  host: string;
  repo: string;
  model: string;
}
const PART_MIN = 3;
const CUT_ORDER: (keyof NameParts)[] = ["repo", "host", "model"];

/**
 * Выведенное имя длиннее предела — срезать репо-часть, затем машину, модель
 * последней и только когда иначе не уложиться: модель различает сессии одной
 * машины. Возвращает имя и какие части срезаны — для пометки в ответе.
 */
export function fitName(parts: NameParts): { name: string; cut: (keyof NameParts)[] } {
  const p = { ...parts };
  const join = (): string =>
    [p.host, p.repo, p.model]
      .filter(Boolean)
      .join(".")
      .replace(/[-.]+$/, "");
  const cut: (keyof NameParts)[] = [];
  for (const k of CUT_ORDER) {
    const over = join().length - NAME_MAX;
    if (over <= 0) break;
    const keep = Math.max(k === "model" ? 1 : PART_MIN, p[k].length - over);
    if (keep >= p[k].length) continue;
    p[k] = p[k].slice(0, keep).replace(/[-.]+$/, "");
    cut.push(k);
  }
  return {
    name: join()
      .slice(0, NAME_MAX)
      .replace(/[-.]+$/, ""),
    cut,
  };
}

export const git = (args: string[], cwd: string = process.cwd()): string => {
  try {
    return execFileSync("git", args, {
      cwd,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
};

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

/**
 * Имя репо для каталога сессии. Обычная копия — basename toplevel, как всегда.
 * В связанном ворктри toplevel — каталог задачи, поэтому репо берётся от
 * основной копии: общий git-каталог `…/repo/.git` → `repo`; иной расклад
 * (голый репо) — имя origin без `.git`, затем toplevel, затем сам каталог
 * (r5 #5108, второй случай).
 */
export function repoName(cwd: string = process.cwd()): string {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  const [gitDir, common] = git(["rev-parse", "--git-dir", "--git-common-dir"], cwd).split("\n");
  if (!gitDir || !common || real(resolve(cwd, gitDir)) === real(resolve(cwd, common)))
    return basename(top || cwd);
  const shared = real(resolve(cwd, common));
  if (basename(shared) === ".git") return basename(dirname(shared));
  const origin = git(["remote", "get-url", "origin"], cwd).replace(/\/+$/, "");
  const fromOrigin = basename(origin.replace(/^.*:/, "/")).replace(/\.git$/, "");
  return fromOrigin || basename(top || cwd);
}

/**
 * машина.репо.модель — из того, что свежая сессия восстановит без памяти. Третья
 * часть — модель, которой бежит агент (её знает только он, потому она идёт
 * параметром): в момент запуска ветка почти всегда main и не различает
 * ничего, а модель различает сессии одной машины над одним репозиторием.
 * Префикс поставщика (`claude-`) отбрасывается: `claude-opus-5` → `opus-5`.
 * Репо — по директории сессии харнесса (cwd), когда мост запущен не из неё:
 * плагин OpenCode поднимает мост из cwd сервера, и без этого репо выводилось
 * бы из чужого каталога (r5 #5108).
 */
export function deriveParts(model?: string, cwd: string = process.cwd()): NameParts {
  const host = hostname().split(".")[0];
  const repo = repoName(cwd);
  const short = (model ?? "")
    .trim()
    .toLowerCase()
    .replace(/^claude[-_]/, "");
  return { host: sanitize(host ?? ""), repo: sanitize(repo), model: sanitize(short) };
}

export const joinName = (p: NameParts): string =>
  [p.host, p.repo, p.model].filter(Boolean).join(".");
