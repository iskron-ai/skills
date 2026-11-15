// Which standing a dsh session hears (graph @nks/nks-dev, node #10776): the only key
// held on the machine, or the one this working directory stood on (#5061). Several
// candidates or none leave the session deaf — one loud line, no guessing.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DSH } from "../delivery/index.ts";
import { sameDir } from "../shared/canon.ts";
import { words } from "../shared/lang.ts";
import {
  authDirFromEnv,
  HOLD_RECORD_MAX_AGE_MS,
  holdFilePathOf,
  socketPathOf,
  standingsDirOf,
} from "../shared/standings.ts";

export interface Seat {
  key: string;
  path: string;
  authDir: string;
}

/** A live hold record of this working directory names the session's own seat (#5061). */
function heldHere(authDir: string, key: string): boolean {
  try {
    const r = JSON.parse(readFileSync(holdFilePathOf(authDir, key), "utf8")) as Record<
      string,
      unknown
    >;
    return (
      r.left !== true &&
      typeof r.at === "number" &&
      Date.now() - r.at <= HOLD_RECORD_MAX_AGE_MS &&
      sameDir(r.cwd as string, process.cwd())
    );
  } catch {
    return false;
  }
}

const seatOf = (authDir: string, key: string): Seat => ({
  key,
  path: socketPathOf(authDir, key),
  authDir,
});

/** Which standing to hear: the only one held, or the one this directory stood on. */
export function resolveSeat(authDir = authDirFromEnv()): Seat | { error: string } {
  const W = () => words(DSH);
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
  if (keys.length === 1) return seatOf(authDir, keys[0]);
  const here = keys.filter((k) => heldHere(authDir, k));
  if (keys.length > 1 && here.length === 1) return seatOf(authDir, here[0]);
  return { error: keys.length ? W().deafSeveral(keys.join(", ")) : W().deafNoStanding() };
}
