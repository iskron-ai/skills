#!/usr/bin/env node
// iskron-bridge — stdio <-> streamable-HTTP MCP bridge with the full OAuth 2.1 flow.
//
// For harnesses that cannot (or should not) speak https+OAuth MCP themselves:
// the harness runs this file as an ordinary stdio MCP server, and the bridge
// carries every JSON-RPC message to a remote streamable-HTTP MCP server,
// handling discovery (RFC 9728 / RFC 8414), dynamic client registration,
// authorization-code + PKCE in the browser, token persistence and refresh.
//
// The design rule that justifies this bridge's existence: NEVER answer the
// harness with silence. Every forwarded request gets a deadline; any upstream
// failure — timeout, dead TCP, HTTP error, lost session — comes back to the
// harness as a JSON-RPC error for that request id. There are no long-lived
// upstream connections to go half-dead: each request is its own POST.
//
// Usage:
//   node iskron-bridge.mjs [server-url] [--timeout <ms>] [--auth-dir <dir>]
//                       [--client-name <name>] [--no-browser] [--debug]
// With no server-url the bridge points at the product instance (DEFAULT_SERVER_URL
// below); pass a URL (or set ISKRON_BRIDGE_URL) only for another instance or fork.
// Env (flags win): ISKRON_BRIDGE_URL, ISKRON_BRIDGE_TIMEOUT, ISKRON_BRIDGE_AUTH_DIR,
//                  ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG, ISKRON_BRIDGE_SCOPE,
//                  ISKRON_BRIDGE_RESOURCE (override the resource indicator / audience),
//                  ISKRON_BRIDGE_CLIENT_ID
//
// No dependencies. Node >= 20.

import { createServer } from "node:http";
import { connect } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, linkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";

const VERSION = "0.1.0";
const DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const cfg = {
    serverUrl: null,
    timeoutMs: Number(process.env.ISKRON_BRIDGE_TIMEOUT) || 120_000,
    authDir: process.env.ISKRON_BRIDGE_AUTH_DIR || join(homedir(), ".iskron-bridge"),
    clientName: "iskron-bridge",
    noBrowser: !!process.env.ISKRON_BRIDGE_NO_BROWSER,
    debug: !!process.env.ISKRON_BRIDGE_DEBUG,
    scope: process.env.ISKRON_BRIDGE_SCOPE || null,
    resource: process.env.ISKRON_BRIDGE_RESOURCE || null,
    staticClientId: process.env.ISKRON_BRIDGE_CLIENT_ID || null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--timeout") cfg.timeoutMs = Number(argv[++i]);
    else if (a === "--auth-dir") cfg.authDir = argv[++i];
    else if (a === "--client-name") cfg.clientName = argv[++i];
    else if (a === "--no-browser") cfg.noBrowser = true;
    else if (a === "--debug") cfg.debug = true;
    else if (a === "--version") { process.stdout.write(VERSION + "\n"); process.exit(0); }
    else if (!a.startsWith("--") && !cfg.serverUrl) cfg.serverUrl = a;
    else { log(`unknown argument: ${a}`); process.exit(2); }
  }
  if (!cfg.serverUrl) cfg.serverUrl = process.env.ISKRON_BRIDGE_URL || DEFAULT_SERVER_URL;
  try { new URL(cfg.serverUrl); } catch {
    log(`not a URL: ${cfg.serverUrl}`);
    process.exit(2);
  }
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs < 1000) cfg.timeoutMs = 120_000;
  return cfg;
}

// ------------------------------------------------------------------ logging

function log(msg) {
  process.stderr.write(`[iskron-bridge ${new Date().toISOString()}] ${msg}\n`);
}
let CFG = null;
function debug(msg) {
  if (CFG?.debug) log(`debug: ${msg}`);
}

// ---------------------------------------------------------------- utilities

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (s) => createHash("sha256").update(s).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class UpstreamError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; } // "auth" | "session" | "http" | "network"
}

