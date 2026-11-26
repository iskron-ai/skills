// The human's rules (shared/mindslice.ts, graph @nks/nks-dev, #9817) read by the session's own
// bridge as a service move — not the agent's work: after a compaction and at a root's start.
// One slice per server and account for the whole plugin process (shared/mindcache.ts), both as
// the reading bridge names them: the account is asked of the bridge on EVERY read — the bridge
// alone sees the token it presents (a personal token it started with, or the OAuth access token
// of the store, which a new login switches under the same bridge) and keeps whoami per that
// token's fingerprint (bridge ownwhoami.ts) — and the server is the one THAT bridge speaks to (a
// `use` may point a newer bridge at another server than an older one still live). A bridge of
// an older build names no server: its slice is its own, shared with no other bridge.
import { randomUUID } from "node:crypto";

import { method } from "../delivery/index.ts";
import type { Bridge } from "../shared/bridge-client.ts";
import { type MindCall, mindSlice, type MindSliceOptions, whoami } from "../shared/mindslice.ts";
import { textOf } from "./bridge-io.ts";

/** The platform's answer — no longer than this. */
const SLICE_MS = 10_000;
/** JSON-RPC «no such method»: a bridge of an older build. */
const NO_METHOD = -32601;

/** A bridge that names no server: a key of its own, never another bridge's. */
const alone = new WeakMap<object, string>();
const aloneOf = (bridge: object): string => {
  let k = alone.get(bridge);
  if (!k) alone.set(bridge, (k = `opencode\nbridge ${randomUUID()}`));
  return k;
};

/**
 * The bridge's `whoami` — its kept answer for the token it presents now, and its server. A bridge
 * of an older build does not know the method (no such method, or the server's answer without a
 * handle): its whoami is a call of its own, by the same token, and its slice is its own.
 */
async function identityBy(
  bridge: Pick<Bridge, "request">,
  call: MindCall,
): Promise<{ handle: string; server: string }> {
  let got: { handle?: unknown; server?: unknown } | null;
  try {
    got = (await bridge.request(method("whoami"), {}, { timeoutMs: SLICE_MS, service: true })) as {
      handle?: unknown;
      server?: unknown;
    } | null;
  } catch (e) {
    if ((e as { code?: unknown })?.code !== NO_METHOD) throw e;
    got = null;
  }
  const handle = typeof got?.handle === "string" && got.handle ? got.handle : await whoami(call);
  const server =
    typeof got?.server === "string" && got.server ? `opencode\n${got.server}` : aloneOf(bridge);
  return { handle, server };
}

/** Compaction opts into strict failures; root starts keep the default soft diagnostic (#9817). */
export function sliceBy(
  bridge: Pick<Bridge, "request">,
  options: MindSliceOptions = {},
): Promise<string> {
  const call: MindCall = async (name, args) => {
    const got = (await bridge.request(
      "tools/call",
      { name, arguments: args },
      { timeoutMs: SLICE_MS, service: true },
    )) as { isError?: boolean; structuredContent?: unknown } | null;
    return { isError: !!got?.isError, text: textOf(got), structured: got?.structuredContent };
  };
  return mindSlice(call, {
    ...options,
    cacheKey: bridge,
    identify: () => identityBy(bridge, call),
  });
}
