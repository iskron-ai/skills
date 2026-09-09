#!/usr/bin/env node

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.5.0";
function buildOf(selfUrl) {
  try {
    const src = readFileSync(fileURLToPath(selfUrl));
    return `v${VERSION}+${createHash("sha256").update(src).digest("hex").slice(0, 8)}`;
  } catch {
    return `v${VERSION}`;
  }
}
function versionIn(text) {
  const m = /^(?:const|let|var)\s+VERSION\s*=\s*"([^"]+)"/m.exec(text);
  return m ? m[1] : null;
}

// js/bridge/build.ts
var BUILD = buildOf(import.meta.url);

// js/bridge/main.ts
import { createInterface } from "node:readline";

// js/bridge/store.ts
import { createHash as createHash2 } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync as readFileSync3,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join as join2 } from "node:path";

// js/bridge/config.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// js/bridge/streams.ts
var FLUSH_STOP_MS = 5e3;
var deadStreams = /* @__PURE__ */ new WeakSet();
function canWrite(s) {
  return !!s && !deadStreams.has(s) && !s.destroyed && s.writable !== false;
}
function guardStream(s) {
  if (s) s.on("error", () => deadStreams.add(s));
}
var stdoutBacklog = false;
function writeTo(s, text) {
  if (!canWrite(s)) return false;
  try {
    const fit = s.write(text);
    if (s === process.stdout) {
      if (!fit && !stdoutBacklog) s.once("drain", () => stdoutBacklog = false);
      stdoutBacklog = !fit;
    }
    return true;
  } catch {
    deadStreams.add(s);
    return false;
  }
}
function log(msg) {
  writeTo(process.stderr, `[iskron-bridge ${(/* @__PURE__ */ new Date()).toISOString()}] ${msg}
`);
}
function debug(msg) {
  if (CFG?.debug) log(`debug: ${msg}`);
}
function emit(msg) {
  writeTo(process.stdout, JSON.stringify(msg) + "\n");
}
function flushStdout() {
  return new Promise((resolve) => {
    const out3 = process.stdout;
    if (!canWrite(out3)) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      out3.off("error", finish);
      out3.off("close", finish);
      resolve();
    };
    out3.once("error", finish);
    out3.once("close", finish);
    if (stdoutBacklog) out3.once("drain", finish);
    else out3.write("", finish);
    setTimeout(finish, FLUSH_STOP_MS).unref();
  });
}

// js/bridge/config.ts
var DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";
var CFG = null;
function setConfig(cfg) {
  CFG = cfg;
}
function parseArgs(argv2) {
  const cfg = {
    serverUrl: "",
    timeoutMs: Number(process.env.ISKRON_BRIDGE_TIMEOUT) || 12e4,
    authDir: process.env.ISKRON_BRIDGE_AUTH_DIR || join(homedir(), ".iskron-bridge"),
    clientName: "iskron-bridge",
    noBrowser: !!process.env.ISKRON_BRIDGE_NO_BROWSER,
    debug: !!process.env.ISKRON_BRIDGE_DEBUG,
    scope: process.env.ISKRON_BRIDGE_SCOPE || null,
    resource: process.env.ISKRON_BRIDGE_RESOURCE || null,
    staticClientId: process.env.ISKRON_BRIDGE_CLIENT_ID || null,
    pat: null,
    patSource: null
  };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--timeout") cfg.timeoutMs = Number(argv2[++i]);
    else if (a === "--auth-dir") cfg.authDir = argv2[++i];
    else if (a === "--client-name") cfg.clientName = argv2[++i];
    else if (a === "--no-browser") cfg.noBrowser = true;
    else if (a === "--debug") cfg.debug = true;
    else if (a === "--version") {
      process.stdout.write(BUILD + "\n");
      process.exit(0);
    } else if (!a.startsWith("--") && !cfg.serverUrl) cfg.serverUrl = a;
    else {
      log(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!cfg.serverUrl) cfg.serverUrl = process.env.ISKRON_BRIDGE_URL || DEFAULT_SERVER_URL;
  try {
    new URL(cfg.serverUrl);
  } catch {
    log(`not a URL: ${cfg.serverUrl}`);
    process.exit(2);
  }
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs < 1e3) cfg.timeoutMs = 12e4;
  readPat(cfg);
  return cfg;
}
function readPat(cfg) {
  const fromEnv = process.env.ISKRON_BRIDGE_TOKEN?.trim();
  if (fromEnv) {
    cfg.pat = fromEnv;
    cfg.patSource = "ISKRON_BRIDGE_TOKEN";
    return;
  }
  const file = join(cfg.authDir, "token");
  try {
    const text = readFileSync2(file, "utf8").trim();
    if (text) {
      cfg.pat = text;
      cfg.patSource = file;
    }
  } catch {
  }
}

// js/bridge/store.ts
var b64url = (buf) => Buffer.from(buf).toString("base64url");
var sha256 = (s) => createHash2("sha256").update(s).digest();
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function storePath() {
  const u = new URL(CFG.serverUrl);
  const h = b64url(sha256(u.origin + u.pathname)).slice(0, 10);
  return join2(CFG.authDir, `${u.hostname}_${h}.json`);
}
function loadStore() {
  try {
    return JSON.parse(readFileSync3(storePath(), "utf8"));
  } catch {
    return {};
  }
}
function saveStore(patch) {
  mkdirSync(CFG.authDir, { recursive: true, mode: 448 });
  const next = {
    ...loadStore(),
    ...patch,
    server_url: CFG.serverUrl,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const tmp = `${storePath()}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 384 });
    renameSync(tmp, storePath());
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    throw e;
  }
  return next;
}
function grantLogPath() {
  return join2(CFG.authDir, "grant.log");
}
function grantLog(msg) {
  try {
    mkdirSync(CFG.authDir, { recursive: true, mode: 448 });
    const p = grantLogPath();
    let size = 0;
    try {
      size = statSync(p).size;
    } catch {
    }
    if (size > 128e3) {
      try {
        unlinkSync(p);
      } catch {
      }
    }
    appendFileSync(p, `${(/* @__PURE__ */ new Date()).toISOString()} pid=${process.pid} ${BUILD} ${msg}
`, {
      mode: 384
    });
  } catch {
  }
}
function grantStatePath() {
  return storePath() + ".grant-state";
}
function loadGrantState() {
  try {
    return JSON.parse(readFileSync3(grantStatePath(), "utf8"));
  } catch {
    return {};
  }
}
function saveGrantState(patch) {
  try {
    mkdirSync(CFG.authDir, { recursive: true, mode: 448 });
    const next = { ...loadGrantState(), ...patch };
    const tmp = `${grantStatePath()}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(next), { mode: 384 });
    renameSync(tmp, grantStatePath());
  } catch {
  }
}
function clearGrantState() {
  try {
    unlinkSync(grantStatePath());
  } catch {
  }
}

// js/bridge/clock.ts
var SKEW_NOISE_MS = 5e3;
var SKEW_MATERIAL_MS = 3e4;
var clockSkewMs = null;
function skewMs() {
  if (clockSkewMs === null) {
    const s = Number(loadStore().clock_skew_ms);
    clockSkewMs = Number.isFinite(s) ? s : 0;
  }
  return clockSkewMs;
}
function now() {
  return Date.now() + skewMs();
}
function noteServerDate(res) {
  const d = Date.parse(res?.headers?.get("date") || "");
  if (!Number.isFinite(d)) return;
  const measured = d - Date.now();
  const skew = Math.abs(measured) < SKEW_NOISE_MS ? 0 : measured;
  const prev = skewMs();
  clockSkewMs = skew;
  if (Math.abs(skew - prev) >= SKEW_MATERIAL_MS) {
    try {
      saveStore({ clock_skew_ms: skew });
    } catch {
    }
    grantLog(
      skew === 0 ? "machine clock is back in step with the server" : `machine clock is ${Math.round(Math.abs(skew) / 1e3)}s ${skew > 0 ? "behind" : "ahead of"} the server — token hours are judged by the server's clock (fix NTP to stop paying a 401 per rotation)`
    );
  }
}

// js/bridge/errors.ts
var NOT_SENT = "not-sent";
var UNKNOWN = "unknown";
var UpstreamError = class extends Error {
  static NOT_SENT = NOT_SENT;
  static UNKNOWN = UNKNOWN;
  kind;
  // `presented` carries the access token the refused request actually used —
  // knowledge only the caller has. The store may have moved on since, and a
  // token a sibling has already replaced must not be blamed for this refusal.
  presented;
  // `outcome` says whether the request this error ends could ALREADY have taken
  // effect upstream. NOT_SENT — it never reached the server, so a retry is free.
  // UNKNOWN — it went out and the answer was lost, so a blind retry may write a
  // second time. Nothing between those two is honest, and saying neither is what
  // made "retry the call" dangerous: under one sentence lived both outcomes, and
  // the caller could not tell them apart. Witnessed: an update reported as failed
  // had applied, and the retry advised by that sentence collided with its own
  // first write.
  outcome;
  constructor(message, kind, presented = null, outcome = UNKNOWN) {
    super(message);
    this.kind = kind;
    this.presented = presented;
    this.outcome = outcome;
  }
};
var TokenError = class extends Error {
  oauthError;
  status;
  oauthMessage;
  constructor(message, oauthError, status, oauthMessage) {
    super(message);
    this.oauthError = oauthError;
    this.status = status;
    this.oauthMessage = oauthMessage;
  }
};
var DEFINITIVE_OAUTH_ERRORS = /* @__PURE__ */ new Set([
  "invalid_grant",
  "invalid_token",
  "invalid_client",
  "unauthorized_client"
]);
var LoginHeld = class extends Error {
};
var TokenRefused = class extends Error {
};
var AuthPending = class extends Error {
  authorizeUrl;
  constructor(url) {
    super(
      `authorization required — open in a browser: ${url} — or give the bridge a personal access token instead (ISKRON_BRIDGE_TOKEN, or the file <auth-dir>/token)`
    );
    this.authorizeUrl = url;
  }
};
var HoldOffError = class extends Error {
  // retryNow marks the one flavor where an immediate retry is the honest move:
  // the FIRST early refusal of a needed refresh. The cooldown refusal and a
  // refusal that repeats both name waits that are real.
  retryNow;
  constructor(message, retryNow = false) {
    super(message);
    this.retryNow = retryNow;
  }
};
var DeadGrantError = class extends Error {
  expired;
  constructor(message, expired = false) {
    super(message);
    this.expired = expired;
  }
};
function errorCode(e) {
  const err = e;
  return err?.cause?.code ?? err?.code;
}
function errorMessage(e) {
  return e instanceof Error ? e.message : String(e);
}

// js/bridge/oauth/discovery.ts
import { spawn } from "node:child_process";
import { join as join3 } from "node:path";
async function fetchJson(url, opts = {}, timeoutMs = 15e3) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
  noteServerDate(res);
  if (!res.ok) throw new Error(`${opts.method || "GET"} ${url} -> ${res.status}`);
  return res.json();
}
async function discover(wwwAuthenticate) {
  const meta = await discoverMeta(wwwAuthenticate);
  saveStore({ meta });
  return meta;
}
async function discoverMeta(wwwAuthenticate) {
  const u = new URL(CFG.serverUrl);
  const candidates = [];
  const m = /resource_metadata="?([^",\s]+)"?/.exec(wwwAuthenticate || "");
  if (m) candidates.push(m[1]);
  const path = u.pathname === "/" ? "" : u.pathname;
  candidates.push(`${u.origin}/.well-known/oauth-protected-resource${path}`);
  candidates.push(`${u.origin}/.well-known/oauth-protected-resource`);
  let prm = null;
  for (const c of candidates) {
    try {
      prm = await fetchJson(c);
      debug(`protected-resource metadata: ${c}`);
      break;
    } catch (e) {
      debug(`no PRM at ${c}: ${errorMessage(e)}`);
    }
  }
  const asBase = prm?.authorization_servers?.[0] || u.origin;
  const asUrl = new URL(asBase);
  const asPath = asUrl.pathname === "/" ? "" : asUrl.pathname;
  const asCandidates = [
    `${asUrl.origin}/.well-known/oauth-authorization-server${asPath}`,
    `${asUrl.origin}${asPath}/.well-known/oauth-authorization-server`,
    `${asUrl.origin}/.well-known/openid-configuration${asPath}`,
    `${asUrl.origin}${asPath}/.well-known/openid-configuration`
  ];
  let as = null;
  for (const c of asCandidates) {
    try {
      as = await fetchJson(c);
      debug(`AS metadata: ${c}`);
      break;
    } catch (e) {
      debug(`no AS metadata at ${c}: ${errorMessage(e)}`);
    }
  }
  if (!as?.authorization_endpoint || !as?.token_endpoint) {
    throw new Error(
      `OAuth discovery failed for ${CFG.serverUrl}: no authorization server metadata reachable`
    );
  }
  const scope = CFG.scope || (prm?.scopes_supported?.length ? prm.scopes_supported.join(" ") : null);
  return { as, resource: CFG.resource || prm?.resource || CFG.serverUrl, scope };
}
var CALLBACK_PORT_RUNGS = 3;
function callbackPort(rung = 0) {
  const d = sha256(new URL(CFG.serverUrl).origin);
  return 42e3 + (d[0] * 256 + d[1] + rung * 613) % 2e3;
}
var REGISTRATION_REUSE_MS = 45 * 6e4;
function registrationReusable(client, redirectUri) {
  if (!client?.client_id || client.redirect_uri !== redirectUri) return false;
  return !!client.registered_at && now() - client.registered_at < REGISTRATION_REUSE_MS;
}
async function ensureClient(meta, redirectUri) {
  if (CFG.staticClientId) return { client_id: CFG.staticClientId };
  const stored = loadStore().client;
  if (registrationReusable(stored, redirectUri)) return stored;
  if (stored?.client_id && stored.redirect_uri === redirectUri) {
    log(
      stored.registered_at ? "the dynamic client registration is older than the server's cleanup horizon — registering anew for this login" : "the dynamic client registration carries no timestamp (an earlier build wrote it) — registering anew for this login"
    );
  }
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
      token_endpoint_auth_method: "none"
    })
  });
  const client = {
    client_id: reg.client_id,
    redirect_uri: redirectUri,
    registered_at: now()
  };
  saveStore({ client });
  log(`registered OAuth client ${reg.client_id}`);
  return client;
}
function openBrowser(url) {
  log(`authorize in the browser:
  ${url}`);
  if (CFG.noBrowser) return;
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? windowsOpener(url) : ["xdg-open", [url]];
  const manually = (e) => log(`could not open a browser (${errorMessage(e)}) — open the URL above manually`);
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", manually);
    child.unref();
  } catch (e) {
    manually(e);
  }
}
function windowsOpener(url) {
  const powershell = join3(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  );
  const command = `Start-Process -FilePath '${url.replace(/'/g, "''")}'`;
  return [
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-EncodedCommand",
      Buffer.from(command, "utf16le").toString("base64")
    ]
  ];
}

