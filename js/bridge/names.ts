// Имя стояния — адрес места (граф nks-dev: #5068). Явное имя либо принимается
// ровно таким, либо отвергается вслух с названной причиной: молча укороченное
// имя адресует ДРУГОЕ место. Выведенное имя — машина.репо.модель — из того,
// что свежая сессия восстановит без памяти; длиннее предела сервера оно
// укорачивается с пометкой в ответе.
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { basename } from "node:path";

/** Правило имени стояния у сервера (наблюдено отказом 400). */
export const NAME_MAX = 48;
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

/** Выведенное имя длиннее предела — срезать репо-часть (средняя), затем машину; модель различает сессии и остаётся. */
export function fitName(derived: string): string {
  if (derived.length <= NAME_MAX) return derived;
  const parts = derived.split(".");
  for (const i of parts.length === 3 ? [1, 0] : [0]) {
    const over = parts.join(".").length - NAME_MAX;
    if (over <= 0) break;
    parts[i] = (parts[i] ?? "").slice(0, Math.max(3, (parts[i]?.length ?? 0) - over));
  }
  return parts
    .join(".")
    .slice(0, NAME_MAX)
    .replace(/[-.]+$/, "");
}

export const git = (args: string[]): string => {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
};

/**
 * машина.репо.модель — из того, что свежая сессия восстановит без памяти. Третья
 * часть — модель, которой бежит агент (её знает только он, потому она идёт
 * параметром): в момент запуска ветка почти всегда main и не различает
 * ничего, а модель различает сессии одной машины над одним репозиторием.
 * Префикс поставщика (`claude-`) отбрасывается: `claude-opus-5` → `opus-5`.
 */
export function deriveName(model?: string): string {
  const host = hostname().split(".")[0];
  const top = git(["rev-parse", "--show-toplevel"]);
  const repo = basename(top || process.cwd());
  const short = (model ?? "")
    .trim()
    .toLowerCase()
    .replace(/^claude[-_]/, "");
  return [host, repo, short].map(sanitize).filter(Boolean).join(".");
}
