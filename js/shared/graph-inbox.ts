// Soft graph inbox identity (graph @nks/nks-dev, nodes #7334, #7333).
// Only the structured platform envelope grants this path; prose never does.
import type { Frame } from "./channel.ts";

export function graphInboxKey(frame: Frame | null | undefined): string | null {
  if (frame?.type !== "message" || frame.provenance?.via !== "graph") return null;
  const b = frame.body;
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const body = b as Record<string, unknown>;
  if (
    typeof body.realm_slug !== "string" ||
    !body.realm_slug ||
    typeof body.vimarsha_seq !== "number" ||
    !Number.isInteger(body.vimarsha_seq) ||
    body.vimarsha_seq <= 0 ||
    !["posed_to", "updated", "vimarsha.updated"].includes(String(body.event_kind))
  )
    return null;
  return JSON.stringify([body.realm_slug, body.vimarsha_seq]);
}

export const isGraphInbox = (frame: Frame | null | undefined): boolean =>
  graphInboxKey(frame) !== null;

/** Superseded, not yet handed out: arrival order, scoped by graph and question. */
export function foldedGraph(frames: readonly Frame[]): Set<Frame> {
  const last = new Map<string, Frame>();
  const folded = new Set<Frame>();
  for (const frame of frames) {
    const key = graphInboxKey(frame);
    if (key === null) continue;
    const was = last.get(key);
    if (was) folded.add(was);
    last.set(key, frame);
  }
  return folded;
}
