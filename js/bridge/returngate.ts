// The machine's return gate (graph @nks/nks-dev, node #11375): one per server in the daemon —
// one process for all the machine's seats. A lost MCP session (404 on its id after an mcp
// restart) used to reopen at once in every session: a volley of initialize and register as wide
// as the number of seats, not of machines. Now the first session that comes to return is the
// probe, one per machine; the others that meet 404 or come to return (a re-registration after a
// self-update, a plugin reload, a daemon handover) wait for its outcome. The probe returned —
// the waiting return at most two at a time, each after a random delay in a window that grows
// with the number waiting (capped at 60 s). The probe met 502/503/504 or no connection — the
// down window (downwindow.ts) stands: the waiting do not knock, their calls answer «not sent»,
// and the next probe goes by the window's ladder (its file lock). Nothing returns ahead of a
// call: only a call that needs its session back comes here. A bridge outside a daemon is a
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
  /** Sessions waiting for the probe or their turn. */
  waiting: number;
  /** Returns out now, after the probe. */
  out: number;
  turns: (() => void)[];
}

const gates = new Map<string, Gate>();
const gateOf = (server: string): Gate => {
  let g = gates.get(server);
  if (!g) gates.set(server, (g = { probe: null, waiting: 0, out: 0, turns: [] }));
  return g;
};

/** The gate is quiet: no probe, nobody waiting, nothing out — the next one to come is a probe. */
const quiet = (g: Gate): boolean => !g.probe && g.waiting === 0 && g.out === 0;

async function turn(g: Gate): Promise<void> {
  if (g.out < AT_ONCE) return void g.out++;
  await new Promise<void>((r) => g.turns.push(r));
  g.out++;
}

function done(g: Gate): void {
  g.out--;
  g.turns.shift()?.();
}

/** `knock` — the session's return (its initialize, or its seat's register): through the gate. */
export async function throughGate<T>(server: string, knock: () => Promise<T>): Promise<T> {
  const g = gateOf(server);
  if (quiet(g)) {
    log("return gate: this session is the machine's probe");
    const run = knock();
    g.probe = run.then(
      () => null,
      (e: unknown) => (e instanceof DownError ? e : null),
    );
    try {
      return await run;
    } finally {
      await g.probe;
      g.probe = null;
    }
  }
  g.waiting++;
  try {
    for (let p = g.probe; p; p = g.probe) {
      const down = await p;
      // The server is down: the window stands — no knock; the call answers «not sent».
      if (down instanceof DownError) throw down;
    }
    const window = Math.min(CAP_MS, STEP_MS * g.waiting);
    const wait = Math.floor(Math.random() * window);
    log(`return gate: ${g.waiting} waiting — this one returns in ${wait} ms (window ${window} ms)`);
    await sleep(wait);
    await turn(g);
  } finally {
    g.waiting--;
  }
  try {
    return await knock();
  } finally {
    done(g);
  }
}
