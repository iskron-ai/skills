// Форма записи моста-спутника в файле агента — одна на все ОС: `node -e` сам
// собирает путь к домашнему мосту из os.homedir(), без оболочки и без
// машинного пути в файле (Claude Code не раскрывает переменные в args
// фронтматтера, а sh на Windows нет). `--` отделяет флаги моста от флагов
// node, а splice кладёт путь моста в argv[1] — иначе мост не увидит
// `--satellite` в process.argv.slice(2) и встанет мостом сессии. Проверена
// живьём на macOS (Claude Code 2.1.285); на Windows не сверена (REALITY.md).
// SATELLITE_CODE — эталон: копии в ролевых файлах и delegation.md сверяет
// с ним `make validate`. Норма — skills/iskronify/references/delegation.md.
import { homedir } from "node:os";
import { basename } from "node:path";

import { homeBridgePath } from "../shared/home.ts";

/** Код `node -e` единой формы: путь к дому из homedir, путь в argv[1], импорт моста. */
export const SATELLITE_CODE =
  "const p=require('path').join(require('os').homedir(),'.iskron-bridge','iskron-bridge.mjs');process.argv.splice(1,0,p);import(require('url').pathToFileURL(p).href)";

export const SATELLITE_ARGS = ["-e", SATELLITE_CODE, "--", "--satellite"];

export interface SatEntry {
  command: string;
  args: string[];
}

/**
 * Род формы записи: `eval` — рабочая `node -e`; остальные — поломка или форма,
 * которую единая заменяет.
 *  - eval-no-sep: `--satellite` без `--` — node примет его за свой флаг и не запустится;
 *  - eval-session: мост не увидит `--satellite` в своём argv и встанет мостом сессии;
 *  - eval-other: `node -e` с кодом не эталона — живьём не сверен;
 *  - shell: `sh -c` прежнего контракта — на Windows sh нет;
 *  - path: путь к мосту прямо в args — машинный путь в общем файле;
 *  - session: `--satellite` нет вовсе — мост сессии, не спутник.
 */
export type SatForm =
  "eval" | "eval-no-sep" | "eval-session" | "eval-other" | "shell" | "path" | "session";

const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const cmdBase = (c: string): string =>
  basename(c.replace(/\\/g, "/"))
    .replace(/\.exe$/i, "")
    .toLowerCase();

const isToolList = (v: string | undefined): v is string => !!v && /^[A-Za-z0-9_,]+$/.test(v);

/**
 * Хвост флагов моста, который запись несёт после `--satellite` и который готовый
 * блок переносит: набор тулов `--tools a,b,c`. Любая форма — массивом или строкой sh -c.
 */
export function toolsTail(e: SatEntry): string[] {
  const words = SHELLS.has(cmdBase(e.command))
    ? (e.args[e.args.indexOf("-c") + 1] ?? "")
        .split(/\s+/)
        .map((w) => w.replace(/^["']|["']$/g, ""))
    : e.args;
  const at = words.indexOf("--tools");
  const v = at >= 0 ? words[at + 1] : undefined;
  return isToolList(v) ? ["--tools", v] : [];
}

export function formOf(e: SatEntry): SatForm {
  const base = cmdBase(e.command);
  if (base === "node" && (e.args[0] === "-e" || e.args[0] === "--eval")) {
    const sep = e.args.indexOf("--", 2);
    if (sep < 0) return e.args.slice(2).includes("--satellite") ? "eval-no-sep" : "session";
    const after = e.args.slice(sep + 1);
    const spliced = /process\.argv\.splice\(\s*1\s*,\s*0\s*,/.test(e.args[1] ?? "");
    // Без splice process.argv = [node, ...after], и slice(2) теряет первый флаг моста.
    if (!(spliced ? after : after.slice(1)).includes("--satellite")) return "eval-session";
    // Рабочей признаётся только эталонная форма: любой другой код — не сверенный живьём.
    // После --satellite — ничего либо набор тулов `--tools a,b,c` (bridge/narrow.ts).
    const tail = after.slice(1);
    const known =
      !tail.length || (tail.length === 2 && tail[0] === "--tools" && isToolList(tail[1]));
    return e.args[1] === SATELLITE_CODE && after[0] === "--satellite" && known
      ? "eval"
      : "eval-other";
  }
  if (SHELLS.has(base)) {
    const s = e.args[e.args.indexOf("-c") + 1] ?? "";
    return s.includes("--satellite") ? "shell" : "session";
  }
  return e.args.includes("--satellite") ? "path" : "session";
}

const expandHome = (p: string): string =>
  p
    .replace(/^~(?=[\\/])/, homedir())
    .replace(/\$\{HOME\}|\$HOME|%USERPROFILE%|\$\{USERPROFILE\}|\$USERPROFILE/g, homedir());

/** Путь к мосту, который запустит запись, — разбором args массивом: дом с пробелом остаётся целым. */
export function bridgePathOf(e: SatEntry): string | null {
  const base = cmdBase(e.command);
  if (base === "node" && (e.args[0] === "-e" || e.args[0] === "--eval")) {
    const code = e.args[1] ?? "";
    if (/homedir\(\)/.test(code) && /\.iskron-bridge/.test(code)) return homeBridgePath();
    const m = /['"`]([^'"`]*iskron[^'"`]*\.mjs)['"`]/.exec(code);
    return m ? expandHome(m[1]) : null;
  }
  if (SHELLS.has(base)) {
    const s = e.args[e.args.indexOf("-c") + 1] ?? "";
    const m = /"([^"]*iskron[^"]*\.mjs)"|'([^']*iskron[^']*\.mjs)'|(\S*iskron\S*\.mjs)/.exec(s);
    const raw = m?.[1] ?? m?.[2] ?? m?.[3];
    return raw ? expandHome(raw) : null;
  }
  const arg = [e.command, ...e.args].find((a) => /iskron[^\\/]*\.mjs$/i.test(a));
  return arg ? expandHome(arg) : null;
}

/**
 * Готовый блок записи — блочной формой YAML, той же, что пишет проекция и читает
 * doctor: вставленный вместо прежних mcpServers и disallowedTools, он на повторе
 * не даёт ни одной строки «НАДО:». Один на все ОС — машинного в нём нет.
 */
export function readyEntry(name: string, disallowed: string[], tail: string[] = []): string {
  return [
    "mcpServers:",
    `  - ${name}:`,
    "      type: stdio",
    "      command: node",
    `      args: [${[...SATELLITE_ARGS, ...tail].map((a) => JSON.stringify(a)).join(", ")}]`,
    `disallowedTools: ${disallowed.join(", ")}`,
  ].join("\n");
}
