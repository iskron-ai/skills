// The human's rules (shared/mindslice.ts, graph @nks/nks-dev, #9817) read by the session's own
// bridge as a service move — not the agent's work: after a compaction and at a root's start.
// One slice per account for the whole plugin process (shared/mindcache.ts): every session's
// bridge here starts from the same environment — grant directory, server, token.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { envName } from "../delivery/index.ts";
import type { Bridge } from "../shared/bridge-client.ts";
import { mindSlice, type MindSliceOptions } from "../shared/mindslice.ts";
import { authDir, grantStamp, textOf } from "./bridge-io.ts";

/** The platform's answer — no longer than this. */
const SLICE_MS = 10_000;

/** A personal access token the bridges start with: the variable, else the file beside the grant. */
function patOf(): string {
  const env = process.env[envName("BRIDGE_TOKEN")]?.trim();
  if (env) return env;
  try {
    return readFileSync(join(authDir(), "token"), "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * The credential's part of the shared slice's key: server, grant directory and a fingerprint of
 * the token — the personal token's, else the OAuth grant's as it lies on disk (a new login
 * rewrites it). whoami, kept per this credential, names the account that completes the key
 * (shared/mindslice.ts): personal rules never cross accounts.
 */
function account(): string {
  const token = patOf() || grantStamp();
  const fp = token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "";
  return `opencode\n${process.env[envName("BRIDGE_URL")]?.trim() ?? ""}\n${authDir()}\n${fp}`;
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
