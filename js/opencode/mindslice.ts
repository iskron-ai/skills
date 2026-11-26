// The human's rules (shared/mindslice.ts, graph @nks/nks-dev, #9817) read by the session's own
// bridge as a service move — not the agent's work: after a compaction and at a root's start.
// One slice per account and server for the whole plugin process (shared/mindcache.ts). The
// account is the one THIS bridge's whoami names, asked once per bridge lifetime: a running
// bridge keeps the token it started with whatever lies on disk now, so nothing on disk — token
// file or grant — names the account here (a token switched under a live bridge would otherwise
// file one account's rules under another's key).
import { envName } from "../delivery/index.ts";
import type { Bridge } from "../shared/bridge-client.ts";
import { mindSlice, type MindSliceOptions } from "../shared/mindslice.ts";
import { textOf } from "./bridge-io.ts";

/** The platform's answer — no longer than this. */
const SLICE_MS = 10_000;

/** The cache's server part; the account that completes the key is the bridge's own whoami. */
const server = (): string => `opencode\n${process.env[envName("BRIDGE_URL")]?.trim() ?? ""}`;

/** Compaction opts into strict failures; root starts keep the default soft diagnostic (#9817). */
export function sliceBy(
  bridge: Pick<Bridge, "request">,
  options: MindSliceOptions = {},
): Promise<string> {
  return mindSlice(
    async (name, args) => {
      const got = (await bridge.request(
        "tools/call",
        { name, arguments: args },
        { timeoutMs: SLICE_MS, service: true },
      )) as { isError?: boolean; structuredContent?: unknown } | null;
      return { isError: !!got?.isError, text: textOf(got), structured: got?.structuredContent };
    },
    { ...options, cacheKey: bridge, account: server(), identity: bridge },
  );
}
