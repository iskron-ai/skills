// Sessions the owner stopped (graph @nks/nks-dev, nodes #7439, #7440): a stopped session and its
// descendants get no channel word — frame, batch, tact, resumed — until a new "held" of that session,
// which after a stop only an explicit call of the stand tool brings (bridge stophold.ts).
// OpenCode loads an instance per location and a reload drops memory: the stop lies in a registry
// on globalThis, shared by the process's live instances like the twins' (twins.ts), and on disk
// next to the plugin's other records (marker.ts) for the instance after a reload. A refused write
// is loud: the live instances still keep the ban, a reload would lose it. The record is the
// session's id and the time, no secret; the session's deletion removes it. A new held lifts the
// ban in the registry always; a refused removal of the record is loud and rewrites it as lifted,
// so a reload reads no ban either.
/* eslint-disable @typescript-eslint/no-explicit-any -- the process registry lives on globalThis */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GLOBAL_PREFIX } from "../delivery/index.ts";

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
const stops = (): Set<string> =>
  ((globalThis as any)[`${GLOBAL_PREFIX}Halts`] ??= new Set<string>());
/** Bans lifted in this process: a record the disk would not let go no longer stops them. */
const lifted = (): Set<string> =>
  ((globalThis as any)[`${GLOBAL_PREFIX}Lifted`] ??= new Set<string>());

const code = (e: unknown): string | undefined => (e as NodeJS.ErrnoException).code;

/** The record bans: present and not rewritten as lifted; one unreadable bans, as before. */
function recorded(file: string): boolean {
  try {
    return !(JSON.parse(readFileSync(file, "utf8")) as { lifted?: string }).lifted;
  } catch (e) {
    return code(e) !== "ENOENT";
  }
}

/**
 * `parentOf` — the known parent of a child session, without asking OpenCode; `dir` — the records'
 * directory; `unwritten` — the disk refused a stop's record; `unlifted` — the disk refused to
 * remove it, `kept` — and to rewrite it as lifted.
 */
export function createHalts(
  parentOf: (session: string) => string | undefined,
  dir: () => string,
  unwritten: (session: string, message: string) => void,
  unlifted: (session: string, message: string, kept: boolean) => void,
): Halts {
  const marked = (s: string): boolean =>
    stops().has(s) || (!lifted().has(s) && recorded(fileOf(dir(), s)));
  const drop = (s: string): void => {
    stops().delete(s);
    lifted().add(s);
    const file = fileOf(dir(), s);
    try {
      unlinkSync(file);
    } catch (e) {
      if (code(e) === "ENOENT") return; // no record or removed by another instance
      let kept = false;
      try {
        const record = JSON.stringify({ session: s, lifted: new Date().toISOString() });
        writeFileSync(file, record, { mode: 0o600 });
      } catch {
        kept = true;
      }
      unlifted(s, (e as Error).message, kept);
    }
  };
  return {
    stop(session) {
      stops().add(session);
      lifted().delete(session);
      try {
        mkdirSync(dir(), { recursive: true, mode: 0o700 });
        const record = JSON.stringify({ session, at: new Date().toISOString() });
        writeFileSync(fileOf(dir(), session), record, { mode: 0o600 });
      } catch (e) {
        unwritten(session, (e as Error).message);
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

/* eslint-enable @typescript-eslint/no-explicit-any */

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