class TokenError extends Error {
  constructor(message, oauthError, status) { super(message); this.oauthError = oauthError; this.status = status; }
}
// Only these OAuth errors prove the grant itself is dead; anything else
// (network, 5xx, temporarily_unavailable) must NOT burn the refresh token
// or drag the user into the browser.
const DEFINITIVE_OAUTH_ERRORS = new Set(["invalid_grant", "invalid_token", "invalid_client", "unauthorized_client"]);

// ------------------------------------------------------------- token store

// One JSON file per server origin+path: { client, tokens, meta, updated_at }.
function storePath() {
  const u = new URL(CFG.serverUrl);
  const h = b64url(sha256(u.origin + u.pathname)).slice(0, 10);
  return join(CFG.authDir, `${u.hostname}_${h}.json`);
}
function loadStore() {
  try { return JSON.parse(readFileSync(storePath(), "utf8")); } catch { return {}; }
}
// Written whole to a neighbouring file and renamed over the old one. Dozens of
// local bridges read this store; a plain overwrite lets one of them read a
// half-written file, and a store that fails to parse reads as "no grant at
// all" — which is exactly the state that sends the human to a login screen.
function saveStore(patch) {
  mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 });
  const next = { ...loadStore(), ...patch, server_url: CFG.serverUrl, updated_at: new Date().toISOString() };
  const tmp = `${storePath()}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(tmp, storePath()); // atomic within the directory
  } catch (e) {
    try { unlinkSync(tmp); } catch {}
    throw e;
  }
  return next;
}

// The tokens on disk, judged for use here and now: present, not the very token
// we already know is refused, and not inside `marginMs` of expiry.
function tokenUsable(t, { rejected = null, marginMs = 0 } = {}) {
  if (!t?.access_token) return false;
  if (rejected && t.access_token === rejected) return false;
  if (t.expires_at && t.expires_at - Date.now() <= marginMs) return false;
  return true;
}
function usableTokens(opts) {
  const t = loadStore().tokens;
  return tokenUsable(t, opts) ? t : null;
}

// -------------------------------------------------------------------- OAuth

async function fetchJson(url, opts = {}, timeoutMs = 15_000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}`);
  return res.json();
}

// RFC 9728: locate the protected-resource metadata, then the AS metadata.
async function discover(wwwAuthenticate) {
  const u = new URL(CFG.serverUrl);
  const candidates = [];
  const m = /resource_metadata="?([^",\s]+)"?/.exec(wwwAuthenticate || "");
  if (m) candidates.push(m[1]);
  const path = u.pathname === "/" ? "" : u.pathname;
  candidates.push(`${u.origin}/.well-known/oauth-protected-resource${path}`);
  candidates.push(`${u.origin}/.well-known/oauth-protected-resource`);

  let prm = null;
  for (const c of candidates) {
    try { prm = await fetchJson(c); debug(`protected-resource metadata: ${c}`); break; }
    catch (e) { debug(`no PRM at ${c}: ${e.message}`); }
  }
  const asBase = prm?.authorization_servers?.[0] || u.origin;
  const asUrl = new URL(asBase);
  const asPath = asUrl.pathname === "/" ? "" : asUrl.pathname;
  const asCandidates = [
    `${asUrl.origin}/.well-known/oauth-authorization-server${asPath}`,
    `${asUrl.origin}${asPath}/.well-known/oauth-authorization-server`,
    `${asUrl.origin}/.well-known/openid-configuration${asPath}`,
    `${asUrl.origin}${asPath}/.well-known/openid-configuration`,
  ];
  let as = null;
  for (const c of asCandidates) {
    try { as = await fetchJson(c); debug(`AS metadata: ${c}`); break; }
    catch (e) { debug(`no AS metadata at ${c}: ${e.message}`); }
  }
  if (!as?.authorization_endpoint || !as?.token_endpoint) {
    throw new Error(`OAuth discovery failed for ${CFG.serverUrl}: no authorization server metadata reachable`);
  }
  const scope = CFG.scope
    || (prm?.scopes_supported?.length ? prm.scopes_supported.join(" ") : null);
  // The resource indicator decides the token's audience, so it must be the
  // exact string the MCP server validates against — including a trailing
  // slash. Discovery is the default because the server publishes it; the
  // override exists because a deployment can validate a form its own metadata
  // does not print, and then only its operator knows the right one.
  const meta = { as, resource: CFG.resource || prm?.resource || CFG.serverUrl, scope };
  saveStore({ meta });
  return meta;
}

