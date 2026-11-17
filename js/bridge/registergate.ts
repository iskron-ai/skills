// The register gate (graph @nks/nks-dev, nodes #7439, #10801, #11030): the bridge's own
// register of a seat goes to the server only through this file. Every send — the first one,
// the retry after a waited 429, the retry after a 409 opened concurrently, any fallback — asks
// its move first: stopped since the move began (the stop watch) or this seat ended since then
// (endedseats.ts) — nothing is sent. A path that registers past the gate is a defect; the probe
// register-gate.test.mjs fails on one (the literal of a register's arguments outside this file).
import { ID_PREFIX, tool } from "../delivery/index.ts";
import { type Answer, callTool } from "./call.ts";
import { claimResult } from "./claimdelivery.ts";
import { endedSince } from "./endedseats.ts";
import { placeFields } from "./placefields.ts";
import { type MoveSeat, type RegisterMove } from "./ratelimit.ts";
import { noteSkills } from "./skillwatch.ts";
import { claimRefusal, launchBasis, registeredBasis, rememberBasis } from "./spawned-for.ts";
import { post, type Standing, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** The move's main seat, its id not asked: its end is the move's stop (stophold.ts). */
export const MAIN_SEAT: MoveSeat = { id: null, main: true };

/** Why the gate is shut for `seat` in `move`: the stop word, the seat's end; null — open. */
export const gateShut = (move: RegisterMove, seat: MoveSeat): string | null =>
  move.stopped() ?? (endedSince(seat.id, move.since) ? "the seat ended in this move" : null);

/**
 * A register over the tool call (stand, the disk return and its seats beside, a move undone):
 * `args` — the seat and its fields. Shut — nothing sent, a refusal answer with the reason.
 */
export async function registerByCall(
  move: RegisterMove,
  seat: MoveSeat,
  args: Record<string, unknown>,
): Promise<Answer> {
  const shut = gateShut(move, seat);
  if (shut) return { isError: true, text: shut };
  return callTool(tool("channel"), { ...args, action: "register" });
}

/**
 * The bridge's own register of a remembered `place` on the current session (the rebind, the
 * skills refresh, usage): its own post, the claim's echo checked. null — nothing sent: the
 * gate is shut, or a terminal claim refusal ends every own register of this session (#9959).
 */
export async function registerRaw(
  move: RegisterMove,
  seat: MoveSeat,
  place: Standing | null,
  freshSkills: boolean,
): Promise<JsonRpcMessage | null> {
  if (gateShut(move, seat) || claimRefusal()) return null;
  const id = `${ID_PREFIX}bridge-restanding-${++state.reinitCounter}`;
  let reply: JsonRpcMessage | null = null;
  const basis = launchBasis({ ...place });
  rememberBasis({ ...place }, basis);
  const arguments_ = {
    ...place,
    ...placeFields(place ?? {}, freshSkills),
    ...registeredBasis(place ?? {}),
    action: "register",
  };
  await post(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: tool("channel"), arguments: arguments_ },
    },
    (m) => {
      if (m.id === id) {
        m = claimResult(arguments_, m, true);
        reply = m;
        if (!m.error && !m.result?.isError && place) noteSkills(place, arguments_.attrs.skills);
      }
    },
  );
  return reply as JsonRpcMessage | null;
}
