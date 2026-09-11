import { randomBytes } from "node:crypto";

import { CFG } from "../config.ts";
import { AuthPending, errorCode, errorMessage } from "../errors.ts";
import { b64url, grantLog, loadStore, sha256, sleep } from "../store.ts";
import { debug, log } from "../streams.ts";
import { type Meta, type Tokens } from "../types.ts";
import {
  type AuthLock,
  pidAlive,
  portListening,
  readAuthLock,
  releaseAuthLock,
  writeAuthLock,
} from "./authlock.ts";
import { bindCallback, type Callback } from "./callback.ts";
import {
  CALLBACK_PORT_RUNGS,
  callbackPort,
  ensureClient,
  openBrowser,
  registrationReusable,
} from "./discovery.ts";
import { tokenRequest } from "./tokenrequest.ts";

/** How long a bridge waits for a sibling that claimed a login to publish its link. */
const CLAIM_WAIT_MS = Number(process.env.ISKRON_BRIDGE_CLAIM_WAIT_MS) || 15_000;
/** How long a bound port with no claim yet is given to show one: the claim follows the bind at once. */
const CLAIM_GLANCE_MS = 1_000;
/**
 * A login gets a registration young enough to outlive it: one reused only if
 * made in the last few minutes, else a fresh one. The server forgets an unused
 * registration within the hour, and the login's link must stay good for the
 * whole reuse horizon — not die under the human because the registration was
 * already old when the login went out (#4794).
 */
const LOGIN_REGISTRATION_FRESH_MS = 5 * 60_000;

// The flow this process is finishing in the background, if any: the harness
// must not kill it under the human's click (see main).
let flowInBackground: Promise<void> | null = null;
export function pendingFlow(): Promise<void> | null {
  return flowInBackground;
}

type Published = AuthLock &
  Required<Pick<AuthLock, "authorize_url" | "state" | "verifier" | "client_id" | "redirect_uri">>;

// A published login is good until it lands or is refused — and while the
// client its link names is one the server still knows: the machine's own
// registration, young enough to reuse. The store is the one word on that; a
// registration dropped or aged out means the authorize page would refuse the
// link, and a new login is the honest move.
function published(l: AuthLock | null): l is Published {
  if (!l?.authorize_url || !l.state || !l.verifier || !l.client_id || !l.redirect_uri) return false;
  const store = loadStore();
  // A grant written down after the login was published means the login landed
  // (or the grant came back by itself): what is left is a record, not a login
  // anyone is clicking — a bridge killed between saving the tokens and dropping
  // the record leaves exactly that, and taking it over would hand the human a
  // link with no tab, the one they had long closed.
  if ((store.tokens?.stored_at ?? 0) >= l.started_at) return false;
  if (CFG.staticClientId) return l.client_id === CFG.staticClientId;
  return (
    store.client?.client_id === l.client_id && registrationReusable(store.client, l.redirect_uri)
  );
}

/** Is a login out for this machine — one the next caller would join? */
export function loginPublished(): boolean {
  return published(readAuthLock());
}

async function bindOrNull(port: number): Promise<Callback | null> {
  try {
    return await bindCallback(port);
  } catch (e) {
    if (errorCode(e) !== "EADDRINUSE") throw e;
    return null;
  }
}

// Someone holds this port. A sibling mid-login has claimed it (or already
// published on it): wait for that login's link. Nothing claiming it after a
// glance is a foreign process — step past it.
async function linkOn(port: number): Promise<Published | null> {
  const glance = Date.now() + CLAIM_GLANCE_MS;
  const deadline = Date.now() + CLAIM_WAIT_MS;
  for (;;) {
    const l = readAuthLock();
    if (published(l) && l.callback_port === port && pidAlive(l.pid)) return l;
    const claimed = !!l && !l.authorize_url && l.callback_port === port && pidAlive(l.pid);
    if ((!claimed && Date.now() > glance) || Date.now() > deadline) return null;
    await sleep(100);
  }
}

