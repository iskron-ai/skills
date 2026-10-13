// The stop mark on disk (graph @nks/nks-dev, nodes #7439, #7492): a seat its owner took
// off (close 4001 not expected as the session's own) stays down. The mark covers the seat's
// family — the base name, `base.N` and `base.sub-N` — and only the human's word, the stand
// tool with take=true, lifts it. One per stopped seat beside the hold records; the
// watchdogs read it too, so a stopped seat ends them without waking.
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { standingsDirOf, stopFilePathOf } from "./standings.ts";

export interface StopMark {
  /** server origin: marks of another server are not this one's */
  server: string;
  /** seat address `@handle:name` when the bridge knew it */
  address?: string;
  realm: string;
  /** canonical @owner/slug when known at the stop */
  canon?: string;
  karta: string;
  name: string;
  /** family base: `name`, `name.N`, `name.sub-N` fall under it */
  base: string;
  key: string;
  at: number;
  code: number;
  /** close reason as the service named it (`revoked:person`, `revoked:self`), if any */
  reason?: string;
  /** the stop word as told to the doer */
  text: string;
}

const SUFFIX = /^(\d+|sub-\d+)(\.(\d+|sub-\d+))*$/;

/** Whether `name` is the base itself or a seat beside it / a satellite of it. */
export function inFamily(base: string, name: string): boolean {
  if (!base) return false;
  if (name === base) return true;
  return name.startsWith(`${base}.`) && SUFFIX.test(name.slice(base.length + 1));
}

export function writeStopMark(authDir: string, mark: StopMark): void {
  const path = stopFilePathOf(authDir, mark.key);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(mark) + "\n", { mode: 0o600 });
}

/** All stop marks under the grant dir; unreadable ones are skipped. */
export function readStopMarks(authDir: string): StopMark[] {
  const dir = standingsDirOf(authDir);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".stop"));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), "utf8")) as StopMark;
      } catch {
        return null;
      }
    })
    .filter((m): m is StopMark => !!m && typeof m.base === "string" && typeof m.key === "string");
}

/** The mark of exactly this seat key, if any. */
export function stopMarkOf(authDir: string, key: string): StopMark | null {
  return readStopMarks(authDir).find((m) => m.key === key) ?? null;
}

export function dropStopMark(authDir: string, key: string): void {
  try {
    unlinkSync(stopFilePathOf(authDir, key));
  } catch {}
}
