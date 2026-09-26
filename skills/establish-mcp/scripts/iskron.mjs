#!/usr/bin/env node

// js/shared/version.ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
var VERSION = "6.19.0";
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
import { createHash as createHash3 } from "node:crypto";
import {
  appendFileSync,
  mkdirSync as mkdirSync2,
  readFileSync as readFileSync4,
  renameSync as renameSync2,
  statSync,
  unlinkSync,
  writeFileSync as writeFileSync2
} from "node:fs";
import { join as join4 } from "node:path";

// js/bridge/config.ts
import { mkdirSync, readFileSync as readFileSync3, renameSync, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join3 } from "node:path";

// js/shared/lang.ts
import { readFileSync as readFileSync2 } from "node:fs";
import { join as join2 } from "node:path";

// js/shared/standings.ts
import { createHash as createHash2 } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
var defaultAuthDir = () => join(homedir(), ".iskron-bridge");
var authDirFromEnv = () => process.env.ISKRON_BRIDGE_AUTH_DIR?.trim() || defaultAuthDir();
var standingsDirOf = (authDir) => join(authDir, "standings");
var hashOf = (key) => createHash2("sha256").update(key).digest("hex").slice(0, 16);
function socketPathOf(authDir, key) {
  if (process.platform === "win32") return `\\\\.\\pipe\\iskron-${hashOf(key)}`;
  return join(standingsDirOf(authDir), `${hashOf(key)}.sock`);
}
var keyFilePathOf = (authDir, key) => join(standingsDirOf(authDir), `${hashOf(key)}.key`);
var holdFilePathOf = (authDir, key) => join(standingsDirOf(authDir), `${hashOf(key)}.hold`);
function seenFilePathOf(authDir, key, server = "") {
  if (!server) return join(standingsDirOf(authDir), `${hashOf(key)}.seen`);
  let origin = server;
  try {
    origin = new URL(server).origin;
  } catch {
  }
  return join(standingsDirOf(authDir), `${hashOf(key)}.${hashOf(origin).slice(0, 8)}.seen`);
}

// js/shared/lang.ts
function langOfUrl(url) {
  try {
    return /\.ai\.?$/i.test(new URL(url).hostname) ? "en" : "ru";
  } catch {
    return "ru";
  }
}
function forcedLang() {
  const v = process.env.ISKRON_BRIDGE_LANG?.trim().toLowerCase();
  return v === "en" || v === "ru" ? v : null;
}
function resolve() {
  const forced = forcedLang();
  if (forced) return forced;
  const fromEnv = process.env.ISKRON_BRIDGE_URL?.trim();
  if (fromEnv) return langOfUrl(fromEnv);
  try {
    const text = readFileSync2(join2(authDirFromEnv(), "server"), "utf8").trim();
    if (text) return langOfUrl(text);
  } catch {
  }
  return "ru";
}
var current = null;
function setServerLang(serverUrl) {
  current = forcedLang() ?? langOfUrl(serverUrl);
}
var lang = () => current ??= resolve();
var L = (ru, en) => lang() === "en" ? en : ru;

