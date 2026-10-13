// The stop at the exit to the server (graph @nks/nks-dev, nodes #7439, #7492), like the
// unnamed seat's (unnamed.ts): a seat move onto a stopped name is refused with the stop word
// and not sent; the api's own refusal 409 standing_stopped is marked and said the same way.
// Both carry the api's rule, so a re-register on a new session forgets the seat by it (standing.ts).
import { serverProtocol, tool } from "../delivery/index.ts";
import { keyOf } from "./holdrecord.ts";
import { normKarta, normName } from "./names.ts";
import { refusalOf } from "./refusal.ts";
import { markStopped, stopOf, stopWord } from "./stopped.ts";
import { type JsonRpcMessage } from "./types.ts";

/** The api's rule for a seat under a stop (#7492). */
export const STOPPED_RULE = "standing_stopped";
const SEAT_MOVES = new Set(["connect", "mint", "register"]);

const refusalReply = (id: JsonRpcMessage["id"], text: string): JsonRpcMessage => ({
  jsonrpc: "2.0",
  id,
  result: {
    isError: true,
    content: [{ type: "text", text }],
    _meta: { [serverProtocol.refusal]: { rule: STOPPED_RULE, status: 409 } },
  },
});

const seatMove = (msg: JsonRpcMessage): Record<string, unknown> | null => {
  if (msg?.method !== "tools/call" || msg.params?.name !== tool("channel")) return null;
  const a = msg.params.arguments ?? {};
  return SEAT_MOVES.has(String(a.action)) ? a : null;
};

/** A seat move onto a stopped name — the stop word instead of sending; otherwise null. */
export function stoppedSeatRefusal(msg: JsonRpcMessage): JsonRpcMessage | null {
  const a = seatMove(msg);
  const m = a ? stopOf(a.realm, a.karta, a.name) : null;
  return m ? refusalReply(msg.id, stopWord(normName(a?.name), m.reason)) : null;
}

/** Whether a reply is the stop refusal — the api's or the bridge's own. */
export const isStopRefusal = (reply: JsonRpcMessage | null): boolean =>
  !!reply?.result?.isError && refusalOf(reply)?.rule === STOPPED_RULE;

/** The api refused a seat move as stopped (409 standing_stopped): mark it, tell the stop word. */
export function noteServerStop(msg: JsonRpcMessage, reply: JsonRpcMessage): JsonRpcMessage {
  const a = seatMove(msg);
  if (!a || !isStopRefusal(reply)) return reply;
  const name = normName(a.name);
  const reason = refusalOf(reply)?.data?.reason;
  const seat = { realm: String(a.realm ?? ""), karta: normKarta(a.karta), name };
  const why = typeof reason === "string" ? reason : "";
  return refusalReply(reply.id, markStopped(seat, keyOf(seat.realm, seat.karta, name), 409, why));
}
