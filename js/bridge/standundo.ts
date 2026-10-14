// One rule for the stand call's move (graph @nks/nks-dev, nodes #7439, #7553): the seat its
// connect took stays only if the move went through. The session stopped since the call began —
// the new seat is taken off again and the answer is the stop word; register refused after
// connect — the new seat is taken off and the session goes back to the seat it stood on.
import { STAND_MOVES, type StandMovesWords, tool } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { type Answer, callTool, short } from "./call.ts";
import { forgetSeat, holdsStanding, holdStanding, keyOf } from "./hold.ts";
import { H, setRevokingOwn, stoppedDuring } from "./holdstate.ts";
import { holdWords } from "./holdwords.ts";
import { placeFields } from "./placefields.ts";
import { refusedWord, type Reissued, revokeCall, throughReissue } from "./standmoves.ts";
import { sw } from "./standwords.ts";
import { type Standing, state } from "./transport.ts";

const mw = (): StandMovesWords => words(STAND_MOVES);

/** The main seat's socket before the move: the former seat is held on it again if the move is undone. */
export interface HeldAddress {
  url: string;
  statusUrl: string | null;
}
export const heldAddress = (realm: string, prior: Standing | null): HeldAddress | null =>
  prior && holdsStanding(realm, prior.karta, prior.name ?? "") && H.currentUrl
    ? { url: H.currentUrl, statusUrl: H.currentStatusUrl }
    : null;

/** The call's connects run under the stop count `before`: a stop meanwhile leaves their answer unheld (absorb.ts). */
async function inMove<T>(before: number, fn: () => Promise<T>): Promise<T> {
  H.moveSince = before;
  try {
    return await fn();
  } finally {
    H.moveSince = null;
  }
}

/**
 * The move's connect — `first`, a 429 of a socket reissue waited out and connected `again` —
 * under the stop count; `taken` — the seat this connect took; `stop` — the stop word, that seat off again.
 */
export async function connectInMove(
  before: number,
  seat: Required<Standing>,
  again: () => Promise<Answer>,
  first: () => Promise<Answer>,
): Promise<Reissued & { taken: Required<Standing> | null; stop: string | null }> {
  const re = await inMove(before, async () => throughReissue(await first(), again, seat, before));
  const taken = !re.c.isError && !re.own ? seat : null;
  return { ...re, taken, stop: await stopInMove(before, taken) };
}

/**
 * Take the seat just taken off again, quietly: held — as an own revoke, not a stop; unheld (its
 * answer came after a stop) — the platform alone. A seat the owner's stop already took off is
 * left. null — revoked; otherwise the word with the revoke call.
 */
async function dropTaken(seat: Required<Standing>): Promise<string | null> {
  const { realm, karta, name } = seat;
  const own = holdsStanding(realm, karta, name);
  if (!own && H.stopped.key === keyOf(realm, karta, name)) return null;
  if (own) setRevokingOwn(true);
  const args = { action: "revoke", realm, karta: String(karta), standing: name };
  const r = await callTool(tool("channel"), args).finally(() => {
    if (own) setRevokingOwn(false);
  });
  if (r.isError) return mw().moveNotUndone(name, short(r.text, 160), revokeCall(realm, seat));
  if (own && holdsStanding(realm, karta, name)) forgetSeat(holdWords().revokedOwn());
  return null;
}

/** The stop word if the session was stopped since `before`, the seat just taken taken off again; otherwise null. */
export async function stopInMove(
  before: number,
  seat: Required<Standing> | null,
): Promise<string | null> {
  const stop = stoppedDuring(before);
  if (!stop) return null;
  const left = seat ? await dropTaken(seat) : null;
  return left ? `${stop}\n${left}` : stop;
}

/**
 * register `r` refused right after connect. A move (`taken` from `prior`) fails: the new seat
 * goes, the former one is held again on its socket and registered, so it stays the session's
 * only seat (#7553). Otherwise the seat stays taken. The answer's words.
 */
export async function registerRefused(
  r: Answer,
  realm: string,
  taken: Required<Standing> | null,
  prior: Standing | null,
  addr: HeldAddress | null,
): Promise<string> {
  const text = short(r.text);
  if (!taken || !prior) return refusedWord("register", r, realm, sw().takenButRegister(text));
  const refusal = refusedWord("register", r, realm, sw().refused("register", text));
  const left = await dropTaken(taken);
  if (left) return `${refusal}\n${left}`;
  state.standing = { ...prior };
  if (addr) holdStanding(addr.url, addr.statusUrl);
  const back = await callTool(tool("channel"), {
    action: "register",
    ...prior,
    ...placeFields(prior, true),
  });
  const word = mw().moveUndone(taken.name, prior.name ?? "");
  return `${refusal}\n${back.isError ? `${word} register: ${short(back.text, 160)}` : word}`;
}
