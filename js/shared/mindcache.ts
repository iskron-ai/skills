// The human's rules slice, cached per account for the whole process (graph @nks/nks-dev, kriya
// #9817): N sessions of one daemon starting together read it once. Fresh 15 min; stale served up
// to 24 h — a reader waits for a refresh no longer than 3 s, else takes the stale; one fetch in
// flight per account; a failed fetch backs off with a jittered, growing pause, and while it does
// no reader fetches; a write to the account's own mind drops the cached slice.
import { tool } from "../delivery/index.ts";

export interface SliceRead {
  block: string;
  /** The own mind's full address the slice came from; null — the account has none. */
  mind: string | null;
}
type Flight = Promise<{ block?: string; error?: string }>;
interface Entry {
  block: string | null;
  at: number;
  mind: string | null;
  flight: Flight | null;
  fails: number;
  until: number;
  error: string;
  gen: number;
}

const FRESH_MS = 15 * 60_000;
const STALE_MS = 24 * 60 * 60_000;
const WAIT_MS = 3000;
const BACKOFF_MS = 30_000;
const BACKOFF_MAX_MS = 15 * 60_000;

const entries = new Map<string, Entry>();
const entryOf = (account: string): Entry => {
  let e = entries.get(account);
  if (!e) {
    e = { block: null, at: 0, mind: null, flight: null, fails: 0, until: 0, error: "", gen: 0 };
    entries.set(account, e);
  }
  return e;
};

/** The pause after `fails` failures in a row: doubling from 30 s to 15 min, the upper half jittered. */
const backoff = (fails: number): number => {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_MS * 2 ** (fails - 1));
  return step / 2 + Math.random() * (step / 2);
};

function start(e: Entry, read: () => Promise<SliceRead>): Flight {
  const gen = e.gen;
  const flight: Flight = read()
    .then(
      (r) => {
        if (e.gen === gen)
          Object.assign(e, { block: r.block, mind: r.mind, at: Date.now(), fails: 0, until: 0 });
        return { block: r.block };
      },
      (err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        if (e.gen === gen) Object.assign(e, { fails: e.fails + 1, error });
        if (e.gen === gen) e.until = Date.now() + backoff(e.fails);
        return { error };
      },
    )
    .finally(() => {
      if (e.flight === flight) e.flight = null;
    });
  e.flight = flight;
  return flight;
}

const pause = (ms: number): Promise<null> =>
  new Promise((r) => setTimeout(() => r(null), ms).unref?.());

/** The account's slice block; `unread` words a failure when nothing stale is left to serve. */
export async function cachedSlice(
  account: string,
  read: () => Promise<SliceRead>,
  unread: (why: string) => string,
): Promise<string> {
  const e = entryOf(account);
  const age = Date.now() - e.at;
  const stale = e.block !== null && age < STALE_MS ? e.block : null;
  if (stale !== null && age < FRESH_MS) return stale;
  if (Date.now() < e.until) return stale ?? unread(e.error);
  const flight = e.flight ?? start(e, read);
  if (stale === null) {
    const got = await flight;
    return got.block ?? unread(got.error ?? "");
  }
  const got = await Promise.race([flight, pause(WAIT_MS)]);
  return got?.block ?? stale;
}

/** Tools that only read: a call of any other names a write to its realm. */
const READS = new Set(["look", "orient", "search", "semantic_search", "history"].map(tool));

/** A call that may write `args.realm`: the cached slice of an account whose own mind it is goes. */
export function wroteTo(name: string, args: unknown): void {
  const realm = (args as { realm?: unknown } | null)?.realm;
  if (READS.has(name) || typeof realm !== "string" || !entries.size) return;
  const r = realm.trim().toLowerCase();
  for (const e of entries.values())
    if (e.mind && (r === e.mind.toLowerCase() || r === "mind"))
      Object.assign(e, { gen: e.gen + 1, block: null, at: 0, flight: null });
}
