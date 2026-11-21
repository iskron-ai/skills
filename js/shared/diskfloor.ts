// Heavy work is refused on a nearly full disk (graph @nks/nks-dev, node #11288): the free space
// of the working tree's volume is read before the move; below the floor the move is refused
// with the word naming the cleanup; above it, or when the volume did not read, nothing changes.
import { statfsSync } from "node:fs";

import { DISK_FLOOR, type DiskFloorWords, envName, type Lang } from "../delivery/index.ts";
import { buildCommand } from "./buildcmd.ts";
import { wordsIn } from "./lang.ts";

/** The floor: free space under this share of the volume refuses heavy work. */
export const DISK_FLOOR_PCT = 10;

/** The refusal's code where moves are said by code (the orchestrator's lead rows). */
export const DISK_FLOOR_CODE = "disk_floor";

const GB = 1024 ** 3;

/** The floor in effect: the constant, or the probes' variable when it names a number. */
function floorPct(): number {
  const raw = process.env[envName("DISK_FLOOR_PCT")]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : DISK_FLOOR_PCT;
}

export interface DiskShort {
  path: string;
  free: number;
  total: number;
  pct: number;
  floor: number;
}

/** The volume of `path` when its free space is below the floor; null above it or unread. */
export function belowFloor(path: string): DiskShort | null {
  const floor = floorPct();
  try {
    const s = statfsSync(path);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!(total > 0) || !Number.isFinite(free)) return null;
    const pct = (free / total) * 100;
    return pct < floor ? { path, free, total, pct, floor } : null;
  } catch {
    return null;
  }
}

const SHOWN = 80;
const clip = (s: string): string => (s.length > SHOWN ? `${s.slice(0, SHOWN - 1)}…` : s);

/**
 * A harness's call in `dir` (OpenCode and Claude Code plugins): a subagent, or a shell line
 * holding a build command (buildcmd.ts), below the floor — the refusal word; else null. `lang`
 * is asked only for a refusal: a call that passes reads nothing beyond the volume.
 */
export function callRefusal(
  dir: string | null,
  call: { subagent: true } | { shell: string },
  lang?: () => Lang | undefined,
): string | null {
  const build = "shell" in call ? buildCommand(call.shell) : null;
  if (!dir || ("shell" in call && !build)) return null;
  const short = belowFloor(dir);
  if (!short) return null;
  return floorWord(short, (w) => (build ? w.moveBuild(clip(build)) : w.moveSubagent()), lang?.());
}

/** The refusal word for a move below the floor, in the session's language or the given one. */
export function floorWord(
  short: DiskShort,
  move: (w: DiskFloorWords) => string,
  lang?: Lang,
): string {
  const w = wordsIn(DISK_FLOOR, lang);
  return w.refused(
    short.path,
    (short.free / GB).toFixed(1),
    (short.total / GB).toFixed(0),
    short.pct.toFixed(1),
    String(short.floor),
    move(w),
  );
}
