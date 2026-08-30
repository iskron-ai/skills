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
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync, unlinkSync, renameSync, linkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// VERSION is the PLUGIN version — one delivery, one number: quoting it dates
// the whole installed snapshot, skills included, not just this file. It is
// stamped by release-please on every release (the x-release-please-version
// annotation below); never edit it by hand. Between releases the hash is what
// dates a report: it names the bytes that actually ran, patched copies and
// forgotten rebuilds included.
const VERSION = "3.6.0"; // x-release-please-version
const BUILD = (() => {
  try {
    const src = readFileSync(fileURLToPath(import.meta.url));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch { return `v${VERSION}`; }
})();
const DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";
// The stop of last resort under a wind-down flush: long enough that a busy but
// living harness still gets its whole answer, short enough that no wedged pipe
// keeps a process alive on the machine.
const FLUSH_STOP_MS = 5_000;
// How long the human's browser is held while the code is exchanged. Long enough
// for a round trip to the token endpoint, short enough that a wedged exchange
// gives them a line to read instead of a spinner.
const PAGE_HOLD_MS = 20_000;

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
    else if (a === "--version") { process.stdout.write(BUILD + "\n"); process.exit(0); }
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

// A harness that goes away leaves BOTH our pipes broken, and a write to a
// broken pipe fails asynchronously, as an error event on the stream. Unhandled,
// that event reaches the uncaughtException handler below — which logs, writing
// to the same broken pipe, which fails again. The loop that follows burns a
// core and starves whatever else the process was doing; witnessed in the field
// as a pending login whose click landed on a bridge too busy to exchange it,
// twice, while the human was shown "authenticated" both times. So: note a
// stream's death once, and never answer a failed write with another write.
const deadStreams = new WeakSet();
function canWrite(s) { return !!s && !deadStreams.has(s) && !s.destroyed && s.writable !== false; }
function guardStream(s) { if (s) s.on("error", () => deadStreams.add(s)); }
function writeTo(s, text) {
  if (!canWrite(s)) return false;
  try { s.write(text); return true; } catch { deadStreams.add(s); return false; }
}

function log(msg) {
  writeTo(process.stderr, `[iskron-bridge ${new Date().toISOString()}] ${msg}\n`);
}
let CFG = null;
function debug(msg) {
  if (CFG?.debug) log(`debug: ${msg}`);
}

// ---------------------------------------------------------------- utilities

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (s) => createHash("sha256").update(s).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- the server's clock, not ours ------------------------------------------
// Every hour this bridge reasons about — access exp, refresh nbf/exp — is
// stamped by the server's clock, and a machine's own clock is allowed to lie.
// Witnessed in the field: a clock ~28 minutes behind the server made a spent
// access token look fresh (every call bought a 401 first) and a refresh token
// long in force look held back — the exact arithmetic behind a recurring
// "not in force for another 1650s" outage. So the skew is measured off the
// Date header every upstream answer already carries, and every judgement of a
// token's hours goes through now(), which speaks server time. The measurement
// is persisted so a fresh process starts corrected, before its first response.
const SKEW_NOISE_MS = 5_000;     // the Date header keeps whole seconds and rides one network leg
const SKEW_MATERIAL_MS = 30_000; // persist and announce only a skew that could move a decision
let clockSkewMs = null;          // server minus local; null until measured or loaded
function skewMs() {
  if (clockSkewMs === null) {
    const s = Number(loadStore().clock_skew_ms);
    clockSkewMs = Number.isFinite(s) ? s : 0;
  }
  return clockSkewMs;
}
function now() { return Date.now() + skewMs(); }
function noteServerDate(res) {
  const d = Date.parse(res?.headers?.get("date") || "");
  if (!Number.isFinite(d)) return;
  const measured = d - Date.now();
  const skew = Math.abs(measured) < SKEW_NOISE_MS ? 0 : measured;
  const prev = skewMs();
  clockSkewMs = skew;
  if (Math.abs(skew - prev) >= SKEW_MATERIAL_MS) {
    try { saveStore({ clock_skew_ms: skew }); } catch {}
    grantLog(skew === 0
      ? "machine clock is back in step with the server"
      : `machine clock is ${Math.round(Math.abs(skew) / 1000)}s ${skew > 0 ? "behind" : "ahead of"} the server`
        + ` — token hours are judged by the server's clock (fix NTP to stop paying a 401 per rotation)`);
  }
}

// Tokens are opaque by contract, so this only ever ASKS — a claim that is not
// there changes nothing. What it buys is the one thing the token endpoint never
// says out loud: when a freshly issued refresh token actually starts working.
function jwtClaims(token) {
  try { return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString()); }
  catch { return null; }
}