// Stable per-origin loopback port, so the registered redirect_uri survives restarts.
function callbackPort() {
  const d = sha256(new URL(CFG.serverUrl).origin);
  return 42000 + (d[0] * 256 + d[1]) % 2000;
}

async function ensureClient(meta, redirectUri) {
  if (CFG.staticClientId) return { client_id: CFG.staticClientId };
  const stored = loadStore().client;
  if (stored?.client_id && stored?.redirect_uri === redirectUri) return stored;
  if (!meta.as.registration_endpoint) {
    throw new Error("server offers no dynamic client registration; pass ISKRON_BRIDGE_CLIENT_ID");
  }
  const reg = await fetchJson(meta.as.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: CFG.clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const client = { client_id: reg.client_id, redirect_uri: redirectUri };
  saveStore({ client });
  log(`registered OAuth client ${reg.client_id}`);
  return client;
}

function openBrowser(url) {
  log(`authorize in the browser:\n  ${url}`);
  if (CFG.noBrowser) return;
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch (e) {
    log(`could not open a browser (${e.message}) — open the URL above manually`);
  }
}

// Bind the loopback listener that catches the redirect carrying ?code=…&state=…
// Binding comes FIRST and is what claims the flow: a bound port is a fact any
// other process can check, unlike a file that outlives the process that wrote it.
function bindCallback(port) {
  return new Promise((resolve, reject) => {
    let handOff = null;   // set once someone is waiting for the code
    let received = null;  // …or hold what arrived before they asked
    const deliver = (v) => { if (handOff) handOff(v); else received = v; };

    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get("error");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(err
        ? `<h3>iskron-bridge: authorization failed (${err})</h3>`
        : "<h3>iskron-bridge: authenticated — you can close this tab.</h3>");
      deliver({ code: u.searchParams.get("code"), state: u.searchParams.get("state"), err });
    });

    server.once("error", reject); // EADDRINUSE: someone else owns the flow
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      server.on("error", (e) => log(`callback server: ${e.message}`));
      resolve({
        port,
        close: () => server.close(),
        waitForCode: (expectedState, timeoutMs = 300_000) => new Promise((res, rej) => {
          const timer = setTimeout(
            () => rej(new Error("timed out waiting for the browser authorization")), timeoutMs);
          const settle = (v) => {
            clearTimeout(timer);
            if (v.err) return rej(new Error(`authorization refused: ${v.err}`));
            if (!v.code || v.state !== expectedState) {
              return rej(new Error("callback missing code or state mismatch"));
            }
            res(v.code);
          };
          if (received) settle(received); else handOff = settle;
        }),
      });
    });
  });
}

// --- machine-wide authorization coordination ------------------------------
// Dozens of local agents share one grant, so at most ONE bridge instance runs
// the browser flow; every other instance (and every call meanwhile) surfaces
// the SAME authorize URL from the lock — whichever surface the human happens
// to look at, one click heals the whole machine.
//
// What makes a standing flow joinable is the LISTENER, not the file. A bridge
// killed mid-flow (SIGKILL, a reaped ephemeral run, a crash) leaves its lock
// behind with nothing bound to the callback port; a joiner that trusts the file
// alone then hands the human an authorize URL whose redirect lands on a closed
// port — the click is spent and no one catches it. So the loopback port IS the
// claim: whoever binds it owns the flow, and the file only carries that owner's
// URL for the others to surface. Both errors are cheap to picture and one is
// far worse: joining a dead flow silently burns the human's login, while taking
// over a live one costs at most a second browser tab. When in doubt, take over.

const AUTH_LOCK_FRESH_MS = 330_000; // flow timeout + margin; older is dead by the clock alone

