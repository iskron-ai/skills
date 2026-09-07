import { ensureAuth } from "./auth.ts";
import { BUILD } from "./build.ts";
import {
  AuthPending,
  errorMessage,
  HoldOffError,
  LoginHeld,
  type Outcome,
  UpstreamError,
} from "./errors.ts";
import { absorbChannelReply } from "./hold.ts";
import { annotateToolList } from "./moment.ts";
import { ensureStanding, isUnattributed, noteStanding, replyText } from "./standing.ts";
import { emit, log } from "./streams.ts";
import { currentAccessToken, post, reinitialize, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

// The verdict a caller actually needs is not "it failed" but "may it have taken
// effect?" — and those are different sentences. A single "retry the call" over
// both is worse than silence: it is advice, and for a write with no version
// guard the advice duplicates the record without a trace.
export function syntheticError(
  id: JsonRpcMessage["id"],
  message: string,
  outcome: Outcome = UpstreamError.UNKNOWN,
  holdOff: boolean | "wait" | "knock" = false,
): JsonRpcMessage {
  // holdOff carries the KIND of not-yet, because the two kinds prescribe
  // opposite moves. "wait" is a pause with an honest figure: the grace-held
  // login, the knock cooldown, an hour a repeated refusal proved real — a
  // retry there buys nothing. "knock" is the FIRST early refusal of a needed
  // refresh: witnessed in the field, the same call succeeded seconds after
  // that refusal (a rotated grant, a 401 that did not survive a second
  // presentation — the cause was not pinned, the refuted prescription was),
  // so selling the token's whole hour as a wait once cost a caller a
  // self-imposed half hour of blindness.
  const kind = holdOff === true ? "wait" : holdOff;
  const verdict =
    outcome === UpstreamError.NOT_SENT
      ? kind === "wait"
        ? // Safe and not-yet are different axes, and an agent told only "safe" reads
          // it as "now": it retries into the same wall, then goes looking for a
          // defect in what only time repairs. The interval itself stays where it was
          // measured — in the reason above — so one refusal never carries two.
          "Nothing was applied and the grant is whole — this clears itself by waiting, " +
          "not by fixing: wait out the interval named above before retrying."
        : kind === "knock"
          ? "Nothing was applied and the grant is whole — a benign transition, not a broken " +
            "authorization: retry the call now. Only a refusal that returns means the hour is " +
            "real — that one names its own wait."
          : "The call never reached the server, so nothing was applied — retry freely."
      : "The call went out and its answer was lost, so THE OUTCOME IS UNKNOWN — re-read the target " +
        "before retrying: a blind retry can apply a second time, and a write with no version guard " +
        "duplicates silently.";
  // The attention clause stays off every hold-off: a whole grant pausing is
  // the server's own pacing, never a defect to escalate.
  const tail = kind
    ? "The bridge stays up."
    : "The bridge stays up; if this repeats, the server side needs attention.";
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32001,
      // BUILD is here for the field report: the error is quoted verbatim, and
      // the build string is what dates the code that produced it.
      message: `iskron-bridge ${BUILD}: ${message}. ${verdict} ${tail}`,
    },
  };
}

