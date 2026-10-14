// A root session's bridge put down by the plugin says why first (graph @nks/nks-dev, node #7493):
// `end` — the session was deleted, the agent ended: the bridge revokes its own seats at once;
// `away` — a planned restart (a reload, a move to another folder): the seat waits for the same
// session. A bridge gone without a word is the agent's death — the daemon closes its seat
// after the window.
import { method, OPENCODE, PRODUCT } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import type { Slot } from "./slot.ts";

export type PutDown = "end" | "away";

/** `end` waits for the revokes of the main seat and those beside; `away` is a mark only. */
const SAY_MS: Record<PutDown, number> = { end: 8_000, away: 1_000 };

/**
 * What an `end` left on the board, aloud — the bridge keeps the hold record and repeats the
 * revoke after the death window (runend.ts); null — all revoked.
 */
function unrevoked(
  got: { ended?: boolean; failed?: string[]; word?: string } | null,
): string | null {
  if (got?.ended && !got.failed?.length) return null;
  return got?.failed?.length ? got.failed.join(", ") : (got?.word ?? "—");
}

/** The word to a root's bridge with a seat, then its stop; any other bridge just stops. */
export async function putDown(slot: Slot, word: PutDown | null): Promise<void> {
  if (word && !slot.child && (slot.holding || slot.key)) {
    const got = await slot.bridge
      .request(method(word), {}, { timeoutMs: SAY_MS[word], service: true })
      .catch((e: Error) => ({ ended: false, word: e.message }));
    const left = word === "end" ? unrevoked(got) : null;
    if (left) process.stderr.write(`[${PRODUCT}/warning] ${words(OPENCODE).endUnrevoked(left)}\n`);
  }
  slot.bridge.stop();
}
