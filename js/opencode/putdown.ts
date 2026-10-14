// A root session's bridge put down by the plugin says why first (graph @nks/nks-dev, node #7493):
// `end` — the session was deleted, the agent ended: the bridge revokes its own seats at once;
// `away` — a planned restart (a reload, a move to another folder): the seat waits for the same
// session. A bridge gone without a word is the agent's death — the daemon closes its seat
// after the window.
import { method } from "../delivery/index.ts";
import type { Slot } from "./slot.ts";

export type PutDown = "end" | "away";

/** `end` waits for the revokes of the main seat and those beside; `away` is a mark only. */
const SAY_MS: Record<PutDown, number> = { end: 8_000, away: 1_000 };

/** The word to a root's bridge with a seat, then its stop; any other bridge just stops. */
export async function putDown(slot: Slot, word: PutDown | null): Promise<void> {
  if (word && !slot.child && (slot.holding || slot.key))
    await slot.bridge
      .request(method(word), {}, { timeoutMs: SAY_MS[word], service: true })
      .catch(() => {});
  slot.bridge.stop();
}
