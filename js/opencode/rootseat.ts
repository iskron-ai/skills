// A root session of an aligned project seats itself before its first model request: the
// cover of its directory (shared/cover.ts) names the graph and the agent role, the session's
// own bridge returns the session's seat from disk or stands on the role (seatBy, from tools.ts),
// and the first prompt carries one line to the model — seated, or why not (rootseat-say.ts).
// A defective or absent cover — the word to align, and the root waits (rootseat-again.ts).
// Child sessions are not seated here (launch.ts); the contract and terms — rootseat-doors.ts.
//
// One seating per session (a memoized promise): only the first prompt starts it and
// waits for it — no longer than ROOT_SEAT_MS, then the request goes without a
// seat and the word says so; a seat taken after the term is told by the channel's path. Seatings
// of one instance go one at a time; fresh names carry independent random suffixes across instances.
// The queue bounds service work, not name allocation; a seating hung in the bridge holds the
// line no longer than its ceiling. Only proof from the serving bridge makes the seat
// provisional and promises replacement by an explicit stand in the same graph without take.
import { coverIn, createRealign, stamp } from "./rootseat-again.ts";
import {
  ceilingMs,
  pause,
  type RootSeatDoors,
  rootSeatEnabled,
  rootSeatMs,
  type RootSeats,
} from "./rootseat-doors.ts";
import { heldWord, lateWord, realignWord, refusedWord } from "./rootseat-say.ts";

export function createRootSeats(d: RootSeatDoors): RootSeats {
  type Told = { word: string | null; seated: boolean };
  type Attempt = { abort: AbortController; done: boolean; begun: boolean; promise: Promise<Told> };
  const seatings = new Map<string, Attempt>();
  const dead = new Set<string>();
  const told = new Set<string>();
  let stopped = false;
  let line: Promise<unknown> = Promise.resolve(); // one seating at a time in this instance
  const again = createRealign((s) => stopped || dead.has(s) || d.halted(s));
  const alive = (s: string, a: Attempt): boolean =>
    !stopped && !dead.has(s) && !d.halted(s) && seatings.get(s) === a;

  function start(session: string): Attempt {
    const known = seatings.get(session);
    if (known) return known;
    const no = (word: string | null): Told => ({ word, seated: false });
    const t: Attempt = {
      abort: new AbortController(),
      done: false,
      begun: false,
      promise: Promise.resolve(no(null)),
    };
    const cancelled = () => stopped || t.abort.signal.aborted || d.halted(session);
    seatings.set(session, t);
    const p = (async (): Promise<Told> => {
      const where = await d.directoryOf(session);
      if (cancelled() || !where) return no(null);
      const sig = stamp(where);
      const cover = coverIn(where);
      if (cover === null) return no(null);
      if ("why" in cover) {
        again.arm(session, where, cover.why, sig);
        return no(realignWord(cover.why));
      }
      const before = line;
      const turn = before.then(() => {
        if (cancelled()) return { cancelled: true } as const;
        t.begun = true;
        return d.seat(session, cover.realm, cover.karta, cancelled);
      });
      // A seating hung in the bridge holds the line no longer than its ceiling: the next goes.
      line = before.then(() => Promise.race([turn, pause(ceilingMs())])).catch(() => {});
      const r = await turn;
      if (cancelled() || "cancelled" in r) {
        if (t.begun) await d.release(session);
        return no(null);
      }
      if ("error" in r) return no(refusedWord(r.error));
      return { word: heldWord(r, cover.realm, cover.karta), seated: true };
    })()
      .catch(async (e: Error) => {
        if (cancelled()) {
          if (t.begun) await d.release(session);
          return no(null);
        }
        return no(refusedWord(e.message));
      })
      .finally(() => {
        t.done = true;
        if (t.begun) d.finished(session);
      });
    t.promise = p;
    return t;
  }

  /** The prompt waits for the seating no longer than its term; a later seat goes by the channel. */
  async function wait(session: string, seating: Attempt): Promise<string | null> {
    const ms = rootSeatMs();
    const aborted = new Promise<null>((r) =>
      seating.abort.signal.addEventListener("abort", () => r(null), { once: true }),
    );
    const first = await Promise.race([seating.promise, pause(ms).then(() => null), aborted]);
    if (stopped || dead.has(session) || seating.abort.signal.aborted || d.halted(session))
      return null;
    if (first) return first.word;
    // Seated after the term: the model has read "not seated"; the seat follows by the channel.
    void seating.promise.then((t) => {
      if (alive(session, seating) && t.seated && t.word) d.tell(session, t.word);
    });
    return lateWord(ms);
  }

  /** The waiting root's cover became unambiguous: the one seating starts anew. */
  function restart(session: string): Attempt {
    seatings.delete(session);
    return start(session);
  }

  return {
    async word(session) {
      if (!rootSeatEnabled() || stopped || dead.has(session)) return null;
      if (told.has(session)) {
        const next = again.check(session, true);
        if (!next) return null;
        if ("why" in next) return realignWord(next.why);
        return wait(session, restart(session));
      }
      told.add(session);
      if (d.halted(session)) return null;
      return wait(session, start(session));
    },
    aligning: (session) => again.has(session),
    touched() {
      if (!rootSeatEnabled() || stopped) return;
      for (const session of again.sessions()) {
        const next = again.check(session, false);
        if (!next) continue;
        if ("why" in next) {
          d.steer(session, realignWord(next.why));
          continue;
        }
        // Into the running turn, no new one: the session's next step reads where it stands.
        const seating = restart(session);
        void seating.promise.then((t) => {
          if (alive(session, seating) && t.word) d.steer(session, t.word);
        });
      }
    },
    forget(session) {
      dead.add(session);
      again.drop(session);
      d.cancel(session);
      seatings.get(session)?.abort.abort();
    },
    stop() {
      stopped = true;
      again.clear();
      for (const [s, t] of seatings)
        if (!t.done) {
          d.cancel(s);
          t.abort.abort();
        }
    },
  };
}
