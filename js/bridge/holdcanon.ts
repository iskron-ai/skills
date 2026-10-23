// Hold records carry the graph as @owner/slug (graph @nks/nks-dev, decision #8200, inquiry
// #8677): a bare name without an owner reaches only the caller's own graph, so a seat
// returned from an earlier build's record written as rN or a bare slug would not come back.
// Such a record moves to the canonical key on the first read, with its seat's memory
// (.seen, .asks, .base); the old key stays in the record (formerKey) — a plugin or thin
// bridge returning by it, and the leaving daemon's spool (handoff.ts), still find it.
// A record whose local socket is alive belongs to a live bridge and is not touched;
// one the graph list does not resolve stays as it is, with a journal line.
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { basename, join } from "node:path";

import { scoped } from "../shared/scope.ts";
import { holdFilePathOf, socketPathOf, standingsDirOf } from "../shared/standings.ts";
import { realmList } from "./call.ts";
import { CFG } from "./config.ts";
import { writeOwned } from "./doorfiles.ts";
import { type HoldRecord, keyOf } from "./holdrecord.ts";
import { canonRealm, OWN_REALM, resolveRealms } from "./realms.ts";
import { log } from "./streams.ts";
import { localSocketAlive } from "./sweep.ts";

/** Graph names already said unresolved in this session: said once, not re-asked on every read. */
const unsaid = scoped(() => new Set<string>());
/** One move at a time per session: a stand and a return reading at once wait for it. */
const R = scoped(() => ({ run: null as Promise<void> | null }));

const MEMORY = /\.(seen|asks|base)$/;

const bare = (r: unknown): boolean => {
  const t = String(r ?? "").trim();
  return !!t && !t.startsWith("@") && t !== OWN_REALM;
};

const hashOf = (key: string): string => basename(holdFilePathOf(CFG.authDir, key), ".hold");

function readAll(dir: string): { file: string; rec: HoldRecord }[] {
  const out: { file: string; rec: HoldRecord }[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as HoldRecord;
      if (rec && rec.karta != null && bare(rec.realm)) out.push({ file: join(dir, f), rec });
    } catch {
      /* foreign or broken file */
    }
  }
  return out;
}

/** The seat's memory files follow it to the new key; one already there stays. */
function moveMemory(dir: string, from: string, to: string): void {
  const a = hashOf(from);
  const b = hashOf(to);
  for (const f of readdirSync(dir).filter((x) => x.startsWith(`${a}.`) && MEMORY.test(x))) {
    const dest = join(dir, b + f.slice(a.length));
    try {
      if (!existsSync(dest)) renameSync(join(dir, f), dest);
    } catch {}
  }
}

/** One record to the canonical key; false — not moved. */
function move(dir: string, file: string, rec: HoldRecord, canon: string): boolean {
  const from = keyOf(rec.realm, rec.karta, rec.name);
  const to = keyOf(canon, rec.karta, rec.name);
  const dest = holdFilePathOf(CFG.authDir, to);
  try {
    // A record under the canonical key is the seat's newer word: the old one goes.
    if (!existsSync(dest))
      writeOwned(dest, JSON.stringify({ ...rec, realm: canon, key: to, formerKey: from }) + "\n");
    unlinkSync(file);
    moveMemory(dir, from, to);
    log(`hold record ${from}: the graph ${rec.realm} is ${canon} — moved to ${to}`);
    return true;
  } catch (e) {
    log(`hold record ${from} not moved to ${to}: ${(e as Error).message}`);
    return false;
  }
}

/** Move this bridge's directory's hold records of rN or bare-slug graphs to @owner/slug. */
export function canonHoldRecords(): Promise<void> {
  R.run ??= moveAll().finally(() => {
    R.run = null;
  });
  return R.run;
}

async function moveAll(): Promise<void> {
  if (CFG.satellite) return; // a satellite's seat is not returned from disk (satellite.ts)
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync(dir)) return;
  const all = readAll(dir);
  const open: typeof all = [];
  for (const x of all)
    if (
      !(await localSocketAlive(
        socketPathOf(CFG.authDir, keyOf(x.rec.realm, x.rec.karta, x.rec.name)),
      ))
    )
      open.push(x);
  if (!open.length) return;
  const ask = open
    .map((x) => x.rec.realm)
    .filter((r) => !unsaid.has(r) && !canonRealm(r).startsWith("@"));
  if (ask.length) await resolveRealms(ask, realmList);
  for (const { file, rec } of open) {
    const canon = canonRealm(rec.realm);
    if (canon.startsWith("@")) move(dir, file, rec, canon);
    else if (!unsaid.has(rec.realm)) {
      unsaid.add(rec.realm);
      log(
        `hold record ${keyOf(rec.realm, rec.karta, rec.name)}: the graph ${rec.realm} is not in the graph list — left as it is; a bare name reaches only the own graph`,
      );
    }
  }
}
