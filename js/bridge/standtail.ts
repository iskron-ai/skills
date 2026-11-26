// The stand answer's closing lines: the delivery's lag notice, then — on a seat taken by a call
// whose answer a model reads — the human's rules from mind (shared/mindslice.ts, graph
// @nks/nks-dev, #9817). The rules close the answer: the launch line takes them from there
// (shared/launch.ts); a harness's provisional seating gives them by its own read.
import { createHash } from "node:crypto";

import { mindSlice } from "../shared/mindslice.ts";
import { callTool } from "./call.ts";
import { CFG } from "./config.ts";
import { automaticSeat } from "./seatorigin.ts";
import { readLatest, staleNotice } from "./update.ts";

/**
 * The session's credential — server, grant directory, token (the variable's or the file's) — the
 * cache key's first part; the handle whoami names on each read completes it (mindslice.ts).
 */
const account = (): string => {
  const pat = CFG.pat ? createHash("sha256").update(CFG.pat).digest("hex").slice(0, 16) : "";
  return `${CFG.serverUrl}\n${CFG.authDir}\n${pat}`;
};

export async function standTail(stood: boolean): Promise<string[]> {
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  return [
    ...(stale ? [stale] : []),
    ...(stood && !automaticSeat() ? [await mindSlice(callTool, { account: account() })] : []),
  ];
}