// js/bridge/oauth/flow.ts
import { randomBytes } from "node:crypto";

// js/bridge/oauth/authlock.ts
import { mkdirSync as mkdirSync2, readFileSync as readFileSync4, unlinkSync as unlinkSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { connect } from "node:net";
var AUTH_LOCK_FRESH_MS = 33e4;
function authLockPath() {
  return storePath() + ".auth-pending";
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}
function portListening(port, timeoutMs = 700) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port)) return resolve(false);
    const sock = connect({ host: "127.0.0.1", port });
    const done = (v) => {
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}
function readAuthLock() {
  try {
    const l = JSON.parse(readFileSync4(authLockPath(), "utf8"));
    if (!(Date.now() - l.started_at < AUTH_LOCK_FRESH_MS)) return null;
    if (!pidAlive(l.pid)) return null;
    return l;
  } catch {
  }
  return null;
}
function writeAuthLock(url, port) {
  mkdirSync2(CFG.authDir, { recursive: true, mode: 448 });
  writeFileSync2(
    authLockPath(),
    JSON.stringify({
      pid: process.pid,
      started_at: Date.now(),
      authorize_url: url,
      callback_port: port
    }),
    { mode: 384 }
  );
}
function releaseAuthLock() {
  try {
    unlinkSync2(authLockPath());
  } catch {
  }
}
function installAuthLockExitHook() {
  process.on("exit", () => {
    try {
      const l = JSON.parse(readFileSync4(authLockPath(), "utf8"));
      if (l.pid === process.pid) unlinkSync2(authLockPath());
    } catch {
    }
  });
}

