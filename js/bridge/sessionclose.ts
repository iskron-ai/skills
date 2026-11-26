// Closing the bridge's own MCP session (graph @nks/nks-dev, node #9174; the session — #188).
// A Streamable HTTP client that is done with a session ends it with a DELETE carrying its
// Mcp-Session-Id; otherwise the server keeps it until its own deadline. The bridge does so
// when it leaves and when it replaces a session the server still holds; a session the server
// already answered 404 for is not closed again. One attempt, bounded: a leave never hangs on
// the network, and a refusal is only written down.
//
// The machine's down window holds closes too (downwindow.ts, #11375): while a window stands —
// or has lapsed and waits for its probe — a close is not sent but kept, one per session id, in
// this process's memory; it is never the window's probe. Every close takes the return gate's
// turn as an open — at most two knocks in flight (returngate.ts) — and when a knock is answered
// and no window is left, the kept closes go the same way. A 404 is done (the server already lost it), never retried; a close that meets
// the window again is kept again. A process that exits with closes kept says so: the server
// ends those sessions by its own term.
import { envName } from "../delivery/index.ts";
import { namedFetch } from "../shared/http.ts";
import { scoped } from "../shared/scope.ts";
import { CFG } from "./config.ts";
import { onAnswered } from "./downwindow.ts";
import { DownError, errorMessage } from "./errors.ts";
import { throughGate } from "./returngate.ts";
import { grantLog, loadDown, sleep } from "./store.ts";
import { log } from "./streams.ts";
import { throughWindow } from "./windowfetch.ts";

/** How long a DELETE may take before the bridge stops waiting for it. */
const CLOSE_MS = Number(process.env[envName("BRIDGE_SESSION_CLOSE_MS")]) || 3_000;

export interface HeldSession {
  id: string;
  token: string | null;
  protocolVersion: string | null;
}

// Closes still on the wire, per bridge session: the leave waits for them (bounded by CLOSE_MS).
const flying = scoped(() => new Set<Promise<void>>());
// Closes the down window holds, for the whole process: one per session id.
const kept = new Map<string, { s: HeldSession; why: string }>();

const note = (line: string): void => {
  log(line);
  grantLog(line);
};

/** A session id the server issued, said as its close is: open and close pair up by the log (#9174). */
export function noteOpened(id: string): void {
  note(`opened upstream session ${id}`);
}

/** Close a session upstream; the leave awaits it through closesSettled. */
export function closeSession(s: HeldSession, why: string): Promise<void> {
  const p = gated(s, why);
  flying.add(p);
  void p.finally(() => flying.delete(p));
  return p;
}

/** The leave waits for its closes — no longer than a close may take and the gate's turn. */
export const closesSettled = (): Promise<unknown> =>
  Promise.race([Promise.allSettled([...flying]), sleep(2 * CLOSE_MS)]);

/** Every close takes the gate's turn as an open: at most two knocks in flight (returngate.ts). */
const gated = (s: HeldSession, why: string): Promise<void> =>
  throughGate(CFG.serverUrl, () => send(s, why), "open").catch((e: unknown) =>
    e instanceof DownError
      ? keep(s, why)
      : note(`closing upstream session ${s.id}: ${errorMessage(e)}`),
  );

function keep(s: HeldSession, why: string): void {
  if (!kept.size) process.once("exit", leftUnsent);
  kept.set(s.id, { s, why });
  note(`closing upstream session ${s.id} (${why}): kept — the server is down for the machine`);
}

function leftUnsent(): void {
  for (const id of kept.keys())
    note(`closing upstream session ${id}: not sent — the server ends it by its own term`);
}

// A knock answered and no window left: the kept closes go, at most two in flight.
onAnswered(() => {
  if (!kept.size || loadDown()) return;
  const all = [...kept.values()];
  kept.clear();
  process.removeListener("exit", leftUnsent);
  for (const { s, why } of all) void gated(s, why);
});

async function send(s: HeldSession, why: string): Promise<void> {
  // A window standing, or lapsed and waiting for its probe: the close is no knock of its own.
  if (loadDown()) return keep(s, why);
  const headers: Record<string, string> = { "mcp-session-id": s.id };
  if (s.token) headers.authorization = `Bearer ${s.token}`;
  if (s.protocolVersion) headers["mcp-protocol-version"] = s.protocolVersion;
  let outcome: string;
  try {
    const res = await throughWindow(() =>
      namedFetch(CFG.serverUrl, {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(CLOSE_MS),
      }),
    );
    res.body?.cancel?.().catch(() => {});
    outcome = `HTTP ${res.status}`;
  } catch (e) {
    if (e instanceof DownError) return keep(s, why);
    const timedOut = (e as { name?: string })?.name === "TimeoutError";
    outcome = timedOut ? `no answer within ${CLOSE_MS}ms` : errorMessage(e);
  }
  note(`closing upstream session ${s.id} (${why}): ${outcome}`);
}
