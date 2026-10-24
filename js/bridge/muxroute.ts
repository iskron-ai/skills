// Frames of the dispatcher connection to the sessions of the daemon (graph @nks/nks-dev, nodes
// #8622, #8616, #8621): a subscription per seat channel, the table channel_id → the session
// holding it; a frame goes to that session only and is acked {channel_id, sub, seq}, a repeat
// of its id is acked and goes to no one; a frame without a channel — the journal, no one.
import { type Frame, holdSocket } from "../shared/channel.ts";
import { type FrameRoutes, routeFrame } from "./muxframe.ts";
import { createLink, type Link } from "./muxlink.ts";
import { pauseOf } from "./muxprobe.ts";
import { asSeatFrame, deliver, earlyLines, type Sub } from "./muxsub.ts";
import { createTable, type SubTable } from "./muxtable.ts";
import { createTicker, type Ticker } from "./muxtick.ts";
import { log } from "./streams.ts";

const DEAD_SECRET = new Set(["secret_invalid", "secret_dead"]);
const REVOKED = 4004; // channel_closed of a revoked seat

export interface Mux extends Pick<SubTable, "liveOf" | "heldOf" | "settled"> {
  readonly link: Link;
  readonly ticker: Ticker;
  add(s: Sub): void;
  /** The holder lets the subscription go: its leaving lines in one tick, then unsubscribe. */
  release(s: Sub): void;
  /** The secret's channel goes through the dispatcher, not a socket per seat. */
  carries(secret: string): boolean;
}

export function createMux(url: string): Mux {
  const table = createTable();
  const { subs, byRef, byChannel, onSockets, active } = table;
  let refs = 0;
  const link: Link = createLink(url, {
    wanted: () => active().length > 0,
    onOpen: () => active().forEach(subscribe),
    onMessage: (raw) => routeFrame(raw, routes),
    onDrop,
    onHung: (text) => active().forEach((s) => (s.o.onHung ?? s.o.onNote)?.(text)),
    onFallback: () => [...subs].forEach(toSocket),
  });
  const ticker = createTicker((tick) => link.send(tick));

  function subscribe(s: Sub): void {
    if (s.retry) clearTimeout(s.retry);
    s.retry = null;
    if (s.closed || s.fallback) return;
    if (!link.open) return link.connect();
    s.ref = `r${++refs}`;
    byRef.set(s.ref, s);
    link.send({ type: "subscribe", secret: s.secret, ref: s.ref });
  }

  function toSocket(s: Sub): void {
    subs.delete(s);
    if (s.handing) return end(s, () => s.handing?.onGone(0));
    onSockets.add(s.secret);
    if (!s.closed) s.fallback = holdSocket(s.o);
  }

  /** The subscription is over: `word` tells the holder why (nothing — its own release). */
  function end(s: Sub, word?: () => void): void {
    Object.assign(s, { closed: true, live: false });
    subs.delete(s);
    if (s.channel && byChannel.get(s.channel) === s) byChannel.delete(s.channel);
    if (s.retry) clearTimeout(s.retry);
    if (s.channel) ticker.drop(s.channel); // its leaving lines went before the unsubscribe
    word?.();
    s.handing = null;
    if (!active().length) link.idle();
  }

  function again(s: Sub): void {
    s.live = false;
    s.o.onDropped?.();
    s.retry = setTimeout(() => subscribe(s), pauseOf(s.tries++));
  }

  function onDrop(): void {
    byRef.clear();
    byChannel.clear();
    for (const s of [...subs]) {
      if (s.handing) end(s, () => s.handing?.onGone(1006));
      else if (s.closed) subs.delete(s);
      else {
        if (s.live) s.o.onDropped?.();
        Object.assign(s, { live: false, ref: null });
      }
    }
  }

  function hello(s: Sub, f: Frame): void {
    const channel = String(f.channel_id);
    Object.assign(s, { channel, sub: String(f.sub), heardAt: Date.now() });
    byChannel.set(channel, s);
    if (s.closed) return void link.send({ type: "unsubscribe", channel_id: channel });
    const standings = (f.standings ?? []).map((x) => x.standing_id ?? "").filter(Boolean);
    Object.assign(s, { live: true, tries: 0, standings });
    earlyLines(s, channel).forEach(ticker.put);
    link.proven(Number(f.ping_interval_seconds) * 1000);
    const seat = asSeatFrame(f);
    s.o.onFrame(seat.raw, seat.frame);
  }

  function refused(s: Sub, code: string): void {
    if (s.closed) return end(s);
    if (DEAD_SECRET.has(code)) return end(s, () => s.o.onDeadToken(4002));
    if (code === "limit_subscriptions") return toSocket(s);
    log(`dispatcher: subscription refused (${code}) — again later`);
    again(s);
  }

  // By class (#8620 v13): 1000 — own unsubscribe answered; 4000 — another holds it; 4004 — the
  // seat revoked, the stop. Any other code, an unasked 1000 too — subscribed again (dead: secret_dead).
  function closed(s: Sub, code: number, reason: string): void {
    if (s.closed) return end(s);
    if (s.handing) return end(s, () => s.handing?.onGone(code));
    if (code === 4000) return end(s, () => (s.o.onEvicted ?? s.o.onDeadToken)(code));
    if (code === REVOKED) return end(s, () => s.o.onStopped(code, reason));
    log(`dispatcher: ${s.channel} closed with ${code} (${reason}) — subscribed again`);
    byChannel.delete(s.channel ?? "");
    again(s);
  }

  function frame(s: Sub, f: Frame, channel: string): void {
    if (deliver(s, f)) link.send({ type: "ack", channel_id: channel, sub: f.sub, seq: f.seq });
  }

  const routes: FrameRoutes = { byRef, byChannel, hello, refused, closed, frame };

  return {
    link,
    ticker,
    add(s) {
      onSockets.delete(s.secret);
      subs.add(s);
      subscribe(s);
    },
    release(s) {
      if (s.closed) return;
      s.closed = true;
      if (s.live && s.channel) {
        ticker.flushChannel(s.channel);
        link.send({ type: "unsubscribe", channel_id: s.channel });
      }
      if (!s.live && !(s.ref && byRef.has(s.ref))) end(s);
      else if (!active().length) link.idle();
    },
    liveOf: table.liveOf,
    heldOf: table.heldOf,
    settled: table.settled,
    carries: (secret) => !link.fallen && !onSockets.has(secret),
  };
}
