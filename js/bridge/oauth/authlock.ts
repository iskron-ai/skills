import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";

import { CFG } from "../config.ts";
import { storePath } from "../store.ts";

// --- machine-wide authorization coordination ------------------------------
// Dozens of local agents share one grant, so at most ONE bridge instance runs
// the browser flow; every other instance (and every call meanwhile) surfaces
// the SAME authorize URL from the lock — whichever surface the human happens
// to look at, one click heals the whole machine.
//
// What makes a standing flow joinable is the LISTENER, not the file. A bridge
// killed mid-flow (SIGKILL, a reaped ephemeral run, a crash) leaves its lock
// behind with nothing bound to the callback port; a joiner that trusts the file
// alone then hands the human an authorize URL whose redirect lands on a closed
// port — the click is spent and no one catches it. So the loopback port IS the
// claim: whoever binds it owns the flow, and the file only carries that owner's
// URL for the others to surface. Both errors are cheap to picture and one is
// far worse: joining a dead flow silently burns the human's login, while taking
// over a live one costs at most a second browser tab. When in doubt, take over.

const AUTH_LOCK_FRESH_MS = 330_000; // flow timeout + margin; older is dead by the clock alone

export interface AuthLock {
  pid: number;
  started_at: number;
  authorize_url: string;
  callback_port: number;
}

export function authLockPath(): string {
  return storePath() + ".auth-pending";
}

export function pidAlive(pid: unknown): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM"; // alive, merely not ours to signal
  }
}

// Is anything accepting connections on the loopback callback port?
export function portListening(port: unknown, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Number.isInteger(port)) return resolve(false);
    const sock = connect({ host: "127.0.0.1", port: port as number });
    const done = (v: boolean) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

// The file alone is never proof of a live flow — the caller must also see the
// callback port listening before it surfaces this URL to anyone.
export function readAuthLock(): AuthLock | null {
  try {
    const l = JSON.parse(readFileSync(authLockPath(), "utf8")) as AuthLock;
    if (!(Date.now() - l.started_at < AUTH_LOCK_FRESH_MS)) return null;
    if (!pidAlive(l.pid)) return null; // the winner is gone; nothing holds the port
    return l;
  } catch {}
  return null;
}

// Written only by the process that holds the port, so it needs no exclusion
// dance: the bind already settled who writes here.
export function writeAuthLock(url: string, port: number): void {
  mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    authLockPath(),
    JSON.stringify({
      pid: process.pid,
      started_at: Date.now(),
      authorize_url: url,
      callback_port: port,
    }),
    { mode: 0o600 },
  );
}

export function releaseAuthLock(): void {
  try {
    unlinkSync(authLockPath());
  } catch {}
}

// A winner that dies mid-flow must not leave the machine locked for the
// stale-window: drop an owned lock on the way out.
export function installAuthLockExitHook(): void {
  process.on("exit", () => {
    try {
      const l = JSON.parse(readFileSync(authLockPath(), "utf8")) as AuthLock;
      if (l.pid === process.pid) unlinkSync(authLockPath());
    } catch {}
  });
}
