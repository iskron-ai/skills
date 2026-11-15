// A compacted dsh session keeps its role (the pattern of opencode/compaction.ts): dsh
// runs the summary as its own LLM request with no hook to instruct, so the word about
// the role goes to the live session as one next-turn message after compaction/end.
// The seat is read from the hold record of the standing the session heard; without a
// record the word is bare — the role unnamed, the instruction to reread stays.
import { readFileSync } from "node:fs";

import { COMPACTION } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { holdFilePathOf } from "../shared/standings.ts";

export interface Place {
  realm: string;
  karta: string;
  name: string;
}

/** The seat of the standing the session heard, from its hold record; null — unknown. */
export function placeOf(authDir: string, key: string | null): Place | null {
  if (!key) return null;
  try {
    const r = JSON.parse(readFileSync(holdFilePathOf(authDir, key), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof r.realm !== "string" || !r.realm || r.karta == null) return null;
    if (typeof r.name !== "string" || !r.name) return null;
    return { realm: r.realm, karta: String(r.karta), name: r.name };
  } catch {
    return null;
  }
}

/** The role word after a compaction: by the seat when it is known, bare otherwise. */
export function roleWord(authDir: string, key: string | null): string {
  const p = placeOf(authDir, key);
  return p ? words(COMPACTION).back(p.karta, p.name, p.realm) : words(COMPACTION).bare();
}
