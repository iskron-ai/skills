// A seat's channel held through the daemon's dispatcher connection (graph @nks/nks-dev, nodes
// #8620, #8622, #8623): the same Holder a socket per seat gives (../shared/channel.ts), so the
// holding (hold.ts) does not tell the paths apart. Without a dispatcher — the socket per seat,
// as before, until the process restarts. Process-wide: one connection per api for all sessions.
import { type Holder, type HoldOptions, holdSocket } from "../shared/channel.ts";
import { muxUrlOf } from "./muxprobe.ts";
import { createMux, type Mux } from "./muxroute.ts";
import { newSub, secretOf, type Sub } from "./muxsub.ts";
import { type TickEntry } from "./muxtick.ts";

const muxes = new Map<string, Mux>();

function muxOf(url: string): Mux {
  let m = muxes.get(url);
  if (!m) muxes.set(url, (m = createMux(url)));
  return m;
}

/**
 * A pulse frame the holding sends goes into the tact. The pulse is the channel's (pulse.ts):
 * the line names the first seat hello named on it.
 */
function pulseFrom(m: Mux, s: Sub, text: string): boolean {
  if (!s.live || !s.channel) return false;
  let f: Record<string, unknown>;
  try {
    f = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return false;
  }
  if (f?.type !== "pulse") return false;
  const standing = s.standings[0];
  if (!standing) return false;
  const { type: _t, ...pulse } = f;
  m.ticker.put({ channel_id: s.channel, standing_id: standing, pulse });
  return true;
}

/** Hold the seat channel of `o.url`: a subscription, or the socket per seat without a dispatcher. */
export function holdChannel(o: HoldOptions): Holder {
  const secret = secretOf(o.url);
  const m = secret ? muxOf(muxUrlOf(o.url)) : null;
  if (!secret || !m || m.link.fallen) return holdSocket(o);
  const s = newSub(secret, o);
  m.add(s);
  return {
    close: (reason) => (s.fallback ? s.fallback.close(reason) : m.release(s)),
    handOff(onFrame, onGone) {
      if (s.fallback) return s.fallback.handOff(onFrame, onGone);
      if (s.live && !s.closed) return void (s.handing = { onFrame, onGone });
      m.release(s);
      onGone(0);
    },
    send: (text) => (s.fallback ? s.fallback.send(text) : pulseFrom(m, s, text)),
    get alive() {
      return s.fallback ? s.fallback.alive : !s.closed;
    },
    get heardAt() {
      return s.fallback ? s.fallback.heardAt : s.heardAt;
    },
  };
}

const at = (url: string | null): { m: Mux; secret: string } | null => {
  const secret = url ? secretOf(url) : null;
  const m = url && secret ? muxes.get(muxUrlOf(url)) : undefined;
  return m && secret ? { m, secret } : null;
};

/**
 * Lines of seats on a channel the dispatcher carries (`url` — its socket or status address) go
 * into the tact instead of a POST: true — taken. `standingId` null — every seat hello named on
 * the channel; before hello they wait in the subscription.
 */
export function tickFor(
  url: string | null,
  standingId: string | null,
  fields: Pick<TickEntry, "status" | "usage">,
): boolean {
  const h = at(url);
  const s = h?.m.heldOf(h.secret);
  if (!h || !s) return false;
  if (!s.live || !s.channel) return (s.early.push({ standingId, fields }), true);
  const seats = standingId ? [standingId] : s.standings;
  if (!seats.length) return false;
  for (const id of seats) h.m.ticker.put({ channel_id: s.channel, standing_id: id, ...fields });
  return true;
}

/** The channel of this address goes through the dispatcher: its busy line is never POSTed. */
export const onDispatcher = (url: string | null): boolean => {
  const h = at(url);
  return !!h && h.m.carries(h.secret);
};

/**
 * How a leaving seat's cleared busy line goes (graph @nks/nks-dev, node #8620 v11): "tick" —
 * into the tact now, sent before the unsubscribe; "post" — a socket per seat, as before;
 * "none" — the dispatcher's channel with no live subscription: the line stays till the pulse runs out.
 */
export function leavingLine(url: string): "tick" | "post" | "none" {
  if (!onDispatcher(url)) return "post";
  return liveOnDispatcher(url) && tickFor(url, null, { status: "" }) ? "tick" : "none";
}

/** A live subscription carries the channel of this address now. */
export const liveOnDispatcher = (url: string): boolean => {
  const h = at(url);
  return !!h && h.m.carries(h.secret) && !!h.m.liveOf(h.secret);
};

/** Every let-go subscription confirmed, or `ms` passed: the process may exit. */
export const released = (ms: number): Promise<unknown> =>
  Promise.all([...muxes.values()].map((m) => m.settled(ms)));
