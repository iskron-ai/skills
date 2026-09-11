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
import { CALLBACK_PORT_RUNGS, callbackPort, ensureClient, openBrowser } from "./discovery.ts";
import { tokenRequest } from "./tokenrequest.ts";

/** How long a bridge waits for a sibling that claimed a login to publish its link. */
const CLAIM_WAIT_MS = Number(process.env.ISKRON_BRIDGE_CLAIM_WAIT_MS) || 15_000;
/** How long a bound port with no claim yet is given to show one: the claim follows the bind at once. */
const CLAIM_GLANCE_MS = 1_000;

/** How often a waiting login checks whether the grant came back without it. */
const LANDED_POLL_MS = Number(process.env.ISKRON_BRIDGE_LANDED_POLL_MS) || 2_000;

// The logins this process is listening for in the background: the harness
// must not kill them under the human's click (see main).
const flows = new Set<Promise<void>>();
export function pendingFlow(): Promise<void> | null {
  return flows.size ? Promise.allSettled([...flows]).then(() => {}) : null;
}

// The link a human is given is the bridge's own loopback address, not the
// sign-in server's page. Opening it mints the authorize URL at that moment,
// under a client registration the server knows right then — so the link, and
// the tab, stay good for as long as any bridge listens on the port, however
// long the human is away, and no registration ageing out ever makes a second
// login (graph nks-dev: #4794).
// The key keeps the link the human's: the port is open to every local user, and
// the sign-in page it mints carries the login's state — a stranger holding that
// could slip the bridge a code for an account that is not the human's.
const loginLink = (port: number, key: string): string => `http://127.0.0.1:${port}/login?k=${key}`;
const linkPrefix = (port: number): string => `http://127.0.0.1:${port}/login?k=`;
const redirectFor = (port: number): string => `http://127.0.0.1:${port}/callback`;
// Which grant the machine holds, as a short fingerprint of its tokens: a login
// published over one grant is moot once another is there — whichever bridge,
// of whatever build, wrote it down.
// Both tokens: a server that does not rotate its refresh tokens still issues a
// new access token with every grant it hands out.
const grantPrint = (t: Tokens | null | undefined): string => {
  const both = [t?.refresh_token, t?.access_token].filter(Boolean).join("|");
  return both ? b64url(sha256(both)).slice(0, 16) : "";
};

type Published = AuthLock & Required<Pick<AuthLock, "authorize_url" | "state" | "verifier">>;

// A login this build published: its link and what catches its redirect. Good
// until it lands or is refused — a grant other than the one it was published
// over means it landed or the grant came back by itself (a bridge killed
// between saving the tokens and dropping the record leaves exactly that, and
// taking it over would hand the human a link to a login that is over).
function published(l: AuthLock | null): l is Published {
  if (!l?.authorize_url || !l.state || !l.verifier) return false;
  if (!l.authorize_url.startsWith(linkPrefix(l.callback_port))) return false;
  return l.grant === undefined || grantPrint(loadStore().tokens) === l.grant;
}

// A login an older bridge still running on this machine published: its link is
// the server's own page and nothing in the record takes it over. Joined while
// that bridge lives and listens — never a second login beside it (#4809).
function older(l: AuthLock | null): l is AuthLock & { authorize_url: string } {
  return !!l?.authorize_url && !l.state;
}

/** Is a login out for this machine — one the next caller would join? */
export function loginPublished(): boolean {
  return published(readAuthLock());
}

// The login's one tab, opened by the first bridge that needs a human for it —
// and marked, so no other opens a second.
function showTab(l: Published): void {
  if (CFG.noBrowser) return; // a bridge that cannot open a browser leaves the tab to one that can
  const current = readAuthLock();
  if (current?.state === l.state) writeAuthLock({ ...current, tab: true });
  openBrowser(l.authorize_url);
}

// A living bridge's login made moot a moment ago still holds its port until its
// next look at the grant. Waited for, not stepped past: stepping to the next
// rung would be a second login on a second port for nothing.
async function mootFreed(port: number): Promise<void> {
  const l = readAuthLock();
  if (!l || l.callback_port !== port || !l.state || published(l) || !pidAlive(l.pid)) return;
  const deadline = Date.now() + LANDED_POLL_MS * 2 + 1_000;
  while (Date.now() < deadline && (await portListening(port))) await sleep(100);
}

async function bindOrNull(port: number): Promise<Callback | null> {
  try {
    return await bindCallback(port);
  } catch (e) {
    if (errorCode(e) !== "EADDRINUSE") throw e;
    return null;
  }
}

// Someone holds this port. A live bridge's login on it — or its claim, a moment
// before the link — is waited for and joined; nothing of a living bridge's
// after a glance is a foreign process, stepped past.
async function linkOn(port: number): Promise<string | null> {
  const glance = Date.now() + CLAIM_GLANCE_MS;
  const deadline = Date.now() + CLAIM_WAIT_MS;
  for (;;) {
    const l = readAuthLock();
    const ours = !!l && l.callback_port === port && pidAlive(l.pid);
    if (ours && (published(l) || older(l))) return l.authorize_url ?? null;
    const claimed = ours && !l?.authorize_url;
    if ((!claimed && Date.now() > glance) || Date.now() > deadline) return null;
    await sleep(100);
  }
}

