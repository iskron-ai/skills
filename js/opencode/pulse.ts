// An OpenCode session's word on its turn for the seat's pulse (graph @nks/nks-dev, node #7529):
// state from service events — session.status busy/idle, session.execution.succeeded, failed and
// interrupted; turn_at — when a turn ended; read_at — when a frame the channel laid into the
// session entered a turn as text: on session.inbox.delivered of its inbox item, a steer too — it
// waits for the running tool to return (#5048). Each change goes to the session's bridge by
// method("pulse"); the bridge paces the socket. The last word is kept: a seat taken or returned
// gets it at once (seated), so a turn heard before the seat is not lost.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { method } from "../delivery/index.ts";
import { type Bridge } from "../shared/bridge-client.ts";

type State = "idle" | "busy" | "interrupted" | "failed";

interface Word {
  state?: State;
  turn_at?: string;
  read_at?: string;
}

export interface PulseFeed {
  onEvent: (ev: any) => void;
  /** The channel laid a frame into the session: read when OpenCode takes its inbox item, steer or queue. */
  prompted: (session: string, inbox: string | null) => void;
  /** The session's bridge took or returned its seat: the last word goes to it now. */
  seated: (session: string) => void;
  forget: (session: string) => void;
  stop: () => void;
}

const ENDS = new Map<unknown, State>([
  ["session.execution.succeeded", "idle"],
  ["session.execution.failed", "failed"],
  ["session.execution.interrupted", "interrupted"],
]);

export function createPulseFeed(opts: {
  /** The bridge holding the session's own seat; null — no seat, nowhere to send. */
  bridgeOf: (session: string) => Bridge | null;
}): PulseFeed {
  const words = new Map<string, Word>();
  const queued = new Map<string, string>(); // inbox id → session: laid by the channel, not taken yet
  const taken = new Map<string, string>(); // inbox id → session: taken before the channel's answer
  const keep = (m: Map<string, string>, inbox: string, session: string): void => {
    m.set(inbox, session);
    for (const old of m.keys()) if (m.size > 100) m.delete(old);
  };
  const unsent = new Set<string>();
  let stopped = false;

  const tell = (session: string, change: Word): void => {
    if (stopped) return;
    const was = words.get(session) ?? {};
    const now = { ...was, ...change };
    if (JSON.stringify(now) === JSON.stringify(was) && !unsent.has(session)) return;
    words.set(session, now);
    const bridge = opts.bridgeOf(session);
    // No seat yet: the word goes with the next event once a bridge holds one.
    if (!bridge) return void unsent.add(session);
    unsent.delete(session);
    void bridge.request(method("pulse"), now, { timeoutMs: 5_000 }).catch(() => {});
  };
  const at = (): string => new Date().toISOString();
  /** A turn's end: the busy turn becomes `to`; an end already told keeps its state; idle with no turn seen — no turn_at. */
  const ended = (session: string, to: State): void => {
    const was = words.get(session)?.state;
    if (to === "idle" && was !== "busy")
      return was === undefined ? tell(session, { state: "idle" }) : undefined;
    tell(session, { state: to, turn_at: at() });
  };

  return {
    onEvent(ev: any): void {
      const session: unknown = ev?.data?.sessionID;
      if (typeof session !== "string") return;
      const type: unknown = ev?.type;
      const end = ENDS.get(type);
      if (end) return ended(session, end);
      switch (type) {
        case "session.status": {
          const s: unknown = ev.data?.status?.type;
          if (typeof s !== "string") return;
          if (s === "idle") ended(session, "idle");
          else tell(session, { state: "busy" });
          return;
        }
        case "session.idle":
          return ended(session, "idle");
        case "session.inbox.delivered": {
          const inbox: unknown = ev.data?.inboxID;
          if (typeof inbox !== "string") return;
          // The taking may outrun the prompt's answer: remembered, judged when the answer comes.
          if (queued.get(inbox) !== session) return keep(taken, inbox, session);
          queued.delete(inbox);
          return tell(session, { read_at: at() });
        }
      }
    },
    prompted(session, inbox): void {
      if (!inbox) return;
      if (taken.get(inbox) === session) {
        taken.delete(inbox);
        return tell(session, { read_at: at() });
      }
      keep(queued, inbox, session);
    },
    seated(session): void {
      if (!words.has(session)) return;
      unsent.add(session);
      tell(session, {});
    },
    forget(session): void {
      words.delete(session);
      unsent.delete(session);
      for (const m of [queued, taken])
        for (const [inbox, s] of m) if (s === session) m.delete(inbox);
    },
    stop(): void {
      stopped = true;
      words.clear();
      queued.clear();
      taken.clear();
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