class UpstreamError extends Error {
  // `presented` carries the access token the refused request actually used —
  // knowledge only the caller has. The store may have moved on since, and a
  // token a sibling has already replaced must not be blamed for this refusal.
  constructor(message, kind, presented = null) { super(message); this.kind = kind; this.presented = presented; }
}

// The hours the SERVER keeps. Both tokens carry them when they are JWTs, and
// the server judges by those, never by our arithmetic: `exp` on the access
// token is the moment it stops being accepted; `nbf` on the refresh token is
// the moment it STARTS being accepted — a server may hold a refresh token back
// until the access token it came with is nearly spent (witnessed: Rauthy stamps
// nbf at access expiry minus a minute), and asking earlier is refused in the
// exact words of a dead grant; `exp` on the refresh token is when the grant is
// honestly over and only a human can mend it. Opaque tokens say none of this,
// so `expires_in` remains the fallback — a fallback, not the first source.
const CLOCK_SKEW_MS = 60_000; // stop trusting a token this long before its exp
function tokenSchedule(body, refresh) {
  const a = jwtClaims(body.access_token);
  const r = jwtClaims(refresh);
  const accessExp = Number.isFinite(a?.exp) ? a.exp * 1000
    : (body.expires_in ? now() + body.expires_in * 1000 : null);
  // A minute of caution is right for tokens that live for half an hour and
  // absurd for one that lives for thirty seconds: taken whole it would declare
  // every token stale on arrival. Never give up more than half the life.
  const skew = accessExp ? Math.min(CLOCK_SKEW_MS, Math.max(0, (accessExp - now()) / 2)) : 0;
  return {
    expires_at: accessExp ? accessExp - skew : null,
    refresh_not_before: Number.isFinite(r?.nbf) ? r.nbf * 1000 : null,
    refresh_expires_at: Number.isFinite(r?.exp) ? r.exp * 1000 : null,
  };
}

// The stored hours are a convenience, not the source. A store written by an
// older bridge carries none of them, and a machine mid-upgrade must not have to
// wait for a rotation to start reading the clock right — the token itself has
// said so all along.
function refreshHours(t) {
  const c = jwtClaims(t?.refresh_token);
  return {
    nbf: Number.isFinite(t?.refresh_not_before) ? t.refresh_not_before
      : (Number.isFinite(c?.nbf) ? c.nbf * 1000 : null),
    exp: Number.isFinite(t?.refresh_expires_at) ? t.refresh_expires_at
      : (Number.isFinite(c?.exp) ? c.exp * 1000 : null),
  };
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

// A short machine-wide record of what the grant has been doing. Its whole point
// is that the next surprise login can be explained after the fact: a bridge's
// stderr belongs to whichever harness happened to spawn it and is usually gone
// by the time anyone asks. Tokens never go in here.
function grantLog(msg) {
  try {
    mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 });
    const p = join(CFG.authDir, "grant.log");
    let size = 0;
    try { size = statSync(p).size; } catch {}
    if (size > 128_000) { try { unlinkSync(p); } catch {} }
    appendFileSync(p, `${new Date().toISOString()} pid=${process.pid} ${BUILD} ${msg}\n`, { mode: 0o600 });
  } catch {} // a log that cannot be written must never break the call
}

