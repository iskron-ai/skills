import { OWN_CLIENTS } from "../shared/clients.ts";
import { ensureAuth } from "./auth.ts";
import { BUILD } from "./build.ts";
import {
  AuthPending,
  errorMessage,
  HoldOffError,
  LoginHeld,
  type Outcome,
  TokenRefused,
  UpstreamError,
} from "./errors.ts";
import { absorbChannelReply, absorbRevokeReply, localStatus } from "./hold.ts";
import { annotateToolList } from "./moment.ts";
import { isStandCall, runStand } from "./stand.ts";
import { ensureStanding, isUnattributed, noteStanding, replyText } from "./standing.ts";
import { loadServerCache, saveServerCache } from "./store.ts";
import { emit, log } from "./streams.ts";
import { currentAccessToken, post, reinitialize, state } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";
import { takeNotice } from "./update.ts";

// The verdict a caller actually needs is not "it failed" but "may it have taken
// effect?" — and those are different sentences. A single "retry the call" over
// both is worse than silence: it is advice, and for a write with no version
// guard the advice duplicates the record without a trace.
export function syntheticError(
  id: JsonRpcMessage["id"],
  message: string,
  outcome: Outcome = UpstreamError.UNKNOWN,
  holdOff: boolean | "wait" | "knock" | "dead" | "human" = false,
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
          : kind === "dead"
            ? "Nothing was applied, and no retry and no wait will change that — only a human " +
              "with a new token can."
            : kind === "human"
              ? // The agent reads this; the human does not. A retry buys nothing
                // and a wait shortens nothing — only handing the link over does.
                "Nothing was applied, and only the human can move this: hand them the link above — " +
                "the login is already waiting for their click. Once they finish, retry the call."
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

// Сеть моргнула — мост стучит ещё раз сам, с растущей паузой, прежде чем
// отдать сбой агенту (граф nks-dev: #4664). Не дошедший вызов повторяется
// всегда; дошедший и потерявший ответ — только чтение: запись без ограды
// версии легла бы второй раз.
const NET_BACKOFF_MS = (process.env.ISKRON_BRIDGE_NET_BACKOFF_MS || "1000,2000,4000")
  .split(",")
  .map(Number)
  .filter((n) => Number.isFinite(n) && n >= 0);
const READ_TOOLS = new Set([
  "iskron_look",
  "iskron_orient",
  "iskron_search",
  "iskron_semantic_search",
]);

function isRead(msg: JsonRpcMessage): boolean {
  if (msg?.method === "initialize" || msg?.method === "tools/list") return true;
  return msg?.method === "tools/call" && READ_TOOLS.has(String(msg.params?.name ?? ""));
}

// Рукопожатие или список тулов упёрлись в сеть или во вход: харнес, получивший
// здесь отказ, считает сервер упавшим до перезапуска, а текст отказа не видит
// ни человек, ни агент (граф nks-dev: #4790). Последний ответ сервера лежит
// рядом с грантом — мост отвечает им, а сессия откроется, когда вернётся сеть
// или ляжет грант: следующий вызов без сессии переинициализируется сам и
// несёт агенту то, что мешает, — ссылку входа в том числе.
function lastServerAnswer(msg: JsonRpcMessage): JsonRpcMessage | null {
  const cache = loadServerCache();
  const result =
    msg?.method === "initialize"
      ? cache.init
      : msg?.method === "tools/list" && !msg.params?.cursor
        ? cache.tools
        : null;
  return result ? { jsonrpc: "2.0", id: msg.id, result } : null;
}

// Наш собственный клиент (плагин OpenCode, расширение pi) поднимает мост сам —
// лениво, повторно после простоя — и отказ рукопожатия читает сам, показывая
// человеку строку входа в своём окне: ему прежний отказ со ссылкой и прежний
// темп входа. Остальное рукопожатие — харнеса, то есть человека (#4790).
function ownClient(): boolean {
  const info = (state.initParams as { clientInfo?: { name?: unknown } } | null)?.clientInfo;
  return typeof info?.name === "string" && OWN_CLIENTS.has(info.name);
}

/** Строка отставания поставки — один раз за сессию, в первый же ответ тула: агент передаст её человеку. */
function withNotice(reply: JsonRpcMessage): JsonRpcMessage {
  const content = reply?.result?.content;
  if (!Array.isArray(content)) return reply; // ошибка без тела — строка ждёт следующего ответа
  const notice = takeNotice();
  if (notice && !content.some((c) => c?.text?.includes("ПОСТАВКА ОТСТАЛА"))) {
    content.push({ type: "text", text: notice });
  }
  return reply;
}

// Deliver one harness message upstream, with one auth retry and one session
// retry. On final failure a request id is ALWAYS answered with an error.
export async function deliver(msg: JsonRpcMessage): Promise<void> {
  // Слово о занятости не покидает моста: держатель сокета говорит его сам.
  const local = localStatus(msg);
  if (local) {
    emit(await local);
    return;
  }
  const isInit = msg?.method === "initialize";
  if (isInit) state.initParams = msg.params;
  const harness = !ownClient();
  const hasId = msg?.id !== undefined && msg?.id !== null;
  let authRetried = false;
  let sessionRetried = false;
  let netTries = 0;
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
  const isStand = isStandCall(msg);
  let heldReply: JsonRpcMessage | null;
  let standingRetried = false;
  const forward = (m: JsonRpcMessage) => {
    if (isInit && m.id === msg.id && m.result?.protocolVersion) {
      state.protocolVersion = m.result.protocolVersion;
    }
    if (m.id === msg.id) noteStanding(msg, m);
    if (m.id === msg.id && msg.method === "tools/list") annotateToolList(m);
    if (m.id === msg.id && m.result) {
      if (isInit) saveServerCache({ init: m.result });
      else if (msg.method === "tools/list" && !msg.params?.cursor)
        saveServerCache({ tools: m.result });
    }
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
      if (!isInit && !state.sessionId && state.initParams) {
        // The harness's own initialize was answered by us, not the server (a
        // deferred login, a refused token): upstream has no session for this
        // call, and a call without Mcp-Session-Id is refused outright. Open the
        // session now, with the params the harness gave — it will not ask again.
        log("no upstream session yet — initializing before the call");
        await reinitialize();
      }
      if (!isInit) await ensureStanding(); // the session may have turned over under us
      if (isStand) {
        // Тул моста: доска, место, хук, стук — теми же вызовами, что и агент, одним ходом.
        emit(withNotice(await runStand(msg)));
        return;
      }
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
        emit(withNotice(absorbRevokeReply(msg, absorbChannelReply(msg, held))));
      }
      return;
    } catch (e) {
      note(e);
      if (
        e instanceof UpstreamError &&
        e.kind === "network" &&
        e.retryable &&
        netTries < NET_BACKOFF_MS.length &&
        (e.outcome === UpstreamError.NOT_SENT || isRead(msg))
      ) {
        const pause = NET_BACKOFF_MS[netTries++];
        log(`${e.message} — knocking again in ${pause}ms (${netTries}/${NET_BACKOFF_MS.length})`);
        await new Promise((r) => setTimeout(r, pause));
        continue;
      }
      if (e instanceof UpstreamError && e.kind === "auth" && !authRetried) {
        authRetried = true;
        try {
          await ensureAuth(e.message, {
            force: true,
            rejected: e.presented,
            handshake: isInit && harness,
          });
          continue;
        } catch (authErr) {
          const standIn = hasId && harness ? lastServerAnswer(msg) : null;
          if (standIn) {
            log(`${msg.method} answered from the last server answer — ${errorMessage(authErr)}`);
            emit(standIn);
            return;
          }
          if (authErr instanceof TokenRefused) {
            if (hasId) emit(syntheticError(msg.id, authErr.message, outcome, "dead"));
            return;
          }
          if (authErr instanceof AuthPending || authErr instanceof LoginHeld) {
            // A held login names its own wait; AuthPending names a URL. The first
            // is repaired by time and must not be sold as "retry freely"; the
            // second is repaired by a human's click, and no waiting shortens it.
            if (hasId) {
              emit(
                syntheticError(
                  msg.id,
                  authErr.message,
                  outcome,
                  authErr instanceof LoginHeld ? "wait" : "human",
                ),
              );
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
      if (
        e instanceof UpstreamError &&
        (e.kind === "network" || (e.kind === "auth" && harness)) &&
        hasId
      ) {
        const cached = lastServerAnswer(msg);
        if (cached) {
          log(`${e.message} — ${msg.method} answered from the last server answer`);
          emit(cached);
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
