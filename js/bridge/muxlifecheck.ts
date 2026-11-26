// A life check on the dispatcher for a channel no live subscription holds (graph @nks/nks-dev,
// nodes #11362, #11359): never a turn, the dispatcher answers itself — gone only when the session
// that held it here really ended (runend.ts says so: the end word, a run's or a satellite's end,
// the death window); a leave, an away, a supersede, a handover or none held it here — unknown.
// A held channel's check goes to its session's holding, which answers by its life (lifeanswer.ts).
import { type Frame } from "../shared/channel.ts";
import { type Link } from "./muxlink.ts";
import { log } from "./streams.ts";

/** Channels remembered at most: the oldest goes first. */
const KEPT = 500;

/** Remember a channel (ended), or which channel a secret carried (let go), the oldest going first. */
export function lifeGone(
  into: Set<string> | Map<string, string>,
  channel: string,
  secret = "",
): void {
  if (into instanceof Map) {
    into.delete(secret); // the newest last: the oldest goes first
    into.set(secret, channel);
  } else into.add(channel);
  for (const old of into.keys()) if (into.size > KEPT) into.delete(old);
}

export function lifeOfLetGo(link: Link, ended: Set<string>, channel: string, f: Frame): void {
  const ref = typeof f.ref === "string" ? f.ref : null; // the server's string, echoed as is
  if (ref === null) return log(`dispatcher: a life_check of ${channel} without a string ref`);
  const standing_id = typeof f.standing_id === "string" ? f.standing_id : "";
  const state = ended.has(channel) ? "gone" : "unknown";
  link.send({ type: "life", channel_id: channel, standing_id, ref, state });
  log(`dispatcher: life_check ${ref} of ${channel}: ${state}`);
}