// js/bridge/streams.ts
var FLUSH_STOP_MS = 5e3;
var deadStreams = /* @__PURE__ */ new WeakSet();
function canWrite(s2) {
  return !!s2 && !deadStreams.has(s2) && !s2.destroyed && s2.writable !== false;
}
function guardStream(s2) {
  if (s2) s2.on("error", () => deadStreams.add(s2));
}
var stdoutBacklog = false;
function writeTo(s2, text) {
  if (!canWrite(s2)) return false;
  try {
    const fit = s2.write(text);
    if (s2 === process.stdout) {
      if (!fit && !stdoutBacklog) s2.once("drain", () => stdoutBacklog = false);
      stdoutBacklog = !fit;
    }
    return true;
  } catch {
    deadStreams.add(s2);
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
  return new Promise((resolve3) => {
    const out5 = process.stdout;
    if (!canWrite(out5)) return resolve3();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      out5.off("error", finish);
      out5.off("close", finish);
      resolve3();
    };
    out5.once("error", finish);
    out5.once("close", finish);
    if (stdoutBacklog) out5.once("drain", finish);
    else out5.write("", finish);
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
var serverChoicePath = (authDir) => join3(authDir, "server");
function readServerChoice(authDir) {
  try {
    const text = readFileSync3(serverChoicePath(authDir), "utf8").trim();
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
  setServerLang(cfg.serverUrl);
}
function parseArgs(argv2) {
  const cfg = {
    serverUrl: "",
    timeoutMs: Number(process.env.ISKRON_BRIDGE_TIMEOUT) || 12e4,
    authDir: process.env.ISKRON_BRIDGE_AUTH_DIR || join3(homedir2(), ".iskron-bridge"),
    clientName: "iskron-bridge",
    noBrowser: !!process.env.ISKRON_BRIDGE_NO_BROWSER,
    debug: !!process.env.ISKRON_BRIDGE_DEBUG,
    scope: process.env.ISKRON_BRIDGE_SCOPE || null,
    resource: process.env.ISKRON_BRIDGE_RESOURCE || null,
    staticClientId: process.env.ISKRON_BRIDGE_CLIENT_ID || null,
    pat: null,
    patSource: null,
    serverSource: "argument",
    // Только флагом: мост старше спутника на незнакомом флаге падает громко, а
    // переменную пропустил бы молча и встал бы полным местом с записью держания.
    satellite: false
  };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--timeout") cfg.timeoutMs = Number(argv2[++i]);
    else if (a === "--auth-dir") cfg.authDir = argv2[++i];
    else if (a === "--client-name") cfg.clientName = argv2[++i];
    else if (a === "--no-browser") cfg.noBrowser = true;
    else if (a === "--debug") cfg.debug = true;
    else if (a === "--satellite") cfg.satellite = true;
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
  const file = join3(cfg.authDir, "token");
  try {
    const text = readFileSync3(file, "utf8").trim();
    if (text) {
      cfg.pat = text;
      cfg.patSource = file;
    }
  } catch {
  }
}

// js/bridge/store.ts
var b64url = (buf) => Buffer.from(buf).toString("base64url");
var sha256 = (s2) => createHash3("sha256").update(s2).digest();
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function storePath() {
  const u = new URL(CFG.serverUrl);
  const h = b64url(sha256(u.origin + u.pathname)).slice(0, 10);
  return join4(CFG.authDir, `${u.hostname}_${h}.json`);
}
function loadStore() {
  try {
    return JSON.parse(readFileSync4(storePath(), "utf8"));
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
    return JSON.parse(readFileSync4(serverCachePath(), "utf8"));
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
  return join4(CFG.authDir, "grant.log");
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
  return join4(CFG.authDir, "standings.log");
}
function standingLog(msg) {
  appendJournal(standingsLogPath(), msg);
}
function grantStatePath() {
  return storePath() + ".grant-state";
}
function loadGrantState() {
  try {
    return JSON.parse(readFileSync4(grantStatePath(), "utf8"));
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
    const s2 = Number(loadStore().clock_skew_ms);
    clockSkewMs = Number.isFinite(s2) ? s2 : 0;
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
import { join as join5 } from "node:path";
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
  const powershell = join5(
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
  readFileSync as readFileSync5,
  renameSync as renameSync3,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync3
} from "node:fs";
import { connect } from "node:net";
import { basename, dirname, join as join6 } from "node:path";
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
  return new Promise((resolve3) => {
    if (!Number.isInteger(port)) return resolve3(false);
    const sock = connect({ host: "127.0.0.1", port });
    const done = (v) => {
      sock.destroy();
      resolve3(v);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}
function readAuthLock() {
  try {
    return JSON.parse(readFileSync5(authLockPath(), "utf8"));
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
      if (f.startsWith(prefix)) unlinkSync2(join6(dirname(authLockPath()), f));
    }
  } catch {
  }
}
function installAuthLockExitHook() {
  process.on("exit", () => {
    try {
      const l = JSON.parse(readFileSync5(authLockPath(), "utf8"));
      if (l.pid === process.pid && !l.authorize_url) unlinkSync2(authLockPath());
    } catch {
    }
  });
}

// js/bridge/oauth/callback.ts
import { createServer } from "node:http";
var PAGE_HOLD_MS = 2e4;
function bindCallback(port) {
  return new Promise((resolve3, reject) => {
    let handOff = null;
    let received = null;
    let browser = null;
    let mint = null;
    let loginKey = "";
    const deliver2 = (v) => {
      if (handOff) handOff(v);
      else received = v;
    };
    const esc = (s2) => String(s2).replace(
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
    const server = createServer((req, res) => {
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
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      server.on("error", (e) => log(`callback server: ${e.message}`));
      resolve3({
        port,
        report: (failure) => tellBrowser(
          failure ? `iskron-bridge: authorization failed (${esc(failure)}) — nothing was stored; the agent has the details.` : "iskron-bridge: authenticated — you can close this tab."
        ),
        close: () => {
          tellBrowser("iskron-bridge: the login was abandoned — nothing was stored.");
          server.close();
        },
        serveLogin: (key, fn) => {
          loginKey = key;
          mint = fn;
        },
        // No deadline by default: the login lives as long as the bridge holding
        // it, so a human who comes back to the tab late still lands it (graph
        // nks-dev: #4721). A bridge left by its harness bounds the wait itself.
        waitForCode: (expectedState, timeoutMs = 0) => new Promise((res, rej) => {
          const timer = timeoutMs > 0 ? setTimeout(
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
            if (timer) clearTimeout(timer);
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
  const current2 = readAuthLock();
  if (!published(current2)) return l;
  openTabOnce(current2);
  return current2;
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
    const current2 = readAuthLock();
    if (current2 && ours(current2)) writeAuthLock({ ...current2, client_id: client.client_id });
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
import { linkSync, mkdirSync as mkdirSync4, readFileSync as readFileSync6, unlinkSync as unlinkSync3, writeFileSync as writeFileSync4 } from "node:fs";
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
  let held2 = null;
  try {
    held2 = JSON.parse(readFileSync6(refreshLockPath(), "utf8"));
  } catch {
  }
  if (held2 && pidAlive(held2.pid) && Date.now() - held2.started_at < REFRESH_LOCK_STALE_MS) {
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
    const l = JSON.parse(readFileSync6(refreshLockPath(), "utf8"));
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
    const s2 = loadStore();
    if (tokenUsable(s2.tokens)) return s2.tokens;
  }
  const promise = (async () => {
    try {
      const s2 = loadStore();
      const rejected = opts.rejected ?? (force ? s2.tokens?.access_token ?? null : null);
      if (!force && tokenUsable(s2.tokens)) return s2.tokens;
      const meta = s2.meta?.as ? s2.meta : await discover(wwwAuthenticate);
      if (CFG.resource) meta.resource = CFG.resource;
      if (interactive && s2.tokens?.refresh_token && loginPublished() && refusalStands()) {
        const landed = usableTokens({ rejected });
        if (landed) return landed;
        return await interactiveFlow(meta, s2.tokens);
      }
      if (s2.tokens?.refresh_token) {
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
              return await interactiveFlow(meta, s2.tokens, heldNote(e.until), false);
            }
            if (e instanceof DeadGrantError) {
              if (!e.expired && rechecks < DEAD_RECHECK_MS.length && !loginPublished()) {
                const pause = DEAD_RECHECK_MS[rechecks++] ?? 0;
                debug(`refresh refused (${e.message}) — knocking again in ${pause}ms`);
                await sleep(pause);
                continue;
              }
              log(`refresh grant is dead (${e.message}) — starting a fresh authorization`);
              return await interactiveFlow(meta, s2.tokens);
            }
            throw e;
          }
        }
      }
      if (!interactive)
        throw new Error(
          "authorization required (no tokens, browser flow deferred) — or give the bridge a personal access token (ISKRON_BRIDGE_TOKEN, or the file <auth-dir>/token)"
        );
      return await interactiveFlow(meta, s2.tokens);
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
import * as diagnostics from "node:diagnostics_channel";
var PING_CHANNEL = "undici:websocket:ping";
var SILENT_INTERVALS = 3;
var SILENT_FLOOR_MS = Number(process.env.ISKRON_CHANNEL_SILENT_FLOOR_MS) || 6e4;
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
  const noAuthor = p.via === "room" && p.from_karta_seq == null && !p.from_standing;
  if (p.via === "platform" || p.auth === "none" || p.auth === "platform" || noAuthor)
    return "platform";
  if (p.as_person === true) return "human";
  if (p.from_karta_seq != null && p.user_karta_seq != null && p.from_karta_seq === p.user_karta_seq)
    return "human";
  if (myKarta != null && p.from_karta_seq != null && String(p.from_karta_seq) === String(myKarta))
    return "sibling";
  return "peer";
}
function isDirectWord(frame2) {
  if (frame2?.type !== "message") return false;
  const f = frame2;
  if (f.room || typeof f.event_kind === "string" && f.event_kind.startsWith("room."))
    return false;
  const p = frame2.provenance ?? {};
  if (p.via === "graph" || p.via === "room") return false;
  const origin = frame2.origin ?? classifyOrigin(frame2);
  if (origin === "platform") return false;
  return origin === "human" || !!p.from_standing || p.from_karta_seq != null;
}
function holdSocket(o) {
  let fastDrops = 0;
  let slowdown = 0;
  let dead = false;
  let stopped = false;
  let lastEviction = null;
  let retry = null;
  let ws = null;
  let lastLife = 0;
  let pingMs = 0;
  let runtimeSeesPings = false;
  let lastTick = 0;
  let watch = null;
  const onPing = (m) => {
    const from = m?.websocket;
    if (!ws || from !== void 0 && from !== ws) return;
    lastLife = Date.now();
    runtimeSeesPings = true;
  };
  diagnostics.subscribe?.(PING_CHANNEL, onPing);
  const unsubscribePing = () => {
    diagnostics.unsubscribe?.(PING_CHANNEL, onPing);
  };
  const stopWatch = () => {
    if (watch) clearInterval(watch);
    watch = null;
  };
  function open() {
    if (stopped) return;
    const startedAt = Date.now();
    const sock = new WebSocket(o.url);
    ws = sock;
    stopWatch();
    lastLife = startedAt;
    let gone = false;
    let opened = false;
    sock.addEventListener("open", () => {
      opened = true;
    });
    sock.addEventListener("ping", () => {
      if (ws !== sock) return;
      lastLife = Date.now();
      runtimeSeesPings = true;
    });
    sock.addEventListener("message", (e) => {
      if (stopped || ws !== sock) return;
      lastLife = Date.now();
      const raw = typeof e.data === "string" ? e.data : "[двоичный кадр]";
      let frame2 = null;
      if (typeof e.data === "string") {
        try {
          frame2 = JSON.parse(raw);
        } catch {
        }
      }
      if (frame2?.type === "hello") watchLife(Number(frame2.ping_interval_seconds) * 1e3);
      o.onFrame(raw, frame2 && typeof frame2 === "object" ? frame2 : null);
    });
    sock.addEventListener(
      "error",
      () => setTimeout(() => void dropped(1006), ERROR_GUESS_DELAY_MS)
    );
    sock.addEventListener("close", (e) => void dropped(e.code));
    function watchLife(interval) {
      stopWatch();
      if (!(interval > 0)) return;
      pingMs = interval;
      const every = Math.max(pingMs, 250);
      lastTick = Date.now();
      watch = setInterval(() => {
        const now2 = Date.now();
        if (now2 - lastTick > 2 * every + 1e3) lastLife = now2;
        lastTick = now2;
        if (stopped || ws !== sock || !runtimeSeesPings) return;
        const silent = now2 - lastLife;
        if (silent <= Math.max(SILENT_INTERVALS * pingMs + 1e3, SILENT_FLOOR_MS)) return;
        stopWatch();
        (o.onHung ?? o.onNote)?.(
          `соединение молчит ${Math.round(silent / 1e3)} с при пинге раз в ${pingMs / 1e3} с — подвисло без закрытия; переоткрываю тем же адресом. Кадры, пришедшие за время молчания, могли пропасть — сверь iskron_channel(action="history")`
        );
        try {
          sock.close();
        } catch {
        }
        void dropped(1006);
      }, every);
      watch.unref?.();
    }
    function yieldTo(cb, code) {
      if (dead) return;
      dead = true;
      stopped = true;
      if (retry) clearTimeout(retry);
      stopWatch();
      unsubscribePing();
      cb(code);
    }
    async function dropped(code) {
      if (stopped || ws !== sock) return;
      stopWatch();
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
      stopWatch();
      unsubscribePing();
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

// js/shared/seen.ts
import { appendFileSync as appendFileSync2, readFileSync as readFileSync7, renameSync as renameSync4, writeFileSync as writeFileSync5 } from "node:fs";
var SEEN_KEEP = 5e3;
var SEEN_SLACK = 1e3;
function eventKeyOf(frame2) {
  if (frame2?.provenance?.via !== "graph") return "";
  const body = frame2.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const ev = body.event_id;
  return typeof ev === "number" || typeof ev === "string" && ev ? `ev:${ev}` : "";
}
function deliveredKeys(frame2) {
  const id = typeof frame2?.id === "string" ? frame2.id : "";
  const ev = eventKeyOf(frame2);
  return [id, ev && frame2?.stale === true ? `evs:${ev.slice(3)}` : ev].filter(Boolean);
}
function seenIds(seenPath) {
  try {
    return new Set(readFileSync7(seenPath, "utf8").split("\n").filter(Boolean));
  } catch {
    return /* @__PURE__ */ new Set();
  }
}
function noteSeen(seenPath, id, seen) {
  if (seen.has(id)) return;
  seen.add(id);
  try {
    appendFileSync2(seenPath, id + "\n");
    if (seen.size > SEEN_KEEP + SEEN_SLACK) compact(seenPath, seen);
  } catch {
  }
}
function compact(seenPath, seen) {
  const file = [...seenIds(seenPath)];
  const inFile = new Set(file);
  const tail2 = [...[...seen].filter((x) => !inFile.has(x)), ...file].slice(-SEEN_KEEP);
  const tmp = `${seenPath}.${process.pid}.tmp`;
  writeFileSync5(tmp, tail2.join("\n") + "\n");
  renameSync4(tmp, seenPath);
  seen.clear();
  for (const x of tail2) seen.add(x);
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
  // Places in OTHER graphs on the same channel (#5838): register on the channel
  // in another graph adds a place, and a write is signed by the place of its
  // own graph. `standing` stays the place the socket was taken for; these ride
  // it and are replayed with it after every session turnover.
  places: [],
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
  const s2 = state.standing;
  if (!s2?.realm || s2.karta == null || !s2.name) return null;
  const h = `${s2.realm} ${s2.karta} ${s2.name}`;
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
  if (lang() === "en") headers["accept-language"] = "en";
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
var reinitHooks = [];
var onReinitialized = (hook) => {
  reinitHooks.push(hook);
};
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
      for (const hook of reinitHooks) void hook();
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

// js/bridge/complete.ts
function stampOrigin(frame2) {
  if (!frame2 || frame2.type !== "message") return frame2;
  return { ...frame2, origin: classifyOrigin(frame2, state.standing?.karta) };
}

// js/bridge/door.ts
import { chmodSync, mkdirSync as mkdirSync5, unlinkSync as unlinkSync6, writeFileSync as writeFileSync7 } from "node:fs";
import { createServer as createServer2 } from "node:net";

// js/shared/room-kinds.ts
var WORDS = {
  said: "слово от {author}",
  said_pending: "слово от {author} в полёте — текст придёт следом",
  // Адресное слово не мне (#6081): факт без тела; череда одной пары — одной строкой.
  aside: "{author} → {addressee}: слово [{word}]",
  aside_run: "{author} → {addressee}: {count} (последнее [{word}])",
  // Тело адресного слова не мне без самого слова в пачке — продолжение, не новое слово.
  aside_body: "{author} → {addressee}: текст слова [{word}]",
  word_one: "слово",
  word_few: "слова",
  word_many: "слов",
  body: "текст слова [{refers_to}] от {author}",
  body_aborted: "слово [{refers_to}] оборвано автором",
  body_lapsed: "слово [{refers_to}] оборвано платформой по сроку",
  closing: "ведущий {author} предлагает закрыть дело до {ends_at}{; свидетельства: evidence}",
  closing_may: 'ты можешь возразить — iskron_case(action="object", in_reply_to={entry_id}) (прежнее имя iskron_room)',
  closing_not: "возражать не тебе",
  closed: "дело закрыто: {reason}",
  objection: "{author} возражает против закрытия: {reason}",
  late_objection: "{author} возразил после закрытия",
  // Строка гроссбуха — ровно «[было] [сделал] = вердикт», примечание к не-ok, автор хвостом (норма владельца).
  progress: "[{key}] [{done}] = {verdict}{ — note} · {author}",
  opened: "дело открыл {author}",
  joined: "вошёл {who}",
  left: "вышел {who}{; причина: reason}",
  invite: "{author} зовёт {who} в дело",
  withdraw: "приглашение отозвано, отзывает {author}",
  node: "в деле узел #{seq} {name} ({realm}){; reasoning}",
  node_updated: "узел #{seq} {name} обновлён{; reasoning}",
  node_deleted: "узел #{seq} {name} удалён{; reasoning}",
  node_undeleted: "узел #{seq} {name} восстановлен{; reasoning}",
  link: "дело связано с №{room} ({rel})",
  auto: "запись платформы {code} о деле №{room}",
  unknown: "род {kind} мосту неизвестен",
  // Короткий кадр (frame-text.ts): дело, кто говорит, ответ — без сырого конверта.
  case: "№{room}",
  reply_to: "в ответ на [{id}]",
  stale: "лежалый",
  body_read: "тело: {how}",
  who_human: "человек{ @user}",
  who_role: "роль #{karta}",
  who_sibling: "брат по роли #{karta}",
  who_platform: "платформа — побудка",
  who_graph: "событие графа",
  legacy: "род {kind}{, стопка stack}",
  answer_case: "ответ: iskron_case({args})",
  answer_send: "ответ: iskron_channel({args})"
};
var WORDS_EN = {
  said: "message from {author}",
  said_pending: "message from {author} in flight — the text follows",
  aside: "{author} → {addressee}: message [{word}]",
  aside_run: "{author} → {addressee}: {count} (last [{word}])",
  aside_body: "{author} → {addressee}: text of message [{word}]",
  word_one: "message",
  word_few: "messages",
  word_many: "messages",
  body: "text of message [{refers_to}] from {author}",
  body_aborted: "message [{refers_to}] cut off by its author",
  body_lapsed: "message [{refers_to}] cut off by the platform on its deadline",
  closing: "the lead {author} proposes to close the case by {ends_at}{; evidence: evidence}",
  closing_may: 'you may object — iskron_case(action="object", in_reply_to={entry_id}) (former name iskron_room)',
  closing_not: "the objection is not yours to make",
  closed: "case closed: {reason}",
  objection: "{author} objects to closing: {reason}",
  late_objection: "{author} objected after the close",
  progress: "[{key}] [{done}] = {verdict}{ — note} · {author}",
  opened: "case opened by {author}",
  joined: "entered {who}",
  left: "left {who}{; reason: reason}",
  invite: "{author} invites {who} to the case",
  withdraw: "invitation withdrawn by {author}",
  node: "node #{seq} {name} ({realm}) in the case{; reasoning}",
  node_updated: "node #{seq} {name} updated{; reasoning}",
  node_deleted: "node #{seq} {name} deleted{; reasoning}",
  node_undeleted: "node #{seq} {name} restored{; reasoning}",
  link: "case linked to case №{room} ({rel})",
  auto: "platform record {code} about case №{room}",
  unknown: "kind {kind} is unknown to the bridge",
  case: "case №{room}",
  reply_to: "in reply to [{id}]",
  stale: "stale",
  body_read: "body: {how}",
  who_human: "human{ @user}",
  who_role: "role #{karta}",
  who_sibling: "sibling of role #{karta}",
  who_platform: "platform — a wake-up",
  who_graph: "graph event",
  legacy: "kind {kind}{ · stack}",
  answer_case: "answer: iskron_case({args})",
  answer_send: "answer: iskron_channel({args})"
};
var AUTO_WORDS = {
  child_opened: "дочернее дело №{room} открыто",
  child_closing: "дочернее дело №{room} закрывается",
  child_closed: "дочернее дело №{room} закрыто",
  child_late_objection: "позднее возражение в дочернем деле №{room}"
};
var AUTO_WORDS_EN = {
  child_opened: "child case №{room} opened",
  child_closing: "child case №{room} is closing",
  child_closed: "child case №{room} closed",
  child_late_objection: "late objection in child case №{room}"
};
var REL_WORDS = {
  parent: "дочернее к нему",
  child: "родительское к нему",
  continues: "продолжает его"
};
var REL_WORDS_EN = {
  parent: "its child",
  child: "its parent",
  continues: "continues it"
};
var VERDICT_WORDS = {
  ok: "ok",
  partial: "частично",
  bad: "slop"
};
var VERDICT_WORDS_EN = {
  ok: "ok",
  partial: "partial",
  bad: "slop"
};
var words = () => lang() === "en" ? WORDS_EN : WORDS;
var phrase = (key, values = {}) => fill(words()[key] ?? "", values);
var autoWords = () => lang() === "en" ? AUTO_WORDS_EN : AUTO_WORDS;
var relWords = () => lang() === "en" ? REL_WORDS_EN : REL_WORDS;
var NODE_OPS = {
  updated: "node_updated",
  deleted: "node_deleted",
  undeleted: "node_undeleted"
};
var RULES = {
  said: "stack",
  body: "stack",
  closing: "interrupt",
  closed: "interrupt",
  objection: "interrupt",
  late_objection: "interrupt",
  invite: "mine",
  progress: "batch",
  opened: "batch",
  joined: "batch",
  left: "batch",
  withdraw: "batch",
  node: "batch",
  link: "batch",
  // Запись платформы о связанном деле: признака прерывания у неё нет (#4925).
  auto: "batch"
};
var obj = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
var str = (v) => typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
function authorOf(author) {
  const a = obj(author);
  const name = str(a.name);
  const standing = str(a.standing);
  if (name) return standing ? `${name} (${standing})` : name;
  if (standing) return standing;
  return a.kind === "platform" ? L("платформа", "platform") : "?";
}
var after = (key, prefix) => key.startsWith(prefix) ? key.slice(prefix.length) : key;
function fill(template, v) {
  return template.replace(/\{([^\w{}]*)(\w+)\}/g, (_m, sep, name) => {
    const x = str(v[name]);
    if (sep) return x ? sep + x : "";
    return x || "?";
  });
}
function roomOf(v) {
  const r = obj(v);
  return str(r.seq) || str(r.id) || str(v);
}
var mineOf = (frame2) => [str(frame2.to_standing_id), str(frame2.to_standing)].filter(Boolean);
function myRole(frame2, fields) {
  const ka = obj(fields.karta);
  const seq2 = str(ka.seq);
  if (!seq2 || seq2 !== str(frame2.karta_seq)) return false;
  const theirs = str(ka.realm);
  const mine = str(frame2.realm) || str(obj(frame2.room).realm);
  return !theirs || !mine || theirs === mine;
}
function whoOf(fields) {
  const st = obj(fields.standing);
  const ka = obj(fields.karta);
  const name = str(st.name) || str(ka.name);
  const addr = str(st.standing);
  return name && addr ? `${name} (${addr})` : name || addr;
}
function addresseeOf(v) {
  if (typeof v === "string") return v ? { addr: [v], label: v } : null;
  const o = obj(v);
  const handle = str(o.handle).replace(/^@/, "");
  const standing = str(o.standing) || (handle ? `@${handle}${str(o.name) ? `:${str(o.name)}` : ""}` : "");
  const id = str(o.id);
  const name = str(o.standing) ? str(o.name) : "";
  const label = name && standing ? `${name} (${standing})` : standing || str(o.name) || id;
  const addr = [standing, id].filter(Boolean);
  return addr.length ? { addr, label } : null;
}
function wordsCount(n) {
  const W = words();
  const m10 = n % 10;
  const m100 = n % 100;
  const w = lang() === "en" ? n === 1 ? W.word_one : W.word_many : m10 === 1 && m100 !== 11 ? W.word_one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? W.word_few : W.word_many;
  return `${n} ${w}`;
}
function roomKind(frame2) {
  if (!frame2 || typeof frame2 !== "object") return null;
  const f = frame2;
  const ek = f.event_kind;
  if (typeof ek !== "string" || !ek.startsWith("room.")) return null;
  const kind = ek.slice(5);
  const line = obj(f.line);
  const fields = obj(line.fields);
  const key = str(line.key);
  const mine = mineOf(f);
  const node = obj(fields.node);
  const byWhom = authorOf(
    kind === "body" && Object.keys(obj(f.in_reply_to_from)).length ? f.in_reply_to_from : line.author
  );
  const values = {
    kind,
    author: byWhom,
    key,
    done: line.done,
    verdict: (lang() === "en" ? VERDICT_WORDS_EN : VERDICT_WORDS)[str(line.verdict)] ?? line.verdict,
    note: line.note,
    ends_at: fields.ends_at,
    evidence: Array.isArray(fields.evidence) ? fields.evidence.map(str).join(", ") : "",
    entry_id: line.entry_id ?? f.entry_id,
    // Слово, которому body несёт текст или обрыв: refers_to строки, иначе in_reply_to конверта.
    refers_to: str(line.refers_to) || str(f.in_reply_to) || str(obj(f.word).entry_id),
    reason: fields.reason,
    target: after(key, "invite:"),
    // Ключ несёт id; имя приглашённого — в полях строки (наблюдено на бою: standing/karta с name).
    // Вошедший и ушедший — место fields.standing (уход по сроку пишет платформа, api 0.89.6), иначе автор.
    who: kind === "joined" || kind === "left" ? whoOf({ standing: fields.standing }) || byWhom : whoOf(fields) || after(key, "invite:"),
    room: roomOf(fields.room) || after(key, "link:"),
    rel: relWords()[str(fields.rel)] ?? fields.rel,
    code: fields.code,
    seq: node.seq,
    name: node.name,
    realm: node.realm,
    // reasoning дельты узла — тело записи node (line.done, body кадра), не поле (слово api, #6070).
    reasoning: kind === "node" ? line.done || f.body : void 0
  };
  const rule = RULES[kind];
  const author = str(values.author);
  if (!rule)
    return {
      kind,
      rule: "batch",
      words: fill(words().unknown, values),
      author,
      phase: null,
      known: false
    };
  const W = words();
  const word = kind === "said" || kind === "body";
  const withheld = word && f.body_withheld === true;
  const to = word ? addresseeOf(f.addressee) ?? (withheld ? { addr: ["?"], label: "?" } : null) : null;
  if (to && (withheld || mine.length && !to.addr.some((a) => mine.includes(a)))) {
    const counts = kind === "said";
    const pair = JSON.stringify([roomOf(f.room), author, to.addr[0]]);
    const id = counts ? values.entry_id : values.refers_to;
    const run = (n) => fill(n === 0 ? W.aside_body : n > 1 ? W.aside_run : W.aside, {
      ...values,
      word: id,
      addressee: to.label,
      count: wordsCount(n)
    });
    const aside = { pair, counts, run };
    const words2 = run(counts ? 1 : 0);
    return { kind, rule: "batch", words: words2, author, phase: null, known: true, aside };
  }
  const pending = kind === "said" && f.body_pending === true && !str(f.body) && !str(line.done);
  const aborted = kind === "body" && fields.aborted === true;
  const wordsOf = pending ? W.said_pending : aborted ? obj(line.author).kind === "platform" ? W.body_lapsed : W.body_aborted : kind === "auto" ? autoWords()[str(values.code)] ?? W.auto : (
    // op узла (bound | updated | deleted | undeleted): без op и bound — прежнее слово.
    kind === "node" && NODE_OPS[str(fields.op)] ? W[NODE_OPS[str(fields.op)]] : W[kind]
  );
  let text = fill(wordsOf ?? "", values);
  if (kind === "closing") {
    const may = Array.isArray(fields.may_object) ? fields.may_object.map((m) => typeof m === "string" ? m : str(obj(m).id)) : [];
    const myId = str(f.to_standing_id);
    const mayI = !!myId && may.includes(myId);
    text += "; " + fill(mayI ? W.closing_may : W.closing_not, values);
  }
  const stack = rule === "stack" ? (
    // Стопка решает у said и body; слово без стопки — прежним путём, вставкой.
    f.stack === "defer" ? "batch" : "interrupt"
  ) : rule === "mine" ? mine.includes(str(values.target)) || myRole(f, fields) ? "interrupt" : "batch" : rule;
  const phase = pending ? "pending" : aborted ? "aborted" : null;
  return { kind, rule: phase ? "batch" : stack, words: text, author, phase, known: true };
}
var byKind = (frame2) => roomKind(frame2) !== null;
var stackOf = (frame2) => roomKind(frame2)?.rule ?? (frame2?.stack === "defer" ? "batch" : "interrupt");

// js/shared/frame-text.ts
var rec = (v) => v && typeof v === "object" ? v : {};
var idOf = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
var ANSWERABLE = /* @__PURE__ */ new Set(["said", "body", "invite", "objection", "late_objection"]);
var ZACHIN = 40;
function caseOf(frame2) {
  const f = frame2;
  const room = rec(f.room);
  const n = idOf(room.seq) || idOf(room.id);
  if (!n) return null;
  const z = typeof room.zachin === "string" ? [...room.zachin.trim()] : [];
  const zachin = z.length > ZACHIN ? z.slice(0, ZACHIN).join("") + "…" : z.join("");
  const realm = idOf(room.realm) || idOf(f.realm);
  return { room: n, zachin, realm };
}
var caseKey = (frame2) => caseOf(frame2)?.room ?? "";
function caseHead(frame2, withZachin) {
  const c = caseOf(frame2);
  if (!c) return "";
  const no = phrase("case", { room: c.room });
  return withZachin && c.zachin ? `${no} «${c.zachin}»` : no;
}
function whoOf2(frame2, withPlace) {
  const p = frame2.provenance ?? {};
  const origin = frame2.origin ?? classifyOrigin(frame2);
  if (origin === "platform") return phrase("who_platform");
  if (p.via === "graph" && p.from_karta_seq == null && !p.from_standing) return phrase("who_graph");
  const place = withPlace && p.from_standing ? ` (${p.from_standing})` : "";
  if (origin === "human") return phrase("who_human", { user: p.user }) + place;
  const karta = p.from_karta_seq;
  if (karta == null) return p.from_standing ?? "";
  return phrase(origin === "sibling" ? "who_sibling" : "who_role", { karta }) + place;
}
function textOf(frame2) {
  if (roomKind(frame2)?.aside) return "";
  const b = frame2.body;
  return typeof b === "string" ? b : b === void 0 ? "" : JSON.stringify(b);
}
function tail(frame2, withReply) {
  const f = frame2;
  const parts = [];
  const to = idOf(f.in_reply_to) || idOf(frame2.provenance?.in_reply_to);
  if (withReply && to) parts.push(phrase("reply_to", { id: to }));
  if (frame2.stale === true) parts.push(phrase("stale"));
  if (typeof frame2.body_read === "string" && frame2.body_read !== "history")
    parts.push(phrase("body_read", { how: frame2.body_read }));
  return parts.length ? `, ${parts.join(", ")}` : "";
}
function frameToText(frame2, raw) {
  if (!frame2) return raw;
  const f = frame2;
  const origin = frame2.origin ?? classifyOrigin(frame2);
  const text = textOf(frame2);
  const c = caseOf(frame2);
  if (c) {
    const rk = roomKind(frame2);
    const line = rec(f.line);
    const entry = idOf(f.entry_id) || idOf(line.entry_id);
    const words2 = rk ? rk.words : phrase("legacy", { kind: f.kind, stack: typeof f.stack === "string" ? f.stack : "" });
    const author = rk?.author && !words2.includes(rk.author) ? rk.author : "";
    const who = origin === "platform" ? "" : whoOf2(frame2, false);
    const by = [author, who].filter(Boolean).join(", ");
    const withReply = rk?.kind !== "body";
    const head = `${caseHead(frame2, true)}${entry ? ` [${entry}]` : ""} ${words2}${by ? ` — ${by}` : ""}${tail(frame2, withReply)}`;
    const lines2 = [head];
    if (text && !words2.includes(text.trim())) lines2.push(text);
    const answerable = !rk || ANSWERABLE.has(rk.kind);
    if (answerable && origin !== "platform" && c.realm && entry) {
      const args = `realm="${c.realm}", action="say", room="#${c.room}", in_reply_to=${entry}`;
      lines2.push(phrase("answer_case", { args }));
    }
    return lines2.join("\n");
  }
  const p = frame2.provenance ?? {};
  const id = idOf(frame2.id);
  const lines = [`${whoOf2(frame2, true) || "?"}${tail(frame2, true)}`];
  if (text) lines.push(text);
  if (origin !== "platform" && id && (p.from_standing || p.from_karta_seq != null)) {
    const karta = p.from_karta_seq ?? p.user_karta_seq;
    const args = `action="send"${frame2.realm ? `, realm="${frame2.realm}"` : ""}${karta != null ? `, karta=${karta}` : ""}${p.from_standing ? `, standing="${p.from_standing}"` : ""}, in_reply_to="${id}"`;
    lines.push(phrase("answer_send", { args }));
  }
  return lines.join("\n");
}
var BATCH_TEXT = 160;
function batchLine(frame2, run, withZachin = true) {
  const f = frame2;
  const rk = roomKind(frame2);
  const head = caseHead(frame2, withZachin);
  const pre = head ? `${head} ` : "";
  if (rk?.aside) return pre + (run === void 0 ? rk.words : rk.aside.run(run));
  const line = rec(f.line);
  const e = f.entry_id ?? line.entry_id ?? f.id;
  const entry = typeof e === "number" || typeof e === "string" ? e : "?";
  const words2 = rk?.words ?? `${L("кадр", "frame")} ${typeof f.id === "string" ? f.id : "?"}`;
  const author = rk?.author && !words2.includes(rk.author) ? ` — ${rk.author}` : "";
  const flat = [...textOf(frame2).replace(/\s+/g, " ").trim()];
  const text = flat.length > BATCH_TEXT ? flat.slice(0, BATCH_TEXT).join("") + "…" : flat.join("");
  const dup = !!text && words2.includes(text);
  return `${pre}[${entry}] ${words2}${author}${tail(frame2, rk?.kind !== "body")}${text && !dup ? `: ${text}` : ""}`;
}
function foldAsides(frames) {
  const asides = frames.map((f) => roomKind(f)?.aside ?? null);
  const out5 = [];
  let n = 0;
  asides.forEach((a, i) => {
    if (!a) {
      n = 0;
      out5.push(1);
      return;
    }
    n = (i > 0 && asides[i - 1]?.pair === a.pair ? n : 0) + (a.counts ? 1 : 0);
    out5.push(asides[i + 1]?.pair === a.pair ? null : n);
  });
  return out5;
}
function batchHead(frames) {
  return L(
    `Дело: кадров ${frames.length} — накопились, не прерывая хода; ${batchPointer(frames)}; следом по строке на кадр.`,
    `Case: ${frames.length} frames — gathered without interrupting the turn; ${batchPointer(frames)}; one line per frame follows.`
  );
}
function batchPointer(frames) {
  const since = /* @__PURE__ */ new Map();
  for (const frame2 of frames) {
    const f = frame2;
    const room = f.room ?? {};
    const line = f.line ?? {};
    const n = room.seq ?? room.id;
    const e = Number(f.entry_id ?? line.entry_id);
    if (typeof n !== "number" && typeof n !== "string" || !Number.isFinite(e)) continue;
    const realm = room.realm ?? f.realm;
    const args = (typeof realm === "string" && realm ? `realm="${realm}", ` : "") + `action="history", room=${typeof n === "number" ? String(n) : JSON.stringify(n)}`;
    since.set(args, Math.min(since.get(args) ?? e, e));
  }
  const whole = L("целиком — ", "in full — ");
  if (!since.size) return `${whole}iskron_channel(action="history")`;
  return whole + [...since].map(([args, e]) => `iskron_case(${args}, since=${e - 1})`).join("; ") + L(
    " (старый тул без since — history с keep_cursor=true)",
    " (an older tool without since — history with keep_cursor=true)"
  );
}

// js/bridge/backlog.ts
var BACKLOG_MS = Number(process.env.ISKRON_BRIDGE_BACKLOG_MS) || 1500;
var BACKLOG_KEEP = 20;
var BODY_CAP = 800;
var at = (f) => typeof f.received_at === "string" ? f.received_at : "";
var Backlog = class {
  frames = [];
  /** Все кадры окна — пачка показывает первые BACKLOG_KEEP, отданными метятся все (#5831). */
  all = [];
  total = 0;
  /** Прямые слова окна — ушли отдельно; шапка называет их числом. */
  direct = 0;
  pending = 0;
  timer = null;
  flush = null;
  /** Открыть окно — по hello с pending либо по кадру платформы; открытое не продлевается, только пополняется. */
  open(expected, emit2) {
    this.pending = Math.max(this.pending, expected);
    this.flush = emit2;
    if (this.timer) return;
    this.timer = setTimeout(() => this.close(), BACKLOG_MS).unref();
  }
  /** Отдать накопленное сейчас — при отпускании стояния: неотданное не теряется молча. */
  flushNow() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.close();
  }
  /**
   * Положить живой кадр в пачку; false — окна нет или это прямое слово: кадр идёт
   * своим путём, отдельно и целиком. Повтор id, уже лежащего в окне, не считается.
   */
  note(frame2) {
    if (!this.timer) return false;
    if (isDirectWord(frame2)) {
      this.direct++;
      return false;
    }
    const id = typeof frame2.id === "string" ? frame2.id : "";
    if (id && this.all.some((f) => f.id === id)) return true;
    this.total++;
    this.all.push(frame2);
    if (this.frames.length < BACKLOG_KEEP) this.frames.push(frame2);
    return true;
  }
  close() {
    this.timer = null;
    const got = this.frames.splice(0).sort((a, b) => at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0);
    const all2 = this.all.splice(0);
    const count = this.total;
    const expected = this.pending;
    const direct = this.direct;
    this.total = 0;
    this.direct = 0;
    this.pending = 0;
    const emit2 = this.flush;
    this.flush = null;
    if (!got.length || !emit2) return;
    const bodies = got.map((f) => {
      const t = frameToText(f, JSON.stringify(f));
      return [...t].length > BODY_CAP ? [...t].slice(0, BODY_CAP).join("") + "…" : t;
    });
    const cut = count > got.length;
    const head = L(
      `Побудка: кадров ${count}` + (expected ? ` (ожидало в очереди: ${expected})` : "") + (cut ? `, здесь первые ${got.length}, не вошло ${count - got.length}` : "") + ' — пришли одной пачкой; разбери все, а не последний: полностью и не вошедшее — iskron_channel(action="history", view="log").' + (direct ? ` Прямых слов ${direct} — не здесь: каждое пришло отдельно и целиком.` : ""),
      `Wake-up: ${count} frames` + (expected ? ` (waiting in the queue: ${expected})` : "") + (cut ? `, the first ${got.length} here, ${count - got.length} left out` : "") + ' — they came as one batch; go through all of them, not the last one: in full and the rest — iskron_channel(action="history", view="log").' + (direct ? ` ${direct} direct messages are not here: each came on its own and whole.` : "")
    );
    emit2(
      {
        kind: "backlog",
        frames: got,
        pending: expected,
        text: `${head}

${bodies.join("\n\n")}`
      },
      all2
    );
  }
};

// js/bridge/fanout.ts
import { statSync as statSync2 } from "node:fs";

// js/bridge/stale.ts
var STALE_BURST_KEEP = 20;
var STALE_BURST_MS = 1500;
var BODY_CAP2 = 800;
var StaleBurst = class {
  /** Все кадры полосы — пачка показывает первые STALE_BURST_KEEP, отданными метятся все (#5831). */
  burst = [];
  timer = null;
  /**
   * Положить лежалый кадр в пачку; по истечении полосы `flush` получает одно событие
   * и все кадры полосы, показанные и нет. Повтор id, уже лежащего в пачке, — не второй кадр.
   */
  note(frame2, flush) {
    const id = typeof frame2.id === "string" ? frame2.id : "";
    if (!id || !this.burst.some((f) => f.id === id)) this.burst.push(frame2);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const all2 = this.burst.splice(0);
      if (!all2.length) return;
      const frames = all2.slice(0, STALE_BURST_KEEP);
      const bodies = frames.map((f) => {
        const t = frameToText(f, JSON.stringify(f));
        return [...t].length > BODY_CAP2 ? [...t].slice(0, BODY_CAP2).join("") + "…" : t;
      });
      flush(
        {
          kind: "stale",
          frames,
          // Сторож метит отданным и то, что пачка назвала числом: иначе оно вернётся с повтором (#5831).
          ...all2.length > frames.length ? { unshown: all2.slice(frames.length).flatMap((f) => deliveredKeys(f)) } : {},
          text: L(
            `Лежалых кадров: ${all2.length}` + (all2.length > frames.length ? `, здесь первые ${frames.length}, не вошло ${all2.length - frames.length}` : "") + ' — принятое, пока место не слушали, или повтор службы после пересборки сессии; хода не стоят, но прочти; полностью и не вошедшее — iskron_channel(action="history").',
            `Stale frames: ${all2.length}` + (all2.length > frames.length ? `, the first ${frames.length} here, ${all2.length - frames.length} left out` : "") + ' — taken while the seat was not listening, or the service repeating after a session rebuild; they are not worth a turn, but read them; in full and the rest — iskron_channel(action="history").'
          ) + "\n\n" + bodies.join("\n\n")
        },
        all2
      );
    }, STALE_BURST_MS).unref();
  }
  /** Лежит ли в копящейся пачке копия этого события графа (fanout.ts). */
  hasEvent(evKey) {
    return this.burst.some((f) => eventKeyOf(f) === evKey);
  }
  /** Вынуть из копящейся пачки копии события — живая копия будит, пачка нет (fanout.ts). */
  dropEvent(evKey) {
    for (let i = this.burst.length - 1; i >= 0; i--)
      if (eventKeyOf(this.burst[i]) === evKey) this.burst.splice(i, 1);
  }
  /** Забыть накопленное — при отпускании стояния. */
  drop() {
    this.burst.length = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
};

// js/bridge/fanout.ts
var lastRead = /* @__PURE__ */ new Map();
function givenIds(seenPath) {
  let stamp;
  try {
    const st = statSync2(seenPath);
    stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    lastRead.delete(seenPath);
    return /* @__PURE__ */ new Set();
  }
  const hit = lastRead.get(seenPath);
  if (hit?.stamp === stamp) return hit.ids;
  const ids = seenIds(seenPath);
  lastRead.set(seenPath, { stamp, ids });
  return ids;
}
function isDelivered(keys, seen, seenPath) {
  if (!keys.length) return false;
  if (keys.some((k) => seen.has(k))) return true;
  const given = givenIds(seenPath);
  return keys.some((k) => given.has(k));
}
function redundantCopy(frame2, ring, seen, seenPath, burst) {
  const ev = frame2?.type === "message" ? eventKeyOf(frame2) : "";
  if (!ev) return "";
  const stale = frame2?.stale === true;
  const keys = stale ? [ev, `evs:${ev.slice(3)}`] : [ev];
  if (isDelivered(keys, seen, seenPath) || ring.some((r) => eventKeyOf(r.frame) === ev)) return ev;
  if (stale) return burst.hasEvent(ev) ? ev : "";
  burst.dropEvent(ev);
  return "";
}

// js/bridge/roomstack.ts
var ROOM_BATCH_MS = Number(process.env.ISKRON_BRIDGE_ROOM_BATCH_MS) || 6e4;
var ROOM_BATCH_CAP = 20;
var HUMAN_WORDS_KEEP = 200;
var rec2 = (v) => v && typeof v === "object" ? v : {};
var idOf2 = (v) => typeof v === "number" || typeof v === "string" && v ? String(v) : "";
var entryOf = (frame2) => {
  const f = rec2(frame2);
  return idOf2(rec2(f.line).entry_id ?? f.entry_id);
};
var RoomBatch = class {
  held = [];
  timer = null;
  emit = null;
  add(raw, frame2, emit2) {
    this.emit = emit2;
    this.held.push({ raw, frame: frame2 });
    if (this.held.length >= ROOM_BATCH_CAP) return this.flushNow();
    this.timer ??= setTimeout(() => this.flushNow(), ROOM_BATCH_MS).unref();
  }
  /** entry_id слов человека в полёте: их тело — слово человека, не кадр пачки. */
  humanWords = /* @__PURE__ */ new Set();
  rememberHumanWord(entry) {
    if (!entry) return;
    this.humanWords.add(entry);
    const oldest = this.humanWords.values().next();
    if (this.humanWords.size > HUMAN_WORDS_KEEP && !oldest.done)
      this.humanWords.delete(oldest.value);
  }
  /** true — это было слово человека в полёте; память о нём снята. */
  forgetHumanWord(entry) {
    return !!entry && this.humanWords.delete(entry);
  }
  /** Вынуть из копящейся пачки слово в полёте, чей текст пришёл: отдан он будет своим телом. */
  dropWord(entry, dropped) {
    for (let i = this.held.length - 1; i >= 0; i--) {
      if (entryOf(this.held[i].frame) !== entry) continue;
      dropped(this.held[i].frame);
      this.held.splice(i, 1);
    }
    if (!this.held.length && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
  /** Лежит ли кадр в копящейся пачке — кольцо не отдаёт его прицепившемуся отдельно (door.ts). */
  holds(frame2) {
    return !!frame2 && this.held.some((h) => h.frame === frame2);
  }
  /** Отдать накопленное сейчас: по окну, по полной пачке, перед прерывающим, при отпускании. */
  flushNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const got = this.held.splice(0);
    const emit2 = this.emit;
    if (!got.length || !emit2) return;
    const of = got.length;
    const frames = got.map((h) => h.frame);
    const fold = foldAsides(frames);
    emit2({ kind: "note", text: batchHead(frames), batch: { at: 0, of } });
    got.forEach(
      (h, i) => emit2({
        kind: "frame",
        raw: h.raw,
        frame: h.frame,
        batch: {
          at: i + 1,
          of,
          ...fold[i] === null ? { folded: true } : roomKind(h.frame)?.aside ? { fold: fold[i] ?? 1 } : {}
        }
      })
    );
  }
};
function noteRoomKind(frame2) {
  const rk = roomKind(frame2);
  if (rk && !rk.known)
    log(`room frame ${String(frame2.id ?? "?")}: ${rk.words} — batched, not interrupting`);
}
function batchForWatchdogs(d, raw, frame2, emit2) {
  const rk = roomKind(frame2);
  const f = rec2(frame2);
  let human = (frame2.origin ?? classifyOrigin(frame2)) === "human";
  if (rk?.kind === "said" && rk.phase === "pending" && human)
    d.roomBatch.rememberHumanWord(entryOf(frame2));
  if (rk?.kind === "body") {
    const word = idOf2(rec2(f.line).refers_to ?? f.in_reply_to);
    if (d.roomBatch.forgetHumanWord(word) && rk.phase !== "aborted") {
      human = true;
      frame2.origin = "human";
      d.roomBatch.dropWord(word, (said) => {
        for (const k of deliveredKeys(said)) noteSeen(d.seenPath, k, d.seen);
      });
    }
  }
  if ((!human || rk?.phase || rk?.aside) && byKind(frame2) && stackOf(frame2) === "batch") {
    d.roomBatch.add(raw, frame2, emit2);
    return true;
  }
  d.roomBatch.flushNow();
  return false;
}

// js/bridge/sweep.ts
import { existsSync, readdirSync as readdirSync2, readFileSync as readFileSync9, statSync as statSync3, unlinkSync as unlinkSync5 } from "node:fs";
import { connect as connectLocal } from "node:net";
import { basename as basename2, join as join7 } from "node:path";

// js/bridge/holdrecord.ts
import { readFileSync as readFileSync8, unlinkSync as unlinkSync4, writeFileSync as writeFileSync6 } from "node:fs";
var holdFilePathFor = (key) => holdFilePathOf(CFG.authDir, key);
function keyOf(realm, karta, name) {
  return `${name || "_"}--${karta}--${realm}`.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}
var HOLD_RECORD_MAX_AGE_MS = 6 * 60 * 60 * 1e3;
var harnessSession = null;
function noteHarnessSession(id) {
  if (id) harnessSession = id;
}
var sessionOfBridge = () => harnessSession;
function leftOnDisk(key) {
  try {
    return JSON.parse(readFileSync8(holdFilePathFor(key), "utf8"))?.left === true;
  } catch {
    return false;
  }
}
function writeHoldRecord(key, rec3) {
  if (CFG.satellite) return;
  try {
    const session = harnessSession ?? rec3.session;
    const left = rec3.left ?? leftOnDisk(key);
    writeFileSync6(
      holdFilePathFor(key),
      JSON.stringify({
        ...rec3,
        session: session ?? void 0,
        left: left || void 0,
        at: Date.now()
      }) + "\n",
      { mode: 384 }
    );
  } catch (e) {
    log(`hold record not written: ${e.message}`);
  }
}
function markLeft(key, on) {
  const r = readHoldRecord(key);
  if (r && r.left === true !== on) writeHoldRecord(key, { ...r, left: on });
}
function readHoldRecord(key) {
  try {
    const r = JSON.parse(readFileSync8(holdFilePathFor(key), "utf8"));
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

// js/bridge/sweep.ts
function localSocketAlive(sock) {
  return new Promise((resolve3) => {
    if (process.platform !== "win32" && !existsSync(sock)) return resolve3(false);
    const probe = connectLocal(sock);
    const done = (v) => {
      probe.destroy();
      resolve3(v);
    };
    probe.once("connect", () => done(true));
    probe.once("error", () => done(false));
    probe.setTimeout(1e3, () => done(false));
  });
}
var SEEN_FILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
function sweepStale(authDir, mine) {
  const dir = standingsDirOf(authDir);
  if (!existsSync(dir)) return;
  const mineHash = basename2(seenFilePathOf(authDir, mine), ".seen");
  for (const f of readdirSync2(dir).filter((x) => x.endsWith(".seen"))) {
    const p = join7(dir, f);
    const [keyHash, serverHash] = f.split(".");
    if (keyHash === mineHash || existsSync(join7(dir, `${keyHash}.key`))) continue;
    try {
      if (serverHash === "seen" || Date.now() - statSync3(p).mtimeMs > SEEN_FILE_MAX_AGE_MS)
        unlinkSync5(p);
    } catch {
    }
  }
  for (const f of readdirSync2(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec3 = JSON.parse(readFileSync9(join7(dir, f), "utf8"));
      if (typeof rec3.at !== "number" || Date.now() - rec3.at > HOLD_RECORD_MAX_AGE_MS)
        unlinkSync5(join7(dir, f));
    } catch {
      try {
        unlinkSync5(join7(dir, f));
      } catch {
      }
    }
  }
  if (process.platform === "win32") return;
  for (const f of readdirSync2(dir).filter((x) => x.endsWith(".key"))) {
    const keyFile = join7(dir, f);
    let key;
    try {
      key = readFileSync9(keyFile, "utf8").trim();
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

// js/bridge/door.ts
var RING = 20;
var ENV_KEY = "env";
var Door = class {
  key;
  clients = /* @__PURE__ */ new Set();
  ring = [];
  /** Память доставленных кадров — та же, что читает сторож выхода (../shared/seen.ts). */
  seen;
  /** С какого мига ни один локальный клиент не слушает; null — слушают. */
  idleAt = Date.now();
  /** Пачки места — лежалая и побудки: у каждого места свои (#5838). */
  stale = new StaleBurst();
  backlog = new Backlog();
  /** Пачка кадров комнаты рода «в пачку» — для сторожей, не для клиентов уведомлений (roomstack.ts, #5851). */
  roomBatch = new RoomBatch();
  /** id места у платформы (hello standings[].standing_id) — по нему кадр находит дверь и занятость — место. */
  standingId = null;
  server = null;
  hooks;
  constructor(key, hooks) {
    this.key = key;
    this.hooks = hooks;
    this.seen = seenIds(this.seenPath);
  }
  /**
   * Место (ключ по имени, роли и графу) помнит отданное на своём сервере и после
   * моста; стояние без места (ключ "env") смешивает места — его память живёт с мостом.
   */
  get persistent() {
    return this.key !== ENV_KEY;
  }
  get seenPath() {
    return seenFilePathOf(CFG.authDir, this.key, this.persistent ? CFG.serverUrl : "");
  }
  get socketPath() {
    return socketPathOf(CFG.authDir, this.key);
  }
  push(raw, frame2) {
    this.ring.push({ raw, frame: frame2 });
    if (this.ring.length > RING) this.ring.shift();
  }
  broadcast(ev) {
    const line = JSON.stringify(ev) + "\n";
    for (const c of this.clients) {
      try {
        c.write(line);
      } catch {
        this.clients.delete(c);
      }
    }
  }
  open() {
    const path = this.socketPath;
    const key = this.key;
    mkdirSync5(standingsDirOf(CFG.authDir), { recursive: true, mode: 448 });
    sweepStale(CFG.authDir, key);
    writeFileSync7(keyFilePathOf(CFG.authDir, key), key + "\n", { mode: 384 });
    if (process.platform !== "win32") {
      try {
        unlinkSync6(path);
      } catch {
      }
    }
    const gone = (sock) => {
      this.clients.delete(sock);
      if (this.clients.size === 0) this.idleAt = Date.now();
    };
    const srv = createServer2((sock) => {
      this.clients.add(sock);
      this.idleAt = null;
      sock.on("close", () => gone(sock));
      sock.on("error", () => gone(sock));
      this.hooks.onAttach();
      const backlog = this.ring.filter(
        ({ frame: frame2 }) => frame2?.type !== "message" || !isDelivered(deliveredKeys(frame2), this.seen, this.seenPath) && !this.roomBatch.holds(frame2)
      );
      sock.write(
        JSON.stringify({
          kind: "attached",
          key,
          buffered: backlog.length,
          seen: this.seenPath
        }) + "\n"
      );
      for (const { raw, frame: frame2 } of backlog) {
        sock.write(JSON.stringify({ kind: "frame", raw, frame: frame2 }) + "\n");
      }
      const late = this.hooks.lateEvent();
      if (late) sock.write(JSON.stringify(late) + "\n");
    });
    srv.on(
      "error",
      (e) => this.hooks.onError(
        `ДЕЛАТЕЛЬ: локальный сокет стояния не поднялся (${e.message}) — сторожу не к чему цепляться`
      )
    );
    srv.listen(path, () => {
      if (process.platform !== "win32") {
        try {
          chmodSync(path, 384);
        } catch {
        }
      }
      log(`standing socket held; local listeners attach at ${path}`);
    });
    this.server = srv;
  }
  /** Отдать неотданные пачки сейчас — при отпускании: побудки и комнаты (backlog.ts). */
  flushBatches() {
    this.backlog.flushNow();
    this.roomBatch.flushNow();
  }
  /**
   * Закрыть дверь: клиенты, сервер, файлы ключа и сокета. Идемпотентно. Память
   * отданного места (.seen по серверу) остаётся: место, возвращённое новым мостом,
   * получает от платформы ту же очередь снова и не должно отдать её второй раз
   * (#5831); лежалые файлы прибирает уборка по возрасту (sweep.ts). Память
   * стояния без места уходит с мостом, как прежде.
   */
  close() {
    this.flushBatches();
    this.stale.drop();
    for (const c of this.clients) {
      try {
        c.end();
      } catch {
      }
    }
    this.clients.clear();
    const srv = this.server;
    this.server = null;
    if (srv) {
      try {
        srv.close();
      } catch {
      }
    }
    for (const p of [
      keyFilePathOf(CFG.authDir, this.key),
      ...this.persistent ? [] : [this.seenPath]
    ]) {
      try {
        unlinkSync6(p);
      } catch {
      }
    }
    if (process.platform !== "win32") {
      try {
        unlinkSync6(this.socketPath);
      } catch {
      }
    }
    this.ring.length = 0;
    this.idleAt = null;
  }
};

// js/bridge/names.ts
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { hostname } from "node:os";
import { basename as basename3, dirname as dirname2, resolve as resolve2 } from "node:path";
var NAME_MAX = 48;
var normKarta = (k) => String(k ?? "").trim().replace(/^#/, "");
var normName = (n) => typeof n === "string" ? n.trim() : "";
var NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
var sanitize = (s2) => s2.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, NAME_MAX);
function nameFault(name) {
  if (name.length > NAME_MAX)
    return L(`длиннее предела: ${name.length} знаков`, `over the limit: ${name.length} signs`);
  if (!NAME_RE.test(name))
    return /[A-Z]/.test(name) ? L("заглавные буквы не допускаются", "capital letters are not allowed") : L(
      "недопустимые знаки или первый знак не буква и не цифра",
      "signs not allowed, or the first sign is neither a letter nor a digit"
    );
  return null;
}
var PART_MIN = 3;
var CUT_ORDER = ["repo", "host", "model"];
function fitName(parts) {
  const p = { ...parts };
  const join16 = () => [p.host, p.repo, p.model].filter(Boolean).join(".").replace(/[-.]+$/, "");
  const cut = [];
  for (const k of CUT_ORDER) {
    const over = join16().length - NAME_MAX;
    if (over <= 0) break;
    const keep = Math.max(k === "model" ? 1 : PART_MIN, p[k].length - over);
    if (keep >= p[k].length) continue;
    p[k] = p[k].slice(0, keep).replace(/[-.]+$/, "");
    cut.push(k);
  }
  return {
    name: join16().slice(0, NAME_MAX).replace(/[-.]+$/, ""),
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
var real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
function repoName(cwd = process.cwd()) {
  const top = git(["rev-parse", "--show-toplevel"], cwd);
  const [gitDir, common] = git(["rev-parse", "--git-dir", "--git-common-dir"], cwd).split("\n");
  if (!gitDir || !common || real(resolve2(cwd, gitDir)) === real(resolve2(cwd, common)))
    return basename3(top || cwd);
  const shared = real(resolve2(cwd, common));
  if (basename3(shared) === ".git") return basename3(dirname2(shared));
  const origin = git(["remote", "get-url", "origin"], cwd).replace(/\/+$/, "");
  const fromOrigin = basename3(origin.replace(/^.*:/, "/")).replace(/\.git$/, "");
  return fromOrigin || basename3(top || cwd);
}
function deriveParts(model2, cwd = process.cwd()) {
  const host = hostname().split(".")[0];
  const repo = repoName(cwd);
  const short2 = (model2 ?? "").trim().toLowerCase().replace(/^claude[-_]/, "");
  return { host: sanitize(host ?? ""), repo: sanitize(repo), model: sanitize(short2) };
}
var joinName = (p) => [p.host, p.repo, p.model].filter(Boolean).join(".");

// js/bridge/realms.ts
var aliases = /* @__PURE__ */ new Map();
var listing = null;
var CANON_RE = /@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/;
var trimmed = (r) => String(r ?? "").trim();
function canonRealm(r) {
  const t = trimmed(r);
  if (t.startsWith("@")) return t;
  return aliases.get(t) ?? t;
}
var resolvedRealm = (r) => canonRealm(r).startsWith("@");
function realmRelation(a, b) {
  const x = trimmed(a);
  const y = trimmed(b);
  if (x && x === y) return "same";
  if (!resolvedRealm(x) || !resolvedRealm(y)) return "unknown";
  return canonRealm(x) === canonRealm(y) ? "same" : "other";
}
var sameRealm = (a, b) => realmRelation(a, b) === "same";
var otherRealm = (a, b) => !!trimmed(a) && !!trimmed(b) && realmRelation(a, b) === "other";
var unknownRealm = (a, b) => !!trimmed(a) && !!trimmed(b) && realmRelation(a, b) === "unknown";
var unresolvedWord = (realm, held2) => `Отказано (мост): граф «${trimmed(realm)}» мост не разрешил в @owner/slug (списка графов нет или имени в нём нет) — тот ли это граф, что у мест моста (${held2.join(", ")}), не известно, и гадать нельзя. Повтори вызов с полным адресом графа @owner/slug.`;
function learnRealm(alias, canonical) {
  const t = trimmed(alias);
  if (t && !t.startsWith("@") && CANON_RE.test(canonical)) aliases.set(t, canonical);
}
var LIST_LINE_RE = /^ {4}(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) {2}(r\d+) {2}.* · /;
function learnRealmList(text) {
  const slugs = /* @__PURE__ */ new Map();
  for (const line of text.split("\n")) {
    const m = LIST_LINE_RE.exec(line);
    if (!m) continue;
    const [, c, short2] = m;
    learnRealm(short2, c);
    const slug = c.replace(/^@[^/]+\//, "");
    slugs.set(slug, [.../* @__PURE__ */ new Set([...slugs.get(slug) ?? [], c])]);
  }
  for (const [slug, cs] of slugs) if (cs.length === 1) learnRealm(slug, cs[0]);
}
async function resolveRealms(names2, list) {
  const open = names2.map(trimmed).filter((t) => t && !resolvedRealm(t));
  if (!open.length) return;
  listing ??= list().then(
    (text) => {
      if (text) learnRealmList(text);
    },
    () => {
    }
  ).finally(() => {
    listing = null;
  });
  await listing;
}

// js/bridge/places.ts
var extras = /* @__PURE__ */ new Map();
var keyOfPlace = (s2) => keyOf(s2.realm, s2.karta, s2.name ?? "");
var extraPlaces = () => [...extras.values()];
var extraIn = (realm) => extraPlaces().find((p) => sameRealm(p.standing.realm, realm));
function extraOf(realm, karta, name) {
  const p = extraIn(realm);
  return p && String(p.standing.karta) === normKarta(karta) && (p.standing.name ?? "") === normName(name) ? p : void 0;
}
function rememberPlace(s2) {
  state.places = state.places.filter((p) => !sameRealm(p.realm, s2.realm));
  state.places.push(s2);
}
function writeRecord(p, ch, status) {
  const s2 = p.standing;
  writeHoldRecord(p.door.key, {
    realm: s2.realm,
    karta: s2.karta,
    name: s2.name ?? "",
    url: ch.url,
    statusUrl: ch.statusUrl,
    status: status ?? readHoldRecord(p.door.key)?.status,
    cwd: ch.cwd ?? readHoldRecord(p.door.key)?.cwd,
    client: harnessName(),
    key: p.door.key
  });
}
function addExtra(s2, ch, hooks) {
  const key = keyOfPlace(s2);
  const have = extras.get(key);
  if (have) return key;
  for (const p of extraPlaces())
    if (sameRealm(p.standing.realm, s2.realm)) dropExtra(p.door.key, "другое место графа", true);
  const door2 = new Door(key, hooks);
  door2.open();
  const place = { standing: s2, door: door2 };
  extras.set(key, place);
  writeRecord(place, ch);
  standingLog(`held ${key} beside the channel`);
  return key;
}
function repointExtras(ch) {
  for (const p of extraPlaces()) writeRecord(p, ch);
}
function rememberExtraStatus(key, ch, text) {
  const p = extras.get(key);
  if (p) writeRecord(p, ch, text || "");
}
function dropExtra(key, reason, forget) {
  const p = extras.get(key);
  if (!p) return;
  extras.delete(key);
  p.door.close();
  if (forget) {
    dropHoldRecord(key);
    state.places = state.places.filter((s2) => keyOfPlace(s2) !== key);
  }
  standingLog(`released ${key}: ${reason}${forget ? " (record dropped)" : ""}`);
}
function dropAllExtras(reason, forget) {
  for (const k of [...extras.keys()]) dropExtra(k, reason, forget);
  if (forget) state.places = [];
}
var nameOfAddress = (a) => typeof a === "string" ? a.replace(/^.*:/, "") : "";
var all = (primary) => [...primary ? [primary] : [], ...extraPlaces()];
var unresolved = (realm) => !canonRealm(realm).startsWith("@");
function learnFromHello(hello, primary) {
  const listed = Array.isArray(hello?.standings) ? hello.standings : [];
  for (const p of all(primary)) {
    const same = listed.filter(
      (e2) => nameOfAddress(e2.standing) === (p.standing.name ?? "") && (e2.karta_seq == null || String(e2.karta_seq) === String(p.standing.karta))
    );
    const mine = same.filter((e2) => sameRealm(e2.realm, p.standing.realm));
    const e = mine.length === 1 ? mine[0] : unresolved(p.standing.realm) && same.length === 1 ? same[0] : null;
    if (!e) continue;
    if (e.realm && unresolved(p.standing.realm)) learnRealm(p.standing.realm, e.realm);
    if (typeof e.standing_id === "string" && e.standing_id) p.door.standingId = e.standing_id;
  }
}
function routeFrame(frame2, primary) {
  if (!frame2 || !extras.size) return { door: primary.door };
  const places = all(primary);
  const id = typeof frame2.to_standing_id === "string" ? frame2.to_standing_id : "";
  const byId = id ? places.find((p) => p.door.standingId === id) : void 0;
  if (byId) return { door: byId.door };
  const to = nameOfAddress(frame2.to_standing);
  if (!id && !to && frame2.realm == null && frame2.karta_seq == null) return { door: primary.door };
  const fits = places.filter(
    (p) => (frame2.realm == null || sameRealm(frame2.realm, p.standing.realm)) && (!to || to === (p.standing.name ?? "")) && (frame2.karta_seq == null || String(frame2.karta_seq) === String(p.standing.karta))
  );
  if (fits.length === 1) {
    if (id && !fits[0].door.standingId) fits[0].door.standingId = id;
    return { door: fits[0].door };
  }
  return {
    door: primary.door,
    note: `ДЕЛАТЕЛЬ: кадр ${String(frame2.id ?? "?")} (to_standing_id ${id || "—"}, ${frame2.to_standing ?? "—"}, граф ${frame2.realm ?? "—"}) не сопоставлен ни одному месту моста (${fits.length ? "подходят несколько" : "не подходит ни одно"}) — отдан основному месту ${primary.door.key}; сверь адрес кадра.`
  };
}

// js/bridge/hold.ts
function keyFor() {
  const s2 = state.standing;
  return s2 ? keyOf(s2.realm, s2.karta, s2.name ?? "") : ENV_KEY;
}
var standCwd = null;
function noteStandCwd(cwd) {
  const prev = standCwd;
  standCwd = cwd;
  if (cwd && currentKey && currentUrl) rememberStatus(readHoldRecord(currentKey)?.status ?? "");
  return prev;
}
var channel = () => currentUrl ? { url: currentUrl, statusUrl: currentStatusUrl, cwd: standCwd } : null;
function rememberStatus(text, realm) {
  const s2 = state.standing;
  const ch = channel();
  if (!s2 || !currentKey || !ch) return;
  const extra = realm ? extraIn(realm) : void 0;
  if (extra) return rememberExtraStatus(extra.door.key, ch, text);
  writeHoldRecord(currentKey, {
    realm: s2.realm,
    karta: s2.karta,
    name: s2.name ?? "",
    url: ch.url,
    statusUrl: currentStatusUrl,
    status: text || void 0,
    cwd: standCwd ?? readHoldRecord(currentKey)?.cwd,
    client: harnessName(),
    key: currentKey
  });
}
var holdsKey = (key) => !!holder?.alive && currentKey === key;
var ledKey = () => currentKey;
var holdsChannel = () => !!holder?.alive && !!currentKey;
var localSocketPathOf = (key) => socketPathOf(CFG.authDir, key);
function noteResuming(delta) {
  resuming += delta;
}
var holder = null;
var door = null;
var currentKey = null;
var currentUrl = null;
var currentStatusUrl = null;
var evictedKey = null;
var evictedEvent = null;
var parked = false;
var attachHooks = [];
var helloWaiters = /* @__PURE__ */ new Set();
var doorHooks = {
  onAttach: () => {
    for (const fn of attachHooks) fn();
  },
  lateEvent: () => evictedKey ? evictedEvent : null,
  onError: (text) => {
    log(text);
    notify("error", { kind: "note", text });
  }
};
var doors = () => [...door ? [door] : [], ...extraPlaces().map((p) => p.door)];
function isOwn(realm, karta, name) {
  const s2 = state.standing;
  if (!currentKey) return false;
  if (extraOf(realm, karta, name)) return true;
  return !!s2 && (s2.realm === realm || sameRealm(s2.realm, realm)) && String(s2.karta) === String(karta) && (s2.name ?? "") === name && currentKey === keyFor();
}
function holdsStanding(realm, karta, name) {
  return !!holder?.alive && isOwn(realm, karta, name);
}
function wasEvicted(realm, karta, name) {
  return !!evictedKey && evictedKey === currentKey && isOwn(realm, karta, name);
}
var hasStatusAddressFor = (realm, karta, name) => !!currentStatusUrl && !!currentKey && isOwn(realm, karta, name);
function statusAddress(realm) {
  if (!currentStatusUrl || !currentKey) return null;
  const d = (realm ? extraIn(realm)?.door : void 0) ?? door;
  return { url: currentStatusUrl, key: d?.key ?? currentKey, standingId: d?.standingId ?? null };
}
var heldPlaces = () => [
  ...door && state.standing ? [{ key: door.key, realm: state.standing.realm, primary: true }] : [],
  ...extraPlaces().map((p) => ({ key: p.door.key, realm: p.standing.realm, primary: false }))
];
var besideKeyIn = (realm) => extraIn(realm)?.door.key ?? null;
var isParked = (realm, karta, name) => parked && isOwn(realm, karta, name);
function listenerIdleSince() {
  if (!holder?.alive) return null;
  const ds = doors();
  if (!ds.length || ds.some((d) => d.clients.size > 0)) return null;
  return Math.max(...ds.map((d) => d.idleAt ?? 0));
}
function onListenerAttached(fn) {
  attachHooks.push(fn);
}
var localListeners = () => doors().reduce((n, d) => n + d.clients.size, 0);
var resuming = 0;
function awaitHello(timeoutMs) {
  const seen = door?.ring.find((r) => r.frame?.type === "hello")?.frame ?? null;
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve3) => {
    const done = (f) => {
      helloWaiters.delete(done);
      resolve3(f);
    };
    helloWaiters.add(done);
    setTimeout(() => done(null), timeoutMs).unref();
  });
}
var heldKey = (realm) => (realm ? besideKeyIn(realm) : null) ?? currentKey;
function broadcast(ev) {
  for (const d of doors()) d.broadcast(ev);
}
function notify(level, data) {
  emit({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: { level, logger: "iskron-channel", data }
  });
}
function addPlace(s2) {
  const ch = channel();
  const primary = state.standing;
  if (!holder?.alive || !ch || !primary || !otherRealm(primary.realm, s2.realm)) return null;
  return addExtra(s2, ch, doorHooks);
}
var standingIdIn = (realm) => (extraIn(realm)?.door ?? door)?.standingId ?? null;
function noteStandingId(realm, id) {
  const d = extraIn(realm)?.door ?? (state.standing && !otherRealm(realm, state.standing.realm) ? door : null);
  if (d && id) d.standingId = id;
}
var held = () => door && state.standing ? { standing: state.standing, door } : null;
function releaseStanding(reason, forget = false, keepBeside = false) {
  if (forget && currentKey) dropHoldRecord(currentKey);
  if (!keepBeside) dropAllExtras(reason, forget);
  if (!holder && !door) return;
  door?.flushBatches();
  standingLog(`released ${currentKey ?? "?"}: ${reason}${forget ? " (record dropped)" : ""}`);
  const released = { kind: "released", key: currentKey ?? void 0, text: reason };
  broadcast(released);
  notify("info", released);
  holder?.close(reason);
  holder = null;
  for (const w of [...helloWaiters]) w(null);
  door?.close();
  door = null;
  parked = false;
  currentKey = null;
  currentUrl = null;
  currentStatusUrl = null;
  evictedKey = null;
  evictedEvent = null;
}
function holdStanding(url, statusUrl2) {
  const key = keyFor();
  if (url === currentUrl && key === currentKey && holder?.alive) return key;
  const same = !!currentKey && currentKey === key;
  releaseStanding("новый сокет", !!currentKey && currentKey !== key, same);
  currentKey = key;
  currentUrl = url;
  currentStatusUrl = statusUrl2 || statusUrl(url);
  door = new Door(key, doorHooks);
  door.open();
  const s2 = state.standing;
  if (s2)
    writeHoldRecord(key, {
      status: readHoldRecord(key)?.status,
      realm: s2.realm,
      karta: s2.karta,
      name: s2.name ?? "",
      url,
      statusUrl: currentStatusUrl,
      cwd: standCwd ?? readHoldRecord(key)?.cwd,
      client: harnessName(),
      key,
      left: false
      // сокет держится снова — пометка ухода словом снята
    });
  const ch = channel();
  if (same && ch) repointExtras(ch);
  openHolder(url, key);
  standingLog(`held ${key}${standCwd ? ` cwd=${standCwd}` : ""}`);
  const place = s2 ? { realm: s2.realm, karta: String(s2.karta), name: s2.name ?? "" } : void 0;
  notify("info", { kind: "held", key, ...place ? { place } : {} });
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
  for (const d of doors())
    for (let i = d.ring.length - 1; i >= 0; i--)
      if (d.ring[i]?.frame?.type === "hello") d.ring.splice(i, 1);
  openHolder(currentUrl, currentKey);
  standingLog(`resumed ${currentKey}: socket reopened on the same address`);
  return true;
}
function deliverTo(d, raw, frame2, full) {
  const seenPath = d.seenPath;
  const id = full?.type === "message" && typeof full.id === "string" ? full.id : "";
  const evKey = redundantCopy(full, d.ring, d.seen, seenPath, d.stale);
  if (evKey) return log(`frame ${id || "?"} carries ${evKey} already offered — not raised`);
  const again = isDelivered(id ? [id] : [], d.seen, seenPath);
  if (full?.type === "message" && full.stale === true && !isDirectWord(full))
    return again ? log(`stale frame ${id} already delivered — dropped`) : d.stale.note(full, (ev2, all2) => {
      if (notifiedClient())
        for (const f of all2) for (const k of deliveredKeys(f)) noteSeen(seenPath, k, d.seen);
      d.broadcast(ev2);
      notify("info", keyed(d, ev2));
    });
  const text = full === frame2 ? raw : JSON.stringify(full);
  const hello = full?.type === "hello";
  for (const x of hello ? doors() : [d]) x.push(text, full);
  if (hello) for (const w of [...helloWaiters]) w(full);
  const ev = { kind: "frame", raw: text, frame: full };
  const msg = full?.type === "message" && !again ? full : null;
  if (msg) noteRoomKind(msg);
  const toBatch = (b) => (d.broadcast(b), notify("info", keyed(d, b)));
  if (msg && !notifiedClient() && batchForWatchdogs(d, text, msg, toBatch)) return;
  if (!again) for (const x of hello ? doors() : [d]) x.broadcast(ev);
  if (full?.type === "status") return;
  if (again) return log(`frame ${id} came again — already delivered, not raised`);
  if (notifiedClient()) {
    const flushBacklog = (b, all2) => {
      for (const f of all2) for (const k of deliveredKeys(f)) noteSeen(seenPath, k, d.seen);
      notify("info", keyed(d, b));
    };
    if (hello && Number(full.pending) > 0) d.backlog.open(Number(full.pending), flushBacklog);
    if (full?.type === "message") {
      if (full.origin === "platform") d.backlog.open(0, flushBacklog);
      if (d.backlog.note(full)) return;
    }
    for (const k of deliveredKeys(full)) noteSeen(seenPath, k, d.seen);
  }
  notify("info", keyed(d, ev));
}
var keyed = (d, ev) => d === door ? ev : { ...ev, key: d.key };
function openHolder(url, key) {
  holder = holdSocket({
    url,
    onFrame: (raw, frame2) => {
      void Promise.resolve(stampOrigin(frame2)).then((full) => {
        const primary = held();
        if (!primary) return door ? deliverTo(door, raw, frame2, full) : void 0;
        if (full?.type === "hello") learnFromHello(full, primary);
        const { door: d, note: note3 } = routeFrame(full?.type === "hello" ? null : full, primary);
        if (note3) {
          log(note3);
          d.broadcast({ kind: "note", text: note3 });
        }
        deliverTo(d, raw, frame2, full);
      });
    },
    onEvicted: (code) => {
      const text = `ДЕЛАТЕЛЬ: закрытие ${code} — место отняли, слушает другой держатель; привязка записей цела, занятость — пока адрес не повернули connect-ом; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека`;
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
    },
    // Подвисание: сторожу под Monitor — строкой, будящей агента; pi и OpenCode показывают уведомление человеку, агента оно не будит (#5380).
    onHung: (text) => {
      log(text);
      broadcast({ kind: "note", text });
      notify("warning", { kind: "note", text });
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
function listenBlock(realm) {
  const key = heldKey(realm);
  if (!key) return null;
  const self = fileURLToPath2(import.meta.url);
  const where = CFG.authDir === defaultAuthDir() ? "" : ` --auth-dir "${CFG.authDir}"`;
  const client = clientName();
  const monitor = L(
    `под Monitor — node "${self}" watchdog ${key}${where} с наибольшим timeout_ms, перевзводить по истечении (Claude Code)`,
    `under Monitor — node "${self}" watchdog ${key}${where} with the largest timeout_ms, re-armed when it runs out (Claude Code)`
  );
  const exit = L(
    `фоновой задачей — node "${self}" watchdog-exit ${key}${where} (выходит нулём на первом сообщении)`,
    `as a background task — node "${self}" watchdog-exit ${key}${where} (exits zero on the first message)`
  );
  const codex = L(
    `в Codex внутри одной длинной команды своей оболочки — node "${self}" watchdog-codex ${key}${where} & …; kill %1 (кадр входит в идущий тред через app-server; отдельной командой с nohup сторож умирает вместе с ней)`,
    `in Codex inside one long command of your shell — node "${self}" watchdog-codex ${key}${where} & …; kill %1 (a frame enters the running thread through app-server; as a separate nohup command the watchdog dies with it)`
  );
  const listen = NOTIFIED_CLIENTS.has(client) ? L(
    `Слушает ${client === PI_CLIENT ? "расширение pi" : "плагин OpenCode"} само — сторож не нужен, кадры входят в ход.`,
    `The ${client === PI_CLIENT ? "pi extension" : "OpenCode plugin"} listens itself — no watchdog needed, frames enter the turn.`
  ) : client === "claude-code" ? L(
    `Слушать: ${monitor}; без Monitor — ${exit}.`,
    `Listen: ${monitor}; without Monitor — ${exit}.`
  ) : /codex/i.test(client) ? L(
    `Слушать: ${codex}; без двери app-server — ${exit}.`,
    `Listen: ${codex}; without the app-server door — ${exit}.`
  ) : L(`Слушать: ${monitor}; ${exit}; ${codex}.`, `Listen: ${monitor}; ${exit}; ${codex}.`);
  return L(
    `[iskron-bridge] Сокет этого стояния держит мост — вручать его никому не нужно (строка выше о том, что никто не слушает, описывает миг до этого держания).
${listen}
Занятость: iskron_channel(action="status", realm, text) — пустой text снимает.
Кадры приходят и уведомлениями MCP (logger iskron-channel).`,
    `[iskron-bridge] The bridge holds this standing's socket — there is no one to hand it to (a line above saying no one listens describes the moment before this holding).
${listen}
Busy line: iskron_channel(action="status", realm, text) — an empty text clears it.
Frames also come as MCP notifications (logger iskron-channel).`
  );
}

// js/bridge/placefields.ts
var model = "";
var extras2 = /* @__PURE__ */ new Map();
var placeKey = (p) => `${String(p.realm ?? "")}|${normKarta(p.karta)}|${normName(p.name)}`;
var satelliteOf = "";
var satelliteOfId = "";
function noteSatelliteOf(address, id) {
  satelliteOf = address;
  satelliteOfId = CFG.satellite && id ? id : "";
}
function rememberModel(m) {
  if (typeof m === "string" && m.trim()) model = m.trim().replace(/^[^/]*\//, "");
}
function placeFields(place = {}) {
  const harness = harnessName();
  const extra = extras2.get(placeKey(place)) ?? {};
  return {
    ...model ? { model } : {},
    // Язык места (#6080): английский мост просит en; русский молчит — решает умолчание сервера.
    ...lang() === "en" ? { locale: "en" } : {},
    ...CFG.satellite && satelliteOfId ? { satellite_of: satelliteOfId } : {},
    attrs: {
      ...extra,
      build: { name: "iskron-bridge", version: VERSION, stamp: BUILD.split("+")[1] ?? "" },
      ...harness ? { harness } : {},
      ...satelliteOf ? { satellite_of: satelliteOf } : {}
    }
  };
}
var PLACE_ACTIONS = /* @__PURE__ */ new Set(["connect", "mint", "register"]);
var localeWarned = false;
function noteLocaleEcho(args, text) {
  const asked = args.locale;
  if (typeof asked !== "string" || localeWarned) return;
  const echo = /\blocale\b["']?\s*[:=]\s*["']?([a-z]{2})\b/i.exec(text)?.[1]?.toLowerCase();
  if (!echo || echo === asked) return;
  localeWarned = true;
  log(`locale: asked ${asked}, the server answered ${echo} — its prose stays in ${echo}`);
}
function withPlaceFields(args) {
  if (!PLACE_ACTIONS.has(String(args.action))) return args;
  rememberModel(args.model);
  if (args.attrs && typeof args.attrs === "object" && !Array.isArray(args.attrs))
    extras2.set(placeKey(args), { ...args.attrs });
  return { ...args, ...placeFields(args) };
}

// js/bridge/standing.ts
function noteStanding(msg, reply2) {
  const a = msg?.params?.arguments;
  if (msg?.params?.name !== "iskron_channel" || a?.action !== "register") return;
  if (reply2?.error || reply2?.result?.isError) return;
  const place = rememberedPlace(a.realm, a.karta, a.name);
  const prim = state.standing;
  if (prim && otherRealm(prim.realm, place.realm)) {
    rememberPlace(place);
    addPlace(place);
  } else state.standing = place;
  noteStandingId(place.realm, standingIdOf(reply2));
  state.standingSession = state.sessionId;
  debug(`standing remembered: ${a.name ?? "(unnamed)"} at karta ${a.karta} in ${a.realm}`);
}
function rememberedPlace(realm, karta, name) {
  const k = normKarta(karta);
  const prev = [state.standing, ...state.places].find((p) => p && !otherRealm(p.realm, realm));
  const n = typeof name === "string" ? normName(name) : void 0;
  return {
    realm: String(realm ?? ""),
    karta: k === "agent" && prev ? String(prev.karta) : k,
    ...n !== void 0 ? { name: n } : {}
  };
}
var standingInFlight = null;
function ensureStanding() {
  if (!state.standing || !state.sessionId) return Promise.resolve();
  if (state.standingSession === state.sessionId) return Promise.resolve();
  if (standingInFlight) return standingInFlight;
  standingInFlight = (async () => {
    try {
      const got = await replayRegister(state.standing);
      if (got && !got.error && !got.result?.isError) {
        if (await replayBeside()) state.standingSession = state.sessionId;
        log(`standing re-registered on the new session (${state.standing?.name ?? "unnamed"})`);
      } else if (seatIsGone(got)) {
        log(`the standing's seat is gone, forgetting it: ${replyText(got).slice(0, 200)}`);
        state.standing = null;
        releaseStanding("место у платформы истекло — register: места нет", true);
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
async function replayRegister(place) {
  const id = `iskron-bridge-restanding-${++state.reinitCounter}`;
  let reply2 = null;
  await post(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: {
        name: "iskron_channel",
        arguments: { ...place, ...placeFields(place ?? {}), action: "register" }
      }
    },
    (m) => {
      if (m.id === id) reply2 = m;
    }
  );
  return reply2;
}
async function replayBeside() {
  let whole = true;
  for (const place of [...state.places]) {
    const got = await replayRegister(place);
    if (got && !got.error && !got.result?.isError) continue;
    const key = keyOfPlace(place);
    if (seatIsGone(got)) {
      log(
        `the place ${key} is gone at the platform, forgetting it: ${replyText(got).slice(0, 200)}`
      );
      dropExtra(key, "место у платформы истекло — register: места нет", true);
      state.places = state.places.filter((p) => keyOfPlace(p) !== key);
    } else {
      whole = false;
      log(`could not re-register ${key} this time, will retry: ${replyText(got).slice(0, 200)}`);
    }
  }
  return whole;
}
function standingIdOf(reply2) {
  const m = /id этого места[^\n]*\n\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(
    replyText(reply2)
  );
  return m?.[1] ?? null;
}
var replyText = (reply2) => {
  if (!reply2) return "";
  if (reply2.error) return JSON.stringify(reply2.error);
  const content = reply2.result?.content;
  return Array.isArray(content) ? content.map((c) => c?.text ?? "").join("\n") : JSON.stringify(reply2.result ?? "");
};
var seatIsGone = (reply2) => /no such standing|take it with connect|такого стояния|занять.*connect/i.test(replyText(reply2));
var UNATTRIBUTED_CODE = /write_unattributed\w*|session_not_registered/;
var UNATTRIBUTED_REFUSAL = /не зарегистрирован[аоы]? ни за каким стоянием|hold no registered standing/i;
var isUnattributed = (reply2) => {
  if (!reply2) return false;
  const text = replyText(reply2);
  if (UNATTRIBUTED_CODE.test(text)) return true;
  return !!reply2.result?.isError && UNATTRIBUTED_REFUSAL.test(text);
};

// js/bridge/absorb.ts
var SOCKET_RE = /wss:\/\/[^\s"'`<>)\]]+|ws:\/\/(?:127\.0\.0\.1|\[?::1\]?|localhost)(?::\d+)?\/[^\s"'`<>)\]]+/;
var STATUS_RE = /https?:\/\/[^\s"'`<>)\]]+\/channel\/status\/[^\s"'`<>)\]]+/;
var trim = (s2) => s2.replace(/[.,;:!?»"')\]]+$/, "");
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
    state.standing = rememberedPlace(a.realm, a.karta, a.name);
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
  const s2 = state.standing;
  if (!s2 || besideKeyIn(a.realm)) return false;
  return names(a, s2) && !otherRealm(a.realm, s2.realm);
}
function names(a, s2) {
  const asked = typeof a.standing === "string" ? a.standing.trim() : "";
  const own = asked === "" || asked === "mine" || asked === (s2.name ?? "") || asked.endsWith(`:${s2.name ?? ""}`);
  return own && String(a.karta ?? s2.karta) === String(s2.karta);
}
function expectOwnRevoke(msg) {
  if (revokesOwn(msg)) setRevokingOwn(true);
}
function absorbRevokeReply(msg, reply2) {
  if (msg?.params?.name !== "iskron_channel" || msg?.params?.arguments?.action !== "revoke")
    return reply2;
  setRevokingOwn(false);
  const a = msg.params.arguments;
  if (reply2?.error || reply2?.result?.isError) {
    const held2 = extraPlaces().map((p) => p.door.key);
    const content = reply2.result?.content;
    if (revokesOwn(msg) && held2.length && Array.isArray(content))
      content.push({
        type: "text",
        text: `[iskron-bridge] ${state.standing?.name ?? "это место"} — основное место канала моста, а на канале стоят места других графов: ${held2.join(", ")}. Мост ничего не отпустил; снять основное — сперва сними их (revoke в их графе).`
      });
    return reply2;
  }
  const beside = extraIn(a.realm);
  if (beside && names(a, beside.standing)) {
    dropExtra(beside.door.key, "снято своим revoke", true);
    return reply2;
  }
  if (!revokesOwn(msg)) return reply2;
  const name = state.standing?.name ?? "unnamed";
  releaseStanding("снято своим revoke", true);
  state.standing = null;
  state.standingSession = null;
  log(`standing revoked by this session — released quietly, binding forgotten (${name})`);
  return reply2;
}

// js/bridge/call.ts
function leadsOtherPlace(realm, karta, name) {
  const led = ledKey();
  const prim = state.standing;
  if (!led || !prim) return null;
  const ex = extraIn(realm);
  const beside = ex?.door.key;
  const s2 = ex ? ex.standing : prim;
  if (!ex && otherRealm(realm, prim.realm)) return null;
  const k = normKarta(karta);
  const n = normName(name);
  const sameKarta = k === "agent" || k === String(s2.karta);
  return sameKarta && n === (s2.name ?? "") ? null : beside ?? led;
}
async function resolveAgainstLed(realm) {
  const prim = state.standing;
  if (!prim || !ledKey() || String(realm ?? "").trim() === prim.realm) return;
  await resolveRealms([realm, prim.realm, ...state.places.map((p) => p.realm)], async () => {
    const r = await callTool("iskron_realm", { action: "list" });
    return r.isError ? null : r.text;
  });
}
var heldRealms = () => [state.standing, ...state.places].filter((s2) => !!s2).map((s2) => canonRealm(s2?.realm));
function unresolvedRefusal(realm) {
  if (!ledKey() || !state.standing) return null;
  const held2 = [state.standing, ...state.places];
  return held2.some((s2) => unknownRealm(realm, s2.realm)) ? unresolvedWord(realm, heldRealms()) : null;
}
function otherPlaceWord(led, asked, sameName = false) {
  const advice = led === asked ? L(
    "ключи совпали — это то же место: повтори iskron_stand с take=true, чтобы переоткрыть его сознательно",
    "the keys match — it is the same seat: repeat iskron_stand with take=true to reopen it deliberately"
  ) : sameName ? L(
    "то же имя под другой ролью (оно вывелось из того же каталога) — передай другое name, либо iskron_stand с take=true, чтобы сменить место этого моста",
    "the same name under another role (derived from the same directory) — pass another name, or iskron_stand with take=true to change this bridge's seat"
  ) : L(
    "занять другое место вместо этого — iskron_stand с take=true (прежнее останется на доске без слуха; ненужное сними revoke)",
    "to take another seat instead of this one — iskron_stand with take=true (the former stays on the board without hearing; remove what is not needed with revoke)"
  );
  const Advice = `${advice.charAt(0).toUpperCase()}${advice.slice(1)}`;
  return L(
    `Отказано (мост): этот мост уже ведёт место ${led} — в графе место одно на мост, и место ${asked} его сняло бы с сокета молча. ${Advice}; держать оба разом — второй мост, то есть другая сессия харнесса; место в другом графе встаёт рядом само.`,
    `Refused (bridge): this bridge already leads the seat ${led} — one seat per bridge in a graph, and the seat ${asked} would silently take it off the socket. ${Advice}; holding both at once needs a second bridge, that is another harness session; a seat in another graph stands beside by itself.`
  );
}
function besideRefusal(realm, how) {
  const prim = state.standing;
  const led = ledKey();
  if (!led || !prim || !otherRealm(realm, prim.realm)) return null;
  if (how === "stand" && holdsChannel()) return null;
  return how === "connect" ? `Отказано (мост): этот мост ведёт место ${led}, а connect в другом графе открыл бы второй канал и снял бы его с сокета. Место в другом графе встаёт рядом на том же канале — iskron_stand(realm=…) или register.` : L(
    `Отказано (мост): этот мост ведёт место ${led}, но сокета канала у него сейчас нет (ушёл с места или место отняли) — место другого графа встать рядом не может. Сперва верни ${led}: iskron_stand его графа.`,
    `Refused (bridge): this bridge leads the seat ${led}, but has no channel socket now (it left the seat or the seat was taken) — a seat of another graph cannot stand beside. First bring back ${led}: iskron_stand for its graph.`
  );
}
var refusal = (msg, text) => ({
  jsonrpc: "2.0",
  id: msg.id,
  result: { isError: true, content: [{ type: "text", text }] }
});
function crossPlaceRefusal(msg) {
  if (msg?.method !== "tools/call" || msg.params?.name !== "iskron_channel") return null;
  const a = msg.params.arguments ?? {};
  if (!["connect", "mint", "register"].includes(String(a.action))) return null;
  const realm = typeof a.realm === "string" ? a.realm.trim() : "";
  const unresolved2 = unresolvedRefusal(realm);
  if (unresolved2) return refusal(msg, unresolved2);
  if (a.action !== "register") {
    const word = besideRefusal(realm, "connect");
    if (word) return refusal(msg, word);
  }
  const karta = normKarta(a.karta ?? state.standing?.karta ?? "");
  const name = normName(a.name);
  const led = leadsOtherPlace(realm, karta, name);
  if (!led) return null;
  const asked = keyOf(realm, karta, name);
  const sameName = name === (state.standing?.name ?? "");
  return refusal(msg, otherPlaceWord(led, asked, sameName));
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
    noteLocaleEcho(args, replyText(got));
    if (args.action === "register") noteStanding(msg, got);
    if (args.action === "connect") got = absorbChannelReply(msg, got);
  }
  return { text: replyText(got), isError: !!got.error || !!got.result?.isError };
}
var short = (s2, n = 300) => s2.length > n ? `${s2.slice(0, n)}…` : s2;
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
import { existsSync as existsSync2, readdirSync as readdirSync3, readFileSync as readFileSync10 } from "node:fs";
import { join as join8 } from "node:path";
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
  const realm = typeof a.realm === "string" ? a.realm : "";
  return (async () => {
    await resolveAgainstLed(realm);
    const st = await publishStatus(text, realm);
    if (!st.ok && !statusAddress()) return reply2(await notHeldHere(realm), true);
    if (st.code === 404) return reply2(`${st.body} ${TURNED_GUIDANCE()}`, true);
    if (st.ok) return reply2(`занятость ${statusAddress(realm)?.key}: ${text || "(снята)"}`);
    return reply2(st.body, true);
  })();
}
var lastPublished = "";
var publishedStatus = () => lastPublished;
async function publishStatus(text, realm, everyPlace = false) {
  const addr = statusAddress(realm);
  if (!addr) {
    return {
      ok: false,
      body: "Отказано (мост): этот мост места не держит, статусного адреса у него нет."
    };
  }
  if (!everyPlace && !addr.standingId && heldPlaces().length > 1)
    return {
      ok: false,
      body: `Отказано (мост): id места ${addr.key} у моста ещё не известен (hello его не назвал) — без него строка легла бы на все места канала; повтори iskron_stand этого графа.`
    };
  const st = await publishStatusTo(addr.url, text, 5e3, everyPlace ? null : addr.standingId);
  if (st.ok) {
    if (addr.key === statusAddress()?.key) lastPublished = text;
    rememberStatus(text, realm);
  }
  return st;
}
var TAKE_PATH = () => L(
  'iskron_stand с take=true — только по слову человека — переносит слух и статусный адрес сюда ОДИН раз: адрес остаётся у ЭТОГО экземпляра моста, и поднятый следом сторож его не уносит — по устройству: сторож есть локальный клиент сокета, своего connect он не делает (замер: два вызова занятости подряд при живом стороже, сборка 6.10.1; путь take наблюдала сторона nks-mcp на своей). Прежний держатель получит закрытие 4000 (вытесненному отбивать место назад тем же ходом не нужно — ему место рядом, имя.N); входной адрес и очередь места connect не трогает, ждавшее придёт в hello (справка iskron_channel action="?", connect); после переноса перевзведи сторожа командой из ответа',
  `iskron_stand with take=true — only on the human's word — moves the hearing and the status address here ONCE: the address stays with THIS bridge instance, and a watchdog raised after it does not carry it off — by design: the watchdog is a local client of the socket and makes no connect of its own. The former holder gets close 4000 (the evicted one need not take the seat back the same way — it gets a seat beside, name.N); connect does not touch the seat's incoming address and queue, what waited comes in hello (help: iskron_channel action="?", connect); after the move re-arm the watchdog with the command from the answer`
);
var TWO_ENTRIES = () => L(
  "Если место — твоё и держит его мост этой же сессии (в ней две записи iskron, плагинная и пользовательская), зови status тем же набором тулов, которым звал iskron_stand: передача не нужна.",
  "If the seat is yours and a bridge of this same session holds it (the session has two iskron entries, the plugin's and the user's), call status with the same tool set you called iskron_stand with: no move is needed."
);
var TURNED_GUIDANCE = () => `${TWO_ENTRIES()} ${L("Иначе", "Otherwise")} ${TAKE_PATH()}.`;
var slugOf = (realm) => realm.replace(/^@[^/]+\//, "");
async function heldElsewhere(realm) {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync2(dir)) return [];
  const anyRealm = !realm || /^r\d+$/.test(realm);
  const out5 = [];
  for (const f of readdirSync3(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec3 = JSON.parse(readFileSync10(join8(dir, f), "utf8"));
      if (!rec3?.realm || rec3.karta == null) continue;
      if (!anyRealm && slugOf(String(rec3.realm)) !== slugOf(realm)) continue;
      const key = keyOf(rec3.realm, rec3.karta, rec3.name ?? "");
      if (await localSocketAlive(socketPathOf(CFG.authDir, key))) out5.push({ ...rec3, key });
    } catch {
    }
  }
  return out5;
}
async function notHeldHere(realm) {
  const head = "Отказано (мост): этот мост места не держит, статусного адреса у него нет.";
  const others = await heldElsewhere(realm);
  if (!others.length)
    return `${head} Назовись одним вызовом iskron_stand(realm, karta, model, status) — занятость можно передать прямо в нём. Если место слушает другой держатель, iskron_stand скажет это; тогда ${TAKE_PATH()}.`;
  const list = others.map((r) => {
    const where = [r.cwd && `каталог ${r.cwd}`, r.client && `харнесс ${r.client}`].filter(
      Boolean
    );
    return where.length ? `${r.key} (${where.join(", ")})` : r.key;
  }).join("; ");
  return `${head} Места этого графа на этой машине держат живые мосты: ${list}. ${TURNED_GUIDANCE()}`;
}
async function publishStatusTo(url, text, timeoutMs = 5e3, standingId = null) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(standingId ? { text, standing_id: standingId } : { text }),
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
      code: 404,
      body: `Отказано (404) поверхностью: ${body || "без тела"} — этот адрес места больше не адресует: его мог повернуть connect другого держателя, а мог держать другой экземпляр моста той же сессии. Чей он теперь, мост отсюда не знает.`
    };
  if (!res.ok)
    return {
      ok: false,
      code: res.status,
      body: `Отказано (${res.status}) поверхностью: ${body || "без тела"}`
    };
  return { ok: true, body };
}

// js/bridge/leave.ts
var DEAF_MS = Number(process.env.ISKRON_BRIDGE_DEAF_MS) || 15 * 6e4;
var TICK_MS = Math.min(6e4, Math.max(200, Math.floor(DEAF_MS / 5)));
var deafWithoutListener = () => !notifiedClient();
var keptStatus = "";
var keptBeside = [];
async function leaveStanding(reason, byWord = false) {
  const beside = heldPlaces().filter((p) => !p.primary).map((p) => ({ realm: p.realm, text: readHoldRecord(p.key)?.status ?? "" })).filter((k) => k.text);
  const leaving = heldPlaces().map((p) => p.key);
  const parked2 = parkStanding(reason);
  if (!parked2) return "мост места не держит — уходить неоткуда";
  keptBeside = beside;
  keptStatus = publishedStatus();
  const st = await publishStatus("", void 0, true);
  if (st.ok && keptStatus) rememberStatus(keptStatus);
  if (byWord) for (const k of leaving) markLeft(k, true);
  const line = st.ok ? "занятость снята" : `занятость не снята (${st.body})`;
  log(`left the standing: ${reason}; ${line}`);
  const which = leaving.length > 1 ? `с мест ${leaving.join(", ")} (сокет канала у них общий)` : `с места ${parked2}`;
  return byWord ? `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится; место отпущено словом, само не вернётся — вернуть: iskron_stand тем же именем` : `ушёл ${which}: сокет закрыт, ${line}; адрес, очередь и хуки целы — почта копится и придёт при возвращении (сторож или iskron_stand)`;
}
function returnToStanding(how) {
  if (!resumeStanding()) return false;
  for (const p of heldPlaces()) markLeft(p.key, false);
  const text = `мост вернулся на место (${how}) — сокет открыт заново тем же адресом${keptStatus ? `, занятость «${keptStatus}» возвращена` : ""}`;
  log(text);
  if (keptStatus) {
    const line = keptStatus;
    keptStatus = "";
    void publishStatus(line).then((st) => {
      if (!st.ok) log(`busy line not restored after the return: ${st.body}`);
    });
  }
  for (const k of keptBeside.splice(0))
    void publishStatus(k.text, k.realm).then((st) => {
      if (!st.ok) log(`busy line of ${k.realm} not restored after the return: ${st.body}`);
    });
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
    const s2 = state.standing;
    if (!s2 || !holdsStanding(s2.realm, s2.karta, s2.name ?? "")) return;
    void leaveStanding(`никто не слушает ${Math.round(DEAF_MS / 6e4)} мин`);
  }, TICK_MS).unref();
}
function localLeave(msg) {
  if (msg?.method !== "tools/call" || msg?.params?.name !== "iskron_channel") return null;
  if (msg.params?.arguments?.action !== "leave") return null;
  const realm = msg.params.arguments.realm;
  const answer = (text, isError = false) => ({
    jsonrpc: "2.0",
    id: msg.id,
    result: { ...isError ? { isError: true } : {}, content: [{ type: "text", text }] }
  });
  return (async () => {
    await resolveAgainstLed(realm);
    const unresolved2 = unresolvedRefusal(realm);
    if (unresolved2) return answer(unresolved2, true);
    const beside = besideKeyIn(realm);
    if (beside)
      return answer(
        `Отказано (мост): место ${beside} стоит на общем канале моста рядом с ${ledKey()} — уход закрыл бы сокет всем местам канала. Уйти со всех — leave в графе ${state.standing?.realm ?? "основного места"}; снять только это место — revoke.`,
        true
      );
    if (state.standing && otherRealm(realm, state.standing.realm))
      return answer(
        `Отказано (мост): в графе ${String(realm)} этот мост места не держит — уходить неоткуда; его место ${ledKey()} в графе ${state.standing.realm} не тронуто.`,
        true
      );
    return answer(await leaveStanding("по слову делателя", true));
  })();
}

// js/bridge/stand.ts
import { statSync as statSync4 } from "node:fs";
import { isAbsolute } from "node:path";

// js/bridge/board.ts
function parseBoard(text) {
  const out5 = [];
  for (const line of text.split("\n")) {
    const m = /^\s*#(\d+)\s.*?·\s(@\S+)\s—\s(.*)$/.exec(line);
    if (m) {
      out5.push({ karta: m[1], address: m[2], rest: m[3], incoming: null, id: null });
      continue;
    }
    const inc = /📥\s*(https?:\/\/\S+)/.exec(line);
    if (inc && out5.length) out5[out5.length - 1].incoming = inc[1];
    const id = /^\s*id\s+([0-9a-f][0-9a-f-]{7,})\s*$/i.exec(line);
    if (id && out5.length) out5[out5.length - 1].id = id[1];
  }
  return out5;
}
var nameOf = (address) => address.slice(address.indexOf(":") + 1);
var listens = (e) => /(^|·)\s*слушает/.test(e.rest);
function undelivered(e) {
  const m = /не доставлено\s+(\d+)/.exec(e.rest);
  return m ? Number(m[1]) : 0;
}

// js/bridge/hook.ts
async function adminParamNames() {
  const id = `iskron-bridge-admin-schema-${++state.reinitCounter}`;
  let got = null;
  try {
    await post({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, (m) => {
      if (m.id === id) got = m;
    });
  } catch {
    return null;
  }
  const result = got?.result;
  const tools = result?.tools;
  if (!Array.isArray(tools)) return null;
  const admin = tools.find((t) => t?.name === "iskron_admin");
  if (!admin) return null;
  return new Set(Object.keys(admin.inputSchema?.properties ?? {}));
}
async function armRoleHook(p) {
  const { realm, karta, name } = p;
  const hooks = await callTool("iskron_admin", { action: "list_webhooks", realm, node_id: karta });
  const recognized = !hooks.isError && (/^\s*Вебхуки(?:\s|:|\(|$)/m.test(hooks.text) || /вебхуки не зарегистрированы/i.test(hooks.text));
  const nameRe = new RegExp(`:${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`);
  const wakesMe = recognized && hooks.text.split(/\n(?=\s*#\d+\s*→)/).some((b) => /активен/.test(b) && nameRe.test(b));
  const H = L("Хук инбокса роли", "Role inbox hook");
  if (p.sub)
    return L(
      `${H}: отдельному месту не взводится — почту роли слушает основное место, дела доставляют своё сами.`,
      `${H}: not armed for a separate seat — the main seat listens to the role's mail, cases deliver their own.`
    );
  if (wakesMe)
    return L(`${H}: стоит и будит это стояние.`, `${H}: in place and wakes this standing.`);
  if (!recognized)
    return L(
      `${H}: список хуков не распознан — не трогаю (${short(hooks.text, 120)}).`,
      `${H}: the hook list is not recognized — left alone (${short(hooks.text, 120)}).`
    );
  if (!p.heardHere)
    return L(
      `${H}: не взвожу — слух у другого держателя.`,
      `${H}: not armed — another holder has the hearing.`
    );
  if (p.beside) {
    const params = await adminParamNames();
    const noAddress = L(
      `у места этого графа своего входящего адреса нет (адрес — у канала, открытого в графе ${p.channelRealm})`,
      `this graph's seat has no incoming address of its own (the address is the channel's, opened in graph ${p.channelRealm})`
    );
    if (!params)
      return L(
        `${H}: не взведён — ${noAddress}, а схему тула iskron_admin прочесть не удалось (tools/list не ответил или iskron_admin в нём не нашёлся) — объявлен ли параметр channel, не известно; хук на канал (channel=self) не взвожу вслепую — повтори iskron_stand этого графа.`,
        `${H}: not armed — ${noAddress}, and the iskron_admin schema could not be read (tools/list did not answer or has no iskron_admin) — whether it declares channel is unknown; no blind hook on the channel (channel=self) — repeat iskron_stand for this graph.`
      );
    if (!params.has("channel"))
      return L(
        `${H}: не взведён — ${noAddress}, а тул iskron_admin(action="add_webhook") в этой поверхности параметра channel не объявляет; хук на канал (channel=self) взвести нечем — почта роли этого графа сокетом не приходит.`,
        `${H}: not armed — ${noAddress}, and iskron_admin(action="add_webhook") on this surface declares no channel parameter; nothing to arm a channel hook (channel=self) with — this graph's role mail does not come over the socket.`
      );
    const h2 = await callTool("iskron_admin", {
      action: "add_webhook",
      realm,
      node_id: karta,
      channel: "self"
    });
    return h2.isError ? L(
      `${H}: на канал (channel=self) не взвёлся — ${short(h2.text)}`,
      `${H}: not armed on the channel (channel=self) — ${short(h2.text)}`
    ) : L(
      `${H}: взведён на канал (channel=self) — почта роли этого графа идёт в тот же сокет месту этого графа (${short(h2.text, 120)}).`,
      `${H}: armed on the channel (channel=self) — this graph's role mail goes into the same socket to this graph's seat (${short(h2.text, 120)}).`
    );
  }
  if (!p.incoming)
    return L(
      `${H}: не взведён — входящий адрес стояния не прочитался.`,
      `${H}: not armed — the standing's incoming address did not read.`
    );
  const h = await callTool("iskron_admin", {
    action: "add_webhook",
    realm,
    node_id: karta,
    url: p.incoming
    // без ttl_seconds: 0 снимает срок только в update_webhook; на добавлении его отвергает контур (слово архитектора, #5380)
  });
  return h.isError ? L(`${H}: не взвёлся — ${short(h.text)}`, `${H}: not armed — ${short(h.text)}`) : L(
    `${H}: взведён на входящий адрес места (${short(h.text, 120)}).`,
    `${H}: armed on the seat's incoming address (${short(h.text, 120)}).`
  );
}

// js/bridge/resume.ts
import { existsSync as existsSync3, readdirSync as readdirSync4, readFileSync as readFileSync11 } from "node:fs";
import { join as join9 } from "node:path";
async function deadPredecessor(realm, karta, name) {
  const key = keyOf(realm, karta, name);
  if (!readHoldRecord(key)) return false;
  return !await localSocketAlive(localSocketPathOf(key));
}
async function resumeFromDisk(realm, karta, name) {
  const key = keyOf(realm, karta, name);
  const rec3 = readHoldRecord(key);
  if (!rec3) return null;
  if (holdsKey(key)) return null;
  const led = ledKey();
  if (led && led !== key) return null;
  if (await localSocketAlive(localSocketPathOf(key))) return null;
  const prev = state.standing;
  state.standing = { realm, karta, name };
  const prevCwd = rec3.cwd ? noteStandCwd(rec3.cwd) : null;
  noteResuming(1);
  try {
    holdStanding(rec3.url, rec3.statusUrl);
    const hello = await awaitHello(4e3);
    if (hello && holdsKey(key)) {
      const pending = Number(hello.pending) || 0;
      const me = sessionOfBridge();
      let busy = "";
      if (rec3.status && me && rec3.session === me) {
        const st = await publishStatus(rec3.status);
        busy = st.ok ? L(`; занятость возвращена: ${rec3.status}`, `; busy line restored: ${rec3.status}`) : L(
          `; занятость не возвращена: ${short(st.body)}`,
          `; busy line not restored: ${short(st.body)}`
        );
      } else if (rec3.status) {
        rememberStatus("");
        busy = L(
          "; прежняя строка занятости не возвращена — скажи свою",
          "; the former busy line is not restored — say your own"
        );
      }
      log(`standing resumed from disk (${key}), pending ${pending}`);
      standingLog(`resumed-from-disk ${key}: pending ${pending}`);
      return {
        word: L(
          `возврат места с диска после перезапуска моста — сокет открыт заново тем же адресом (ожидало кадров — ${pending})${busy}`,
          `the seat returned from disk after the bridge restarted — the socket reopened at the same address (frames waiting — ${pending})${busy}`
        ),
        pending
      };
    }
  } finally {
    noteResuming(-1);
  }
  log(`hold record for ${key} is stale — dropped, the place is taken anew`);
  releaseStanding("возврат с диска не удался", true);
  state.standing = prev;
  if (rec3.cwd) noteStandCwd(prevCwd);
  return null;
}
function recordsFor(sel) {
  const dir = standingsDirOf(CFG.authDir);
  if (!existsSync3(dir)) return { own: [], sameDir: [], legacy: [], left: [] };
  const mine = harnessName();
  const led = ledKey();
  const byKey = [];
  const byCwd = [];
  const sameDir = [];
  const legacy = [];
  const left = [];
  for (const f of readdirSync4(dir).filter((x) => x.endsWith(".hold"))) {
    try {
      const rec3 = JSON.parse(readFileSync11(join9(dir, f), "utf8"));
      if (!rec3 || rec3.client !== mine) continue;
      const key = keyOf(rec3.realm, rec3.karta, rec3.name);
      const keyed2 = !!sel.key && key === sel.key;
      const inDir = !!sel.cwd && rec3.cwd === sel.cwd;
      if (!keyed2 && !inDir) continue;
      const fresh = readHoldRecord(key);
      if (!fresh) continue;
      if (inDir) sameDir.push(key);
      if (fresh.left) {
        left.push(key);
        continue;
      }
      const stoodHere = key === led || !!sel.session && fresh.session === sel.session;
      if (keyed2) byKey.push(fresh);
      else if (stoodHere) byCwd.push(fresh);
      else if (!fresh.session) legacy.push(fresh.name);
    } catch {
    }
  }
  return {
    own: [...byKey, ...byCwd.sort((a, b) => (b.at ?? 0) - (a.at ?? 0))],
    sameDir,
    legacy,
    left
  };
}
var legacyWord = (names2) => names2.map((n) => `есть место прежней сборки без сессии: ${n} — вернуть: iskron_stand(name="${n}")`).join("; ");
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
  const { own: recs, sameDir, legacy, left } = recordsFor(sel);
  if (!recs.length) {
    const said = [
      `своей записи держания ${sel.key ? `с ключом ${sel.key}` : `для каталога ${sel.cwd ?? "?"}`} нет`
    ];
    const foreign = sameDir.filter((k) => !left.includes(k));
    if (foreign.length)
      said.push(
        `в каталоге лежат записи мест, на которых эта сессия не стояла (${foreign.join(", ")}); по одному каталогу они не берутся, место займёт iskron_stand`
      );
    if (left.length)
      said.push(
        `место отпущено словом держателя (leave): ${left.join(", ")} — само не вернётся, вернуть: iskron_stand тем же именем`
      );
    if (legacy.length) said.push(legacyWord(legacy));
    return {
      resumed: false,
      word: said.join(" — "),
      ...legacy.length ? { legacy } : {}
    };
  }
  const led = ledKey();
  const skipped = [];
  for (const rec3 of recs) {
    const key = keyOf(rec3.realm, rec3.karta, rec3.name);
    if (holdsKey(key)) return { resumed: true, key, pending: 0, word: "мост уже держит это место" };
    if (isParked(rec3.realm, rec3.karta, rec3.name)) return backToParked(key, "возврат по записи");
    if (led && led !== key) {
      skipped.push(`${key}: мост ведёт другое место ${led}`);
      continue;
    }
    if (await localSocketAlive(localSocketPathOf(key))) {
      skipped.push(`${key}: держит живой мост`);
      continue;
    }
    const back = await resumeFromDisk(rec3.realm, rec3.karta, rec3.name);
    if (!back) {
      skipped.push(`${key}: запись протухла — место займёт iskron_stand`);
      continue;
    }
    const lines = [back.word];
    if (register) {
      const r = await callTool("iskron_channel", {
        action: "register",
        realm: rec3.realm,
        karta: rec3.karta,
        name: rec3.name,
        ...placeFields(rec3)
      });
      lines.push(r.isError ? `register отказал — ${short(r.text)}` : "register");
    }
    const others = [
      .../* @__PURE__ */ new Set([...recs.map((r) => keyOf(r.realm, r.karta, r.name)), ...sameDir])
    ].filter((k) => k !== key && readHoldRecord(k) !== null);
    if (others.length) lines.push(`в том же каталоге записи и других мест: ${others.join(", ")}`);
    lines.push('место не твоё — iskron_channel(action="leave") отпустит его, канал цел');
    return { resumed: true, key, pending: back.pending, word: lines.join("; "), others };
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
  cwd: typeof msg.params?.cwd === "string" && msg.params.cwd.trim() ? msg.params.cwd.trim() : void 0,
  session: typeof msg.params?.session === "string" && msg.params.session.trim() ? msg.params.session.trim() : void 0
});
function selectorFrom(msg) {
  const sel = selectorOf(msg);
  noteHarnessSession(sel.session);
  return sel;
}
var isResumeCall = (msg) => msg?.method === "iskron/resume";
var isCheckCall = (msg) => msg?.method === "iskron/check";
async function runResume(msg) {
  const sel = selectorFrom(msg);
  if (!sel.key && !sel.cwd)
    return reply(msg, { resumed: false, word: "ни key, ни cwd не передан" });
  return reply(msg, await resumeBy(sel));
}
async function runCheck(msg) {
  const sel = selectorFrom(msg);
  const s2 = state.standing;
  const key = s2 ? keyOf(s2.realm, s2.karta, s2.name ?? "") : null;
  if (!s2 || !key || !holdsKey(key)) {
    if (s2 && key && isParked(s2.realm, s2.karta, s2.name ?? "")) {
      if (readHoldRecord(key)?.left)
        return reply(msg, {
          holding: false,
          resumed: false,
          key,
          word: `место ${key} отпущено словом держателя (leave) — сторож его не поднимает; вернуть: iskron_stand тем же именем`
        });
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
  const board = await callTool("iskron_channel", { action: "list", realm: s2.realm });
  if (board.isError)
    return reply(msg, { holding: true, key, word: `доска не прочиталась — ${short(board.text)}` });
  const mine = parseBoard(board.text).find(
    (e) => e.karta === String(s2.karta) && nameOf(e.address) === (s2.name ?? "")
  );
  if (!mine) return reply(msg, { holding: true, key, word: "своего места на доске нет" });
  const pending = undelivered(mine);
  const listening = listens(mine);
  if (listening) {
    deafReopens = 0;
    return reply(msg, { holding: true, key, listening, pending, word: "слушаю" });
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
      pending,
      reopened: false,
      stuck: true,
      word: text
    });
  }
  deafReopens++;
  standingLog(`reopen ${key}: board reads deaf${pending ? ` with ${pending} pending` : ""}`);
  parkStanding("доска не читает слушающим");
  resumeStanding();
  const hello = await awaitHello(4e3);
  return reply(msg, {
    holding: true,
    key,
    listening,
    pending,
    reopened: !!hello,
    word: hello ? `сокет переоткрыт: ожидало кадров — ${Number(hello.pending) || 0}` : "сокет переоткрыт, hello за 4 с не пришёл"
  });
}
var deafReopens = 0;
var deafSaid = false;
var REOPEN_LIMIT = 2;

// js/bridge/satellite.ts
var SATELLITE_TTL_S = Number(process.env.ISKRON_BRIDGE_SATELLITE_TTL) || 300;
var SUB_RE = /\.sub-([1-9]\d*)$/;
var satelliteName = (base, n) => base.slice(0, NAME_MAX - `.sub-${n}`.length).replace(/[-._]+$/, "") + `.sub-${n}`;
function isSatelliteOf(base, name) {
  const m = SUB_RE.exec(name);
  return !!m && satelliteName(base, Number(m[1])) === name;
}
function pickSatellite(entries, of, karta, led) {
  const address = of.startsWith("@") && of.includes(":") ? of : null;
  const base = address ? nameOf(address) : of.replace(/^@/, "");
  const fault = base ? nameFault(base) : L("пусто", "empty");
  if (fault)
    return {
      ok: false,
      refusal: L(
        `Отказано (мост): satellite_of «${of}» — не имя места (${fault}); передай место позвавшего как печатает доска: @handle:name.`,
        `Refused (bridge): satellite_of "${of}" is not a seat name (${fault}); pass the caller's seat as the board prints it: @handle:name.`
      )
    };
  const callers = entries.filter(
    (e) => address ? e.address === address : nameOf(e.address) === base
  );
  if (!callers.length)
    return {
      ok: false,
      refusal: L(
        `Отказано (мост): места позвавшего ${of} на доске этого графа нет — спутнику не к чему встать рядом; проверь satellite_of и граф в постановке.`,
        `Refused (bridge): the caller's seat ${of} is not on this graph's board — the satellite has nothing to stand beside; check satellite_of and the graph in the brief.`
      )
    };
  const same = callers.length > 1 ? callers.filter((e) => e.karta === normKarta(karta)) : callers;
  if (same.length !== 1)
    return {
      ok: false,
      refusal: L(
        `Отказано (мост): имя ${base} на доске носят ${callers.length} места — передай satellite_of полным адресом @handle:name.`,
        `Refused (bridge): ${callers.length} seats on the board carry the name ${base} — pass satellite_of as the full address @handle:name.`
      )
    };
  const caller = same[0].address;
  const callerKarta = same[0].karta;
  const callerId = same[0].id;
  const notes = [];
  if (led && isSatelliteOf(base, led)) {
    const word = L(
      `мост уже держит ${led} — повтор этого прогона либо параллельный прогон того же файла агента, который делит это место и потеряет его, когда первый закончит; параллельно — не больше одного прогона на файл агента`,
      `the bridge already holds ${led} — a repeat of this run or a parallel run of the same agent file, which shares this seat and loses it when the first one ends; in parallel — no more than one run per agent file`
    );
    log(word);
    notes.push(word);
    return { ok: true, name: led, caller, callerKarta, callerId, notes };
  }
  const taken = new Set(entries.map((e) => nameOf(e.address)));
  for (let n = 1; n <= 99; n++) {
    const name = satelliteName(base, n);
    if (taken.has(name)) continue;
    if (!name.startsWith(`${base}.`))
      notes.push(
        L(
          `имя ${base}.sub-${n} длиннее предела ${NAME_MAX} знаков — база укорочена: ${name}`,
          `the name ${base}.sub-${n} is longer than the ${NAME_MAX}-sign limit — the base is cut: ${name}`
        )
      );
    return { ok: true, name, caller, callerKarta, callerId, notes };
  }
  return {
    ok: false,
    refusal: L(
      `Отказано (мост): у места ${caller} заняты все спутники .sub-1…99 — прибери погасшие места прежних прогонов.`,
      `Refused (bridge): every satellite .sub-1…99 of the seat ${caller} is taken — clear the dead seats of former runs.`
    )
  };
}
async function satelliteGate(a, realm, karta, asked) {
  const of = typeof a.satellite_of === "string" ? a.satellite_of.trim() : "";
  const refuse = (refusal2) => ({ ok: false, refusal: refusal2 });
  if (CFG.satellite && !of)
    return refuse(
      L(
        "Отказано (мост): это мост-спутник — он занимает только место-спутник субагента; передай satellite_of — место позвавшего (@handle:name) из постановки.",
        "Refused (bridge): this is a satellite bridge — it takes only a subagent's satellite seat; pass satellite_of — the caller's seat (@handle:name) from the brief."
      )
    );
  if (!of) return null;
  if (!CFG.satellite)
    return refuse(
      L(
        "Отказано (мост): satellite_of — только мосту-спутнику (запись моста с --satellite в файле агента); этот мост — мост сессии, и место-спутник на нём заняло бы голос позвавшего. Субагенту без своего моста — предел: он говорит местом позвавшего и называет себя в своих строках.",
        "Refused (bridge): satellite_of is for a satellite bridge only (a bridge entry with --satellite in the agent file); this is a session bridge, and a satellite seat on it would take the caller's voice. A subagent without a bridge of its own has a limit: it speaks as the caller's seat and names itself in its lines."
      )
    );
  if (asked || a.take === true || typeof a.room === "string" && a.room.trim())
    return refuse(
      L(
        "Отказано (мост): имя спутника выводит мост — name, take и room вместе с satellite_of не передаются.",
        "Refused (bridge): the bridge derives the satellite's name — name, take and room do not go with satellite_of."
      )
    );
  const b = await callTool("iskron_channel", { action: "list", realm });
  if (b.isError)
    return refuse(
      L(
        `Отказано: доска не прочиталась — ${short(b.text)}`,
        `Refused: the board did not read — ${short(b.text)}`
      )
    );
  const s2 = state.standing;
  const led = s2 && !otherRealm(s2.realm, realm) ? s2.name ?? null : null;
  const pick = pickSatellite(parseBoard(b.text), of, karta, led);
  if (!pick.ok) return pick;
  if (!pick.callerId) {
    const k = await callTool("iskron_channel", { action: "list", realm, karta: pick.callerKarta });
    if (!k.isError)
      pick.callerId = parseBoard(k.text).find((e) => e.address === pick.caller)?.id ?? null;
  }
  noteSatelliteOf(pick.caller, pick.callerId);
  pick.notes.push(
    L(
      `место-спутник ${pick.caller}: роль #${normKarta(karta)}, хука инбокса роли нет, окно простоя канала ${SATELLITE_TTL_S} с, записи держания нет — место живёт прогоном`,
      `satellite seat of ${pick.caller}: role #${normKarta(karta)}, no role inbox hook, channel idle window ${SATELLITE_TTL_S} s, no holding record — the seat lives by the run`
    )
  );
  if (!pick.callerId)
    pick.notes.push(
      L(
        `id места ${pick.caller} доска не напечатала — признак спутника (satellite_of) платформе не послан: место может унаследовать недоставленную почту роли`,
        `the board did not print the id of ${pick.caller} — the satellite sign (satellite_of) was not sent to the platform: the seat may inherit the role's undelivered mail`
      )
    );
  return pick;
}
var ttlRefused = (text) => /ttl/i.test(text) || /(^|\D)4\d\d(\D|$)/.test(text);
var PLACE_ACTIONS2 = /* @__PURE__ */ new Set(["connect", "mint", "register", "revoke"]);
function satelliteChannelRefusal(args) {
  if (!CFG.satellite) return null;
  const action = String(args.action ?? "");
  if (!PLACE_ACTIONS2.has(action)) return null;
  const s2 = state.standing;
  const own = s2?.name ?? "";
  if (!s2 || !SUB_RE.test(own))
    return `Отказано (мост-спутник): ${action} мимо iskron_stand — место этому мосту даёт только iskron_stand с satellite_of; чужое место спутник не берёт и не снимает.`;
  const sameRealm2 = !otherRealm(args.realm, s2.realm);
  const karta = normKarta(args.karta ?? s2.karta);
  const target = action === "revoke" ? args.channel != null ? null : String(args.standing ?? "") : String(args.name ?? "").trim();
  const mine = target != null && (target === own || target.endsWith(`:${own}`) || action === "revoke" && target === "mine");
  if (sameRealm2 && karta === normKarta(s2.karta) && mine) return null;
  return `Отказано (мост-спутник): ${action} — только своего места ${own} (роль #${normKarta(s2.karta)}, граф ${s2.realm}); место позвавшего и любое другое спутник не берёт и не снимает.`;
}
var satelliteListenWord = () => L(
  `[iskron-bridge] Место-спутник: сторожа не взводи — место живёт прогоном субагента и подписывает его записи; с концом прогона мост уходит с места сам, канал гаснет окном простоя ${SATELLITE_TTL_S} с. Первый ход — вход в дело, названное постановкой, и пересказ постановки первым словом в нём.`,
  `[iskron-bridge] Satellite seat: do not arm a watchdog — the seat lives by the subagent's run and signs its records; when the run ends the bridge leaves the seat itself, the channel dies after the ${SATELLITE_TTL_S} s idle window. The first move — enter the case the brief names and retell the brief as your first message in it.`
);

// js/bridge/separate.ts
function suffixOf(base, name) {
  if (!name.startsWith(`${base}.`)) return null;
  const tail2 = name.slice(base.length + 1);
  return /^[1-9]\d*$/.test(tail2) && Number(tail2) >= 2 ? Number(tail2) : null;
}
var suffixed = (base, n) => base.slice(0, NAME_MAX - `.${n}`.length).replace(/[-._]+$/, "") + `.${n}`;
async function freeSuffix(base, free) {
  for (let n = 2; n <= 99; n++) {
    const cand = suffixed(base, n);
    if (await free(cand)) return cand;
  }
  return null;
}
async function separatePlace(realm, karta, derived) {
  const mineHere = (n) => holdsStanding(realm, karta, n) || isParked(realm, karta, n);
  const liveElsewhere = async (n) => !mineHere(n) && await localSocketAlive(localSocketPathOf(keyOf(realm, karta, n)));
  if (!await liveElsewhere(derived)) return null;
  const name = await freeSuffix(derived, async (n) => !await liveElsewhere(n));
  if (!name) return null;
  return {
    name,
    note: L(
      `место ${derived} держит живая сессия другого моста — встаю рядом на ${name}, её не трогаю; если ${derived} — твоё место по памяти этой сессии (её мост перезапущен; субагенту основное место не своё), вернись: iskron_stand(name="${derived}", take=true); вытеснять чужую сессию — только словом человека`,
      `a live session of another bridge holds the seat ${derived} — standing beside as ${name}, leaving it alone; if ${derived} is your seat by this session's memory (its bridge restarted; a subagent does not own the main seat), go back: iskron_stand(name="${derived}", take=true); evicting another session — only on the human's word`
    )
  };
}

// js/bridge/standwords.ts
var s = (ms) => Math.round(ms / 1e3);
var SW = {
  needRealmKarta: () => L(
    "Отказано (мост): iskron_stand требует realm и karta — граф и роль из AGENTS.md или строки запуска.",
    "Refused (bridge): iskron_stand needs realm and karta — the graph and the role from AGENTS.md or the launch line."
  ),
  badCwd: (cwd, relative) => L(
    `Отказано (мост): cwd должен быть существующим абсолютным каталогом — получено «${cwd}»${relative ? " (относительный путь резолвился бы от cwd моста, не сессии)" : ""}.`,
    `Refused (bridge): cwd must be an existing absolute directory — got "${cwd}"${relative ? " (a relative path would resolve against the bridge's cwd, not the session's)" : ""}.`
  ),
  badName: (asked, fault, max) => L(
    `Отказано (мост): name «${asked}» — ${fault}; правило имени: строчные латинские буквы, цифры, точка, подчёркивание, дефис, первый знак — буква или цифра, не длиннее ${max} знаков. Имя не укорачивается молча: короткое имя адресовало бы другое место.`,
    `Refused (bridge): name "${asked}" — ${fault}; the name rule: lowercase latin letters, digits, dot, underscore, hyphen, the first sign a letter or digit, at most ${max} signs. A name is never cut silently: a shorter name would address another seat.`
  ),
  cutPart: (k) => k === "repo" ? L("репо", "repo") : k === "host" ? L("машина", "host") : L("модель", "model"),
  nameCut: (full, max, name, what) => L(
    `выведенное имя ${full} длиннее предела ${max} знаков — укорочено до ${name} (срезано: ${what}); нужно другое — передай name`,
    `the derived name ${full} is longer than the ${max}-sign limit — cut to ${name} (dropped: ${what}); want another — pass name`
  ),
  noModel: () => L(
    "model не передан — имя без третьей части (машина.репо): вторая сессия этой машины над этим репозиторием сойдётся на то же место; передай model, чтобы различать",
    "model not passed — the name has no third part (host.repo): a second session of this machine over this repository lands on the same seat; pass model to tell them apart"
  ),
  legacy: (address, realm, karta) => L(
    `на доске живо место прежнего имени ${address} — его адрес могут держать дела и хуки; сними его: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`,
    `a seat of the former name ${address} is alive on the board — cases and hooks may hold its address; remove it: iskron_channel(action="revoke", realm="${realm}", karta="${karta}", standing="${address}")`
  ),
  boardUnread: (text) => L(`Отказано: доска не прочиталась — ${text}`, `Refused: the board did not read — ${text}`),
  boardUnknown: (start) => L(
    `Отказано: форма доски не распознана — ни заголовка «Каналы», ни слова о пустом графе, ни строк мест; управляющих действий (connect, стук, хук) по догадке не делаю. Начало ответа: ${start}`,
    `Refused: the board's form is not recognized — no «Каналы» header, no word about an empty graph, no seat lines; no controlling moves (connect, knock, hook) on a guess. The answer begins: ${start}`
  ),
  boardAmbiguous: (n, name, karta) => L(
    `Отказано: на доске ${n} места с именем ${name} у роли #${karta} — форма неоднозначна, состояние не определить.`,
    `Refused: the board has ${n} seats named ${name} for role #${karta} — the form is ambiguous, the state cannot be told.`
  ),
  boardCount: (declared, parsed) => L(
    `Отказано: доска объявляет ${declared} мест, разобрано ${parsed}, и своего места среди разобранных нет — нераспознанная строка могла быть им; connect ротировал бы его вслепую. Уверен, что места нет, — повтори с take=true.`,
    `Refused: the board declares ${declared} seats, ${parsed} were read, and your own is not among them — the unread line may be it; connect would rotate it blind. Sure there is no seat — repeat with take=true.`
  ),
  boardCountFound: (declared, parsed) => L(
    `Доска объявляет ${declared} мест, разобрано ${parsed} — одну строку парсер не понял; своё место найдено, иду дальше.`,
    `The board declares ${declared} seats, ${parsed} were read — the parser missed a line; your own seat is found, going on.`
  ),
  refused: (what, text) => L(`Отказано: ${what} — ${text}`, `Refused: ${what} — ${text}`),
  noIdInRegister: () => L(
    "register id места не назвал — кадры места находятся по графу и адресу, занятость ждёт id.",
    "register did not name the seat's id — the seat's frames are found by graph and address; the busy line waits for the id."
  ),
  howBeside: (led) => L(
    `место другого графа — встаёт рядом на канале, который держит этот мост (${led}): register`,
    `a seat of another graph — stands beside on the channel this bridge holds (${led}): register`
  ),
  howReturned: () => L(
    "возврат на место, с которого мост уходил, — сокет открыт заново тем же адресом, register",
    "back to the seat the bridge had left — the socket reopened at the same address, register"
  ),
  howEvicted: () => L(
    "место отняли у этого моста (закрытие 4000) — слушает другой держатель; только register: привязка цела, слух — у него; слух здесь — iskron_stand без name встанет рядом на имя.N; отбить место (take=true) — только словом человека",
    "the seat was taken from this bridge (close 4000) — another holder listens; register only: the binding holds, the hearing is theirs; hearing here — iskron_stand without name stands beside as name.N; taking the seat back (take=true) — only on the human's word"
  ),
  howDeadPredecessor: () => L(
    "слушающим доска ещё читает прежний мост этого каталога, а он мёртв (его сокет не отвечает, запись держания цела) — только register; как только доска его отпустит (закрытый сокет прежние серверы держали «слушающим» около минуты; с честной живостью, по слову контура, — почти сразу), тот же вызов вернёт место с диска тем же адресом — повтори",
    "the board still reads this directory's former bridge as listening, and it is dead (its socket does not answer, the holding record is intact) — register only; once the board lets it go (older servers kept a closed socket «listening» about a minute; with honest liveness, by the contour's word, almost at once) the same call returns the seat from disk at the same address — repeat it"
  ),
  howOtherHolder: () => L(
    "место уже слушает другой держатель (при явном name — возможно, другая машина или человек) — только register: атрибуция есть, слух — у него; нужен слух здесь — возьми другое имя (name); вытеснить его (take=true) — только словом человека",
    "another holder already listens on the seat (with an explicit name — maybe another machine or a human) — register only: attribution is there, the hearing is theirs; need hearing here — take another name (name); evicting them (take=true) — only on the human's word"
  ),
  howRegister: () => L("сокет уже держит этот мост — register", "this bridge already holds the socket — register"),
  ttlRefused: (ttl, text) => L(
    `Окно простоя ${ttl} с контур не принял (${text}) — место занято с окном по умолчанию контура.`,
    `The contour refused the ${ttl} s idle window (${text}) — the seat is taken with the contour's default window.`
  ),
  takenButRegister: (text) => L(
    `Место занято, но register отказал — ${text}`,
    `The seat is taken, but register refused — ${text}`
  ),
  howConnect: (mine, listensElsewhere, take) => mine ? listensElsewhere ? L(
    "место слушал другой держатель — connect по take (сокет теперь у этого моста, прежний держатель получил 4000) и register",
    "another holder listened on the seat — connect by take (the socket is now this bridge's, the former holder got 4000) and register"
  ) : take ? L(
    "connect по take — новый цикл входа, счёт стуков сброшен — и register",
    "connect by take — a new entry cycle, the knock count reset — and register"
  ) : L(
    "место было — connect (сокет теперь у этого моста) и register",
    "the seat was there — connect (the socket is now this bridge's) and register"
  ) : L("connect и register", "connect and register"),
  head: (place, karta, realm, how) => L(
    `[iskron_stand] стояние ${place} — роль #${karta}, граф ${realm}: ${how}.`,
    `[iskron_stand] standing ${place} — role #${karta}, graph ${realm}: ${how}.`
  ),
  noWatchdog: () => L(
    "Команда сторожа не выдаётся: сокет у другого держателя, местного нет — эта сессия кадры и приглашения не принимает.",
    "No watchdog command: another holder has the socket, there is none here — this session takes no frames and no invitations."
  ),
  noSocket: () => L(
    "Сокета у моста нет — слушать нечем; проверь ответ connect.",
    "The bridge holds no socket — nothing to listen with; check the connect answer."
  ),
  besideNoDoor: () => L(
    "Место записано, но двери у него нет — сокет канала моста не жив; кадры этого графа сюда не придут.",
    "The seat is recorded, but it has no door — the bridge's channel socket is not alive; this graph's frames will not come here."
  ),
  hearingElsewhere: () => L(
    "Слух — у другого держателя; здесь только атрибуция записей.",
    "The hearing is another holder's; here only the attribution of records."
  ),
  besideHeard: () => L(
    "Сокет канала держит этот мост — кадры места этого графа идут его сторожу.",
    "This bridge holds the channel socket — this graph's seat frames go to its watchdog."
  ),
  heldAlready: () => L(
    "Сокет держит этот мост (hello получен при открытии сокета).",
    "This bridge holds the socket (hello came when the socket opened)."
  ),
  hello: (pending) => L(
    `hello получен: ожидало кадров — ${pending}.`,
    `hello received: frames waiting — ${pending}.`
  ),
  noHello: () => L(
    "hello за 4 с не пришёл — сокет мост держит, но доказательства слуха ещё нет: проверь доску.",
    "no hello within 4 s — the bridge holds the socket, but there is no proof of hearing yet: check the board."
  ),
  knockNotHere: (room) => L(
    `Место человека ${room}: стук не отправлен — ответ человека ушёл бы держателю сокета, не сюда; нужен вход здесь — другим name; отбить место (take=true) — только словом человека.`,
    `The human's seat ${room}: no knock sent — the human's answer would go to the socket's holder, not here; entry here — with another name; taking the seat back (take=true) — only on the human's word.`
  ),
  knockTwice: (room) => L(
    `Место человека ${room}: стучал дважды, приглашения нет — больше не стучу в этом заходе; скажи человеку, что его место не ответило, и попроси открыть чат (счёт сбрасывает новый вход: take=true или новая сессия).`,
    `The human's seat ${room}: knocked twice, no invitation — no more knocks this time; tell the human their seat did not answer and ask them to open the chat (a new entry resets the count: take=true or a new session).`
  ),
  knockSent: (room, waited, window) => L(
    `Место человека ${room}: стук уже отправлен ${s(waited)} с назад — жди приглашения; осознанный повтор — тем же вызовом с repeat_knock=true, не раньше чем через ${s(window)} с.`,
    `The human's seat ${room}: a knock went ${s(waited)} s ago — wait for the invitation; a deliberate repeat — the same call with repeat_knock=true, not before ${s(window)} s.`
  ),
  knockEarly: (room, waited, window) => L(
    `Место человека ${room}: повтор рано — с первого стука прошло ${s(waited)} с, правило ждёт ${s(window)} с; повтори через ${Math.ceil((window - waited) / 1e3)} с.`,
    `The human's seat ${room}: too early to repeat — ${s(waited)} s since the first knock, the rule waits ${s(window)} s; repeat in ${Math.ceil((window - waited) / 1e3)} s.`
  ),
  knockNoRole: (room, realm) => L(
    `Место человека ${room}: на доске графа ${realm} этого места нет, а send требует роль его держателя — стук не отправлен. Место человека живёт его присутствием: либо он ушёл дольше порога (попроси открыть чат и повтори), либо передай room_karta=<роль человека>.`,
    `The human's seat ${room}: the board of graph ${realm} does not have it, and send needs its holder's role — no knock sent. The human's seat lives by their presence: either they have been away past the threshold (ask them to open the chat and repeat), or pass room_karta=<the human's role>.`
  ),
  knockRefused: (room, text) => L(
    `Место человека ${room}: стук отказан — ${text}`,
    `The human's seat ${room}: the knock was refused — ${text}`
  ),
  knockDone: (room, again, text) => L(
    `Место человека ${room}: ${again ? "повторный " : ""}стук отправлен — ${text} Жди первого слова из места человека с шапкой; до него туда не пиши — встанешь рядом с человеком, когда оно придёт.`,
    `The human's seat ${room}: ${again ? "repeated " : ""}knock sent — ${text} Wait for the first message from the human's seat with its header; do not write there before it — you will stand beside the human when it comes.`
  ),
  statusAfterDead: () => L(
    "Занятость не публикуется: статусного адреса у моста пока нет — повтори тот же вызов, когда доска отпустит мёртвый прежний мост: место вернётся с диска вместе с ним.",
    "The busy line is not published: the bridge has no status address yet — repeat the same call when the board lets the dead former bridge go: the seat returns from disk together with it."
  ),
  statusElsewhere: (takePath) => L(
    `Занятость не публикуется: статусного адреса этого стояния у моста нет — он у держателя сокета; ${takePath}.`,
    `The busy line is not published: the bridge has no status address for this standing — the socket's holder has it; ${takePath}.`
  ),
  status: (text) => L(`Занятость: ${text}`, `Busy: ${text}`),
  statusRefused: (body, guidance) => L(
    `Занятость не принята: ${body}${guidance}`,
    `The busy line was not accepted: ${body}${guidance}`
  )
};

// js/bridge/update.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync4, lstatSync, mkdirSync as mkdirSync6, readFileSync as readFileSync12, renameSync as renameSync5, writeFileSync as writeFileSync8 } from "node:fs";
import { homedir as homedir4 } from "node:os";
import { dirname as dirname3, join as join11 } from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";

// js/shared/home.ts
import { homedir as homedir3 } from "node:os";
import { join as join10 } from "node:path";
var homeBridgePath = () => join10(homedir3(), ".iskron-bridge", "iskron-bridge.mjs");

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
var opencodePluginPath = () => join11(homedir4(), ".config", "opencode", "plugins", "iskron.js");
var setupPathOf = (authDir) => join11(authDir, "SETUP.md");
var latestPathOf = (authDir) => join11(authDir, "latest.json");
function writeAtomic(path, bytes) {
  mkdirSync6(dirname3(path), { recursive: true, mode: 448 });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync8(tmp, bytes, { mode: 420 });
  renameSync5(tmp, path);
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
    return versionIn(readFileSync12(path, "utf8"));
  } catch {
    return null;
  }
};
function syncHome(self = selfPath()) {
  const out5 = { copied: [] };
  const home = homeBridgePath();
  let mine;
  try {
    mine = readFileSync12(self);
  } catch {
    return out5;
  }
  if (!versionIn(mine.toString("utf8"))) return out5;
  if (self === home) return out5;
  if (isSymlink(home)) return out5;
  const homeVersion = versionOf(home);
  const cmp = homeVersion ? compareVersions(VERSION, homeVersion) : 1;
  if (cmp > 0) {
    writeAtomic(home, mine);
    out5.copied.push(home);
    const plugin = opencodePluginPath();
    const packaged = join11(dirname3(self), "opencode-plugin.js");
    if (existsSync4(plugin) && existsSync4(packaged)) {
      const fresh = readFileSync12(packaged);
      if (!readFileSync12(plugin).equals(fresh)) {
        writeAtomic(plugin, fresh);
        out5.copied.push(plugin);
      }
    }
  } else if (cmp < 0 && homeVersion) {
    out5.reexec = home;
  }
  return out5;
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
    return JSON.parse(readFileSync12(latestPathOf(authDir), "utf8"));
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
  const current2 = versionOf(home);
  if (!isSymlink(home) && (!current2 || compareVersions(version, current2) > 0)) {
    writeAtomic(home, bridge);
    written.push(home);
  }
  const plugin = opencodePluginPath();
  if (existsSync4(plugin)) {
    const fresh = await fetchText(`${base}/skills/establish-mcp/scripts/opencode-plugin.js`);
    if (readFileSync12(plugin, "utf8") !== fresh) {
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
  const self = process.argv[1];
  const bridgeWord = latest.downloaded.some((p) => p === homeBridgePath()) ? L(
    "Свежий мост уже скачан в ~/.iskron-bridge и поднимется новой сессией.",
    "The fresh bridge is already downloaded into ~/.iskron-bridge and comes up with a new session."
  ) : latest.error ? L(
    `Скачать свежий мост не вышло (${latest.error}); повтори: node "${self}" update.`,
    `Downloading the fresh bridge failed (${latest.error}); repeat: node "${self}" update.`
  ) : isSymlink(homeBridgePath()) ? L(
    "Свежий мост в дом не положен: дом — симлинк на чужую копию, его не трогаю; обнови эту копию сам.",
    "The fresh bridge is not put home: home is a symlink to another copy, left alone; update that copy yourself."
  ) : versionOf(homeBridgePath()) && compareVersions(versionOf(homeBridgePath()), latest.version) >= 0 ? L(
    "Свежий мост уже лежит в ~/.iskron-bridge и поднимется новой сессией.",
    "The fresh bridge already lies in ~/.iskron-bridge and comes up with a new session."
  ) : L(
    `Свежий мост в дом не положен; повтори: node "${self}" update (мост, который отвечает, — тот и обновляет дом; в пакетной поставке OpenCode мост живёт в пакете и обновляется с ним).`,
    `The fresh bridge is not put home; repeat: node "${self}" update (the bridge that answers is the one that updates home; in OpenCode's packaged delivery the bridge lives in the package and updates with it).`
  );
  return L(
    `[iskron-bridge] ПОСТАВКА ОТСТАЛА: этот мост v${VERSION}, свежий релиз v${latest.version}. ${bridgeWord} Скиллы обновляет канал харнеса, и об этом надо СКАЗАТЬ ЧЕЛОВЕКУ: Claude Code — /plugin marketplace update iskron, затем /reload-plugins; плоская установка — npx skills update --global; pi — pi update git:github.com/iskron-ai/skills; Codex — codex plugin marketplace upgrade iskron, затем codex plugin remove iskron@iskron и codex plugin add iskron@iskron. Полный порядок — свежий установщик ${setupPathOf(authDir)} (кладёт update); по слову человека «обнови» исполни его.`,
    `[iskron-bridge] DELIVERY BEHIND: this bridge is v${VERSION}, the fresh release is v${latest.version}. ${bridgeWord} The harness channel updates the skills, and this must be TOLD TO THE HUMAN: Claude Code — /plugin marketplace update iskron, then /reload-plugins; flat install — npx skills update --global; pi — pi update git:github.com/iskron-ai/skills; Codex — codex plugin marketplace upgrade iskron, then codex plugin remove iskron@iskron and codex plugin add iskron@iskron. The full order — the fresh installer ${setupPathOf(authDir)} (update puts it); on the human's word "update" run it.`
  );
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

// js/bridge/standtool.ts
var STAND_TOOL = {
  name: "iskron_stand",
  description: "[мост] Занять стояние одним вызовом: мост читает доску, выводит имя (машина.репо.модель), занимает место (connect и register; только register, если сокет уже держит этот мост), взводит хук инбокса роли своим входящим адресом, при room стучит кадром join в место человека по полному адресу с провода (повтор — только repeat_knock=true, один раз, не раньше чем через 2 минуты) и возвращает имя, команду сторожа, число ожидавших кадров, состояние хука и расписку стука. Место в другом графе встаёт рядом на том же канале (register): сессия слышит все свои графы, и запись в каждом подписана местом этого графа. Дальше — запустить сторожа командой из ответа и ждать. Тул исполняет мост; нет его в сессии — тулы идут мимо моста либо мост старой сборки (doctor скажет), стой по скиллу standing.",
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
        description: "Адрес места человека @handle:name (его даёт окно человека); мост стучит туда join, чтобы встать рядом с человеком."
      },
      model: {
        type: "string",
        description: "Модель, которой бежит агент (id или имя, например claude-opus-5 или opus-5) — третья часть выведенного имени; без неё имя — машина.репо."
      },
      mute_siblings: { type: "boolean", description: "Не слышать эхо других стояний той же роли." },
      take: {
        type: "boolean",
        description: "Сознательный переход: своё место (мост этой же сессии перезапущен) агент возвращает сам, чужого живого держателя вытесняет только по слову человека — забрать сокет места, которое держит другой мост этой машины (без take выведенное имя встаёт рядом на имя.N, явное — только регистрируется, слух остаётся у держателя); либо сменить место этого моста в графе (в графе одно место на мост: другая роль или другое имя без take — отказ вслух, прежнее место остаётся на доске без слуха). Место в другом графе take не требует — оно встаёт рядом."
      },
      room_karta: {
        type: "string",
        description: "Роль человека, чьё это место (#N), если места нет на доске; обычно роль человека, приславшего адрес места."
      },
      repeat_knock: {
        type: "boolean",
        description: "Осознанный повтор стука в то же место человека: разрешён один раз и не раньше чем через 2 минуты после первого; без него повторный вызов второго join не шлёт."
      },
      satellite_of: {
        type: "string",
        description: "Только мосту-спутнику субагента (запись моста с --satellite в файле агента): место позвавшего @handle:name из постановки. Мост встаёт рядом местом-спутником <имя позвавшего>.sub-N (первое свободное N), ролью из karta (её называет постановка, роль позвавшего не наследуется), без хука инбокса роли; место живёт прогоном. name, take и room с ним не передаются."
      },
      status: { type: "string", description: "Первая строка занятости (до 64 символов)." },
      cwd: {
        type: "string",
        description: "Директория сессии харнесса, существующий абсолютный каталог — из неё выводится репо для имени (git toplevel, в связанном ворктри — основной копии, иначе её basename) и читаются ветки при поиске мест прежнего имени, когда мост запущен не из рабочей копии; плагин OpenCode подставляет её сам. Без неё — cwd моста; несуществующая или относительная — отказ вслух."
      }
    },
    required: ["realm", "karta"]
  }
};

// js/bridge/stand.ts
var ledName = () => state.standing?.name ?? "";
var isDirectory = (p) => {
  try {
    return isAbsolute(p) && statSync4(p).isDirectory();
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
  const karta = a.karta != null ? normKarta(a.karta) : "";
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
    lines.push(SW.needRealmKarta());
    return done(true);
  }
  const model2 = typeof a.model === "string" && a.model.trim() ? a.model : void 0;
  rememberModel(model2);
  const cwd = typeof a.cwd === "string" && a.cwd.trim() ? a.cwd.trim() : process.cwd();
  if (cwd !== process.cwd() && !isDirectory(cwd)) {
    lines.push(SW.badCwd(cwd, !isAbsolute(cwd)));
    return done(true);
  }
  const nameNotes = [];
  const asked = normName(a.name);
  if (asked) {
    const fault = nameFault(asked);
    if (fault) {
      lines.push(SW.badName(asked, fault, NAME_MAX));
      return done(true);
    }
  }
  const gate = await satelliteGate(a, realm, karta, asked);
  if (gate && !gate.ok) {
    lines.push(gate.refusal);
    return done(true);
  }
  const sat = gate?.ok ? { name: gate.name, caller: gate.caller } : null;
  if (gate?.ok) nameNotes.push(...gate.notes);
  const parts = asked || sat ? null : deriveParts(model2, cwd);
  const fitted = parts ? fitName(parts) : null;
  const derived = asked || sat ? "" : fitted?.name ?? "";
  let name = asked || sat?.name || derived;
  await resolveAgainstLed(realm);
  const led0 = state.standing && !otherRealm(state.standing.realm, realm) ? state.standing : null;
  if (derived && led0 && String(led0.karta) === String(karta) && suffixOf(derived, led0.name ?? ""))
    name = led0.name ?? name;
  if (parts && fitted && fitted.cut.length) {
    const what = fitted.cut.map(SW.cutPart).join(", ");
    nameNotes.push(SW.nameCut(joinName(parts), NAME_MAX, name, what));
  }
  if (!asked && !sat && !model2) nameNotes.push(SW.noModel());
  const room = typeof a.room === "string" && a.room.trim() ? a.room.trim() : null;
  const unresolved2 = unresolvedRefusal(realm);
  if (unresolved2) {
    lines.push(unresolved2);
    return done(true);
  }
  const led = leadsOtherPlace(realm, karta, name);
  if (led && a.take !== true) {
    lines.push(otherPlaceWord(led, keyOf(realm, karta, name), name === ledName()));
    return done(true);
  }
  const noChannel = besideRefusal(realm, "stand");
  if (noChannel) {
    lines.push(noChannel);
    return done(true);
  }
  const prim = state.standing;
  const beside = !!prim && otherRealm(realm, prim.realm) && !holdsStanding(realm, karta, name);
  noteStandCwd(cwd);
  const here = () => placeFields({ realm, karta, name });
  const register = () => callTool("iskron_channel", { action: "register", realm, karta, name, ...here() });
  const board = await callTool("iskron_channel", { action: "list", realm });
  if (board.isError) {
    lines.push(SW.boardUnread(short(board.text)));
    return done(true);
  }
  const entries = parseBoard(board.text);
  const header = /^\s*Каналы(?:\s*\((\d+)\))?(?:\s|:|$)/m.exec(board.text);
  const declared = header?.[1] != null ? Number(header[1]) : null;
  const empty = /^\s*Ни одна роль этого графа (?:не держит канала|нигде не стоит)/m.test(
    board.text
  );
  const recognized = !!header || empty || entries.length > 0;
  let own = entries.filter((e) => e.karta === karta && nameOf(e.address) === name);
  const separate = derived && a.take !== true && name === derived ? await separatePlace(realm, karta, derived) : null;
  if (separate) {
    name = separate.name;
    own = entries.filter((e) => e.karta === karta && nameOf(e.address) === name);
    nameNotes.push(separate.note);
  }
  const sub = !!sat || !!derived && name !== derived;
  const stem = name.split(".").slice(0, 2).join(".");
  const branches = new Set(
    git(["branch", "--format=%(refname:short)"], cwd).split("\n").map((x) => sanitize(x.trim())).filter(Boolean)
  );
  const legacy = entries.filter((e) => {
    if (sat) return false;
    if (e.karta !== karta || nameOf(e.address) === name) return false;
    const own2 = nameOf(e.address);
    if (!own2.startsWith(`${stem}.`)) return false;
    const third = own2.slice(stem.length + 1);
    return branches.has(third) && /живой|слушает/.test(e.rest);
  });
  for (const e of legacy) nameNotes.push(SW.legacy(e.address, realm, karta));
  const unread = declared != null && declared !== entries.length;
  if (!recognized || own.length > 1 || unread && own.length === 0 && a.take !== true) {
    lines.push(
      !recognized ? SW.boardUnknown(short(board.text, 160)) : own.length > 1 ? SW.boardAmbiguous(own.length, name, karta) : SW.boardCount(declared ?? 0, entries.length)
    );
    return done(true);
  }
  if (unread) lines.push(SW.boardCountFound(declared ?? 0, entries.length));
  const mine = own[0];
  let incoming = mine?.incoming ?? null;
  let how;
  let heardHere;
  const listensElsewhere = !!mine && /(^|·)\s*слушает/.test(mine.rest) && !holdsStanding(realm, karta, name);
  const fresh = !sat && a.take !== true && !holdsStanding(realm, karta, name) && !isParked(realm, karta, name);
  const predecessorDead = fresh && listensElsewhere && await deadPredecessor(realm, karta, name);
  const resumed = fresh && !listensElsewhere ? await resumeFromDisk(realm, karta, name) : null;
  const extra = [];
  let socketBefore = false;
  if (beside) {
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = holdsStanding(realm, karta, name);
    if (heardHere && !standingIdIn(realm)) extra.push(SW.noIdInRegister());
    how = SW.howBeside(ledKey() ?? "");
  } else if (resumed) {
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = true;
    socketBefore = true;
    how = `${resumed.word}, register`;
  } else if (a.take !== true && isParked(realm, karta, name) && returnToStanding("iskron_stand")) {
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = true;
    how = SW.howReturned();
  } else if (a.take !== true && (holdsStanding(realm, karta, name) || listensElsewhere)) {
    const r = await register();
    if (r.isError) {
      lines.push(SW.refused("register", short(r.text)));
      return done(true);
    }
    heardHere = !listensElsewhere;
    socketBefore = !listensElsewhere;
    how = listensElsewhere ? wasEvicted(realm, karta, name) ? SW.howEvicted() : predecessorDead ? SW.howDeadPredecessor() : SW.howOtherHolder() : SW.howRegister();
  } else {
    const args = { action: "connect", realm, karta, name };
    Object.assign(args, here());
    if (typeof a.mute_siblings === "boolean") args.mute_siblings = a.mute_siblings;
    if (sat) args.ttl_seconds = SATELLITE_TTL_S;
    let c = await callTool("iskron_channel", args);
    if (sat && c.isError && ttlRefused(c.text)) {
      extra.push(SW.ttlRefused(SATELLITE_TTL_S, short(c.text, 120)));
      delete args.ttl_seconds;
      c = await callTool("iskron_channel", args);
    }
    if (c.isError) {
      lines.push(SW.refused("connect", short(c.text)));
      return done(true);
    }
    incoming = /https?:\/\/\S+\/channel\/in\/\S+/.exec(c.text)?.[0] ?? incoming;
    const r = await register();
    if (r.isError) {
      lines.push(SW.takenButRegister(short(r.text)));
      return done(true);
    }
    for (const k of [...knocks.keys()])
      if (k.startsWith(`${realm}|${karta}|${name}|`)) knocks.delete(k);
    heardHere = true;
    how = SW.howConnect(!!mine, listensElsewhere, a.take === true);
  }
  lines.push(
    SW.head(mine?.address ?? name, karta, realm, how),
    ...nameNotes.map((n) => `[iskron_stand] ${n}`),
    ...extra
  );
  const block = heardHere ? sat ? satelliteListenWord() : listenBlock(realm) : null;
  if (block) lines.push(block);
  else lines.push(heardHere ? SW.noSocket() : SW.noWatchdog());
  if (!heardHere) lines.push(beside ? SW.besideNoDoor() : SW.hearingElsewhere());
  else if (beside) lines.push(SW.besideHeard());
  else if (socketBefore) lines.push(SW.heldAlready());
  else {
    const hello = await awaitHello(4e3);
    lines.push(hello ? SW.hello(String(hello.pending ?? 0)) : SW.noHello());
  }
  const main = state.standing;
  lines.push(
    await armRoleHook({
      realm,
      karta,
      name,
      incoming,
      heardHere,
      sub,
      beside: !!main && otherRealm(realm, main.realm),
      // место на канале, открытом в другом графе
      channelRealm: main?.realm ?? realm
    })
  );
  if (room && !heardHere) {
    lines.push(SW.knockNotHere(room));
  } else if (room) {
    const onBoard = entries.find((e) => e.address === room);
    const roomKarta = onBoard?.karta ?? (typeof a.room_karta === "string" && a.room_karta.trim() ? a.room_karta.trim().replace(/^#/, "") : null);
    const key = `${realm}|${karta}|${name}|${room}`;
    const prior = knocks.get(key);
    const waited = prior ? Date.now() - prior.at : Infinity;
    const again = a.repeat_knock === true;
    if (prior && prior.count >= KNOCK_LIMIT) lines.push(SW.knockTwice(room));
    else if (prior && !again) lines.push(SW.knockSent(room, waited, KNOCK_REPEAT_AFTER_MS));
    else if (prior && waited < KNOCK_REPEAT_AFTER_MS)
      lines.push(SW.knockEarly(room, waited, KNOCK_REPEAT_AFTER_MS));
    else if (!roomKarta) lines.push(SW.knockNoRole(room, realm));
    else {
      const s2 = await callTool("iskron_channel", {
        action: "send",
        realm,
        karta: roomKarta,
        standing: room,
        text: "join"
      });
      if (s2.isError) lines.push(SW.knockRefused(room, short(s2.text)));
      else {
        knocks.set(key, { at: Date.now(), count: (prior?.count ?? 0) + 1 });
        lines.push(SW.knockDone(room, !!prior, short(s2.text, 200)));
      }
    }
  }
  if (typeof a.status === "string" && a.status.trim() && !hasStatusAddressFor(realm, karta, name)) {
    lines.push(predecessorDead ? SW.statusAfterDead() : SW.statusElsewhere(TAKE_PATH()));
  } else if (typeof a.status === "string" && a.status.trim()) {
    const st = await publishStatus(a.status.trim(), realm);
    lines.push(
      st.ok ? SW.status(a.status.trim()) : SW.statusRefused(short(st.body), st.code === 404 ? ` ${TURNED_GUIDANCE()}` : "")
    );
  }
  const stale = staleNotice(readLatest(CFG.authDir), CFG.authDir);
  if (stale) lines.push(stale);
  return done();
}

// js/bridge/moment.ts
var WRITE_TOOL = /^iskron_(add_[a-z_]+|batch)$/;
var JSON_LINE = "Момент скилла writing: перед вызовом по каждому узлу назови читателя, что изменит извлечение и что здесь ново; тип и given_as, три модуса как утверждения, имя-тезис, стрелки со смыслом; тело — нынешнее знание, никогда провенанс: кто сказал, когда, чьей рукой — в истории узла и в деле, узел переписывается, а не дописывается разделом; hint — семя превращения: только важное после сессии, не журнал; гроссбух сессии — в файле сессии и в кадре; строки CHECKS в ответе — работа этого такта.";
var MOMENT_LINE = "[мост] " + JSON_LINE;
var STATUS_LINE = '[мост] action="status" (realm, text до 64 символов) — занятость ЭТОГО стояния: исполняет мост, держатель сокета, на сервер вызов не уходит; пустой text снимает; отказ поверхности приходит целиком.';
var LEAVE_LINE = '[мост] action="leave" (realm) — уйти с места: исполняет мост — сокет закрыт, занятость снята, адрес, очередь и хуки целы; почта копится и придёт при возвращении (сторож или iskron_stand). Сам мост уходит только там, где кадр доходит лишь сторожем (Claude Code, Codex) и сторож не взведён 15 минут; в pi и OpenCode кадр приходит уведомлением, и мост места не бросает. Занятость снимается на конце сессии.';
function annotateToolList(reply2) {
  const tools = reply2?.result?.tools;
  if (!Array.isArray(tools)) return;
  const at2 = tools.findIndex((t) => t?.name === STAND_TOOL.name);
  if (at2 >= 0) tools[at2] = STAND_TOOL;
  else tools.push(STAND_TOOL);
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

// js/bridge/toolsync.ts
import { createHash as createHash4 } from "node:crypto";
var served = null;
function toolsPrint(result) {
  const tools = result?.tools;
  if (!Array.isArray(tools)) return null;
  const shape = tools.map((t) => [t.name ?? "", JSON.stringify(t.inputSchema ?? null)]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return createHash4("sha256").update(JSON.stringify(shape)).digest("hex");
}
function noteServedTools(result) {
  const print = toolsPrint(result);
  if (print) served = print;
}
async function recheckTools(ask, emit2) {
  if (!served) return;
  const fresh = toolsPrint((await ask().catch(() => null))?.result);
  if (!fresh || fresh === served) return;
  served = fresh;
  log("tool list changed under the re-opened session — telling the harness (tools/list_changed)");
  emit2({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
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
  const tail2 = kind ? "The bridge stays up." : "The bridge stays up; if this repeats, the server side needs attention.";
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32001,
      // BUILD is here for the field report: the error is quoted verbatim, and
      // the build string is what dates the code that produced it.
      message: `iskron-bridge ${BUILD}: ${message}. ${verdict} ${tail2}`
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
var harnessListing = 0;
onReinitialized(() => {
  if (harnessListing > 0) return;
  return recheckTools(async () => {
    const id = `iskron-bridge-tools-${++state.reinitCounter}`;
    let got = null;
    await post({ jsonrpc: "2.0", id, method: "tools/list", params: {} }, (m) => {
      if (m.id === id) got = m;
    });
    const reply2 = got;
    if (reply2?.result) {
      annotateToolList(reply2);
      saveServerCache({ tools: reply2.result });
    }
    return reply2;
  }, emit);
});
function isRead(msg) {
  if (msg?.method === "initialize" || msg?.method === "tools/list") return true;
  return msg?.method === "tools/call" && READ_TOOLS.has(String(msg.params?.name ?? ""));
}
function lastServerAnswer(msg) {
  const cache = loadServerCache();
  const result = msg?.method === "initialize" ? cache.init : msg?.method === "tools/list" && !msg.params?.cursor ? cache.tools : null;
  if (!result) return null;
  const reply2 = { jsonrpc: "2.0", id: msg.id, result };
  if (msg?.method === "tools/list") {
    annotateToolList(reply2);
    noteServedTools(reply2.result);
  }
  return reply2;
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
  const listing2 = msg?.method === "tools/list";
  if (listing2) harnessListing++;
  try {
    await deliverOne(msg);
  } finally {
    if (listing2) harnessListing--;
  }
}
async function deliverOne(msg) {
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
    if (m.id === msg.id && msg.method === "tools/list") {
      annotateToolList(m);
      if (!msg.params?.cursor) noteServedTools(m.result);
    }
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
      if (hasId && msg.method === "tools/call" && msg.params?.name === "iskron_channel")
        await resolveAgainstLed(msg.params.arguments?.realm);
      const satWord = hasId && msg.method === "tools/call" && msg.params?.name === "iskron_channel" ? satelliteChannelRefusal(msg.params.arguments ?? {}) : null;
      const cross = satWord ? {
        jsonrpc: "2.0",
        id: msg.id,
        result: { isError: true, content: [{ type: "text", text: satWord }] }
      } : hasId ? crossPlaceRefusal(msg) : null;
      if (cross) {
        emit(cross);
        return;
      }
      expectOwnRevoke(msg);
      if (msg.method === "tools/call" && msg.params?.name === "iskron_channel" && msg.params.arguments)
        msg.params.arguments = withPlaceFields(msg.params.arguments);
      await post(msg, forward);
      const held2 = heldReply;
      if (held2 && msg.params?.name === "iskron_channel" && msg.params.arguments)
        noteLocaleEcho(msg.params.arguments, replyText(held2));
      if (held2) {
        if (state.standing && isUnattributed(held2)) {
          state.standingSession = null;
          const refused = !!held2.result?.isError;
          if (refused && !standingRetried) {
            standingRetried = true;
            log("the call ran unattributed — re-binding the standing and repeating it once");
            await ensureStanding();
            if (state.standingSession !== state.sessionId) await ensureStanding();
            if (state.standingSession === state.sessionId) continue;
          } else {
            log(
              `a write went out unattributed (${replyText(held2).slice(0, 120)}) — the standing is re-bound before the next call`
            );
          }
        }
        emit(withNotice(absorbRevokeReply(msg, absorbChannelReply(msg, held2))));
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
          const held2 = authErr instanceof HoldOffError;
          const message = errorMessage(authErr);
          log(`${held2 ? "authorization holding off" : "authorization failed"}: ${message}`);
          if (hasId) {
            emit(
              syntheticError(
                msg.id,
                `${held2 ? "authorization holding off" : "authorization failed"}: ${message}`,
                outcome,
                held2 && (authErr.retryNow ? "knock" : "wait")
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
  if (!CFG.satellite) startDeafnessWatch();
  const rl = createInterface({ input: process.stdin, terminal: false });
  const pending = /* @__PURE__ */ new Set();
  let handshake = null;
  rl.on("line", (line) => {
    const trimmed2 = line.trim();
    if (!trimmed2) return;
    let msg;
    try {
      msg = JSON.parse(trimmed2);
    } catch {
      log(`unparseable line from harness: ${trimmed2.slice(0, 120)}`);
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
  let leaving = null;
  const leave = (why) => leaving ??= windDown(why);
  const windDown = async (why) => {
    debug(`${why} — winding down`);
    const addr = statusAddress();
    releaseStanding(why, CFG.satellite);
    if (addr) await publishStatusTo(addr.url, "", 3e3).catch(() => {
    });
    await Promise.allSettled([...pending, ...tokenRequestsInFlight]);
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
import { existsSync as existsSync6 } from "node:fs";
import { homedir as homedir5 } from "node:os";
import { join as join13 } from "node:path";

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
  return new Promise((resolve3, reject) => {
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
      resolve3({
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
import { existsSync as existsSync5, readdirSync as readdirSync5, readFileSync as readFileSync13 } from "node:fs";
import { connect as connect2 } from "node:net";
import { join as join12 } from "node:path";
var ATTACH_WINDOW_MS = 6e4;
var RETRY_MS = 1e3;
function parseWatchdogArgs(argv2) {
  const out5 = { authDir: authDirFromEnv() };
  for (let i = 0; i < argv2.length; i++) {
    const a = argv2[i];
    if (a === "--auth-dir") out5.authDir = argv2[++i] ?? out5.authDir;
    else if (!a.startsWith("--") && !out5.key) out5.key = a;
  }
  return out5;
}
function resolveStanding(argv2) {
  const { key, authDir } = parseWatchdogArgs(argv2);
  const dir = standingsDirOf(authDir);
  const pathFor = (k) => socketPathOf(authDir, k);
  if (key) return { key, path: pathFor(key), authDir };
  const held2 = existsSync5(dir) ? readdirSync5(dir).filter((f) => f.endsWith(".key")).map((f) => {
    try {
      return readFileSync13(join12(dir, f), "utf8").trim();
    } catch {
      return "";
    }
  }).filter(Boolean) : [];
  if (held2.length === 1) return { key: held2[0], path: pathFor(held2[0]), authDir };
  if (held2.length === 0) {
    return {
      error: "мост не держит ни одного стояния — назовись одним вызовом iskron_stand(realm, karta, model): его ответ назовёт команду слушания"
    };
  }
  return {
    error: `мост держит несколько стояний — назови нужное: ` + held2.join(", ")
  };
}
function adoptSeenPath(named, current2, seen) {
  if (!named || named === current2) return current2;
  seen.clear();
  for (const x of seenIds(named)) seen.add(x);
  return named;
}
var staleBatchKeys = (ev) => [
  ...(ev.frames ?? []).flatMap((f) => deliveredKeys(f)),
  ...ev.unshown ?? []
];
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
var note = (s2) => {
  process.stderr.write(s2 + "\n");
};
function codexDoorPath() {
  const home = process.env.CODEX_HOME?.trim() || join13(homedir5(), ".codex");
  return join13(home, "app-server-control", "app-server-control.sock");
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
  if (!existsSync6(socketPath)) {
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
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  const waiting = /* @__PURE__ */ new Map();
  let door2 = null;
  let ready = null;
  let nextId = 1;
  function open() {
    if (ready) return ready;
    ready = openDoor(
      socketPath,
      (m) => {
        const ids = !m?.method && typeof m?.id === "number" ? waiting.get(m.id) : void 0;
        if (!ids) return;
        waiting.delete(m.id);
        if (m.error) return note(`ДЕЛАТЕЛЬ: тред не принял кадр — ${m.error.message ?? "отказ"}`);
        note(`кадр вложен в тред ${threadId}`);
        for (const id of ids) noteSeen(seenPath, id, seen);
      },
      (why) => {
        const lost = [...waiting.values()].flat();
        waiting.clear();
        note(
          `дверь закрылась: ${why} — открою заново на следующем кадре` + (lost.length ? `; без ответа: ${lost.join(", ")} — вернутся из кольца следующим взводом` : "")
        );
        door2 = null;
        ready = null;
      }
    ).then((d) => {
      door2 = d;
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
  async function deliver2(text, ids = []) {
    try {
      const d = door2 ?? await open();
      const reqId = nextId++;
      waiting.set(reqId, ids);
      d.send({
        method: "turn/start",
        id: reqId,
        params: { threadId, input: [{ type: "text", text }], turnTrigger: "iskron-channel" }
      });
      note(`кадр отправлен в тред ${threadId}`);
    } catch (e) {
      note(`ДЕЛАТЕЛЬ: кадр не вложился — ${e.message}`);
    }
  }
  let replay = 0;
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const fromRing = replay > 0;
          if (fromRing) replay--;
          const type = ev.frame?.type;
          if (type !== "message") return note(`кадр ${type ?? "не разобран"} — не повод будить`);
          if (fromRing && typeof ev.frame?.id !== "string")
            return note("кадр без id из кольца — пометить нечем, в тред не кладу повторно");
          if (typeof ev.frame?.id === "string" && seen.has(ev.frame.id))
            return note(`кадр ${ev.frame.id} уже вложен — в тред не кладу повторно`);
          void deliver2(frameToText(ev.frame, ev.raw ?? ""), deliveredKeys(ev.frame));
          break;
        }
        case "stale":
          void deliver2(ev.text ?? "Искрон: лежалые кадры", staleBatchKeys(ev));
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
          seenPath = adoptSeenPath(ev.seen, seenPath, seen);
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
  const out5 = [];
  for (const line of text.split("\n")) {
    let rest2 = line;
    while ([...rest2].length > max) {
      const head = [...rest2].slice(0, max).join("");
      const cut = head.lastIndexOf(" ");
      const at2 = cut > max / 2 ? cut : head.length;
      out5.push(rest2.slice(0, at2).trimEnd());
      rest2 = rest2.slice(at2).trimStart();
    }
    out5.push(rest2);
  }
  return out5;
}
var plural = (n) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? "кадр" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "кадра" : "кадров";
  return `${n} ${word}`;
};
var ALONE_GAP_MS = Number(process.env.ISKRON_WATCHDOG_ALONE_MS) || 300;
var queue = Promise.resolve();
var lastAt = 0;
var lastAlone = false;
var out = (lines, alone = false, after2) => {
  queue = queue.then(async () => {
    const wait = lastAt && (alone || lastAlone) ? lastAt + ALONE_GAP_MS - Date.now() : 0;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const failed = await new Promise(
      (r) => process.stdout.write(lines.join("\n") + "\n", (e) => r(!!e))
    );
    lastAt = Date.now();
    lastAlone = alone;
    if (!failed) after2?.();
  });
};
var log2 = (s2) => out([s2]);
var loudExit = (s2, code) => {
  queue = queue.then(() => exitNow(s2, code));
};
var exitNow = (s2, code) => {
  try {
    writeSync(1, s2 + "\n");
    process.exit(code);
  } catch {
    process.stdout.write(s2 + "\n", () => process.exit(code));
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
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  const queued = /* @__PURE__ */ new Set();
  const folded = [];
  const cases = /* @__PURE__ */ new Set();
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "attached":
          seenPath = adoptSeenPath(ev.seen, seenPath, seen);
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
          const id = typeof f.id === "string" ? f.id : "";
          const again = !!id && (seen.has(id) || queued.has(id));
          if (id && !again) queued.add(id);
          const mark = () => {
            for (const k of deliveredKeys(f)) noteSeen(seenPath, k, seen);
            queued.delete(id);
          };
          if (ev.batch) {
            if (ev.batch.at === 1) cases.clear();
            if (ev.batch.folded) {
              if (!again) folded.push(mark);
              break;
            }
            const within = folded.splice(0);
            const all2 = () => [...within, mark].forEach((m) => m());
            const first2 = !cases.has(caseKey(f));
            cases.add(caseKey(f));
            if (!again) out(wrapLines(batchLine(f, ev.batch.fold, first2)), false, all2);
            else within.forEach((m) => m());
            break;
          }
          if (!again) out(wrapLines(frameToText(f, ev.raw ?? "")), true, mark);
          break;
        }
        case "note":
          log2(ev.text ?? "");
          break;
        case "stale":
          out(wrapLines(ev.text ?? ""), false, () => {
            for (const k of staleBatchKeys(ev)) noteSeen(seenPath, k, seen);
          });
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
import { createHash as createHash5 } from "node:crypto";
import { writeSync as writeSync2 } from "node:fs";
function frameId(ev) {
  const id = ev.frame?.id;
  return typeof id === "string" && id ? id : `raw:${createHash5("sha256").update(ev.raw ?? "").digest("hex").slice(0, 16)}`;
}
var wake = (s2) => {
  writeSync2(1, s2 + "\n");
};
var note2 = (s2) => {
  writeSync2(2, s2 + "\n");
};
function runWatchdogExit(argv2) {
  const target = resolveStanding(argv2);
  if ("error" in target) {
    note2(`ДЕЛАТЕЛЬ: ${target.error}`);
    process.exit(2);
  }
  let seenPath = seenFilePathOf(target.authDir, target.key);
  const seen = seenIds(seenPath);
  let woke = false;
  let head = "";
  const folded = [];
  const cases = /* @__PURE__ */ new Set();
  attach(target.path, {
    onEvent: (ev) => {
      switch (ev.kind) {
        case "frame": {
          const type = ev.frame?.type;
          if (type !== "message") return note2(`кадр ${type ?? "не разобран"} — не повод будить`);
          const id = frameId(ev);
          const last = !ev.batch || ev.batch.at >= ev.batch.of;
          if (seen.has(id)) {
            note2(`кадр ${id} уже отдан прежним взводом — не повод будить`);
            if (last && woke) process.exit(0);
            return;
          }
          if (ev.batch?.at === 1) cases.clear();
          if (ev.batch?.folded) {
            folded.push(id);
            return;
          }
          if (ev.batch && head) wake(head);
          head = "";
          const key = ev.frame ? caseKey(ev.frame) : "";
          const first2 = !cases.has(key);
          cases.add(key);
          wake(
            !ev.frame ? ev.raw ?? "" : ev.batch ? batchLine(ev.frame, ev.batch.fold, first2) : frameToText(ev.frame, ev.raw ?? "")
          );
          for (const k of folded.splice(0)) noteSeen(seenPath, k, seen);
          noteSeen(seenPath, id, seen);
          const evKey = eventKeyOf(ev.frame);
          if (evKey) noteSeen(seenPath, evKey, seen);
          woke = true;
          if (last) process.exit(0);
          break;
        }
        case "stale":
          for (const k of staleBatchKeys(ev)) noteSeen(seenPath, k, seen);
          note2(ev.text ?? "лежалые кадры");
          break;
        case "dead":
        case "alive":
        case "evicted":
          note2(ev.text ?? "ДЕЛАТЕЛЬ: стояние потеряно");
          process.exit(1);
          break;
        case "attached":
          seenPath = adoptSeenPath(ev.seen, seenPath, seen);
          note2(`слушаю стояние ${ev.key}`);
          break;
        default:
          if (ev.kind === "note" && ev.batch) head = ev.text ?? "";
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
import { createHash as createHash6 } from "node:crypto";
import { existsSync as existsSync8, readdirSync as readdirSync6, readFileSync as readFileSync15 } from "node:fs";
import { homedir as homedir7 } from "node:os";
import { dirname as dirname5, join as join15 } from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";

// js/cli/opencode-config.ts
import { existsSync as existsSync7, readFileSync as readFileSync14 } from "node:fs";
import { homedir as homedir6 } from "node:os";
import { dirname as dirname4, join as join14 } from "node:path";
function openCodeMcpEntries(out5) {
  const dirFiles = (d) => [
    join14(d, "opencode.json"),
    join14(d, "opencode.jsonc"),
    join14(d, ".opencode", "opencode.json"),
    join14(d, ".opencode", "opencode.jsonc")
  ];
  const upwards = [];
  if (!process.env.OPENCODE_CONFIG_PROJECT_DISABLE)
    for (let d = process.cwd(); ; ) {
      upwards.push(...dirFiles(d));
      const up = dirname4(d);
      if (up === d) break;
      d = up;
    }
  const files = [
    ...process.env.OPENCODE_CONFIG ? [process.env.OPENCODE_CONFIG] : [],
    // Относится ли каталог из переменной к проектному слою, выключатель которого
    // читается ниже, не наблюдалось (#5559): читаем его в любом случае.
    ...process.env.OPENCODE_CONFIG_DIR ? dirFiles(process.env.OPENCODE_CONFIG_DIR) : [],
    ...dirFiles(join14(homedir6(), ".config", "opencode")),
    ...upwards
  ];
  const kindOf = (v) => {
    const e = v ?? {};
    const parts = [
      ...Array.isArray(e.command) ? e.command : e.command ? [e.command] : [],
      ...e.args ?? []
    ];
    if (parts.some((p) => /(^|[\\/])iskron[^\\/]*\.mjs$|iskron-bridge/.test(String(p))))
      return "bridge";
    if (e.url && isProductionServer(e.url)) return "http";
    return null;
  };
  const parse = (text) => {
    const STRING = '"(?:[^"\\\\]|\\\\.)*"';
    const noComments = text.replace(
      new RegExp(`${STRING}|/\\*[\\s\\S]*?\\*/|//[^\\n]*`, "g"),
      (m) => m.startsWith('"') ? m : ""
    );
    const noTrailing = noComments.replace(
      new RegExp(`${STRING}|,(\\s*[}\\]])`, "g"),
      (m, tail2) => m.startsWith('"') ? m : tail2 ?? ""
    );
    return JSON.parse(noTrailing);
  };
  const bridgePath = (v) => {
    const e = v ?? {};
    const parts = [
      ...Array.isArray(e.command) ? e.command : e.command ? [e.command] : [],
      ...e.args ?? []
    ].map(String);
    return parts.find((p) => /(^|[\\/])iskron[^\\/]*\.mjs$|iskron-bridge/.test(p)) ?? parts.join(" ");
  };
  let unreadable = 0;
  const sources = [];
  for (const f of new Set(files)) {
    if (!existsSync7(f)) continue;
    try {
      sources.push([f, readFileSync14(f, "utf8")]);
    } catch {
      unreadable++;
      out5(`OpenCode: ${f} не читается`);
    }
  }
  if (process.env.OPENCODE_CONFIG_CONTENT)
    sources.unshift(["OPENCODE_CONFIG_CONTENT", process.env.OPENCODE_CONFIG_CONTENT]);
  let found = 0;
  for (const [file, text] of sources) {
    try {
      const cfg = parse(text);
      for (const [name, v] of Object.entries(cfg.mcp ?? {})) {
        const kind = kindOf(v);
        if (!kind) continue;
        found++;
        if (v.enabled === false) {
          out5(`OpenCode: запись mcp «${name}» в ${file} ведёт Искрон, но выключена — не в игре`);
          continue;
        }
        out5(
          kind === "bridge" ? `OpenCode: запись mcp «${name}» в ${file} зовёт ${bridgePath(v)} — похоже на мост поставки. Если это он, её тулы namespaced, а мост общий для сессий сервиса: запись может уйти под подписью соседней сессии. Тогда убери её из этого файла руками: у opencode mcp есть list, add, auth, logout — команды remove нет. Поверхность поставки это плагин` : `OpenCode: запись mcp «${name}» в ${file} ведёт Искрон напрямую по http — её тулы namespaced, и стояния канала у неё нет; это запасной путь, и он законен там, где мост не поднять`
        );
      }
    } catch {
      unreadable++;
      out5(`OpenCode: ${file} не читается`);
    }
  }
  if (!found)
    out5(
      `OpenCode: записей mcp Искрона не нашёл${unreadable ? ` в том, что прочёл (${unreadable} файл(а) не разобрались — смотри строки выше)` : ""} — смотрел вверх от ${process.cwd()}, глобальный слой и переменные; запись в другом дереве этим не проверена, позови doctor из каталога проекта`
    );
}

// js/cli/doctor.ts
var out2 = (s2) => {
  process.stdout.write(s2 + "\n");
};
var hashOf2 = (buf) => createHash6("sha256").update(buf).digest("hex").slice(0, 8);
var seconds = (ms) => `${Math.round(ms / 1e3)}s`;
function homeCopyReport() {
  const home = homeBridgePath();
  let self = null;
  try {
    self = readFileSync15(fileURLToPath4(import.meta.url));
  } catch {
  }
  if (!existsSync8(home)) {
    out2(`домашняя копия: нет (${home}) — её кладёт establish-mcp при подключении`);
    return;
  }
  const bytes = readFileSync15(home);
  if (self && bytes.equals(self)) {
    out2(`домашняя копия: ${home} — та же сборка, что и этот файл`);
    return;
  }
  const v = versionIn(bytes.toString("utf8"));
  out2(
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
  out2(`сервер: ${CFG.serverUrl} (${serverSourceWord()})`);
  out2(`  ${freshnessWord(CFG.serverUrl)}`);
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
    out2(`  недостижим: ${errorMessage(e)}`);
    return;
  }
  res.body?.cancel?.();
  const www = res.headers.get("www-authenticate");
  const note3 = www ? " (просит OAuth)" : res.status >= 400 && res.status < 500 ? " (пробник без токена — отказ ожидаем)" : "";
  out2(`  отвечает: HTTP ${res.status}${note3}`);
  try {
    const meta = await discoverMeta(www);
    out2(`  OAuth: token endpoint ${meta.as.token_endpoint}`);
    out2(`  resource: ${meta.resource}`);
  } catch (e) {
    out2(`  OAuth discovery: ${errorMessage(e)}`);
  }
}
async function patReport() {
  out2(`грант: личный токен (PAT) из ${CFG.patSource} — OAuth не используется`);
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
    out2(`  проверить не вышло: ${errorMessage(e)}`);
    return;
  }
  res.body?.cancel?.();
  if (res.status === 401) {
    out2(
      "  ТОКЕН ОТВЕРГНУТ (HTTP 401) — отозван, истёк или без прав на этот граф: выпусти новый на странице токенов графа"
    );
  } else if (res.ok) out2(`  токен принят сервером (HTTP ${res.status})`);
  else out2(`  сервер ответил HTTP ${res.status} — не отказ токена, смотри строку «сервер»`);
  const path = storePath();
  if (existsSync8(path)) out2(`  хранилище OAuth ${path} есть, но не читается, пока стоит PAT`);
}
function grantReport() {
  const path = storePath();
  out2(`грант: ${path}`);
  if (!existsSync8(path)) {
    out2("  хранилища нет — мост ещё ни разу не входил на этот сервер");
    return;
  }
  const store = loadStore();
  const t = store.tokens;
  if (!t?.access_token) {
    out2("  токенов нет");
  } else {
    const usable = tokenUsable(t);
    const left = t.expires_at ? t.expires_at - now() : null;
    out2(
      `  access: ${usable ? "годен" : "не годен"}${left !== null ? ` (${left > 0 ? "истекает через" : "истёк"} ${seconds(Math.abs(left))})` : ""}`
    );
    const hours = refreshHours(t);
    if (!t.refresh_token) out2("  refresh: нет");
    else {
      const parts = [];
      if (hours.nbf)
        parts.push(now() < hours.nbf ? `в силе через ${seconds(hours.nbf - now())}` : "в силе");
      if (hours.exp)
        parts.push(
          now() >= hours.exp ? "ИСТЁК — нужен вход" : `истекает через ${seconds(hours.exp - now())}`
        );
      out2(`  refresh: есть${parts.length ? ` (${parts.join(", ")})` : ""}`);
    }
  }
  if (store.client?.client_id) out2(`  client_id: ${store.client.client_id}`);
  const st = loadGrantState();
  if (st.refused_since)
    out2(`  отказ стоит с ${new Date(st.refused_since).toISOString()}: ${st.reason ?? ""}`);
  for (const suffix of [".auth-pending", ".refreshing"]) {
    if (existsSync8(path + suffix)) out2(`  замок: ${path + suffix}`);
  }
  const logPath = grantLogPath();
  if (existsSync8(logPath)) {
    const lines = readFileSync15(logPath, "utf8").trim().split("\n").slice(-3);
    out2(`  grant.log, последнее:`);
    for (const l of lines) out2(`    ${l}`);
  }
}
function latestReport() {
  const latest = readLatest(CFG.authDir);
  if (!latest) {
    out2(
      "свежий релиз: мост ещё не спрашивал релизы (спросит через пару секунд после старта сессии; руками — подкоманда update)"
    );
    return;
  }
  const ago = Math.round((Date.now() - latest.checked_at) / 6e4);
  if (!latest.version)
    out2(`свежий релиз: не узнан (${latest.error ?? "без причины"}), спрашивал ${ago} мин назад`);
  else if (compareVersions(latest.version, VERSION) > 0)
    out2(
      `свежий релиз: v${latest.version} — ЭТОТ ФАЙЛ ОТСТАЛ (v${VERSION}); в дом скачано: ${latest.downloaded.join(", ") || "ничего"}; спрашивал ${ago} мин назад`
    );
  else out2(`свежий релиз: v${latest.version}, этот файл не отстал; спрашивал ${ago} мин назад`);
}
function claudePluginReport() {
  const registry = join15(homedir7(), ".claude", "plugins", "installed_plugins.json");
  if (!existsSync8(registry)) return;
  try {
    const reg = JSON.parse(readFileSync15(registry, "utf8"));
    const mine = Object.entries(reg.plugins ?? {}).filter(([k]) => /^iskron@/.test(k));
    if (!mine.length) {
      out2(`Claude Code: плагин iskron не установлен (${registry})`);
      return;
    }
    for (const [key, installs] of mine) {
      for (const inst of installs) {
        const manifest = inst.installPath ? join15(inst.installPath, ".mcp.json") : "";
        let entry = "запись моста в манифесте не найдена";
        if (manifest && existsSync8(manifest)) {
          try {
            const m = JSON.parse(readFileSync15(manifest, "utf8"));
            const hit = Object.entries(m.mcpServers ?? {}).find(
              ([, v]) => (v.args ?? []).some((a) => /iskron\.mjs/.test(a))
            );
            if (hit) entry = `запись «${hit[0]}» → мост из плагина`;
          } catch {
            entry = `${manifest} не читается`;
          }
        }
        out2(
          `Claude Code: плагин ${key} v${inst.version ?? "?"} (${inst.scope ?? "?"}) — ${entry}; ${inst.installPath ?? ""}`
        );
      }
    }
  } catch {
    out2(`Claude Code: ${registry} не читается`);
  }
}
function codexHomes() {
  const homes = [
    process.env.CODEX_HOME?.trim() || "",
    join15(homedir7(), ".codex"),
    ...process.platform === "darwin" ? [join15(homedir7(), "Library", "Application Support", "orca", "codex-runtime-home", "home")] : []
  ].filter(Boolean);
  return [...new Set(homes)].filter((h) => existsSync8(h));
}
function codexPluginReport(home) {
  const cache = join15(home, "plugins", "cache");
  if (!existsSync8(cache)) return;
  let found = 0;
  for (const market of readdirSync6(cache)) {
    const marketDir = join15(cache, market);
    let plugins;
    try {
      plugins = readdirSync6(marketDir);
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      if (!/iskron/.test(plugin)) continue;
      const dir = join15(marketDir, plugin);
      const manifest = join15(dir, ".codex-plugin", "plugin.json");
      let word = "манифеста нет";
      if (existsSync8(manifest)) {
        try {
          const m = JSON.parse(readFileSync15(manifest, "utf8"));
          const hit = Object.values(m.mcpServers ?? {}).some(
            (v) => (v.args ?? []).some((a) => /iskron\.mjs/.test(a))
          );
          word = `v${m.version ?? "?"}, ${hit ? "запись моста в манифесте есть" : "записи моста в манифесте нет"}`;
        } catch {
          word = `${manifest} не читается`;
        }
      }
      found++;
      out2(`Codex: плагин ${plugin}@${market} — ${word}; ${dir}`);
    }
  }
  if (!found) out2(`Codex: плагина iskron в кэше нет (${cache})`);
}
function harnessReport() {
  claudePluginReport();
  const claude = join15(homedir7(), ".claude.json");
  if (existsSync8(claude)) {
    try {
      const cfg = JSON.parse(readFileSync15(claude, "utf8"));
      const entries = Object.entries(cfg.mcpServers ?? {}).filter(
        ([, v]) => (v.args ?? []).some((a) => /iskron/.test(a))
      );
      if (entries.length) {
        for (const [name, v] of entries) {
          out2(`Claude Code: запись «${name}» → ${v.command ?? ""} ${(v.args ?? []).join(" ")}`);
        }
      } else
        out2(
          "Claude Code: ручной записи моста в пользовательском конфиге нет (штатная — в плагине)"
        );
    } catch {
      out2(`Claude Code: ${claude} не читается`);
    }
  }
  const opencodeDir = join15(homedir7(), ".config", "opencode");
  if (existsSync8(opencodeDir)) {
    const copy = join15(opencodeDir, "plugins", "iskron.js");
    const packaged = join15(dirname5(fileURLToPath4(import.meta.url)), "opencode-plugin.js");
    if (!existsSync8(copy)) {
      out2(`OpenCode: плагина нет (${copy}) — его кладёт establish-mcp при подключении`);
    } else if (!existsSync8(packaged)) {
      out2(
        `OpenCode: плагин ${copy} стоит; рядом с этим файлом поставки плагина нет, сверить не с чем`
      );
    } else if (readFileSync15(copy).equals(readFileSync15(packaged))) {
      out2(`OpenCode: плагин ${copy} — та же сборка, что в поставке`);
    } else {
      out2(`OpenCode: плагин ${copy} — ДРУГИЕ байты, обнови из поставки: cp "${packaged}" ${copy}`);
    }
  }
  openCodeMcpEntries(out2);
  for (const codexHome of codexHomes()) {
    out2(`Codex: дом ${codexHome}`);
    codexPluginReport(codexHome);
    const door2 = join15(codexHome, "app-server-control", "app-server-control.sock");
    if (existsSync8(door2)) out2(`Codex: дверь app-server открыта (${door2})`);
    else if (Buffer.byteLength(door2) > 100)
      out2(
        `Codex: двери нет и не будет — дом длиннее предела unix-сокета; нужен короткий дом для демона и сессий`
      );
    else
      out2(
        `Codex: двери нет (${door2}) — демон app-server не поднят; без неё кадр доставляет watchdog-exit`
      );
    const codex = join15(codexHome, "config.toml");
    if (existsSync8(codex)) {
      const text = readFileSync15(codex, "utf8");
      out2(
        `Codex: ${/^\s*\[mcp_servers\."?iskron"?\]|^\s*mcp_servers\."?iskron"?\s*=/m.test(text) ? "ручная запись моста в config.toml есть" : "ручной записи моста в config.toml нет (штатная — в плагине)"}`
      );
    }
  }
}
async function runDoctor(argv2) {
  setConfig(parseArgs(argv2));
  out2(`iskron doctor — ${BUILD}`);
  out2(`этот файл: ${fileURLToPath4(import.meta.url)}`);
  out2(`node: ${process.version}`);
  homeCopyReport();
  latestReport();
  await serverReport();
  if (CFG.pat) await patReport();
  else grantReport();
  harnessReport();
}

// js/cli/update.ts
var out3 = (s2) => {
  process.stdout.write(s2 + "\n");
};
async function runUpdate(argv2) {
  setConfig(parseArgs(argv2));
  out3(`iskron update — ${BUILD}`);
  out3(`сервер: ${CFG.serverUrl} (${serverSourceWord()}) — ${freshnessWord(CFG.serverUrl)}`);
  const latest = await checkLatest(CFG.authDir, true);
  if (!latest || !latest.version) {
    out3(`свежий релиз не узнан: ${latest?.error ?? "нет ответа"} — сеть или GitHub; повтори позже`);
    process.exitCode = 1;
    return;
  }
  const cmp = compareVersions(latest.version, VERSION);
  out3(
    `свежий релиз: v${latest.version} (${latest.tag}); этот файл: v${VERSION}${cmp > 0 ? " — отстал" : cmp < 0 ? " — новее релиза (сборка из ветки)" : " — не отстал"}`
  );
  if (latest.error) out3(`скачать не вышло: ${latest.error}`);
  if (latest.downloaded.length) for (const p of latest.downloaded) out3(`положено: ${p}`);
  else out3(`в дом ничего не клалось: ${homeBridgePath()} не старше релиза`);
  harnessReport();
  out3("");
  out3("Дальше:");
  out3(
    `  1. Скиллы обновляет канал харнеса — порядок в свежем установщике ${setupPathOf(CFG.authDir)}${latest.downloaded.includes(setupPathOf(CFG.authDir)) ? "" : " (не скачан — возьми из релиза)"}: прочти его и исполни шаги обновления для этого харнеса.`
  );
  out3(
    "  2. Перезапусти сессии харнеса: мост, поднятый прежней сборкой, живёт до конца своей сессии."
  );
  out3("  3. node ~/.iskron-bridge/iskron-bridge.mjs doctor — сверка, что стоит и работает.");
}

// js/cli/use.ts
var out4 = (s2) => {
  process.stdout.write(s2 + "\n");
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
    out4("use: назови адрес — en (mcp.iskron.ai), ru (mcp.iskron.ru) или полный URL инстанса");
    process.exitCode = 2;
    return;
  }
  const path = writeServerChoice(CFG.authDir, url);
  out4(`мост смотрит на ${url} — записано в ${path}; ${freshnessWord(url)}`);
  out4(
    "Действует с нового процесса моста: перезапусти сессии харнеса. Грант раздельный по адресу — первый вызов на новом адресе ведёт во вход."
  );
}

// js/cli/iskron.ts
var USAGE = `iskron ${BUILD}
  node iskron.mjs [bridge] [server-url] [--timeout <ms>] [--auth-dir <dir>] [--no-browser] [--debug] [--satellite]
      (--satellite — мост прогона субагента из файла агента: только место-спутник <место позвавшего>.sub-N)
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
