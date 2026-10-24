// What the dispatcher address answered (graph @nks/nks-dev, node #8620): a WebSocket that failed
// at the upgrade does not say its status, undici publishes it on its diagnostics channel before
// the socket's events. A runtime that publishes nothing (Bun) leaves the answer unknown.
import * as diagnostics from "node:diagnostics_channel";

import { apiBase, FLAP_PAUSES_MS } from "../shared/channel.ts";

const HEADERS = "undici:request:headers";

const watched = new Set<string>();
const answered = new Map<string, number>();
let listening = false;

function listen(): void {
  if (listening) return;
  listening = true;
  diagnostics.subscribe?.(HEADERS, (m: unknown) => {
    const r = m as {
      request?: { origin?: unknown; path?: unknown };
      response?: { statusCode?: unknown };
    } | null;
    const at = `${String(r?.request?.origin ?? "")}${String(r?.request?.path ?? "")}`;
    if (watched.has(at)) answered.set(at, Number(r?.response?.statusCode));
  });
}

/** Watch the upgrade answer of this ws address; the returned call reads it once and stops watching. */
export function watchAnswer(wsUrl: string): () => number | undefined {
  const at = wsUrl.replace(/^ws/, "http");
  listen();
  answered.delete(at);
  watched.add(at);
  return () => {
    watched.delete(at);
    const status = answered.get(at);
    answered.delete(at);
    return status;
  };
}

/**
 * The status of the dispatcher address asked by a plain GET — for an upgrade that failed with
 * its answer unseen (Bun, a cut): 404/405 there is the same "no dispatcher"; undefined — no
 * answer at all.
 */
export async function askAnswer(wsUrl: string): Promise<number | undefined> {
  try {
    const r = await fetch(wsUrl.replace(/^ws/, "http"), { signal: AbortSignal.timeout(5000) });
    void r.body?.cancel().catch(() => {});
    return r.status;
  } catch {
    return undefined;
  }
}

const NO_DISPATCHER = [404, 405];

/**
 * A failed opening judged (#8620 v11): `none` — a seen 404/405, no dispatcher; anything else
 * (a 5xx, a timeout, no answer even to the plain GET) — another try after a pause.
 */
export async function verdictOf(
  wsUrl: string,
  e: { code: number; status: number | undefined; timedOut: boolean },
): Promise<{ none: boolean; why: string }> {
  // The upgrade's answer unseen (Bun, a cut): the address is asked plainly, never guessed.
  const status = e.status ?? (e.timedOut ? undefined : await askAnswer(wsUrl));
  if (NO_DISPATCHER.includes(status ?? 0)) return { none: true, why: `answered ${status}` };
  const seen = [e.timedOut ? "timeout" : `refused (${e.code})`, status].filter(Boolean);
  return { none: false, why: `not reached (${seen.join(", ")})` };
}

/** The dispatcher address beside the channel: <apiBase>/channel/mux, ws scheme. */
export const muxUrlOf = (socketUrl: string): string =>
  `${apiBase(socketUrl).replace(/^http/, "ws")}/channel/mux`;

/** A pause of the channel ladder, jittered below its step: never longer than the step. */
export function pauseOf(n: number): number {
  const step = FLAP_PAUSES_MS[Math.min(n, FLAP_PAUSES_MS.length - 1)] ?? 60_000;
  return Math.round(step * (0.8 + 0.2 * Math.random()));
}
