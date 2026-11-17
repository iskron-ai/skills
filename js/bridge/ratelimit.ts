// The source's pace limit met by register (graph @nks/nks-dev, node #10801): the bridge
// is the second belt behind the platform's fuse — a 429 rate_limited refusal names its
// Retry-After in the body, `errors[0].data.retry_after_secs` of the ProblemDetail (api
// 0.202.0; the HTTP answer also carries a Retry-After header, but the refusal view holds
// no headers — refusal.ts reads the _meta refusal the api builds from the body), and the
// move waits exactly that inside itself and registers again, so an honest burst over the
// source's allowance still takes its seat. Any other 429 (source_paused — the fuse's own
// word is "do not retry") and every other refusal return as they came. The wait shares
// the reissue loop's stop watch (standmoves.ts, #7552).
import { type Refusal } from "./refusal.ts";
import { awaitReissue } from "./standmoves.ts";

/** At most this many register tries behind one move, however long each waited. */
const RATE_LIMIT_TRIES = 3;
/** The whole move waits no longer than this many seconds of Retry-After, added up. */
const RATE_LIMIT_WAIT_S = 60;

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
  /** the last answer, whatever it is — the caller reads it exactly as without the wait */
  r: R;
  /** seconds actually waited out behind this call (the waits that ran, added up) */
  waitS: number;
}

/**
 * `call` answered 429 rate_limited — wait out the api's Retry-After and call again,
 * inside the same move: at most RATE_LIMIT_TRIES tries and RATE_LIMIT_WAIT_S of waiting
 * in total, and a wait that would pass the budget is not started. A stop of the session
 * or the seat during the wait (`stopped`, the reissue loop's watch) ends it with no
 * further try — the stopped session stands nowhere. `waitOf` says the seconds of an
 * answer, null — not a rate limit (ratelimit.ts reads an Answer or a raw reply alike).
 */
export async function throughRateLimit<R>(
  call: () => Promise<R>,
  waitOf: (r: R) => number | null,
  stopped: () => string | null,
): Promise<RateLimited<R>> {
  let waitS = 0;
  for (let tries = 1; ; tries++) {
    const r = await call();
    const wait = waitOf(r);
    if (wait === null || tries >= RATE_LIMIT_TRIES || waitS + wait > RATE_LIMIT_WAIT_S)
      return { r, waitS };
    const { stop } = await awaitReissue(wait, () => false, stopped);
    if (stop) return { r, waitS };
    waitS += wait;
  }
}
