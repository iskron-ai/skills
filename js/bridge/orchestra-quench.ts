// The extinguishing half of the tact (graph @nks/nks-dev, nodes #5042, #8203, #7518, #6010,
// #8216, #11099): the raised tape tells which of OUR launches sat down and its composition at
// the greatest n (orchestra-fold.ts); the moment of the end is orchestra-quench-due.ts — the
// platform's idle_due for our seat (idle_warned only warns; the bridge counts no wakes), no
// join within the window, or, for OpenCode, a composition whose cases all closed or which stayed
// empty and silent for the idle window. The tape is read again from the fresh cursor first (any
// later signal cancels the end), then the seat gets a stop order with composition_empty and an
// idempotent client_id; a 409 answer leaves the agent alive, unrepeated. The orchestrator never
// revokes a seat silently and never touches a seat it did not launch.
import { createHash } from "node:crypto";

import { ORCHESTRA, type OrchestraWords } from "../delivery/index.ts";
import { namedFetch } from "../shared/http.ts";
import { words } from "../shared/lang.ts";
import { foldTape } from "./orchestra-fold.ts";
import { closedCases, type EndWhy, endWhy } from "./orchestra-quench-due.ts";
import type { Run } from "./orchestra-runs.ts";
export { foldTape } from "./orchestra-fold.ts";
export { closeEnded, expireLaunches, settleStops } from "./orchestra-run-ends.ts";
export { stopLapsed } from "./orchestra-window.ts";

const w = (): OrchestraWords => words(ORCHESTRA);
const TIMEOUT_MS = 10_000;

type Signal = Record<string, unknown>;

async function order(base: string, token: string, r: Run, key: string, why: EndWhy) {
  const res = await namedFetch(`${base}/standings/${encodeURIComponent(r.standing_id!)}/stop`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-nks-realm": r.realm,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      reason_code: "composition_empty",
      client_id: `orchestra-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`,
      // The signal's n: the server lays the order only if no newer signal came (#7518).
      ...(why !== "no_join" && r.n !== undefined ? { if_signal_n: r.n } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { id?: unknown };
  return { status: res.status, id: typeof body.id === "string" ? body.id : "" };
}

/**
 * Extinguish our raised seats whose composition ended them (orchestra-quench-due.ts).
 * `reread(realm)` reads the tape again from the fresh cursor — the re-check before the end
 * (#8203); a failed re-read orders nothing. A caller gone (#8202) stops it before the next order.
 */
export async function quench(
  base: string,
  token: string,
  runs: Record<string, Run>,
  reread: (realm: string) => Promise<Signal[]>,
  gone?: { gone: boolean },
  now = Date.now(),
): Promise<string[]> {
  const said: string[] = [];
  const closed = await closedCases(base, token, runs);
  for (const [key, r] of Object.entries(runs).filter(([, r]) => endWhy(r, closed, now))) {
    if (gone?.gone) break;
    try {
      foldTape(r.realm, await reread(r.realm), runs, now);
      // The re-read may outlast the caller: no order after it left.
      if (gone?.gone) break;
      const due = endWhy(r, closed, now);
      if (!due) {
        said.push(w().leadRow(r.realm, r.room, r.invite, "composition_changed"));
        continue;
      }
      const got = await order(base, token, r, key, due);
      // Never sat within the window (#9970) or ended by our own reading (#11099): the reason
      // is said before the stop's outcome.
      const why = due === "idle_due" || due === "no_join" ? (r.sat ? "" : "no_join, ") : `${due}, `;
      if (got.status >= 200 && got.status < 300) {
        r.state = "stopping";
        r.stopping_at = new Date(now).toISOString();
        if (got.id) {
          r.order_id = got.id;
          r.orders = [...(r.orders ?? []), got.id];
        }
        said.push(w().leadRow(r.realm, r.room, r.invite, `${why}stop_ordered`));
      } else if (got.status === 410) {
        // A missing seat proves neither exec exit nor durable suppression (#9256).
        // Keep the live Run available to the exact-client observer.
        if (!r.exec && !r.tree) r.state = "ended";
        said.push(w().leadRow(r.realm, r.room, r.invite, `${why}seat_gone`));
      } else if (got.status === 409 && due !== "no_join") {
        // The platform saw a live composition (#7518): the agent lives, the order is not repeated
        // until a newer signal — it sits somewhere, so the no-join window no longer applies.
        delete r.idle_due;
        r.sat = true;
        if (r.n !== undefined) r.live_n = r.n;
        said.push(w().leadRow(r.realm, r.room, r.invite, "composition_changed"));
      } else said.push(w().leadRow(r.realm, r.room, r.invite, `${why}stop_refused_${got.status}`));
    } catch (e) {
      said.push(w().leadRow(r.realm, r.room, r.invite, `stop_unsent (${(e as Error).message})`));
    }
  }
  return said;
}