// js/bridge/oauth/callback.ts
import { createServer } from "node:http";
var PAGE_HOLD_MS = 2e4;
function bindCallback(port) {
  return new Promise((resolve, reject) => {
    let handOff = null;
    let received = null;
    let browser = null;
    const deliver2 = (v) => {
      if (handOff) handOff(v);
      else received = v;
    };
    const esc = (s) => String(s).replace(
      /[<>&"]/g,
      (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]
    );
    const tellBrowser = (line) => {
      if (!browser) return;
      const res = browser;
      browser = null;
      try {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<h3>${line}</h3>`);
      } catch {
      }
    };
    const server2 = createServer((req, res) => {
      const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
      if (u.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const err = u.searchParams.get("error");
      if (browser) {
        tellBrowser("iskron-bridge: another tab is finishing this login — you can close this one.");
      }
      browser = res;
      if (err) tellBrowser(`iskron-bridge: authorization failed (${esc(err)})`);
      else {
        setTimeout(
          () => tellBrowser(
            "iskron-bridge: the code arrived and the exchange is still running — watch the agent."
          ),
          PAGE_HOLD_MS
        ).unref();
      }
      deliver2({ code: u.searchParams.get("code"), state: u.searchParams.get("state"), err });
    });
    server2.once("error", reject);
    server2.listen(port, "127.0.0.1", () => {
      server2.removeListener("error", reject);
      server2.on("error", (e) => log(`callback server: ${e.message}`));
      resolve({
        port,
        report: (failure) => tellBrowser(
          failure ? `iskron-bridge: authorization failed (${esc(failure)}) — nothing was stored; the agent has the details.` : "iskron-bridge: authenticated — you can close this tab."
        ),
        close: () => {
          tellBrowser("iskron-bridge: the login was abandoned — nothing was stored.");
          server2.close();
        },
        waitForCode: (expectedState, timeoutMs = 3e5) => new Promise((res, rej) => {
          const timer = setTimeout(
            () => rej(new Error("timed out waiting for the browser authorization")),
            timeoutMs
          );
          const settle = (v) => {
            clearTimeout(timer);
            if (v.err) return rej(new Error(`authorization refused: ${v.err}`));
            if (!v.code || v.state !== expectedState) {
              return rej(new Error("callback missing code or state mismatch"));
            }
            res(v.code);
          };
          if (received) settle(received);
          else handOff = settle;
        })
      });
    });
  });
}

// js/bridge/oauth/pacing.ts
var LOGIN_GRACE_MS = 12e4;
var LOGIN_SNOOZE_MS = 10 * 6e4;

// js/bridge/tokens.ts
function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString());
  } catch {
    return null;
  }
}
var CLOCK_SKEW_MS = 6e4;
function tokenSchedule(body, refresh) {
  const a = jwtClaims(body.access_token);
  const r = jwtClaims(refresh);
  const accessExp = Number.isFinite(a?.exp) ? a.exp * 1e3 : body.expires_in ? now() + body.expires_in * 1e3 : null;
  const skew = accessExp ? Math.min(CLOCK_SKEW_MS, Math.max(0, (accessExp - now()) / 2)) : 0;
  return {
    expires_at: accessExp ? accessExp - skew : null,
    refresh_not_before: Number.isFinite(r?.nbf) ? r.nbf * 1e3 : null,
    refresh_expires_at: Number.isFinite(r?.exp) ? r.exp * 1e3 : null
  };
}
function refreshHours(t) {
  const c = jwtClaims(t?.refresh_token);
  return {
    nbf: Number.isFinite(t?.refresh_not_before) ? t.refresh_not_before : Number.isFinite(c?.nbf) ? c.nbf * 1e3 : null,
    exp: Number.isFinite(t?.refresh_expires_at) ? t.refresh_expires_at : Number.isFinite(c?.exp) ? c.exp * 1e3 : null
  };
}
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

// js/bridge/oauth/tokenrequest.ts
async function tokenRequestOnce(meta, params) {
  const res = await fetch(meta.as.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(3e4)
  });
  noteServerDate(res);
  const body = await res.json().catch(() => null) ?? {};
  if (!res.ok) {
    throw new TokenError(
      `token endpoint ${res.status}: ${body.error || ""} ${body.error_description || body.message || ""}`.trim(),
      body.error,
      res.status,
      body.message
    );
  }
  const refresh = body.refresh_token ?? loadStore().tokens?.refresh_token;
  const tokens = {
    access_token: body.access_token,
    refresh_token: refresh,
    ...tokenSchedule(body, refresh)
  };
  saveStore({ tokens });
  clearGrantState();
  grantLog(
    `tokens stored (${params.grant_type}); access good for ${tokens.expires_at ? Math.round((tokens.expires_at - now()) / 1e3) + "s" : "an unstated time"}${tokens.refresh_not_before ? `, refresh usable in ${Math.round((tokens.refresh_not_before - now()) / 1e3)}s` : ""}`
  );
  return tokens;
}
var tokenRequestsInFlight = /* @__PURE__ */ new Set();
async function tokenRequest(meta, params) {
  const p = tokenRequestOnce(meta, params);
  tokenRequestsInFlight.add(p);
  try {
    return await p;
  } finally {
    tokenRequestsInFlight.delete(p);
  }
}

// js/bridge/oauth/flow.ts
var flowInBackground = null;
function pendingFlow() {
  return flowInBackground;
}
async function interactiveFlow(meta) {
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
      if (errorCode(e) !== "EADDRINUSE") throw e;
      const l = readAuthLock();
      if (l?.authorize_url && await portListening(l.callback_port)) {
        throw new AuthPending(l.authorize_url);
      }
      debug(
        `callback port ${callbackPort(rung)} is held by a foreign process — trying the next rung`
      );
    }
  }
  if (!callback) {
    const rungs = Array.from({ length: CALLBACK_PORT_RUNGS }, (_, k) => callbackPort(k)).join(", ");
    throw new Error(
      `all candidate callback ports (${rungs}) are held by other processes — free one, then retry`
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
    writeAuthLock(url, port);
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
          resource: meta.resource
        });
        log("authorization complete — tokens saved for every local agent");
        grantLog("authorization complete");
        cb.report(null);
      } catch (e) {
        const message = errorMessage(e);
        cb.report(message);
        log(`authorization flow failed: ${message}`);
        saveGrantState({ snooze_until: Date.now() + LOGIN_SNOOZE_MS });
        grantLog(
          `authorization not completed (${message}); not asking again for ${LOGIN_SNOOZE_MS / 6e4}min`
        );
      } finally {
        cb.close();
        releaseAuthLock();
        flowInBackground = null;
      }
    })();
    throw new AuthPending(url);
  } catch (e) {
    if (!flowInBackground) {
      callback.close();
      releaseAuthLock();
    }
    throw e;
  }
}

// js/bridge/oauth/refreshlock.ts
import { linkSync, mkdirSync as mkdirSync3, readFileSync as readFileSync5, unlinkSync as unlinkSync3, writeFileSync as writeFileSync3 } from "node:fs";
var REFRESH_LOCK_STALE_MS = 45e3;
function refreshLockPath() {
  return storePath() + ".refreshing";
}
function acquireRefreshLock() {
  const claim = () => {
    const tmp = `${refreshLockPath()}.${process.pid}`;
    writeFileSync3(tmp, JSON.stringify({ pid: process.pid, started_at: Date.now() }), {
      mode: 384
    });
    try {
      linkSync(tmp, refreshLockPath());
      return true;
    } finally {
      try {
        unlinkSync3(tmp);
      } catch {
      }
    }
  };
  const notHeld = (e) => {
    if (errorCode(e) !== "EEXIST") {
      throw new Error(`cannot take the refresh lock: ${errorMessage(e)}`, { cause: e });
    }
  };
  try {
    mkdirSync3(CFG.authDir, { recursive: true, mode: 448 });
    return claim();
  } catch (e) {
    notHeld(e);
  }
  let held = null;
  try {
    held = JSON.parse(readFileSync5(refreshLockPath(), "utf8"));
  } catch {
  }
  if (held && pidAlive(held.pid) && Date.now() - held.started_at < REFRESH_LOCK_STALE_MS) {
    return false;
  }
  debug("breaking a refresh lock nobody is holding");
  try {
    unlinkSync3(refreshLockPath());
  } catch {
  }
  try {
    return claim();
  } catch (e) {
    notHeld(e);
    return false;
  }
}
function releaseRefreshLock() {
  try {
    const l = JSON.parse(readFileSync5(refreshLockPath(), "utf8"));
    if (l.pid === process.pid) unlinkSync3(refreshLockPath());
  } catch {
  }
}
function installRefreshLockExitHook() {
  process.on("exit", releaseRefreshLock);
}

// js/bridge/oauth/refresh.ts
var REFRESH_WAIT_MS = 6e4;
var REFRESH_POLL_MS = 120;
var EARLY_REFUSAL_COOLDOWN_MS = 15e3;
var REFUSED_KNOCK_MS = 5 * 6e4;
async function refreshOnce(meta, cur, proactive) {
  const hours = refreshHours(cur);
  const inTheWindow = hours.nbf && now() < hours.nbf;
  const cooling = inTheWindow && loadGrantState().early_refused_until;
  if (cooling && now() < cooling) {
    const left = Math.round((cooling - now()) / 1e3);
    throw new HoldOffError(
      `the token endpoint refused this grant as too early moments ago — not knocking again for ${left}s; grant kept, will retry`
    );
  }
  debug("refreshing access token");
  try {
    return await tokenRequest(meta, {
      grant_type: "refresh_token",
      refresh_token: cur.refresh_token ?? "",
      client_id: CFG.staticClientId || loadStore().client?.client_id || "",
      resource: meta.resource
    });
  } catch (e) {
    const message = errorMessage(e);
    const deadRefresh = e instanceof TokenError && e.status === 404 && e.oauthError === "NotFound" && e.oauthMessage === "Refresh Token does not exist";
    const gone = e instanceof TokenError ? !deadRefresh && [404, 405, 410].includes(e.status) : ["ENOTFOUND", "ECONNREFUSED"].includes(errorCode(e) ?? "");
    if (gone && e instanceof TokenError && e.status === 404 && !await tokenEndpointMoved(meta)) {
      log(
        "the token endpoint answers NotFound while discovery still names it — the server no longer knows this client; dropping the registration"
      );
      grantLog(
        `refresh refused by an endpoint discovery still names (${message}) — registration dropped`
      );
      saveStore({ client: null });
      throw new DeadGrantError(message);
    }
    if (gone) {
      saveStore({ meta: null });
      grantLog(
        `token endpoint is gone (${message}) — cached discovery dropped, rediscovering on the next attempt`
      );
      throw new Error(
        `the token endpoint is gone (${message}) — rediscovering on the next attempt; grant kept, will retry`,
        { cause: e }
      );
    }
    const definitive = e instanceof TokenError && e.oauthError !== "temporarily_unavailable" && (deadRefresh || DEFINITIVE_OAUTH_ERRORS.has(e.oauthError ?? "") || e.status === 400 || e.status === 401);
    if (!definitive) {
      throw new Error(`token refresh failed transiently (${message}) — grant kept, will retry`, {
        cause: e
      });
    }
    const expired = hours.exp && now() >= hours.exp;
    const notYet = hours.nbf && now() < hours.nbf;
    const speculative = proactive && tokenUsable(cur);
    if (!expired && !deadRefresh && (notYet || speculative)) {
      const stamp = loadGrantState().early_refused_until;
      const repeated = !!notYet && !!stamp && stamp > now() - 12e4;
      const why = notYet ? `the refresh token's own hour is another ${Math.round((hours.nbf - now()) / 1e3)}s away on the server's clock` : "the access token in hand still works";
      let until = null;
      if (notYet) {
        until = Math.min(now() + EARLY_REFUSAL_COOLDOWN_MS, hours.nbf);
        saveGrantState({ early_refused_until: until });
      }
      grantLog(
        `refresh refused early — ${why}; grant kept` + (until ? `, not knocking again for ${Math.round((until - now()) / 1e3)}s` : "") + ` (${message})`
      );
      throw new HoldOffError(
        repeated ? `token refresh refused too early again (${message}) — the hour is real: ${why}; grant kept` : `token refresh refused too early (${message}) — ${why}; grant kept, will retry`,
        !!notYet && !repeated
      );
    }
    if (loadStore().tokens?.refresh_token !== cur.refresh_token) {
      debug("our refresh token was already rotated by a sibling — retrying with the stored one");
      return null;
    }
    if (e instanceof TokenError && e.oauthError === "invalid_client") {
      log("the server no longer knows this client — dropping the registration");
      grantLog("server no longer knows this client — registration dropped");
      saveStore({ client: null });
    }
    const overdue = hours.exp && now() >= hours.exp;
    grantLog(
      `refresh refused${overdue ? " and the grant is past its own expiry" : ""}: ${message}`
    );
    throw new DeadGrantError(overdue ? `${message} (grant expired)` : message, !!overdue);
  }
}
var ENDPOINT_CHECK_BUDGET_MS = 1e4;
async function tokenEndpointMoved(meta) {
  try {
    const fresh = await Promise.race([
      discoverMeta(null),
      sleep(ENDPOINT_CHECK_BUDGET_MS).then(() => {
        throw new Error("discovery did not answer within the budget");
      })
    ]);
    return fresh.as.token_endpoint !== meta.as.token_endpoint;
  } catch {
    return true;
  }
}
async function refreshShared(meta, rejected, proactive, interactive) {
  const deadline = Date.now() + REFRESH_WAIT_MS;
  for (; ; ) {
    const sibling = usableTokens({ rejected });
    if (sibling) {
      debug("a sibling refreshed the grant — reusing it");
      return sibling;
    }
    if (Date.now() > deadline) {
      throw new Error("the shared grant could not be refreshed in time — grant kept, will retry");
    }
    if (acquireRefreshLock()) {
      try {
        const late = usableTokens({ rejected });
        if (late) {
          debug("a sibling refreshed the grant — reusing it");
          return late;
        }
        if (!interactive && refusalStands()) {
          throw new DeadGrantError(
            "the grant stands refused on this machine — the background knock waits for the next stretch or a human's call"
          );
        }
        try {
          const cur = loadStore().tokens;
          if (!cur?.refresh_token) throw new DeadGrantError("no refresh grant on disk");
          const fresh = await refreshOnce(meta, cur, proactive);
          if (fresh) return fresh;
        } catch (e) {
          if (e instanceof DeadGrantError) noteRefusal(e.message);
          throw e;
        }
      } finally {
        releaseRefreshLock();
      }
    } else {
      await sleep(REFRESH_POLL_MS);
    }
  }
}
function noteRefusal(reason) {
  const local = Date.now();
  const first2 = !loadGrantState().refused_since;
  saveGrantState({ refused_at: local, ...first2 ? { refused_since: local, reason } : {} });
  if (first2) {
    grantLog(`grant refused, holding the login back for ${LOGIN_GRACE_MS / 1e3}s: ${reason}`);
  }
}
function refusalStands() {
  const at = loadGrantState().refused_at;
  return !!at && Date.now() - at < REFUSED_KNOCK_MS;
}
function holdOffLogin(reason, expired = false) {
  const local = Date.now();
  const st = loadGrantState();
  if (st.snooze_until && local < st.snooze_until) {
    throw new LoginHeld(
      `authorization was offered and not completed — not asking again for ${Math.round((st.snooze_until - local) / 1e3)}s (grant refused: ${reason})`
    );
  }
  if (expired) return;
  const since = st.refused_since || local;
  if (local - since < LOGIN_GRACE_MS) {
    throw new LoginHeld(
      `grant refused (${reason}) — holding off the login for ${Math.round((LOGIN_GRACE_MS - (local - since)) / 1e3)}s in case it heals`
    );
  }
}

// js/bridge/auth.ts
var authInFlight = null;
async function ensureAuth(wwwAuthenticate, opts = {}) {
  const { force = false, interactive = true, proactive = false } = opts;
  if (CFG.pat) {
    throw new TokenRefused(
      `the personal access token from ${CFG.patSource} is refused by the server — revoked, expired or without rights to this graph; mint a new one on the graph's token page and put it in ${CFG.patSource}`
    );
  }
  if (authInFlight) {
    if (!interactive || authInFlight.interactive) return authInFlight.promise;
    await authInFlight.promise.catch(() => {
    });
    if (authInFlight) return authInFlight.promise;
    const s = loadStore();
    if (tokenUsable(s.tokens)) return s.tokens;
  }
  const promise = (async () => {
    try {
      const s = loadStore();
      const rejected = opts.rejected ?? (force ? s.tokens?.access_token ?? null : null);
      if (!force && tokenUsable(s.tokens)) return s.tokens;
      const meta = s.meta?.as ? s.meta : await discover(wwwAuthenticate);
      if (CFG.resource) meta.resource = CFG.resource;
      if (s.tokens?.refresh_token) {
        try {
          return await refreshShared(meta, rejected, proactive, interactive);
        } catch (e) {
          if (!(e instanceof DeadGrantError)) throw e;
          if (!interactive) {
            throw new Error("authorization required (refresh grant dead, browser flow deferred)", {
              cause: e
            });
          }
          holdOffLogin(e.message, e.expired);
          log(`refresh grant is dead (${e.message}) — starting a fresh authorization`);
          return await interactiveFlow(meta);
        }
      }
      if (!interactive)
        throw new Error(
          "authorization required (no tokens, browser flow deferred) — or give the bridge a personal access token (ISKRON_BRIDGE_TOKEN, or the file <auth-dir>/token)"
        );
      return await interactiveFlow(meta);
    } finally {
      authInFlight = null;
    }
  })();
  authInFlight = { promise, interactive };
  return promise;
}
var REFRESH_MARGIN_MS = 3 * 6e4;
function startTokenKeepalive() {
  if (CFG.pat) return;
  const tick = () => {
    const t = loadStore().tokens;
    if (!t?.refresh_token) return;
    const expiresAt = t.expires_at || 0;
    if (!expiresAt || expiresAt - now() >= REFRESH_MARGIN_MS) return;
    const hours = refreshHours(t);
    if (hours.nbf && now() < hours.nbf) {
      debug(
        `refresh token not in force for another ${Math.round((hours.nbf - now()) / 1e3)}s — waiting`
      );
      return;
    }
    if (hours.exp && now() >= hours.exp) {
      debug("the grant is past its own expiry — only a human can mend it now");
      return;
    }
    if (refusalStands()) {
      debug("the grant stands refused — the machine's control knock is not due yet");
      return;
    }
    ensureAuth(null, { force: true, interactive: false, proactive: true }).then(() => debug("background token refresh ok")).catch((e) => log(`background token refresh: ${errorMessage(e)}`));
  };
  tick();
  setInterval(tick, 6e4).unref();
}

// js/bridge/hold.ts
import {
  chmodSync,
  existsSync,
  mkdirSync as mkdirSync4,
  readdirSync,
  readFileSync as readFileSync6,
  unlinkSync as unlinkSync4,
  writeFileSync as writeFileSync4
} from "node:fs";
import { connect as connectLocal, createServer as createServer2 } from "node:net";
import { join as join5 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// js/shared/channel.ts
var DEAD_TOKEN_CODES = [4e3, 4001, 4002];
var ROLLOUT_CODE = 4003;
var FAST_DROP_MS = 5e3;
var ERROR_GUESS_DELAY_MS = 500;
function httpOrigin(socketUrl) {
  return new URL(socketUrl).origin.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}
function versionUrl(socketUrl) {
  return httpOrigin(socketUrl) + "/api/version";
}
function statusUrl(socketUrl) {
  return socketUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace("/channel/ws/", "/channel/status/");
}
async function serviceUp(socketUrl) {
  return fetch(versionUrl(socketUrl), { signal: AbortSignal.timeout(5e3) }).then((r) => r.ok ? r.json() : null).catch(() => null);
}
function deadTokenAdvice(code) {
  return `закрытие ${code} — токен мёртв, зови ${code === 4001 ? "mint" : "connect"}`;
}
function classifyOrigin(frame2, myKarta) {
  const p = frame2.provenance ?? {};
  if (p.via === "platform" || p.auth === "none") return "platform";
  if (p.as_person === true) return "human";
  if (p.from_karta_seq != null && p.user_karta_seq != null && p.from_karta_seq === p.user_karta_seq)
    return "human";
  if (myKarta != null && p.from_karta_seq != null && String(p.from_karta_seq) === String(myKarta))
    return "sibling";
  return "peer";
}
function holdSocket(o) {
  let fastDrops = 0;
  let dead = false;
  let stopped = false;
  let retry = null;
  let ws = null;
  function open() {
    if (stopped) return;
    const startedAt = Date.now();
    const sock = new WebSocket(o.url);
    ws = sock;
    let gone = false;
    sock.addEventListener("message", (e) => {
      if (stopped || ws !== sock) return;
      const raw = typeof e.data === "string" ? e.data : "[двоичный кадр]";
      let frame2 = null;
      if (typeof e.data === "string") {
        try {
          frame2 = JSON.parse(raw);
        } catch {
        }
      }
      o.onFrame(raw, frame2 && typeof frame2 === "object" ? frame2 : null);
    });
    sock.addEventListener(
      "error",
      () => setTimeout(() => void dropped(1006), ERROR_GUESS_DELAY_MS)
    );
    sock.addEventListener("close", (e) => void dropped(e.code));
    async function dropped(code) {
      if (stopped || ws !== sock) return;
      if (DEAD_TOKEN_CODES.includes(code)) {
        if (dead) return;
        dead = true;
        stopped = true;
        if (retry) clearTimeout(retry);
        o.onDeadToken(code);
        return;
      }
      if (gone) return;
      gone = true;
      fastDrops = Date.now() - startedAt < FAST_DROP_MS ? fastDrops + 1 : 0;
      if (fastDrops >= 3) {
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) {
          stopped = true;
          o.onServiceAlive(String(up.version ?? ""));
          return;
        }
        o.onNote?.("служба не отвечает — идёт раскатка, держу тот же токен");
        fastDrops = 1;
      }
      retry = setTimeout(open, code === ROLLOUT_CODE ? 3e3 : 2e3);
    }
  }
  open();
  return {
    close(reason = "held no more") {
      stopped = true;
      if (retry) clearTimeout(retry);
      retry = null;
      const sock = ws;
      ws = null;
      try {
        sock?.close(1e3, reason);
      } catch {
      }
    },
    get alive() {
      return !stopped && !!ws && (ws.readyState === 0 || ws.readyState === 1);
    }
  };
}

// js/shared/standings.ts
import { createHash as createHash3 } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import { join as join4 } from "node:path";
var defaultAuthDir = () => join4(homedir2(), ".iskron-bridge");
var authDirFromEnv = () => process.env.ISKRON_BRIDGE_AUTH_DIR?.trim() || defaultAuthDir();
var standingsDirOf = (authDir) => join4(authDir, "standings");
var hashOf = (key) => createHash3("sha256").update(key).digest("hex").slice(0, 16);
function socketPathOf(authDir, key) {
  if (process.platform === "win32") return `\\\\.\\pipe\\iskron-${hashOf(key)}`;
  return join4(standingsDirOf(authDir), `${hashOf(key)}.sock`);
}
var keyFilePathOf = (authDir, key) => join4(standingsDirOf(authDir), `${hashOf(key)}.key`);

// js/bridge/transport.ts
var state = {
  sessionId: null,
  protocolVersion: null,
  initParams: null,
  // params of the harness's initialize, for transparent replay
  reinitCounter: 0,
  // The standing this session registered, and the session it was confirmed in.
  // Why the bridge owns re-registration, what was observed to go wrong, and the
  // falsifier that closes it: graph @nks/nks-dev, nodes #3919 (the breakdown),
  // #3454 (the falsifier), #3800 (the header form the surface binds with).
  // The server correlates a writer BY THE MCP SESSION ID (its holder's word):
  // a new session is a different writer, and the surface's own self-repair has
  // nothing to repeat there, because its memory is keyed by that same id and is
  // collected with it. Sessions die silently in three ways — idle past the
  // threshold, eviction by the session ceiling, transport close — and the
  // bridge is the ONLY party that sees the change and still remembers the name
  // the agent derived for itself. So re-registering is the bridge's duty, and
  // it hangs on the change of id, never on a timer.
  standing: null,
  // {realm, karta, name} of the last register that succeeded
  standingSession: null,
  // the session id that registration is known to hold in
  // The access token the session was opened with. A session is opened BY a
  // credential and dies with it (the surface's own word): once the token in the
  // store is no longer the one this session was opened with — expired, refreshed
  // after a 401, rotated by a sibling bridge — the old id is a dead letter, and a
  // server that opens a fresh session on it silently runs the call unattributed
  // before we learn the new id. So a changed token means: re-open first.
  sessionToken: null
};
function standingHeader() {
  const s = state.standing;
  if (!s?.realm || s.karta == null || !s.name) return null;
  const h = `${s.realm} ${s.karta} ${s.name}`;
  if (!/^[\x21-\x7e]+ [\x21-\x7e]+ [\x21-\x7e]+$/.test(h)) return null;
  return h;
}
var currentAccessToken = () => CFG.pat ?? loadStore().tokens?.access_token ?? null;
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
      const data = raw.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n");
      if (data) yield data;
    }
  }
}
async function post(msg, onMessage) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream"
  };
  const token = CFG.pat ?? loadStore().tokens?.access_token ?? null;
  if (token) headers.authorization = `Bearer ${token}`;
  const sentSession = state.sessionId;
  if (sentSession) headers["mcp-session-id"] = sentSession;
  if (state.protocolVersion) headers["mcp-protocol-version"] = state.protocolVersion;
  const isInit = msg?.method === "initialize";
  const boundByHeader = isInit ? standingHeader() : null;
  if (boundByHeader) headers["x-nks-standing"] = boundByHeader;
  let res;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(CFG.timeoutMs)
    });
  } catch (e) {
    const err = e;
    const reason = err.name === "TimeoutError" ? `no answer within ${CFG.timeoutMs}ms` : errorMessage(e);
    const code = errorCode(e);
    const neverLeft = err.name !== "TimeoutError" && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ERR_SOCKET_BAD_PORT"].includes(code ?? "");
    throw new UpstreamError(
      `upstream unreachable: ${reason}`,
      "network",
      null,
      neverLeft ? UpstreamError.NOT_SENT : UpstreamError.UNKNOWN
    );
  }
  noteServerDate(res);
  if (res.status === 401) {
    res.body?.cancel?.();
    throw new UpstreamError(
      res.headers.get("www-authenticate") || "unauthorized",
      "auth",
      token,
      UpstreamError.NOT_SENT
    );
  }
  if (res.status === 404 && sentSession) {
    res.body?.cancel?.();
    throw new UpstreamError("session expired upstream", "session", null, UpstreamError.NOT_SENT);
  }
  const sid = res.headers.get("mcp-session-id");
  if (sid) {
    if (sid !== state.sessionId && !isInit) {
      log(
        `upstream replaced the session mid-call (${state.sessionId} -> ${sid}) — this call may have gone unattributed`
      );
    }
    state.sessionId = sid;
    state.sessionToken = token;
  }
  if (res.status === 202 || res.status === 204) return;
  if (!res.ok) {
    const text2 = (await res.text().catch(() => "")).slice(0, 300);
    throw new UpstreamError(
      `upstream HTTP ${res.status}: ${text2}`,
      "http",
      null,
      res.status < 500 ? UpstreamError.NOT_SENT : UpstreamError.UNKNOWN
    );
  }
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("text/event-stream")) {
    try {
      if (!res.body) return;
      for await (const data of sseEvents(res.body)) {
        try {
          onMessage(JSON.parse(data));
        } catch {
          debug(`unparseable SSE data: ${data.slice(0, 120)}`);
        }
      }
    } catch (e) {
      throw new UpstreamError(`upstream stream broke mid-response: ${errorMessage(e)}`, "network");
    }
    return;
  }
  const text = await res.text();
  if (!text.trim()) return;
  try {
    onMessage(JSON.parse(text));
  } catch {
    throw new UpstreamError(`upstream sent unparseable JSON: ${text.slice(0, 200)}`, "http");
  }
}
var reinitInFlight = null;
async function reinitialize() {
  if (reinitInFlight) return reinitInFlight;
  reinitInFlight = (async () => {
    try {
      if (!state.initParams) throw new UpstreamError("session lost before initialize", "session");
      log("upstream session lost — re-initializing transparently");
      state.sessionId = null;
      state.sessionToken = null;
      const id = `iskron-bridge-reinit-${++state.reinitCounter}`;
      let result = null;
      await post({ jsonrpc: "2.0", id, method: "initialize", params: state.initParams }, (m) => {
        if (m.id === id) result = m;
      });
      const got = result;
      if (!got || got.error) {
        throw new UpstreamError(
          `re-initialize refused: ${JSON.stringify(got?.error ?? null)}`,
          "session"
        );
      }
      if (got.result?.protocolVersion) state.protocolVersion = got.result.protocolVersion;
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, () => {
      });
      log(`session re-established (${state.sessionId || "no session id"})`);
    } finally {
      reinitInFlight = null;
    }
  })();
  return reinitInFlight;
}

