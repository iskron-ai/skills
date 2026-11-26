// The machine's return gate (graph @nks/nks-dev, node #11375): one per server in the daemon —
// one process for all the machine's seats. A lost MCP session (404 on its id after an mcp
// restart) used to reopen at once in every session: a volley of initialize and register as wide
// as the number of seats, not of machines. Now the first session that comes to return is the
// probe, one per machine; the others that meet 404 or come to return (a re-registration after a
// self-update, a plugin reload, a daemon handover) wait for its outcome. The probe returned —
// the waiting go at most two at a time; with more than two waiting each draws a random delay in
// a window that grows with their number (capped at 60 s). The probe met 502/503/504 or no
// connection — the down window (downwindow.ts) stands: the waiting do not knock, their calls
// answer «not sent», and the next probe goes by the window's ladder (its file lock). Nothing
// returns ahead of a call: only a call that needs its session back comes here. Every other
// upstream initialize the daemon opens (new thin bridges after a plugin reload, the
// orchestrator's own session) goes through the same gate as "open": at once without
// contention, at most two in flight with everything else. A bridge outside a daemon is a
// machine of its own: its gate holds only itself (README).
import { envName } from "../delivery/index.ts";
import { DownError } from "./errors.ts";
import { sleep } from "./store.ts";
import { log } from "./streams.ts";

const envMs = (name: string, dflt: number): number => {
  const v = Number(process.env[envName(name)]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
/** The window's growth per waiting session and its cap; the variables are for probes. */
const STEP_MS = envMs("BRIDGE_RETURN_STEP_MS", 1000);
const CAP_MS = envMs("BRIDGE_RETURN_CAP_MS", 60_000);
const AT_ONCE = 2;

interface Gate {
  /** The probe's outcome while it is out: null — answered; a DownError — the server is down. */
  probe: Promise<unknown> | null;
  /** Sessions waiting for the probe or their turn, of either kind. */
  waiting: number;
  /** Returns waiting or out: none — the next return to come is a probe. */
  returns: number;
  /** Knocks out now, of either kind, the probe's included: never more than AT_ONCE. */
  out: number;
  turns: (() => void)[];
}

const gates = new Map<string, Gate>();
const gateOf = (server: string): Gate => {
  let g = gates.get(server);
  if (!g) gates.set(server, (g = { probe: null, waiting: 0, returns: 0, out: 0, turns: [] }));
  return g;
};

/** A slot of the AT_ONCE: free — taken now; else in turn, handed over by the one that ends. */
async function turn(g: Gate): Promise<void> {
  if (g.out < AT_ONCE && !g.turns.length) return void g.out++;
  await new Promise<void>((r) => g.turns.push(r));
}

function done(g: Gate): void {
  const next = g.turns.shift();
  if (next)
    next(); // the slot passes on, counted still
  else g.out--;
}

async function knocked<T>(g: Gate, knock: () => Promise<T>): Promise<T> {
  try {
    return await knock();
  } finally {
    done(g);
  }
}

/**
 * `knock` through the gate. "return" — a session coming back (a reopen after 404, a replayed
 * handshake after a handover, a seat's re-registration): the first return to come when none is
 * waiting or out is the probe, and the other returns and opens wait for its outcome. "open" —
 * any other upstream initialize the daemon opens: never a probe; without contention (no probe,
 * nobody waiting, a free slot) it goes at once. All go at most two at a time; with more than
 * two waiting each draws its random delay.
 */
export async function throughGate<T>(
  server: string,
  knock: () => Promise<T>,
  kind: "return" | "open" = "return",
): Promise<T> {
  const g = gateOf(server);
  if (kind === "open" && !g.probe && g.waiting === 0 && g.out < AT_ONCE) {
    g.out++;
    return knocked(g, knock);
  }
  if (kind === "return" && !g.probe && g.returns === 0) {
    log("return gate: this session is the machine's probe");
    g.returns++;
    const run = turn(g).then(() => knocked(g, knock));
    g.probe = run.then(
      () => null,
      (e: unknown) => (e instanceof DownError ? e : null),
    );
    try {
      return await run;
    } finally {
      await g.probe;
      g.probe = null;
      g.returns--;
    }
  }
  if (kind === "return") g.returns++;
  try {
    g.waiting++;
    try {
      for (let p = g.probe; p; p = g.probe) {
        const down = await p;
        // The server is down: the window stands — no knock; the call answers «not sent».
        if (down instanceof DownError) throw down;
      }
      // A few behind the two in flight just take their turns; a crowd spreads over the window.
      if (g.waiting > AT_ONCE) {
        const window = Math.min(CAP_MS, STEP_MS * g.waiting);
        const wait = Math.floor(Math.random() * window);
        log(
          `return gate: ${g.waiting} waiting — this one goes in ${wait} ms (window ${window} ms)`,
        );
        await sleep(wait);
      }
      await turn(g);
    } finally {
      g.waiting--;
    }
    return await knocked(g, knock);
  } finally {
    if (kind === "return") g.returns--;
  }
}
