// Which standing a dsh session hears (graph @nks/nks-dev, node #10776): only the hold
// record the MCP bridge of THIS session wrote (#5061) — this working directory, the
// client name of the dsh MCP handshake, written no earlier than the plugin's start,
// not left. A machine's only key or a same-cwd record of another harness is another
// session's seat; taking it would pour that session's frames into this one. The seat
// appears when the session's bridge takes its place, after agent/created — so the
// window polls for it, one glance is too early.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DSH, envName } from "../delivery/index.ts";
import { sameDir } from "../shared/canon.ts";
import { words } from "../shared/lang.ts";
import {
  authDirFromEnv,
  HOLD_RECORD_MAX_AGE_MS,
  holdFilePathOf,
  socketPathOf,
  standingsDirOf,
} from "../shared/standings.ts";

/** How dsh names itself in the MCP initialize handshake (clientInfo.name), observed live
 * on 0.2.2-rc.1 — the harness writes it into the hold record's `client` field. */
export const DSH_MCP_CLIENT = "dsh-mcp-client";

// The bridge may come up a little after the session; the variable is a probe seam, not
// a human knob — the same seam the watchdog's attach window reads.
const attachWindowMs = (): number => Number(process.env[envName("WATCHDOG_ATTACH_MS")]) || 60_000;
const RETRY_MS = 1000;

export interface Seat {
  key: string;
  path: string;
  authDir: string;
}

/** The hold record of a key, as written by the bridge; null — none readable. */
function holdOf(authDir: string, key: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(holdFilePathOf(authDir, key), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/**
 * Whether the hold record names THIS session's seat: the client is dsh's own MCP
 * handshake name, the record is live (not left, not older than the plugin) and was
 * written no earlier than the plugin's start, and it stood on this working directory.
 * Records of other harnesses and of earlier sessions — even the only key on the
 * machine, even in this directory — are another session's seat.
 */
export function ownSeat(r: Record<string, unknown> | null, startedAt: number): boolean {
  if (!r) return false;
  return (
    r.client === DSH_MCP_CLIENT &&
    r.left !== true &&
    typeof r.at === "number" &&
    r.at >= startedAt &&
    Date.now() - r.at <= HOLD_RECORD_MAX_AGE_MS &&
    sameDir(r.cwd as string, process.cwd())
  );
}

const seatOf = (authDir: string, key: string): Seat => ({
  key,
  path: socketPathOf(authDir, key),
  authDir,
});

/** The seats of the standings directory whose hold records name this session. */
export function ownSeats(authDir: string, startedAt: number): Seat[] {
  let held: string[] = [];
  try {
    const dir = standingsDirOf(authDir);
    held = readdirSync(dir)
      .filter((f) => f.endsWith(".key"))
      .map((f) => {
        try {
          return readFileSync(join(dir, f), "utf8").trim();
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  } catch {
    /* no standings directory: no hearing */
  }
  const keys = [...new Set(held)];
  return keys.filter((k) => ownSeat(holdOf(authDir, k), startedAt)).map((k) => seatOf(authDir, k));
}

/**
 * Wait for the session's own seat within the attach window and hand it to `found`.
 * Exactly one — it; several — deaf in one loud line, no guessing; none until the
 * window ends — deaf in one loud line. Returns the cancel for a disposed session.
 */
export function awaitSeat(
  startedAt: number,
  found: (seat: Seat) => void,
  log: (text: string) => void,
): () => void {
  const W = () => words(DSH);
  const authDir = authDirFromEnv();
  const windowMs = attachWindowMs();
  const began = Date.now();
  let retry: ReturnType<typeof setTimeout> | null = null;
  const look = (): void => {
    const seats = ownSeats(authDir, startedAt);
    if (seats.length === 1) return void found(seats[0]);
    if (seats.length > 1) return log(W().deafSeveral(seats.map((s) => s.key).join(", ")));
    if (Date.now() - began >= windowMs) return log(W().deafNoStanding(Math.round(windowMs / 1000)));
    retry = setTimeout(look, RETRY_MS);
  };
  look();
  return () => {
    if (retry) clearTimeout(retry);
  };
}
