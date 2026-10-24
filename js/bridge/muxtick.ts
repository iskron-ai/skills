// The daemon's batch tact (graph @nks/nks-dev, nodes #8623, #8617): pulse, busy line and usage
// of every seat on the dispatcher connection gather between tacts and leave as one tick frame
// per connection per interval, only what changed; an empty tact sends nothing. A seat leaving
// sends its last lines at once, in a frame of their own, before its unsubscribe.
import { envName } from "../delivery/index.ts";

/** The tact interval is the pulse gap of today (pulse.ts): one seam for both. */
export const GAP_MS = Number(process.env[envName("PULSE_GAP_MS")]) || 30_000;

export interface TickEntry {
  channel_id: string;
  /** Required on a channel of several seats; absent — the channel's one seat (#8620 v15). */
  standing_id?: string;
  pulse?: Record<string, unknown>;
  status?: string;
  usage?: Record<string, unknown>;
}

export interface Ticker {
  /** A change of one seat: merged with what waits for the tact. */
  put(e: TickEntry): void;
  /** The channel's waiting lines now, in a frame of their own (the seat leaves). */
  flushChannel(channel: string): void;
  /** The channel's waiting lines go nowhere (the subscription ended without a leave). */
  drop(channel: string): void;
  /** The channel's waiting lines out of the tact, to the caller (they wait for a new hello). */
  take(channel: string): TickEntry[];
}

/** `send` — the frame to the connection; false: not open now, the lines wait for the next tact. */
export function createTicker(
  send: (frame: { type: "tick"; entries: TickEntry[] }) => boolean,
): Ticker {
  const waiting = new Map<string, TickEntry>();
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const keyOf = (e: Pick<TickEntry, "channel_id" | "standing_id">): string =>
    `${e.channel_id}\n${e.standing_id ?? ""}`;

  function schedule(): void {
    if (timer || !waiting.size) return;
    timer = setTimeout(tact, Math.max(0, lastAt + GAP_MS - Date.now()));
    timer.unref?.();
  }

  function tact(): void {
    timer = null;
    if (!waiting.size) return;
    const entries = [...waiting.values()];
    lastAt = Date.now();
    if (send({ type: "tick", entries })) waiting.clear();
    schedule();
  }

  const ofChannel = (channel: string): [string, TickEntry][] =>
    [...waiting].filter(([, e]) => e.channel_id === channel);
  const take = (channel: string): TickEntry[] => {
    const mine = ofChannel(channel);
    for (const [k] of mine) waiting.delete(k);
    return mine.map(([, e]) => e);
  };

  return {
    put(e) {
      const k = keyOf(e);
      waiting.set(k, { ...waiting.get(k), ...e });
      schedule();
    },
    flushChannel(channel) {
      const mine = ofChannel(channel);
      if (!mine.length) return;
      if (send({ type: "tick", entries: mine.map(([, e]) => e) }))
        for (const [k] of mine) waiting.delete(k);
    },
    drop: (channel) => void take(channel),
    take,
  };
}
