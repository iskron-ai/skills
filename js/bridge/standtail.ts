// The stand answer's closing lines: the delivery's lag notice, then — on a seat taken by a call
// whose answer a model reads — the human's rules from mind (shared/mindslice.ts, graph
// @nks/nks-dev, #9817). The rules close the answer: the launch line takes them from there
// (shared/launch.ts); a harness's provisional seating gives them by its own read.
import { createHash } from "node:crypto";

import { mindSlice } from "../shared/mindslice.ts";
import { callTool } from "./call.ts";
import { CFG } from "./config.ts";
import { automaticSeat } from "./seatorigin.ts";
import { bearer } from "./transport.ts";
import { readLatest, staleNotice } from "./update.ts";

/**
 * The session's credential — server, grant directory and the fingerprint of the token the bridge
 * presents now (a personal token, else the OAuth access token: a new login is another one) — the
 * cache key's first part; whoami, kept per it, names the account that completes the key.
 */
const account = (): string => {
  const token = bearer();
  const fp = token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "";
  return `${CFG.serverUrl}\n${CFG.authDir}\n${fp}`;
};

export async function standTail(stood: boolean): Promise<string[]> {
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  return [
    ...(stale ? [stale] : []),
    ...(stood && !automaticSeat() ? [await mindSlice(callTool, { account: account() })] : []),
  ];
}
