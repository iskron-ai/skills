// A record is given once per seat by its contract key (room.id, entry_id — seen.ts
// recordKeyOf); a copy under a new frame id is a re-issued queue row — the server's to fix
// (graph @nks/nks-dev, nodes #11359, #6574). A frame with event_id goes by its event. A stale
// count older than the highest record of its case already given is dropped too.
import { addressedToMine } from "../shared/addressed.ts";
import { type Frame, isDirectWord } from "../shared/channel.ts";
import { isGraphInbox } from "../shared/graph-inbox.ts";
import { isLifeCheck, noteSeen, recordKeyOf } from "../shared/seen.ts";
import { markAddressed } from "./addressmark.ts";
import { frameRef } from "./batchlog.ts";
import { givenIds } from "./fanout.ts";
import { log } from "./streams.ts";

/** The record's case prefix and number: `rec:<realm>|<case>|` and the entry. */
function split(rec: string): { at: string; n: number } | null {
  const cut = rec.lastIndexOf("|");
  const n = Number(rec.slice(cut + 1));
  return cut > 0 && Number.isSafeInteger(n) ? { at: rec.slice(0, cut + 1), n } : null;
}

/** The highest record of the case given to the seat, by its marks in memory and on disk. */
function topOf(at: string, seen: Set<string>, seenPath: string): number {
  let top = -Infinity;
  for (const marks of [seen, givenIds(seenPath)])
    for (const k of marks) {
      if (!k.startsWith(at)) continue;
      const n = Number(k.slice(at.length));
      if (Number.isSafeInteger(n) && n > top) top = n;
    }
  return top;
}

/**
 * Why this copy is not offered: "given" — the record was already given to the seat, "older"
 * — a stale count below a record of its case already given; "" — offer it. Only a count
 * (not addressed to the seat): a text copy wakes by its own rules.
 */
export function givenRecord(frame: Frame | null, seen: Set<string>, seenPath: string): string {
  if (!frame || frame.type !== "message" || addressedToMine(frame)) return "";
  if (isDirectWord(frame) || isLifeCheck(frame) || isGraphInbox(frame)) return "";
  const rec = recordKeyOf(frame);
  if (!rec) return "";
  if (seen.has(rec) || givenIds(seenPath).has(rec)) return "given";
  if (frame.stale !== true) return "";
  const s = split(rec);
  return s && topOf(s.at, seen, seenPath) > s.n ? "older" : "";
}

/**
 * The frame's addressing marked (addressmark.ts), then a copy not offered (givenRecord): its id
 * is marked given and the drop logged; true — dropped.
 */
export function countedBefore(
  frame: Frame | null,
  d: { seen: Set<string>; seenPath: string; key: string },
): boolean {
  const { seen, seenPath } = d;
  if (frame?.type === "message") markAddressed(frame, seenPath, seen);
  const why = givenRecord(frame, seen, seenPath);
  if (!frame || !why) return false;
  const id = typeof frame.id === "string" ? frame.id : "";
  if (id) noteSeen(seenPath, id, seen);
  log(`dropped as ${why} to ${d.key || "?"}: ${frameRef(frame)} — counts a record not raised`);
  return true;
}
