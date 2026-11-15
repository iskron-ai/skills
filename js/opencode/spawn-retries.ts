// A launch whose register does not confirm its pair is tried a bounded number of times
// (graph @nks/nks-dev, #10782, layer 1 of #10788). The harness may open session after session
// with the same launch line, each one seating a root through a fresh bridge; the tally is the
// instance's, by pair, across sessions. Before a retry the prompt waits a pause that doubles up
// to a ceiling; after the last try the pair is refused without a bridge — still after the
// ceiling, so a harness that retries at once does not spin — and the give-up is said once.
// A new launch comes by a new invitation, never by this pair again (#7523).
import { envName, SPAWNED_FOR } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import type { SpawnedFor } from "../shared/spawned-for.ts";

export const SPAWN_TRIES = 5;
/** The first pause; the variable is for probes. */
const baseMs = (): number => Number(process.env[envName("SPAWN_RETRY_MS")] || 5_000);
const ceilingMs = (): number => baseMs() * 12;
const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms).unref?.());
const keyOf = (p: SpawnedFor): string => `${p.room}#${p.invite}`;

export function createSpawnRetries(loud: (word: string) => void) {
  const tally = new Map<string, { failed: number; at: number }>();
  const gaveUp = (p: SpawnedFor) => words(SPAWNED_FOR).gaveUp(SPAWN_TRIES, p.room, p.invite);
  return {
    /** Before a seating with this pair: its pause; past the bound — the refusal, after the ceiling. */
    async before(p: SpawnedFor): Promise<void> {
      const t = tally.get(keyOf(p));
      if (!t) return;
      if (t.failed >= SPAWN_TRIES) {
        await pause(ceilingMs());
        throw new Error(gaveUp(p));
      }
      const wait = Math.min(baseMs() * 2 ** (t.failed - 1), ceilingMs());
      const left = t.at + wait - Date.now();
      if (left > 0) await pause(left);
    },
    /** A seating with this pair ended unconfirmed; the last try says the give-up once. */
    failed(p: SpawnedFor): void {
      const t = tally.get(keyOf(p)) ?? { failed: 0, at: 0 };
      t.failed++;
      t.at = Date.now();
      tally.set(keyOf(p), t);
      if (t.failed === SPAWN_TRIES) loud(gaveUp(p));
    },
    confirmed(p: SpawnedFor): void {
      tally.delete(keyOf(p));
    },
  };
}
