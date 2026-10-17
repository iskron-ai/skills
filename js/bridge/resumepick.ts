// Which hold records a seat return (resume.ts) counts as its own (graph @nks/nks-dev, nodes #5151, #6017).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sameDir as oneDir } from "../shared/canon.ts";
import { standingsDirOf } from "../shared/standings.ts";
import { harnessName } from "./client.ts";
import { CFG } from "./config.ts";
import { ledKey } from "./hold.ts";
import { type HoldRecord, keyOf, readHoldRecord } from "./holdrecord.ts";
import { resumeWords } from "./resumewords.ts";

export interface ResumeSelector {
  /** Standing key — preferred: the exact record. */
  key?: string;
  /** Session directory — fallback: this harness's records stood by this session, freshest first. */
  cwd?: string;
  /** The harness session of this bridge: by directory only its own records count (#6017). */
  session?: string;
}

/**
 * Own hold records under the selector, same harness: by key first, then by
 * directory, freshest first. Key is a preference, directory a fallback, not "or": a
 * stale key (bridge killed between released and held) must not mute a live record.
 * By directory only records stood by THIS session or the seat this bridge leads
 * count (#6017); a seat released by `left` never does — only stand by name returns it.
 * `sameDir` — all same-directory records of this harness; `legacy` — records of an
 * earlier build without a session, named aloud but not taken.
 */
export function recordsFor(sel: ResumeSelector): {
  own: HoldRecord[];
  sameDir: string[];
  legacy: HoldRecord[];
  left: string[];
  neighbour: string[];
  stale: string[];
} {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir))
    return { own: [], sameDir: [], legacy: [], left: [], neighbour: [], stale: [] };
  const mine = harnessName();
  const led = ledKey();
  const byKey: HoldRecord[] = [];
  const byCwd: HoldRecord[] = [];
  const sameDir: string[] = [];
  const legacy: HoldRecord[] = [];
  const left: string[] = [];
  const neighbour: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      // Another harness's record: a bridge of another harness in the same copy keeps its seat.
      if (!rec || rec.client !== mine) continue;
      const key = keyOf(rec.realm, rec.karta, rec.name);
      const keyed = !!sel.key && key === sel.key;
      const inDir = oneDir(rec.cwd, sel.cwd); // /tmp and /private/tmp are one directory (#5048)
      // Stood by this session — taken outside the directory too: sessions move (#6550).
      const stoodBy = !!sel.session && rec.session === sel.session;
      if (!keyed && !inDir && !stoodBy) continue;
      // Read by key as stand does: an expired record is erased and not read.
      const fresh = readHoldRecord(key);
      if (!fresh) continue;
      if (inDir) sameDir.push(key);
      if (fresh.left) {
        left.push(key);
        continue;
      }
      const stoodHere = key === led || (!!sel.session && fresh.session === sel.session);
      // By key too, a neighbour's seat is not taken: another named session stood on it (#6706).
      const theirs = !!sel.session && !!fresh.session && fresh.session !== sel.session;
      if (keyed && theirs) neighbour.push(key);
      else if (keyed) byKey.push(fresh);
      else if (stoodHere) byCwd.push(fresh);
      else if (!fresh.session) legacy.push(fresh);
    } catch {
      /* foreign or broken file */
    }
  }
  // A satellite is one seat per session in a role and graph: a keyed record older than another
  // record of the same session there is a former era's seat (a stale loss marker, a gone twin
  // server) — not taken; the fresher one is returned instead (case №954).
  const stale: string[] = [];
  const keyed = CFG.satellite
    ? byKey.filter((k) => {
        const fresher = byCwd.find(
          (r) =>
            r.realm === k.realm &&
            String(r.karta) === String(k.karta) &&
            r.name !== k.name &&
            (r.at ?? 0) > (k.at ?? 0),
        );
        if (fresher) stale.push(resumeWords.staleKey(k.name, fresher.name));
        return !fresher;
      })
    : byKey;
  return {
    own: [...keyed, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))],
    sameDir,
    legacy,
    left,
    neighbour,
    stale,
  };
}
