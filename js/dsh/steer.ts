// Where a word the hearing lays goes in a dsh session (graph @nks/nks-dev, nodes #10776, #11071).
// Observed live on LAB (#8419, 0.2.2-rc.1, glm-5.3): a continued session's stale word, laid as a
// next-turn message while turn 2 already ran from the task, became a message only at turn 3,
// minutes later, after the model had gone through its whole Start. So a word that comes while the
// root is in a turn goes into that turn: steer — send(next-step, wake), consumed at the turn's
// next step boundary (dsh-agent-loop lib/index.js:573-575, 797-798; contract
// dsh-agent/lib/types/runtime-types.d.ts steer). Observed live: agent/pre-step plus steer gives
// step 2 of the same turn, and the model sees it; inject does not wake — not used. At idle it
// stays a followup (hold.ts keeps headless alive for it).
//
// The root's first step: its inbox is claimed before the prompt's assembly
// (lib/index.js:670, before 685), so a steer after the claim lands only at step 2. Until the
// root's first agent/pre-step (a waterfall whose decision replaces the messages that enter the
// step — runtime-types.d.ts:321-339; payload.agent fused by dsh-agent lib/index.js:358-387) the
// words are held and join that step's messages; a continued session whose seat the plugin took
// waits there, within a short window, for its hearing to attach and give what waited for it.
/* eslint-disable @typescript-eslint/no-explicit-any -- dsh SDK objects without a schema */
import { envName } from "../delivery/index.ts";

/** The first step's wait for the hearing; the env DSH_FIRST_MS — the probes' seam. */
export const FIRST_MS = 6_000;
/** After the hearing attached: the bridge's stale and wake batches close in 1.5 s. */
const QUIET_MS = 2_000;
const LOOK_MS = 50;
const capMs = (): number => Number(process.env[envName("DSH_FIRST_MS")]) || FIRST_MS;

/** A word to the live root: steered into the running turn, else a followup turn. */
export function toTurn(raw: any, followup: (m: unknown) => unknown, m: unknown): unknown {
  if (raw?.status === "running" && typeof raw.steer === "function") return raw.steer(m);
  return followup(m);
}

interface Held {
  m: unknown;
  done: () => void;
}

export interface FirstStep {
  /** The root's fresh agent: words wait for its first step. */
  begin(agent: any): void;
  /** A word before the first step of a running root: held for it; else null. */
  take(m: unknown, running: boolean): Promise<void> | null;
  /** The root's agent/pre-step; wait — the first one waits for the hearing within the window. */
  preStep(
    payload: any,
    next: () => Promise<any>,
    wait: boolean,
    attached: () => boolean,
  ): Promise<any>;
  end(): void;
}

/** route — where a word goes once the first step is gone (toTurn and the hold). */
export function createFirstStep(route: (m: unknown) => unknown): FirstStep {
  let gate: { agent: any; held: Held[]; wake: () => void } | null = null;
  const pass = (h: Held): void => {
    void Promise.resolve(route(h.m)).then(h.done, h.done);
  };

  return {
    begin(agent) {
      gate = { agent, held: [], wake: () => undefined };
    },
    take(m, running) {
      const g = gate;
      if (!g || !running) return null; // an idle root: the word opens its own turn
      return new Promise((done) => {
        const h = { m, done };
        g.held.push(h);
        g.wake();
        // No first step within the window: the word goes its usual way.
        setTimeout(() => {
          const i = g.held.indexOf(h);
          if (i >= 0) pass(g.held.splice(i, 1)[0] as Held);
        }, capMs()).unref?.();
      });
    },
    async preStep(payload, next, wait, attached) {
      const g = gate;
      if (!g || payload?.agent !== g.agent) return next();
      const end = Date.now() + capMs();
      const quiet = Math.min(QUIET_MS, capMs() / 3);
      let since: number | null = null;
      while (wait && !g.held.length && !payload?.signal?.aborted && Date.now() < end) {
        if (attached()) since ??= Date.now();
        if (since !== null && Date.now() - since >= quiet) break;
        await new Promise<void>((r) => {
          g.wake = r;
          setTimeout(r, LOOK_MS).unref?.();
        });
      }
      gate = null; // later words go into the turn as it runs
      const held = g.held.splice(0);
      let d: any;
      try {
        d = await next();
      } catch (e) {
        held.forEach(pass);
        throw e;
      }
      if (!held.length || d?.kind !== "enter" || !Array.isArray(d.messages)) {
        held.forEach(pass);
        return d;
      }
      const msgs = d.messages as any[];
      const at = msgs.findIndex((x) => x?.source?.kind === "runtime-context");
      const cut = at < 0 ? msgs.length : at;
      const words = held.map((h) => h.m);
      held.forEach((h) => h.done());
      return { ...d, messages: [...msgs.slice(0, cut), ...words, ...msgs.slice(cut)] };
    },
    end() {
      gate = null;
    },
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */
