// A satellite's deferred end by its own socket's token (graph @nks/nks-dev, nodes #7621, #7505):
// a lead subagent that ended with no bridge of its own is taken off by its launcher's bridge —
// not by a revoke by name, which would take a seat another holder re-took under the same name
// meanwhile, but by the stop of the child's own socket (deadstop.ts stopBySocket): it ends only
// seats that socket still holds, the check and the end in one transaction. The satellite writes
// its socket address beside the grant at each hold (a satellite keeps no hold record); the
// launcher's bridge reads it on the plugin's `stopseat` and stops by it. No record — nothing is
// stopped: the seat lapses by its term; no board read checks the holder (#11351).
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

import { method } from "../delivery/index.ts";
import { stopFilePathOf } from "../shared/standings.ts";
import { CFG } from "./config.ts";
import { stopBySocket } from "./deadstop.ts";
import { writeOwned } from "./doorfiles.ts";
import { log } from "./streams.ts";
import { type JsonRpcMessage } from "./types.ts";

/** The satellite's socket at its hold: the token its deferred end stops by. */
export function writeStopRecord(key: string, url: string): void {
  const path = stopFilePathOf(CFG.authDir, key);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeOwned(path, JSON.stringify({ key, url, at: Date.now() }) + "\n");
  } catch (e) {
    log(`stop record of ${key} not written: ${(e as Error).message}`);
  }
}

const dropStopRecord = (key: string): void => {
  try {
    unlinkSync(stopFilePathOf(CFG.authDir, key));
  } catch {}
};

function urlOf(key: string): string | null {
  try {
    const r = JSON.parse(readFileSync(stopFilePathOf(CFG.authDir, key), "utf8")) as {
      url?: unknown;
    };
    return typeof r?.url === "string" ? r.url : null;
  } catch {
    return null;
  }
}

/**
 * The plugin's `stopseat {key}`: the child's seat stopped by its socket's token. The answer —
 * stopped (with the ids really ended), moved (the token is not current: another holder has the
 * seat now — left alone), absent (an api without the stop), unknown (with why), or no record.
 */
export function localStopSeat(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== method("stopseat")) return null;
  const answer = (result: unknown): JsonRpcMessage => ({ jsonrpc: "2.0", id: msg.id, result });
  const key = (msg.params as { key?: unknown } | undefined)?.key;
  const url = typeof key === "string" ? urlOf(key) : null;
  if (typeof key !== "string" || !url) {
    log(`stopseat ${String(key)}: no stop record — the seat lapses by its term`);
    return Promise.resolve(answer({ how: "none", why: "no stop record", ended: [] }));
  }
  return stopBySocket(url).then(({ how, why, ended }) => {
    log(`stopseat ${key}: ${how} (${why})`);
    if (how === "stopped" || how === "moved") dropStopRecord(key);
    return answer({ how, why, ended });
  });
}
