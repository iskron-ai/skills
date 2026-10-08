// Подъём демона машины тонким мостом (thin.ts): отсоединённо, под замком выборов
// в личном каталоге шва, копией новее из своей и домашней.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { envName } from "../delivery/index.ts";
import { homeBridgePath } from "../shared/home.ts";
import { daemonEnv } from "../shared/seam.ts";
import { seamRaiseLockPath, seamRunDir, takeFileLock } from "../shared/seam-entrance.ts";
import { compareVersions } from "../shared/semver.ts";
import { VERSION, versionIn } from "../shared/version.ts";
import { log } from "./streams.ts";
import { updatesDisabled } from "./update.ts";

/** Замок подъёма, чей хозяин жив, но держит его дольше, — брошен. */
const RAISE_STALE_MS = 15_000;

export const SELF = (() => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return process.argv[1] ?? "";
  }
})();

/**
 * Какой копией поднимать демон: названной переменной, иначе самой новой из
 * своей и домашней — демон, поднятый старой копией, тут же передал бы места
 * новой. Под ISKRON_BRIDGE_NO_UPDATE дом не читается (пробы).
 */
function daemonEntry(): string {
  const named = process.env[envName("BRIDGE_DAEMON_ENTRY")]?.trim();
  if (named) return named;
  if (updatesDisabled()) return SELF;
  const home = homeBridgePath();
  try {
    const v = versionIn(readFileSync(home, "utf8"));
    if (home !== SELF && compareVersions(v, VERSION) > 0) return home;
  } catch {}
  return SELF;
}

export type Raise =
  | { kind: "raising"; release(): void; failed: Promise<{ code: number | null; why: string }> }
  | { kind: "other" } // поднимает другой — ждём его демона
  | { kind: "fault"; why: string }; // замка не взять — ждать нечего

/** Поднять демон отсоединённо под замком выборов. */
export function raiseDaemon(authDir: string): Raise {
  const lock = takeFileLock(seamRaiseLockPath(authDir), RAISE_STALE_MS);
  if (!lock.held) return lock.fault ? { kind: "fault", why: lock.fault } : { kind: "other" };
  const entry = daemonEntry();
  log(`no bridge daemon for ${authDir} — raising one: ${entry} daemon`);
  try {
    // Демону — окружение сессии, токен и основа процесса, не всё окружение харнеса.
    const child = spawn(process.execPath, [entry, "daemon", "--auth-dir", authDir], {
      detached: true,
      stdio: "ignore",
      cwd: seamRunDir(authDir),
      env: daemonEnv(),
      windowsHide: true,
    });
    child.unref();
    const failed = new Promise<{ code: number | null; why: string }>((r) => {
      child.once("error", (e) => r({ code: null, why: `the daemon did not start: ${e.message}` }));
      child.once("exit", (code, sig) =>
        r({ code, why: `the daemon exited at once (${sig ?? `code ${code}`})` }),
      );
    });
    return { kind: "raising", release: lock.release, failed };
  } catch (e) {
    lock.release();
    return { kind: "fault", why: `the daemon did not start: ${(e as Error).message}` };
  }
}