// The machine's memory of a refused grant: since when, in whose words, and
// whether a human has already been asked and declined. Shared by every bridge,
// so one refusal is one question to the human, not one per process.
function grantStatePath() { return storePath() + ".grant-state"; }
function loadGrantState() {
  try { return JSON.parse(readFileSync(grantStatePath(), "utf8")); } catch { return {}; }
}
function saveGrantState(patch) {
  try {
    mkdirSync(CFG.authDir, { recursive: true, mode: 0o700 });
    const next = { ...loadGrantState(), ...patch };
    const tmp = `${grantStatePath()}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
    renameSync(tmp, grantStatePath());
  } catch {}
}
function clearGrantState() { try { unlinkSync(grantStatePath()); } catch {} }

// The tokens on disk, judged for use here and now: present, not the very token
// we already know is refused, and not inside `marginMs` of expiry.
function tokenUsable(t, { rejected = null, marginMs = 0 } = {}) {
  if (!t?.access_token) return false;
  if (rejected && t.access_token === rejected) return false;
  if (t.expires_at && t.expires_at - now() <= marginMs) return false;
  return true;
}
function usableTokens(opts) {
  const t = loadStore().tokens;
  return tokenUsable(t, opts) ? t : null;
}

// -------------------------------------------------------------------- OAuth

async function fetchJson(url, opts = {}, timeoutMs = 15_000) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  noteServerDate(res);
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

// Stable per-origin loopback port, so the registered redirect_uri survives
// restarts. The port sits in the OS's ephemeral range on Linux, so any
// outbound socket on the machine can happen to hold it (witnessed on a shared
// CI runner) — hence a short ladder of derived rungs rather than one port:
// one foreign occupant must not make login impossible. The first rung is the
// historical port, so existing registrations keep working; a changed rung
// merely re-registers the client.
const CALLBACK_PORT_RUNGS = 3;
function callbackPort(rung = 0) {
  const d = sha256(new URL(CFG.serverUrl).origin);
  return 42000 + (d[0] * 256 + d[1] + rung * 613) % 2000;
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
// The page this server draws is the ONLY report the human gets: they clicked,
// they read a line, they close the tab and go. So the line must say what
// actually happened, and the code arriving is not yet the grant existing — the
// exchange still has to run. A page that says "authenticated" the moment the
// redirect lands sends the human away from the one screen that could have told
// them it failed; witnessed in the field, twice in a row, with an empty store.
// So the browser is held until the exchange answers, and `report` is what
// answers it — under a hold short enough that a wedged exchange leaves a tab
// with an honest "still running", never a spinner forever.
function bindCallback(port) {
  return new Promise((resolve, reject) => {
    let handOff = null;   // set once someone is waiting for the code
    let received = null;  // …or hold what arrived before they asked
    let browser = null;   // the redirect's response, held open for the verdict
    const deliver = (v) => { if (handOff) handOff(v); else received = v; };
    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
    const tellBrowser = (line) => {
      if (!browser) return;
      const res = browser; browser = null;
      try {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<h3>${line}</h3>`);
      } catch { /* the human closed the tab; the flow is unaffected */ }
    };

    const server = createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
      const err = u.searchParams.get("error");
      // A human who is not sure the first click landed clicks again — and the
      // held response is exactly what makes them unsure. Hand the older tab a
      // line of its own rather than silently dropping its response: an
      // abandoned one spins until the browser gives up on it.
      if (browser) tellBrowser("iskron-bridge: another tab is finishing this login — you can close this one.");
      browser = res;
      if (err) tellBrowser(`iskron-bridge: authorization failed (${esc(err)})`);
      else setTimeout(() => tellBrowser("iskron-bridge: the code arrived and the exchange is still running — watch the agent."), PAGE_HOLD_MS).unref();
      deliver({ code: u.searchParams.get("code"), state: u.searchParams.get("state"), err });
    });

    server.once("error", reject); // EADDRINUSE: someone else owns the flow
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      server.on("error", (e) => log(`callback server: ${e.message}`));
      resolve({
        port,
        // What the human is told, once the exchange has actually answered.
        report: (failure) => tellBrowser(failure
          ? `iskron-bridge: authorization failed (${esc(failure)}) — nothing was stored; the agent has the details.`
          : "iskron-bridge: authenticated — you can close this tab."),
        close: () => { tellBrowser("iskron-bridge: the login was abandoned — nothing was stored."); server.close(); },
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

// Not a failure: a deliberate refusal to spend the human's attention yet.
class LoginHeld extends Error {}

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
  noteServerDate(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new TokenError(
      `token endpoint ${res.status}: ${body.error || ""} ${body.error_description || ""}`.trim(),
      body.error, res.status,
    );
  }
  const refresh = body.refresh_token ?? loadStore().tokens?.refresh_token;
  const tokens = { access_token: body.access_token, refresh_token: refresh, ...tokenSchedule(body, refresh) };
  saveStore({ tokens });
  clearGrantState(); // a grant in hand ends whatever the machine held against it
  grantLog(`tokens stored (${params.grant_type}); access good for `
    + `${tokens.expires_at ? Math.round((tokens.expires_at - now()) / 1000) + "s" : "an unstated time"}`
    + `${tokens.refresh_not_before ? `, refresh usable in ${Math.round((tokens.refresh_not_before - now()) / 1000)}s` : ""}`);
  return tokens;
}

// Starts (or joins) the machine-wide browser flow and throws AuthPending with
// the authorize URL immediately — no harness call ever blocks on a human. The
// winner completes the flow in the background and saves the tokens; every
// instance picks them up from the store on its next call.
let flowInBackground = null;
async function interactiveFlow(meta) {
  // Join a standing flow only when its listener answers: URL plus open port,
  // never the lock file on its own. The port to probe is the one the OWNER
  // bound and wrote into the lock — it may be a later rung than ours.
  const standing = readAuthLock();
  if (standing?.authorize_url && await portListening(standing.callback_port)) {
    debug(`joining the flow held by pid ${standing.pid}`);
    throw new AuthPending(standing.authorize_url);
  }

  let callback = null;
  for (let rung = 0; rung < CALLBACK_PORT_RUNGS && !callback; rung++) {
    try {
      callback = await bindCallback(callbackPort(rung));
    } catch (e) {
      if (e.code !== "EADDRINUSE") throw e;
      // Someone bound it between our probe and our bind. With a lock whose
      // listener answers we can join them; without one an unknown process
      // camps on this rung — step to the next one rather than declare the
      // login impossible over a single busy port.
      const l = readAuthLock();
      if (l?.authorize_url && await portListening(l.callback_port)) throw new AuthPending(l.authorize_url);
      debug(`callback port ${callbackPort(rung)} is held by a foreign process — trying the next rung`);
    }
  }
  if (!callback) {
    const rungs = Array.from({ length: CALLBACK_PORT_RUNGS }, (_, k) => callbackPort(k)).join(", ");
    throw new Error(`all candidate callback ports (${rungs}) are held by other processes — free one, then retry`);
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
        grantLog("authorization complete");
        callback.report(null);
      } catch (e) {
        callback.report(e.message); // the human is still on that tab, waiting to be told
        log(`authorization flow failed: ${e.message}`);
        // Declined, closed, or left to time out — either way the human has
        // answered for now, and the answer holds until the snooze runs out.
        saveGrantState({ snooze_until: Date.now() + LOGIN_SNOOZE_MS });
        grantLog(`authorization not completed (${e.message}); not asking again for ${LOGIN_SNOOZE_MS / 60_000}min`);
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
const EARLY_REFUSAL_COOLDOWN_MS = 15_000; // one knock per stretch, never one per call

// `expired` marks the one refusal that is proof by the grant's own hours: the
// refresh token's exp has passed, and no server hiccup ever looks like that.
class DeadGrantError extends Error {
  constructor(message, expired = false) { super(message); this.expired = expired; }
}

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
// `proactive` marks the speculative kind: the access token still works and we
// are only topping it up ahead of expiry.
async function refreshOnce(meta, cur, proactive) {
  // The hour is a reason to WAIT, never a reason to refuse to act. Holding back
  // a refresh nobody needs yet is thrift (that pacing lives in the keepalive,
  // where the speculative caller is); holding back one the caller needs now is
  // a wall — it turns "the server might say no" into "no answer for half an
  // hour", and the caller has no way around it. Our reading can also be stale:
  // a sibling may have rotated the grant a moment ago, and then the nbf we are
  // looking at belongs to a token the server has already retired. So a needed
  // refresh knocks — ONCE per stretch. Knocking on every call would turn one
  // rejected access token into hundreds of refused token requests, from every
  // bridge on the machine: the lock serializes concurrency, not repetition.
  const hours = refreshHours(cur);
  const inTheWindow = hours.nbf && now() < hours.nbf;
  const cooling = inTheWindow && loadGrantState().early_refused_until;
  if (cooling && now() < cooling) {
    const left = Math.round((cooling - now()) / 1000);
    throw new Error(`the token endpoint refused this grant as too early moments ago`
      + ` — not knocking again for ${left}s; grant kept, will retry`);
  }
  debug("refreshing access token");
  try {
    return await tokenRequest(meta, {
      grant_type: "refresh_token",
      refresh_token: cur.refresh_token,
      client_id: CFG.staticClientId || loadStore().client?.client_id,
      resource: meta.resource,
    });
  } catch (e) {
    // A token endpoint that answers 404/405/410 — or whose host is not there
    // to answer at all — is discovery gone stale: the AS moved and the store
    // still points at where it used to live. Cached forever, that is a
    // permanent outage every attempt walks back into; dropped, the next
    // attempt rediscovers and heals. The grant itself was never judged.
    const gone = e instanceof TokenError
      ? [404, 405, 410].includes(e.status)
      : ["ENOTFOUND", "ECONNREFUSED"].includes(e.cause?.code);
    if (gone) {
      saveStore({ meta: null });
      grantLog(`token endpoint is gone (${e.message}) — cached discovery dropped, rediscovering on the next attempt`);
      throw new Error(`the token endpoint is gone (${e.message}) — rediscovering on the next attempt; grant kept, will retry`);
    }
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
    // Refused, yes — but a refusal is not a verdict. The grant's own hours say
    // more than the server's wording does: a token still short of its nbf, or
    // one nobody needed yet, is refused in exactly the words of a dead grant.
    // Only an expired refresh token is honest proof that a human must return.
    const expired = hours.exp && now() >= hours.exp;
    const notYet = hours.nbf && now() < hours.nbf;
    if (!expired && (notYet || proactive)) {
      const why = notYet
        ? `refresh token is not in force for another ${Math.round((hours.nbf - now()) / 1000)}s`
        : "the access token in hand still works";
      // Remember the refusal for a breath, so the next call in this stretch
      // waits with us instead of asking the same doomed question again — but
      // only when it was the HOUR that refused us. A speculative refusal must
      // never gag a caller who actually needs a token: that is the same wall,
      // built smaller. And never past the hour itself: the moment it arrives,
      // knocking is the right move again.
      let until = null;
      if (notYet) {
        until = Math.min(now() + EARLY_REFUSAL_COOLDOWN_MS, hours.nbf);
        saveGrantState({ early_refused_until: until });
      }
      grantLog(`refresh refused early — ${why}; grant kept`
        + (until ? `, not knocking again for ${Math.round((until - now()) / 1000)}s` : "")
        + ` (${e.message})`);
      throw new Error(`token refresh refused too early (${e.message}) — ${why}; grant kept, will retry`);
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
      grantLog("server no longer knows this client — registration dropped");
      saveStore({ client: null });
    }
    const overdue = hours.exp && now() >= hours.exp;
    grantLog(`refresh refused${overdue ? " and the grant is past its own expiry" : ""}: ${e.message}`);
    throw new DeadGrantError(overdue ? `${e.message} (grant expired)` : e.message, !!overdue);
  }
}

// Get fresh tokens for the machine, refreshing at most once across all bridges.
// `rejected` is the access token we must not come back with.
async function refreshShared(meta, rejected, proactive) {
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
        const fresh = await refreshOnce(meta, cur, proactive);
        if (fresh) return fresh;
      } finally {
        releaseRefreshLock();
      }
    } else {
      await sleep(REFRESH_POLL_MS);
    }
  }
}

