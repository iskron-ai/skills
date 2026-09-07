import { errorMessage } from "./errors.ts";
import { debug, log } from "./streams.ts";
import { post, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

// Remember a registration the harness made, so it can be replayed into the next
// session. Only a call the server ACCEPTED is remembered: a refused one names no
// seat we may take.
export function noteStanding(msg: JsonRpcMessage, reply: JsonRpcMessage): void {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "register") return;
  if (reply?.error || reply?.result?.isError) return;
  state.standing = { realm: a.realm, karta: a.karta, name: a.name };
  state.standingSession = state.sessionId;
  debug(`standing remembered: ${a.name ?? "(unnamed)"} at karta ${a.karta} in ${a.realm}`);
}

// One replay at a time — and every concurrent caller WAITS for it. A flag that
// merely skipped the second caller let it through unattributed while the first
// was still re-registering (harnesses send calls in batches).
let standingInFlight: Promise<void> | null = null;

// Put the remembered standing back on the current session — before the call
// that would otherwise land unattributed. Silent by contract: register releases
// nothing and evicts nobody, so replaying it costs one call and no state.
export function ensureStanding(): Promise<void> {
  if (!state.standing || !state.sessionId) return Promise.resolve();
  if (state.standingSession === state.sessionId) return Promise.resolve();
  if (standingInFlight) return standingInFlight; // wait for the replay already running
  standingInFlight = (async () => {
    try {
      const id = `iskron-bridge-restanding-${++state.reinitCounter}`;
      let reply: JsonRpcMessage | null = null;
      await post(
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "iskron_channel", arguments: { ...state.standing, action: "register" } },
        },
        (m) => {
          if (m.id === id) reply = m;
        },
      );
      const got = reply as JsonRpcMessage | null;
      if (got && !got.error && !got.result?.isError) {
        state.standingSession = state.sessionId;
        log(`standing re-registered on the new session (${state.standing?.name ?? "unnamed"})`);
      } else if (seatIsGone(got)) {
        // The seat itself is gone (expired while we were away) — say so and let
        // the agent take it back with connect; never guess a different name.
        log(`the standing's seat is gone, forgetting it: ${replyText(got).slice(0, 200)}`);
        state.standing = null;
      } else {
        // Any other refusal is the hour's, not the seat's: keep the memory and
        // try again before the next call. Forgetting here is what left a bridge
        // writing unattributed for the rest of a shift after one passing 503.
        log(
          `could not re-register the standing this time, will retry before the next call: ${replyText(got).slice(0, 200)}`,
        );
      }
    } catch (e) {
      log(`re-registering the standing failed: ${errorMessage(e)}`);
    } finally {
      standingInFlight = null;
    }
  })();
  return standingInFlight;
}

export const replyText = (reply: JsonRpcMessage | null): string => {
  if (!reply) return "";
  if (reply.error) return JSON.stringify(reply.error);
  const content = reply.result?.content;
  return Array.isArray(content)
    ? content.map((c: { text?: string }) => c?.text ?? "").join("\n")
    : JSON.stringify(reply.result ?? "");
};

// The surface's own words for "no seat to bind to" — the one refusal that
// means the remembered standing is no longer takeable by register.
export const seatIsGone = (reply: JsonRpcMessage | null): boolean =>
  /no such standing|take it with connect|такого стояния|занять.*connect/i.test(replyText(reply));

// The surface's marks for a call that ran WITHOUT its author: the channel
// refuses (409, nothing applied), the graph factories write and warn. Either
// way the binding this session believed in is gone. Anchored on the surface's
// CODES, never on prose: a node body read back may well contain the words
// "session not registered", and a lookup must not buy a register for that.
const UNATTRIBUTED_CODE = /write_unattributed\w*|session_not_registered/;
const UNATTRIBUTED_REFUSAL =
  /\b409\b|не зарегистрирован[аоы]? ни за каким стоянием|hold no registered standing/i;

export const isUnattributed = (reply: JsonRpcMessage | null): boolean => {
  if (!reply) return false;
  const text = replyText(reply);
  if (UNATTRIBUTED_CODE.test(text)) return true;
  return !!reply.result?.isError && UNATTRIBUTED_REFUSAL.test(text);
};
