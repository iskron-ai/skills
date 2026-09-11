import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";

import { CFG } from "../config.ts";
import { storePath } from "../store.ts";

// --- machine-wide authorization coordination ------------------------------
// Dozens of local agents share one grant, so a machine has at most ONE login in
// flight; every bridge (and every call meanwhile) surfaces the SAME authorize
// URL — whichever surface the human happens to look at, one click heals the
// whole machine.
//
// The file IS that login. It is published once and lives until the login lands
// or is refused, longer than the bridge that published it, and it carries what
// any bridge needs to catch this very login's redirect (state, PKCE verifier,
// the client its sign-in page was minted under). Its link is the loopback
// address of whoever listens on the port, never the sign-in server's page. So the tab the human already has stays good whichever
// bridge is alive when they click: a later bridge that finds nobody listening
// listens on the same link itself (graph nks-dev: #4721, #4794). Whether anyone
// listens right now is the LISTENER's word, never the file's — a caller probes
// the port before it hands the link to anyone.
//
// Before its link exists the file is a bare claim: the bridge that bound the
// port writes it at once, so a sibling that meets the bound port waits for this
// login's link instead of registering a second client for a second tab (#4793).

export interface AuthLock {
  pid: number;
  started_at: number;
  callback_port: number;
  authorize_url?: string;
  state?: string;
  verifier?: string;
  /** the client the sign-in page was last minted under — the code is exchanged under it */
  client_id?: string;
  /** a fingerprint of the grant the login was published over — another grant makes it moot */
  grant?: string;
  /** whether the login's one browser tab has been opened */
  tab?: boolean;
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

export function readAuthLock(): AuthLock | null {
  try {
    return JSON.parse(readFileSync(authLockPath(), "utf8")) as AuthLock;
  } catch {
    return null;
  }
}

// Written by the process that holds the port — the bind settled who writes
// here. The one exception is the mark of the login's tab, added by the bridge
// that opened it — which first won the tab's marker file, one no two processes
// can both create, so bridges joining in the same instant open it once. (The
// same read-modify-write can drop a client minted that instant; the exchange
// then falls back to the machine's registration.)
export function writeAuthLock(
  fields: Omit<AuthLock, "pid" | "started_at"> & Partial<Pick<AuthLock, "pid" | "started_at">>,
): void {
  mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    authLockPath(),
    JSON.stringify({
      ...fields,
      pid: fields.pid ?? process.pid,
      started_at: fields.started_at ?? Date.now(),
    }),
    { mode: 0o600 },
  );
}

// Only the login's own listener clears it: a record a newer login or a taker
// has rewritten is not ours to drop, so a caller names what it owns.
export function releaseAuthLock(owns?: (l: AuthLock) => boolean): void {
  try {
    const l = readAuthLock();
    if (owns && (!l || !owns(l))) return;
    unlinkSync(authLockPath());
    if (l?.state) unlinkSync(tabMarkPath(l.state));
  } catch {}
}

const tabMarkPath = (state: string): string => `${authLockPath()}.tab-${state}`;

// The one tab of a login goes to whoever creates its marker: exclusive create
// is atomic across processes, where reading the record and then writing it is
// not — bridges joining in the same instant each read "no tab yet" (#4794).
export function claimTab(state: string): boolean {
  try {
    mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 });
    writeFileSync(tabMarkPath(state), "", { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

// A published login outlives its bridge on purpose. A bare claim does not: a
// claimer that dies before publishing must not keep siblings waiting on it.
export function installAuthLockExitHook(): void {
  process.on("exit", () => {
    try {
      const l = JSON.parse(readFileSync(authLockPath(), "utf8")) as AuthLock;
      if (l.pid === process.pid && !l.authorize_url) unlinkSync(authLockPath());
    } catch {}
  });
}
