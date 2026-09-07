import { randomBytes } from "node:crypto";

import { AuthPending, errorCode, errorMessage } from "../errors.ts";
import { b64url, grantLog, saveGrantState, sha256 } from "../store.ts";
import { debug, log } from "../streams.ts";
import { type Meta, type Tokens } from "../types.ts";
import { portListening, readAuthLock, releaseAuthLock, writeAuthLock } from "./authlock.ts";
import { bindCallback, type Callback } from "./callback.ts";
import { CALLBACK_PORT_RUNGS, callbackPort, ensureClient, openBrowser } from "./discovery.ts";
import { LOGIN_SNOOZE_MS } from "./pacing.ts";
import { tokenRequest } from "./tokenrequest.ts";

// The flow this process is finishing in the background, if any: the harness
// must not kill it under the human's click (see main).
let flowInBackground: Promise<void> | null = null;
export function pendingFlow(): Promise<void> | null {
  return flowInBackground;
}

// Starts (or joins) the machine-wide browser flow and throws AuthPending with
// the authorize URL immediately — no harness call ever blocks on a human. The
// winner completes the flow in the background and saves the tokens; every
// instance picks them up from the store on its next call.
export async function interactiveFlow(meta: Meta): Promise<Tokens> {
  // Join a standing flow only when its listener answers: URL plus open port,
  // never the lock file on its own. The port to probe is the one the OWNER
  // bound and wrote into the lock — it may be a later rung than ours.
  const standing = readAuthLock();
  if (standing?.authorize_url && (await portListening(standing.callback_port))) {
    debug(`joining the flow held by pid ${standing.pid}`);
    throw new AuthPending(standing.authorize_url);
  }

  let callback: Callback | null = null;
  for (let rung = 0; rung < CALLBACK_PORT_RUNGS && !callback; rung++) {
    try {
      callback = await bindCallback(callbackPort(rung));
    } catch (e) {
      if (errorCode(e) !== "EADDRINUSE") throw e;
      // Someone bound it between our probe and our bind. With a lock whose
      // listener answers we can join them; without one an unknown process
      // camps on this rung — step to the next one rather than declare the
      // login impossible over a single busy port.
      const l = readAuthLock();
      if (l?.authorize_url && (await portListening(l.callback_port))) {
        throw new AuthPending(l.authorize_url);
      }
      debug(
        `callback port ${callbackPort(rung)} is held by a foreign process — trying the next rung`,
      );
    }
  }
  if (!callback) {
    const rungs = Array.from({ length: CALLBACK_PORT_RUNGS }, (_, k) => callbackPort(k)).join(", ");
    throw new Error(
      `all candidate callback ports (${rungs}) are held by other processes — free one, then retry`,
    );
  }
  const port = callback.port;

  try {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const client = await ensureClient(meta, redirectUri);
    const verifier = b64url(randomBytes(48));
    const authState = b64url(randomBytes(24));
    const authUrl = new URL(meta.as.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", client.client_id);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", authState);
    authUrl.searchParams.set("code_challenge", b64url(sha256(verifier)));
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", meta.resource);
    if (meta.scope) authUrl.searchParams.set("scope", meta.scope);
    const url = authUrl.toString();

    writeAuthLock(url, port); // we hold the port, so the flow is ours to publish
    grantLog("authorization flow published — waiting for the human");
    const cb = callback;
    flowInBackground = (async () => {
      try {
        const codePromise = cb.waitForCode(authState);
        openBrowser(url);
        const code = await codePromise;
        log("authorization code received — exchanging for tokens");
        await tokenRequest(meta, {
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: client.client_id,
          code_verifier: verifier,
          resource: meta.resource,
        });
        log("authorization complete — tokens saved for every local agent");
        grantLog("authorization complete");
        cb.report(null);
      } catch (e) {
        const message = errorMessage(e);
        cb.report(message); // the human is still on that tab, waiting to be told
        log(`authorization flow failed: ${message}`);
        // Declined, closed, or left to time out — either way the human has
        // answered for now, and the answer holds until the snooze runs out.
        saveGrantState({ snooze_until: Date.now() + LOGIN_SNOOZE_MS });
        grantLog(
          `authorization not completed (${message}); not asking again for ${LOGIN_SNOOZE_MS / 60_000}min`,
        );
      } finally {
        cb.close();
        releaseAuthLock();
        flowInBackground = null;
      }
    })();
    throw new AuthPending(url);
  } catch (e) {
    // The flow owns the listener once it starts; anything failing before that
    // must give the port back rather than camp on it.
    if (!flowInBackground) {
      callback.close();
      releaseAuthLock();
    }
    throw e;
  }
}
