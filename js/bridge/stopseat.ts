// A satellite's deferred end by its own socket's token (graph @nks/nks-dev, nodes #7621, #7505):
// a lead subagent that ended with no bridge of its own is taken off by its launcher's bridge —
// not by a revoke by name, which would take a seat another holder re-took under the same name
// meanwhile, but by the stop of the child's own socket (deadstop.ts stopBySocket): it ends only
// seats that socket still holds, the check and the end in one transaction. The satellite writes
// its socket address beside the grant at each hold, with that hold's incarnation (stoprecord.ts);
// the launcher's bridge reads it on the plugin's `stopseat {key, incarnation}` and stops by it —
// only a record of the asked incarnation: a newer satellite of the same seat key is never stopped
// by an older child's end. No record, or another incarnation — nothing is stopped: the seat
// lapses by its term; no board read checks the holder (#11351).
import { method } from "../delivery/index.ts";
import { stopBySocket } from "./deadstop.ts";
import { dropStopRecord, readStopRecord } from "./stoprecord.ts";
import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

/**
 * The plugin's `stopseat {key, incarnation}`: the child's seat stopped by its socket's token.
 * The answer — stopped (with the ids really ended), moved (the record is of another incarnation,
 * or the token is not current: another holder has the seat now — left alone), absent (an api
 * without the stop), unknown (with why), or none (no record, or no incarnation asked).
 */
export function localStopSeat(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== method("stopseat")) return null;
  const answer = (result: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id: msg.id, result });
  const p = (msg.params ?? {}) as { key?: unknown; incarnation?: unknown };
  const key = typeof p.key === "string" ? p.key : null;
  const incarnation = typeof p.incarnation === "string" && p.incarnation ? p.incarnation : null;
  const rec = key ? readStopRecord(key) : null;
  if (!key || !incarnation || !rec) {
    const why = !incarnation ? "no incarnation asked" : "no stop record";
    log(`stopseat ${String(p.key)}: ${why} — the seat lapses by its term`);
    return Promise.resolve(answer({ how: "none", why, ended: [] }));
  }
  if (rec.incarnation !== incarnation) {
    log(`stopseat ${key}: the record is of a newer holder — left alone`);
    return Promise.resolve(answer({ how: "moved", why: "another incarnation", ended: [] }));
  }
  return stopBySocket(rec.url).then(({ how, why, ended }) => {
    log(`stopseat ${key}: ${how} (${why})`);
    if (how === "stopped" || how === "moved") dropStopRecord(key, incarnation);
    return answer({ how, why, ended });
  });
}