// js/bridge/standing.ts
function noteStanding(msg, reply) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "register") return;
  if (reply?.error || reply?.result?.isError) return;
  state.standing = { realm: a.realm, karta: a.karta, name: a.name };
  state.standingSession = state.sessionId;
  debug(`standing remembered: ${a.name ?? "(unnamed)"} at karta ${a.karta} in ${a.realm}`);
}
var standingInFlight = null;
function ensureStanding() {
  if (!state.standing || !state.sessionId) return Promise.resolve();
  if (state.standingSession === state.sessionId) return Promise.resolve();
  if (standingInFlight) return standingInFlight;
  standingInFlight = (async () => {
    try {
      const id = `iskron-bridge-restanding-${++state.reinitCounter}`;
      let reply = null;
      await post(
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "iskron_channel", arguments: { ...state.standing, action: "register" } }
        },
        (m) => {
          if (m.id === id) reply = m;
        }
      );
      const got = reply;
      if (got && !got.error && !got.result?.isError) {
        state.standingSession = state.sessionId;
        log(`standing re-registered on the new session (${state.standing?.name ?? "unnamed"})`);
      } else if (seatIsGone(got)) {
        log(`the standing's seat is gone, forgetting it: ${replyText(got).slice(0, 200)}`);
        state.standing = null;
      } else {
        log(
          `could not re-register the standing this time, will retry before the next call: ${replyText(got).slice(0, 200)}`
        );
      }
    } catch (e) {
      log(`re-registering the standing failed: ${errorMessage(e)}`);
    } finally {
      standingInFlight = null;
    }
  })();
  return standingInFlight;
}
var replyText = (reply) => {
  if (!reply) return "";
  if (reply.error) return JSON.stringify(reply.error);
  const content = reply.result?.content;
  return Array.isArray(content) ? content.map((c) => c?.text ?? "").join("\n") : JSON.stringify(reply.result ?? "");
};
var seatIsGone = (reply) => /no such standing|take it with connect|такого стояния|занять.*connect/i.test(replyText(reply));
var UNATTRIBUTED_CODE = /write_unattributed\w*|session_not_registered/;
var UNATTRIBUTED_REFUSAL = /\b409\b|не зарегистрирован[аоы]? ни за каким стоянием|hold no registered standing/i;
var isUnattributed = (reply) => {
  if (!reply) return false;
  const text = replyText(reply);
  if (UNATTRIBUTED_CODE.test(text)) return true;
  return !!reply.result?.isError && UNATTRIBUTED_REFUSAL.test(text);
};

