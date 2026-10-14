// A dead agent's seats after the death window (graph @nks/nks-dev, node #7493; case №677): the
// main seat ends by its dead socket's own token — POST <api>/channel/ws/{token}/stop (case №675,
// api 0.124.0) ends it only while {token} is still the seat's current ws token, the check and the
// end in one transaction, so a holder who took the name in the window keeps it. An api without
// the stop falls back to the board's check and a revoke by name: there a holder taking the name
// between the check and the revoke loses its seat — the race this stop closes.
import { apiBase } from "../shared/channel.ts";
import { revokeOwnPlaces, revokeSatellitePlaces } from "./caseexit.ts";
import { dropConfirmed, seatKeyOf, stillOwn } from "./deadseat.ts";
import { dropHoldRecord } from "./holdrecord.ts";
import { log } from "./streams.ts";
import { type Standing } from "./transport.ts";

/** The 404 rule of a token that is not current: reissued, the channel or the seat ended. */
const NOT_CURRENT = "ws_token_not_current";

type Stop = "stopped" | "moved" | "absent" | "unknown";

/** errors[0].rule of a ProblemDetail body; null — no rule (or no JSON). */
function ruleOf(body: string): string | null {
  try {
    const rule = (JSON.parse(body) as { errors?: { rule?: unknown }[] })?.errors?.[0]?.rule;
    return typeof rule === "string" ? rule : null;
  } catch {
    return null;
  }
}

/** The stop by the dead socket's token, read as stopped, moved (not ours), absent (old api) or unknown. */
async function stopBySocket(socketUrl: string): Promise<{ how: Stop; why: string }> {
  const token = new URL(socketUrl).pathname.split("/channel/ws/")[1];
  if (!token) return { how: "absent", why: "no token in the socket address" };
  let res: Response;
  try {
    res = await fetch(`${apiBase(socketUrl)}/channel/ws/${token}/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    return { how: "unknown", why: (e as Error).message };
  }
  const body = (await res.text().catch(() => "")).trim();
  const why = `${res.status} ${body.slice(0, 120)}`;
  if (res.ok) return { how: "stopped", why };
  if (res.status === 405) return { how: "absent", why };
  if (res.status !== 404) return { how: "unknown", why };
  const rule = ruleOf(body);
  return { how: rule === NOT_CURRENT ? "moved" : rule ? "unknown" : "absent", why };
}

/**
 * Closes the dead seats no live bridge of this machine holds again. `main` — the channel's main
 * seat among them with its dead socket's address, or null. The seats beside go first by the
 * board (the platform keeps a main seat while seats of other graphs stand on it), then the main
 * one by its token; an old api — by the board too.
 */
export async function closeDeadSeats(
  places: Standing[],
  main: { seat: Standing; socket: string } | null,
  status: string | null,
): Promise<void> {
  const byBoard = async (seats: Standing[]): Promise<Standing[]> => {
    const own: Standing[] = [];
    for (const s of seats) if (await stillOwn(s, status)) own.push(s);
    return own;
  };
  const say = (): void =>
    log(`the agent's session ended without an announced absence — closing its seats (#7493)`);
  const beside = await byBoard(places.filter((s) => s !== main?.seat));
  if (beside.length) say();
  if (!main) {
    if (beside.length) dropConfirmed(beside, (await revokeOwnPlaces(beside)).revoked);
    return;
  }
  if (beside.length) dropConfirmed(beside, (await revokeSatellitePlaces(beside)).revoked);
  const key = seatKeyOf(main.seat);
  const { how, why } = await stopBySocket(main.socket);
  if (how === "stopped" || how === "moved") {
    if (how === "stopped" && !beside.length) say();
    log(
      how === "stopped"
        ? `${key} ended by its dead socket's token (${why})`
        : `${key}: its dead socket's token is not current — another holder took it or it ended, not closed; the own hold record dropped`,
    );
    dropHoldRecord(key);
    return;
  }
  if (how === "unknown") {
    log(
      `${key}: the stop by its token did not answer: ${why} — not closed, the seat goes by the platform's term`,
    );
    return;
  }
  log(`${key}: no stop by token on this api (${why}) — the board's check and a revoke by name`);
  if (!(await stillOwn(main.seat, status))) return;
  if (!beside.length) say();
  dropConfirmed([main.seat], (await revokeOwnPlaces([main.seat])).revoked);
}
