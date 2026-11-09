// A stop on demand of a seat we raised (graph @nks/nks-dev, nodes #7509, #7518, #5042; case
// №4050 [90]): a person or another agent orders our seat to stop — not the orchestrator. The
// seat's own bridge carries the order out; the tact learns it from the account's orders
// (GET /me/orders, every state, from the daemon's cursor): an order on a live run's seat that
// is not the run's own makes it stopping (settleStops ends it when the order closes), a closed
// one ends it at once — then closeEnded closes its terminal and its limit slot is free. The
// raised tape says no revoke, and an open-only read misses an order carried out between tacts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ORCHESTRA, type OrchestraWords } from "../delivery/index.ts";
import { namedFetch } from "../shared/http.ts";
import { words } from "../shared/lang.ts";
import { seamRunDir } from "../shared/seam-entrance.ts";
import type { Run } from "./orchestra-runs.ts";

const w = (): OrchestraWords => words(ORCHESTRA);
const LIMIT = 200;
const MAX_PAGES = 50;
const OPEN = new Set(["issued", "accepted"]);

const cursorFile = (authDir: string): string => join(seamRunDir(authDir), "orchestra-orders.json");

function readSince(authDir: string): number {
  try {
    const n = (JSON.parse(readFileSync(cursorFile(authDir), "utf8")) as { since?: unknown }).since;
    return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeSince(authDir: string, since: number): void {
  mkdirSync(seamRunDir(authDir), { recursive: true, mode: 0o700 });
  writeFileSync(cursorFile(authDir), JSON.stringify({ since }) + "\n", { mode: 0o600 });
}

/** Mark our live runs whose seat got someone else's stop order; a failed read changes nothing. */
export async function foreignStops(
  authDir: string,
  base: string,
  token: string,
  runs: Record<string, Run>,
): Promise<string[]> {
  const said: string[] = [];
  const bySeat = new Map<string, Run>();
  for (const r of Object.values(runs))
    if ((r.state === "launched" || r.state === "raised") && r.standing_id)
      bySeat.set(r.standing_id, r);
  let since = readSince(authDir);
  try {
    for (let n = 0; n < MAX_PAGES; n++) {
      const res = await namedFetch(`${base}/me/orders?limit=${LIMIT}&since=${since}`, {
        headers: { authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const body = (await res.json()) as { items?: unknown; next_since?: unknown };
      if (!Array.isArray(body.items)) throw new Error("invalid_items");
      if (!body.items.length) break;
      for (const v of body.items as Record<string, unknown>[]) {
        const seat = String(v.standing_id ?? "");
        const run = bySeat.get(seat);
        const id = typeof v.id === "string" ? v.id : "";
        if (!run || !id || id === run.order_id) continue;
        bySeat.delete(seat);
        run.order_id = id;
        const open = OPEN.has(String(v.state));
        run.state = open ? "stopping" : "ended";
        said.push(
          w().leadRow(
            run.realm,
            run.room,
            run.invite,
            open ? "stop_ordered_elsewhere" : "stopped_elsewhere",
          ),
        );
      }
      const next = body.next_since;
      if (typeof next !== "number" || !Number.isSafeInteger(next) || next <= since)
        throw new Error("pagination_stalled");
      since = next;
    }
  } catch (e) {
    said.push(w().leadOrdersUnread((e as Error).message));
  }
  writeSince(authDir, since);
  return said;
}
