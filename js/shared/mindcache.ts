// The human's rules slice, cached per account for the whole process (graph @nks/nks-dev, kriya
// #9817): N sessions of one daemon starting together read it once. Fresh 15 min; stale served up
// to 24 h — a reader waits for a fetch no longer than 3 s, else takes the stale (none — it goes
// on without rules, told they are not loaded yet); one fetch in flight per account; a failed fetch backs off with a jittered, growing pause, and while it does
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

/** What a reader says without a slice: a failure's word, or that the read still goes on. */
export interface SliceWords {
  unread: (why: string) => string;
  pending: () => string;
  /** A recovery's read (compaction): it retries a failed fetch, the back-off does not hold it. */
  retry?: boolean;
}

/**
 * The account's slice block. No reader waits longer than 3 s: past that it goes on with the
 * stale slice, or — none left — with the word that the rules are not loaded yet; the one fetch
 * goes on and fills the cache for the next.
 */
export async function cachedSlice(
  account: string,
  read: () => Promise<SliceRead>,
  w: SliceWords,
): Promise<string> {
  const e = entryOf(account);
  const age = Date.now() - e.at;
  const stale = e.block !== null && age < STALE_MS ? e.block : null;
  if (stale !== null && age < FRESH_MS) return stale;
  if (!w.retry && Date.now() < e.until) return stale ?? w.unread(e.error);
  const got = await Promise.race([e.flight ?? start(e, read), pause(WAIT_MS)]);
  if (got) return got.block ?? stale ?? w.unread(got.error ?? "");
  return stale ?? w.pending();
}

/** Tools that only read: a call of any other names a write to its realm. */
const READS = new Set(["look", "orient", "search", "semantic_search"].map(tool));
/**
 * The history tool's actions that only read (its description: realm | node | delta | invert |
 * revert | restore_node | restore_edge): revert and the restores change the graph — a write, as
 * any action not named here.
 */
const HISTORY_READS = new Set(["realm", "node", "delta", "?"]);
const reads = (name: string, args: { action?: unknown } | null): boolean =>
  READS.has(name) || (name === tool("history") && HISTORY_READS.has(String(args?.action ?? "")));

/** A call that may write `args.realm`: the cached slice of an account whose own mind it is goes. */
export function wroteTo(name: string, args: unknown): void {
  const a = args as { realm?: unknown; action?: unknown } | null;
  const realm = a?.realm;
  if (reads(name, a) || typeof realm !== "string" || !entries.size) return;
  const r = realm.trim().toLowerCase();
  for (const e of entries.values())
    if (e.mind && (r === e.mind.toLowerCase() || r === "mind"))
      Object.assign(e, { gen: e.gen + 1, block: null, at: 0, flight: null });
}