// Deliver one harness message upstream, with one auth retry and one session
// retry. On final failure a request id is ALWAYS answered with an error.
export async function deliver(msg: JsonRpcMessage): Promise<void> {
  const isInit = msg?.method === "initialize";
  if (isInit) state.initParams = msg.params;
  const hasId = msg?.id !== undefined && msg?.id !== null;
  let authRetried = false;
  let sessionRetried = false;
  // Across retries the honest verdict is the worst one seen: an attempt that
  // went out with a lost answer is not undone by a later attempt that never left.
  let outcome: Outcome = UpstreamError.NOT_SENT;
  const note = (e: unknown) => {
    if (!(e instanceof UpstreamError) || e.outcome === UpstreamError.UNKNOWN) {
      outcome = UpstreamError.UNKNOWN;
    }
  };

  // A tool call's own reply is held back until it has been read for the
  // unattributed mark; everything else the server streams passes through.
  const isToolCall = msg?.method === "tools/call";
  let heldReply: JsonRpcMessage | null;
  let standingRetried = false;
  const forward = (m: JsonRpcMessage) => {
    if (isInit && m.id === msg.id && m.result?.protocolVersion) {
      state.protocolVersion = m.result.protocolVersion;
    }
    if (m.id === msg.id) noteStanding(msg, m);
    if (m.id === msg.id && msg.method === "tools/list") annotateToolList(m);
    if (isToolCall && hasId && m.id === msg.id) {
      heldReply = m;
      return;
    }
    emit(m);
  };

  for (;;) {
    try {
      if (
        !isInit &&
        state.sessionId &&
        state.sessionToken &&
        currentAccessToken() !== state.sessionToken
      ) {
        // The credential this session was opened with is gone; so is the session,
        // whatever the server says next. Re-open — bound by header — before the call.
        log(
          "the access token changed since the session was opened — re-initializing before the call",
        );
        await reinitialize();
      }
      if (!isInit) await ensureStanding(); // the session may have turned over under us
      heldReply = null;
      await post(msg, forward);
      const held = heldReply as JsonRpcMessage | null;
      if (held) {
        if (state.standing && isUnattributed(held)) {
          // The binding this session trusted is gone on the server's side — a
          // silent turnover, a platform that lost it, a header nobody honoured.
          // A refused channel call applied nothing: re-bind and say the word again,
          // once. A write that went through with a warning is already on record
          // without its author; all that can be saved is the next one.
          state.standingSession = null;
          const refused = !!held.result?.isError;
          if (refused && !standingRetried) {
            standingRetried = true;
            log("the call ran unattributed — re-binding the standing and repeating it once");
            await ensureStanding();
            if (state.standingSession !== state.sessionId) await ensureStanding(); // one passing refusal is not the hour
            if (state.standingSession === state.sessionId) continue;
          } else {
            log(
              `a write went out unattributed (${replyText(held).slice(0, 120)}) — the standing is re-bound before the next call`,
            );
          }
        }
        // Ответ connect/mint: мост берёт сокет себе и дописывает, как слушать.
        emit(absorbChannelReply(msg, held));
      }
      return;
    } catch (e) {
      note(e);
      if (e instanceof UpstreamError && e.kind === "auth" && !authRetried) {
        authRetried = true;
        try {
          await ensureAuth(e.message, { force: true, rejected: e.presented });
          continue;
        } catch (authErr) {
          if (authErr instanceof AuthPending || authErr instanceof LoginHeld) {
            // A held login names its own wait; AuthPending names a URL. The first
            // is repaired by time and must not be sold as "retry freely"; the
            // second is repaired by a human's click, and no waiting shortens it.
            if (hasId) {
              emit(syntheticError(msg.id, authErr.message, outcome, authErr instanceof LoginHeld));
            }
            return;
          }
          // A hold-off is not a failed authorization: the grant is whole and
          // nothing was judged. Naming it "failed" sent readers off to mend a
          // grant nobody had touched.
          const held = authErr instanceof HoldOffError;
          const message = errorMessage(authErr);
          log(`${held ? "authorization holding off" : "authorization failed"}: ${message}`);
          if (hasId) {
            emit(
              syntheticError(
                msg.id,
                `${held ? "authorization holding off" : "authorization failed"}: ${message}`,
                outcome,
                held && (authErr.retryNow ? "knock" : "wait"),
              ),
            );
          }
          return;
        }
      }
      if (e instanceof UpstreamError && e.kind === "session" && !sessionRetried && !isInit) {
        sessionRetried = true;
        try {
          await reinitialize();
          continue;
        } catch (reErr) {
          if (hasId) {
            emit(
              syntheticError(msg.id, `session recovery failed: ${errorMessage(reErr)}`, outcome),
            );
          }
          return;
        }
      }
      // A SECOND 401 — after a refresh already replaced the token — is never
      // an expiry: the server is refusing tokens as such, and retries cannot
      // fix that. Name the one likely defect (audience/resource mismatch) and
      // its lever, or the report that reaches us says only "unauthorized".
      const reason =
        e instanceof UpstreamError
          ? e.kind === "auth" && authRetried
            ? `upstream refuses even a freshly obtained access token (${e.message}) — not an expiry; ` +
              `the token's audience/resource may not match what the server validates ` +
              `(operator lever: ISKRON_BRIDGE_RESOURCE), or the server's token validation is off`
            : e.message
          : `bridge internal error: ${errorMessage(e)}`;
      log(`request ${hasId ? msg.id : `(notification ${msg?.method})`} failed: ${reason}`);
      if (hasId) emit(syntheticError(msg.id, reason, outcome));
      return;
    }
  }
}
