#!/usr/bin/env node

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.8.0";
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
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync3,
  renameSync as renameSync2,
  statSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { join as join2 } from "node:path";

// js/bridge/config.ts
import { mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
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
    const out4 = process.stdout;
    if (!canWrite(out4)) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      out4.off("error", finish);
      out4.off("close", finish);
      resolve();
    };
    out4.once("error", finish);
    out4.once("close", finish);
    if (stdoutBacklog) out4.once("drain", finish);
    else out4.write("", finish);
    setTimeout(finish, FLUSH_STOP_MS).unref();
  });
}

// js/bridge/config.ts
var DEFAULT_SERVER_URL = "https://mcp.iskron.ru/";
var ENGLISH_SERVER_URL = "https://mcp.iskron.ai/";
var PRODUCTION_URLS = new Set([DEFAULT_SERVER_URL, ENGLISH_SERVER_URL].map(strip));
function strip(url) {
  return url.replace(/\/+$/, "");
}
var isProductionServer = (url) => PRODUCTION_URLS.has(strip(url));
function resolveServerChoice(word) {
  const w = word.trim();
  if (/^(ru|russian|русский)$/i.test(w)) return DEFAULT_SERVER_URL;
  if (/^(en|ai|english|английский)$/i.test(w)) return ENGLISH_SERVER_URL;
  try {
    return new URL(w).href;
  } catch {
    return null;
  }
}
var serverChoicePath = (authDir) => join(authDir, "server");
function readServerChoice(authDir) {
  try {
    const text = readFileSync2(serverChoicePath(authDir), "utf8").trim();
    return text ? new URL(text).href : null;
  } catch {
    return null;
  }
}
function writeServerChoice(authDir, url) {
  const path = serverChoicePath(authDir);
  mkdirSync(authDir, { recursive: true, mode: 448 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, url + "\n", { mode: 384 });
  renameSync(tmp, path);
  return path;
}
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
    patSource: null,
    serverSource: "argument"
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
  if (!cfg.serverUrl) {
    const fromEnv = process.env.ISKRON_BRIDGE_URL?.trim();
    const fromFile = fromEnv ? null : readServerChoice(cfg.authDir);
    cfg.serverUrl = fromEnv || fromFile || DEFAULT_SERVER_URL;
    cfg.serverSource = fromEnv ? "ISKRON_BRIDGE_URL" : fromFile ? "file" : "default";
  }
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
  mkdirSync2(CFG.authDir, { recursive: true, mode: 448 });
  const next = {
    ...loadStore(),
    ...patch,
    server_url: CFG.serverUrl,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const tmp = `${storePath()}.tmp-${process.pid}`;
  try {
    writeFileSync2(tmp, JSON.stringify(next, null, 2), { mode: 384 });
    renameSync2(tmp, storePath());
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    throw e;
  }
  return next;
}
function serverCachePath() {
  return storePath() + ".server-answers";
}
function loadServerCache() {
  try {
    return JSON.parse(readFileSync3(serverCachePath(), "utf8"));
  } catch {
    return {};
  }
}
function saveServerCache(patch) {
  try {
    mkdirSync2(CFG.authDir, { recursive: true, mode: 448 });
    const tmp = `${serverCachePath()}.tmp-${process.pid}`;
    writeFileSync2(tmp, JSON.stringify({ ...loadServerCache(), ...patch }), { mode: 384 });
    renameSync2(tmp, serverCachePath());
  } catch {
  }
}
function grantLogPath() {
  return join2(CFG.authDir, "grant.log");
}
function grantLog(msg) {
  appendJournal(grantLogPath(), msg);
}
function appendJournal(path, msg) {
  try {
    mkdirSync2(CFG.authDir, { recursive: true, mode: 448 });
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
    }
    if (size > 128e3) {
      try {
        unlinkSync(path);
      } catch {
      }
    }
    appendFileSync(path, `${(/* @__PURE__ */ new Date()).toISOString()} pid=${process.pid} ${BUILD} ${msg}
`, {
      mode: 384
    });
  } catch {
  }
}
function standingsLogPath() {
  return join2(CFG.authDir, "standings.log");
}
function standingLog(msg) {
  appendJournal(standingsLogPath(), msg);
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
    mkdirSync2(CFG.authDir, { recursive: true, mode: 448 });
    const next = { ...loadGrantState(), ...patch };
    const tmp = `${grantStatePath()}.tmp-${process.pid}`;
    writeFileSync2(tmp, JSON.stringify(next), { mode: 384 });
    renameSync2(tmp, grantStatePath());
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
  // `retryable` marks a network failure worth another knock from the bridge
  // itself: a connection that failed outright. A timeout is not — it already
  // spent the whole deadline, and repeating it multiplies the wait.
  retryable;
  constructor(message, kind, presented = null, outcome = UNKNOWN, retryable = false) {
    super(message);
    this.kind = kind;
    this.presented = presented;
    this.outcome = outcome;
    this.retryable = retryable;
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
var TokenRefused = class extends Error {
};
var AuthPending = class extends Error {
  authorizeUrl;
  constructor(url, note3) {
    super(
      `authorization required — open in a browser: ${url}${note3 ? ` (${note3})` : ""} — or give the bridge a personal access token instead (ISKRON_BRIDGE_TOKEN, or the file <auth-dir>/token)`
    );
    this.authorizeUrl = url;
  }
};
var HoldOffError = class extends Error {
  // retryNow marks the one flavor where an immediate retry is the honest move:
  // the FIRST early refusal of a needed refresh. The cooldown refusal and a
  // refusal that repeats both name waits that are real.
  retryNow;
  // When the hold ends, on the server-corrected clock — the refresh token's own
  // hour; null when nobody knows. A caller sits out a short one inside the call
  // and answers a long one with the login.
  until;
  constructor(message, retryNow = false, until = null) {
    super(message);
    this.retryNow = retryNow;
    this.until = until;
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
import {
  mkdirSync as mkdirSync3,
  readdirSync,
  readFileSync as readFileSync4,
  renameSync as renameSync3,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync3
} from "node:fs";
import { connect } from "node:net";
import { basename, dirname, join as join4 } from "node:path";
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
    return JSON.parse(readFileSync4(authLockPath(), "utf8"));
  } catch {
    return null;
  }
}
function writeAuthLock(fields) {
  mkdirSync3(CFG.authDir, { recursive: true, mode: 448 });
  const tmp = `${authLockPath()}.tmp-${process.pid}`;
  const body = JSON.stringify({
    ...fields,
    pid: fields.pid ?? process.pid,
    started_at: fields.started_at ?? Date.now()
  });
  try {
    writeFileSync3(tmp, body, { mode: 384 });
    renameSync3(tmp, authLockPath());
  } catch {
    try {
      unlinkSync2(tmp);
    } catch {
    }
    writeFileSync3(authLockPath(), body, { mode: 384 });
  }
}
function releaseAuthLock(owns) {
  try {
    const l = readAuthLock();
    if (owns && (!l || !owns(l))) return;
    unlinkSync2(authLockPath());
  } catch {
  }
}
var tabMarkPath = (state2) => `${authLockPath()}.tab-${state2}`;
function claimTab(state2) {
  try {
    mkdirSync3(CFG.authDir, { recursive: true, mode: 448 });
    writeFileSync3(tabMarkPath(state2), "", { flag: "wx", mode: 384 });
    return true;
  } catch {
    return false;
  }
}
function sweepTabMarks() {
  const prefix = `${basename(authLockPath())}.tab-`;
  try {
    for (const f of readdirSync(dirname(authLockPath()))) {
      if (f.startsWith(prefix)) unlinkSync2(join4(dirname(authLockPath()), f));
    }
  } catch {
  }
}
function installAuthLockExitHook() {
  process.on("exit", () => {
    try {
      const l = JSON.parse(readFileSync4(authLockPath(), "utf8"));
      if (l.pid === process.pid && !l.authorize_url) unlinkSync2(authLockPath());
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
    let mint = null;
    let loginKey = "";
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
      if (u.pathname === "/login" && mint && loginKey && u.searchParams.get("k") === loginKey) {
        mint().then(
          (to) => {
            res.writeHead(302, { location: to, "cache-control": "no-store" });
            res.end();
          },
          (e) => {
            res.writeHead(502, { "content-type": "text/html; charset=utf-8" });
            res.end(
              `<h3>iskron-bridge: the sign-in page could not be reached (${esc(errorMessage(e))}) — reload this page.</h3>`
            );
          }
        );
        return;
      }
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
        serveLogin: (key, fn) => {
          loginKey = key;
          mint = fn;
        },
        // No deadline by default: the login lives as long as the bridge holding
        // it, so a human who comes back to the tab late still lands it (graph
        // nks-dev: #4721). A bridge left by its harness bounds the wait itself.
        waitForCode: (expectedState, timeoutMs = 0) => new Promise((res, rej) => {
          const timer3 = timeoutMs > 0 ? setTimeout(
            () => rej(new Error("timed out waiting for the browser authorization")),
            timeoutMs
          ) : null;
          const settle = (v) => {
            if (v.state !== expectedState) {
              tellBrowser(
                "iskron-bridge: this page belongs to a login that is over — open the link the agent gave you."
              );
              return false;
            }
            if (timer3) clearTimeout(timer3);
            handOff = null;
            if (v.err) rej(new Error(`authorization refused: ${v.err}`));
            else if (!v.code) rej(new Error("callback missing code"));
            else res(v.code);
            return true;
          };
          if (received && settle(received)) return;
          received = null;
          handOff = settle;
        })
      });
    });
  });
}

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
    ...tokenSchedule(body, refresh),
    ...params.client_id ? { client_id: params.client_id } : {}
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
var CLAIM_WAIT_MS = Number(process.env.ISKRON_BRIDGE_CLAIM_WAIT_MS) || 15e3;
var CLAIM_GLANCE_MS = 1e3;
var LANDED_POLL_MS = Number(process.env.ISKRON_BRIDGE_LANDED_POLL_MS) || 2e3;
var RELEASE_GAP_MS = Number(process.env.ISKRON_BRIDGE_RELEASE_GAP_MS) || 0;
var flows = /* @__PURE__ */ new Set();
function pendingFlow() {
  return flows.size ? Promise.allSettled([...flows]).then(() => {
  }) : null;
}
var loginLink = (port, key) => `http://127.0.0.1:${port}/login?k=${key}`;
var linkPrefix = (port) => `http://127.0.0.1:${port}/login?k=`;
var redirectFor = (port) => `http://127.0.0.1:${port}/callback`;
var grantPrint = (t) => {
  const both = [t?.refresh_token, t?.access_token].filter(Boolean).join("|");
  return both ? b64url(sha256(both)).slice(0, 16) : "";
};
var grantBack = (judged) => {
  const now2 = loadStore().tokens;
  return now2?.access_token && grantPrint(now2) !== judged ? now2 : null;
};
function published(l) {
  if (!l?.authorize_url || !l.state || !l.verifier) return false;
  if (!l.authorize_url.startsWith(linkPrefix(l.callback_port))) return false;
  return l.grant === void 0 || grantPrint(loadStore().tokens) === l.grant;
}
function older(l) {
  return !!l?.authorize_url && !l.state;
}
function loginPublished() {
  return published(readAuthLock());
}
function openTabOnce(l) {
  if (!CFG.noBrowser && claimTab(l.state)) openBrowser(l.authorize_url);
}
function showTab(l) {
  const current = readAuthLock();
  if (!published(current)) return l;
  openTabOnce(current);
  return current;
}
function handOut(l, wantTab) {
  return wantTab && published(l) ? showTab(l) : l;
}
async function mootFreed(port) {
  const l = readAuthLock();
  if (!l || l.callback_port !== port || !l.state || published(l) || !pidAlive(l.pid)) return;
  const deadline = Date.now() + LANDED_POLL_MS * 2 + 1e3;
  while (Date.now() < deadline && await portListening(port)) await sleep(100);
}
async function bindOrNull(port) {
  try {
    return await bindCallback(port);
  } catch (e) {
    if (errorCode(e) !== "EADDRINUSE") throw e;
    return null;
  }
}
async function linkOn(port) {
  const glance = Date.now() + CLAIM_GLANCE_MS;
  const deadline = Date.now() + CLAIM_WAIT_MS;
  for (; ; ) {
    const l = readAuthLock();
    const ours = !!l && l.callback_port === port && pidAlive(l.pid);
    if (ours && (published(l) || older(l))) return l;
    const claimed = ours && !l?.authorize_url;
    if (!claimed && Date.now() > glance || Date.now() > deadline) return null;
    await sleep(100);
  }
}
async function interactiveFlow(meta, judged, note3, wantTab = true) {
  const over = grantPrint(judged);
  const back = grantBack(over);
  if (back) return back;
  const standing = readAuthLock();
  if ((published(standing) || older(standing)) && pidAlive(standing.pid) && await portListening(standing.callback_port)) {
    debug(`joining the login held by pid ${standing.pid}`);
    throw new AuthPending(handOut(standing, wantTab).authorize_url, note3);
  }
  let callback = null;
  if (published(standing)) {
    const cb = await bindOrNull(standing.callback_port);
    const still = cb ? readAuthLock() : null;
    if (cb && published(still) && still.state === standing.state) {
      try {
        writeAuthLock({ ...still, pid: process.pid });
      } catch (e) {
        cb.close();
        throw e;
      }
      log(
        "the bridge that published this login is gone — listening on its link, so the tab the human has still lands"
      );
      grantLog("authorization flow taken over on the same link — waiting for the human");
      runFlow(meta, cb, still, wantTab);
      throw new AuthPending(still.authorize_url, note3);
    }
    if (cb && published(still)) {
      cb.close();
      return interactiveFlow(meta, judged, note3, wantTab);
    }
    callback = cb;
  }
  if (published(standing) && !callback) {
    const taken = readAuthLock();
    if (published(taken) && taken.state === standing.state && pidAlive(taken.pid) && await portListening(taken.callback_port)) {
      throw new AuthPending(handOut(taken, wantTab).authorize_url, note3);
    }
    debug(
      `the published login's port ${standing.callback_port} is held by a foreign process — its link can land nowhere; publishing a new login`
    );
  } else if (standing && !standing.authorize_url && pidAlive(standing.pid) && await portListening(standing.callback_port)) {
    const found = await linkOn(standing.callback_port);
    if (found) throw new AuthPending(handOut(found, wantTab).authorize_url, note3);
  }
  for (let rung = 0; rung < CALLBACK_PORT_RUNGS && !callback; rung++) {
    callback = await bindOrNull(callbackPort(rung));
    if (callback) break;
    const found = await linkOn(callbackPort(rung));
    if (found) throw new AuthPending(handOut(found, wantTab).authorize_url, note3);
    await mootFreed(callbackPort(rung));
    callback = await bindOrNull(callbackPort(rung));
    if (callback) break;
    debug(
      `callback port ${callbackPort(rung)} is held by a foreign process — trying the next rung`
    );
  }
  if (!callback) {
    const rungs = Array.from({ length: CALLBACK_PORT_RUNGS }, (_, k) => callbackPort(k)).join(", ");
    throw new Error(
      `all candidate callback ports (${rungs}) are held by other processes — free one, then retry`
    );
  }
  const landed = grantBack(over);
  if (landed) {
    callback.close();
    return landed;
  }
  let started = false;
  try {
    const login = {
      pid: process.pid,
      started_at: Date.now(),
      callback_port: callback.port,
      authorize_url: loginLink(callback.port, b64url(randomBytes(18))),
      state: b64url(randomBytes(24)),
      verifier: b64url(randomBytes(48)),
      grant: over
    };
    sweepTabMarks();
    writeAuthLock(login);
    grantLog("authorization flow published — waiting for the human");
    runFlow(meta, callback, login, wantTab);
    started = true;
    throw new AuthPending(login.authorize_url, note3);
  } catch (e) {
    if (!started) {
      callback.close();
      releaseAuthLock((l) => l.pid === process.pid);
    }
    throw e;
  }
}
function runFlow(meta, cb, login, openTab) {
  const ours = (l) => l.pid === process.pid && l.state === login.state;
  const redirectUri = redirectFor(login.callback_port);
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
  let watch;
  const cameBack = new Promise((_, reject) => {
    watch = setInterval(() => {
      if (login.grant !== void 0 && grantPrint(loadStore().tokens) !== login.grant) {
        reject(new Error("the grant came back by itself — this login is no longer needed"));
      }
    }, LANDED_POLL_MS);
    watch.unref?.();
  });
  cameBack.catch(() => {
  });
  let flow = null;
  flow = (async () => {
    try {
      const codePromise = cb.waitForCode(login.state);
      if (openTab) openTabOnce(login);
      const code = await Promise.race([codePromise, cameBack]);
      const record = readAuthLock();
      const clientId = (record?.state === login.state ? record.client_id : void 0) || CFG.staticClientId || loadStore().client?.client_id || "";
      log("authorization code received — exchanging for tokens");
      await tokenRequest(meta, {
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: login.verifier,
        resource: meta.resource
      });
      releaseAuthLock(ours);
      log("authorization complete — tokens saved for every local agent");
      grantLog("authorization complete");
      cb.report(null);
    } catch (e) {
      const message = errorMessage(e);
      cb.report(message);
      log(`authorization flow failed: ${message}`);
      grantLog(
        `authorization not completed (${message}) — the next call that needs the graph offers a new login`
      );
    } finally {
      clearInterval(watch);
      releaseAuthLock(ours);
      if (RELEASE_GAP_MS) await sleep(RELEASE_GAP_MS);
      cb.close();
      if (flow) flows.delete(flow);
    }
  })();
  flows.add(flow);
}

