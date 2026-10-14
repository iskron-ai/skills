// The owner's stop order (graph @nks/nks-dev, nodes #7509, #7510, #7519): it reaches the bridge
// by the socket's stop frame or by the open orders read on hello, and both meet here by order
// id. The frame is never the agent's. The order goes on disk, accepted is answered, the seat
// stops as when the owner takes it off (stophold.ts) and the outcome is answered — the api's
// taking of the outcome ends the seat (stopped — as by itself). The same id again gives the
// same outcome, not a second stop. Every bridge that knows orders executes them, with or
// without the orchestrator's flag (#7513). Wired into hold.ts at load (session.ts).
import { apiBase } from "../shared/channel.ts";
import { type Frame, whenOrdered } from "./holdstate.ts";
import { answerOutcome, openOrders, type Order, repeatLater, sendAck } from "./orderack.ts";
import { isTerminal, type OrderEntry, readOrder, writeOrder } from "./orderjournal.ts";
import { holdsSeat, stopSeatByOrder } from "./stophold.ts";
import { sleep, standingLog } from "./store.ts";
import { log } from "./streams.ts";

/** Orders this process is executing or has executed: a second arrival is the same order. */
const taken = new Set<string>();
const ACCEPT_CAP_MS = 2000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function orderOf(frame: Frame): Order | null {
  const id = str(frame.order_id);
  const standing = str(frame.standing_id);
  if (!id || !standing) return null;
  return { id, standing_id: standing, reason_code: str(frame.reason_code), by: str(frame.by) };
}

async function execute(o: Order, base: string, framed: boolean): Promise<void> {
  const known = readOrder(o.id);
  if (known && isTerminal(known.state)) {
    log(`stop order ${o.id} again — the same outcome ${known.state}, no second stop`);
    return answerOutcome(known);
  }
  // The read lists every seat of the account: one this session does not hold is another's.
  if (taken.has(o.id) || (!framed && !holdsSeat(o.standing_id, false))) return;
  taken.add(o.id);
  const entry: OrderEntry = {
    id: o.id,
    standing: o.standing_id,
    state: "accepted",
    base,
    acked: false,
    at: Date.now(),
  };
  let end: OrderEntry;
  if (!holdsSeat(o.standing_id, true))
    end = { ...entry, state: "refused", reason: "seat_not_held" };
  else {
    if (!writeOrder(entry))
      log(`stop order ${o.id}: the journal refused the entry — executed all the same`);
    // accepted before the act; an api out of reach does not hold the stop longer than the cap.
    await Promise.race([sendAck(base, o.id, "accepted"), sleep(ACCEPT_CAP_MS)]);
    try {
      end = stopSeatByOrder(o.standing_id, o.by ?? "", o.id)
        ? { ...entry, state: "stopped" }
        : { ...entry, state: "unknown", reason: "seat_gone_before_stop" };
    } catch (e) {
      log(`stop order ${o.id}: the stop failed — ${(e as Error).message}`);
      end = { ...entry, state: "failed", reason: "stop_failed" };
    }
  }
  standingLog(
    `stop order ${o.id} for ${o.standing_id}: ${end.state}${end.reason ? ` (${end.reason})` : ""}`,
  );
  writeOrder(end);
  await answerOutcome(end);
}

/**
 * One handler for both ways in: the stop frame (taken: true), and the socket's hello — the open
 * orders read; its answer comes after hello.standings named the seats' ids (hold.ts).
 */
function onOrder(url: string, frame: Frame | null): boolean {
  const base = apiBase(url);
  if (frame?.type === "hello") {
    repeatLater(true); // a new socket — a new chance for outcomes the api has not taken
    void openOrders(base).then((orders) => {
      for (const o of orders) void execute(o, base, false);
    });
    return false;
  }
  if (frame?.type !== "stop") return false;
  const o = orderOf(frame);
  if (!o) log(`stop frame without order_id or standing_id — ignored, not given to the agent`);
  else void execute(o, base, true);
  return true;
}

whenOrdered(onOrder);
