// The server's life check of a seat (graph @nks/nks-dev, nodes #11362, #11359): a control frame
// {type:"life_check", standing_id, ref} on the seat's socket or the dispatcher (with channel_id).
// It is never a turn: the bridge answers at once {type:"life", standing_id, ref, state} —
// present: the harness session holding that seat is this bridge's and lives; gone: its run
// ended; unknown: the seat is not this bridge's, or its session is paused or handed over.
// The bridge declares it answers by "life" in its register attrs.caps (placefields.ts).
import { doors } from "./hold.ts";
import { type Frame, H, handoverReason, whenLifeChecked } from "./holdstate.ts";
import { suspended } from "./pauserecord.ts";
import { runEnded } from "./runend.ts";
import { log } from "./streams.ts";

export type Life = "present" | "gone" | "unknown";

/** The seat `id`'s life, by this bridge's own session. */
export function lifeOf(id: string): Life {
  if (!id || !doors().some((d) => d.standingId === id)) return "unknown";
  if (runEnded()) return "gone";
  if (suspended() || handoverReason() || !H.holder?.alive) return "unknown";
  return "present";
}

function answer(frame: Frame): void {
  const standing_id = typeof frame.standing_id === "string" ? frame.standing_id : "";
  const ref = typeof frame.ref === "string" || typeof frame.ref === "number" ? frame.ref : null;
  if (ref === null) return log(`life_check without a ref — not answered`);
  const state = lifeOf(standing_id);
  const sent = H.holder?.send(JSON.stringify({ type: "life", standing_id, ref, state })) ?? false;
  log(`life_check ${ref} of ${standing_id || "?"}: ${state}${sent ? "" : " — not sent"}`);
}

whenLifeChecked(answer);
