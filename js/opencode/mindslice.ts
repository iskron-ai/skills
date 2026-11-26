// The human's rules (shared/mindslice.ts, graph @nks/nks-dev, #9817) read by the session's own
// bridge as a service move — not the agent's work: after a compaction and at a root's start.
// One slice per server and account for the whole plugin process (shared/mindcache.ts). The
// account is asked of the bridge on EVERY read: the bridge alone sees the token it presents —
// a personal token it started with, or the OAuth access token of the store, which a new login
// switches under the same bridge — and keeps whoami per that token's fingerprint (bridge
// ownwhoami.ts). Nothing here remembers an account, and nothing on disk names one.
import { envName, method } from "../delivery/index.ts";
import type { Bridge } from "../shared/bridge-client.ts";
import { type MindCall, mindSlice, type MindSliceOptions, whoami } from "../shared/mindslice.ts";
import { textOf } from "./bridge-io.ts";

/** The platform's answer — no longer than this. */
const SLICE_MS = 10_000;
/** JSON-RPC «no such method»: a bridge of an older build. */
const NO_METHOD = -32601;

/** The cache's server part; the account that completes the key is the bridge's whoami now. */
const server = (): string => `opencode\n${process.env[envName("BRIDGE_URL")]?.trim() ?? ""}`;

/**
 * The bridge's `whoami` — its kept answer for the token it presents now. A bridge of an older
 * build does not know the method (no such method, or the server's answer without a handle): its
 * whoami is a call of its own, by the same token.
 */
async function handleOf(bridge: Pick<Bridge, "request">, call: MindCall): Promise<string> {
  let got: { handle?: unknown } | null;
  try {
    got = (await bridge.request(method("whoami"), {}, { timeoutMs: SLICE_MS, service: true })) as {
      handle?: unknown;
    } | null;
  } catch (e) {
    if ((e as { code?: unknown })?.code !== NO_METHOD) throw e;
    got = null;
  }
  return typeof got?.handle === "string" && got.handle ? got.handle : whoami(call);
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
    account: server(),
    identify: () => handleOf(bridge, call),
  });
}