// js/bridge/hold.ts
var RING = 20;
function standingsDir() {
  return standingsDirOf(CFG.authDir);
}
function keyFor() {
  const s = state.standing;
  const raw = s ? `${s.name ?? "_"}--${s.karta}--${s.realm}` : "env";
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}
var socketPathFor = (key) => socketPathOf(CFG.authDir, key);
var keyFilePathFor = (key) => keyFilePathOf(CFG.authDir, key);
var holder = null;
var server = null;
var currentKey = null;
var currentUrl = null;
var currentStatusUrl = null;
var clients = /* @__PURE__ */ new Set();
var ring = [];
var helloWaiters = /* @__PURE__ */ new Set();
function holdsStanding(realm, karta, name) {
  const s = state.standing;
  return !!holder?.alive && !!s && s.realm === realm && String(s.karta) === String(karta) && (s.name ?? "") === name && currentKey === keyFor();
}
function awaitHello(timeoutMs) {
  const seen = ring.find((r) => r.frame?.type === "hello")?.frame ?? null;
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve) => {
    const done = (f) => {
      helloWaiters.delete(done);
      resolve(f);
    };
    helloWaiters.add(done);
    setTimeout(() => done(null), timeoutMs).unref();
  });
}
function listenBlock() {
  if (!currentKey) return null;
  const key = currentKey;
  const self = fileURLToPath2(import.meta.url);
  const where = CFG.authDir === defaultAuthDir() ? "" : ` --auth-dir "${CFG.authDir}"`;
  return `[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно (строка выше о том, что никто не слушает, описывает миг до этого держания).
Слушать: node "${self}" watchdog ${key}${where} — под Monitor с persistent: true (Claude Code); фоновой задачей — node "${self}" watchdog-exit ${key}${where} (выходит нулём на первом сообщении); в Codex из своей оболочки фоном — node "${self}" watchdog-codex ${key}${where} (кадр входит в идущий тред через app-server).
Занятость: iskron_channel(action="status", realm, text) — пустой text снимает.
Кадры приходят и уведомлениями MCP (logger iskron-channel).`;
}
function broadcast(ev) {
  const line = JSON.stringify(ev) + "\n";
  for (const c of clients) {
    try {
      c.write(line);
    } catch {
      clients.delete(c);
    }
  }
}
function notify(level, data) {
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level, logger: "iskron-channel", data }
  });
}
function sweepStale(dir, mine) {
  if (process.platform === "win32" || !existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".key"))) {
    const keyFile = join5(dir, f);
    let key;
    try {
      key = readFileSync6(keyFile, "utf8").trim();
    } catch {
      continue;
    }
    if (!key || key === mine) continue;
    const sock = socketPathFor(key);
    const drop = () => {
      for (const p of [keyFile, sock]) {
        try {
          unlinkSync4(p);
        } catch {
        }
      }
    };
    if (!existsSync(sock)) {
      drop();
      continue;
    }
    const probe = connectLocal(sock);
    probe.once("connect", () => probe.destroy());
    probe.once("error", drop);
    probe.setTimeout(1e3, () => probe.destroy());
  }
}
function openLocalServer(key) {
  const path = socketPathFor(key);
  mkdirSync4(standingsDir(), { recursive: true, mode: 448 });
  sweepStale(standingsDir(), key);
  writeFileSync4(keyFilePathFor(key), key + "\n", { mode: 384 });
  if (process.platform !== "win32") {
    try {
      unlinkSync4(path);
    } catch {
    }
  }
  const srv = createServer2((sock) => {
    clients.add(sock);
    sock.on("close", () => clients.delete(sock));
    sock.on("error", () => clients.delete(sock));
    sock.write(
      JSON.stringify({ kind: "attached", key, buffered: ring.length }) + "\n"
    );
    for (const { raw, frame: frame2 } of ring) {
      sock.write(JSON.stringify({ kind: "frame", raw, frame: frame2 }) + "\n");
    }
  });
  srv.on("error", (e) => {
    const text = `ДЕЛАТЕЛЬ: локальный сокет стояния не поднялся (${e.message}) — сторожу не к чему цепляться`;
    log(text);
    notify("error", { kind: "note", text });
  });
  srv.listen(path, () => {
    if (process.platform !== "win32") {
      try {
        chmodSync(path, 384);
      } catch {
      }
    }
    log(`standing socket held; local listeners attach at ${path}`);
  });
  server = srv;
}
function releaseStanding(reason) {
  if (!holder && !server) return;
  broadcast({ kind: "released", text: reason });
  holder?.close(reason);
  holder = null;
  for (const c of clients) {
    try {
      c.end();
    } catch {
    }
  }
  clients.clear();
  const srv = server;
  server = null;
  if (srv) {
    try {
      srv.close();
    } catch {
    }
  }
  if (currentKey) {
    try {
      unlinkSync4(keyFilePathFor(currentKey));
    } catch {
    }
    if (process.platform !== "win32") {
      try {
        unlinkSync4(socketPathFor(currentKey));
      } catch {
      }
    }
  }
  ring.length = 0;
  currentKey = null;
  currentUrl = null;
  currentStatusUrl = null;
}
function holdStanding(url, statusUrl2) {
  const key = keyFor();
  if (url === currentUrl && key === currentKey && holder?.alive) return key;
  releaseStanding("новый сокет");
  currentKey = key;
  currentUrl = url;
  currentStatusUrl = statusUrl2 || statusUrl(url);
  openLocalServer(key);
  holder = holdSocket({
    url,
    onFrame: (raw, frame2) => {
      void completeFrame(stampOrigin(frame2)).then((full) => {
        const text = full === frame2 ? raw : JSON.stringify(full);
        ring.push({ raw: text, frame: full });
        if (ring.length > RING) ring.shift();
        if (full?.type === "hello") for (const w of [...helloWaiters]) w(full);
        const ev = { kind: "frame", raw: text, frame: full };
        broadcast(ev);
        if (full?.type !== "status") notify("info", ev);
      });
    },
    onDeadToken: (code) => {
      const text = `ДЕЛАТЕЛЬ: ${deadTokenAdvice(code)}`;
      log(text);
      const ev = { kind: "dead", code, text };
      broadcast(ev);
      notify("error", ev);
      releaseStanding("токен мёртв");
    },
    onServiceAlive: (version) => {
      const text = `ДЕЛАТЕЛЬ: обрывы, а служба отвечает (${version}) — спроси о токене`;
      log(text);
      const ev = { kind: "alive", version, text };
      broadcast(ev);
      notify("error", ev);
      releaseStanding("обрывы при живой службе");
    },
    onNote: (text) => {
      log(text);
      broadcast({ kind: "note", text });
    }
  });
  return key;
}
var SOCKET_RE = /wss:\/\/[^\s"'`<>)\]]+|ws:\/\/(?:127\.0\.0\.1|\[?::1\]?|localhost)(?::\d+)?\/[^\s"'`<>)\]]+/;
var STATUS_RE = /https?:\/\/[^\s"'`<>)\]]+\/channel\/status\/[^\s"'`<>)\]]+/;
var trim = (s) => s.replace(/[.,;:!?»"')\]]+$/, "");
function absorbChannelReply(msg, reply) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel") return reply;
  if (a?.action !== "connect" && a?.action !== "mint") return reply;
  if (reply?.error || reply?.result?.isError) return reply;
  const text = replyText(reply);
  const socket = SOCKET_RE.exec(text)?.[0];
  if (!socket) return reply;
  const status = STATUS_RE.exec(text)?.[0];
  if (a.realm && a.karta != null) {
    state.standing = { realm: a.realm, karta: a.karta, name: a.name };
  }
  holdStanding(trim(socket), status ? trim(status) : null);
  const block = listenBlock() ?? "";
  const content = reply.result?.content;
  if (Array.isArray(content)) {
    content.push({ type: "text", text: block.trim() });
  }
  return reply;
}
function absorbRevokeReply(msg, reply) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "revoke") return reply;
  if (reply?.error || reply?.result?.isError) return reply;
  const s = state.standing;
  if (!s) return reply;
  const asked = typeof a.standing === "string" ? a.standing.trim() : "";
  const own = asked === "" || asked === "mine" || asked === (s.name ?? "") || asked.endsWith(`:${s.name ?? ""}`);
  if (!own || String(a.karta ?? s.karta) !== String(s.karta)) return reply;
  releaseStanding("снято своим revoke");
  state.standing = null;
  state.standingSession = null;
  log(
    `standing revoked by this session — released quietly, binding forgotten (${s.name ?? "unnamed"})`
  );
  return reply;
}
function holdFromEnv() {
  const url = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (!url) return;
  holdStanding(url, process.env.ISKRON_CHANNEL_STATUS?.trim() || null);
}
function localStatus(msg) {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  const a = msg.params?.arguments;
  if (a?.action !== "status") return null;
  const text = typeof a.text === "string" ? a.text : "";
  const reply = (body, isError = false) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...isError ? { isError: true } : {}, content: [{ type: "text", text: body }] }
  });
  return (async () => {
    const st = await publishStatus(text);
    if (st.ok) return reply(`занятость ${currentKey}: ${text || "(снята)"}`);
    return reply(st.body, true);
  })();
}
async function publishStatus(text) {
  if (!currentStatusUrl || !currentKey) {
    return {
      ok: false,
      body: 'Отказано (мост): стояния мост не держит — сперва iskron_stand или iskron_channel(action="connect") (и register на живом месте), затем status'
    };
  }
  let res;
  try {
    res = await fetch(currentStatusUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5e3)
    });
  } catch (e) {
    return {
      ok: false,
      body: `Отказано (мост): статусный адрес не ответил — ${e.message}`
    };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (!res.ok)
    return { ok: false, body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}` };
  return { ok: true, body };
}
var readCounter = 0;
async function completeFrame(frame2) {
  if (!frame2 || typeof frame2.body !== "string" || typeof frame2.body_chars !== "number")
    return frame2;
  if (!frame2.id || [...frame2.body].length >= frame2.body_chars) return frame2;
  const realm = state.standing?.realm;
  if (!realm) return { ...frame2, body_read: "truncated: стояние без realm, дочитать нечем" };
  const id = `iskron-bridge-read-${++readCounter}`;
  let reply = null;
  try {
    await post(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "iskron_channel",
          arguments: { realm, action: "history", view: "message", message: frame2.id }
        }
      },
      (m) => {
        if (m.id === id) reply = m;
      }
    );
  } catch (e) {
    log(`кадр ${frame2.id} обрезан, дочитать не вышло: ${e.message}`);
    return { ...frame2, body_read: `truncated: ${e.message}` };
  }
  const text = replyText(reply);
  const nl = text.indexOf("\n");
  const tail = text.indexOf("\nПровенанс, как платформа");
  if (nl < 0 || reply?.result?.isError) {
    return { ...frame2, body_read: `truncated: ${text.slice(0, 160)}` };
  }
  const body = (tail > nl ? text.slice(nl + 1, tail) : text.slice(nl + 1)).trim();
  return { ...frame2, body, body_read: "history" };
}
function stampOrigin(frame2) {
  if (!frame2 || frame2.type !== "message") return frame2;
  return { ...frame2, origin: classifyOrigin(frame2, state.standing?.karta) };
}

// js/bridge/stand.ts
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { basename } from "node:path";

// js/bridge/update.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync2, lstatSync, mkdirSync as mkdirSync5, readFileSync as readFileSync7, renameSync as renameSync2, writeFileSync as writeFileSync5 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { dirname, join as join7 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// js/shared/home.ts
import { homedir as homedir3 } from "node:os";
import { join as join6 } from "node:path";
var homeBridgePath = () => join6(homedir3(), ".iskron-bridge", "iskron-bridge.mjs");

// js/shared/semver.ts
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec((v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// js/bridge/update.ts
var RELEASES_URL = process.env.ISKRON_BRIDGE_RELEASES_URL?.trim() || "https://api.github.com/repos/iskron-ai/skills/releases/latest";
var RAW_URL = process.env.ISKRON_BRIDGE_RAW_URL?.trim() || "https://raw.githubusercontent.com/iskron-ai/skills";
var CHECK_INTERVAL_MS = 6 * 60 * 60 * 1e3;
var updatesDisabled = () => !!process.env.ISKRON_BRIDGE_NO_UPDATE;
var selfPath = () => fileURLToPath3(import.meta.url);
var opencodePluginPath = () => join7(homedir4(), ".config", "opencode", "plugins", "iskron.js");
var setupPathOf = (authDir) => join7(authDir, "SETUP.md");
var latestPathOf = (authDir) => join7(authDir, "latest.json");
function writeAtomic(path, bytes) {
  mkdirSync5(dirname(path), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync5(tmp, bytes, { mode: 420 });
  renameSync2(tmp, path);
}
var isSymlink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};
var versionOf = (path) => {
  try {
    return versionIn(readFileSync7(path, "utf8"));
  } catch {
    return null;
  }
};
function syncHome(self = selfPath()) {
  const out3 = { copied: [] };
  const home = homeBridgePath();
  let mine;
  try {
    mine = readFileSync7(self);
  } catch {
    return out3;
  }
  if (!versionIn(mine.toString("utf8"))) return out3;
  if (self === home) return out3;
  if (isSymlink(home)) return out3;
  const homeVersion = versionOf(home);
  const cmp = homeVersion ? compareVersions(VERSION, homeVersion) : 1;
  if (cmp > 0) {
    writeAtomic(home, mine);
    out3.copied.push(home);
    const plugin = opencodePluginPath();
    const packaged = join7(dirname(self), "opencode-plugin.js");
    if (existsSync2(plugin) && existsSync2(packaged)) {
      const fresh = readFileSync7(packaged);
      if (!readFileSync7(plugin).equals(fresh)) {
        writeAtomic(plugin, fresh);
        out3.copied.push(plugin);
      }
    }
  } else if (cmp < 0 && homeVersion) {
    out3.reexec = home;
  }
  return out3;
}
function reexec(path, argv2) {
  log(
    `домашняя копия новее этой сборки (v${versionOf(path) ?? "?"} > v${VERSION}) — запускаюсь ею: ${path}`
  );
  const child = spawn2(process.execPath, [path, ...argv2], {
    stdio: "inherit",
    env: { ...process.env, ISKRON_BRIDGE_REEXEC: "1" }
  });
  for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(sig, () => child.kill(sig));
  }
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  child.on("error", (e) => {
    log(`перезапуск не удался: ${e.message}`);
    process.exit(1);
  });
}
function readLatest(authDir) {
  try {
    return JSON.parse(readFileSync7(latestPathOf(authDir), "utf8"));
  } catch {
    return null;
  }
}
async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json, text/plain, */*",
      "user-agent": `iskron-bridge/${VERSION}`
    },
    signal: AbortSignal.timeout(15e3)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} от ${url}`);
  return res.text();
}
async function downloadRelease(tag, version, authDir) {
  const written = [];
  const base = `${RAW_URL}/${tag}`;
  const bridge = await fetchText(`${base}/skills/establish-mcp/scripts/iskron.mjs`);
  const got = versionIn(bridge);
  if (got !== version)
    throw new Error(`скачанный мост называет v${got ?? "?"}, релиз — v${version}`);
  const home = homeBridgePath();
  const current = versionOf(home);
  if (!isSymlink(home) && (!current || compareVersions(version, current) > 0)) {
    writeAtomic(home, bridge);
    written.push(home);
  }
  const plugin = opencodePluginPath();
  if (existsSync2(plugin)) {
    const fresh = await fetchText(`${base}/skills/establish-mcp/scripts/opencode-plugin.js`);
    if (readFileSync7(plugin, "utf8") !== fresh) {
      writeAtomic(plugin, fresh);
      written.push(plugin);
    }
  }
  const setup = await fetchText(`${base}/SETUP.md`);
  writeAtomic(setupPathOf(authDir), setup);
  written.push(setupPathOf(authDir));
  return written;
}
async function checkLatest(authDir, force = false) {
  const cached = readLatest(authDir);
  if (!force && cached && Date.now() - cached.checked_at < CHECK_INTERVAL_MS) return cached;
  const latest = { checked_at: Date.now(), version: null, tag: null, downloaded: [] };
  try {
    const body = JSON.parse(await fetchText(RELEASES_URL));
    const tag = body.tag_name?.trim() || null;
    latest.tag = tag;
    latest.version = tag ? tag.replace(/^v/, "") : null;
    if (latest.version && compareVersions(latest.version, VERSION) > 0) {
      latest.downloaded = await downloadRelease(tag, latest.version, authDir);
    } else if (force && tag) {
      writeAtomic(setupPathOf(authDir), await fetchText(`${RAW_URL}/${tag}/SETUP.md`));
      latest.downloaded = [setupPathOf(authDir)];
    }
  } catch (e) {
    latest.error = e.message;
  }
  try {
    writeAtomic(latestPathOf(authDir), JSON.stringify(latest, null, 2));
  } catch {
  }
  return latest;
}
function staleNotice(latest, authDir) {
  if (!latest?.version || compareVersions(latest.version, VERSION) <= 0) return null;
  const bridgeWord = latest.downloaded.some((p) => p === homeBridgePath()) ? "Свежий мост уже скачан в ~/.iskron-bridge и поднимется новой сессией." : latest.error ? `Скачать свежий мост не вышло (${latest.error}); повтори: node ~/.iskron-bridge/iskron-bridge.mjs update.` : isSymlink(homeBridgePath()) ? "Свежий мост в дом не положен: дом — симлинк на чужую копию, его не трогаю; обнови эту копию сам." : versionOf(homeBridgePath()) && compareVersions(versionOf(homeBridgePath()), latest.version) >= 0 ? "Свежий мост уже лежит в ~/.iskron-bridge и поднимется новой сессией." : "Свежий мост в дом не положен; повтори: node ~/.iskron-bridge/iskron-bridge.mjs update.";
  return `[iskron-bridge] ПОСТАВКА ОТСТАЛА: этот мост v${VERSION}, свежий релиз v${latest.version}. ${bridgeWord} Скиллы обновляет канал харнеса, и об этом надо СКАЗАТЬ ЧЕЛОВЕКУ: Claude Code — /plugin marketplace update iskron, затем /reload-plugins; плоская установка — npx skills update --global; pi — pi update git:github.com/iskron-ai/skills; Codex — codex plugin marketplace upgrade iskron, затем codex plugin remove iskron@iskron и codex plugin add iskron@iskron. Полный порядок — свежий установщик ${setupPathOf(authDir)} (кладёт update); по слову человека «обнови» исполни его.`;
}
var pendingNotice = null;
function takeNotice() {
  const n = pendingNotice;
  pendingNotice = null;
  return n;
}
function startFreshnessWatch(authDir, serverUrl) {
  if (updatesDisabled()) return;
  const explicit = !!process.env.ISKRON_BRIDGE_RELEASES_URL?.trim();
  if (!explicit && serverUrl.replace(/\/+$/, "") !== DEFAULT_SERVER_URL.replace(/\/+$/, "")) return;
  const tick = async () => {
    const latest = await checkLatest(authDir);
    const notice = staleNotice(latest, authDir);
    if (!notice) return;
    pendingNotice = notice;
    log(notice);
    emit({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "warning", logger: "iskron-bridge", data: { kind: "stale", text: notice } }
    });
  };
  const delay = Number(process.env.ISKRON_BRIDGE_UPDATE_DELAY_MS ?? 2e3);
  setTimeout(() => void tick(), Number.isFinite(delay) ? delay : 2e3).unref();
  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
}