function authLockPath() { return storePath() + ".auth-pending"; }

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; } // alive, merely not ours to signal
}

// Is anything accepting connections on the loopback callback port?
function portListening(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port)) return resolve(false);
    const sock = connect({ host: "127.0.0.1", port });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

// The file alone is never proof of a live flow — the caller must also see the
// callback port listening before it surfaces this URL to anyone.
function readAuthLock() {
  try {
    const l = JSON.parse(readFileSync(authLockPath(), "utf8"));
    if (!(Date.now() - l.started_at < AUTH_LOCK_FRESH_MS)) return null;
    if (!pidAlive(l.pid)) return null; // the winner is gone; nothing holds the port
    return l;
  } catch {}
  return null;
}

// Written only by the process that holds the port, so it needs no exclusion
// dance: the bind already settled who writes here.
function writeAuthLock(url, port) {
  mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    authLockPath(),
    JSON.stringify({ pid: process.pid, started_at: Date.now(), authorize_url: url, callback_port: port }),
    { mode: 0o600 },
  );
}
function releaseAuthLock() { try { unlinkSync(authLockPath()); } catch {} }
// A winner that dies mid-flow must not leave the machine locked for the
// stale-window: drop an owned lock on the way out.
process.on("exit", () => {
  try {
    const l = JSON.parse(readFileSync(authLockPath(), "utf8"));
    if (l.pid === process.pid) unlinkSync(authLockPath());
  } catch {}
});

class AuthPending extends Error {
  constructor(url) {
    super(`authorization required — open in a browser: ${url}`);
    this.authorizeUrl = url;
  }
}

async function tokenRequest(meta, params) {
  const res = await fetch(meta.as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TokenError(
      `token endpoint ${res.status}: ${body.error || ""} ${body.error_description || ""}`.trim(),
      body.error, res.status,
    );
  }
  const tokens = {
    access_token: body.access_token,
    refresh_token: body.refresh_token ?? loadStore().tokens?.refresh_token,
    expires_at: body.expires_in ? Date.now() + (body.expires_in - 60) * 1000 : null,
  };
  saveStore({ tokens });
  return tokens;
}

// Starts (or joins) the machine-wide browser flow and throws AuthPending with
// the authorize URL immediately — no harness call ever blocks on a human. The
// winner completes the flow in the background and saves the tokens; every
// instance picks them up from the store on its next call.
let flowInBackground = null;
async function interactiveFlow(meta) {
  const port = callbackPort();

  // Join a standing flow only when its listener answers: URL plus open port,
  // never the lock file on its own.
  const standing = readAuthLock();
  if (standing?.authorize_url && await portListening(port)) {
    debug(`joining the flow held by pid ${standing.pid}`);
    throw new AuthPending(standing.authorize_url);
  }

  let callback;
  try {
    callback = await bindCallback(port);
  } catch (e) {
    if (e.code !== "EADDRINUSE") throw e;
    // Someone bound the port between our probe and our bind. With a lock we
    // can join them; without one an unknown process camps on the redirect
    // port, and any URL we hand out would redirect into it.
    const l = readAuthLock();
    if (l?.authorize_url) throw new AuthPending(l.authorize_url);
    throw new Error(`callback port ${port} is held by another process — free it, then retry`);
  }

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
    flowInBackground = (async () => {
      try {
        const codePromise = callback.waitForCode(authState);
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
      } catch (e) {
        log(`authorization flow failed: ${e.message}`);
      } finally {
        callback.close();
        releaseAuthLock();
        flowInBackground = null;
      }
    })();
    throw new AuthPending(url);
  } catch (e) {
    // The flow owns the listener once it starts; anything failing before that
    // must give the port back rather than camp on it.
    if (!flowInBackground) { callback.close(); releaseAuthLock(); }
    throw e;
  }
}

