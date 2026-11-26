// A life check on the dispatcher for a channel no live subscription holds (graph @nks/nks-dev,
// nodes #11362, #11359): never a turn, the dispatcher answers itself — gone when a session here
// let the channel go (its run ended, the seat was released), unknown when none held it here.
// A held channel's check goes to its session's holding, which answers by its life (lifeanswer.ts).
import { type Frame } from "../shared/channel.ts";
import { type Link } from "./muxlink.ts";
import { log } from "./streams.ts";

/** Channels remembered at most: the oldest goes first. */
const KEPT = 500;

/** The channel was let go by its session here, not handed to a successor. */
export function lifeGone(ended: Set<string>, channel: string): void {
  ended.add(channel);
  for (const old of ended) if (ended.size > KEPT) ended.delete(old);
}

export function lifeOfLetGo(link: Link, ended: Set<string>, channel: string, f: Frame): void {
  const ref = typeof f.ref === "string" || typeof f.ref === "number" ? f.ref : null;
  if (ref === null) return log(`dispatcher: a life_check of ${channel} without a ref`);
  const standing_id = typeof f.standing_id === "string" ? f.standing_id : "";
  const state = ended.has(channel) ? "gone" : "unknown";
  link.send({ type: "life", channel_id: channel, standing_id, ref, state });
  log(`dispatcher: life_check ${ref} of ${channel}: ${state}`);
}
