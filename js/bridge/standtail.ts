// The stand answer's closing lines: the delivery's lag notice, then — on a seat taken by a call
// whose answer a model reads — the human's rules from mind (shared/mindslice.ts, graph
// @nks/nks-dev, #9817). The rules close the answer: the launch line takes them from there
// (shared/launch.ts); a harness's provisional seating gives them by its own read.
import { mindSlice } from "../shared/mindslice.ts";
import { callTool } from "./call.ts";
import { CFG } from "./config.ts";
import { credentialKey as account } from "./ownwhoami.ts";
import { automaticSeat } from "./seatorigin.ts";
import { readLatest, staleNotice } from "./update.ts";

// The cache key's first part is the session's credential (ownwhoami.ts): server, grant directory
// and the fingerprint of the token the bridge presents now; whoami, kept per it, completes it.

export async function standTail(stood: boolean): Promise<string[]> {
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  return [
    ...(stale ? [stale] : []),
    ...(stood && !automaticSeat() ? [await mindSlice(callTool, { account: account() })] : []),
  ];
}
