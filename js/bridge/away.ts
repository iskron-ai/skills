// Announced absence (graph @nks/nks-dev, node #7493): before a planned restart (a plugin
// reload, a move to another folder) the plugin says `away` — the session's end then keeps
// the seat and its hold record for the return of the same harness session. Without the
// mark the end is the agent's death: the daemon closes the seat after the window (runend.ts).
// `run_pid` (#6593, #11359): the absence of an instance serving one standalone run — it is an
// absence only while that run lives; the run gone within the window is the agent's end.
import { method } from "../delivery/index.ts";
import { scoped } from "../shared/scope.ts";
import { type JsonRpcMessage } from "./types.ts";

const A = scoped(() => ({ away: false, runPid: null as number | null }));

export const awayAnnounced = (): boolean => A.away;

/** The standalone run the absence lasts with; null — an absence of its own. */
export const awayRunPid = (): number | null => (A.away ? A.runPid : null);

/** The plugin's `away` request: the mark lies until the session ends. */
export function localAway(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== method("away")) return null;
  const pid = (msg.params as { run_pid?: unknown } | undefined)?.run_pid;
  A.away = true;
  A.runPid = typeof pid === "number" && Number.isSafeInteger(pid) && pid > 1 ? pid : null;
  return Promise.resolve({ jsonrpc: "2.0", id: msg.id, result: { away: true } });
}
