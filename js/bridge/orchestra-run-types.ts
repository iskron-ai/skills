import type { ModelRef } from "./exec-spec.ts";
import type { RunTree } from "./orchestra-tree-types.ts";

export type RunState =
  | "preparing"
  | "ambiguity"
  | "launched"
  | "raised"
  | "stopping"
  | "dormant"
  | "ended"
  | "refused"
  | "no_seat";
export interface Run {
  /** The sleep of a cleanly exited dsh run (#10995): since when, the case journal cursor, and
   * what a word in the case must name to wake the continuation. */
  dormant?: {
    since: string;
    cursor: number | null;
    /** The standing ids the call's seat had — the first and each after a continuation. */
    seats?: string[];
    /** The invited role's karta node UUID, from the invite entry of the same journal. */
    karta?: string;
    /** The seat's own asks — entry number → the ask author's standing id; an answer to one wakes. */
    asks?: Record<string, string>;
  };
  tree?: RunTree;
  exec?: {
    attempt: string;
    receipt: string;
    server: string;
    model: ModelRef;
    session?: string;
    incarnation?: string;
    /** Observed exact-client exit, not proof of durable halt. */
    exit?: string;
  };
  /** A dsh process the bridge started itself (#10777): its pid, its event file, what it said. */
  dsh?: {
    pid: number;
    events: string;
    /** This run's model overlay: its path in the command line proves the pid ours. */
    model?: string;
    session?: string;
    /** The `final` event's reason kind. */
    final?: string;
    /** Observed exit: its code, or "unknown" when not proven ours after a restart. */
    exit?: string;
    terminated?: string;
  };
  realm: string;
  room: string;
  invite: number;
  karta: number;
  launcher: string;
  harness: string;
  model: string;
  repository: string;
  worktree: string;
  terminal?: string;
  runtime?: string;
  /** The launch answer's prompt words (#9966): delivery "submit" with outcome
   * "handed-to-terminal" is the only observed proof the brief was handed over. */
  prompt?: { delivery: string; outcome: string };
  /** The launch answer's receipt words (#9966), a safe short projection. */
  receipt?: { mode: string; reason: string };
  closed?: string;
  /** The ids of the run's own stop orders — the call's exit stop and every continuation's.
   * An order naming the seat outside this list is someone else's (#10995 review 4). */
  orders?: string[];
  /** A foreign stop order on the call's seat, set at its FIRST reading and never erased —
   * not by re-reads, not by a continuation's rollback, not by the registry merge. While it
   * stands there is no sleep and no continuation: the run ends (#10995 review 5). */
  foreign_stop?: { id: string; state: string; at: string };
  state: RunState;
  at: string;
  why?: string;
  standing_id?: string;
  n?: number;
  rooms?: number;
  sat?: boolean;
  /** The platform's idle_due for this seat stands, not yet followed by any other signal (#6010). */
  idle_due?: boolean;
  order_id?: string;
  stopping_at?: string;
  stop_outcome?: string;
  /** A failed order after the exact terminal exited was replaced once by the exit stop. */
  restop?: boolean;
}