// Joins, takes over or starts the machine's one login and throws AuthPending
// with its link at once — no harness call ever blocks on a human. The bridge
// listening on the link finishes the login in the background and saves the
// tokens; every instance picks them up from the store on its next call.
// One login, one tab (#4794): the first bridge that needs a human for a login —
// publishing, taking it over or joining it — opens its tab and marks it in the
// record; no other opens a second.
// `wantTab` says a human is needed — the grant is dead or absent. A login
// offered beside a grant merely blind until its hour comes as a link alone:
// the grant comes back by itself, and a tab every such window is a tab nobody
// asked for (#4794). The login's one tab opens when a human is first needed.
export async function interactiveFlow(meta: Meta, note?: string, wantTab = true): Promise<Tokens> {
  const standing = readAuthLock();
  // Joined only while its bridge lives: a port listening under a dead
  // publisher is a stranger's, and a click on that link lands nowhere.
  if (
    (published(standing) || older(standing)) &&
    pidAlive(standing.pid) &&
    (await portListening(standing.callback_port))
  ) {
    debug(`joining the login held by pid ${standing.pid}`);
    if (wantTab && published(standing) && !standing.tab) showTab(standing);
    throw new AuthPending(standing.authorize_url, note);
  }
  if (published(standing)) {
    const cb = await bindOrNull(standing.callback_port);
    if (cb) {
      writeAuthLock({
        ...standing,
        pid: process.pid,
        tab: !!standing.tab || (wantTab && !CFG.noBrowser), // the fact, not the wish
      });
      log(
        "the bridge that published this login is gone — listening on its link, so the tab the human has still lands",
      );
      grantLog("authorization flow taken over on the same link — waiting for the human");
      runFlow(meta, cb, standing, wantTab && !standing.tab);
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
    const link = await linkOn(standing.callback_port);
    if (link) throw new AuthPending(link, note);
  }

  let callback: Callback | null = null;
  for (let rung = 0; rung < CALLBACK_PORT_RUNGS && !callback; rung++) {
    callback = await bindOrNull(callbackPort(rung));
    if (callback) break;
    const link = await linkOn(callbackPort(rung));
    if (link) throw new AuthPending(link, note);
    await mootFreed(callbackPort(rung)); // a moot login of a living bridge closing: wait for it
    callback = await bindOrNull(callbackPort(rung)); // freed meanwhile, whoever held it
    if (callback) break;
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

  let started = false;
  try {
    const login: Published = {
      pid: process.pid,
      started_at: Date.now(),
      callback_port: callback.port,
      authorize_url: loginLink(callback.port, b64url(randomBytes(18))),
      state: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(48)),
      grant: grantPrint(loadStore().tokens),
      tab: wantTab && !CFG.noBrowser, // the fact, not the wish: a headless bridge opens nothing
    };
    writeAuthLock(login); // we hold the port, so the login is ours to publish
    grantLog("authorization flow published — waiting for the human");
    runFlow(meta, callback, login, wantTab);
    started = true;
    throw new AuthPending(login.authorize_url, note);
  } catch (e) {
    // The flow owns the listener once it starts; anything failing before that
    // must give the port and the record back rather than camp on them.
    if (!started) {
      callback.close();
      releaseAuthLock((l) => l.pid === process.pid);
    }
    throw e;
  }
}

function runFlow(meta: Meta, cb: Callback, login: Published, openTab: boolean): void {
  const ours = (l: AuthLock) => l.pid === process.pid && l.state === login.state;
  const redirectUri = redirectFor(login.callback_port);
  // The sign-in page is minted when the human opens the link. The client it is
  // minted under goes into the record, so whichever bridge catches the
  // redirect exchanges the code under that same client.
  const key = login.authorize_url.slice(linkPrefix(login.callback_port).length);
  cb.serveLogin(key, async () => {
    const client = await ensureClient(meta, redirectUri);
    const current = readAuthLock();
    if (current && ours(current)) writeAuthLock({ ...current, client_id: client.client_id });
    const u = new URL(meta.as.authorization_endpoint);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", client.client_id);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("state", login.state);
    u.searchParams.set("code_challenge", b64url(sha256(login.verifier)));
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("resource", meta.resource);
    if (meta.scope) u.searchParams.set("scope", meta.scope);
    return u.toString();
  });
  // A login offered beside a grant blind until its own hour is moot once the
  // grant comes back by itself. Its listener then closes: left waiting, it holds
  // the port, and the next such window steps to another rung — a new tab each
  // time, until no port and no link are left at all (#4794).
  let watch: ReturnType<typeof setInterval> | undefined;
  const cameBack = new Promise<never>((_, reject) => {
    watch = setInterval(() => {
      if (login.grant !== undefined && grantPrint(loadStore().tokens) !== login.grant) {
        reject(new Error("the grant came back by itself — this login is no longer needed"));
      }
    }, LANDED_POLL_MS);
    watch.unref?.();
  });
  cameBack.catch(() => {});
  let flow: Promise<void> | null = null;
  flow = (async () => {
    try {
      const codePromise = cb.waitForCode(login.state);
      if (openTab) openBrowser(login.authorize_url);
      const code = await Promise.race([codePromise, cameBack]);
      const record = readAuthLock();
      const clientId =
        (record?.state === login.state ? record.client_id : undefined) ||
        CFG.staticClientId ||
        loadStore().client?.client_id ||
        "";
      log("authorization code received — exchanging for tokens");
      await tokenRequest(meta, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: login.verifier,
        resource: meta.resource,
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
      clearInterval(watch);
      cb.close();
      releaseAuthLock(ours);
      if (flow) flows.delete(flow);
    }
  })();
  flows.add(flow);
}