// js/bridge/stand.ts
var STAND_TOOL = {
  name: "iskron_stand",
  description: "[мост] Занять стояние одним вызовом: мост читает доску, выводит имя (машина.репо.ветка), занимает место (connect и register; только register, если сокет уже держит этот мост), взводит хук инбокса роли своим входящим адресом, при room шлёт кадр join стоянию комнаты по полному адресу с провода (повтор — только repeat_knock=true, один раз, не раньше чем через 2 минуты) и возвращает имя, команду сторожа, число ожидавших кадров, состояние хука и расписку стука. Дальше — запустить сторожа командой из ответа и ждать. Тул исполняет мост; нет его в сессии — тулы идут мимо моста либо мост старой сборки (doctor скажет), стой по скиллу standing.",
  inputSchema: {
    type: "object",
    properties: {
      realm: { type: "string", description: "Адрес графа: @owner/slug или rN." },
      karta: { type: "string", description: "Роль агента (#N из AGENTS.md или строки запуска)." },
      name: {
        type: "string",
        description: "Своя половина имени стояния; без неё выводится машина.репо.ветка."
      },
      room: {
        type: "string",
        description: "Полный адрес стояния комнаты @handle:name из строки приглашения; мост шлёт ему join."
      },
      mute_siblings: { type: "boolean", description: "Не слышать эхо других стояний той же роли." },
      take: {
        type: "boolean",
        description: "Забрать сокет места, которое слушает другой мост этой машины (обычно прежняя сессия той же рабочей копии): без take такое место только регистрируется, слух остаётся у держателя."
      },
      room_karta: {
        type: "string",
        description: "Роль, чьё стояние — комната (#N), если комнаты нет на доске; обычно роль человека, приславшего приглашение."
      },
      repeat_knock: {
        type: "boolean",
        description: "Осознанный повтор стука в ту же комнату: разрешён один раз и не раньше чем через 2 минуты после первого; без него повторный вызов второго join не шлёт."
      },
      status: { type: "string", description: "Первая строка занятости (до 64 символов)." }
    },
    required: ["realm", "karta"]
  }
};
var isStandCall = (msg) => msg?.method === "tools/call" && msg?.params?.name === "iskron_stand";
var sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 32);
var git = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      timeout: 2e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
  } catch {
    return "";
  }
};
function deriveName() {
  const host = hostname().split(".")[0];
  const top = git(["rev-parse", "--show-toplevel"]);
  const repo = basename(top || process.cwd());
  const branch = top ? git(["rev-parse", "--abbrev-ref", "HEAD"]) : "";
  return [host, repo, branch].map(sanitize).filter(Boolean).join(".");
}
function parseBoard(text) {
  const out3 = [];
  for (const line of text.split("\n")) {
    const m = /^\s*#(\d+)\s.*?·\s(@\S+)\s—\s(.*)$/.exec(line);
    if (m) {
      out3.push({ karta: m[1], address: m[2], rest: m[3], incoming: null });
      continue;
    }
    const inc = /📥\s*(https?:\/\/\S+)/.exec(line);
    if (inc && out3.length) out3[out3.length - 1].incoming = inc[1];
  }
  return out3;
}
var seq = 0;
var knocks = /* @__PURE__ */ new Map();
var KNOCK_REPEAT_AFTER_MS = Number(process.env.ISKRON_STAND_KNOCK_REPEAT_MS) || 12e4;
var KNOCK_LIMIT = 2;
async function call(name, args) {
  const id = `iskron-bridge-stand-${++seq}`;
  const msg = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
  };
  let reply = null;
  await post(msg, (m) => {
    if (m.id === id) reply = m;
  });
  let got = reply;
  if (!got) return { text: "ответа нет", isError: true };
  if (name === "iskron_channel") {
    if (args.action === "register") noteStanding(msg, got);
    if (args.action === "connect") got = absorbChannelReply(msg, got);
  }
  return { text: replyText(got), isError: !!got.error || !!got.result?.isError };
}
var short = (s, n = 300) => s.length > n ? `${s.slice(0, n)}…` : s;
async function runStand(msg) {
  const a = msg.params?.arguments ?? {};
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const karta = a.karta != null ? String(a.karta).trim().replace(/^#/, "") : "";
  const lines = [];
  const done = (isError = false) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: {
      ...isError ? { isError: true } : {},
      content: [{ type: "text", text: lines.join("\n") }]
    }
  });
  if (!realm || !karta) {
    lines.push(
      "Отказано (мост): iskron_stand требует realm и karta — граф и роль из AGENTS.md или строки запуска."
    );
    return done(true);
  }
  const name = typeof a.name === "string" && a.name.trim() ? sanitize(a.name.trim()) : deriveName();
  const room = typeof a.room === "string" && a.room.trim() ? a.room.trim() : null;
  const board = await call("iskron_channel", { action: "list", realm });
  if (board.isError) {
    lines.push(`Отказано: доска не прочиталась — ${short(board.text)}`);
    return done(true);
  }
  const entries = parseBoard(board.text);
  const header = /^\s*Каналы(?:\s*\((\d+)\))?(?:\s|:|$)/m.exec(board.text);
  const declared = header?.[1] != null ? Number(header[1]) : null;
  const empty = /не держит канала/i.test(board.text);
  const recognized = !!header || empty || entries.length > 0;
  const own = entries.filter((e) => e.karta === karta && e.address.endsWith(`:${name}`));
  const unread = declared != null && declared !== entries.length;
  if (!recognized || own.length > 1 || unread && own.length === 0 && a.take !== true) {
    lines.push(
      !recognized ? `Отказано: форма доски не распознана — ни заголовка «Каналы», ни слова о пустом графе, ни строк мест; управляющих действий (connect, стук, хук) по догадке не делаю. Начало ответа: ${short(board.text, 160)}` : own.length > 1 ? `Отказано: на доске ${own.length} места с именем ${name} у роли #${karta} — форма неоднозначна, состояние не определить.` : `Отказано: доска объявляет ${declared} мест, разобрано ${entries.length}, и своего места среди разобранных нет — нераспознанная строка могла быть им; connect ротировал бы его вслепую. Уверен, что места нет, — повтори с take=true.`
    );
    return done(true);
  }
  if (unread)
    lines.push(
      `Доска объявляет ${declared} мест, разобрано ${entries.length} — одну строку парсер не понял; своё место найдено, иду дальше.`
    );
  const mine = own[0];
  let incoming = mine?.incoming ?? null;
  let how;
  let heardHere;
  const listensElsewhere = !!mine && /(^|·)\s*слушает/.test(mine.rest) && !holdsStanding(realm, karta, name);
  if (a.take !== true && (holdsStanding(realm, karta, name) || listensElsewhere)) {
    const r = await call("iskron_channel", { action: "register", realm, karta, name });
    if (r.isError) {
      lines.push(`Отказано: register — ${short(r.text)}`);
      return done(true);
    }
    heardHere = !listensElsewhere;
    how = listensElsewhere ? "место уже слушает другой держатель (обычно прежняя сессия этой рабочей копии; при явном name — возможно, другая машина или человек) — только register: атрибуция есть, слух — у него; нужен слух здесь — повтори с take=true, сознавая, что снимешь слух с того держателя, или возьми другое имя (name)" : "сокет уже держит этот мост — register";
  } else {
    const args = { action: "connect", realm, karta, name };
    if (typeof a.mute_siblings === "boolean") args.mute_siblings = a.mute_siblings;
    const c = await call("iskron_channel", args);
    if (c.isError) {
      lines.push(`Отказано: connect — ${short(c.text)}`);
      return done(true);
    }
    incoming = /https?:\/\/\S+\/channel\/in\/\S+/.exec(c.text)?.[0] ?? incoming;
    const r = await call("iskron_channel", { action: "register", realm, karta, name });
    if (r.isError) {
      lines.push(`Место занято, но register отказал — ${short(r.text)}`);
      return done(true);
    }
    for (const k of [...knocks.keys()])
      if (k.startsWith(`${realm}|${karta}|${name}|`)) knocks.delete(k);
    heardHere = true;
    how = mine ? listensElsewhere ? "место слушал другой держатель — connect по take (сокет теперь у этого моста, прежний держатель получил 4000) и register" : a.take === true ? "connect по take — новый цикл входа, счёт стуков сброшен — и register" : "место было — connect (сокет теперь у этого моста) и register" : "connect и register";
  }
  lines.push(
    `[iskron_stand] стояние ${mine?.address ?? name} — роль #${karta}, граф ${realm}: ${how}.`
  );
  const block = heardHere ? listenBlock() : null;
  if (block) lines.push(block);
  else if (!heardHere)
    lines.push(
      "Команда сторожа не выдаётся: сокет у другого держателя, местного нет — эта сессия кадры и приглашения не принимает."
    );
  else lines.push("Сокета у моста нет — слушать нечем; проверь ответ connect.");
  if (!heardHere) lines.push("Слух — у другого держателя; здесь только атрибуция записей.");
  else if (how.startsWith("сокет уже держит"))
    lines.push("Сокет держит этот мост (hello был получен при занятии места).");
  else {
    const hello = await awaitHello(4e3);
    if (hello) lines.push(`hello получен: ожидало кадров — ${hello.pending ?? 0}.`);
    else
      lines.push(
        "hello за 4 с не пришёл — сокет мост держит, но доказательства слуха ещё нет: проверь доску."
      );
  }
  const hooks = await call("iskron_admin", { action: "list_webhooks", realm, node_id: karta });
  const hooksRecognized = !hooks.isError && /^\s*Вебхуки(?:\s|:|\(|$)/m.test(hooks.text);
  const nameRe = new RegExp(`:${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`);
  const wakesMe = hooksRecognized && hooks.text.split(/\n(?=\s*#\d+\s*→)/).some((b) => /активен/.test(b) && nameRe.test(b));
  if (wakesMe) lines.push("Хук инбокса роли: стоит и будит это стояние.");
  else if (!hooksRecognized)
    lines.push(
      `Хук инбокса роли: список хуков не распознан — не трогаю (${short(hooks.text, 120)}).`
    );
  else if (!heardHere) lines.push("Хук инбокса роли: не взвожу — слух у другого держателя.");
  else if (!incoming)
    lines.push("Хук инбокса роли: не взведён — входящий адрес стояния не прочитался.");
  else {
    const h = await call("iskron_admin", {
      action: "add_webhook",
      realm,
      node_id: karta,
      url: incoming,
      ttl_seconds: 0
    });
    lines.push(
      h.isError ? `Хук инбокса роли: не взвёлся — ${short(h.text)}` : `Хук инбокса роли: взведён (${short(h.text, 120)}).`
    );
  }
  if (room && !heardHere) {
    lines.push(
      `Комната ${room}: стук не отправлен — ответ комнаты ушёл бы держателю сокета, не сюда; нужен вход здесь — повтори с take=true или с другим name.`
    );
  } else if (room) {
    const onBoard = entries.find((e) => e.address === room);
    const roomKarta = onBoard?.karta ?? (typeof a.room_karta === "string" && a.room_karta.trim() ? a.room_karta.trim().replace(/^#/, "") : null);
    const key = `${realm}|${karta}|${name}|${room}`;
    const prior = knocks.get(key);
    const waited = prior ? Date.now() - prior.at : Infinity;
    const again = a.repeat_knock === true;
    if (prior && prior.count >= KNOCK_LIMIT) {
      lines.push(
        `Комната ${room}: стучал дважды, приглашения нет — больше не стучу в этом заходе; скажи человеку, что комната не ответила, и попроси открыть чат (счёт сбрасывает новый вход: take=true или новая сессия).`
      );
    } else if (prior && !again) {
      lines.push(
        `Комната ${room}: стук уже отправлен ${Math.round(waited / 1e3)} с назад — жди приглашения; осознанный повтор — тем же вызовом с repeat_knock=true, не раньше чем через ${Math.round(KNOCK_REPEAT_AFTER_MS / 1e3)} с.`
      );
    } else if (prior && waited < KNOCK_REPEAT_AFTER_MS) {
      lines.push(
        `Комната ${room}: повтор рано — с первого стука прошло ${Math.round(waited / 1e3)} с, правило ждёт ${Math.round(KNOCK_REPEAT_AFTER_MS / 1e3)} с; повтори через ${Math.ceil((KNOCK_REPEAT_AFTER_MS - waited) / 1e3)} с.`
      );
    } else if (!roomKarta) {
      lines.push(
        `Комната ${room}: на доске графа ${realm} этого стояния нет, а send требует роль его держателя — стук не отправлен. Стояние комнаты живёт присутствием человека: либо он ушёл дольше порога (попроси открыть чат и повтори), либо передай room_karta=<роль человека комнаты>.`
      );
    } else {
      const s = await call("iskron_channel", {
        action: "send",
        realm,
        karta: roomKarta,
        standing: room,
        text: "join"
      });
      if (s.isError) lines.push(`Комната ${room}: стук отказан — ${short(s.text)}`);
      else {
        knocks.set(key, { at: Date.now(), count: (prior?.count ?? 0) + 1 });
        lines.push(
          `Комната ${room}: ${prior ? "повторный " : ""}стук отправлен — ${short(s.text, 200)} Жди первого слова комнаты с шапкой; до него в комнату не пиши.`
        );
      }
    }
  }
  if (typeof a.status === "string" && a.status.trim() && !heardHere) {
    lines.push("Занятость не публикуется: статусный адрес у держателя сокета.");
  } else if (typeof a.status === "string" && a.status.trim()) {
    const st = await publishStatus(a.status.trim());
    lines.push(st.ok ? `Занятость: ${a.status.trim()}` : `Занятость не принята: ${short(st.body)}`);
  }
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  if (stale) lines.push(stale);
  return done();
}

// js/bridge/moment.ts
var WRITE_TOOL = /^iskron_(add_[a-z_]+|batch)$/;
var JSON_LINE = "Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; hint — гроссбух превращения: исходы с вердиктами и что дальше, не пересказ карты; строки CHECKS в ответе — работа этого такта.";
var MOMENT_LINE = "[мост] " + JSON_LINE;
var STATUS_LINE = '[мост] action="status" (realm, text) — занятость ЭТОГО стояния: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.';
function annotateToolList(reply) {
  const tools = reply?.result?.tools;
  if (!Array.isArray(tools)) return;
  if (!tools.some((t) => t?.name === STAND_TOOL.name)) tools.push(STAND_TOOL);
  for (const t of tools) {
    if (t && t.name === "iskron_channel" && typeof t.description === "string") {
      if (!t.description.includes(STATUS_LINE))
        t.description = `${t.description}

${STATUS_LINE}`;
      continue;
    }
    if (!t || typeof t.name !== "string" || !WRITE_TOOL.test(t.name)) continue;
    const d = typeof t.description === "string" ? t.description : "";
    if (d.includes(MOMENT_LINE)) continue;
    t.description = d ? `${d}

${MOMENT_LINE}` : MOMENT_LINE;
  }
}

// js/bridge/deliver.ts
function syntheticError(id, message, outcome = UpstreamError.UNKNOWN, holdOff = false) {
  const kind = holdOff === true ? "wait" : holdOff;
  const verdict = outcome === UpstreamError.NOT_SENT ? kind === "wait" ? (
    // Safe and not-yet are different axes, and an agent told only "safe" reads
    // it as "now": it retries into the same wall, then goes looking for a
    // defect in what only time repairs. The interval itself stays where it was
    // measured — in the reason above — so one refusal never carries two.
    "Nothing was applied and the grant is whole — this clears itself by waiting, not by fixing: wait out the interval named above before retrying."
  ) : kind === "knock" ? "Nothing was applied and the grant is whole — a benign transition, not a broken authorization: retry the call now. Only a refusal that returns means the hour is real — that one names its own wait." : kind === "dead" ? "Nothing was applied, and no retry and no wait will change that — only a human with a new token can." : "The call never reached the server, so nothing was applied — retry freely." : "The call went out and its answer was lost, so THE OUTCOME IS UNKNOWN — re-read the target before retrying: a blind retry can apply a second time, and a write with no version guard duplicates silently.";
  const tail = kind ? "The bridge stays up." : "The bridge stays up; if this repeats, the server side needs attention.";
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32001,
      // BUILD is here for the field report: the error is quoted verbatim, and
      // the build string is what dates the code that produced it.
      message: `iskron-bridge ${BUILD}: ${message}. ${verdict} ${tail}`
    }
  };
}
function withNotice(reply) {
  const content = reply?.result?.content;
  if (!Array.isArray(content)) return reply;
  const notice = takeNotice();
  if (notice && !content.some((c) => c?.text?.includes("ПОСТАВКА ОТСТАЛА"))) {
    content.push({ type: "text", text: notice });
  }
  return reply;
}
async function deliver(msg) {
  const local = localStatus(msg);
  if (local) {
    emit(await local);
    return;
  }
  const isInit = msg?.method === "initialize";
  if (isInit) state.initParams = msg.params;
  const hasId = msg?.id !== void 0 && msg?.id !== null;
  let authRetried = false;
  let sessionRetried = false;
  let outcome = UpstreamError.NOT_SENT;
  const note3 = (e) => {
    if (!(e instanceof UpstreamError) || e.outcome === UpstreamError.UNKNOWN) {
      outcome = UpstreamError.UNKNOWN;
    }
  };
  const isToolCall = msg?.method === "tools/call";
  const isStand = isStandCall(msg);
  let heldReply;
  let standingRetried = false;
  const forward = (m) => {
    if (isInit && m.id === msg.id && m.result?.protocolVersion) {
      state.protocolVersion = m.result.protocolVersion;
    }
    if (m.id === msg.id) noteStanding(msg, m);
    if (m.id === msg.id && msg.method === "tools/list") annotateToolList(m);
    if (isToolCall && hasId && m.id === msg.id) {
      heldReply = m;
      return;
    }
    emit(m);
  };
  for (; ; ) {
    try {
      if (!isInit && state.sessionId && state.sessionToken && currentAccessToken() !== state.sessionToken) {
        log(
          "the access token changed since the session was opened — re-initializing before the call"
        );
        await reinitialize();
      }
      if (!isInit && !state.sessionId && state.initParams) {
        log("no upstream session yet — initializing before the call");
        await reinitialize();
      }
      if (!isInit) await ensureStanding();
      if (isStand) {
        emit(withNotice(await runStand(msg)));
        return;
      }
      heldReply = null;
      await post(msg, forward);
      const held = heldReply;
      if (held) {
        if (state.standing && isUnattributed(held)) {
          state.standingSession = null;
          const refused = !!held.result?.isError;
          if (refused && !standingRetried) {
            standingRetried = true;
            log("the call ran unattributed — re-binding the standing and repeating it once");
            await ensureStanding();
            if (state.standingSession !== state.sessionId) await ensureStanding();
            if (state.standingSession === state.sessionId) continue;
          } else {
            log(
              `a write went out unattributed (${replyText(held).slice(0, 120)}) — the standing is re-bound before the next call`
            );
          }
        }
        emit(withNotice(absorbRevokeReply(msg, absorbChannelReply(msg, held))));
      }
      return;
    } catch (e) {
      note3(e);
      if (e instanceof UpstreamError && e.kind === "auth" && !authRetried) {
        authRetried = true;
        try {
          await ensureAuth(e.message, { force: true, rejected: e.presented });
          continue;
        } catch (authErr) {
          if (authErr instanceof TokenRefused) {
            if (hasId) emit(syntheticError(msg.id, authErr.message, outcome, "dead"));
            return;
          }
          if (authErr instanceof AuthPending || authErr instanceof LoginHeld) {
            if (hasId) {
              emit(syntheticError(msg.id, authErr.message, outcome, authErr instanceof LoginHeld));
            }
            return;
          }
          const held = authErr instanceof HoldOffError;
          const message = errorMessage(authErr);
          log(`${held ? "authorization holding off" : "authorization failed"}: ${message}`);
          if (hasId) {
            emit(
              syntheticError(
                msg.id,
                `${held ? "authorization holding off" : "authorization failed"}: ${message}`,
                outcome,
                held && (authErr.retryNow ? "knock" : "wait")
              )
            );
          }
          return;
        }
      }
      if (e instanceof UpstreamError && e.kind === "session" && !sessionRetried && !isInit) {
        sessionRetried = true;
        try {
          await reinitialize();
          continue;
        } catch (reErr) {
          if (hasId) {
            emit(
              syntheticError(msg.id, `session recovery failed: ${errorMessage(reErr)}`, outcome)
            );
          }
          return;
        }
      }
      const reason = e instanceof UpstreamError ? e.kind === "auth" && authRetried ? `upstream refuses even a freshly obtained access token (${e.message}) — not an expiry; the token's audience/resource may not match what the server validates (operator lever: ISKRON_BRIDGE_RESOURCE), or the server's token validation is off` : e.message : `bridge internal error: ${errorMessage(e)}`;
      log(`request ${hasId ? msg.id : `(notification ${msg?.method})`} failed: ${reason}`);
      if (hasId) emit(syntheticError(msg.id, reason, outcome));
      return;
    }
  }
}

// js/bridge/main.ts
function bridgeMain(argv2) {
  guardStream(process.stdout);
  guardStream(process.stderr);
  setConfig(parseArgs(argv2));
  installAuthLockExitHook();
  installRefreshLockExitHook();
  log(
    `${BUILD} -> ${CFG.serverUrl} (timeout ${CFG.timeoutMs}ms, ${CFG.pat ? `personal access token from ${CFG.patSource}` : `auth in ${storePath()}`})`
  );
  startTokenKeepalive();
  startFreshnessWatch(CFG.authDir, CFG.serverUrl);
  holdFromEnv();
  const rl = createInterface({ input: process.stdin, terminal: false });
  const pending = /* @__PURE__ */ new Set();
  let handshake = null;
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      log(`unparseable line from harness: ${trimmed.slice(0, 120)}`);
      return;
    }
    const run = () => deliver(msg).catch((e) => log(`unexpected: ${e?.stack || errorMessage(e)}`));
    let p;
    if (msg.method === "initialize") {
      p = run();
      handshake = p;
      p.finally(() => {
        if (handshake === p) handshake = null;
      });
    } else if (handshake) {
      const gate = handshake;
      p = gate.then(run, run);
    } else p = run();
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  const leave = async (why) => {
    debug(`${why} — winding down`);
    releaseStanding(why);
    await Promise.allSettled([...pending, ...tokenRequestsInFlight]);
    await flushStdout();
    const flow = pendingFlow();
    if (flow) {
      log(
        `${why}, but an authorization flow is pending — staying up until the human's click lands`
      );
      await flow.catch(() => {
      });
    }
    await Promise.allSettled([...tokenRequestsInFlight]);
    await flushStdout();
    process.exit(0);
  };
  rl.on("close", () => void leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => void leave("SIGTERM"));
  let interrupted = false;
  process.on("SIGINT", () => {
    releaseStanding("SIGINT");
    if (interrupted || tokenRequestsInFlight.size === 0) process.exit(0);
    interrupted = true;
    Promise.allSettled([...tokenRequestsInFlight]).then(() => process.exit(0));
  });
  process.on("uncaughtException", (e) => log(`uncaught: ${e?.stack || e}`));
  process.on(
    "unhandledRejection",
    (e) => log(`unhandled rejection: ${e?.stack || String(e)}`)
  );
}

// js/watchdog/codex.ts
import { existsSync as existsSync4 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { join as join9 } from "node:path";

// js/shared/appserver.ts
import { randomBytes as randomBytes2 } from "node:crypto";
import { request } from "node:http";
function frame(data) {
  const mask = randomBytes2(4);
  let head;
  if (data.length < 126) head = Buffer.from([129, 128 | data.length]);
  else if (data.length < 65536) {
    head = Buffer.alloc(4);
    head[0] = 129;
    head[1] = 128 | 126;
    head.writeUInt16BE(data.length, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 129;
    head[1] = 128 | 127;
    head.writeBigUInt64BE(BigInt(data.length), 2);
  }
  const masked = Buffer.from(data.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([head, mask, masked]);
}
function openDoor(socketPath, onMessage, onClose) {
  return new Promise((resolve, reject) => {
    const req = request({
      socketPath,
      path: "/",
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": randomBytes2(16).toString("base64")
      }
    });
    req.on("upgrade", (_res, socket) => {
      let buf = Buffer.alloc(0);
      socket.on("data", (c) => {
        buf = Buffer.concat([buf, c]);
        for (; ; ) {
          if (buf.length < 2) return;
          const op = buf[0] & 15;
          let len = buf[1] & 127;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            if (buf.length < 10) return;
            len = Number(buf.readBigUInt64BE(2));
            off = 10;
          }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (op === 1) {
            try {
              onMessage(JSON.parse(payload.toString("utf8")));
            } catch {
            }
          } else if (op === 8) socket.end();
        }
      });
      socket.on("close", () => onClose("сокет закрыт"));
      socket.on("error", (e) => onClose(e.message));
      resolve({
        send: (msg) => socket.write(frame(Buffer.from(JSON.stringify(msg)))),
        close: () => socket.end()
      });
    });
    req.on("response", (res) => reject(new Error(`дверь не открылась: HTTP ${res.statusCode}`)));
    req.on("error", reject);
    req.end();
  });
}

// js/shared/frame-text.ts
var ENVELOPE_KEYS = ["id", "received_at", "stale", "content_type", "body_chars", "body_read"];
function frameToText(frame2, raw) {
  if (!frame2) return `Кадр канала Искрона:
${raw}`;
  const p = frame2.provenance ?? {};
  const origin = frame2.origin ?? classifyOrigin(frame2);
  const standing = p.from_standing ? ` — стояние ${p.from_standing}` : "";
  const role = p.from_karta_seq != null ? `роли #${p.from_karta_seq}` : "роли неизвестной";
  const who = origin === "platform" ? "от ПЛАТФОРМЫ — побудка, не человек и не делатель" : origin === "human" ? `от ЧЕЛОВЕКА${p.user ? ` @${p.user}` : ""} (${role})${standing}` : origin === "sibling" ? `от БРАТА по твоей роли (#${p.from_karta_seq})${standing} — другое стояние той же роли` : `от делателя ${role}${standing}`;
  const lines = [`Кадр канала Искрона ${who}`];
  if (frame2.provenance) lines.push(`provenance: ${JSON.stringify(frame2.provenance)}`);
  const envelope = {};
  for (const k of ENVELOPE_KEYS) if (frame2[k] !== void 0) envelope[k] = frame2[k];
  if (Object.keys(envelope).length) lines.push(`frame: ${JSON.stringify(envelope)}`);
  const body = typeof frame2.body === "string" ? frame2.body : raw;
  return `${lines.join("\n")}

${body}`;
}

// js/watchdog/client.ts
import { existsSync as existsSync3, readdirSync as readdirSync2, readFileSync as readFileSync8 } from "node:fs";
import { connect as connect2 } from "node:net";
import { join as join8 } from "node:path";
var ATTACH_WINDOW_MS = 6e4;
var RETRY_MS = 1e3;
function parseWatchdogArgs(argv2) {
  const out3 = { authDir: authDirFromEnv() };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--auth-dir") out3.authDir = argv2[++i] ?? out3.authDir;
    else if (!a.startsWith("--") && !out3.key) out3.key = a;
  }
  return out3;
}
function resolveStanding(argv2) {
  const { key, authDir } = parseWatchdogArgs(argv2);
  const dir = standingsDirOf(authDir);
  const pathFor = (k) => socketPathOf(authDir, k);
  if (key) return { key, path: pathFor(key) };
  const held = existsSync3(dir) ? readdirSync2(dir).filter((f) => f.endsWith(".key")).map((f) => {
    try {
      return readFileSync8(join8(dir, f), "utf8").trim();
    } catch {
      return "";
    }
  }).filter(Boolean) : [];
  if (held.length === 1) return { key: held[0], path: pathFor(held[0]) };
  if (held.length === 0) {
    return {
      error: 'мост не держит ни одного стояния — сперва iskron_channel(action="connect") (и register): ответ connect назовёт команду слушания'
    };
  }
  return {
    error: `мост держит несколько стояний — назови нужное: ` + held.join(", ")
  };
}
function attach(path, o) {
  const startedAt = Date.now();
  let attached = false;
  function tryOnce() {
    const sock = connect2(path);
    let buf = "";
    sock.setEncoding("utf8");
    sock.on("connect", () => {
      attached = true;
    });
    sock.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (ev.kind === "frame" && ev.frame === void 0 && typeof ev.raw === "string") {
          try {
            ev.frame = JSON.parse(ev.raw);
          } catch {
            ev.frame = null;
          }
        }
        o.onEvent(ev);
      }
    });
    sock.on("error", () => {
    });
    sock.on("close", () => {
      if (attached) return o.onGone("мост отпустил стояние или ушёл — сессия кончилась?");
      if (Date.now() - startedAt > ATTACH_WINDOW_MS) {
        return o.onGone(`мост не поднял локальный сокет ${path} за ${ATTACH_WINDOW_MS / 1e3}s`);
      }
      setTimeout(tryOnce, RETRY_MS);
    });
  }
  tryOnce();
}

