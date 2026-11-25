// The human's rules (shared/mindslice.ts, graph @nks/nks-dev, #9817) read by the session's own
// bridge as a service move — not the agent's work: after a compaction and at a root's start.
// One slice per account for the whole plugin process (shared/mindcache.ts): every session's
// bridge here starts from the same environment — grant directory, server, token.
import { createHash } from "node:crypto";

import { envName } from "../delivery/index.ts";
import type { Bridge } from "../shared/bridge-client.ts";
import { mindSlice, type MindSliceOptions } from "../shared/mindslice.ts";
import { authDir, textOf } from "./bridge-io.ts";

/** The platform's answer — no longer than this. */
const SLICE_MS = 10_000;

/** The credential the plugin's bridges start with names the account. */
function account(): string {
  const token = process.env[envName("BRIDGE_TOKEN")]?.trim() ?? "";
  const pat = token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "";
  return `opencode\n${process.env[envName("BRIDGE_URL")]?.trim() ?? ""}\n${authDir()}\n${pat}`;
}

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
    { ...options, cacheKey: bridge, account: account() },
  );
}