// A login is the one repair that costs a human their attention, so it is spent
// last and not twice. Two waits stand between a refused grant and the browser:
// a refusal must PERSIST (a single one can be the server mid-restart, a clock
// skew, a token not yet in force), and a login already offered and declined is
// not offered again at once — a person who said no meant it for more than the
// four seconds until the next tool call.
const LOGIN_GRACE_MS = 120_000;
const LOGIN_SNOOZE_MS = 10 * 60_000;

// Start (or continue) the machine's clock on a refused grant. The background
// keepalive notes refusals too, so the grace is already warm by the time a
// human's call arrives — a grant dead for an hour asks at once, not in two
// more minutes.
function noteRefusal(reason) {
  if (!loadGrantState().refused_since) {
    saveGrantState({ refused_since: Date.now(), reason });
    grantLog(`grant refused, holding the login back for ${LOGIN_GRACE_MS / 1000}s: ${reason}`);
  }
}

function holdOffLogin(reason, expired = false) {
  const local = Date.now(); // human pacing runs on the human's own clock
  const st = loadGrantState();
  if (st.snooze_until && local < st.snooze_until) {
    throw new LoginHeld(`authorization was offered and not completed — not asking again for `
      + `${Math.round((st.snooze_until - local) / 1000)}s (grant refused: ${reason})`);
  }
  // The grace exists because a refusal can be a server mid-restart wearing a
  // dead grant's words. A grant past its own exp is not ambiguous: its hours
  // are proof, and the keepalive never knocks on it — so the grace would start
  // stone-cold at the human's first call and cost them two minutes of failing
  // calls before the login they already owe. Ask at once instead.
  if (expired) return;
  const since = st.refused_since || local;
  if (local - since < LOGIN_GRACE_MS) {
    throw new LoginHeld(`grant refused (${reason}) — holding off the login for `
      + `${Math.round((LOGIN_GRACE_MS - (local - since)) / 1000)}s in case it heals; the call can be retried`);
  }
}