// --- machine-wide refresh coordination -------------------------------------
// The grant is ONE shared thing on disk, and refreshing it ROTATES it: the
// server issues a new refresh token and retires the old one. So a dozen local
// bridges refreshing "their" copy at the same moment is not merely wasteful —
// eleven of them present a token the server has just retired, and a server that
// watches for replay (the recommended posture for rotating grants) reads that
// as a stolen grant and answers by killing the whole family. Every agent on the
// machine is then logged out at once, minutes after a perfectly good login.
// That is the shape of the periodic surprise re-login this lock exists to end.
//
// So: at most one bridge on the machine refreshes at a time, and it re-reads the
// store once it holds the lock — if a sibling already did the work there is
// nothing left to do. One expiry, one refresh, however many bridges are up.
const REFRESH_LOCK_STALE_MS = 45_000; // longer than the token request's own deadline
const REFRESH_WAIT_MS = 60_000;       // a waiter gives up long before the harness does
const REFRESH_POLL_MS = 120;

class DeadGrantError extends Error {}

function refreshLockPath() { return storePath() + ".refreshing"; }

// The filesystem decides the winner: link() onto an existing name fails, and it
// publishes a file that was already written whole — so a rival reading the lock
// the instant it appears sees an owner, never a half-written one it would
// mistake for garbage and break. A lock left behind by a bridge that died
// mid-refresh must not stop the machine from ever refreshing again, so a lock
// whose owner is gone (or which outlived the longest possible refresh) is
// broken rather than obeyed.
function acquireRefreshLock() {
  const claim = () => {
    const tmp = `${refreshLockPath()}.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, started_at: Date.now() }), { mode: 0o600 });
    try { linkSync(tmp, refreshLockPath()); return true; } // atomic; EEXIST if held
    finally { try { unlinkSync(tmp); } catch {} }
  };
  // EEXIST means someone holds it; anything else means we cannot lock at all,
  // and waiting on a lock we could never take would only hang the call.
  const notHeld = (e) => { if (e.code !== "EEXIST") throw new Error(`cannot take the refresh lock: ${e.message}`); };
  try { mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 }); return claim(); }
  catch (e) { notHeld(e); }

  let held = null;
  try { held = JSON.parse(readFileSync(refreshLockPath(), "utf8")); } catch {}
  if (held && pidAlive(held.pid) && Date.now() - held.started_at < REFRESH_LOCK_STALE_MS) return false;
  debug("breaking a refresh lock nobody is holding");
  try { unlinkSync(refreshLockPath()); } catch {}
  try { return claim(); } catch (e) { notHeld(e); return false; } // someone else broke it first
}

function releaseRefreshLock() {
  try {
    const l = JSON.parse(readFileSync(refreshLockPath(), "utf8"));
    if (l.pid === process.pid) unlinkSync(refreshLockPath());
  } catch {}
}
process.on("exit", releaseRefreshLock);

// One refresh attempt, classified. Returns the new tokens, null if the attempt
// only proves someone else already rotated, and throws either a DeadGrantError
// (the grant itself is refused) or a plain Error (transient — keep the grant).
async function refreshOnce(meta, cur) {
  debug("refreshing access token");
  try {
    return await tokenRequest(meta, {
      grant_type: "refresh_token",
      refresh_token: cur.refresh_token,
      client_id: CFG.staticClientId || loadStore().client?.client_id,
      resource: meta.resource,
    });
  } catch (e) {
    // Definitive = the grant itself is refused: a known OAuth error code, or
    // any 400/401 from the token endpoint (servers word these codes freely —
    // witnessed: Rauthy answers a dead refresh with 401 "JwtToken").
    // Only 5xx/network/temporarily_unavailable stay transient.
    const definitive = e instanceof TokenError
      && e.oauthError !== "temporarily_unavailable"
      && (DEFINITIVE_OAUTH_ERRORS.has(e.oauthError) || e.status === 400 || e.status === 401);
    if (!definitive) {
      throw new Error(`token refresh failed transiently (${e.message}) — grant kept, will retry`);
    }
    // A rotated-away token is refused in exactly the same words as a dead one.
    // If the store moved on while we were asking, what we presented was merely
    // stale: the grant is alive, in someone else's hands.
    if (loadStore().tokens?.refresh_token !== cur.refresh_token) {
      debug("our refresh token was already rotated by a sibling — retrying with the stored one");
      return null;
    }
    if (e.oauthError === "invalid_client") {
      // The server has forgotten our dynamic registration. Keeping it would
      // point the next browser flow at an authorize page that refuses the
      // client — a login the human cannot complete however often they try.
      log("the server no longer knows this client — dropping the registration");
      saveStore({ client: null });
    }
    throw new DeadGrantError(e.message);
  }
}

// Get fresh tokens for the machine, refreshing at most once across all bridges.
// `rejected` is the access token we must not come back with.
async function refreshShared(meta, rejected) {
  const deadline = Date.now() + REFRESH_WAIT_MS;
  for (;;) {
    const sibling = usableTokens({ rejected });
    if (sibling) { debug("a sibling refreshed the grant — reusing it"); return sibling; }
    // Whoever holds the lock is alive and still working, or we keep losing the
    // grant to a rotating sibling. Either way, presenting our own copy now is
    // the one move that could burn it: we fail this call instead, and the grant
    // stays whole for the next one.
    if (Date.now() > deadline) {
      throw new Error("the shared grant could not be refreshed in time — grant kept, will retry");
    }
    if (acquireRefreshLock()) {
      try {
        const late = usableTokens({ rejected }); // re-read: the wait itself may have settled it
        if (late) { debug("a sibling refreshed the grant — reusing it"); return late; }
        const cur = loadStore().tokens;
        if (!cur?.refresh_token) throw new DeadGrantError("no refresh grant on disk");
        const fresh = await refreshOnce(meta, cur);
        if (fresh) return fresh;
      } finally {
        releaseRefreshLock();
      }
    } else {
      await sleep(REFRESH_POLL_MS);
    }
  }
}

let authInFlight = null;
// Returns fresh-enough tokens. Order: cached access token -> silent refresh ->
// (only if allowed and the grant is definitively dead) the browser flow.
// opts.force ignores the cached access token (after an upstream 401);
// opts.interactive=false forbids the browser (background keepalive).
async function ensureAuth(wwwAuthenticate, opts = {}) {
  const { force = false, interactive = true } = opts;
  if (authInFlight) {
    // A background (non-interactive) attempt must not stand in for a caller
    // that is allowed to open the browser: await it, and if it could not
    // finish the job, run our own interactive round.
    if (!interactive || authInFlight.interactive) return authInFlight.promise;
    await authInFlight.promise.catch(() => {});
    if (authInFlight) return authInFlight.promise; // someone else already restarted it
    const s = loadStore();
    if (tokenUsable(s.tokens)) return s.tokens;
  }
  const promise = (async () => {
    try {
      const s = loadStore();
      // force says the token we hold is no answer — upstream refused it (401)
      // or the keepalive found it about to expire. Remembering WHICH token that
      // was is what makes a sibling's newer one recognisable as progress.
      const rejected = force ? s.tokens?.access_token ?? null : null;
      if (!force && tokenUsable(s.tokens)) return s.tokens;
      const meta = s.meta?.as ? s.meta : await discover(wwwAuthenticate);
      // Discovery runs once and its result is cached in the store, so an
      // override set later would never be seen — and the operator setting one
      // is, by definition, doing it AFTER a flow already ran and produced the
      // wrong audience. Apply it here, where the value is used, not only where
      // it is discovered.
      if (CFG.resource) meta.resource = CFG.resource;
      if (s.tokens?.refresh_token) {
        try {
          return await refreshShared(meta, rejected);
        } catch (e) {
          // Anything but a dead grant is transient: keep it, do NOT open a browser.
          if (!(e instanceof DeadGrantError)) throw e;
          log(`refresh grant is dead (${e.message})` + (interactive ? " — starting a fresh authorization" : ""));
          if (!interactive) throw new Error("authorization required (refresh grant dead, browser flow deferred)");
          return await interactiveFlow(meta);
        }
      }
      if (!interactive) throw new Error("authorization required (no tokens, browser flow deferred)");
      return await interactiveFlow(meta);
    } finally {
      authInFlight = null;
    }
  })();
  authInFlight = { promise, interactive };
  return promise;
}

// Keep the grant alive even when the harness makes no MCP calls: refresh the
// access token shortly before expiry, rotating the refresh token with it, so
// an idle session never decays into a dead grant and a surprise browser trip.
const REFRESH_MARGIN_MS = 3 * 60_000;
function startTokenKeepalive() {
  const tick = () => {
    const t = loadStore().tokens;
    if (!t?.refresh_token) return;
    const expiresAt = t.expires_at || 0;
    if (expiresAt && expiresAt - Date.now() < REFRESH_MARGIN_MS) {
      ensureAuth(null, { force: true, interactive: false })
        .then(() => debug("background token refresh ok"))
        .catch((e) => log(`background token refresh: ${e.message}`));
    }
  };
  tick(); // an already-expired store refreshes on startup, before the first call
  setInterval(tick, 60_000).unref();
}

// -------------------------------------------------- streamable HTTP client

const state = {
  sessionId: null,
  protocolVersion: null,
  initParams: null, // params of the harness's initialize, for transparent replay
  reinitCounter: 0,
};

function emit(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let m;
    while ((m = /\r?\n\r?\n/.exec(buf)) !== null) {
      const raw = buf.slice(0, m.index);
      buf = buf.slice(m.index + m[0].length);
      const data = raw
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) yield data;
    }
  }
}

// One POST to the server for one JSON-RPC message. Forwards every message the
// server answers with (JSON body or a per-request SSE stream) via onMessage.
async function post(msg, onMessage) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const tokens = loadStore().tokens;
  if (tokens?.access_token) headers.authorization = `Bearer ${tokens.access_token}`;
  if (state.sessionId) headers["mcp-session-id"] = state.sessionId;
  if (state.protocolVersion) headers["mcp-protocol-version"] = state.protocolVersion;

  let res;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(CFG.timeoutMs),
    });
  } catch (e) {
    const reason = e.name === "TimeoutError" ? `no answer within ${CFG.timeoutMs}ms` : e.message;
    throw new UpstreamError(`upstream unreachable: ${reason}`, "network");
  }

  if (res.status === 401) {
    res.body?.cancel?.();
    throw new UpstreamError(res.headers.get("www-authenticate") || "unauthorized", "auth");
  }
  if (res.status === 404 && state.sessionId) {
    res.body?.cancel?.();
    throw new UpstreamError("session expired upstream", "session");
  }
  if (res.status === 202 || res.status === 204) return;
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new UpstreamError(`upstream HTTP ${res.status}: ${text}`, "http");
  }

  const sid = res.headers.get("mcp-session-id");
  if (sid) state.sessionId = sid;

  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("text/event-stream")) {
    try {
      for await (const data of sseEvents(res.body)) {
        try { onMessage(JSON.parse(data)); }
        catch { debug(`unparseable SSE data: ${data.slice(0, 120)}`); }
      }
    } catch (e) {
      throw new UpstreamError(`upstream stream broke mid-response: ${e.message}`, "network");
    }
    return;
  }
  const text = await res.text();
  if (!text.trim()) return;
  try { onMessage(JSON.parse(text)); }
  catch {
    throw new UpstreamError(`upstream sent unparseable JSON: ${text.slice(0, 200)}`, "http");
  }
}

// Transparent re-initialize after a lost session: replay the harness's own
// initialize params under a bridge-internal id, swallow the response.
let reinitInFlight = null;
async function reinitialize() {
  if (reinitInFlight) return reinitInFlight;
  reinitInFlight = (async () => {
    try {
      if (!state.initParams) throw new UpstreamError("session lost before initialize", "session");
      log("upstream session lost — re-initializing transparently");
      state.sessionId = null;
      const id = `iskron-bridge-reinit-${++state.reinitCounter}`;
      let result = null;
      await post(
        { jsonrpc: "2.0", id, method: "initialize", params: state.initParams },
        (m) => { if (m.id === id) result = m; },
      );
      if (!result || result.error) {
        throw new UpstreamError(`re-initialize refused: ${JSON.stringify(result?.error ?? null)}`, "session");
      }
      if (result.result?.protocolVersion) state.protocolVersion = result.result.protocolVersion;
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, () => {});
      log(`session re-established (${state.sessionId || "no session id"})`);
    } finally {
      reinitInFlight = null;
    }
  })();
  return reinitInFlight;
}

function syntheticError(id, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32001,
      message: `iskron-bridge: ${message}. The bridge stays up — retry the call; if this repeats, the server side needs attention.`,
    },
  };
}

// Deliver one harness message upstream, with one auth retry and one session
// retry. On final failure a request id is ALWAYS answered with an error.
async function deliver(msg) {
  const isInit = msg?.method === "initialize";
  if (isInit) state.initParams = msg.params;
  const hasId = msg?.id !== undefined && msg?.id !== null;
  let authRetried = false;
  let sessionRetried = false;

  const forward = (m) => {
    if (isInit && m.id === msg.id && m.result?.protocolVersion) {
      state.protocolVersion = m.result.protocolVersion;
    }
    emit(m);
  };

  for (;;) {
    try {
      await post(msg, forward);
      return;
    } catch (e) {
      if (e instanceof UpstreamError && e.kind === "auth" && !authRetried) {
        authRetried = true;
        try {
          await ensureAuth(e.message, { force: true });
          continue;
        } catch (authErr) {
          if (authErr instanceof AuthPending) {
            if (hasId) emit(syntheticError(msg.id, authErr.message));
            return;
          }
          log(`authorization failed: ${authErr.message}`);
          if (hasId) emit(syntheticError(msg.id, `authorization failed: ${authErr.message}`));
          return;
        }
      }
      if (e instanceof UpstreamError && e.kind === "session" && !sessionRetried && !isInit) {
        sessionRetried = true;
        try {
          await reinitialize();
          continue;
        } catch (reErr) {
          if (hasId) emit(syntheticError(msg.id, `session recovery failed: ${reErr.message}`));
          return;
        }
      }
      const reason = e instanceof UpstreamError ? e.message : `bridge internal error: ${e.message}`;
      log(`request ${hasId ? msg.id : `(notification ${msg?.method})`} failed: ${reason}`);
      if (hasId) emit(syntheticError(msg.id, reason));
      return;
    }
  }
}

// ---------------------------------------------------------------- main loop

function main() {
  CFG = parseArgs(process.argv.slice(2));
  log(`v${VERSION} -> ${CFG.serverUrl} (timeout ${CFG.timeoutMs}ms, auth in ${storePath()})`);
  startTokenKeepalive();

  const rl = createInterface({ input: process.stdin, terminal: false });
  const pending = new Set();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch {
      log(`unparseable line from harness: ${trimmed.slice(0, 120)}`);
      return;
    }
    const p = deliver(msg).catch((e) => log(`unexpected: ${e.stack || e}`));
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  // A human may be mid-click on OUR authorize URL: dying now kills the callback
  // server and silently loses their login, and the click is not repeatable —
  // the human sees a browser error, not a retry. So a bridge asked to go away
  // outlives a pending flow; the flow's own timeout bounds the wait. A harness
  // that will not wait that long may kill us outright, and that is survivable:
  // the next bridge finds no listener on the callback port and takes the flow
  // over. Ctrl-C is the one exception — someone is at the terminal, wanting out.
  const leave = async (why) => {
    debug(`${why} — winding down`);
    await Promise.allSettled([...pending]);
    if (flowInBackground) {
      log(`${why}, but an authorization flow is pending — staying up until the human's click lands`);
      await flowInBackground.catch(() => {});
    }
    process.exit(0);
  };
  rl.on("close", () => leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => leave("SIGTERM"));
  process.on("SIGINT", () => process.exit(0)); // at a terminal: leave at once
  process.on("uncaughtException", (e) => log(`uncaught: ${e.stack || e}`));
  process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e?.stack || e}`));
}

main();
