// The interrupt of a stopped session's turn (graph @nks/nks-dev, nodes #7439, #7440, #7519),
// and how it ended: the bridge's stop order waits for that — stopped is the executed interrupt,
// a refusal is failed with its code. A cut belongs to the stops over the session's chain
// (halts.ts stopOf): a new stop of the session or of any ancestor cuts it anew.

import { method } from "../delivery/index.ts";
import { type Bridge } from "../shared/bridge-client.ts";

/** null — the turn is cut; a code — the interrupt was refused or is impossible. */
export type CutOutcome = string | null;

/** How long the bridge is given to take the stop's outcome. */
const HALTED_MS = 10_000;

/**
 * A "stopped" event of a stop order (`order` — its id): once the interrupt of the session and its
 * descendants ended, the bridge that said it hears method("halted") {order, ok, code?}.
 */
export function answerHalt(
  bridge: Bridge | null,
  ev: { order?: unknown } | undefined,
  outcome: () => Promise<CutOutcome>,
): void {
  const order = ev?.order;
  if (typeof order !== "string") return;
  void outcome().then((code) =>
    bridge
      ?.request(
        method("halted"),
        { order, ok: code === null, ...(code ? { code } : {}) },
        { timeoutMs: HALTED_MS, service: true },
      )
      .catch(() => {}),
  );
}

/** How many times a stop's refused interrupt is tried, and how long apart. */
const CUT_TRIES = 3;
const CUT_RETRY_MS = 500;

export interface CutDeps {
  stopOf: (id: string) => string | null;
  halted: (id: string) => boolean;
  /** OpenCode's interrupt of the session's turn, if the host has one. */
  canInterrupt: () => boolean;
  interrupt: (id: string) => Promise<unknown>;
  /** What the cut drops besides the turn: piles, the waiting tact. */
  dropped: (id: string) => void;
  /** An interrupt refused; `last` — no more tries. */
  refused: (id: string, why: string, last: boolean) => void;
}

export function createCuts(d: CutDeps) {
  const cutDone = new Map<string, string>(); // the stops whose turn is cut
  const cutting = new Map<string, string>(); // the stops whose interrupt is in flight
  const cutFails = new Map<string, [string, number]>(); // refused interrupts of those stops
  const retries = new Set<ReturnType<typeof setTimeout>>();
  const outcomes = new Map<string, [string, CutOutcome]>();
  const waiters = new Map<string, Set<() => void>>();

  const wake = (id: string): void => {
    const set = waiters.get(id);
    waiters.delete(id);
    for (const w of set ?? []) w();
  };

  /**
   * A stopped session's running turn is interrupted, its piles and waiting tact are dropped — once
   * per stop. A refused interrupt is tried again, by a timer and by the next halt, up to CUT_TRIES.
   * An interrupt answers only for its own stop: a stop after a held while the previous stop's
   * interrupt is in flight gets its own interrupt right after it.
   * Prompts OpenCode already took into the session's inbox stay there: the plugin's session domain
   * has no inbox.cancel (@opencode/plugin 2.0.4 through 2.0.28, only the full client has it).
   */
  function cut(id: string): void {
    const gen = d.stopOf(id);
    if (gen === null || cutDone.get(id) === gen || cutting.get(id) === gen) return;
    d.dropped(id);
    if (cutting.has(id)) return; // the previous stop's interrupt is in flight: this one follows it
    const settle = (code: CutOutcome): void => {
      cutDone.set(id, gen);
      outcomes.set(id, [gen, code]);
      wake(id);
    };
    if (!d.canInterrupt()) return settle("interrupt_missing");
    cutting.set(id, gen);
    void Promise.resolve()
      .then(() => d.interrupt(id))
      .then(
        () => {
          if (d.stopOf(id) !== gen) return;
          settle(null);
          cutFails.delete(id);
        },
        (e: Error) => {
          if (d.stopOf(id) !== gen) return;
          const was = cutFails.get(id);
          const n = (was?.[0] === gen ? was[1] : 0) + 1;
          cutFails.set(id, [gen, n]);
          d.refused(id, e.message, n >= CUT_TRIES);
          if (n >= CUT_TRIES) return settle("interrupt_refused");
          const t = setTimeout(() => {
            retries.delete(t);
            if (d.halted(id)) cut(id);
          }, CUT_RETRY_MS);
          (t as { unref?: () => void }).unref?.();
          retries.add(t);
        },
      )
      .finally(() => {
        cutting.delete(id);
        if (d.stopOf(id) !== gen) cut(id);
      });
  }

  /** The outcome of the session's cut for its current stop; a session not stopped is cut. */
  function outcomeOf(id: string): Promise<CutOutcome> {
    const gen = d.stopOf(id);
    const o = outcomes.get(id);
    if (gen === null) return Promise.resolve(null);
    if (o?.[0] === gen) return Promise.resolve(o[1]);
    return new Promise((done) => {
      const set = waiters.get(id) ?? new Set();
      set.add(() => void outcomeOf(id).then(done));
      waiters.set(id, set);
    });
  }

  return {
    cut,
    /** The first refusal among the sessions' cuts, once all ended; null — all cut. */
    async outcome(ids: string[]): Promise<CutOutcome> {
      const all = await Promise.all(ids.map(outcomeOf));
      return all.find((c) => c !== null) ?? null;
    },
    /** The session is gone or stands again: its marks go, whoever waits reads it anew. */
    forget(id: string): void {
      cutDone.delete(id);
      cutFails.delete(id);
      outcomes.delete(id);
      wake(id);
    },
    stop(): void {
      for (const t of retries) clearTimeout(t);
      retries.clear();
    },
  };
}
