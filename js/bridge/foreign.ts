// A message whose to_standing_id names no seat of this session is another's (case #1551: a
// frame to another seat was shown to the agent as its own): the journal gets its id and
// address fields — never its body — and the agent gets nothing. Control frames are not looked at.
import { type Frame } from "../shared/channel.ts";
import { debug, log } from "./streams.ts";

const field = (v: unknown): string => (v == null || v === "" ? "-" : String(v));

/** A frame's id and address fields, without its body. */
const addressOf = (f: Frame): string =>
  `id ${field(f.id)}, to_standing_id ${field(f.to_standing_id)}, to_standing ${field(f.to_standing)}, ` +
  `realm ${field(f.realm)}, karta_seq ${field(f.karta_seq)}`;

/**
 * `ids` — the platform ids of the session's seats (null — not known yet). True — every id is
 * known and none is the frame's: not to be delivered. Some seat's id unknown — delivered as
 * before, with the journal line all the same.
 */
export function isForeign(frame: Frame, ids: (string | null)[]): boolean {
  if (frame.type !== "message") return false;
  debug(`message ${addressOf(frame)}`);
  const id = typeof frame.to_standing_id === "string" ? frame.to_standing_id : "";
  if (!id || ids.includes(id)) return false;
  const unknown = ids.some((s) => !s);
  log(
    unknown
      ? `message to another seat? own id unknown, delivered: ${addressOf(frame)}`
      : `message to another seat, not given to the agent: ${addressOf(frame)}`,
  );
  return !unknown;
}