// Joins, takes over or starts the machine's one login and throws AuthPending
// with its link at once — no harness call ever blocks on a human. The bridge
// listening on the link finishes the login in the background and saves the
// tokens; every instance picks them up from the store on its next call.
// One login, one tab (graph nks-dev: #4794): only the bridge that publishes a
// login opens the browser; one that joins or takes it over never does — the
// human already has that tab.
export async function interactiveFlow(meta: Meta, note?: string): Promise<Tokens> {
  const standing = readAuthLock();
  if (published(standing)) {
    // Joined only while its bridge lives: a port listening under a dead
    // publisher is a stranger's, and a click on that link lands nowhere.
    if (pidAlive(standing.pid) && (await portListening(standing.callback_port))) {
      debug(`joining the login held by pid ${standing.pid}`);
      throw new AuthPending(standing.authorize_url, note);
    }
    const cb = await bindOrNull(standing.callback_port);
    if (cb) {
      writeAuthLock({ ...standing, pid: process.pid });
      log(
        "the bridge that published this login is gone — listening on its link, so the tab the human has still lands",
      );
      grantLog("authorization flow taken over on the same link — waiting for the human");
      runFlow(meta, cb, standing, false);
      throw new AuthPending(standing.authorize_url, note);
    }
    const taken = readAuthLock(); // a sibling may have taken it over first
    if (
      published(taken) &&
      taken.state === standing.state &&
      pidAlive(taken.pid) &&
      (await portListening(taken.callback_port))
    ) {
      throw new AuthPending(taken.authorize_url, note);
    }
    debug(
      `the published login's port ${standing.callback_port} is held by a foreign process — its link can land nowhere; publishing a new login`,
    );
  } else if (
    standing &&
    !standing.authorize_url &&
    pidAlive(standing.pid) &&
    (await portListening(standing.callback_port))
  ) {
    const claimed = await linkOn(standing.callback_port);
    if (claimed) throw new AuthPending(claimed.authorize_url, note);
  }

  let callback: Callback | null = null;
  for (let rung = 0; rung < CALLBACK_PORT_RUNGS && !callback; rung++) {
    callback = await bindOrNull(callbackPort(rung));
    if (callback) break;
    const claimed = await linkOn(callbackPort(rung));
    if (claimed) throw new AuthPending(claimed.authorize_url, note);
    debug(
      `callback port ${callbackPort(rung)} is held by a foreign process — trying the next rung`,
    );
  }
  if (!callback) {
    const rungs = Array.from({ length: CALLBACK_PORT_RUNGS }, (_, k) => callbackPort(k)).join(", ");
    throw new Error(
      `all candidate callback ports (${rungs}) are held by other processes — free one, then retry`,
    );
  }
  const port = callback.port;
  writeAuthLock({ callback_port: port }); // the claim, before the registration's round trip

  try {
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const client = await ensureClient(meta, redirectUri, LOGIN_REGISTRATION_FRESH_MS);
    const verifier = b64url(randomBytes(48));
    const state = b64url(randomBytes(24));
    const authUrl = new URL(meta.as.authorization_endpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", client.client_id);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", b64url(sha256(verifier)));
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("resource", meta.resource);
    if (meta.scope) authUrl.searchParams.set("scope", meta.scope);

    const login: Published = {
      pid: process.pid,
      started_at: Date.now(),
      callback_port: port,
      authorize_url: authUrl.toString(),
      state,
      verifier,
      client_id: client.client_id,
      redirect_uri: redirectUri,
      resource: meta.resource,
    };
    writeAuthLock(login); // we hold the port, so the login is ours to publish
    grantLog("authorization flow published — waiting for the human");
    runFlow(meta, callback, login, true);
    throw new AuthPending(login.authorize_url, note);
  } catch (e) {
    // The flow owns the listener once it starts; anything failing before that
    // must give the port and the claim back rather than camp on them.
    if (!flowInBackground) {
      callback.close();
      releaseAuthLock((l) => l.pid === process.pid);
    }
    throw e;
  }
}

function runFlow(meta: Meta, cb: Callback, login: Published, openTab: boolean): void {
  const ours = (l: AuthLock) => l.pid === process.pid && l.state === login.state;
  flowInBackground = (async () => {
    try {
      const codePromise = cb.waitForCode(login.state);
      if (openTab) openBrowser(login.authorize_url);
      const code = await codePromise;
      log("authorization code received — exchanging for tokens");
      await tokenRequest(meta, {
        grant_type: "authorization_code",
        code,
        redirect_uri: login.redirect_uri,
        client_id: login.client_id,
        code_verifier: login.verifier,
        resource: login.resource ?? meta.resource,
      });
      releaseAuthLock(ours); // the login has landed: no one is to join it from here on
      log("authorization complete — tokens saved for every local agent");
      grantLog("authorization complete");
      cb.report(null);
    } catch (e) {
      const message = errorMessage(e);
      cb.report(message); // the human is still on that tab, waiting to be told
      log(`authorization flow failed: ${message}`);
      // Declined, or refused by the server: this login is closed. The next call
      // that needs the graph publishes a new one — never "not now" (#4794).
      grantLog(
        `authorization not completed (${message}) — the next call that needs the graph offers a new login`,
      );
    } finally {
      cb.close();
      releaseAuthLock(ours);
      flowInBackground = null;
    }
  })();
}
