// The word after the turn in a dsh session (graph @nks/nks-dev, node #11071): the wake word and a
// frame reach the root agent as a new message in every form. Headless exits at its first idle
// with no children (dsh-headless/lib/index.js:369-383, 0.2.2-rc.1), and a word sent after that
// never lands (observed live: aborted/disposed and exit 1, or lost silently). So in headless the
// root's idle (agent/status idle) is taken, in the same synchronous call, by a maintenance task
// (agent.runMaintenance — dsh-agent-loop/lib/index.js:586-609; the contract in
// dsh-agent/lib/types/runtime-types.d.ts:192-201): headless waits for it (whenIdle follows the
// task); a followup from inside it is latched and opens the next turn once the task settles
// (index.js:634-639, 656-662; observed live: turn 2, final completed, exit 0). The task ends at
// the first of: a word to send (it leaves as followup), the hold window, the signal's abort (a
// SIGTERM — then nothing is sent). Out of headless there is no task — it would hold a human's
// input; the wake word goes at the root's idle, when a followup opens a driver of its own.
/* eslint-disable @typescript-eslint/no-explicit-any -- the dsh agent without a schema */
import { envName } from "../delivery/index.ts";
import { type DshAgent } from "./hearing.ts";
import { afterPublish } from "./publish.ts";

/** How long a headless idle is held for a word; the env DSH_HOLD_MS — the probes' seam. */
export const HOLD_MS = 60_000;
const windowMs = (): number => Number(process.env[envName("DSH_HOLD_MS")]) || HOLD_MS;

export interface Hold {
  /** While a task holds the idle: the message leaves through it; else null. */
  through(message: unknown): Promise<void> | null;
  /** The turn's end chose the wake word: through the task, or at the next idle. */
  wake(message: unknown): void;
  /** A turn started: a wake word chosen for an earlier turn is moot. */
  turnStarted(): void;
  /** The root went idle; hold — headless, and the ear is attached or waits for its seat. */
  idle(raw: any, a: DshAgent, headless: boolean, live: boolean): void;
  /** The session is gone: the task ends without a word. */
  end(): void;
}

export function createHold(log: (why: string) => void): Hold {
  let task: { take(m: unknown): Promise<void>; stop(): void } | null = null;
  let wake: unknown = null;
  const loud = (p: Promise<void>): void => void p.catch((e: Error) => log(e.message));

  const run = (a: DshAgent, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        if (task === own) task = null;
        resolve();
      };
      const timer = setTimeout(finish, windowMs());
      const own = {
        take(m: unknown): Promise<void> {
          task = null; // a later word goes straight in: latched behind this task
          clearTimeout(timer);
          const sent = afterPublish(a, m, signal);
          void sent.then(finish, finish);
          return sent;
        },
        stop: finish,
      };
      task = own;
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) return finish();
      const m = wake;
      wake = null;
      if (m) loud(own.take(m));
    });

  return {
    through: (m) => task?.take(m) ?? null,
    wake(m) {
      if (task) loud(task.take(m));
      else wake = m;
    },
    turnStarted() {
      wake = null;
    },
    idle(raw, a, headless, live) {
      const m = wake;
      if (task || (!m && !(headless && live))) return;
      if (headless && typeof raw?.runMaintenance === "function")
        try {
          void Promise.resolve(raw.runMaintenance((s: AbortSignal) => run(a, s))).catch(() => {});
          return;
        } catch (e) {
          log((e as Error).message); // another task owns the agent: the word goes straight in
        }
      wake = null;
      if (m) loud(afterPublish(a, m));
    },
    end() {
      task?.stop();
      task = null;
      wake = null;
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