let authInFlight = null;
// Returns fresh-enough tokens. Order: cached access token -> silent refresh ->
// (only if allowed and the grant is definitively dead) the browser flow.
// opts.force ignores the cached access token (after an upstream 401);
// opts.rejected names the token upstream actually refused, when the caller knows;
// opts.interactive=false forbids the browser (background keepalive);
// opts.proactive marks a top-up the caller does not actually need yet.
async function ensureAuth(wwwAuthenticate, opts = {}) {
  const { force = false, interactive = true, proactive = false } = opts;
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
      // force says the token we came with is no answer — upstream refused it
      // (401) or the keepalive found it about to expire. WHICH token that was
      // is what makes a sibling's newer one recognisable as progress, so a
      // caller that knows says so; only the keepalive, replacing whatever is on
      // disk, may take the store's word for it.
      const rejected = opts.rejected ?? (force ? s.tokens?.access_token ?? null : null);
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
          return await refreshShared(meta, rejected, proactive);
        } catch (e) {
          // Anything but a dead grant is transient: keep it, do NOT open a browser.
          if (!(e instanceof DeadGrantError)) throw e;
          noteRefusal(e.message); // the clock runs whoever noticed, background included
          if (!interactive) throw new Error("authorization required (refresh grant dead, browser flow deferred)");
          holdOffLogin(e.message, e.expired); // may decide the human is not to be asked yet
          log(`refresh grant is dead (${e.message}) — starting a fresh authorization`);
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
//
// The margin is a wish, not a right: a refresh token held back until the access
// token is nearly spent (nbf) cannot be used early however much time the margin
// would like. Asking anyway buys nothing and spends a refusal, so the keepalive
// waits for the later of the two hours.
const REFRESH_MARGIN_MS = 3 * 60_000;
function startTokenKeepalive() {
  const tick = () => {
    const t = loadStore().tokens;
    if (!t?.refresh_token) return;
    const expiresAt = t.expires_at || 0;
    if (!expiresAt || expiresAt - now() >= REFRESH_MARGIN_MS) return;
    const hours = refreshHours(t);
    if (hours.nbf && now() < hours.nbf) {
      debug(`refresh token not in force for another ${Math.round((hours.nbf - now()) / 1000)}s — waiting`);
      return;
    }
    if (hours.exp && now() >= hours.exp) {
      debug("the grant is past its own expiry — only a human can mend it now");
      return; // spending refusals on a grant whose hour has passed teaches nobody anything
    }
    ensureAuth(null, { force: true, interactive: false, proactive: true })
      .then(() => debug("background token refresh ok"))
      .catch((e) => log(`background token refresh: ${e.message}`));
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
  writeTo(process.stdout, JSON.stringify(msg) + "\n");
}

// Writing to a pipe is asynchronous, and process.exit does not wait: an answer
// still in the buffer dies with the process. One pipe buffer is 64KB, so the
// answers that get cut are the big ones — a whole realm read — and the harness
// sees a truncated line, which is silence wearing an answer's clothes. Every
// exit path goes through here first. Measured: 200KB written and exited on the
// spot arrives as 65536 bytes; drained first, it arrives whole.
function flushStdout() {
  return new Promise((resolve) => {
    const out = process.stdout;
    if (!canWrite(out) || out.writableLength === 0) return resolve();
    // A pipe whose reader is gone never drains, so the drain callback never
    // fires — and an exit path that waits on it does not exit at all. The
    // reader's death has its own signal: the queued bytes fail, and the stream
    // errors. Wait for whichever comes first, and keep a long stop of last
    // resort under both, so no harness can wedge the wind-down.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      out.off("error", finish);
      out.off("close", finish);
      resolve();
    };
    out.once("error", finish);
    out.once("close", finish);
    out.write("", finish); // queued behind everything already written
    setTimeout(finish, FLUSH_STOP_MS).unref();
  });
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
  noteServerDate(res);

  if (res.status === 401) {
    res.body?.cancel?.();
    throw new UpstreamError(res.headers.get("www-authenticate") || "unauthorized", "auth",
      tokens?.access_token ?? null);
  }
  if (res.status === 404 && state.sessionId) {
    res.body?.cancel?.();
    throw new UpstreamError("session expired upstream", "session");
  }
  const sid = res.headers.get("mcp-session-id");
  if (sid) state.sessionId = sid; // a session id may ride any answer, including an empty one
  if (res.status === 202 || res.status === 204) return;
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    throw new UpstreamError(`upstream HTTP ${res.status}: ${text}`, "http");
  }

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
      // BUILD is here for the field report: the error is quoted verbatim, and
      // the build string is what dates the code that produced it.
      message: `iskron-bridge ${BUILD}: ${message}. The bridge stays up — retry the call; if this repeats, the server side needs attention.`,
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
          await ensureAuth(e.message, { force: true, rejected: e.presented });
          continue;
        } catch (authErr) {
          if (authErr instanceof AuthPending || authErr instanceof LoginHeld) {
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
      // A SECOND 401 — after a refresh already replaced the token — is never
      // an expiry: the server is refusing tokens as such, and retries cannot
      // fix that. Name the one likely defect (audience/resource mismatch) and
      // its lever, or the report that reaches us says only "unauthorized".
      const reason = e instanceof UpstreamError
        ? (e.kind === "auth" && authRetried
          ? `upstream refuses even a freshly obtained access token (${e.message}) — not an expiry; `
            + `the token's audience/resource may not match what the server validates `
            + `(operator lever: ISKRON_BRIDGE_RESOURCE), or the server's token validation is off`
          : e.message)
        : `bridge internal error: ${e.message}`;
      log(`request ${hasId ? msg.id : `(notification ${msg?.method})`} failed: ${reason}`);
      if (hasId) emit(syntheticError(msg.id, reason));
      return;
    }
  }
}

// ---------------------------------------------------------------- main loop

function main() {
  guardStream(process.stdout); // before the first write: a broken pipe is news, not a crash
  guardStream(process.stderr);
  CFG = parseArgs(process.argv.slice(2));
  log(`${BUILD} -> ${CFG.serverUrl} (timeout ${CFG.timeoutMs}ms, auth in ${storePath()})`);
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
    await flushStdout(); // an answer half-written is an answer not given
    if (flowInBackground) {
      log(`${why}, but an authorization flow is pending — staying up until the human's click lands`);
      await flowInBackground.catch(() => {});
    }
    await flushStdout();
    process.exit(0);
  };
  rl.on("close", () => leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => leave("SIGTERM"));
  process.on("SIGINT", () => process.exit(0)); // at a terminal: leave at once
  process.on("uncaughtException", (e) => log(`uncaught: ${e.stack || e}`));
  process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e?.stack || e}`));
}

main();