// js/watchdog/codex.ts
var note = (s) => {
  process.stderr.write(s + "\n");
};
function codexDoorPath() {
  const home = process.env.CODEX_HOME?.trim() || join9(homedir5(), ".codex");
  return join9(home, "app-server-control", "app-server-control.sock");
}
function runWatchdogCodex(argv2) {
  const threadId = process.env.CODEX_THREAD_ID?.trim();
  if (!threadId) {
    note(
      "ДЕЛАТЕЛЬ: нет CODEX_THREAD_ID — запускай этого сторожа из оболочки сессии Codex: там Codex кладёт id треда в окружение"
    );
    process.exit(2);
  }
  const socketPath = codexDoorPath();
  if (!existsSync4(socketPath)) {
    note(
      `ДЕЛАТЕЛЬ: двери нет (${socketPath}) — этот тред не под демоном app-server. Это ход ЧЕЛОВЕКА до запуска сессии, не твой: демон и сессия Codex должны стартовать с одним коротким CODEX_HOME (рецепт в SETUP, раздел Codex). Скажи ему это; пока двери нет — слушай watchdog-exit`
    );
    process.exit(2);
  }
  const target = resolveStanding(argv2);
  if ("error" in target) {
    note(`ДЕЛАТЕЛЬ: ${target.error}`);
    process.exit(2);
  }
  parseWatchdogArgs(argv2);
  let door = null;
  let ready = null;
  let nextId = 1;
  function open() {
    if (ready) return ready;
    ready = openDoor(
      socketPath,
      () => {
      },
      (why) => {
        note(`дверь закрылась: ${why} — открою заново на следующем кадре`);
        door = null;
        ready = null;
      }
    ).then((d) => {
      door = d;
      d.send({
        method: "initialize",
        id: nextId++,
        params: { clientInfo: { name: "iskron-watchdog", title: "iskron", version: "1" } }
      });
      d.send({ method: "initialized" });
      return d;
    });
    ready.catch((e) => {
      note(`дверь не открылась: ${e.message}`);
      ready = null;
    });
    return ready;
  }
  async function deliver2(text) {
    try {
      const d = door ?? await open();
      d.send({
        method: "turn/start",
        id: nextId++,
        params: { threadId, input: [{ type: "text", text }], turnTrigger: "iskron-channel" }
      });
      note(`кадр вложен в тред ${threadId}`);
    } catch (e) {
      note(`ДЕЛАТЕЛЬ: кадр не вложился — ${e.message}`);
    }
  }
  let replay = 0;
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          if (replay > 0) {
            replay--;
            return note("кадр из кольца моста — уже был, в тред не кладу");
          }
          const type = ev.frame?.type;
          if (type !== "message") return note(`кадр ${type ?? "не разобран"} — не повод будить`);
          void deliver2(frameToText(ev.frame, ev.raw ?? ""));
          break;
        }
        case "dead":
        case "alive":
          note(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно");
          void deliver2(
            ev.text ?? 'Искрон: стояние потеряно — зови iskron_channel(action="connect")'
          ).then(() => process.exit(1));
          break;
        case "attached":
          replay = ev.buffered ?? 0;
          note(`слушаю стояние ${ev.key}; кадры кладу в тред ${threadId}`);
          break;
        default:
          note(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note(`ДЕЛАТЕЛЬ: ${why}`);
      process.exit(1);
    }
  });
}

