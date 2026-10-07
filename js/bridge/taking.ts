// Намерение занять место (граф nks-dev: решение #6706): мост названной сессии
// пишет его до connect или mint и стирает по исходу. Прежний мост той же
// сессии, получив 4000, по нему знает, что место берёт своя сессия, и ждёт
// исхода её connect — записи держания с новым адресом либо стёртого намерения, —
// а не времени: медленный connect не делает из своего места два.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { takingFilePathOf } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { keyOf, sessionOfBridge } from "./holdrecord.ts";
import { normKarta, normName } from "./names.ts";

interface Taking {
  session: string;
  pid: number;
}

const pathOf = (key: string): string => takingFilePathOf(CFG.authDir, key);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Сессия, чей мост сейчас занимает место; намерение умершего процесса — не в счёт. */
export function takerOf(key: string): string | null {
  try {
    const t = JSON.parse(readFileSync(pathOf(key), "utf8")) as Taking;
    return typeof t.session === "string" && alive(t.pid) ? t.session : null;
  } catch {
    return null;
  }
}

/**
 * Намерение под connect или mint места из args — до вызова; возвращает, чем его
 * стереть по исходу (после записи держания). Мост без названной сессии его не пишет.
 */
export function beginTaking(args: Record<string, unknown>): () => void {
  const session = sessionOfBridge();
  const action = String(args.action);
  const realm = typeof args.realm === "string" ? args.realm.trim() : "";
  if (!session || CFG.satellite || !realm || (action !== "connect" && action !== "mint"))
    return () => {};
  const path = pathOf(keyOf(realm, normKarta(args.karta), normName(args.name)));
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ session, pid: process.pid }) + "\n", { mode: 0o600 });
  } catch {
    return () => {}; // не записалось — прежний мост сочтёт отнявшего другим и встанет рядом
  }
  return () => {
    try {
      unlinkSync(path);
    } catch {}
  };
}

/** Ход fn под намерением (beginTaking). */
export async function takingSeat<T>(
  args: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const end = beginTaking(args);
  try {
    return await fn();
  } finally {
    end();
  }
}
