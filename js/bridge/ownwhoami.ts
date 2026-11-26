// The account this bridge's credential speaks for (graph @nks/nks-dev, #9817): whoami kept per
// the fingerprint of the token the bridge presents at this moment — a personal token, else the
// OAuth access token read from the store on every request (transport.ts bearer): a new login in
// the store is another fingerprint, so the next ask goes to the server again; the same credential
// is asked once. The daemon's own rules slice keys by it (standtail.ts); a plugin asks `whoami`
// of its bridge on every slice read (opencode/mindslice.ts) and caches nothing of its own.
import { createHash } from "node:crypto";

import { method } from "../delivery/index.ts";
import { identityOf } from "../shared/mindcache.ts";
import { whoami } from "../shared/mindslice.ts";
import { callTool } from "./call.ts";
import { CFG } from "./config.ts";
import { bearer } from "./transport.ts";
import { type JsonRpcMessage } from "./types.ts";

/** Server, grant directory and the fingerprint of the token presented now. */
export const credentialKey = (): string => {
  const token = bearer();
  const fp = token ? createHash("sha256").update(token).digest("hex").slice(0, 16) : "";
  return `${CFG.serverUrl}\n${CFG.authDir}\n${fp}`;
};

/** The handle this bridge's credential speaks for now. */
export const ownHandle = (): Promise<string> => identityOf(credentialKey(), () => whoami(callTool));

/** The plugin's `whoami`: `{handle}`; a refused or unknown whoami — an error with its text. */
export function localWhoami(msg: JsonRpcMessage): Promise<JsonRpcMessage> | null {
  if (msg?.method !== method("whoami")) return null;
  return ownHandle().then(
    (handle) => ({ jsonrpc: "2.0", id: msg.id, result: { handle } }),
    (e: unknown) => ({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32000, message: e instanceof Error ? e.message : String(e) },
    }),
  );
}
