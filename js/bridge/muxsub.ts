// One seat channel's subscription on the dispatcher connection (graph @nks/nks-dev, node #8620):
// what the holder facade (muxhold.ts) and the router (muxroute.ts) share. The dedup window is the
// subscription's, not the connection's: a frame sent again in a new subscription after a break
// or a resubscribe is known by its id (the last 1000 ids of the channel).
import { type Frame, type Holder, type HoldOptions } from "../shared/channel.ts";
import { type TickEntry } from "./muxtick.ts";

const SEEN_MAX = 1000;

export interface Sub {
  secret: string;
  o: HoldOptions;
  /** The ref of the subscribe in flight on the current connection. */
  ref: string | null;
  /** From hello: the channel and the server's subscription id. */
  channel: string | null;
  sub: string | null;
  /** hello came on the current connection. */
  live: boolean;
  /** The holder let it go: unsubscribed or about to be. */
  closed: boolean;
  /** Seat ids of the channel from the last hello. */
  standings: string[];
  handing: { onFrame: (raw: string) => void; onGone: (code: number) => void } | null;
  /** No dispatcher: the holder holds its own socket now. */
  fallback: Holder | null;
  heardAt: number;
  tries: number;
  retry: ReturnType<typeof setTimeout> | null;
  seen: Set<string>;
  /**
   * Busy and usage lines given before hello (`url` — the address they were given for): into the
   * tact once hello names the seats; busy lines by POST if no dispatcher turns out to be there.
   */
  early: { url: string; standingId: string | null; fields: Pick<TickEntry, "status" | "usage"> }[];
}

export function newSub(secret: string, o: HoldOptions): Sub {
  return {
    secret,
    o,
    ref: null,
    channel: null,
    sub: null,
    live: false,
    closed: false,
    standings: [],
    handing: null,
    fallback: null,
    heardAt: 0,
    tries: 0,
    retry: null,
    seen: new Set(),
    early: [],
  };
}

/** True — the id is new to the subscription and is now remembered. */
export function firstSeen(s: Sub, id: string): boolean {
  if (s.seen.has(id)) return false;
  s.seen.add(id);
  if (s.seen.size > SEEN_MAX) s.seen.delete(s.seen.values().next().value as string);
  return true;
}

/** A frame of the subscription to its holder, once by its id; true — it carries a seq to ack. */
export function deliver(s: Sub, f: Frame): boolean {
  s.heardAt = Date.now();
  const id = typeof f.id === "string" ? f.id : "";
  if (!id || firstSeen(s, id)) {
    const seat = asSeatFrame(f);
    if (s.handing) s.handing.onFrame(seat.raw);
    else s.o.onFrame(seat.raw, seat.frame);
  }
  return typeof f.seq === "number";
}

/** Lines given before hello, now that hello named the channel and its seats. */
export function earlyLines(s: Sub, channel: string): TickEntry[] {
  return s.early.splice(0).flatMap(({ standingId, fields }) =>
    (standingId ? [standingId] : s.standings).map((id) => ({
      channel_id: channel,
      standing_id: id,
      ...fields,
    })),
  );
}

/** The frame as a seat's own socket gives it: the connection's labels stripped. */
export function asSeatFrame(f: Frame): { raw: string; frame: Frame } {
  const { channel_id: _c, sub: _s, seq: _q, ref: _r, ...rest } = f;
  return { raw: JSON.stringify(rest), frame: rest as Frame };
}

/** The secret of a seat address: the last segment of /channel/ws/<secret> or /channel/status/<secret>. */
export function secretOf(url: string): string | null {
  try {
    const m = /\/channel\/(?:ws|status)\/([^/?#]+)$/.exec(new URL(url).pathname);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}