// js/bridge/oauth/pacing.ts
var pauses = (v, fallback) => (v || fallback).split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
var DEAD_RECHECK_MS = pauses(process.env.ISKRON_BRIDGE_DEAD_RECHECK_MS, "1000,2000");
var IN_CALL_WAIT_MS = Number(process.env.ISKRON_BRIDGE_IN_CALL_WAIT_MS) || 1e4;

// js/bridge/oauth/refreshlock.ts
import { linkSync, mkdirSync as mkdirSync4, readFileSync as readFileSync5, unlinkSync as unlinkSync3, writeFileSync as writeFileSync4 } from "node:fs";
var REFRESH_LOCK_STALE_MS = 45e3;
function refreshLockPath() {
  return storePath() + ".refreshing";
}
function acquireRefreshLock() {
  const claim = () => {
    const tmp = `${refreshLockPath()}.${process.pid}`;
    writeFileSync4(tmp, JSON.stringify({ pid: process.pid, started_at: Date.now() }), {
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
    mkdirSync4(CFG.authDir, { recursive: true, mode: 448 });
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
      `the token endpoint refused this grant as too early moments ago — not knocking again for ${left}s; grant kept, will retry`,
      false,
      hours.nbf
    );
  }
  const clientId = CFG.staticClientId || cur.client_id || loadStore().client?.client_id || "";
  debug("refreshing access token");
  try {
    return await tokenRequest(meta, {
      grant_type: "refresh_token",
      refresh_token: cur.refresh_token ?? "",
      client_id: clientId,
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
      dropRegistration(clientId);
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
        !!notYet && !repeated,
        notYet ? hours.nbf : null
      );
    }
    if (loadStore().tokens?.refresh_token !== cur.refresh_token) {
      debug("our refresh token was already rotated by a sibling — retrying with the stored one");
      return null;
    }
    if (e instanceof TokenError && e.oauthError === "invalid_client") {
      log("the server no longer knows this client — dropping the registration");
      grantLog("server no longer knows this client — registration dropped");
      dropRegistration(clientId);
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
function dropRegistration(clientId) {
  if (clientId && loadStore().client?.client_id === clientId) saveStore({ client: null });
}
function noteRefusal(reason) {
  const local = Date.now();
  const first2 = !loadGrantState().refused_since;
  saveGrantState({ refused_at: local, ...first2 ? { refused_since: local, reason } : {} });
  if (first2) grantLog(`grant refused: ${reason}`);
}
function refusalStands() {
  const at2 = loadGrantState().refused_at;
  return !!at2 && Date.now() - at2 < REFUSED_KNOCK_MS;
}

// js/bridge/auth.ts
var authInFlight = null;
function heldNote(until) {
  if (until === null) return "the grant itself is whole";
  const minutes = Math.max(1, Math.round((until - now()) / 6e4));
  return `the grant itself is whole and comes back on its own in about ${minutes} min`;
}
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
      if (interactive && s.tokens?.refresh_token && loginPublished() && refusalStands()) {
        const landed = usableTokens({ rejected });
        if (landed) return landed;
        return await interactiveFlow(meta, s.tokens);
      }
      if (s.tokens?.refresh_token) {
        let rechecks = 0;
        let waited = 0;
        for (; ; ) {
          try {
            return await refreshShared(meta, rejected, proactive, interactive);
          } catch (e) {
            if (!interactive) {
              if (e instanceof DeadGrantError) {
                throw new Error(
                  "authorization required (refresh grant dead, browser flow deferred)",
                  { cause: e }
                );
              }
              throw e;
            }
            if (e instanceof HoldOffError) {
              if (e.retryNow) throw e;
              const left = e.until === null ? Infinity : e.until - now();
              if (left + waited <= IN_CALL_WAIT_MS) {
                const pause = Math.max(left, 0) + 100;
                waited += pause;
                debug(`${e.message} — sitting it out inside the call (${pause}ms)`);
                await sleep(pause);
                continue;
              }
              log(`${e.message} — offering the login beside the wait`);
              return await interactiveFlow(meta, s.tokens, heldNote(e.until), false);
            }
            if (e instanceof DeadGrantError) {
              if (!e.expired && rechecks < DEAD_RECHECK_MS.length && !loginPublished()) {
                const pause = DEAD_RECHECK_MS[rechecks++] ?? 0;
                debug(`refresh refused (${e.message}) — knocking again in ${pause}ms`);
                await sleep(pause);
                continue;
              }
              log(`refresh grant is dead (${e.message}) — starting a fresh authorization`);
              return await interactiveFlow(meta, s.tokens);
            }
            throw e;
          }
        }
      }
      if (!interactive)
        throw new Error(
          "authorization required (no tokens, browser flow deferred) — or give the bridge a personal access token (ISKRON_BRIDGE_TOKEN, or the file <auth-dir>/token)"
        );
      return await interactiveFlow(meta, s.tokens);
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

// js/shared/clients.ts
var OPENCODE_CLIENT = "opencode-iskron";
var SURFACE_CLIENT = "export-surface";
var OWN_CLIENTS = /* @__PURE__ */ new Set([OPENCODE_CLIENT, SURFACE_CLIENT]);
var PI_CLIENT = "pi-iskron";
var NOTIFIED_CLIENTS = /* @__PURE__ */ new Set([PI_CLIENT, OPENCODE_CLIENT]);

// js/shared/channel.ts
var DEAD_TOKEN_CODES = [4001, 4002];
var EVICTED_CODE = 4e3;
var EVICTION_WINDOW_MS = 6e4;
var ROLLOUT_CODE = 4003;
var FAST_DROP_MS = 5e3;
var ERROR_GUESS_DELAY_MS = 500;
var FLAP_PAUSES_MS = (process.env.ISKRON_CHANNEL_FLAP_MS || "5000,10000,20000,40000,60000").split(",").map(Number).filter((n) => Number.isFinite(n) && n > 0);
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
  let slowdown = 0;
  let dead = false;
  let stopped = false;
  let lastEviction = null;
  let retry = null;
  let ws = null;
  function open() {
    if (stopped) return;
    const startedAt = Date.now();
    const sock = new WebSocket(o.url);
    ws = sock;
    let gone = false;
    let opened = false;
    sock.addEventListener("open", () => {
      opened = true;
    });
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
    function yieldTo(cb, code) {
      if (dead) return;
      dead = true;
      stopped = true;
      if (retry) clearTimeout(retry);
      cb(code);
    }
    async function dropped(code) {
      if (stopped || ws !== sock) return;
      if (DEAD_TOKEN_CODES.includes(code)) return yieldTo(o.onDeadToken, code);
      const now2 = Date.now();
      const afterEviction = lastEviction !== null && now2 - lastEviction < EVICTION_WINDOW_MS;
      if (afterEviction && code === EVICTED_CODE)
        return yieldTo(o.onEvicted ?? o.onDeadToken, code);
      if (code === EVICTED_CODE) {
        lastEviction = now2;
        if (gone) return;
        gone = true;
        o.onNote?.("закрытие 4000 — место у другого держателя; открываю заново один раз");
        retry = setTimeout(open, 2e3);
        return;
      }
      if (gone) return;
      if (afterEviction && !opened && code !== ROLLOUT_CODE && now2 - startedAt < FAST_DROP_MS) {
        gone = true;
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) return yieldTo(o.onEvicted ?? o.onDeadToken, EVICTED_CODE);
        retry = setTimeout(open, 2e3);
        return;
      }
      gone = true;
      const fast = Date.now() - startedAt < FAST_DROP_MS;
      fastDrops = fast ? fastDrops + 1 : 0;
      if (!fast) slowdown = 0;
      if (fastDrops >= 3) {
        const up = await serviceUp(o.url);
        if (stopped || ws !== sock) return;
        if (up) {
          if (slowdown === 0) o.onServiceAlive(String(up.version ?? ""));
          const wait = FLAP_PAUSES_MS[Math.min(slowdown, FLAP_PAUSES_MS.length - 1)] ?? 6e4;
          slowdown++;
          fastDrops = 2;
          retry = setTimeout(open, wait);
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

// js/bridge/hold.ts
import { chmodSync, mkdirSync as mkdirSync5, unlinkSync as unlinkSync6, writeFileSync as writeFileSync7 } from "node:fs";
import { createServer as createServer2 } from "node:net";

// js/shared/seen.ts
import { appendFileSync as appendFileSync2, readFileSync as readFileSync6, writeFileSync as writeFileSync5 } from "node:fs";
var SEEN_KEEP = 200;
function seenIds(seenPath) {
  try {
    return new Set(readFileSync6(seenPath, "utf8").split("\n").filter(Boolean));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function noteSeen(seenPath, id, seen2) {
  if (seen2.has(id)) return;
  seen2.add(id);
  try {
    if (seen2.size > SEEN_KEEP) {
      writeFileSync5(seenPath, [...seen2].slice(-SEEN_KEEP).join("\n") + "\n");
    } else appendFileSync2(seenPath, id + "\n");
  } catch {
  }
}

// js/shared/standings.ts
import { createHash as createHash3 } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import { join as join5 } from "node:path";
var defaultAuthDir = () => join5(homedir2(), ".iskron-bridge");
var authDirFromEnv = () => process.env.ISKRON_BRIDGE_AUTH_DIR?.trim() || defaultAuthDir();
var standingsDirOf = (authDir) => join5(authDir, "standings");
var hashOf = (key) => createHash3("sha256").update(key).digest("hex").slice(0, 16);
function socketPathOf(authDir, key) {
  if (process.platform === "win32") return `\\\\.\\pipe\\iskron-${hashOf(key)}`;
  return join5(standingsDirOf(authDir), `${hashOf(key)}.sock`);
}
var keyFilePathOf = (authDir, key) => join5(standingsDirOf(authDir), `${hashOf(key)}.key`);
var holdFilePathOf = (authDir, key) => join5(standingsDirOf(authDir), `${hashOf(key)}.hold`);
var seenFilePathOf = (authDir, key) => join5(standingsDirOf(authDir), `${hashOf(key)}.seen`);

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
  const body = typeof frame2.body === "string" ? frame2.body : frame2.body === void 0 ? raw : JSON.stringify(frame2.body, null, 1).replace(/\n\s*/g, " ");
  return `${lines.join("\n")}

${body}`;
}

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;
var BACKLOG_KEEP = 20;
var BODY_CAP = 800;
var frames = [];
var total = 0;
var pending = 0;
var timer = null;
var flush = null;
function openBacklog(expected, emit2) {
  pending = Math.max(pending, expected);
  flush = emit2;
  if (timer) return;
  timer = setTimeout(close, BACKLOG_MS).unref();
}
function flushBacklogNow() {
  if (!timer) return;
  clearTimeout(timer);
  close();
}
function noteBacklog(frame2) {
  if (!timer) return false;
  total++;
  if (frames.length < BACKLOG_KEEP) frames.push(frame2);
  return true;
}
var at = (f) => typeof f.received_at === "string" ? f.received_at : "";
function close() {
  timer = null;
  const got = frames.splice(0).sort((a, b) => at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0);
  const count = total;
  const expected = pending;
  total = 0;
  pending = 0;
  const emit2 = flush;
  flush = null;
  if (!got.length || !emit2) return;
  const bodies = got.map((f) => {
    const t = frameToText(f, JSON.stringify(f));
    return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
  });
  const head = `Побудка: кадров ${count}` + (expected ? ` (ожидало в очереди: ${expected})` : "") + (count > got.length ? `, здесь первые ${got.length}` : "") + ' — пришли одной пачкой; разбери все, а не последний: полностью и остальное — iskron_channel(action="history", view="log").';
  emit2({
    kind: "backlog",
    frames: got,
    pending: expected,
    text: `${head}

${bodies.join("\n\n")}`
  });
}

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
var TLS_REFUSALS = /* @__PURE__ */ new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "ERR_TLS_CERT_ALTNAME_INVALID"
]);
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
    const timedOut = err.name === "TimeoutError";
    const code = errorCode(e);
    const message = errorMessage(e);
    const tls = TLS_REFUSALS.has(code ?? "");
    const reason = timedOut ? `no answer within ${CFG.timeoutMs}ms` : (code && !message.includes(code) ? `${message} (${code})` : message) + (tls ? " — the server's certificate is not trusted on this machine (a corporate TLS inspection?); give the bridge the organisation's CA in NODE_EXTRA_CA_CERTS" : "");
    const neverLeft = !timedOut && (tls || [
      "ECONNREFUSED",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ERR_SOCKET_BAD_PORT",
      "ConnectionRefused"
    ].includes(code ?? ""));
    throw new UpstreamError(
      `upstream unreachable: ${reason}`,
      "network",
      null,
      neverLeft ? UpstreamError.NOT_SENT : UpstreamError.UNKNOWN,
      !timedOut && !tls
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
      throw new UpstreamError(
        `upstream stream broke mid-response: ${errorMessage(e)}`,
        "network",
        null,
        UpstreamError.UNKNOWN,
        true
      );
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

// js/bridge/client.ts
function harnessName() {
  const info = state.initParams?.clientInfo;
  return typeof info?.name === "string" ? info.name : "";
}
var notifiedClient = () => NOTIFIED_CLIENTS.has(harnessName());

// js/bridge/standing.ts
function noteStanding(msg, reply2) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "register") return;
  if (reply2?.error || reply2?.result?.isError) return;
  state.standing = { realm: a.realm, karta: String(a.karta).replace(/^#/, ""), name: a.name };
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
      let reply2 = null;
      await post(
        {
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "iskron_channel", arguments: { ...state.standing, action: "register" } }
        },
        (m) => {
          if (m.id === id) reply2 = m;
        }
      );
      const got = reply2;
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
var replyText = (reply2) => {
  if (!reply2) return "";
  if (reply2.error) return JSON.stringify(reply2.error);
  const content = reply2.result?.content;
  return Array.isArray(content) ? content.map((c) => c?.text ?? "").join("\n") : JSON.stringify(reply2.result ?? "");
};
var seatIsGone = (reply2) => /no such standing|take it with connect|такого стояния|занять.*connect/i.test(replyText(reply2));
var UNATTRIBUTED_CODE = /write_unattributed\w*|session_not_registered/;
var UNATTRIBUTED_REFUSAL = /\b409\b|не зарегистрирован[аоы]? ни за каким стоянием|hold no registered standing/i;
var isUnattributed = (reply2) => {
  if (!reply2) return false;
  const text = replyText(reply2);
  if (UNATTRIBUTED_CODE.test(text)) return true;
  return !!reply2.result?.isError && UNATTRIBUTED_REFUSAL.test(text);
};

// js/bridge/complete.ts
var readCounter = 0;
async function completeFrame(frame2) {
  if (!frame2 || typeof frame2.body !== "string" || typeof frame2.body_chars !== "number")
    return frame2;
  if (!frame2.id || [...frame2.body].length >= frame2.body_chars) return frame2;
  const realm = state.standing?.realm;
  if (!realm) return { ...frame2, body_read: "truncated: стояние без realm, дочитать нечем" };
  const id = `iskron-bridge-read-${++readCounter}`;
  let reply2 = null;
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
        if (m.id === id) reply2 = m;
      }
    );
  } catch (e) {
    log(`кадр ${frame2.id} обрезан, дочитать не вышло: ${e.message}`);
    return { ...frame2, body_read: `truncated: ${e.message}` };
  }
  const text = replyText(reply2);
  const nl = text.indexOf("\n");
  const tail = text.indexOf("\nПровенанс, как платформа");
  if (nl < 0 || reply2?.result?.isError) {
    return { ...frame2, body_read: `truncated: ${text.slice(0, 160)}` };
  }
  const body = (tail > nl ? text.slice(nl + 1, tail) : text.slice(nl + 1)).trim();
  return { ...frame2, body, body_read: "history" };
}
function stampOrigin(frame2) {
  if (!frame2 || frame2.type !== "message") return frame2;
  return { ...frame2, origin: classifyOrigin(frame2, state.standing?.karta) };
}

// js/bridge/holdrecord.ts
import { readFileSync as readFileSync7, unlinkSync as unlinkSync4, writeFileSync as writeFileSync6 } from "node:fs";
var holdFilePathFor = (key) => holdFilePathOf(CFG.authDir, key);
function keyOf(realm, karta, name) {
  return `${name || "_"}--${karta}--${realm}`.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;
function writeHoldRecord(key, rec) {
  try {
    writeFileSync6(holdFilePathFor(key), JSON.stringify({ ...rec, at: Date.now() }) + "\n", {
      mode: 384
    });
  } catch (e) {
    log(`hold record not written: ${e.message}`);
  }
}
function readHoldRecord(key) {
  try {
    const r = JSON.parse(readFileSync7(holdFilePathFor(key), "utf8"));
    if (!r || typeof r.url !== "string" || !r.realm || r.karta == null) return null;
    if (typeof r.at !== "number" || Date.now() - r.at > HOLD_RECORD_MAX_AGE_MS) {
      dropHoldRecord(key);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}
function dropHoldRecord(key) {
  try {
    unlinkSync4(holdFilePathFor(key));
  } catch {
  }
}

// js/bridge/stale.ts
var STALE_BURST_KEEP = 20;
var STALE_BURST_MS = 1500;
var BODY_CAP2 = 800;
var burst = [];
var timer2 = null;
function noteStale(frame2, flush2) {
  if (burst.length < STALE_BURST_KEEP) burst.push(frame2);
  if (timer2) return;
  timer2 = setTimeout(() => {
    timer2 = null;
    const frames2 = burst.splice(0);
    const bodies = frames2.map((f) => {
      const t = frameToText(f, JSON.stringify(f));
      return [...t].length > BODY_CAP2 ? [...t].slice(0, BODY_CAP2).join("") + "…" : t;
    });
    flush2({
      kind: "stale",
      frames: frames2,
      text: `Лежалых кадров: ${frames2.length} — принятое, пока место не слушали, или повтор службы после пересборки сессии; хода не стоят, но прочти; полностью — iskron_channel(action="history").

` + bodies.join("\n\n")
    });
  }, STALE_BURST_MS).unref();
}
function dropStale() {
  burst.length = 0;
  if (timer2) clearTimeout(timer2);
  timer2 = null;
}

// js/bridge/sweep.ts
import { existsSync, readdirSync as readdirSync2, readFileSync as readFileSync8, unlinkSync as unlinkSync5 } from "node:fs";
import { connect as connectLocal } from "node:net";
import { join as join6 } from "node:path";
function localSocketAlive(sock) {
  return new Promise((resolve) => {
    if (process.platform !== "win32" && !existsSync(sock)) return resolve(false);
    const probe = connectLocal(sock);
    const done = (v) => {
      probe.destroy();
      resolve(v);
    };
    probe.once("connect", () => done(true));
    probe.once("error", () => done(false));
    probe.setTimeout(1e3, () => done(false));
  });
}
function sweepStale(authDir, mine) {
  const dir = standingsDirOf(authDir);
  if (!existsSync(dir)) return;
  for (const f of readdirSync2(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync8(join6(dir, f), "utf8"));
      if (typeof rec.at !== "number" || Date.now() - rec.at > HOLD_RECORD_MAX_AGE_MS)
        unlinkSync5(join6(dir, f));
    } catch {
      try {
        unlinkSync5(join6(dir, f));
      } catch {
      }
    }
  }
  if (process.platform === "win32") return;
  for (const f of readdirSync2(dir).filter((x) => x.endsWith(".key"))) {
    const keyFile = join6(dir, f);
    let key;
    try {
      key = readFileSync8(keyFile, "utf8").trim();
    } catch {
      continue;
    }
    if (!key || key === mine) continue;
    const sock = socketPathOf(authDir, key);
    const drop = () => {
      for (const p of [keyFile, sock, seenFilePathOf(authDir, key)]) {
        try {
          unlinkSync5(p);
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

// js/bridge/hold.ts
var RING = 20;
function standingsDir() {
  return standingsDirOf(CFG.authDir);
}
function keyFor() {
  const s = state.standing;
  return s ? keyOf(s.realm, s.karta, s.name ?? "") : "env";
}
var socketPathFor = (key) => socketPathOf(CFG.authDir, key);
var keyFilePathFor = (key) => keyFilePathOf(CFG.authDir, key);
function keptRecordStatus(key) {
  return readHoldRecord(key)?.status;
}
var standCwd = null;
function noteStandCwd(cwd) {
  const prev = standCwd;
  standCwd = cwd;
  if (cwd && currentKey && currentUrl) rememberStatus(readHoldRecord(currentKey)?.status ?? "");
  return prev;
}
function rememberStatus(text) {
  const s = state.standing;
  if (!s || !currentKey || !currentUrl) return;
  writeHoldRecord(currentKey, {
    realm: s.realm,
    karta: s.karta,
    name: s.name ?? "",
    url: currentUrl,
    statusUrl: currentStatusUrl,
    status: text || void 0,
    cwd: standCwd ?? readHoldRecord(currentKey)?.cwd,
    client: harnessName(),
    key: currentKey
  });
}
var holdsKey = (key) => !!holder?.alive && currentKey === key;
var ledKey = () => currentKey;
var localSocketPathOf = (key) => socketPathFor(key);
function noteResuming(delta) {
  resuming += delta;
}
var holder = null;
var server = null;
var currentKey = null;
var currentUrl = null;
var currentStatusUrl = null;
var evictedKey = null;
var evictedEvent = null;
var clients = /* @__PURE__ */ new Set();
var parked = false;
var listenerIdleAt = null;
var attachHooks = [];
var ring = [];
var helloWaiters = /* @__PURE__ */ new Set();
var seen = /* @__PURE__ */ new Set();
function isOwn(realm, karta, name) {
  const s = state.standing;
  return !!s && s.realm === realm && String(s.karta) === String(karta) && (s.name ?? "") === name && currentKey === keyFor();
}
function holdsStanding(realm, karta, name) {
  return !!holder?.alive && isOwn(realm, karta, name);
}
function wasEvicted(realm, karta, name) {
  return !!evictedKey && evictedKey === currentKey && isOwn(realm, karta, name);
}
var hasStatusAddressFor = (realm, karta, name) => !!currentStatusUrl && !!currentKey && isOwn(realm, karta, name);
var statusAddress = () => currentStatusUrl && currentKey ? { url: currentStatusUrl, key: currentKey } : null;
var isParked = (realm, karta, name) => parked && isOwn(realm, karta, name);
var listenerIdleSince = () => holder?.alive && clients.size === 0 ? listenerIdleAt : null;
function onListenerAttached(fn) {
  attachHooks.push(fn);
}
var localListeners = () => clients.size;
var resuming = 0;
function awaitHello(timeoutMs) {
  const seen2 = ring.find((r) => r.frame?.type === "hello")?.frame ?? null;
  if (seen2) return Promise.resolve(seen2);
  return new Promise((resolve) => {
    const done = (f) => {
      helloWaiters.delete(done);
      resolve(f);
    };
    helloWaiters.add(done);
    setTimeout(() => done(null), timeoutMs).unref();
  });
}
var heldKey = () => currentKey;
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
function openLocalServer(key) {
  const path = socketPathFor(key);
  mkdirSync5(standingsDir(), { recursive: true, mode: 448 });
  sweepStale(CFG.authDir, key);
  writeFileSync7(keyFilePathFor(key), key + "\n", { mode: 384 });
  if (process.platform !== "win32") {
    try {
      unlinkSync6(path);
    } catch {
    }
  }
  const gone = (sock) => {
    clients.delete(sock);
    if (clients.size === 0) listenerIdleAt = Date.now();
  };
  const srv = createServer2((sock) => {
    clients.add(sock);
    listenerIdleAt = null;
    sock.on("close", () => gone(sock));
    sock.on("error", () => gone(sock));
    for (const fn of attachHooks) fn();
    const backlog = ring.filter(
      ({ frame: frame2 }) => frame2?.type === "hello" || !(frame2?.type === "message" && typeof frame2.id === "string" && seen.has(frame2.id))
    );
    sock.write(
      JSON.stringify({ kind: "attached", key, buffered: backlog.length }) + "\n"
    );
    for (const { raw, frame: frame2 } of backlog) {
      sock.write(JSON.stringify({ kind: "frame", raw, frame: frame2 }) + "\n");
    }
    if (evictedEvent && evictedKey === key) sock.write(JSON.stringify(evictedEvent) + "\n");
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
function releaseStanding(reason, forget = false) {
  if (forget && currentKey) dropHoldRecord(currentKey);
  if (!holder && !server) return;
  flushBacklogNow();
  standingLog(`released ${currentKey ?? "?"}: ${reason}${forget ? " (record dropped)" : ""}`);
  const released = { kind: "released", key: currentKey ?? void 0, text: reason };
  broadcast(released);
  notify("info", released);
  holder?.close(reason);
  holder = null;
  for (const c of clients) {
    try {
      c.end();
    } catch {
    }
  }
  clients.clear();
  for (const w of [...helloWaiters]) w(null);
  const srv = server;
  server = null;
  if (srv) {
    try {
      srv.close();
    } catch {
    }
  }
  if (currentKey) {
    for (const p of [keyFilePathFor(currentKey), seenFilePathOf(CFG.authDir, currentKey)]) {
      try {
        unlinkSync6(p);
      } catch {
      }
    }
    if (process.platform !== "win32") {
      try {
        unlinkSync6(socketPathFor(currentKey));
      } catch {
      }
    }
  }
  ring.length = 0;
  parked = false;
  listenerIdleAt = null;
  currentKey = null;
  currentUrl = null;
  currentStatusUrl = null;
  evictedKey = null;
  evictedEvent = null;
  seen = /* @__PURE__ */ new Set();
  dropStale();
}
function holdStanding(url, statusUrl2) {
  const key = keyFor();
  if (url === currentUrl && key === currentKey && holder?.alive) return key;
  releaseStanding("новый сокет", !!currentKey && currentKey !== key);
  currentKey = key;
  currentUrl = url;
  currentStatusUrl = statusUrl2 || statusUrl(url);
  openLocalServer(key);
  const s = state.standing;
  if (s)
    writeHoldRecord(key, {
      status: keptRecordStatus(key),
      realm: s.realm,
      karta: s.karta,
      name: s.name ?? "",
      url,
      statusUrl: currentStatusUrl,
      cwd: standCwd ?? readHoldRecord(key)?.cwd,
      client: harnessName(),
      key
    });
  listenerIdleAt = Date.now();
  seen = seenIds(seenFilePathOf(CFG.authDir, key));
  openHolder(url, key);
  standingLog(`held ${key}${standCwd ? ` cwd=${standCwd}` : ""}`);
  notify("info", { kind: "held", key });
  return key;
}
function parkStanding(reason) {
  if (!holder?.alive || !currentKey) return null;
  holder.close(reason);
  holder = null;
  parked = true;
  standingLog(`parked ${currentKey}: ${reason}`);
  const text = `мост ушёл с места (${reason}) — сокет закрыт, место цело; возврат — сторож или iskron_stand`;
  broadcast({ kind: "note", text });
  return currentKey;
}
function resumeStanding() {
  if (!parked || !currentUrl || !currentKey) return false;
  parked = false;
  for (let i = ring.length - 1; i >= 0; i--)
    if (ring[i]?.frame?.type === "hello") ring.splice(i, 1);
  openHolder(currentUrl, currentKey);
  standingLog(`resumed ${currentKey}: socket reopened on the same address`);
  return true;
}
function openHolder(url, key) {
  holder = holdSocket({
    url,
    onFrame: (raw, frame2) => {
      void completeFrame(stampOrigin(frame2)).then((full) => {
        if (full?.type === "message" && full.stale === true)
          return noteStale(full, (ev2) => {
            broadcast(ev2);
            notify("info", ev2);
          });
        const text = full === frame2 ? raw : JSON.stringify(full);
        ring.push({ raw: text, frame: full });
        if (ring.length > RING) ring.shift();
        if (full?.type === "hello") for (const w of [...helloWaiters]) w(full);
        const ev = { kind: "frame", raw: text, frame: full };
        broadcast(ev);
        const id = full?.type === "message" && typeof full.id === "string" ? full.id : "";
        const seenPath = seenFilePathOf(CFG.authDir, key);
        const again = !!id && seen.has(id);
        if (id && clients.size > 0) noteSeen(seenPath, id, seen);
        if (full?.type === "status") return;
        if (again) return log(`frame ${id} came again — already delivered, not raised`);
        if (notifiedClient()) {
          const flushBacklog = (b) => {
            for (const f of b.frames ?? [])
              if (typeof f.id === "string" && f.id) noteSeen(seenPath, f.id, seen);
            notify("info", b);
          };
          if (full?.type === "hello" && Number(full.pending) > 0)
            openBacklog(Number(full.pending), flushBacklog);
          if (full?.type === "message") {
            if (full.origin === "platform") openBacklog(0, flushBacklog);
            if (noteBacklog(full)) return;
          }
          if (id) noteSeen(seenPath, id, seen);
        }
        notify("info", ev);
      });
    },
    onEvicted: (code) => {
      const text = `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли, слушает другой держатель; привязка записей цела, занятость — пока адрес не повернули connect-ом; вернуть слух сюда — iskron_stand с take=true`;
      log(text);
      standingLog(`evicted ${key}: close ${code}`);
      evictedKey = key;
      dropHoldRecord(key);
      const ev = { kind: "evicted", code, text };
      evictedEvent = ev;
      broadcast(ev);
      notify("warning", ev);
    },
    onDeadToken: (code) => {
      if (revokingOwn) {
        log(
          `standing revoked by this session — released quietly, binding forgotten (${state.standing?.name ?? "unnamed"}; close ${code} arrived before the answer)`
        );
        releaseStanding("снято своим revoke", true);
        state.standing = null;
        state.standingSession = null;
        return;
      }
      if (resuming > 0) {
        log(`hold record for ${key} is dead at the platform (close ${code}) — dropped`);
        releaseStanding("возврат с диска не удался", true);
        return;
      }
      const text = `ДЕЛАТЕЛЬ: ${deadTokenAdvice(code)}`;
      log(text);
      standingLog(`dead ${key}: close ${code}`);
      const ev = { kind: "dead", code, text };
      broadcast(ev);
      notify("error", ev);
      releaseStanding("токен мёртв", true);
    },
    onServiceAlive: (version) => {
      const text = `ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает (${version}) — место держу, переоткрываю реже; не пройдёт — спроси о токене`;
      log(text);
      const ev = { kind: "alive", version, text };
      broadcast(ev);
      notify("warning", ev);
    },
    onNote: (text) => {
      log(text);
      broadcast({ kind: "note", text });
    }
  });
}
var revokingOwn = false;
function setRevokingOwn(v) {
  revokingOwn = v;
}

// js/bridge/listen.ts
import { fileURLToPath as fileURLToPath2 } from "node:url";
function clientName() {
  const info = state.initParams?.clientInfo;
  return typeof info?.name === "string" ? info.name : "";
}
function listenBlock() {
  const key = heldKey();
  if (!key) return null;
  const self = fileURLToPath2(import.meta.url);
  const where = CFG.authDir === defaultAuthDir() ? "" : ` --auth-dir "${CFG.authDir}"`;
  const client = clientName();
  const monitor = `под Monitor — node "${self}" watchdog ${key}${where} с наибольшим timeout_ms, перевзводить по истечении (Claude Code)`;
  const exit = `фоновой задачей — node "${self}" watchdog-exit ${key}${where} (выходит нулём на первом сообщении)`;
  const codex = `в Codex внутри одной длинной команды своей оболочки — node "${self}" watchdog-codex ${key}${where} & …; kill %1 (кадр входит в идущий тред через app-server; отдельной командой с nohup сторож умирает вместе с ней)`;
  const listen = NOTIFIED_CLIENTS.has(client) ? `Слушает ${client === PI_CLIENT ? "расширение pi" : "плагин OpenCode"} само — сторож не нужен, кадры входят в ход.` : client === "claude-code" ? `Слушать: ${monitor}; без Monitor — ${exit}.` : /codex/i.test(client) ? `Слушать: ${codex}; без двери app-server — ${exit}.` : `Слушать: ${monitor}; ${exit}; ${codex}.`;
  return `[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно (строка выше о том, что никто не слушает, описывает миг до этого держания).
${listen}
Занятость: iskron_channel(action="status", realm, text) — пустой text снимает.
Кадры приходят и уведомлениями MCP (logger iskron-channel).`;
}

// js/bridge/absorb.ts
var SOCKET_RE = /wss:\/\/[^\s"'`<>)\]]+|ws:\/\/(?:127\.0\.0\.1|\[?::1\]?|localhost)(?::\d+)?\/[^\s"'`<>)\]]+/;
var STATUS_RE = /https?:\/\/[^\s"'`<>)\]]+\/channel\/status\/[^\s"'`<>)\]]+/;
var trim = (s) => s.replace(/[.,;:!?»"')\]]+$/, "");
var hideAddresses = (text) => text.replace(
  new RegExp(SOCKET_RE.source, "g"),
  "(адрес сокета держит мост — агенту не показывается)"
).replace(new RegExp(STATUS_RE.source, "g"), "(статусный адрес держит мост)");
function absorbChannelReply(msg, reply2) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel") return reply2;
  if (a?.action !== "connect" && a?.action !== "mint") return reply2;
  if (reply2?.error || reply2?.result?.isError) return reply2;
  const text = replyText(reply2);
  const socket = SOCKET_RE.exec(text)?.[0];
  if (!socket) return reply2;
  const status = STATUS_RE.exec(text)?.[0];
  if (a.realm && a.karta != null) {
    state.standing = { realm: a.realm, karta: String(a.karta).replace(/^#/, ""), name: a.name };
  }
  holdStanding(trim(socket), status ? trim(status) : statusUrl(trim(socket)));
  const block = listenBlock() ?? "";
  const content = reply2.result?.content;
  if (Array.isArray(content)) {
    for (const c of content) if (typeof c?.text === "string") c.text = hideAddresses(c.text);
    content.push({ type: "text", text: block.trim() });
  }
  return reply2;
}
function revokesOwn(msg) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "revoke") return false;
  const s = state.standing;
  if (!s) return false;
  const asked = typeof a.standing === "string" ? a.standing.trim() : "";
  const own = asked === "" || asked === "mine" || asked === (s.name ?? "") || asked.endsWith(`:${s.name ?? ""}`);
  return own && String(a.karta ?? s.karta) === String(s.karta);
}
function expectOwnRevoke(msg) {
  if (revokesOwn(msg)) setRevokingOwn(true);
}
function absorbRevokeReply(msg, reply2) {
  if (msg?.params?.name !== "iskron_channel" || msg?.params?.arguments?.action !== "revoke")
    return reply2;
  setRevokingOwn(false);
  if (reply2?.error || reply2?.result?.isError) return reply2;
  if (!revokesOwn(msg)) return reply2;
  const name = state.standing?.name ?? "unnamed";
  releaseStanding("снято своим revoke", true);
  state.standing = null;
  state.standingSession = null;
  log(`standing revoked by this session — released quietly, binding forgotten (${name})`);
  return reply2;
}

// js/bridge/call.ts
function leadsOtherPlace(karta, name) {
  const led = ledKey();
  const s = state.standing;
  if (!led || !s) return null;
  const k = String(karta).replace(/^#/, "");
  if (!/^\d+$/.test(k)) return null;
  return k === String(s.karta) && name === (s.name ?? "") ? null : led;
}
var otherPlaceWord = (led, asked) => `Отказано (мост): этот мост уже ведёт место ${led} — стояние одно на мост, и место ${asked} его сняло бы с сокета молча. Занять другое место вместо этого — iskron_stand с take=true (прежнее останется на доске без слуха; ненужное сними revoke); держать оба разом — второй мост, то есть другая сессия харнесса.`;
function crossPlaceRefusal(msg) {
  if (msg?.method !== "tools/call" || msg.params?.name !== "iskron_channel") return null;
  const a = msg.params.arguments ?? {};
  if (!["connect", "mint", "register"].includes(String(a.action))) return null;
  const karta = a.karta ?? state.standing?.karta ?? "";
  const name = typeof a.name === "string" ? a.name : "";
  const led = leadsOtherPlace(karta, name);
  if (!led) return null;
  const asked = `${name || "_"}--${String(karta).replace(/^#/, "")}`;
  return {
    jsonrpc: "2.0",
    id: msg.id,
    result: { isError: true, content: [{ type: "text", text: otherPlaceWord(led, asked) }] }
  };
}
var seq = 0;
async function callTool(name, args) {
  const id = `iskron-bridge-call-${++seq}`;
  const msg = {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args }
  };
  let reply2 = null;
  await post(msg, (m) => {
    if (m.id === id) reply2 = m;
  });
  let got = reply2;
  if (!got) return { text: "ответа нет", isError: true };
  if (name === "iskron_channel") {
    if (args.action === "register") noteStanding(msg, got);
    if (args.action === "connect") got = absorbChannelReply(msg, got);
  }
  return { text: replyText(got), isError: !!got.error || !!got.result?.isError };
}
var short = (s, n = 300) => s.length > n ? `${s.slice(0, n)}…` : s;
var chain = Promise.resolve();
function serialized(fn) {
  const p = chain.then(fn, fn);
  chain = p.then(
    () => void 0,
    () => void 0
  );
  return p;
}

// js/bridge/status.ts
function localStatus(msg) {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  const a = msg.params?.arguments;
  if (a?.action !== "status") return null;
  const text = typeof a.text === "string" ? a.text : "";
  const reply2 = (body, isError = false) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...isError ? { isError: true } : {}, content: [{ type: "text", text: body }] }
  });
  return (async () => {
    const st = await publishStatus(text);
    if (st.ok) return reply2(`занятость ${statusAddress()?.key}: ${text || "(снята)"}`);
    return reply2(st.body, true);
  })();
}
var lastPublished = "";
var publishedStatus = () => lastPublished;
async function publishStatus(text) {
  const addr = statusAddress();
  if (!addr) {
    return {
      ok: false,
      body: "Отказано (мост): у моста нет стояния этого агента — назовись одним вызовом iskron_stand(realm, karta, model, status) (занятость можно передать прямо в нём); место слушает другой держатель — take=true берёт слух и статусный адрес сюда"
    };
  }
  const st = await publishStatusTo(addr.url, text);
  if (st.ok) {
    lastPublished = text;
    rememberStatus(text);
  }
  return st;
}
async function publishStatusTo(url, text, timeoutMs = 5e3) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    return {
      ok: false,
      body: `Отказано (мост): статусный адрес не ответил — ${e.message}`
    };
  }
  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 404)
    return {
      ok: false,
      body: `Отказано (404) поверхностью: ${body || "без тела"} — статусный адрес повернули connect-ом другого держателя; занятость теперь его; вернуть слух и адрес сюда — iskron_stand с take=true`
    };
  if (!res.ok)
    return { ok: false, body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}` };
  return { ok: true, body };
}

// js/bridge/leave.ts
var DEAF_MS = Number(process.env.ISKRON_BRIDGE_DEAF_MS) || 15 * 6e4;
var TICK_MS = Math.min(6e4, Math.max(200, Math.floor(DEAF_MS / 5)));
var deafWithoutListener = () => !notifiedClient();
var keptStatus = "";
async function leaveStanding(reason) {
  const parked2 = parkStanding(reason);
  if (!parked2) return "мост места не держит — уходить неоткуда";
  keptStatus = publishedStatus();
  const st = await publishStatus("");
  if (st.ok && keptStatus) rememberStatus(keptStatus);
  const line = st.ok ? "занятость снята" : `занятость не снята (${st.body})`;
  log(`left the standing: ${reason}; ${line}`);
  return `ушёл с места ${parked2}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится и придёт при возвращении (сторож или iskron_stand)`;
}
function returnToStanding(how) {
  if (!resumeStanding()) return false;
  const text = `мост вернулся на место (${how}) — сокет открыт заново тем же адресом${keptStatus ? `, занятость «${keptStatus}» возвращена` : ""}`;
  log(text);
  if (keptStatus) {
    const line = keptStatus;
    keptStatus = "";
    void publishStatus(line).then((st) => {
      if (!st.ok) log(`busy line not restored after the return: ${st.body}`);
    });
  }
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level: "info", logger: "iskron-channel", data: { kind: "note", text } }
  });
  return true;
}
function startDeafnessWatch() {
  onListenerAttached(
    () => setTimeout(() => {
      if (localListeners() > 0) returnToStanding("прицепился сторож");
    }, 300).unref()
  );
  setInterval(() => {
    const since = listenerIdleSince();
    if (since == null || !deafWithoutListener()) return;
    if (Date.now() - since < DEAF_MS) return;
    const s = state.standing;
    if (!s || !holdsStanding(s.realm, s.karta, s.name ?? "")) return;
    void leaveStanding(`никто не слушает ${Math.round(DEAF_MS / 6e4)} мин`);
  }, TICK_MS).unref();
}
function localLeave(msg) {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  if (msg.params?.arguments?.action !== "leave") return null;
  return leaveStanding("по слову делателя").then((text) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { content: [{ type: "text", text }] }
  }));
}

// js/bridge/stand.ts
import { statSync as statSync2 } from "node:fs";
import { isAbsolute } from "node:path";

// js/bridge/board.ts
function parseBoard(text) {
  const out4 = [];
  for (const line of text.split("\n")) {
    const m = /^\s*#(\d+)\s.*?·\s(@\S+)\s—\s(.*)$/.exec(line);
    if (m) {
      out4.push({ karta: m[1], address: m[2], rest: m[3], incoming: null });
      continue;
    }
    const inc = /📥\s*(https?:\/\/\S+)/.exec(line);
    if (inc && out4.length) out4[out4.length - 1].incoming = inc[1];
  }
  return out4;
}
var nameOf = (address) => address.slice(address.indexOf(":") + 1);
var listens = (e) => /(^|·)\s*слушает/.test(e.rest);
function undelivered(e) {
  const m = /не доставлено\s+(\d+)/.exec(e.rest);
  return m ? Number(m[1]) : 0;
}

// js/bridge/names.ts
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { basename as basename2 } from "node:path";
var NAME_MAX = 48;
var NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
var sanitize = (s) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, NAME_MAX);
function nameFault(name) {
  if (name.length > NAME_MAX) return `длиннее предела: ${name.length} знаков`;
  if (!NAME_RE.test(name))
    return /[A-Z]/.test(name) ? "заглавные буквы не допускаются" : "недопустимые знаки или первый знак не буква и не цифра";
  return null;
}
var PART_MIN = 3;
var CUT_ORDER = ["repo", "host", "model"];
function fitName(parts) {
  const p = { ...parts };
  const join13 = () => [p.host, p.repo, p.model].filter(Boolean).join(".").replace(/[-.]+$/, "");
  const cut = [];
  for (const k of CUT_ORDER) {
    const over = join13().length - NAME_MAX;
    if (over <= 0) break;
    const keep = Math.max(k === "model" ? 1 : PART_MIN, p[k].length - over);
    if (keep >= p[k].length) continue;
    p[k] = p[k].slice(0, keep).replace(/[-.]+$/, "");
    cut.push(k);
  }
  return {
    name: join13().slice(0, NAME_MAX).replace(/[-.]+$/, ""),
    cut
  };
}
var git = (args, cwd = process.cwd()) => {
  try {
    return execFileSync("git", args, {
      cwd,
      timeout: 2e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
  } catch {
    return "";
  }
};
function deriveParts(model, cwd = process.cwd()) {
  const host = hostname().split(".")[0];
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  const repo = basename2(top || cwd);
  const short2 = (model ?? "").trim().toLowerCase().replace(/^claude[-_]/, "");
  return { host: sanitize(host ?? ""), repo: sanitize(repo), model: sanitize(short2) };
}
var joinName = (p) => [p.host, p.repo, p.model].filter(Boolean).join(".");

// js/bridge/resume.ts
import { existsSync as existsSync2, readdirSync as readdirSync3, readFileSync as readFileSync9 } from "node:fs";
import { join as join7 } from "node:path";
async function deadPredecessor(realm, karta, name) {
  const key = keyOf(realm, karta, name);
  if (!readHoldRecord(key)) return false;
  return !await localSocketAlive(localSocketPathOf(key));
}
async function resumeFromDisk(realm, karta, name) {
  const key = keyOf(realm, karta, name);
  const rec = readHoldRecord(key);
  if (!rec) return null;
  if (holdsKey(key)) return null;
  const led = ledKey();
  if (led && led !== key) return null;
  if (await localSocketAlive(localSocketPathOf(key))) return null;
  const prev = state.standing;
  state.standing = { realm, karta, name };
  const prevCwd = rec.cwd ? noteStandCwd(rec.cwd) : null;
  noteResuming(1);
  try {
    holdStanding(rec.url, rec.statusUrl);
    const hello = await awaitHello(4e3);
    if (hello && holdsKey(key)) {
      const pending2 = Number(hello.pending) || 0;
      log(`standing resumed from disk (${key}), pending ${pending2}`);
      standingLog(`resumed-from-disk ${key}: pending ${pending2}`);
      return {
        word: `возврат места с диска после перезапуска моста — сокет открыт заново тем же адресом (ожидало кадров — ${pending2})`,
        status: rec.status,
        pending: pending2
      };
    }
  } finally {
    noteResuming(-1);
  }
  log(`hold record for ${key} is stale — dropped, the place is taken anew`);
  releaseStanding("возврат с диска не удался", true);
  state.standing = prev;
  if (rec.cwd) noteStandCwd(prevCwd);
  return null;
}
function recordsFor(sel) {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync2(dir)) return [];
  const mine = harnessName();
  const byKey = [];
  const byCwd = [];
  for (const f of readdirSync3(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec = JSON.parse(readFileSync9(join7(dir, f), "utf8"));
      if (!rec || rec.client !== mine) continue;
      const key = keyOf(rec.realm, rec.karta, rec.name);
      const keyed = !!sel.key && key === sel.key;
      if (!keyed && (!sel.cwd || rec.cwd !== sel.cwd)) continue;
      const fresh = readHoldRecord(key);
      if (fresh) (keyed ? byKey : byCwd).push(fresh);
    } catch {
    }
  }
  return [...byKey, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))];
}
async function backToParked(key, how) {
  if (!returnToStanding(how)) return { resumed: false, key, word: "возврат на место не удался" };
  const hello = await awaitHello(4e3);
  return {
    resumed: true,
    key,
    pending: Number(hello?.pending) || 0,
    word: hello ? `возврат на место, с которого мост уходил (ожидало кадров — ${Number(hello.pending) || 0})` : "возврат на место, с которого мост уходил; hello за 4 с не пришёл"
  };
}
async function resumeBy(sel, register = true) {
  const recs = recordsFor(sel);
  if (!recs.length)
    return {
      resumed: false,
      word: `своей записи держания ${sel.key ? `с ключом ${sel.key}` : `для каталога ${sel.cwd ?? "?"}`} нет`
    };
  const led = ledKey();
  const skipped = [];
  for (const rec of recs) {
    const key = keyOf(rec.realm, rec.karta, rec.name);
    if (holdsKey(key)) return { resumed: true, key, pending: 0, word: "мост уже держит это место" };
    if (isParked(rec.realm, rec.karta, rec.name)) return backToParked(key, "возврат по записи");
    if (led && led !== key) {
      skipped.push(`${key}: мост ведёт другое место ${led}`);
      continue;
    }
    if (await localSocketAlive(localSocketPathOf(key))) {
      skipped.push(`${key}: держит живой мост`);
      continue;
    }
    const back = await resumeFromDisk(rec.realm, rec.karta, rec.name);
    if (!back) {
      skipped.push(`${key}: запись протухла — место займёт iskron_stand`);
      continue;
    }
    const lines = [back.word];
    if (register) {
      const r = await callTool("iskron_channel", {
        action: "register",
        realm: rec.realm,
        karta: rec.karta,
        name: rec.name
      });
      lines.push(r.isError ? `register отказал — ${short(r.text)}` : "register");
    }
    if (back.status) {
      const st = await publishStatus(back.status);
      lines.push(
        st.ok ? `занятость возвращена: ${back.status}` : `занятость не возвращена: ${short(st.body)}`
      );
    }
    return { resumed: true, key, pending: back.pending, word: lines.join("; ") };
  }
  return { resumed: false, word: `возвращать нечего — ${skipped.join("; ")}` };
}
function holdFromEnv() {
  const url = process.env.ISKRON_CHANNEL_SOCKET?.trim();
  if (url) holdStanding(url, process.env.ISKRON_CHANNEL_STATUS?.trim() || null);
}
var reply = (msg, result) => ({
  jsonrpc: "2.0",
  id: msg.id,
  result
});
var selectorOf = (msg) => ({
  key: typeof msg.params?.key === "string" && msg.params.key.trim() ? msg.params.key.trim() : void 0,
  cwd: typeof msg.params?.cwd === "string" && msg.params.cwd.trim() ? msg.params.cwd.trim() : void 0
});
var isResumeCall = (msg) => msg?.method === "iskron/resume";
var isCheckCall = (msg) => msg?.method === "iskron/check";
async function runResume(msg) {
  const sel = selectorOf(msg);
  if (!sel.key && !sel.cwd)
    return reply(msg, { resumed: false, word: "ни key, ни cwd не передан" });
  return reply(msg, await resumeBy(sel));
}
async function runCheck(msg) {
  const sel = selectorOf(msg);
  const s = state.standing;
  const key = s ? keyOf(s.realm, s.karta, s.name ?? "") : null;
  if (!s || !key || !holdsKey(key)) {
    if (s && key && isParked(s.realm, s.karta, s.name ?? "")) {
      const r2 = await backToParked(key, "сторож слуха");
      return reply(msg, { holding: r2.resumed, ...r2 });
    }
    if (!sel.key && !sel.cwd)
      return reply(msg, {
        holding: false,
        resumed: false,
        word: "места нет, ни key, ни cwd не передан"
      });
    const r = await resumeBy(sel);
    return reply(msg, { holding: r.resumed, ...r });
  }
  const board = await callTool("iskron_channel", { action: "list", realm: s.realm });
  if (board.isError)
    return reply(msg, { holding: true, key, word: `доска не прочиталась — ${short(board.text)}` });
  const mine = parseBoard(board.text).find(
    (e) => e.karta === String(s.karta) && nameOf(e.address) === (s.name ?? "")
  );
  if (!mine) return reply(msg, { holding: true, key, word: "своего места на доске нет" });
  const pending2 = undelivered(mine);
  const listening = listens(mine);
  if (listening) {
    deafReopens = 0;
    return reply(msg, { holding: true, key, listening, pending: pending2, word: "слушаю" });
  }
  if (deafReopens >= REOPEN_LIMIT) {
    const text = `Искрон: доска читает место ${key} не слушающим и после ${REOPEN_LIMIT} переоткрытий сокета — больше не рву; проверь доску и сервер, вернуть слух — iskron_stand с take=true.`;
    if (!deafSaid) {
      deafSaid = true;
      standingLog(`reopen ${key}: gave up after ${REOPEN_LIMIT} — board still reads deaf`);
      emit({
        jsonrpc: "2.0",
        method: "notifications/message",
        params: { level: "warning", logger: "iskron-channel", data: { kind: "lost", text } }
      });
    }
    return reply(msg, {
      holding: true,
      key,
      listening,
      pending: pending2,
      reopened: false,
      stuck: true,
      word: text
    });
  }
  deafReopens++;
  standingLog(`reopen ${key}: board reads deaf${pending2 ? ` with ${pending2} pending` : ""}`);
  parkStanding("доска не читает слушающим");
  resumeStanding();
  const hello = await awaitHello(4e3);
  return reply(msg, {
    holding: true,
    key,
    listening,
    pending: pending2,
    reopened: !!hello,
    word: hello ? `сокет переоткрыт: ожидало кадров — ${Number(hello.pending) || 0}` : "сокет переоткрыт, hello за 4 с не пришёл"
  });
}
var deafReopens = 0;
var deafSaid = false;
var REOPEN_LIMIT = 2;

// js/bridge/update.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync3, lstatSync, mkdirSync as mkdirSync6, readFileSync as readFileSync10, renameSync as renameSync4, writeFileSync as writeFileSync8 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { dirname as dirname2, join as join9 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// js/shared/home.ts
import { homedir as homedir3 } from "node:os";
import { join as join8 } from "node:path";
var homeBridgePath = () => join8(homedir3(), ".iskron-bridge", "iskron-bridge.mjs");

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
var opencodePluginPath = () => join9(homedir4(), ".config", "opencode", "plugins", "iskron.js");
var setupPathOf = (authDir) => join9(authDir, "SETUP.md");
var latestPathOf = (authDir) => join9(authDir, "latest.json");
function writeAtomic(path, bytes) {
  mkdirSync6(dirname2(path), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync8(tmp, bytes, { mode: 420 });
  renameSync4(tmp, path);
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
    return versionIn(readFileSync10(path, "utf8"));
  } catch {
    return null;
  }
};
function syncHome(self = selfPath()) {
  const out4 = { copied: [] };
  const home = homeBridgePath();
  let mine;
  try {
    mine = readFileSync10(self);
  } catch {
    return out4;
  }
  if (!versionIn(mine.toString("utf8"))) return out4;
  if (self === home) return out4;
  if (isSymlink(home)) return out4;
  const homeVersion = versionOf(home);
  const cmp = homeVersion ? compareVersions(VERSION, homeVersion) : 1;
  if (cmp > 0) {
    writeAtomic(home, mine);
    out4.copied.push(home);
    const plugin = opencodePluginPath();
    const packaged = join9(dirname2(self), "opencode-plugin.js");
    if (existsSync3(plugin) && existsSync3(packaged)) {
      const fresh = readFileSync10(packaged);
      if (!readFileSync10(plugin).equals(fresh)) {
        writeAtomic(plugin, fresh);
        out4.copied.push(plugin);
      }
    }
  } else if (cmp < 0 && homeVersion) {
    out4.reexec = home;
  }
  return out4;
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
    return JSON.parse(readFileSync10(latestPathOf(authDir), "utf8"));
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
  if (existsSync3(plugin)) {
    const fresh = await fetchText(`${base}/skills/establish-mcp/scripts/opencode-plugin.js`);
    if (readFileSync10(plugin, "utf8") !== fresh) {
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
  const bridgeWord = latest.downloaded.some((p) => p === homeBridgePath()) ? "Свежий мост уже скачан в ~/.iskron-bridge и поднимется новой сессией." : latest.error ? `Скачать свежий мост не вышло (${latest.error}); повтори: node "${process.argv[1]}" update.` : isSymlink(homeBridgePath()) ? "Свежий мост в дом не положен: дом — симлинк на чужую копию, его не трогаю; обнови эту копию сам." : versionOf(homeBridgePath()) && compareVersions(versionOf(homeBridgePath()), latest.version) >= 0 ? "Свежий мост уже лежит в ~/.iskron-bridge и поднимется новой сессией." : `Свежий мост в дом не положен; повтори: node "${process.argv[1]}" update (мост, который отвечает, — тот и обновляет дом; в пакетной поставке OpenCode мост живёт в пакете и обновляется с ним).`;
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
  if (!explicit && !isProductionServer(serverUrl)) {
    log(
      `releases not watched: ${serverUrl} is not a production address — another instance is another delivery`
    );
    return;
  }
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
  description: "[мост] Занять стояние одним вызовом: мост читает доску, выводит имя (машина.репо.модель), занимает место (connect и register; только register, если сокет уже держит этот мост), взводит хук инбокса роли своим входящим адресом, при room шлёт кадр join стоянию комнаты по полному адресу с провода (повтор — только repeat_knock=true, один раз, не раньше чем через 2 минуты) и возвращает имя, команду сторожа, число ожидавших кадров, состояние хука и расписку стука. Дальше — запустить сторожа командой из ответа и ждать. Тул исполняет мост; нет его в сессии — тулы идут мимо моста либо мост старой сборки (doctor скажет), стой по скиллу standing.",
  inputSchema: {
    type: "object",
    properties: {
      realm: { type: "string", description: "Адрес графа: @owner/slug или rN." },
      karta: { type: "string", description: "Роль агента (#N из AGENTS.md или строки запуска)." },
      name: {
        type: "string",
        description: "Своя половина имени стояния; без неё выводится машина.репо.модель — модель из параметра model."
      },
      room: {
        type: "string",
        description: "Полный адрес стояния комнаты @handle:name из строки приглашения; мост шлёт ему join."
      },
      model: {
        type: "string",
        description: "Модель, которой бежит агент (id или имя, например claude-opus-5 или opus-5) — третья часть выведенного имени; без неё имя — машина.репо."
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
      status: { type: "string", description: "Первая строка занятости (до 64 символов)." },
      cwd: {
        type: "string",
        description: "Директория сессии харнесса, существующий абсолютный каталог — из неё выводится репо для имени (git toplevel, иначе её basename) и читаются ветки при поиске мест прежнего имени, когда мост запущен не из рабочей копии; плагин OpenCode подставляет её сам. Без неё — cwd моста; несуществующая или относительная — отказ вслух."
      }
    },
    required: ["realm", "karta"]
  }
};
var isDirectory = (p) => {
  try {
    return isAbsolute(p) && statSync2(p).isDirectory();
  } catch {
    return false;
  }
};
var isStandCall = (msg) => msg?.method === "tools/call" && msg?.params?.name === "iskron_stand";
var knocks = /* @__PURE__ */ new Map();
var KNOCK_REPEAT_AFTER_MS = Number(process.env.ISKRON_STAND_KNOCK_REPEAT_MS) || 12e4;
var KNOCK_LIMIT = 2;
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
  const model = typeof a.model === "string" && a.model.trim() ? a.model : void 0;
  const cwd = typeof a.cwd === "string" && a.cwd.trim() ? a.cwd.trim() : process.cwd();
  if (cwd !== process.cwd() && !isDirectory(cwd)) {
    lines.push(
      `Отказано (мост): cwd должен быть существующим абсолютным каталогом — получено «${cwd}»${isAbsolute(cwd) ? "" : " (относительный путь резолвился бы от cwd моста, не сессии)"}.`
    );
    return done(true);
  }
  const nameNotes = [];
  const asked = typeof a.name === "string" ? a.name.trim() : "";
  if (asked) {
    const fault = nameFault(asked);
    if (fault) {
      lines.push(
        `Отказано (мост): name «${asked}» — ${fault}; правило имени: строчные латинские буквы, цифры, точка, подчёркивание, дефис, первый знак — буква или цифра, не длиннее ${NAME_MAX} знаков. Имя не укорачивается молча: короткое имя адресовало бы другое место.`
      );
      return done(true);
    }
  }
  const parts = asked ? null : deriveParts(model, cwd);
  const fitted = parts ? fitName(parts) : null;
  const name = asked || (fitted?.name ?? "");
  if (parts && fitted && fitted.cut.length) {
    const what = fitted.cut.map((k) => k === "repo" ? "репо" : k === "host" ? "машина" : "модель").join(", ");
    nameNotes.push(
      `выведенное имя ${joinName(parts)} длиннее предела ${NAME_MAX} знаков — укорочено до ${name} (срезано: ${what}); нужно другое — передай name`
    );
  }
  if (!asked && !model) {
    nameNotes.push(
      "model не передан — имя без третьей части (машина.репо): вторая сессия этой машины над этим репозиторием сойдётся на то же место; передай model, чтобы различать"
    );
  }
  const room = typeof a.room === "string" && a.room.trim() ? a.room.trim() : null;
  const led = leadsOtherPlace(karta, name);
  if (led && a.take !== true) {
    lines.push(otherPlaceWord(led, `${name}--${karta}`));
    return done(true);
  }
  noteStandCwd(cwd);
  const board = await callTool("iskron_channel", { action: "list", realm });
  if (board.isError) {
    lines.push(`Отказано: доска не прочиталась — ${short(board.text)}`);
    return done(true);
  }
  const entries = parseBoard(board.text);
  const header = /^\s*Каналы(?:\s*\((\d+)\))?(?:\s|:|$)/m.exec(board.text);
  const declared = header?.[1] != null ? Number(header[1]) : null;
  const empty = /не держит канала/i.test(board.text);
  const recognized = !!header || empty || entries.length > 0;
  const own = entries.filter((e) => e.karta === karta && nameOf(e.address) === name);
  const stem = name.split(".").slice(0, 2).join(".");
  const branches = new Set(
    git(["branch", "--format=%(refname:short)"], cwd).split("\n").map((x) => sanitize(x.trim())).filter(Boolean)
  );
  const legacy = entries.filter((e) => {
    if (e.karta !== karta || nameOf(e.address) === name) return false;
    const own2 = nameOf(e.address);
    if (!own2.startsWith(`${stem}.`)) return false;
    const third = own2.slice(stem.length + 1);
    return branches.has(third) && /живой|слушает/.test(e.rest);
  });
  for (const e of legacy) {
    nameNotes.push(
      `на доске живо место прежнего имени ${e.address} — его адрес могут держать комнаты и хуки; сними его: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${e.address}")`
    );
  }
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
  const fresh = a.take !== true && !holdsStanding(realm, karta, name) && !isParked(realm, karta, name);
  const predecessorDead = fresh && listensElsewhere && await deadPredecessor(realm, karta, name);
  const resumed = fresh && !listensElsewhere ? await resumeFromDisk(realm, karta, name) : null;
  const extra = [];
  if (resumed) {
    const r = await callTool("iskron_channel", { action: "register", realm, karta, name });
    if (r.isError) {
      lines.push(`Отказано: register — ${short(r.text)}`);
      return done(true);
    }
    heardHere = true;
    how = `${resumed.word}, register`;
    const newStatus = typeof a.status === "string" && a.status.trim();
    if (resumed.status && !newStatus) {
      const st = await publishStatus(resumed.status);
      extra.push(
        st.ok ? `Занятость возвращена с местом: ${resumed.status}` : `Занятость с места не возвращена: ${short(st.body)}`
      );
    }
  } else if (a.take !== true && isParked(realm, karta, name) && returnToStanding("iskron_stand")) {
    const r = await callTool("iskron_channel", { action: "register", realm, karta, name });
    if (r.isError) {
      lines.push(`Отказано: register — ${short(r.text)}`);
      return done(true);
    }
    heardHere = true;
    how = "возврат на место, с которого мост уходил, — сокет открыт заново тем же адресом, register";
  } else if (a.take !== true && (holdsStanding(realm, karta, name) || listensElsewhere)) {
    const r = await callTool("iskron_channel", { action: "register", realm, karta, name });
    if (r.isError) {
      lines.push(`Отказано: register — ${short(r.text)}`);
      return done(true);
    }
    heardHere = !listensElsewhere;
    how = listensElsewhere ? wasEvicted(realm, karta, name) ? "место отняли у этого моста (закрытие 4000) — слушает другой держатель; только register: привязка цела, слух — у него; вернуть слух сюда — повтори с take=true, сознавая, что снимешь слух с того держателя" : predecessorDead ? "слушающим доска ещё читает прежний мост этого каталога, а он мёртв (его сокет не отвечает, запись держания цела) — только register; доска отпустит его в течение минуты, и тот же вызов вернёт место с диска тем же адресом — повтори" : "место уже слушает другой держатель (обычно прежняя сессия этой рабочей копии; при явном name — возможно, другая машина или человек) — только register: атрибуция есть, слух — у него; нужен слух здесь — повтори с take=true, сознавая, что снимешь слух с того держателя, или возьми другое имя (name)" : "сокет уже держит этот мост — register";
  } else {
    const args = { action: "connect", realm, karta, name };
    if (typeof a.mute_siblings === "boolean") args.mute_siblings = a.mute_siblings;
    const c = await callTool("iskron_channel", args);
    if (c.isError) {
      lines.push(`Отказано: connect — ${short(c.text)}`);
      return done(true);
    }
    incoming = /https?:\/\/\S+\/channel\/in\/\S+/.exec(c.text)?.[0] ?? incoming;
    const r = await callTool("iskron_channel", { action: "register", realm, karta, name });
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
    `[iskron_stand] стояние ${mine?.address ?? name} — роль #${karta}, граф ${realm}: ${how}.`,
    ...nameNotes.map((n) => `[iskron_stand] ${n}`),
    ...extra
  );
  const block = heardHere ? listenBlock() : null;
  if (block) lines.push(block);
  else if (!heardHere)
    lines.push(
      "Команда сторожа не выдаётся: сокет у другого держателя, местного нет — эта сессия кадры и приглашения не принимает."
    );
  else lines.push("Сокета у моста нет — слушать нечем; проверь ответ connect.");
  if (!heardHere) lines.push("Слух — у другого держателя; здесь только атрибуция записей.");
  else if (how.startsWith("сокет уже держит") || how.startsWith("возврат места с диска"))
    lines.push("Сокет держит этот мост (hello получен при открытии сокета).");
  else {
    const hello = await awaitHello(4e3);
    if (hello) lines.push(`hello получен: ожидало кадров — ${hello.pending ?? 0}.`);
    else
      lines.push(
        "hello за 4 с не пришёл — сокет мост держит, но доказательства слуха ещё нет: проверь доску."
      );
  }
  const hooks = await callTool("iskron_admin", { action: "list_webhooks", realm, node_id: karta });
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
    const h = await callTool("iskron_admin", {
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
      const s = await callTool("iskron_channel", {
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
  if (typeof a.status === "string" && a.status.trim() && !hasStatusAddressFor(realm, karta, name)) {
    lines.push(
      "Занятость не публикуется: статусного адреса этого стояния у моста нет — он у держателя сокета; take=true берёт слух и адрес сюда."
    );
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
var JSON_LINE = "Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; hint — семя превращения: только важное после сессии, не журнал; гроссбух сессии — в файле сессии и в кадре; строки CHECKS в ответе — работа этого такта.";
var MOMENT_LINE = "[мост] " + JSON_LINE;
var STATUS_LINE = '[мост] action="status" (realm, text) — занятость ЭТОГО стояния: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.';
var LEAVE_LINE = '[мост] action="leave" (realm) — уйти с места: исполняет мост — сокет закрыт, занятость снята, адрес, очередь и хуки целы; почта копится и придёт при возвращении (сторож или iskron_stand). Сам мост уходит только там, где кадр доходит лишь сторожем (Claude Code, Codex) и сторож не взведён 15 минут; в pi и OpenCode кадр приходит уведомлением, и мост места не бросает. Занятость снимается на конце сессии.';
function annotateToolList(reply2) {
  const tools = reply2?.result?.tools;
  if (!Array.isArray(tools)) return;
  if (!tools.some((t) => t?.name === STAND_TOOL.name)) tools.push(STAND_TOOL);
  for (const t of tools) {
    if (t && t.name === "iskron_channel" && typeof t.description === "string") {
      if (!t.description.includes(STATUS_LINE))
        t.description = `${t.description}

${STATUS_LINE}`;
      if (!t.description.includes(LEAVE_LINE)) t.description = `${t.description}
${LEAVE_LINE}`;
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
  ) : kind === "knock" ? "Nothing was applied and the grant is whole — a benign transition, not a broken authorization: retry the call now. Only a refusal that returns means the hour is real — that one names its own wait." : kind === "dead" ? "Nothing was applied, and no retry and no wait will change that — only a human with a new token can." : kind === "human" ? (
    // The agent reads this; the human does not. A retry buys nothing
    // and a wait shortens nothing — only handing the link over does.
    "Nothing was applied, and only the human can move this: hand them the link above — the login is already waiting for their click. Once they finish, retry the call."
  ) : "The call never reached the server, so nothing was applied — retry freely." : "The call went out and its answer was lost, so THE OUTCOME IS UNKNOWN — re-read the target before retrying: a blind retry can apply a second time, and a write with no version guard duplicates silently.";
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
var NET_BACKOFF_MS = (process.env.ISKRON_BRIDGE_NET_BACKOFF_MS || "1000,2000,4000").split(",").map(Number).filter((n) => Number.isFinite(n) && n >= 0);
var READ_TOOLS = /* @__PURE__ */ new Set([
  "iskron_look",
  "iskron_orient",
  "iskron_search",
  "iskron_semantic_search"
]);
function isRead(msg) {
  if (msg?.method === "initialize" || msg?.method === "tools/list") return true;
  return msg?.method === "tools/call" && READ_TOOLS.has(String(msg.params?.name ?? ""));
}
function lastServerAnswer(msg) {
  const cache = loadServerCache();
  const result = msg?.method === "initialize" ? cache.init : msg?.method === "tools/list" && !msg.params?.cursor ? cache.tools : null;
  return result ? { jsonrpc: "2.0", id: msg.id, result } : null;
}
function ownClient() {
  const info = state.initParams?.clientInfo;
  return typeof info?.name === "string" && OWN_CLIENTS.has(info.name);
}
function withNotice(reply2) {
  const content = reply2?.result?.content;
  if (!Array.isArray(content)) return reply2;
  const notice = takeNotice();
  if (notice && !content.some((c) => c?.text?.includes("ПОСТАВКА ОТСТАЛА"))) {
    content.push({ type: "text", text: notice });
  }
  return reply2;
}
async function deliver(msg) {
  const local = localStatus(msg) ?? localLeave(msg);
  if (local) {
    emit(await local);
    return;
  }
  const isInit = msg?.method === "initialize";
  if (isInit) state.initParams = msg.params;
  const harness = !ownClient();
  const hasId = msg?.id !== void 0 && msg?.id !== null;
  let authRetried = false;
  let heldRetried = false;
  let sessionRetried = false;
  let netTries = 0;
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
    if (m.id === msg.id && m.result) {
      if (isInit) saveServerCache({ init: m.result });
      else if (msg.method === "tools/list" && !msg.params?.cursor)
        saveServerCache({ tools: m.result });
    }
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
        emit(withNotice(await serialized(() => runStand(msg))));
        return;
      }
      if (isResumeCall(msg) || isCheckCall(msg)) {
        emit(await serialized(() => isResumeCall(msg) ? runResume(msg) : runCheck(msg)));
        return;
      }
      heldReply = null;
      const cross = hasId ? crossPlaceRefusal(msg) : null;
      if (cross) {
        emit(cross);
        return;
      }
      expectOwnRevoke(msg);
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
      if (e instanceof UpstreamError && e.kind === "network" && e.retryable && netTries < NET_BACKOFF_MS.length && (e.outcome === UpstreamError.NOT_SENT || isRead(msg))) {
        const pause = NET_BACKOFF_MS[netTries++];
        log(`${e.message} — knocking again in ${pause}ms (${netTries}/${NET_BACKOFF_MS.length})`);
        await new Promise((r) => setTimeout(r, pause));
        continue;
      }
      if (e instanceof UpstreamError && e.kind === "auth" && !authRetried) {
        authRetried = true;
        try {
          await ensureAuth(e.message, { force: true, rejected: e.presented });
          continue;
        } catch (authErr) {
          if (authErr instanceof HoldOffError && authErr.retryNow && !heldRetried) {
            heldRetried = true;
            authRetried = false;
            log(`${authErr.message} — repeating the call once`);
            await sleep(300);
            continue;
          }
          const standIn = hasId && harness ? lastServerAnswer(msg) : null;
          if (standIn) {
            log(`${msg.method} answered from the last server answer — ${errorMessage(authErr)}`);
            emit(standIn);
            return;
          }
          if (authErr instanceof TokenRefused) {
            if (hasId) emit(syntheticError(msg.id, authErr.message, outcome, "dead"));
            return;
          }
          if (authErr instanceof AuthPending) {
            if (hasId) emit(syntheticError(msg.id, authErr.message, outcome, "human"));
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
      if (e instanceof UpstreamError && (e.kind === "network" || e.kind === "auth" && harness) && hasId) {
        const cached = lastServerAnswer(msg);
        if (cached) {
          log(`${e.message} — ${msg.method} answered from the last server answer`);
          emit(cached);
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
var ORPHAN_FLOW_MS = Number(process.env.ISKRON_BRIDGE_ORPHAN_FLOW_MS) || 5 * 6e4;
function proxyWord() {
  const env = process.env;
  const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!proxy || process.versions.bun) return null;
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  const reads = major > 24 || major === 24 && minor >= 5;
  const flags = [...process.execArgv, ...(env.NODE_OPTIONS ?? "").split(/\s+/)];
  const on = env.NODE_USE_ENV_PROXY === "1" || flags.includes("--use-env-proxy");
  if (reads && on) return null;
  return reads ? "a proxy is set (HTTP(S)_PROXY), but Node reads it only under NODE_USE_ENV_PROXY=1 — add that variable to the bridge's env in the harness config; until then calls go around the proxy" : `a proxy is set (HTTP(S)_PROXY), but Node ${process.versions.node} does not read it at all — Node 24.5+ with NODE_USE_ENV_PROXY=1 or the Bun runtime does; until then calls go around the proxy`;
}
function bridgeMain(argv2) {
  guardStream(process.stdout);
  guardStream(process.stderr);
  setConfig(parseArgs(argv2));
  installAuthLockExitHook();
  installRefreshLockExitHook();
  log(
    `${BUILD} -> ${CFG.serverUrl} (timeout ${CFG.timeoutMs}ms, ${CFG.pat ? `personal access token from ${CFG.patSource}` : `auth in ${storePath()}`})`
  );
  const proxy = proxyWord();
  if (proxy) log(proxy);
  startTokenKeepalive();
  startFreshnessWatch(CFG.authDir, CFG.serverUrl);
  holdFromEnv();
  startDeafnessWatch();
  const rl = createInterface({ input: process.stdin, terminal: false });
  const pending2 = /* @__PURE__ */ new Set();
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
    pending2.add(p);
    p.finally(() => pending2.delete(p));
  });
  let leaving = null;
  const leave = (why) => leaving ??= windDown(why);
  const windDown = async (why) => {
    debug(`${why} — winding down`);
    const addr = statusAddress();
    releaseStanding(why);
    if (addr) await publishStatusTo(addr.url, "", 3e3).catch(() => {
    });
    await Promise.allSettled([...pending2, ...tokenRequestsInFlight]);
    await flushStdout();
    const flow = pendingFlow();
    if (flow) {
      log(
        `${why}, but an authorization flow is pending — staying up for the human's click, at most ${Math.round(ORPHAN_FLOW_MS / 1e3)}s`
      );
      await Promise.race([flow.catch(() => {
      }), sleep(ORPHAN_FLOW_MS)]);
    }
    await Promise.allSettled([...tokenRequestsInFlight]);
    await flushStdout();
    process.exit(0);
  };
  rl.on("close", () => void leave("stdin closed, the harness is gone"));
  process.on("SIGTERM", () => void leave("SIGTERM"));
  let interrupted = false;
  process.on("SIGINT", () => {
    const addr = statusAddress();
    releaseStanding("SIGINT");
    if (interrupted) process.exit(0);
    interrupted = true;
    const clearing = addr ? publishStatusTo(addr.url, "", 2e3).catch(() => {
    }) : null;
    if (!clearing && tokenRequestsInFlight.size === 0) process.exit(0);
    Promise.allSettled([...tokenRequestsInFlight, ...clearing ? [clearing] : []]).then(
      () => process.exit(0)
    );
  });
  process.on("uncaughtException", (e) => log(`uncaught: ${e?.stack || e}`));
  process.on(
    "unhandledRejection",
    (e) => log(`unhandled rejection: ${e?.stack || String(e)}`)
  );
}

// js/watchdog/codex.ts
import { existsSync as existsSync5 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { join as join11 } from "node:path";

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

// js/watchdog/client.ts
import { existsSync as existsSync4, readdirSync as readdirSync4, readFileSync as readFileSync11 } from "node:fs";
import { connect as connect2 } from "node:net";
import { join as join10 } from "node:path";
var ATTACH_WINDOW_MS = 6e4;
var RETRY_MS = 1e3;
function parseWatchdogArgs(argv2) {
  const out4 = { authDir: authDirFromEnv() };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--auth-dir") out4.authDir = argv2[++i] ?? out4.authDir;
    else if (!a.startsWith("--") && !out4.key) out4.key = a;
  }
  return out4;
}
function resolveStanding(argv2) {
  const { key, authDir } = parseWatchdogArgs(argv2);
  const dir = standingsDirOf(authDir);
  const pathFor = (k) => socketPathOf(authDir, k);
  if (key) return { key, path: pathFor(key), authDir };
  const held = existsSync4(dir) ? readdirSync4(dir).filter((f) => f.endsWith(".key")).map((f) => {
    try {
      return readFileSync11(join10(dir, f), "utf8").trim();
    } catch {
      return "";
    }
  }).filter(Boolean) : [];
  if (held.length === 1) return { key: held[0], path: pathFor(held[0]), authDir };
  if (held.length === 0) {
    return {
      error: "мост не держит ни одного стояния — назовись одним вызовом iskron_stand(realm, karta, model): его ответ назовёт команду слушания"
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
  const home = process.env.CODEX_HOME?.trim() || join11(homedir5(), ".codex");
  return join11(home, "app-server-control", "app-server-control.sock");
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
  if (!existsSync5(socketPath)) {
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
        case "stale":
          void deliver2(ev.text ?? "Искрон: лежалые кадры");
          break;
        case "dead":
        case "evicted":
          note(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно");
          void deliver2(ev.text ?? "Искрон: стояние потеряно — назовись заново: iskron_stand").then(
            () => process.exit(1)
          );
          break;
        case "alive":
          note(ev.text ?? "ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает — мост держит место");
          void deliver2(ev.text ?? "Искрон: сокет рвут, а служба отвечает — мост держит место");
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
var LINE_MAX = 400;
function wrapLines(text, max = LINE_MAX) {
  const out4 = [];
  for (const line of text.split("\n")) {
    let rest2 = line;
    while ([...rest2].length > max) {
      const head = [...rest2].slice(0, max).join("");
      const cut = head.lastIndexOf(" ");
      const at2 = cut > max / 2 ? cut : head.length;
      out4.push(rest2.slice(0, at2).trimEnd());
      rest2 = rest2.slice(at2).trimStart();
    }
    out4.push(rest2);
  }
  return out4;
}
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
        case "frame": {
          const f = ev.frame;
          if (f?.type !== "message") {
            log2(ev.raw ?? "");
            break;
          }
          for (const line of wrapLines(frameToText(f, ev.raw ?? ""))) log2(line);
          break;
        }
        case "note":
          log2(ev.text ?? "");
          break;
        case "stale":
          for (const line of wrapLines(ev.text ?? "")) log2(line);
          break;
        case "dead":
        case "evicted":
          loudExit(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно", 1);
          break;
        case "alive":
          log2(ev.text ?? "ДЕЛАТЕЛЬ: сокет рвут, а служба отвечает — мост держит место");
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
import { createHash as createHash4 } from "node:crypto";
import { writeSync as writeSync2 } from "node:fs";
function frameId(ev) {
  const id = ev.frame?.id;
  return typeof id === "string" && id ? id : `raw:${createHash4("sha256").update(ev.raw ?? "").digest("hex").slice(0, 16)}`;
}
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
  const seenPath = seenFilePathOf(target.authDir, target.key);
  const seen2 = seenIds(seenPath);
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const type = ev.frame?.type;
          if (type !== "message") return note2(`кадр ${type ?? "не разобран"} — не повод будить`);
          const id = frameId(ev);
          if (seen2.has(id)) return note2(`кадр ${id} уже отдан прежним взводом — не повод будить`);
          wake(ev.raw ?? "");
          noteSeen(seenPath, id, seen2);
          process.exit(0);
          break;
        }
        case "stale":
          for (const f of ev.frames ?? [])
            if (typeof f.id === "string" && f.id) noteSeen(seenPath, f.id, seen2);
          note2(ev.text ?? "лежалые кадры");
          break;
        case "dead":
        case "alive":
        case "evicted":
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
import { createHash as createHash5 } from "node:crypto";
import { existsSync as existsSync6, readdirSync as readdirSync5, readFileSync as readFileSync12 } from "node:fs";
import { homedir as homedir6 } from "node:os";
import { dirname as dirname3, join as join12 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
var out = (s) => {
  process.stdout.write(s + "\n");
};
var hashOf2 = (buf) => createHash5("sha256").update(buf).digest("hex").slice(0, 8);
var seconds = (ms) => `${Math.round(ms / 1e3)}s`;
function homeCopyReport() {
  const home = homeBridgePath();
  let self = null;
  try {
    self = readFileSync12(fileURLToPath4(import.meta.url));
  } catch {
  }
  if (!existsSync6(home)) {
    out(`домашняя копия: нет (${home}) — её кладёт establish-mcp при подключении`);
    return;
  }
  const bytes = readFileSync12(home);
  if (self && bytes.equals(self)) {
    out(`домашняя копия: ${home} — та же сборка, что и этот файл`);
    return;
  }
  const v = versionIn(bytes.toString("utf8"));
  out(
    `домашняя копия: ${home} — v${v ?? "?"}+${hashOf2(bytes)}, ДРУГИЕ байты: ${self ? `обнови её из поставки: cp "${fileURLToPath4(import.meta.url)}" ${home}` : "этот файл не читается"}`
  );
}
function serverSourceWord() {
  switch (CFG.serverSource) {
    case "argument":
      return "аргумент запуска";
    case "ISKRON_BRIDGE_URL":
      return "переменная ISKRON_BRIDGE_URL";
    case "file":
      return `файл выбора ${serverChoicePath(CFG.authDir)}`;
    default:
      return `по умолчанию; сменить — node <мост> use en | ru | <url>, файл ${serverChoicePath(CFG.authDir)}`;
  }
}
var freshnessWord = (url) => isProductionServer(url) ? "продовый адрес: самообновление с релизов поставки включено" : "другой инстанс: обновлений с релизов поставки нет";
async function serverReport() {
  out(`сервер: ${CFG.serverUrl} (${serverSourceWord()})`);
  out(`  ${freshnessWord(CFG.serverUrl)}`);
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
  if (existsSync6(path)) out(`  хранилище OAuth ${path} есть, но не читается, пока стоит PAT`);
}
function grantReport() {
  const path = storePath();
  out(`грант: ${path}`);
  if (!existsSync6(path)) {
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
  for (const suffix of [".auth-pending", ".refreshing"]) {
    if (existsSync6(path + suffix)) out(`  замок: ${path + suffix}`);
  }
  const logPath = grantLogPath();
  if (existsSync6(logPath)) {
    const lines = readFileSync12(logPath, "utf8").trim().split("\n").slice(-3);
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
function claudePluginReport() {
  const registry = join12(homedir6(), ".claude", "plugins", "installed_plugins.json");
  if (!existsSync6(registry)) return;
  try {
    const reg = JSON.parse(readFileSync12(registry, "utf8"));
    const mine = Object.entries(reg.plugins ?? {}).filter(([k]) => /^iskron@/.test(k));
    if (!mine.length) {
      out(`Claude Code: плагин iskron не установлен (${registry})`);
      return;
    }
    for (const [key, installs] of mine) {
      for (const inst of installs) {
        const manifest = inst.installPath ? join12(inst.installPath, ".mcp.json") : "";
        let entry = "запись моста в манифесте не найдена";
        if (manifest && existsSync6(manifest)) {
          try {
            const m = JSON.parse(readFileSync12(manifest, "utf8"));
            const hit = Object.entries(m.mcpServers ?? {}).find(
              ([, v]) => (v.args ?? []).some((a) => /iskron\.mjs/.test(a))
            );
            if (hit) entry = `запись «${hit[0]}» → мост из плагина`;
          } catch {
            entry = `${manifest} не читается`;
          }
        }
        out(
          `Claude Code: плагин ${key} v${inst.version ?? "?"} (${inst.scope ?? "?"}) — ${entry}; ${inst.installPath ?? ""}`
        );
      }
    }
  } catch {
    out(`Claude Code: ${registry} не читается`);
  }
}
function codexHomes() {
  const homes = [
    process.env.CODEX_HOME?.trim() || "",
    join12(homedir6(), ".codex"),
    ...process.platform === "darwin" ? [join12(homedir6(), "Library", "Application Support", "orca", "codex-runtime-home", "home")] : []
  ].filter(Boolean);
  return [...new Set(homes)].filter((h) => existsSync6(h));
}
function codexPluginReport(home) {
  const cache = join12(home, "plugins", "cache");
  if (!existsSync6(cache)) return;
  let found = 0;
  for (const market of readdirSync5(cache)) {
    const marketDir = join12(cache, market);
    let plugins;
    try {
      plugins = readdirSync5(marketDir);
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      if (!/iskron/.test(plugin)) continue;
      const dir = join12(marketDir, plugin);
      const manifest = join12(dir, ".codex-plugin", "plugin.json");
      let word = "манифеста нет";
      if (existsSync6(manifest)) {
        try {
          const m = JSON.parse(readFileSync12(manifest, "utf8"));
          const hit = Object.values(m.mcpServers ?? {}).some(
            (v) => (v.args ?? []).some((a) => /iskron\.mjs/.test(a))
          );
          word = `v${m.version ?? "?"}, ${hit ? "запись моста в манифесте есть" : "записи моста в манифесте нет"}`;
        } catch {
          word = `${manifest} не читается`;
        }
      }
      found++;
      out(`Codex: плагин ${plugin}@${market} — ${word}; ${dir}`);
    }
  }
  if (!found) out(`Codex: плагина iskron в кэше нет (${cache})`);
}
function harnessReport() {
  claudePluginReport();
  const claude = join12(homedir6(), ".claude.json");
  if (existsSync6(claude)) {
    try {
      const cfg = JSON.parse(readFileSync12(claude, "utf8"));
      const entries = Object.entries(cfg.mcpServers ?? {}).filter(
        ([, v]) => (v.args ?? []).some((a) => /iskron/.test(a))
      );
      if (entries.length) {
        for (const [name, v] of entries) {
          out(`Claude Code: запись «${name}» → ${v.command ?? ""} ${(v.args ?? []).join(" ")}`);
        }
      } else
        out(
          "Claude Code: ручной записи моста в пользовательском конфиге нет (штатная — в плагине)"
        );
    } catch {
      out(`Claude Code: ${claude} не читается`);
    }
  }
  const opencodeDir = join12(homedir6(), ".config", "opencode");
  if (existsSync6(opencodeDir)) {
    const copy = join12(opencodeDir, "plugins", "iskron.js");
    const packaged = join12(dirname3(fileURLToPath4(import.meta.url)), "opencode-plugin.js");
    if (!existsSync6(copy)) {
      out(`OpenCode: плагина нет (${copy}) — его кладёт establish-mcp при подключении`);
    } else if (!existsSync6(packaged)) {
      out(
        `OpenCode: плагин ${copy} стоит; рядом с этим файлом поставки плагина нет, сверить не с чем`
      );
    } else if (readFileSync12(copy).equals(readFileSync12(packaged))) {
      out(`OpenCode: плагин ${copy} — та же сборка, что в поставке`);
    } else {
      out(`OpenCode: плагин ${copy} — ДРУГИЕ байты, обнови из поставки: cp "${packaged}" ${copy}`);
    }
  }
  for (const codexHome of codexHomes()) {
    out(`Codex: дом ${codexHome}`);
    codexPluginReport(codexHome);
    const door = join12(codexHome, "app-server-control", "app-server-control.sock");
    if (existsSync6(door)) out(`Codex: дверь app-server открыта (${door})`);
    else if (Buffer.byteLength(door) > 100)
      out(
        `Codex: двери нет и не будет — дом длиннее предела unix-сокета; нужен короткий дом для демона и сессий`
      );
    else
      out(
        `Codex: двери нет (${door}) — демон app-server не поднят; без неё кадр доставляет watchdog-exit`
      );
    const codex = join12(codexHome, "config.toml");
    if (existsSync6(codex)) {
      const text = readFileSync12(codex, "utf8");
      out(
        `Codex: ${/^\s*\[mcp_servers\."?iskron"?\]|^\s*mcp_servers\."?iskron"?\s*=/m.test(text) ? "ручная запись моста в config.toml есть" : "ручной записи моста в config.toml нет (штатная — в плагине)"}`
      );
    }
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
  out2(`сервер: ${CFG.serverUrl} (${serverSourceWord()}) — ${freshnessWord(CFG.serverUrl)}`);
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

// js/cli/use.ts
var out3 = (s) => {
  process.stdout.write(s + "\n");
};
function runUse(argv2) {
  let word;
  const rest2 = [];
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i] ?? "";
    if (a === "--auth-dir") rest2.push(a, argv2[++i] ?? "");
    else if (a.startsWith("--") || word) rest2.push(a);
    else word = a;
  }
  setConfig(parseArgs(rest2));
  const url = word ? resolveServerChoice(word) : null;
  if (!url) {
    out3("use: назови адрес — en (mcp.iskron.ai), ru (mcp.iskron.ru) или полный URL инстанса");
    process.exitCode = 2;
    return;
  }
  const path = writeServerChoice(CFG.authDir, url);
  out3(`мост смотрит на ${url} — записано в ${path}; ${freshnessWord(url)}`);
  out3(
    "Действует с нового процесса моста: перезапусти сессии харнеса. Грант раздельный по адресу — первый вызов на новом адресе ведёт во вход."
  );
}

// js/cli/iskron.ts
var USAGE = `iskron ${BUILD}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug]
  node iskron.mjs watchdog [ключ] [--auth-dir <dir>]
  node iskron.mjs watchdog-exit [ключ] [--auth-dir <dir>]
  node iskron.mjs watchdog-codex [ключ] [--auth-dir <dir>]   (из оболочки Codex: CODEX_THREAD_ID, CODEX_HOME)
  node iskron.mjs doctor [server-url] [--auth-dir <dir>]
  node iskron.mjs update [--auth-dir <dir>]
  node iskron.mjs use <en|ru|url> [--auth-dir <dir>]   (en — mcp.iskron.ai, ru — mcp.iskron.ru)
  node iskron.mjs --version
  env: ISKRON_BRIDGE_TOKEN — личный токен вместо OAuth (или файл <auth-dir>/token);
       ISKRON_BRIDGE_URL, ISKRON_BRIDGE_AUTH_DIR, ISKRON_BRIDGE_NO_BROWSER, ISKRON_BRIDGE_DEBUG
`;
var argv = process.argv.slice(2);
var [first, ...rest] = argv;
var LONG_LIVED = /* @__PURE__ */ new Set([void 0, "bridge", "watchdog", "watchdog-exit", "watchdog-codex"]);
var longLived = LONG_LIVED.has(first) || first !== void 0 && !first.startsWith("--") && !["doctor", "update", "use", "-h"].includes(first);
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
    case "use":
      runUse(rest);
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
