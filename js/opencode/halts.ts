// Sessions the owner stopped (graph @nks/nks-dev, nodes #7439, #7440): a stopped session and its
// descendants get no channel word — frame, batch, tact, resumed — until a new "held" of that session,
// which after a stop only an explicit call of the stand tool brings (bridge stophold.ts).
// OpenCode loads an instance per location and a reload drops memory: the stop lies on disk next to
// the plugin's other records (marker.ts), read by every instance at each delivery. The record is the
// session's id and the time, no secret; the session's deletion removes it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Halts {
  stop(session: string): void;
  held(session: string | null): void;
  /** The session or any of its ancestors is stopped. */
  halted(session: string): boolean;
  /** The session was deleted: its stop goes. */
  gone(session: string): void;
}

const PREFIX = "opencode-stopped";
const fileOf = (dir: string, session: string): string =>
  join(dir, `${PREFIX}.${createHash("sha256").update(session).digest("hex").slice(0, 16)}.json`);

/** `parentOf` — the known parent of a child session, without asking OpenCode; `dir` — the records' directory. */
export function createHalts(
  parentOf: (session: string) => string | undefined,
  dir: () => string,
): Halts {
  const unwritten = new Set<string>(); // the disk refused the record — this instance keeps the ban itself
  const marked = (s: string): boolean => unwritten.has(s) || existsSync(fileOf(dir(), s));
  const drop = (s: string): void => {
    unwritten.delete(s);
    try {
      unlinkSync(fileOf(dir(), s));
    } catch {
      /* no record or removed by another instance */
    }
  };
  return {
    stop(session) {
      try {
        mkdirSync(dir(), { recursive: true, mode: 0o700 });
        const record = JSON.stringify({ session, at: new Date().toISOString() });
        writeFileSync(fileOf(dir(), session), record, { mode: 0o600 });
        unwritten.delete(session);
      } catch {
        unwritten.add(session);
      }
    },
    held: (session) => void (session && drop(session)),
    gone: drop,
    halted(session) {
      const seen = new Set<string>();
      for (let s: string | undefined = session; s && !seen.has(s); s = parentOf(s)) {
        if (marked(s)) return true;
        seen.add(s);
      }
      return false;
    },
  };
}

/** Every known descendant of `session` — children, theirs, and so on — by the parent map `parents`. */
export function descendantsOf(session: string, parents: Iterable<[string, string]>): string[] {
  const all = [...parents];
  const found: string[] = [];
  const seen = new Set([session]);
  for (let i = -1; i < found.length; i++) {
    const of = i < 0 ? session : found[i];
    for (const [child, parent] of all)
      if (parent === of && !seen.has(child)) {
        seen.add(child);
        found.push(child);
      }
  }
  return found;
}