// js/watchdog/watchdog.ts
import { writeSync } from "node:fs";
var plural = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "кадр" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "кадра" : "кадров";
  return `${n} ${word}`;
};
var log2 = (s) => {
  process.stdout.write(s + "\n");
};
var loudExit = (s, code) => {
  try {
    writeSync(1, s + "\n");
    process.exit(code);
  } catch {
    process.stdout.write(s + "\n", () => process.exit(code));
    setTimeout(() => process.exit(code), 1e3).unref();
  }
};
function runWatchdog(argv2) {
  const target = resolveStanding(argv2);
  if ("error" in target) {
    writeSync(2, `ДЕЛАТЕЛЬ: ${target.error}
`);
    process.exit(2);
  }
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "attached":
          log2(
            `слушаю стояние ${ev.key}${ev.buffered ? ` (${plural(ev.buffered)} задним числом)` : ""}`
          );
          break;
        case "frame":
          log2(ev.raw ?? "");
          break;
        case "note":
          log2(ev.text ?? "");
          break;
        case "dead":
        case "alive":
          loudExit(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно", 1);
          break;
        case "released":
          log2(`мост отпустил сокет: ${ev.text ?? ""}`);
          break;
      }
    },
    onGone: (why) => loudExit(`ДЕЛАТЕЛЬ: ${why}`, 1)
  });
}

// js/watchdog/watchdog-exit.ts
import { writeSync as writeSync2 } from "node:fs";
var wake = (s) => {
  writeSync2(1, s + "\n");
};
var note2 = (s) => {
  writeSync2(2, s + "\n");
};
function runWatchdogExit(argv2) {
  const target = resolveStanding(argv2);
  if ("error" in target) {
    note2(`ДЕЛАТЕЛЬ: ${target.error}`);
    process.exit(2);
  }
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const type = ev.frame?.type;
          if (type !== "message") return note2(`кадр ${type ?? "не разобран"} — не повод будить`);
          wake(ev.raw ?? "");
          process.exit(0);
          break;
        }
        case "dead":
        case "alive":
          note2(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно");
          process.exit(1);
          break;
        case "attached":
          note2(`слушаю стояние ${ev.key}`);
          break;
        default:
          note2(ev.text ?? ev.kind);
      }
    },
    onGone: (why) => {
      note2(`ДЕЛАТЕЛЬ: ${why}`);
      process.exit(1);
    }
  });
}

// js/cli/doctor.ts
import { createHash as createHash4 } from "node:crypto";
import { existsSync as existsSync5, readFileSync as readFileSync9 } from "node:fs";
import { homedir as homedir6 } from "node:os";
import { dirname as dirname2, join as join10 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var out = (s) => {
  process.stdout.write(s + "\n");
};
var hashOf2 = (buf) => createHash4("sha256").update(buf).digest("hex").slice(0, 8);
var seconds = (ms) => `${Math.round(ms / 1e3)}s`;
function homeCopyReport() {
  const home = homeBridgePath();
  let self = null;
  try {
    self = readFileSync9(fileURLToPath4(import.meta.url));
  } catch {
  }
  if (!existsSync5(home)) {
    out(`домашняя копия: нет (${home}) — её кладёт establish-mcp при подключении`);
    return;
  }
  const bytes = readFileSync9(home);
  if (self && bytes.equals(self)) {
    out(`домашняя копия: ${home} — та же сборка, что и этот файл`);
    return;
  }
  const v = versionIn(bytes.toString("utf8"));
  out(
    `домашняя копия: ${home} — v${v ?? "?"}+${hashOf2(bytes)}, ДРУГИЕ байты: ${self ? `обнови её из поставки: cp "${fileURLToPath4(import.meta.url)}" ${home}` : "этот файл не читается"}`
  );
}
async function serverReport() {
  out(`сервер: ${CFG.serverUrl}`);
  let res;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: "doctor", method: "ping" }),
      signal: AbortSignal.timeout(1e4)
    });
  } catch (e) {
    out(`  недостижим: ${errorMessage(e)}`);
    return;
  }
  res.body?.cancel?.();
  const www = res.headers.get("www-authenticate");
  const note3 = www ? " (просит OAuth)" : res.status >= 400 && res.status < 500 ? " (пробник без токена — отказ ожидаем)" : "";
  out(`  отвечает: HTTP ${res.status}${note3}`);
  try {
    const meta = await discoverMeta(www);
    out(`  OAuth: token endpoint ${meta.as.token_endpoint}`);
    out(`  resource: ${meta.resource}`);
  } catch (e) {
    out(`  OAuth discovery: ${errorMessage(e)}`);
  }
}
async function patReport() {
  out(`грант: личный токен (PAT) из ${CFG.patSource} — OAuth не используется`);
  let res;
  try {
    res = await fetch(CFG.serverUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${CFG.pat}`
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "doctor",
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "iskron-doctor", version: "1" }
        }
      }),
      signal: AbortSignal.timeout(1e4)
    });
  } catch (e) {
    out(`  проверить не вышло: ${errorMessage(e)}`);
    return;
  }
  res.body?.cancel?.();
  if (res.status === 401) {
    out(
      "  ТОКЕН ОТВЕРГНУТ (HTTP 401) — отозван, истёк или без прав на этот граф: выпусти новый на странице токенов графа"
    );
  } else if (res.ok) out(`  токен принят сервером (HTTP ${res.status})`);
  else out(`  сервер ответил HTTP ${res.status} — не отказ токена, смотри строку «сервер»`);
  const path = storePath();
  if (existsSync5(path)) out(`  хранилище OAuth ${path} есть, но не читается, пока стоит PAT`);
}
function grantReport() {
  const path = storePath();
  out(`грант: ${path}`);
  if (!existsSync5(path)) {
    out("  хранилища нет — мост ещё ни разу не входил на этот сервер");
    return;
  }
  const store = loadStore();
  const t = store.tokens;
  if (!t?.access_token) {
    out("  токенов нет");
  } else {
    const usable = tokenUsable(t);
    const left = t.expires_at ? t.expires_at - now() : null;
    out(
      `  access: ${usable ? "годен" : "не годен"}${left !== null ? ` (${left > 0 ? "истекает через" : "истёк"} ${seconds(Math.abs(left))})` : ""}`
    );
    const hours = refreshHours(t);
    if (!t.refresh_token) out("  refresh: нет");
    else {
      const parts = [];
      if (hours.nbf)
        parts.push(now() < hours.nbf ? `в силе через ${seconds(hours.nbf - now())}` : "в силе");
      if (hours.exp)
        parts.push(
          now() >= hours.exp ? "ИСТЁК — нужен вход" : `истекает через ${seconds(hours.exp - now())}`
        );
      out(`  refresh: есть${parts.length ? ` (${parts.join(", ")})` : ""}`);
    }
  }
  if (store.client?.client_id) out(`  client_id: ${store.client.client_id}`);
  const st = loadGrantState();
  if (st.refused_since)
    out(`  отказ стоит с ${new Date(st.refused_since).toISOString()}: ${st.reason ?? ""}`);
  if (st.snooze_until && Date.now() < st.snooze_until) {
    out(`  вход отложен ещё на ${seconds(st.snooze_until - Date.now())} (человек не завершил)`);
  }
  for (const suffix of [".auth-pending", ".refreshing"]) {
    if (existsSync5(path + suffix)) out(`  замок: ${path + suffix}`);
  }
  const logPath = grantLogPath();
  if (existsSync5(logPath)) {
    const lines = readFileSync9(logPath, "utf8").trim().split("\n").slice(-3);
    out(`  grant.log, последнее:`);
    for (const l of lines) out(`    ${l}`);
  }
}
function latestReport() {
  const latest = readLatest(CFG.authDir);
  if (!latest) {
    out(
      "свежий релиз: мост ещё не спрашивал релизы (спросит через пару секунд после старта сессии; руками — подкоманда update)"
    );
    return;
  }
  const ago = Math.round((Date.now() - latest.checked_at) / 6e4);
  if (!latest.version)
    out(`свежий релиз: не узнан (${latest.error ?? "без причины"}), спрашивал ${ago} мин назад`);
  else if (compareVersions(latest.version, VERSION) > 0)
    out(
      `свежий релиз: v${latest.version} — ЭТОТ ФАЙЛ ОТСТАЛ (v${VERSION}); в дом скачано: ${latest.downloaded.join(", ") || "ничего"}; спрашивал ${ago} мин назад`
    );
  else out(`свежий релиз: v${latest.version}, этот файл не отстал; спрашивал ${ago} мин назад`);
}
function harnessReport() {
  const claude = join10(homedir6(), ".claude.json");
  if (existsSync5(claude)) {
    try {
      const cfg = JSON.parse(readFileSync9(claude, "utf8"));
      const entries = Object.entries(cfg.mcpServers ?? {}).filter(
        ([, v]) => (v.args ?? []).some((a) => /iskron/.test(a))
      );
      if (entries.length) {
        for (const [name, v] of entries) {
          out(`Claude Code: запись «${name}» → ${v.command ?? ""} ${(v.args ?? []).join(" ")}`);
        }
      } else out("Claude Code: в пользовательском конфиге записи моста нет");
    } catch {
      out(`Claude Code: ${claude} не читается`);
    }
  }
  const opencodeDir = join10(homedir6(), ".config", "opencode");
  if (existsSync5(opencodeDir)) {
    const copy = join10(opencodeDir, "plugins", "iskron.js");
    const packaged = join10(dirname2(fileURLToPath4(import.meta.url)), "opencode-plugin.js");
    if (!existsSync5(copy)) {
      out(`OpenCode: плагина нет (${copy}) — его кладёт establish-mcp при подключении`);
    } else if (!existsSync5(packaged)) {
      out(
        `OpenCode: плагин ${copy} стоит; рядом с этим файлом поставки плагина нет, сверить не с чем`
      );
    } else if (readFileSync9(copy).equals(readFileSync9(packaged))) {
      out(`OpenCode: плагин ${copy} — та же сборка, что в поставке`);
    } else {
      out(`OpenCode: плагин ${copy} — ДРУГИЕ байты, обнови из поставки: cp "${packaged}" ${copy}`);
    }
  }
  const codexHome = process.env.CODEX_HOME?.trim() || join10(homedir6(), ".codex");
  const door = join10(codexHome, "app-server-control", "app-server-control.sock");
  if (existsSync5(codexHome)) {
    if (existsSync5(door)) out(`Codex: дверь app-server открыта (${door})`);
    else if (Buffer.byteLength(door) > 100)
      out(
        `Codex: двери нет и не будет — CODEX_HOME длиннее предела unix-сокета (${codexHome}); нужен короткий дом для демона и сессий`
      );
    else
      out(
        `Codex: двери нет (${door}) — демон app-server не поднят; без неё кадр доставляет watchdog-exit`
      );
  }
  const codex = join10(homedir6(), ".codex", "config.toml");
  if (existsSync5(codex)) {
    const text = readFileSync9(codex, "utf8");
    out(`Codex: ${/iskron/.test(text) ? "запись моста есть" : "записи моста нет"} (${codex})`);
  }
}
async function runDoctor(argv2) {
  setConfig(parseArgs(argv2));
  out(`iskron doctor — ${BUILD}`);
  out(`этот файл: ${fileURLToPath4(import.meta.url)}`);
  out(`node: ${process.version}`);
  homeCopyReport();
  latestReport();
  await serverReport();
  if (CFG.pat) await patReport();
  else grantReport();
  harnessReport();
}

// js/cli/update.ts
var out2 = (s) => {
  process.stdout.write(s + "\n");
};
async function runUpdate(argv2) {
  setConfig(parseArgs(argv2));
  out2(`iskron update — ${BUILD}`);
  const latest = await checkLatest(CFG.authDir, true);
  if (!latest || !latest.version) {
    out2(`свежий релиз не узнан: ${latest?.error ?? "нет ответа"} — сеть или GitHub; повтори позже`);
    process.exitCode = 1;
    return;
  }
  const cmp = compareVersions(latest.version, VERSION);
  out2(
    `свежий релиз: v${latest.version} (${latest.tag}); этот файл: v${VERSION}${cmp > 0 ? " — отстал" : cmp < 0 ? " — новее релиза (сборка из ветки)" : " — не отстал"}`
  );
  if (latest.error) out2(`скачать не вышло: ${latest.error}`);
  if (latest.downloaded.length) for (const p of latest.downloaded) out2(`положено: ${p}`);
  else out2(`в дом ничего не клалось: ${homeBridgePath()} не старше релиза`);
  harnessReport();
  out2("");
  out2("Дальше:");
  out2(
    `  1. Скиллы обновляет канал харнеса — порядок в свежем установщике ${setupPathOf(CFG.authDir)}${latest.downloaded.includes(setupPathOf(CFG.authDir)) ? "" : " (не скачан — возьми из релиза)"}: прочти его и исполни шаги обновления для этого харнеса.`
  );
  out2(
    "  2. Перезапусти сессии харнеса: мост, поднятый прежней сборкой, живёт до конца своей сессии."
  );
  out2("  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — сверка, что стоит и работает.");
}

// js/cli/iskron.ts
var USAGE = `iskron ${BUILD}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug]
  node iskron.mjs watchdog [ключ] [--auth-dir <dir>]
  node iskron.mjs watchdog-exit [ключ] [--auth-dir <dir>]
  node iskron.mjs watchdog-codex [ключ] [--auth-dir <dir>]   (из оболочки Codex: CODEX_THREAD_ID, CODEX_HOME)
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs --version
  env: ISKRON_BRIDGE_TOKEN — личный токен вместо OAuth (или файл <auth-dir>/token);
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`;
var argv = process.argv.slice(2);
var [first, ...rest] = argv;
var LONG_LIVED = /* @__PURE__ */ new Set([void 0, "bridge", "watchdog", "watchdog-exit", "watchdog-codex"]);
var longLived = LONG_LIVED.has(first) || first !== void 0 && !first.startsWith("--") && !["doctor", "update", "-h"].includes(first);
if (longLived && !updatesDisabled() && !process.env.ISKRON_BRIDGE_REEXEC) {
  const sync = syncHome();
  for (const p of sync.copied)
    process.stderr.write(`[iskron-bridge] дом обновлён этой сборкой: ${p}
`);
  if (sync.reexec) reexec(sync.reexec, argv);
  else dispatch();
} else dispatch();
function dispatch() {
  switch (first) {
    case "watchdog":
      runWatchdog(rest);
      break;
    case "watchdog-exit":
      runWatchdogExit(rest);
      break;
    case "watchdog-codex":
      runWatchdogCodex(rest);
      break;
    case "doctor":
      void runDoctor(rest);
      break;
    case "update":
      void runUpdate(rest);
      break;
    case "bridge":
      bridgeMain(rest);
      break;
    case "--version":
      process.stdout.write(BUILD + "\n");
      break;
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      break;
    default:
      bridgeMain(argv);
  }
}
