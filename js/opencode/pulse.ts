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

/**
 * Per session. Taken before the channel's answer is mostly the session's own prompts, never
 * answered by the channel: past TAKEN_MAX the oldest goes. Laid and not taken yet is awaited and
 * never pushed out: past QUEUED_MAX it is only told.
 */
const TAKEN_MAX = 100;
const QUEUED_MAX = 100;

export function createPulseFeed(opts: {
  /** The bridge holding the session's own seat; null — no seat, nowhere to send. */
  bridgeOf: (session: string) => Bridge | null;
  /** The session holds more inbox items laid by the channel and not taken than QUEUED_MAX. */
  overflow?: (session: string, waiting: number) => void;
}): PulseFeed {
  const words = new Map<string, Word>();
  // session → inbox ids: laid by the channel, not taken yet; taken before the channel's answer
  const queued = new Map<string, Set<string>>();
  const taken = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, session: string, inbox: string): Set<string> => {
    const ids = m.get(session) ?? new Set<string>();
    m.set(session, ids.add(inbox));
    return ids;
  };
  /** True — the inbox id was the session's and is gone now. */
  const drop = (m: Map<string, Set<string>>, session: string, inbox: string): boolean => {
    const ids = m.get(session);
    if (!ids?.delete(inbox)) return false;
    if (!ids.size) m.delete(session);
    return true;
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
          if (drop(queued, session, inbox)) return tell(session, { read_at: at() });
          const ids = add(taken, session, inbox);
          if (ids.size > TAKEN_MAX) drop(taken, session, ids.values().next().value as string);
          return;
        }
      }
    },
    prompted(session, inbox): void {
      if (!inbox) return;
      if (drop(taken, session, inbox)) return tell(session, { read_at: at() });
      const waiting = add(queued, session, inbox).size;
      if (waiting === QUEUED_MAX + 1) opts.overflow?.(session, waiting);
    },
    seated(session): void {
      if (!words.has(session)) return;
      unsent.add(session);
      tell(session, {});
    },
    forget(session): void {
      words.delete(session);
      unsent.delete(session);
      queued.delete(session);
      taken.delete(session);
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
