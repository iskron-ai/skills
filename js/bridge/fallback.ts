// Запасной путь тонкого моста: демон машины не встал или отказал, и сессия
// идёт полным мостом в своём процессе (thin.ts, goLocal). Демон о ней не знает,
// поэтому мост оставляет отметку в каталоге гранта на время жизни процесса, и
// doctor называет такие сессии (граф nks-dev: #6489).
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface Fallback {
  pid: number;
  build: string;
  since: string;
  cwd: string;
  why: string;
}

export const fallbackDir = (authDir: string): string => join(resolve(authDir), "fallback");

/** Отметить свою сессию запасной; отметка уходит с процессом. Сбой записи не мешает мосту. */
export function markFallback(authDir: string, f: Omit<Fallback, "pid" | "since">): void {
  const file = join(fallbackDir(authDir), `${process.pid}.json`);
  try {
    mkdirSync(fallbackDir(authDir), { recursive: true, mode: 0o700 });
    const rec: Fallback = { pid: process.pid, since: new Date().toISOString(), ...f };
    writeFileSync(file, JSON.stringify(rec), { mode: 0o600 });
    process.once("exit", () => {
      try {
        unlinkSync(file);
      } catch {}
    });
  } catch {}
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Живые запасные сессии каталога гранта; отметки умерших процессов не читаются (и не стираются: doctor не пишет). */
export function readFallbacks(authDir: string): Fallback[] {
  let names: string[];
  try {
    names = readdirSync(fallbackDir(authDir));
  } catch {
    return [];
  }
  const out: Fallback[] = [];
  for (const n of names) {
    try {
      const f = JSON.parse(readFileSync(join(fallbackDir(authDir), n), "utf8")) as Fallback;
      if (Number.isInteger(f.pid) && alive(f.pid)) out.push(f);
    } catch {}
  }
  return out;
}
