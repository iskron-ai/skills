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

/** The dispatcher address beside the channel: <apiBase>/channel/mux, ws scheme. */
export const muxUrlOf = (socketUrl: string): string =>
  `${apiBase(socketUrl).replace(/^http/, "ws")}/channel/mux`;

/** A pause of the channel ladder, jittered below its step: never longer than the step. */
export function pauseOf(n: number): number {
  const step = FLAP_PAUSES_MS[Math.min(n, FLAP_PAUSES_MS.length - 1)] ?? 60_000;
  return Math.round(step * (0.8 + 0.2 * Math.random()));
}
