// A satellite's stop record (graph @nks/nks-dev, nodes #7621, #7505): its socket's address beside
// the grant, under its seat key, with the INCARNATION of this satellite's hold of the key — a
// random id minted at its first hold, kept by its re-arms and by a return by key. The seat
// key is reused by the next satellite of the same name, role and graph; the incarnation is not:
// a deferred stop asks for the incarnation it knows (the child's restart marker carries it from
// the hold's event), and a record of another incarnation is never stopped or dropped by it
// (stopseat.ts). The record names the seat's platform id too: the stop's 200 removed the seat
// only if its `ended[]` names that id. The satellite drops its own record when it ends by itself.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { scoped } from "../shared/scope.ts";
import { stopFilePathOf } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { writeOwned } from "./doorfiles.ts";
import { log } from "./streams.ts";

export interface StopRecord {
  key: string;
  url: string;
  incarnation: string;
  /** The seat's platform id: a stop removed it only if its `ended[]` names it (#7621). */
  seat?: string | null;
}

/** The record this bridge wrote last: its own, the one its end drops. */
const S = scoped(() => ({ mine: null as StopRecord | null }));

function save(rec: StopRecord): void {
  const path = stopFilePathOf(CFG.authDir, rec.key);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeOwned(path, JSON.stringify({ ...rec, at: Date.now() }) + "\n");
    S.mine = rec;
  } catch (e) {
    log(`stop record of ${rec.key} not written: ${(e as Error).message}`);
  }
}

/**
 * The satellite's socket at its hold. Its first hold of `key` mints the incarnation; a re-arm
 * that turned the address (a pause's connect) keeps it — the plugin may never hear that hold's
 * event. `seat` — the seat's id when the connect named it (else the hello does, noteStopSeat).
 * This bridge's record of another key goes (its seat moved on).
 */
export function writeStopRecord(key: string, url: string, seat: string | null = null): void {
  const was = S.mine;
  const same = was?.key === key;
  if (same && was.url === url && (!seat || was.seat === seat)) return;
  if (was && !same) dropOwnStopRecord();
  const incarnation = same ? was.incarnation : randomUUID();
  save({ key, url, incarnation, seat: seat ?? (same ? (was.seat ?? null) : null) });
}

/** The held seat's id, learnt from its hello: this bridge's own record names it. */
export function noteStopSeat(seat: string | null | undefined): void {
  const mine = S.mine;
  if (mine && seat && mine.seat !== seat) save({ ...mine, seat });
}

export function readStopRecord(key: string): StopRecord | null {
  try {
    const r = JSON.parse(readFileSync(stopFilePathOf(CFG.authDir, key), "utf8")) as StopRecord;
    return typeof r?.url === "string" && typeof r.incarnation === "string" ? r : null;
  } catch {
    return null;
  }
}

/** The record goes only if it is still of `incarnation`: a newer holder's stays. */
export function dropStopRecord(key: string, incarnation: string): void {
  if (readStopRecord(key)?.incarnation !== incarnation) return;
  try {
    unlinkSync(stopFilePathOf(CFG.authDir, key));
  } catch {}
}

/** The satellite ends by itself: its own record goes (a later one of the same key stays). */
export function dropOwnStopRecord(): void {
  const mine = S.mine;
  S.mine = null;
  if (mine) dropStopRecord(mine.key, mine.incarnation);
}

/**
 * A return by key: the paused bridge's record is this bridge's own now — the same incarnation,
 * the socket it returned onto.
 */
export function adoptStopRecord(key: string, url: string | null): void {
  const rec = readStopRecord(key);
  if (!rec || !url) return;
  S.mine = rec;
  writeStopRecord(key, url);
}

/** The incarnation the hold's event names — this bridge's own record of `key`. */
export const incarnationOf = (key: string): string | null =>
  S.mine?.key === key ? S.mine.incarnation : null;
