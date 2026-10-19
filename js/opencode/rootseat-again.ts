// A root not seated for a defect of its cover (rootseat.ts) waits for the alignment in the same
// session: after every tool call of the instance its cover file is looked at by a cheap stat
// (mtime, size, inode — no watcher), on every prompt of the root it is read again. Unambiguous —
// the root seats once by the same path; another defect — its exact word. A defect is a missing
// file, broken front matter, a missing or ambiguous graph or role; the contract's number is not
// the plugin's to know — the cover file itself and the start hook keep it. Alignment is only
// inside a repository (shared/reposigns.ts: any verdict but "outside"), where no cover file is its
// entry too; outside one there is nothing to align: no file — silence, a defective one — the plain
// "not seated", neither waits. A stopped session waits no more: alignment does not lift a stop.
import { statSync } from "node:fs";
import { join } from "node:path";

import { COVER, ROOT_SEAT } from "../delivery/index.ts";
import { type Cover, readCover } from "../shared/cover.ts";
import { words } from "../shared/lang.ts";
import { repoRoot } from "../shared/reposigns.ts";

/** The cover of a session's directory; a reason says whether it leads to the alignment. */
export type Found = Exclude<Cover, { why: string }> | { why: string; align: boolean };

/** Whether the directory is in a repository is asked before any defect: outside — main's reading. */
export function coverIn(where: string): Found {
  const align = repoRoot(where) !== null;
  const cover = readCover(where);
  if (cover === null) return align ? { why: words(ROOT_SEAT).noFile(COVER.file), align } : null;
  return "why" in cover ? { why: cover.why, align } : cover;
}

/** The cover file's signature; no file — "". */
export function stamp(where: string): string {
  try {
    const st = statSync(join(where, COVER.file));
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch {
    return "";
  }
}

/** What a waiting root does now: say the new reason, seat, or nothing. */
export type Again = { why: string } | { seat: true } | null;

export function createRealign(halted: (session: string) => boolean) {
  const waiting = new Map<string, { where: string; why: string; sig: string }>();
  return {
    /** sig — the stamp taken before the defective read: a write in between is not missed. */
    arm(session: string, where: string, why: string, sig: string): void {
      waiting.set(session, { where, why, sig });
    },
    has: (session: string): boolean => waiting.has(session),
    sessions: (): string[] => [...waiting.keys()],
    drop: (session: string): void => void waiting.delete(session),
    clear: (): void => waiting.clear(),
    /** always — a prompt reads the cover even when its stamp did not move. */
    check(session: string, always: boolean): Again {
      const w = waiting.get(session);
      if (!w) return null;
      if (halted(session)) {
        waiting.delete(session);
        return null;
      }
      const sig = stamp(w.where);
      if (!always && sig === w.sig) return null;
      w.sig = sig;
      const cover = coverIn(w.where);
      if (cover === null) return null;
      if ("why" in cover) {
        if (cover.why === w.why) return null;
        w.why = cover.why;
        return { why: cover.why };
      }
      waiting.delete(session);
      return { seat: true };
    },
  };
}
