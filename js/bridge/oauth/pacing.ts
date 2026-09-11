// No answer of the bridge ever tells a human to come back in N minutes (graph
// nks-dev: #4794). What is shorter than a call the bridge waits out itself,
// inside the call; what is longer is answered with the login. Two short pauses
// stand where the waits used to: a refused grant is knocked again before it is
// judged dead — a server mid-restart words a live grant's death the same way —
// and a hold short enough is slept through rather than handed to the caller.
const pauses = (v: string | undefined, fallback: string): number[] =>
  (v || fallback)
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0);

/** The knocks on a refused grant, before it is judged dead and a human is called in. */
export const DEAD_RECHECK_MS = pauses(process.env.ISKRON_BRIDGE_DEAD_RECHECK_MS, "1000,2000");
/** The longest the bridge sits out a hold inside one call before it offers the login instead. */
export const IN_CALL_WAIT_MS = Number(process.env.ISKRON_BRIDGE_IN_CALL_WAIT_MS) || 10_000;
