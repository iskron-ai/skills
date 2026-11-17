// The source's pace limit met by register (graph @nks/nks-dev, node #10801): the bridge
// is the second belt behind the platform's fuse — a 429 rate_limited refusal names its
// Retry-After in the body, `errors[0].data.retry_after_secs` of the ProblemDetail (api
// 0.202.0; the HTTP answer also carries a Retry-After header, but the refusal view holds
// no headers — refusal.ts reads the _meta refusal the api builds from the body), and the
// move waits exactly that inside itself and registers again, so an honest burst over the
// source's allowance still takes its seat. Any other 429 (source_paused — the fuse's own
// word is "do not retry") and every other refusal return as they came. The wait shares
// the reissue loop's stop watch (standmoves.ts, #7552).
import { RATE_LIMIT_WAIT_S } from "../shared/ratelimit.ts";
import { type EndWatch, endWatch, type StopWatch, stopWatch } from "./holdstate.ts";
import { type Refusal } from "./refusal.ts";
import { awaitReissue } from "./standmoves.ts";

/** At most this many register tries behind one move, however long each waited. */
const RATE_LIMIT_TRIES = 3;

/**
 * Seconds the api names on a 429 rate_limited refusal of register — the ProblemDetail's
 * `errors[0].data.retry_after_secs`, an integer the api puts into the refusal's `data`
 * verbatim (refusal.ts; #10801); `data` also carries `key` ("opening" at a seat
 * registration) and sometimes `kind`, and carries no `retry_after`. null — any other
 * answer, or a rate_limited without the seconds: without the source's own word how
 * long, the move does not guess.
 */
export function rateLimitedWait(r: { isError: boolean; refusal?: Refusal }): number | null {
  if (!r.isError || r.refusal?.rule !== "rate_limited" || r.refusal.status !== 429) return null;
  const said = r.refusal.data?.retry_after_secs;
  const s = typeof said === "number" ? said : Number(said);
  return Number.isFinite(s) && s > 0 ? s : null;
}

export interface RateLimited<R> {
  /**
   * the last answer, whatever it is — the caller reads it exactly as without the wait;
   * null — the move was stopped, or this seat ended, before the first call: nothing was sent
   */
  r: R | null;
  /** seconds actually waited out behind this call (the waits that ran, added up) */
  waitS: number;
  /** the stop word: the move was stopped before a call or during a wait; null — not stopped */
  stop: string | null;
  /** this seat ended in the move (a seat beside forgotten): no more register of it; the move goes on */
  ended: boolean;
}

/**
 * One register move (#7439, #10801, #11030): the rebind, the disk return, the skills refresh,
 * the explicit stand — each begins one and passes it to every register of the move, the
 * seats beside included. It carries its halves together, so no path takes one without the
 * others: the stop watch counted from the move's start (holdstate.ts stopWatch) — a stop
 * ends the whole move; the watch of its seats (endWatch) — a seat beside forgotten since the
 * start registers no more, the rest go on; the 429 wait budget left to the move
 * (../shared/ratelimit.ts) — the client's cap holds.
 */
export interface RegisterMove {
  /** the stop word since the move began; null — not stopped */
  readonly stopped: StopWatch;
  /** whether the seat `key` (holdrecord.ts keyOf) ended since the move began */
  readonly ended: EndWatch;
  /** seconds of Retry-After the move may still wait */
  leftS: number;
}
export const registerMove = (stopped: StopWatch = stopWatch()): RegisterMove => ({
  stopped,
  ended: endWatch(),
  leftS: RATE_LIMIT_WAIT_S,
});

/**
 * `call` registers the seat `seat` (its key) — answered 429 rate_limited, wait out the api's
 * Retry-After and call again, inside the same move: at most RATE_LIMIT_TRIES tries, and a wait
 * past the move's budget left (`move.leftS`, spent here) is not started. Before every call,
 * the first one too, and through the wait the move is asked: stopped — the move ends with no
 * further call, the stopped session stands nowhere, its next seat sees the same watch; this
 * seat ended — no further call of it (`ended`), the caller goes on to the next seat.
 * `waitOf` says the seconds of an answer, null — not a rate limit (an Answer or a raw reply).
 */
export async function throughRateLimit<R>(
  call: () => Promise<R>,
  waitOf: (r: R) => number | null,
  move: RegisterMove,
  seat: string,
): Promise<RateLimited<R>> {
  let waitS = 0;
  let last: R | null = null;
  for (let tries = 1; ; tries++) {
    const stop = move.stopped();
    if (stop || move.ended(seat)) return { r: last, waitS, stop, ended: !stop };
    const r = (last = await call());
    const wait = waitOf(r);
    if (wait === null || tries >= RATE_LIMIT_TRIES || wait > move.leftS)
      return { r, waitS, stop: null, ended: false };
    // The seat's end cuts its wait short too (the reissue loop's `held` — here: nothing to wait for).
    const cut = await awaitReissue(wait, () => move.ended(seat), move.stopped);
    if (cut.stop || cut.own) continue; // cut short: the loop's head returns, nothing spent
    waitS += wait;
    move.leftS -= wait;
  }
}

/**
 * throughRateLimit over an Answer-shaped reply (call.ts) with rateLimitedWait as the waitOf —
 * the register paths: the rebind (standing.ts), the disk return (resume.ts, besideback.ts),
 * the explicit stand's return (stand.ts). One wait, shared, never a second one beside it.
 */
export const throughRateLimitAnswer = <R extends { isError: boolean; refusal?: Refusal }>(
  call: () => Promise<R>,
  move: RegisterMove,
  seat: string,
): Promise<RateLimited<R>> => throughRateLimit(call, rateLimitedWait, move, seat);
