// A seat its owner took off stays down (graph @nks/nks-dev, nodes #7439, #7440, #7492):
// a foreign close 4001 marks the seat's family stopped on disk (shared/stopmark.ts), and no
// path of the bridge takes it again — not the agent's raw connect or register, not a return
// from disk, after a leave, by the hearing watchdog, after a daemon change, a re-register on
// a new session, a satellite's pause or satellite_of. The check sits at the exit to the
// server (transport.ts), like the unnamed seat's (unnamed.ts), and on the paths that reopen a
// socket by its stored address. The api's own refusal 409 standing_stopped reads the same
// (stoprefusal.ts). Only the human's word lifts it: the stand tool with take=true.
import { STOP, type StopWho } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import {
  dropStopMark,
  inFamily,
  readStopMarks,
  type StopMark,
  writeStopMark,
} from "../shared/stopmark.ts";
import { CFG } from "./config.ts";
import { seatBaseOf } from "./holdrecord.ts";
import { normKarta, normName } from "./names.ts";
import { canonRealm, resolvedRealm, sameRealm } from "./realms.ts";
import { standingLog } from "./store.ts";
import { log } from "./streams.ts";

const server = (): string => {
  try {
    return new URL(CFG.serverUrl).origin;
  } catch {
    return CFG.serverUrl;
  }
};

export const whoOf = (reason: unknown): StopWho =>
  reason === "revoked:person" ? "person" : reason === "revoked:self" ? "self" : "other";

export const stopWord = (name: string, reason?: unknown): string =>
  words(STOP).stopped(name, whoOf(reason));

/** Write the stop mark of a seat taken off; returns the stop word. */
export function markStopped(
  seat: { realm: string; karta: string | number; name?: string },
  key: string,
  code: number,
  reason: string,
  address?: string | null,
): string {
  const name = seat.name ?? "";
  const text = stopWord(name, reason);
  const canon = canonRealm(seat.realm);
  try {
    writeStopMark(CFG.authDir, {
      server: server(),
      ...(address ? { address } : {}),
      realm: seat.realm,
      ...(resolvedRealm(canon) ? { canon } : {}),
      karta: String(seat.karta),
      name,
      base: seatBaseOf(key) ?? name,
      key,
      at: Date.now(),
      code,
      ...(reason ? { reason } : {}),
      text,
    });
  } catch (e) {
    log(`stop mark not written: ${(e as Error).message}`);
  }
  standingLog(`stopped ${key}: close ${code}${reason ? ` (${reason})` : ""}`);
  return text;
}

function covers(m: StopMark, realm: unknown, karta: unknown, name: string): boolean {
  if (m.server !== server() || !inFamily(m.base, name)) return false;
  const k = normKarta(karta);
  if (k && k !== "agent" && k !== m.karta) return false;
  return sameRealm(realm, m.realm) || (!!m.canon && canonRealm(realm) === m.canon);
}

/** The stop mark covering this seat, if any. */
export function stopOf(realm: unknown, karta: unknown, name: unknown): StopMark | null {
  const n = normName(name);
  if (!n) return null;
  return readStopMarks(CFG.authDir).find((m) => covers(m, realm, karta, n)) ?? null;
}

/** The human's word (take=true): every mark covering this seat goes. */
export function liftStop(realm: unknown, karta: unknown, name: unknown): boolean {
  const n = normName(name);
  const hit = readStopMarks(CFG.authDir).filter((m) => covers(m, realm, karta, n));
  for (const m of hit) {
    dropStopMark(CFG.authDir, m.key);
    standingLog(`stop lifted ${m.key}: take=true for ${n}`);
  }
  return hit.length > 0;
}

/** The stand tool's gate: the stop word without take=true; with it the stop is lifted. */
export function standStopGate(
  realm: string,
  karta: string,
  name: string,
  take: boolean,
): string | null {
  const m = stopOf(realm, karta, name);
  if (!m) return null;
  if (!take) return stopWord(name, m.reason);
  liftStop(realm, karta, name);
  return null;
}
