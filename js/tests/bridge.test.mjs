// Behavioural tests for iskron-bridge, run against the local fake in
// tests/fake-nks.mjs. Black box on purpose: the bridge is spawned exactly as a
// harness spawns it, driven over stdio, and every claim is read off what a
// harness or a browser would actually see — a JSON-RPC answer, an open port,
// the token store on disk. Nothing here reaches the network or the real store.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

// Чем запускать поставку: node по умолчанию; ISKRON_NODE подставляет другой рантайм
// (например, `opencode` под BUN_BE_BUN=1 — Bun, встроенный в OpenCode).
const NODE = process.env.ISKRON_NODE || process.execPath;

// Defaults to the source of truth; ISKRON_BRIDGE_PATH points the same suite at
// another copy — a built bundle, an installed one, or a past revision when you
// want to see a test fail on the defect it was written for.
const BRIDGE =
  process.env.ISKRON_BRIDGE_PATH ||
  join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "skills",
    "establish-mcp",
    "scripts",
    "iskron.mjs",
  );
const INIT_PARAMS = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-harness", version: "0" },
};
// Our own client — the OpenCode plugin: it reads a refused handshake itself and
// waits out the login, so its handshake is paced like any call (#4790). The name
// mirrors OWN_CLIENTS in js/shared/clients.ts; a probe cannot import TypeScript.
const OWN_INIT_PARAMS = { ...INIT_PARAMS, clientInfo: { name: "opencode-iskron", version: "1" } };

// --- driving the bridge the way a harness does -----------------------------

// `browser: true` lets the bridge reach for the OS opener, which the test then
// impersonates; every other test keeps the browser shut.
function startBridge(serverUrl, authDir, extraEnv = {}, { browser = false } = {}) {
  const proc = spawn(
    NODE,
    [BRIDGE, serverUrl, ...(browser ? [] : ["--no-browser"]), "--auth-dir", authDir],
    {
      env: { ...process.env, ...(browser ? {} : { ISKRON_BRIDGE_NO_BROWSER: "1" }), ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const waiters = new Map();
  let out = "";
  let stderr = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  proc.stderr.on("data", (c) => {
    stderr += c;
  });

  return {
    proc,
    get stderr() {
      return stderr;
    },
    send: (msg) => proc.stdin.write(JSON.stringify(msg) + "\n"),
    // Every request must be answered — that is the bridge's core promise, so
    // the timeout here is a failure, never a skip.
    call(method, id, params = {}) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(
          () => rej(new Error(`no answer for ${method} (id ${id}) — the bridge went silent`)),
          15_000,
        ).unref();
      });
      this.send({ jsonrpc: "2.0", id, method, params });
      return p;
    },
    // Idempotent: a bridge the test already killed must not be waited on again.
    stop: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.kill("SIGKILL");
          }),
  };
}

// Список тулов сервера едет как есть; мост дописывает в хвост свой iskron_stand.
const toolNames = (tools) => (tools ?? []).map((t) => t.name);
// The login link the bridge hands out is its own loopback address; opening it
// mints the sign-in server's authorize URL at that moment (#4794). A past
// bridge handed out the authorize URL itself — read too, so a probe run
// against it (ISKRON_BRIDGE_PATH) fails on its defect, not on the link's shape.
const authorizeUrlIn = (text) =>
  /(http:\/\/127\.0\.0\.1:\d+\/login(?:\?k=[\w-]+)?|https?:\/\/\S*\/authorize\?\S+)/.exec(
    text || "",
  )?.[1] ?? null;
const exited = (b) => new Promise((r) => b.proc.once("exit", r));
const callbackPortOf = (link) => Number(new URL(link).port);
// The sign-in page a login link sends the human to, minted as it is opened.
async function mintedFrom(link) {
  const res = await fetch(link, { redirect: "manual" });
  await res.text();
  return res.headers.get("location");
}

function portListening(port) {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(1000, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

const storeFile = (dir) =>
  join(
    dir,
    readdirSync(dir).find((f) => f.endsWith(".json")),
  );
// The machine's memory of a refused grant. Aging it is how a test stands where
// a refusal has already persisted, without spending the grace window in real time.
const ageRefusal = (dir) =>
  writeFileSync(
    storeFile(dir) + ".grant-state",
    JSON.stringify({ refused_since: Date.now() - 600_000, reason: "aged by the test" }),
  );
const lockFile = (dir) =>
  join(
    dir,
    readdirSync(dir).find((f) => f.endsWith(".auth-pending")),
  );
const readStore = (dir) => JSON.parse(readFileSync(storeFile(dir), "utf8"));
// Which login the machine has out. The link is the same for every login on a
// port, so the login's own state is what tells two logins apart.
const loginState = (dir) => {
  try {
    return JSON.parse(readFileSync(lockFile(dir), "utf8")).state ?? null;
  } catch {
    return null;
  }
};

// The bridge answers the harness at once and finishes the flow in the
// background, so the click landing is not yet the grant being on disk. Tests
// that go on to depend on the grant wait for it rather than racing it.
async function waitFor(check, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      /* not there yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const grantLanded = (dir) =>
  waitFor(() => !!readStore(dir).tokens?.access_token, "the exchanged tokens to reach the store");

// A whole authorization: ask, take the URL the bridge published, and play the
// human's click on it. The redirect lands on the bridge's own loopback listener.
async function authorize(bridge, dir, id = 1) {
  const pending = await bridge.call("initialize", id, INIT_PARAMS);
  const url = authorizeUrlIn(pending.error?.message);
  assert.ok(url, `expected an authorize URL in the answer, got ${JSON.stringify(pending)}`);
  const res = await fetch(url, { redirect: "follow" });
  assert.equal(res.status, 200, "the loopback callback did not answer the redirect");
  await res.text();
  await grantLanded(dir);
  return url;
}

async function withFake(t, opts, fn) {
  const fake = await startFakeNks(opts);
  const dir = mkdtempSync(join(tmpdir(), "iskron-bridge-test-"));
  const bridges = [];
  const spawnBridge = (env, opts) => {
    const b = startBridge(fake.mcpUrl, dir, env, opts);
    bridges.push(b);
    return b;
  };
  try {
    await fn({ fake, dir, spawnBridge });
  } finally {
    await Promise.all(bridges.map((b) => b.stop()));
    await fake.stop();
  }
}

// --- the browser the bridge opens itself -----------------------------------

// On Windows the bridge used to hand the URL to `cmd /c start "" <url>`, and
// cmd.exe reads `&` as a command separator (graph @nks/nks-dev, node #4538).
// The claim: on win32 the whole URL reaches the OS opener through PowerShell's
// encoded command, which no shell parses. This is the imitation rung: the
// carrier is a Windows machine, named in AGENTS.md (Reality).
test("on Windows the authorize URL reaches the browser whole — PowerShell, not cmd", async (t) => {
  if (process.env.ISKRON_NODE) {
    t.skip("the platform override rides NODE_OPTIONS, which only node itself reads");
    return;
  }
  await withFake(t, {}, async ({ spawnBridge }) => {
    const root = mkdtempSync(join(tmpdir(), "iskron-win-"));
    const psDir = join(root, "System32", "WindowsPowerShell", "v1.0");
    mkdirSync(psDir, { recursive: true });
    const record = join(root, "argv.txt");
    // Both openers record what they were handed: whichever the bridge reaches for.
    for (const exe of [join(psDir, "powershell.exe"), join(root, "cmd")]) {
      writeFileSync(exe, `#!/bin/sh\nprintf '%s\\n' "$0" "$@" > "${record}"\n`, { mode: 0o755 });
    }
    const preload = join(root, "win32.cjs");
    writeFileSync(preload, 'Object.defineProperty(process, "platform", { value: "win32" });\n');
    const bridge = spawnBridge(
      {
        NODE_OPTIONS: `--require ${preload}`,
        SystemRoot: root,
        PATH: `${root}:${process.env.PATH}`,
      },
      { browser: true },
    );
    const answer = await bridge.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error?.message);
    assert.ok(url, `expected an authorize URL in the answer, got ${JSON.stringify(answer)}`);
    // The redirect creates the file before printf fills it: wait for content.
    await waitFor(() => readFileSync(record, "utf8").includes("\n"), "the OS opener to be called");
    const argv = readFileSync(record, "utf8").trim().split("\n");
    assert.match(
      argv[0],
      /powershell\.exe$/,
      `the URL must travel inside PowerShell's encoded command, never through cmd.exe, which cuts it at the first &; the bridge ran ${argv[0]}`,
    );
    const i = argv.indexOf("-EncodedCommand");
    assert.ok(
      i > 0 && argv[i + 1],
      `PowerShell must receive the command encoded; argv: ${argv.join(" ")}`,
    );
    const command = Buffer.from(argv[i + 1], "base64").toString("utf16le");
    assert.ok(
      command.includes(`'${url}'`),
      `the whole URL, as a literal single-quoted string, must be inside the command; got: ${command}`,
    );
    await bridge.stop();
  });
});

// --- the promise the bridge is built on ------------------------------------

test("a call made with no tokens is answered, not swallowed, and carries the authorize URL", async (t) => {
  await withFake(t, {}, async ({ spawnBridge }) => {
    const bridge = spawnBridge();
    const answer = await bridge.call("initialize", 1, INIT_PARAMS);
    assert.equal(answer.id, 1);
    assert.ok(answer.error, "a call that cannot be served must come back as an error for its id");
    assert.ok(
      authorizeUrlIn(answer.error.message),
      "the error must carry the URL the human has to open",
    );
  });
});

test("the callback listener is up BEFORE the authorize URL is published", async (t) => {
  await withFake(t, {}, async ({ spawnBridge }) => {
    const bridge = spawnBridge();
    const answer = await bridge.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error.message);
    assert.equal(
      await portListening(callbackPortOf(url)),
      true,
      "the URL was handed out while nothing was listening on its redirect port",
    );
  });
});

test("the full flow authenticates and the next call goes through", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    const answer = await bridge.call("tools/list", 2);
    assert.deepEqual(toolNames(answer.result.tools), ["nks_orient", "iskron_stand"]);
    assert.equal(fake.state.counts.code_exchange, 1);
    assert.ok(
      readStore(dir).tokens.refresh_token,
      "the grant must be persisted for the next process",
    );
  });
});

// --- the reported defect: a pending flow whose owner is gone ---------------

test("a pending flow whose listener is gone is taken over, not re-published", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    // Exactly what the dead ephemeral process leaves behind: a fresh-looking
    // file naming a URL nothing will ever catch. The pid is this very test
    // runner, so a liveness check on the pid alone would be fooled.
    const first = spawnBridge();
    const stale = await first.call("initialize", 1, INIT_PARAMS);
    const staleUrl = authorizeUrlIn(stale.error.message);
    const stalePort = callbackPortOf(staleUrl);
    const lock = lockFile(dir);
    const held = JSON.parse(readFileSync(lock, "utf8"));
    await first.stop(); // SIGKILL: no exit handler, the file survives its owner
    writeFileSync(lock, JSON.stringify({ ...held, pid: process.pid, started_at: Date.now() }));
    assert.equal(
      await portListening(stalePort),
      false,
      "precondition: the dead owner's port is closed",
    );

    const second = spawnBridge();
    const answer = await second.call("initialize", 2, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error.message);
    // The tab the human already has must stay good: one login, one tab (#4794).
    assert.equal(url, staleUrl, "the next bridge takes the login over on the same link");
    assert.equal(
      await portListening(stalePort),
      true,
      "the next bridge must listen on the published link, or the tab leads nowhere",
    );
    // And the taken-over login really completes — through the old tab's link.
    const res = await fetch(staleUrl, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await grantLanded(dir);
    assert.deepEqual(toolNames((await second.call("tools/list", 3)).result.tools), [
      "nks_orient",
      "iskron_stand",
    ]);
  });
});

test("a bridge told to stop mid-flow outlives it, so the human's click still lands", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    const url = authorizeUrlIn((await bridge.call("initialize", 1, INIT_PARAMS)).error.message);
    bridge.proc.kill("SIGTERM"); // what a harness does when its session ends
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(bridge.proc.exitCode, null, "the bridge left while a human was mid-login");
    assert.equal(
      await portListening(callbackPortOf(url)),
      true,
      "the redirect had nowhere to land",
    );

    const res = await fetch(url, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await grantLanded(dir);
    await waitFor(() => bridge.proc.exitCode !== null, "the bridge to leave once the flow is done");
  });
});

test("a harness whose pipes die mid-flow still lets the human's click land", async (t) => {
  // The SIGTERM above is the polite death. The common one is not polite: the
  // harness process goes and the bridge's stdout and stderr become broken pipes
  // under it while a human is mid-login. Every write fails from then on, and a
  // bridge that answers a failed write with another write starves the exchange
  // it stayed alive for — the click lands, the browser is told "authenticated",
  // and no token is ever written. Witnessed in the field: two clicks, two
  // success pages, an empty store, and a core at 100%.
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    const url = authorizeUrlIn((await bridge.call("initialize", 1, INIT_PARAMS)).error.message);

    bridge.proc.stdout.destroy(); // nothing reads these any more
    bridge.proc.stderr.destroy();

    const res = await fetch(url, { redirect: "follow" });
    assert.equal(res.status, 200, "the redirect had nowhere to land");
    await res.text();
    await grantLanded(dir);
  });
});

test("a wind-down through a pipe nobody will ever read still ends", async (t) => {
  // Winding down flushes stdout first, so an answer half-written is not an
  // answer lost. But a pipe whose reader is gone never drains: the drain
  // callback never fires, and a bridge that waits on it never exits — it stays
  // on the machine for as long as the machine is up.
  await withFake(t, { padBytes: 200_000 }, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);

    bridge.proc.stdout.pause(); // the answer fills the pipe and stays there
    bridge.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "big" } });
    await new Promise((r) => setTimeout(r, 400));
    bridge.proc.stdout.destroy(); // ...and now nobody will ever read it
    bridge.proc.stderr.destroy();
    bridge.proc.stdin.end(); // the harness is gone

    await waitFor(
      () => bridge.proc.exitCode !== null || bridge.proc.signalCode !== null,
      "the bridge to finish winding down",
      12_000,
    );
  });
});

test("the browser is told what happened, not what was hoped", async (t) => {
  // The click landing is not the grant existing: the code still has to be
  // exchanged. A page that says "authenticated" on the redirect alone reports
  // a success it has not witnessed — and it is the only report the human ever
  // reads before closing the tab.
  await withFake(t, {}, async ({ spawnBridge }) => {
    const bridge = spawnBridge();
    const url = authorizeUrlIn((await bridge.call("initialize", 1, INIT_PARAMS)).error.message);
    const state = new URL(await mintedFrom(url)).searchParams.get("state");

    // The state is the bridge's own, so the redirect is accepted — but the code
    // is one the server never issued, so the exchange behind it fails.
    const res = await fetch(
      `http://127.0.0.1:${callbackPortOf(url)}/callback?code=never-issued&state=${state}`,
    );
    const page = await res.text();

    assert.ok(
      !/authenticated/i.test(page),
      `the human was told success over a failed exchange: ${page}`,
    );
    assert.match(page, /failed/i, "the page must name the failure the human is looking at");
  });
});

test("a second click does not leave the first tab hanging", async (t) => {
  // The held page is what makes a human click again, so the second click is the
  // expected case, not the odd one. Both tabs must be answered: a response
  // dropped for a newer one spins until the browser gives up on it.
  await withFake(t, { codeDelayMs: 1500 }, async ({ spawnBridge }) => {
    const bridge = spawnBridge();
    const url = authorizeUrlIn((await bridge.call("initialize", 1, INIT_PARAMS)).error.message);
    const state = new URL(await mintedFrom(url)).searchParams.get("state");
    const cb = `http://127.0.0.1:${callbackPortOf(url)}/callback?code=never-issued&state=${state}`;

    const first = fetch(cb);
    await new Promise((r) => setTimeout(r, 150)); // the first tab is being held
    const second = await fetch(cb);

    const answered = await Promise.race([
      first.then(() => "answered"),
      new Promise((r) => setTimeout(() => r("left hanging"), 4000)),
    ]);
    assert.equal(answered, "answered", "the first tab was never answered");
    assert.equal(second.status, 200);
    await second.text();
  });
});

test("a finished flow leaves no pending lock behind", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    await waitFor(
      () => !readdirSync(dir).some((f) => f.endsWith(".auth-pending")),
      "the pending lock to be dropped",
    );
  });
});

test("a live flow is joined: every instance shows the same URL, one click serves them all", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const winner = spawnBridge();
    const joiner = spawnBridge();
    const winnerUrl = authorizeUrlIn(
      (await winner.call("initialize", 1, INIT_PARAMS)).error.message,
    );
    const joinerUrl = authorizeUrlIn(
      (await joiner.call("initialize", 1, INIT_PARAMS)).error.message,
    );
    assert.equal(
      joinerUrl,
      winnerUrl,
      "a second bridge must surface the standing flow, not start a rival one",
    );

    const res = await fetch(winnerUrl, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await grantLanded(dir);
    // The joiner never ran a flow of its own; it reads the grant off disk.
    const answer = await joiner.call("tools/list", 2);
    // Список сервера едет как есть, плюс тул самого моста в хвосте.
    assert.deepEqual(
      answer.result.tools.map((t) => t.name),
      ["nks_orient", "iskron_stand"],
    );
  });
});

test("a fresh process reuses the stored grant with no browser trip at all", async (t) => {
  await withFake(t, { accessTtl: 3600 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const second = spawnBridge();
    const answer = await second.call("initialize", 1, INIT_PARAMS);
    assert.ok(
      answer.result,
      `the second process should have been served straight away: ${JSON.stringify(answer.error)}`,
    );
    assert.equal(fake.state.counts.authorize, 1, "no second browser flow may be started");
  });
});

// --- keeping the grant alive -----------------------------------------------

test("an expired access token is refreshed silently, without touching the browser", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = JSON.parse(readFileSync(storeFile(dir), "utf8"));
    s.tokens.expires_at = Date.now() - 1000; // as if the session idled past expiry
    writeFileSync(storeFile(dir), JSON.stringify(s));

    const second = spawnBridge();
    const answer = await second.call("initialize", 1, INIT_PARAMS);
    assert.ok(answer.result, `expected a served call, got ${JSON.stringify(answer.error)}`);
    assert.ok(fake.state.counts.refresh >= 1, "the bridge should have refreshed");
    assert.equal(
      fake.state.counts.authorize,
      1,
      "a refresh must not drag the user into the browser",
    );
    assert.notEqual(
      readStore(dir).tokens.refresh_token,
      s.tokens.refresh_token,
      "the rotated refresh token must be stored",
    );
  });
});

test("a transient refresh failure keeps the grant and never opens a browser", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const before = readStore(dir).tokens.refresh_token;
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({
      refreshStatus: 503,
      refreshError: "temporarily_unavailable",
      revoke_access: true,
    });

    const second = spawnBridge();
    const answer = await second.call("initialize", 1, INIT_PARAMS);
    assert.ok(answer.error, "the call cannot be served while the token endpoint is down");
    assert.equal(
      authorizeUrlIn(answer.error.message),
      null,
      "a 503 must not send the human to a login screen",
    );
    assert.equal(
      readStore(dir).tokens.refresh_token,
      before,
      "the grant must survive a transient failure",
    );
    assert.equal(fake.state.counts.authorize, 1);
  });
});

// A login is the one repair that spends a human's attention, so the bridge is
// slow to ask and slower to ask twice — while a session runs. A handshake is
// the human at the keyboard, and it is not paced (the handshake probe, #4790).

// No answer of the bridge ever tells a human to come back in N minutes (graph
// @nks/nks-dev, node #4794). A server mid-restart can word a live grant's death
// the same way, so the bridge knocks again itself, inside the call — and then
// the call carries the login, not a wait.
test("a grant dying under a live session hands the call a login — no wait, no pause", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const live = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50,50" });
    assert.ok(
      (await live.call("initialize", 1, INIT_PARAMS)).result,
      "precondition: a live session",
    );
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const answer = await live.call("tools/call", 2, { name: "nks_orient", arguments: {} });
    const url = authorizeUrlIn(answer.error?.message);
    assert.ok(url, `the call must carry the login at once: ${answer.error?.message}`);
    assert.equal(await portListening(callbackPortOf(url)), true);
    assert.doesNotMatch(
      answer.error.message,
      /holding off|not asking again|clears itself by waiting|wait out/,
      "no answer tells the human to come back later",
    );
    assert.ok(
      fake.state.counts.refresh >= 2,
      "the bridge knocks again itself before it calls a human in",
    );
    assert.match(
      readFileSync(join(dir, "grant.log"), "utf8"),
      /invalid_grant/,
      "the grant log must carry the server's own words",
    );
  });
});

test("Rauthy's dead-refresh 404 costs exactly one new browser flow", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const before = readStore(dir).tokens.refresh_token;
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({
      refreshStatus: 404,
      refreshError: "NotFound",
      refreshMessage: "Refresh Token does not exist",
      revoke_access: true,
    });

    // Two harnesses connecting on the dead grant: a handshake is not paced, and
    // the second joins the login the first published.
    const beforeLogin = { ...fake.state.counts };
    const retries = [spawnBridge(), spawnBridge()];
    const pending = await Promise.all(
      retries.map((bridge) => bridge.call("initialize", 1, INIT_PARAMS)),
    );
    const urls = pending.map((answer) => authorizeUrlIn(answer.error?.message));
    assert.ok(
      urls.every(Boolean),
      `both processes must receive an authorization URL: ${JSON.stringify(pending)}`,
    );
    assert.equal(urls[1], urls[0], "both processes must join the same machine-wide browser flow");
    assert.equal(
      fake.state.counts.register,
      beforeLogin.register,
      "the joined flow must not hide a second dynamic client registration",
    );
    assert.equal(
      fake.state.counts.authorize,
      beforeLogin.authorize,
      "publishing one flow must not visit its authorize URL before the human does",
    );

    const res = await fetch(urls[0], { redirect: "follow" });
    assert.equal(res.status, 200, "the replacement authorization must complete");
    await res.text();
    await waitFor(
      () => readStore(dir).tokens?.refresh_token !== before,
      "the replacement grant to reach the store",
    );
    const served = await Promise.all(retries.map((bridge) => bridge.call("tools/list", 2)));
    for (const answer of served) {
      assert.deepEqual(
        toolNames(answer.result?.tools),
        ["nks_orient", "iskron_stand"],
        `the replacement grant must serve every process: ${JSON.stringify(answer.error)}`,
      );
    }
    assert.equal(
      fake.state.counts.register,
      beforeLogin.register,
      "the dead grant must not cost another dynamic client registration",
    );
    assert.equal(
      fake.state.counts.authorize,
      beforeLogin.authorize + 1,
      "the dead grant must cost exactly one visit to one new browser flow",
    );
    assert.equal(
      fake.state.counts.code_exchange,
      beforeLogin.code_exchange + 1,
      "the one browser flow must exchange exactly one authorization code",
    );
  });
});

// --- the keepalive on a dead grant -----------------------------------------

test("a keepalive that meets a dead refresh records the refusal, so the human's grace is already warm", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const before = readStore(dir).tokens.refresh_token;
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({
      refreshStatus: 404,
      refreshError: "NotFound",
      refreshMessage: "Refresh Token does not exist",
      revoke_access: true,
    });

    const bridge = spawnBridge();
    const stateFile = storeFile(dir) + ".grant-state";
    await waitFor(
      () => !!JSON.parse(readFileSync(stateFile, "utf8")).refused_since,
      "the keepalive refusal to warm the human's grace",
      5000,
    );
    assert.equal(fake.state.counts.refresh, 1, "the keepalive must knock exactly once");
    assert.equal(fake.state.counts.authorize, 1, "the background must not open a browser");
    const log = readFileSync(join(dir, "grant.log"), "utf8");
    assert.match(log, /grant refused/, "the background refusal must reach the machine log");
    assert.doesNotMatch(log, /too early/, "a dead refresh is not an early speculative refusal");
    assert.equal(
      readStore(dir).tokens.refresh_token,
      before,
      "the refused refresh must remain on disk",
    );

    const refusal = JSON.parse(readFileSync(stateFile, "utf8"));
    refusal.refused_since = Date.now() - 600_000;
    writeFileSync(stateFile, JSON.stringify(refusal));
    // Our own client's handshake is paced — the one the warm grace governs.
    const answer = await bridge.call("initialize", 1, OWN_INIT_PARAMS);
    assert.ok(
      authorizeUrlIn(answer.error?.message),
      `the already-warm grace must offer login immediately: ${JSON.stringify(answer)}`,
    );
  });
});

test("idle bridges knock once on a refused grant, not once per process", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({
      refreshStatus: 404,
      refreshError: "NotFound",
      refreshMessage: "Refresh Token does not exist",
      revoke_access: true,
    });

    const bridges = [spawnBridge(), spawnBridge(), spawnBridge()];
    await waitFor(() => fake.state.counts.refresh >= 1, "one background control knock");
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(
      fake.state.counts.refresh,
      1,
      "the refused grant gets one machine-wide control knock",
    );
    assert.ok(
      bridges.every((b) => b.proc.exitCode === null),
      "every idle bridge must remain alive",
    );
    assert.ok(
      JSON.parse(readFileSync(storeFile(dir) + ".grant-state", "utf8")).refused_since,
      "the machine must retain the refusal",
    );
  });
});

test("a request that left and never came back is reported as an unknown outcome", async (t) => {
  // The two halves of the network axis mean opposite things to a caller. A call
  // that never went out applied nothing; a call that went out and lost its answer
  // may have applied everything. A timeout is the second, and calling it "safe"
  // is how a write gets applied twice.
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge({ ISKRON_BRIDGE_TIMEOUT: "1200" });
    await authorize(bridge, dir);
    await fake.control({ mcpHangMs: 6000 });

    const answer = await bridge.call("tools/list", 2);
    assert.ok(answer.error, "a deadline that passes must still answer the harness");
    assert.match(
      answer.error.message,
      /OUTCOME IS UNKNOWN/,
      `a lost answer is not a call that never went out: ${answer.error.message}`,
    );
    assert.ok(
      !/retry freely/.test(answer.error.message),
      "a blind retry after a lost answer can apply the write a second time",
    );
  });
});

// The hour a server puts on a refresh token paces the refresh nobody needs yet.
// It must never pace the one a caller is waiting on: a guess that turns into a
// wall costs half an hour of blindness, and the guess can simply be stale.

test("the refresh nobody needs yet waits for its hour instead of spending a refusal", async (t) => {
  await withFake(t, { refreshNotBeforeMs: 60_000 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    // Inside the keepalive's margin, so it wants to top the token up — but the
    // token it would present is not in force for another minute, and the access
    // token in hand still works. Nothing to gain, one refusal to lose.
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() + 60_000;
    writeFileSync(storeFile(dir), JSON.stringify(s));

    const bridge = spawnBridge();
    assert.ok(
      (await bridge.call("initialize", 1, INIT_PARAMS)).result,
      "the token in hand still serves",
    );
    assert.equal(fake.state.counts.refresh, 0, "the speculative refresh must wait for the hour");
    assert.equal(fake.state.counts.authorize, 1, "and nobody may be sent to a browser over it");
  });
});

test("a refresh the caller needs, moments short of its hour, is waited out inside the call and served", async (t) => {
  await withFake(t, { refreshNotBeforeMs: 2000 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    // Upstream refuses the access token we hold while the refresh token is not
    // yet in force — witnessed live, minutes after a rotation. Seconds short of
    // its hour, the wait is shorter than the call: the bridge's to sit out.
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    const grant = s.tokens.refresh_token;
    await fake.control({ revoke_access: true });

    const early = spawnBridge();
    const answer = await early.call("initialize", 1, INIT_PARAMS);
    assert.ok(
      answer.result,
      `a wait shorter than a call is the bridge's, not the caller's: ${JSON.stringify(answer.error)}`,
    );
    assert.ok(
      fake.state.counts.refresh >= 2,
      "the bridge asked, heard «not yet», and asked again once the hour came",
    );
    assert.notEqual(readStore(dir).tokens.refresh_token, grant, "the same grant rotated on");
    assert.equal(fake.state.counts.authorize, 1, "and no human was ever asked");
  });
});

test("the access token's own exp outranks the expires_in the server advertised", async (t) => {
  // A server may advertise one lifetime and stamp another; the resource server
  // checks the stamp. Half an hour of imagined validity is half an hour of 401s.
  await withFake(t, { accessTtl: 3600, accessExpSkewSec: 1800 }, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);

    const claimed =
      JSON.parse(Buffer.from(readStore(dir).tokens.access_token.split(".")[1], "base64url")).exp *
      1000;
    const held = readStore(dir).tokens.expires_at;
    assert.ok(held <= claimed, "the bridge must not hold a token as good past its own exp");
    assert.ok(
      claimed - held <= 120_000,
      `the margin should be a skew, not a guess: ${claimed - held}ms`,
    );
  });
});

test("a short-lived access token is not stale the moment it arrives", async (t) => {
  // The caution taken off a token's life is a skew, not a fixed minute: a
  // twenty-second token minus a minute is dead on arrival, and every call
  // would then buy a refresh it does not need.
  await withFake(t, { accessTtl: 20 }, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    assert.ok(
      readStore(dir).tokens.expires_at > Date.now(),
      "a token just issued must count as usable",
    );

    assert.ok((await bridge.call("tools/list", 2)).result);
    assert.equal(
      fake.state.counts.refresh,
      0,
      "and must not be topped up before it has been used once",
    );
  });
});

test("a store written before the bridge knew about hours is still read by them", async (t) => {
  // The machine mid-upgrade: tokens on disk from an older bridge, so none of
  // the schedule fields are there. The hours are in the token all the same.
  await withFake(t, { refreshNotBeforeMs: 60_000 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    delete s.tokens.refresh_not_before;
    delete s.tokens.refresh_expires_at;
    s.tokens.expires_at = Date.now() + 60_000; // inside the keepalive's margin
    writeFileSync(storeFile(dir), JSON.stringify(s));

    const bridge = spawnBridge();
    assert.ok(
      (await bridge.call("initialize", 1, INIT_PARAMS)).result,
      "the token in hand still serves",
    );
    assert.equal(
      fake.state.counts.refresh,
      0,
      "the token's own nbf must be honoured with no field to help",
    );
    await bridge.stop();

    // And the same claims must carry the OTHER half: when the refresh is needed
    // and refused, the refusal is read as too-early from the token itself.
    const s2 = readStore(dir);
    delete s2.tokens.refresh_not_before;
    delete s2.tokens.refresh_expires_at;
    s2.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s2));
    await fake.control({ revoke_access: true });

    const needy = spawnBridge();
    assert.ok(
      (await needy.call("initialize", 1, INIT_PARAMS)).result,
      "the handshake stands on the last server answer, whatever the grant says",
    );
    const held = await needy.call("tools/call", 2, { name: "nks_orient", arguments: {} });
    assert.ok(held.error, "the server refuses it — nothing to serve with");
    assert.match(
      held.error.message,
      /whole/,
      "read from the token's own claims, this is too-early, not a dead grant — the login only rides beside it",
    );
    assert.equal(readStore(dir).tokens.refresh_token, s2.tokens.refresh_token, "grant kept");
  });
});

// A «no» closes that login; the next need opens one new one — never «not now,
// come back in ten minutes» (#4794).
test("a declined login is followed by one new login on the next need — no pause", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const bridge = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50" });
    const offered = await bridge.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(offered.error?.message);
    assert.ok(url, `a dead grant should have led to a login: ${JSON.stringify(offered)}`);

    // The human says no: the consent screen comes back with a refusal.
    const declined = loginState(dir);
    const signIn = new URL(await mintedFrom(url));
    const back = new URL(signIn.searchParams.get("redirect_uri"));
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("state", signIn.searchParams.get("state"));
    await (await fetch(back)).text();
    await waitFor(
      async () => !(await portListening(callbackPortOf(url))),
      "the declined flow to close",
    );

    const again = await bridge.call("tools/call", 2, { name: "nks_orient", arguments: {} });
    const next = authorizeUrlIn(again.error?.message);
    assert.ok(next, `the next need must be offered a login at once: ${again.error?.message}`);
    assert.notEqual(loginState(dir), declined, "the declined login is closed — this is a new one");
    assert.doesNotMatch(again.error.message, /not asking again|clears itself by waiting/);
  });
});

// --- one machine, one grant ------------------------------------------------
// A machine runs many agents, so many bridges, all reading one grant off one
// file. Refreshing ROTATES that grant, so the crowd is the dangerous case, not
// the rare one: whoever presents the rotated-away token is, to a server that
// watches for replay, a thief. The delay on the fake's token endpoint is what
// makes the race a fact instead of a hope — it holds the window open long
// enough for every bridge to reach it.

// Wide enough that every bridge is inside the token endpoint's window before
// the first answer comes back: without it the crowd degenerates into a queue,
// and a queue is exactly the case that never had a defect.
const SLOW_TOKEN_MS = 250;

// Everyone awake at once on one shared grant, with nothing left that still
// works: the access token is past its clock AND refused upstream, so no bridge
// can serve anything until the grant has been through the token endpoint. That
// is the machine after an idle stretch — and the moment the crowd forms.
async function crowdPastExpiry(fake, dir, spawnBridge, size = 3) {
  const s = readStore(dir);
  s.tokens.expires_at = Date.now() - 1000;
  writeFileSync(storeFile(dir), JSON.stringify(s));
  await fake.control({ revoke_access: true });
  const crowd = Array.from({ length: size }, () => spawnBridge());
  return Promise.all(crowd.map((b, i) => b.call("initialize", 10 + i, INIT_PARAMS)));
}

test("a crowd of bridges refreshes the shared grant exactly once", async (t) => {
  await withFake(t, { refreshDelayMs: SLOW_TOKEN_MS }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const answers = await crowdPastExpiry(fake, dir, spawnBridge);
    answers.forEach((a, i) =>
      assert.ok(a.result, `bridge ${i} went unserved: ${JSON.stringify(a.error)}`),
    );
    assert.equal(
      fake.state.counts.stale_refresh,
      0,
      "no bridge may present a refresh token the server has already rotated away",
    );
    assert.equal(fake.state.counts.refresh, 1, "one grant, one expiry — one refresh");
    assert.equal(fake.state.counts.authorize, 1, "nobody may be sent back to a login screen");
  });
});

test("a server that reads replay as theft keeps the grant through the crowd", async (t) => {
  await withFake(
    t,
    { refreshDelayMs: SLOW_TOKEN_MS, reuseDetection: true },
    async ({ fake, dir, spawnBridge }) => {
      const first = spawnBridge();
      await authorize(first, dir);
      await first.stop();

      const answers = await crowdPastExpiry(fake, dir, spawnBridge);
      answers.forEach((a, i) =>
        assert.ok(a.result, `bridge ${i} went unserved: ${JSON.stringify(a.error)}`),
      );
      assert.equal(
        fake.state.counts.authorize,
        1,
        "a rotation race must not cost the human a re-login",
      );
      assert.ok(readStore(dir).tokens.refresh_token, "the machine must still hold a grant");

      const later = spawnBridge();
      assert.ok(
        (await later.call("initialize", 30, INIT_PARAMS)).result,
        "and the grant it holds must still work",
      );
    },
  );
});

for (const [way, go] of [
  ["stdin closed", (b) => b.proc.stdin.end()],
  ["SIGTERM", (b) => b.proc.kill("SIGTERM")],
  ["SIGINT", (b) => b.proc.kill("SIGINT")],
]) {
  test(`a bridge wound down mid-refresh (${way}) writes the rotation down before it leaves`, async (t) => {
    await withFake(t, { refreshDelayMs: 1500 }, async ({ fake, dir, spawnBridge }) => {
      const first = spawnBridge();
      await authorize(first, dir);
      await first.stop();

      const old = readStore(dir).tokens.refresh_token;
      const s = readStore(dir);
      s.tokens.expires_at = Date.now() - 1000;
      writeFileSync(storeFile(dir), JSON.stringify(s));

      const bridge = spawnBridge();
      await waitFor(() => fake.state.counts.refresh >= 1, "the startup refresh to be in flight");
      const exit = exited(bridge);
      go(bridge);
      const code = await Promise.race([
        exit,
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error("bridge did not wind down within 10s")),
            10_000,
          ).unref();
        }),
      ]);
      assert.equal(code, 0, "the bridge must leave cleanly after preserving the rotation");
      assert.notEqual(
        readStore(dir).tokens.refresh_token,
        old,
        "the old refresh token must be retired on disk",
      );
      assert.equal(
        readStore(dir).tokens.refresh_token,
        fake.state.refresh,
        "the store must hold the refresh token the server rotated to",
      );

      const next = spawnBridge();
      assert.ok(
        (await next.call("initialize", 1, INIT_PARAMS)).result,
        "the next bridge must serve from the preserved rotation",
      );
      assert.equal(
        fake.state.counts.stale_refresh,
        0,
        "no bridge may present the retired refresh token",
      );
    });
  });
}

test("a registration the server has forgotten is dropped, so the next login can land", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    // The server has expired the dynamic registration along with the grant.
    await fake.control({
      forget_clients: true,
      refreshStatus: 400,
      refreshError: "invalid_client",
      revoke_access: true,
    });
    ageRefusal(dir); // the refusal has stood; the login is due

    // Keeping the dead client_id would publish an authorize URL that the server
    // refuses — a login the human cannot complete however often they click.
    const second = spawnBridge();
    await authorize(second, dir, 5);
    assert.equal(
      fake.state.counts.register,
      2,
      "the forgotten registration must be replaced, not reused",
    );
  });
});

// --- never answer the harness with silence ---------------------------------

test("an answer bigger than a pipe buffer survives the harness going away", async (t) => {
  // Writing to a pipe is asynchronous and process.exit does not wait, so an
  // answer still in the buffer dies with the process — and it is the big
  // answers, a whole realm read, that get cut. A truncated line is silence
  // wearing an answer's clothes.
  await withFake(t, { padBytes: 200_000 }, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);

    bridge.proc.stdout.pause(); // the harness is busy: the pipe fills and stays full
    const answer = new Promise((res, rej) => {
      let out = "";
      bridge.proc.stdout.on("data", (c) => {
        out += c;
        const nl = out.indexOf("\n");
        if (nl >= 0) res(out.slice(0, nl));
      });
      // A lost answer must fail this test, never hang it: the whole point is
      // that the harness is left waiting for something that will never come.
      setTimeout(
        () => rej(new Error(`no whole line ever arrived — ${out.length} bytes of it did`)),
        8000,
      ).unref();
    });
    bridge.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "big" } });
    await new Promise((r) => setTimeout(r, 400)); // the answer is written, and stuck in the pipe
    bridge.proc.kill("SIGTERM"); // the harness asks the bridge to go away

    bridge.proc.stdout.resume();
    const line = await answer;
    const parsed = JSON.parse(line); // a truncated line does not parse — that is the defect
    assert.equal(parsed.id, 7);
    assert.equal(parsed.result.pad.length, 200_000, "the whole answer must reach the harness");
  });
});

// --- стояние переживает смену сессии -----------------------------------
// Слово держателя поверхности: писателя платформа узнаёт ПО ИДЕНТИФИКАТОРУ
// СЕССИИ MCP. Новая сессия — другой писатель, и собственная само-починка
// поверхности там бессильна: её память ключуется тем же id и собирается вместе
// с ним. Сессии умирают молча (простой, вытеснение по потолку, закрытие
// транспорта), и мост — единственный, кто видит смену и помнит выведенное имя.

test("стояние перерегистрируется само, когда сессия сменилась под делателем", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    assert.ok(
      (await bridge.call("initialize", 2, INIT_PARAMS)).result,
      "сессия должна существовать",
    );

    const reg = await bridge.call("tools/call", 5, {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", action: "register", karta: 931, name: "проба" },
    });
    assert.match(reg.result.content[0].text, /зарегистрировано/);

    await fake.control({ kill_session: true }); // простой, вытеснение, закрытие — снаружи не различить

    const send = await bridge.call("tools/call", 6, {
      name: "iskron_channel",
      arguments: { realm: "nks-dev", action: "send", karta: 931, standing: "проба", text: "слово" },
    });
    assert.equal(
      send.result.isError,
      undefined,
      `запись после смены сессии легла безавторной: ${JSON.stringify(send.result)}`,
    );
    assert.match(send.result.content[0].text, /принято стоянием проба/);
    assert.equal(fake.state.counts.unattributed, 0, "ни одна запись не должна лечь безавторной");
    assert.equal(
      fake.state.counts.register_standing,
      2,
      "мост обязан перерегистрировать стояние ровно один раз",
    );
    assert.equal(
      fake.state.counts.header_binds,
      0,
      "кириллическое имя заголовком не едет — оно остаётся на переигрывании",
    );
  });
});

// Четыре свидетельства из боя (nks-dev #3454, #3919; @nks/feedback #63) говорят,
// что перерегистрация на смену id держит не всегда. Ниже — дыры, названные
// чтением кода против узлов о сессии; каждая проба моделирует одну.

// Имя ASCII: заголовок автопривязки — байты, не текст, и кириллица в него не едет
// (проба выше утверждает header_binds === 0 на кириллическом имени).
const REG = { realm: "nks-dev", action: "register", karta: 931, name: "proba" };
const SEND = { realm: "nks-dev", action: "send", karta: 931, standing: "proba", text: "слово" };
async function standUp(bridge, dir) {
  await authorize(bridge, dir);
  assert.ok((await bridge.call("initialize", 2, INIT_PARAMS)).result, "сессия должна существовать");
  const reg = await bridge.call("tools/call", 3, { name: "iskron_channel", arguments: REG });
  assert.match(reg.result.content[0].text, /зарегистрировано/);
}

test("параллельные вызовы после смены сессии — все несут автора, register переигран один раз", async (t) => {
  // Доставки моста не сериализованы, а харнесс шлёт вызовы пачками. Переигрывание,
  // защищённое флагом, пропускает второй параллельный вызов мимо себя — безавторным.
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await standUp(bridge, dir);
    await fake.control({ kill_session: true });

    const [a, b] = await Promise.all([
      bridge.call("tools/call", 6, { name: "iskron_channel", arguments: SEND }),
      bridge.call("tools/call", 7, {
        name: "iskron_channel",
        arguments: { ...SEND, text: "второе" },
      }),
    ]);
    for (const r of [a, b]) {
      assert.equal(
        r.result.isError,
        undefined,
        `параллельная запись легла безавторной: ${JSON.stringify(r.result)}`,
      );
    }
    assert.equal(fake.state.counts.unattributed, 0, "ни одна запись не должна лечь безавторной");
    assert.equal(
      fake.state.counts.register_standing,
      2,
      "переигрывание одно на всех параллельных, не по одному на вызов",
    );
  });
});

test("смена токена закрыла сессию, сервер молча открыл новую — запись следом всё равно несёт автора", async (t) => {
  // Сессия открыта credential'ом и умирает с ним (#188). Мост после 401 обновляет
  // токен и повторяет вызов со СТАРЫМ id; сервер, открывающий на него новую сессию
  // молча, исполняет вызов безавторным и лишь в ответе сообщает новый id.
  // Первый случай #3919 совпал ровно с отказом обновления токена.
  await withFake(
    t,
    { sessionFollowsToken: true, silentNewSession: true },
    async ({ fake, dir, spawnBridge }) => {
      const bridge = spawnBridge();
      await standUp(bridge, dir);
      await fake.control({ rotate_access: true }); // сосед провернул грант: наш bearer мёртв, сессия с ним

      const send = await bridge.call("tools/call", 6, { name: "iskron_channel", arguments: SEND });
      assert.equal(
        send.result?.isError,
        undefined,
        `запись после смены токена: ${JSON.stringify(send)}`,
      );
      assert.match(send.result.content[0].text, /принято стоянием proba/);
      assert.equal(fake.state.counts.unattributed, 0, "ни одна запись не должна лечь безавторной");
    },
  );
});

test("проходящий отказ переигрывания не стирает память о стоянии", async (t) => {
  // Сегодня любой отказ переигранного register забывает стояние насовсем, и дальше
  // мост пишет безавторно, сказав об этом только в stderr. Два отказа подряд
  // достают и вторую попытку починки по пометке: одна проходящая не есть час.
  // Поверхность без автопривязки: заголовок пропускается, держит только переигрывание.
  await withFake(t, { ignoreStandingHeader: true }, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await standUp(bridge, dir);
    await fake.control({ kill_session: true, standingRefuseNext: 2 }); // первое переигрывание и первая попытка починки по пометке — обе отказаны

    const first = await bridge.call("tools/call", 6, { name: "iskron_channel", arguments: SEND });
    const second = await bridge.call("tools/call", 7, {
      name: "iskron_channel",
      arguments: { ...SEND, text: "второе" },
    });
    assert.equal(
      second.result?.isError,
      undefined,
      `после проходящего отказа стояние забыто: ${JSON.stringify(second.result)}`,
    );
    assert.match(second.result.content[0].text, /принято стоянием proba/);
    assert.equal(
      first.result?.isError,
      undefined,
      `первая же запись после отказа должна дойти с автором, а не вернуть 409: ${JSON.stringify(first.result)}`,
    );
  });
});

test("пересобранная сессия открывается уже привязанной — заголовком, не гонкой", async (t) => {
  // Поверхность несёт автопривязку при открытии сессии (nks-dev #3800): initialize с
  // заголовком X-NKS-Standing «граф карта имя» открывает сессию привязанной, и первый
  // tool-call не гонится с переигрыванием.
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await standUp(bridge, dir);
    await fake.control({ kill_session: true });

    const send = await bridge.call("tools/call", 6, { name: "iskron_channel", arguments: SEND });
    assert.equal(send.result?.isError, undefined, JSON.stringify(send.result));
    assert.equal(
      fake.state.counts.header_binds,
      1,
      "ре-инициализация обязана нести заголовок стояния",
    );
    assert.equal(fake.state.counts.unattributed, 0, "ни одна запись не должна лечь безавторной");
    // Рукопожатие не говорит, принят ли заголовок, — register переигрывается и при нём:
    // один идемпотентный вызов на смену сессии покупает автора на обеих поверхностях.
    assert.equal(fake.state.counts.register_standing, 2, "переигрывание не отменяется заголовком");
  });
});

test("платформа потеряла привязку при живой сессии — мост чинит по пометке и повторяет слово", async (t) => {
  // Случаи «без видимого знака» (#3919, #3772): id сессии не менялся, а запись ушла
  // безавторной. Единственный знак — пометка в самом ответе; мост, который её читает,
  // перерегистрируется тут же и не отдаёт харнессу 409 там, где повтор безопасен.
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await standUp(bridge, dir);
    await fake.control({ drop_standings: true });

    const send = await bridge.call("tools/call", 6, { name: "iskron_channel", arguments: SEND });
    assert.equal(
      send.result?.isError,
      undefined,
      `слово отбито 409 вместо починки: ${JSON.stringify(send.result)}`,
    );
    assert.match(send.result.content[0].text, /принято стоянием proba/);
    assert.equal(
      fake.state.counts.register_standing,
      2,
      "мост обязан перерегистрировать стояние по пометке",
    );

    // Пишущая фабрика не отказывает, а метит: узел лёг безавторным, вернуть автора
    // нельзя — но следующая запись обязана уже нести его.
    await fake.control({ drop_standings: true });
    const write = await bridge.call("tools/call", 7, {
      name: "iskron_update",
      arguments: { realm: "nks-dev", node_id: 1, basis_version: 1 },
    });
    assert.match(write.result.content[0].text, /write_unattributed/);
    const next = await bridge.call("tools/call", 8, {
      name: "iskron_update",
      arguments: { realm: "nks-dev", node_id: 1, basis_version: 2 },
    });
    assert.match(
      next.result.content[0].text,
      /автор: proba/,
      `пометка не прочитана, следующая запись снова безавторна: ${JSON.stringify(next.result)}`,
    );
  });
});

test("a lost upstream session is re-established transparently", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    assert.ok((await bridge.call("initialize", 2, INIT_PARAMS)).result);
    await fake.control({ kill_session: true });

    const answer = await bridge.call("tools/list", 3);
    assert.ok(
      answer.result,
      `the bridge should have re-initialized and retried: ${JSON.stringify(answer.error)}`,
    );
    // Список сервера едет как есть, плюс тул самого моста в хвосте.
    assert.deepEqual(
      answer.result.tools.map((t) => t.name),
      ["nks_orient", "iskron_stand"],
    );
  });
});

test("an upstream fault comes back as an error for that id, and the bridge stays up", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    await fake.control({ mcpStatus: 500 });
    const failed = await bridge.call("tools/list", 2);
    assert.equal(failed.id, 2);
    assert.ok(failed.error, "an HTTP 500 upstream must not be swallowed");

    await fake.control({ mcpStatus: null });
    const served = await bridge.call("tools/list", 3);
    assert.ok(served.result, "the bridge must keep serving after an upstream fault");
  });
});

test("the error says whether the call may have taken effect, not just that it failed", async (t) => {
  // "Retry the call" over every failure is advice, and for half of them it is
  // wrong advice: a request that went out and lost its answer may already have
  // applied, so retrying writes twice — silently, where no version guard exists.
  // Witnessed in the field: an update reported as failed had landed, and only a
  // version conflict on the advised retry gave it away.
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);

    await fake.control({ mcpStatus: 500 }); // the server fell over — it may have fallen AFTER applying
    const unknown = await bridge.call("tools/list", 2);
    assert.match(
      unknown.error.message,
      /OUTCOME IS UNKNOWN/,
      "a lost answer must not be reported as a clean failure",
    );
    assert.match(
      unknown.error.message,
      /re-read the target/,
      "the caller must be told what to do before retrying",
    );

    await fake.control({ mcpStatus: 400 }); // the server judged the request and refused it
    const refused = await bridge.call("tools/list", 3);
    assert.match(
      refused.error.message,
      /never reached the server|nothing was applied/,
      "a refused request is safe to retry, and saying so is the other half of the verdict",
    );
    assert.ok(
      !/OUTCOME IS UNKNOWN/.test(refused.error.message),
      "a request that was refused outright must not be dressed as an unknown outcome",
    );

    await fake.control({ mcpStatus: null });
    assert.ok((await bridge.call("tools/list", 4)).result, "the bridge must keep serving");
  });
});

test("a grant blind until its own hour offers the login beside it — never a bare wait", async (t) => {
  // The token endpoint may hold a refresh token back until the access token is
  // nearly spent: in that window the grant is whole and the bridge blind — in
  // the field, twenty-five minutes at a stretch. A wait that long is neither
  // the bridge's to sit out nor the human's to be told (graph @nks/nks-dev,
  // node #4794): the call carries the login, and says the grant is intact.
  await withFake(t, { refreshNotBeforeMs: 60_000 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    const grant = s.tokens.refresh_token;
    await fake.control({ revoke_access: true });

    const held = spawnBridge();
    const answer = await held.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error?.message);
    assert.ok(url, `the call must carry the login: ${JSON.stringify(answer)}`);
    assert.match(answer.error.message, /whole/, "and say the grant itself is intact");
    assert.doesNotMatch(
      answer.error.message,
      /clears itself by waiting|wait out|retry the call now|not knocking again/,
      "no rung of the old ladder survives: nothing tells the caller to wait",
    );
    assert.equal(fake.state.counts.refresh, 1, "one knock, then the login");
    assert.equal(readStore(dir).tokens.refresh_token, grant, "the grant is kept");
  });
});

test("a notification is never answered", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    let spoke = false;
    bridge.proc.stdout.on("data", () => {
      spoke = true;
    });
    bridge.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(spoke, false, "a message with no id must get no answer");
  });
});

// --- one busy port must not make login impossible --------------------------
// The derived callback port sits in the OS's ephemeral range on Linux, so any
// outbound socket on the machine can happen to hold it — witnessed on a shared
// CI runner, where a squatted port turned every login into "free it, then
// retry". The bridge climbs a short ladder of derived rungs instead.

test("a foreign squatter on the callback port does not make login impossible", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    // Exactly the first rung the bridge will try, occupied by something that
    // is not a bridge and never answers.
    const d = createHash("sha256").update(new URL(fake.mcpUrl).origin).digest();
    const squatted = 42000 + ((d[0] * 256 + d[1]) % 2000);
    const squatter = createServer(() => {});
    await new Promise((r) => squatter.listen(squatted, "127.0.0.1", r));
    try {
      const bridge = spawnBridge();
      const url = await authorize(bridge, dir);
      assert.notEqual(
        callbackPortOf(url),
        squatted,
        "the bridge must have stepped off the held port",
      );
      assert.ok((await bridge.call("tools/list", 2)).result, "and the login must serve as usual");
    } finally {
      await new Promise((r) => squatter.close(r));
    }
  });
});

// --- a field report must date itself ---------------------------------------
// A customer quotes the error verbatim and nothing else. Without the build in
// the quote, dating the code that produced it is forensics on wording.

test("the bridge names the plugin's version — one delivery, one number", async () => {
  // The version in the build string is the PLUGIN version, stamped by
  // release-please: quoting it dates the whole installed snapshot, skills
  // included. This invariant is what makes that reading trustworthy.
  const plugin = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", ".claude-plugin", "plugin.json"),
      "utf8",
    ),
  );
  const out = await new Promise((res, rej) => {
    const p = spawn(NODE, [BRIDGE, "--version"]);
    let o = "";
    p.stdout.on("data", (c) => (o += c));
    p.on("exit", () => res(o.trim()));
    p.on("error", rej);
  });
  assert.match(
    out,
    new RegExp(`^v${plugin.version.replaceAll(".", "\\.")}\\+[0-9a-f]{8}$`),
    `--version must name the delivery (plugin v${plugin.version}), got: ${out}`,
  );
});

test("every surface a field report quotes names the exact build", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    const pending = await bridge.call("initialize", 1, INIT_PARAMS);
    assert.match(
      pending.error.message,
      /iskron-bridge v\d+\.\d+\.\d+\+[0-9a-f]{8}:/,
      "a synthetic error must carry the build that produced it",
    );
    const url = authorizeUrlIn(pending.error.message);
    const res = await fetch(url, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await grantLanded(dir);
    assert.match(
      readFileSync(join(dir, "grant.log"), "utf8"),
      /v\d+\.\d+\.\d+\+[0-9a-f]{8}/,
      "the grant log must carry the build too",
    );
  });
});

// --- the clock a customer's machine keeps is allowed to lie ----------------
// Witnessed: a clock ~28 minutes behind the server made every rotation decay
// into a stretch where the access token looked fresh locally and was spent
// upstream. The hours are the server's; the bridge must read them by the
// server's clock, learned from the Date header every answer already carries.

test("a machine whose clock lies is judged by the server's clock, not its own", async (t) => {
  await withFake(t, { clockSkewMs: 600_000 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    const skew = readStore(dir).clock_skew_ms;
    assert.ok(
      skew > 500_000,
      `the measured skew must be persisted for the next process, got ${skew}`,
    );
    assert.match(
      readFileSync(join(dir, "grant.log"), "utf8"),
      /machine clock is/,
      "a lying clock must be named in the grant log — it is the diagnosis",
    );

    // By the server's clock this token died ten seconds ago; by the machine's
    // it has most of ten minutes left. The keepalive must renew it without
    // waiting for a call to buy a 401 first.
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() + 590_000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ revoke_access: true });
    const refreshed = fake.state.counts.refresh;

    const second = spawnBridge();
    await waitFor(
      () => fake.state.counts.refresh > refreshed,
      "the keepalive to renew a token the server already counts as spent",
      5000,
    );
    assert.ok(
      (await second.call("initialize", 1, INIT_PARAMS)).result,
      "and the renewed grant must serve",
    );
  });
});

// --- a NotFound from an endpoint that did not move is the server's verdict --
// Rauthy answers a client it no longer knows with 404 NotFound "No results
// found" — the status of a path that is not there. Read as a moved endpoint,
// that 404 was rediscovered and walked into again on every call, forever
// (graph @nks/nks-dev, node #4540). Discovery still naming the endpoint is
// what settles it: nothing moved, the registration is gone, one new login.

test("a NotFound from a token endpoint discovery still names drops the registration, not the discovery", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const counts = { ...fake.state.counts };
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({
      refreshStatus: 404,
      refreshError: "NotFound",
      refreshMessage: "No results found",
      revoke_access: true,
    });

    // A handshake is not paced, so the verdict and the new login come in one answer.
    const second = spawnBridge();
    const answer = await second.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error?.message);
    assert.ok(url, `the human must be offered a new login: ${JSON.stringify(answer)}`);
    assert.doesNotMatch(
      answer.error.message,
      /rediscovering on the next attempt/,
      `an endpoint discovery still names did not move: ${answer.error.message}`,
    );
    assert.ok(readStore(dir).meta, "the discovery, confirmed unchanged, must be kept");
    await mintedFrom(url); // the registration is made as the link is opened
    assert.equal(
      fake.state.counts.register,
      counts.register + 1,
      "the registration the server no longer knows must be dropped — the new login runs on a fresh one",
    );
    assert.equal(
      fake.state.counts.authorize,
      counts.authorize,
      "the verdict itself must not visit a browser flow",
    );
    const res = await fetch(url, { redirect: "follow" });
    assert.equal(res.status, 200, "the new login must complete on the fresh registration");
    await res.text();
    await grantLanded(dir);
  });
});

// --- a registration the server has already forgotten -----------------------
// Rauthy deletes a dynamic client that made no login within its cleanup
// horizon, and the bridge kept its client_id for ever (graph @nks/nks-dev,
// node #4539). A browser flow reuses a registration only while it is young.

test("a browser flow renews a registration older than the reuse horizon", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    const url1 = authorizeUrlIn((await first.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url1);
    const signIn1 = await mintedFrom(url1); // the registration is made as the link is opened
    await first.stop();
    assert.equal(fake.state.counts.register, 1);

    const s = readStore(dir);
    assert.ok(s.client?.client_id, "the registration must be on disk");
    s.client.registered_at = Date.now() - 2 * 3_600_000; // older than any cleanup horizon
    writeFileSync(storeFile(dir), JSON.stringify(s));
    fake.state.clients.delete(s.client.client_id); // the server has cleaned it up

    const second = spawnBridge();
    const url2 = authorizeUrlIn((await second.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.equal(url2, url1, "the same login, taken over — its link stays good");
    const signIn2 = await mintedFrom(url2);
    assert.equal(
      fake.state.counts.register,
      2,
      "a registration older than the reuse horizon must be made anew",
    );
    assert.notEqual(
      new URL(signIn2).searchParams.get("client_id"),
      new URL(signIn1).searchParams.get("client_id"),
      "the sign-in page must carry the new client_id",
    );
    const res = await fetch(url2, { redirect: "follow" });
    assert.equal(res.status, 200, "the login must complete on the renewed registration");
    await res.text();
    await grantLanded(dir);
  });
});

test("a token endpoint that moved is rediscovered, not mourned forever", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    await fake.control({ tokenPath: "/token-v2", revoke_access: true });
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));

    // One attempt is allowed to walk into the cached 404 — dropping the stale
    // discovery is what it buys. The call itself must still be served: by the
    // time it needs tokens, the endpoint has been found where it lives now.
    const second = spawnBridge();
    const served = await second
      .call("initialize", 1, INIT_PARAMS)
      .then((a) => (a.result ? a : second.call("initialize", 2, INIT_PARAMS)));
    assert.ok(
      served.result,
      `the bridge must rediscover the moved endpoint and serve: ${JSON.stringify(served.error)}`,
    );
    assert.equal(fake.state.counts.authorize, 1, "a moved endpoint must never cost a login");
  });
});

// --- a grant past its own hour owes the human a login NOW ------------------
// The grace exists for refusals that might be a server mid-restart. A refresh
// token past its own exp is not that: the keepalive never knocks on it, so the
// grace starts cold at the human's first call and is two minutes of pure outage.

test("a grant past its own expiry asks for the login at once, not after a grace", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    s.tokens.refresh_expires_at = Date.now() - 1000; // the grant's own hour has passed
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const second = spawnBridge();
    // Our own client's handshake is paced, so only the grant's own hour lets it through at once.
    const answer = await second.call("initialize", 1, OWN_INIT_PARAMS);
    const url = authorizeUrlIn(answer.error?.message);
    assert.ok(
      url,
      `an expired grant is proof enough — the login must be offered now: ${JSON.stringify(answer)}`,
    );
    assert.equal(await portListening(callbackPortOf(url)), true);
  });
});

// --- a second 401 is a config defect, not an expiry ------------------------

test("a fresh token refused twice is reported as a config defect, not an expiry", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    await fake.control({ mcpStatus: 401 });
    const answer = await bridge.call("tools/list", 2);
    assert.ok(answer.error, "nothing can serve while the server refuses every token");
    assert.match(
      answer.error.message,
      /audience|ISKRON_BRIDGE_RESOURCE/,
      "the second refusal must point at the audience — the one thing a retry cannot fix",
    );
  });
});

// --- the audience the token is issued for --------------------------------
// The resource indicator decides the token's `aud`, and a server may validate
// a form its own discovery does not print. So the override has to be usable at
// the moment the operator reaches for it — which is AFTER a flow already ran
// and produced the wrong audience, i.e. against a store that already caches
// what discovery said.

test("the resource override reaches every leg of a fresh authorization", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const forced = "https://forced.example/mcp/";
    const bridge = spawnBridge({ ISKRON_BRIDGE_RESOURCE: forced });
    await authorize(bridge, dir);
    assert.equal(
      fake.state.resources.authorize,
      forced,
      "the authorize leg asked for another audience",
    );
    assert.equal(
      fake.state.resources.code_exchange,
      forced,
      "the code exchange asked for another audience",
    );
  });
});

test("the override still applies once discovery is cached — the defect it exists for", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    // First flow with no override: the store now caches what discovery said.
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    assert.equal(
      fake.state.resources.code_exchange,
      fake.mcpUrl,
      "precondition: discovery's value was used",
    );

    // Exactly the operator's move: the audience was wrong, so set the override
    // and retry. Nothing clears the store first — nobody would think to.
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    const forced = "https://forced.example/mcp/";
    const second = spawnBridge({ ISKRON_BRIDGE_RESOURCE: forced });
    assert.ok(
      (await second.call("initialize", 1, INIT_PARAMS)).result,
      "the refreshed call should have been served",
    );
    assert.equal(
      fake.state.resources.refresh,
      forced,
      "the override was ignored because discovery had already been cached in the store",
    );
  });
});

// --- the second entrance: a personal access token ----------------------------
// A PAT is the whole grant: no discovery, no browser, nothing to refresh. The
// bridge presents it and nothing else, and a refusal is final — a human with a
// new token is the only repair, so the verdict must say so, never "retry" or
// "open this URL".

test("a personal access token serves the call with no discovery, no browser and no store", async (t) => {
  await withFake(t, { pat: "nks_pat_probe" }, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge({ ISKRON_BRIDGE_TOKEN: "nks_pat_probe" });
    const init = await bridge.call("initialize", 1, INIT_PARAMS);
    assert.ok(
      init.result,
      `the token should have opened the session: ${JSON.stringify(init.error)}`,
    );
    const list = await bridge.call("tools/list", 2);
    assert.ok(Array.isArray(list.result?.tools), "tools/list must be served under the token");
    assert.equal(fake.state.counts.register, 0, "no client registration may happen");
    assert.equal(fake.state.counts.authorize, 0, "no browser flow may be started");
    assert.equal(
      readdirSync(dir).filter((f) => f.endsWith(".json")).length,
      0,
      "a token given from outside must not be copied into the grant store",
    );
    assert.match(bridge.stderr, /personal access token from ISKRON_BRIDGE_TOKEN/);
  });
});

test("the token file next to the grant is read when the variable is absent", async (t) => {
  await withFake(t, { pat: "nks_pat_file" }, async ({ dir, spawnBridge }) => {
    writeFileSync(join(dir, "token"), "nks_pat_file\n");
    const bridge = spawnBridge();
    const init = await bridge.call("initialize", 1, INIT_PARAMS);
    assert.ok(
      init.result,
      `the token file should have opened the session: ${JSON.stringify(init.error)}`,
    );
    assert.match(bridge.stderr, new RegExp(`personal access token from ${join(dir, "token")}`));
  });
});

test("a refused personal token is reported as dead — no URL, no wait, no retry", async (t) => {
  await withFake(t, { pat: "nks_pat_good" }, async ({ fake, spawnBridge }) => {
    const bridge = spawnBridge({ ISKRON_BRIDGE_TOKEN: "nks_pat_stale" });
    const answer = await bridge.call("initialize", 1, INIT_PARAMS);
    assert.ok(answer.error, "a refused token cannot serve the call");
    assert.match(answer.error.message, /personal access token from ISKRON_BRIDGE_TOKEN/);
    assert.match(answer.error.message, /only a human with a new token/);
    assert.equal(authorizeUrlIn(answer.error.message), null, "no browser URL may be offered");
    assert.doesNotMatch(answer.error.message, /retry freely|clears itself by waiting/);
    assert.equal(fake.state.counts.authorize, 0);
  });
});

// --- a client that does not wait for initialize -----------------------------
// Real MCP clients wait for the initialize answer; a script piping three lines
// at once does not. The server refuses anything outside the handshake without
// a session id, so the bridge waits on behalf of the client that would not.

test("a pipelining client that does not wait for initialize is still served, in order", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    await bridge.stop();
    const b2 = spawnBridge();
    // Three lines, no waiting in between — exactly what a shell pipe does.
    const answers = Promise.all([
      b2.call("initialize", 1, INIT_PARAMS),
      (b2.send({ jsonrpc: "2.0", method: "notifications/initialized" }), b2.call("tools/list", 2)),
    ]);
    const [initReply, list] = await answers;
    assert.ok(initReply.result, `initialize must succeed: ${JSON.stringify(initReply.error)}`);
    assert.ok(
      Array.isArray(list.result?.tools),
      `tools/list must be served after the handshake, not refused: ${JSON.stringify(list.error)}`,
    );
  });
});

// --- a network that blinks ----------------------------------------------------
// The bridge used to hand every network failure straight to the agent, and the
// failure said only «fetch failed» (graph @nks/nks-dev, node #4664). A front
// door on a port of its own stands between the bridge and the fake and plays
// the network: shut (nothing listens — refused, the call never left), open
// (bytes forwarded), reset (the request is read and the socket torn down — the
// call left and its answer is lost).

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function frontDoor(targetUrl) {
  const target = new URL(targetUrl);
  const port = await freePort();
  const socks = new Set();
  const track = (s) => {
    socks.add(s);
    s.on("close", () => socks.delete(s));
    s.on("error", () => {});
  };
  let server = null;
  let mode = "shut";
  const door = {
    url: `http://127.0.0.1:${port}${target.pathname}`,
    requests: 0,
    async set(next) {
      mode = next;
      await door.close();
      if (mode === "shut") return;
      server = createServer((c) => {
        track(c);
        if (mode === "reset") {
          c.once("data", () => {
            door.requests++;
            c.destroy();
          });
          return;
        }
        const up = connect(Number(target.port), target.hostname);
        track(up);
        up.on("error", () => c.destroy());
        c.on("error", () => up.destroy());
        c.pipe(up).pipe(c);
      });
      await new Promise((r) => server.listen(port, "127.0.0.1", r));
    },
    close() {
      for (const s of socks) s.destroy();
      socks.clear();
      const srv = server;
      server = null;
      return srv ? new Promise((r) => srv.close(() => r())) : Promise.resolve();
    },
  };
  return door;
}

test("an unreachable server is named by its cause, not by a bare «fetch failed»", async () => {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "iskron-bridge-test-"));
  const bridge = startBridge(`http://127.0.0.1:${port}/mcp`, dir, {
    ISKRON_BRIDGE_NET_BACKOFF_MS: "20,20,20",
  });
  try {
    const answer = await bridge.call("initialize", 1, INIT_PARAMS);
    assert.ok(answer.error, "nobody listens — the handshake must still be answered");
    assert.match(
      answer.error.message,
      /ECONNREFUSED|ConnectionRefused/,
      `the cause must ride the text: ${answer.error.message}`,
    );
    assert.match(
      answer.error.message,
      /never reached the server/,
      "a refused connection applied nothing, on every runtime",
    );
  } finally {
    await bridge.stop();
  }
});

test("a server gone for a moment is knocked again by the bridge, and the call is served", async (t) => {
  await withFake(t, { pat: "nks_pat_probe" }, async ({ fake, dir }) => {
    const door = await frontDoor(fake.mcpUrl);
    const bridge = startBridge(door.url, dir, {
      ISKRON_BRIDGE_TOKEN: "nks_pat_probe",
      ISKRON_BRIDGE_NET_BACKOFF_MS: "300,600,1200",
    });
    try {
      const init = bridge.call("initialize", 1, INIT_PARAMS);
      await pause(150);
      await door.set("open");
      const got = await init;
      assert.ok(
        got.result,
        `a refused handshake must be knocked again, not handed back: ${JSON.stringify(got.error)}`,
      );
      bridge.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await door.set("shut");
      const list = bridge.call("tools/list", 2);
      await pause(150);
      await door.set("open");
      const served = await list;
      assert.ok(
        Array.isArray(served.result?.tools),
        `a read over a blinking network must be served: ${JSON.stringify(served.error)}`,
      );
    } finally {
      await bridge.stop();
      await door.close();
    }
  });
});

test("an answer lost on the wire: a read is asked again, a write goes out once", async (t) => {
  await withFake(t, { pat: "nks_pat_probe" }, async ({ fake, dir }) => {
    const door = await frontDoor(fake.mcpUrl);
    await door.set("open");
    const bridge = startBridge(door.url, dir, {
      ISKRON_BRIDGE_TOKEN: "nks_pat_probe",
      ISKRON_BRIDGE_NET_BACKOFF_MS: "300,600,1200",
    });
    try {
      assert.ok((await bridge.call("initialize", 1, INIT_PARAMS)).result);
      bridge.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      await pause(200); // the notification lands on the open door, not on the one below
      await door.set("reset");
      door.requests = 0;
      const write = await bridge.call("tools/call", 2, {
        name: "iskron_add_phenomenon",
        arguments: { name: "probe" },
      });
      assert.match(
        write.error?.message ?? "",
        /OUTCOME IS UNKNOWN/,
        "a write whose answer was lost must not be sent a second time",
      );
      assert.equal(door.requests, 1, "the write went out once and only once");
      const read = bridge.call("tools/call", 3, { name: "iskron_orient", arguments: {} });
      await pause(150);
      await door.set("open");
      const got = await read;
      assert.ok(
        !/upstream (unreachable|stream broke)/.test(JSON.stringify(got)),
        `a read whose answer was lost is safe to ask again: ${JSON.stringify(got)}`,
      );
    } finally {
      await bridge.stop();
      await door.close();
    }
  });
});

test("a handshake with the network down is answered from the last server answer, and calls go through once it returns", async (t) => {
  await withFake(t, { pat: "nks_pat_probe" }, async ({ fake, dir }) => {
    const door = await frontDoor(fake.mcpUrl);
    await door.set("open");
    const env = { ISKRON_BRIDGE_TOKEN: "nks_pat_probe", ISKRON_BRIDGE_NET_BACKOFF_MS: "20,20,20" };
    const first = startBridge(door.url, dir, env);
    try {
      assert.ok((await first.call("initialize", 1, INIT_PARAMS)).result);
      first.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      assert.ok(Array.isArray((await first.call("tools/list", 2)).result?.tools));
    } finally {
      await first.stop();
    }
    await door.set("shut");
    const second = startBridge(door.url, dir, env);
    try {
      const init = await second.call("initialize", 1, INIT_PARAMS);
      assert.ok(
        init.result?.protocolVersion,
        `no network at the start must not fail the handshake: ${JSON.stringify(init.error)}`,
      );
      second.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const list = await second.call("tools/list", 2);
      assert.ok(
        toolNames(list.result?.tools).length > 0,
        `the last list must stand in for the server: ${JSON.stringify(list.error)}`,
      );
      const offline = await second.call("tools/call", 3, { name: "iskron_orient", arguments: {} });
      assert.match(
        offline.error?.message ?? "",
        /never reached the server/,
        "a call before the network returns is an honest «not sent»",
      );
      await door.set("open");
      const online = await second.call("tools/call", 4, { name: "iskron_orient", arguments: {} });
      assert.ok(
        !/upstream unreachable/.test(JSON.stringify(online)),
        `once the network returns the call goes through: ${JSON.stringify(online)}`,
      );
    } finally {
      await second.stop();
      await door.close();
    }
  });
});

// Claude Code shows a stdio server's refused handshake as a bare code and drops
// its text, and a stdio entry has no login button at all: a handshake refused
// over a dead grant hides the login from the human and the agent alike, and
// the server is left marked failed, with no tools to say it through (graph
// @nks/nks-dev, node #4790). So the handshake stands on the last server answer,
// the login is published at once — a handshake is a human at the keyboard —
// and the first call carries the link to them.
test("a handshake over a dead grant stands on the last server answer, publishes the login at once, and the first call carries it", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    assert.ok((await first.call("initialize", 2, INIT_PARAMS)).result);
    first.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const known = toolNames((await first.call("tools/list", 3)).result?.tools);
    assert.ok(known.length > 0, "precondition: the server's list was seen once");
    await first.stop();

    const s = readStore(dir);
    const deadToken = s.tokens.access_token;
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const second = spawnBridge(); // what /mcp reconnect does
    const init = await second.call("initialize", 1, INIT_PARAMS);
    assert.ok(
      init.result?.protocolVersion,
      `a dead grant must not fail the handshake: ${JSON.stringify(init.error)}`,
    );
    second.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const list = await second.call("tools/list", 2);
    assert.deepEqual(
      toolNames(list.result?.tools),
      known,
      `the last list must stand in for the server: ${JSON.stringify(list.error)}`,
    );
    const published = JSON.parse(readFileSync(lockFile(dir), "utf8"));
    assert.equal(
      await portListening(published.callback_port),
      true,
      "the login must be published at the handshake, not held back for a grace",
    );

    const call = await second.call("tools/call", 3, { name: "nks_orient", arguments: {} });
    const url = authorizeUrlIn(call.error?.message);
    assert.equal(
      url,
      published.authorize_url,
      `the first call must carry the login: ${JSON.stringify(call)}`,
    );
    assert.doesNotMatch(
      call.error.message,
      /retry freely|server side needs attention|clears itself by waiting/,
      "a login waiting for a click is neither a retry nor a wait nor a server defect",
    );
    assert.match(call.error.message, /human/i, "the verdict must send the link to the human");

    const res = await fetch(url, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await waitFor(
      () => readStore(dir).tokens?.access_token !== deadToken,
      "the new grant to reach the store",
    );
    const after = await second.call("tools/call", 4, { name: "nks_orient", arguments: {} });
    assert.ok(
      after.result && !after.error,
      `after the click the call goes through without a second handshake: ${JSON.stringify(after)}`,
    );
  });
});

// Our own clients read a refused handshake themselves and wait out the login:
// the OpenCode plugin shows the human the link in its own window, make surface
// prints it and must not write a snapshot from a stale answer. Answering them
// from the last server answer would take that away (#4790), so theirs is refused.
test("our own clients' handshake over a dead grant is still refused with the link, so they can show it", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    assert.ok((await first.call("initialize", 2, INIT_PARAMS)).result);
    first.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    assert.ok(toolNames((await first.call("tools/list", 3)).result?.tools).length > 0);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });
    ageRefusal(dir);

    const plugin = spawnBridge();
    const init = await plugin.call("initialize", 1, OWN_INIT_PARAMS);
    assert.ok(
      init.error,
      `our own client must see the refusal, not the last answer: ${JSON.stringify(init.result)}`,
    );
    assert.match(
      init.error.message,
      /authorization required/,
      "the plugin knows a login in progress by these words",
    );
    assert.ok(authorizeUrlIn(init.error.message), "the refusal must carry the link it shows");

    // make surface is ours too: a snapshot written from a stale answer would pass for the live one.
    // The name mirrors SURFACE_CLIENT in js/shared/clients.ts.
    const surface = spawnBridge();
    const exported = await surface.call("initialize", 1, {
      ...INIT_PARAMS,
      clientInfo: { name: "export-surface", version: "0" },
    });
    assert.ok(
      authorizeUrlIn(exported.error?.message),
      `the surface export must see the login, not the last answer: ${JSON.stringify(exported)}`,
    );
  });
});

test("our own client's handshake keeps the audience diagnosis rather than the last answer", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    assert.ok(
      (await first.call("initialize", 2, INIT_PARAMS)).result,
      "precondition: an answer to keep",
    );
    await first.stop();

    await fake.control({ mcpStatus: 401 }); // every token refused, a fresh one included
    const plugin = spawnBridge();
    const answer = await plugin.call("initialize", 1, OWN_INIT_PARAMS);
    assert.ok(
      answer.error,
      `the last answer hid a server that refuses every token: ${JSON.stringify(answer)}`,
    );
    assert.match(
      answer.error.message,
      /audience|ISKRON_BRIDGE_RESOURCE/,
      "the second refusal must still point at the audience",
    );
  });
});

// --- one login, one tab, alive to the end (graph @nks/nks-dev, node #4794) ---
// Many windows are a nuisance and none is a dead end: a login gets exactly one
// tab, and that tab stays good whichever bridge happens to be alive when the
// human clicks it.

// A dead grant with an old registration: the login gets a registration young
// enough to outlive it, so its link is not declared dead under the human
// minutes later — a second login, a second tab.
test("a login published over an old registration keeps its link — no second login minutes later", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    s.client.registered_at = Date.now() - 40 * 60_000; // still reusable, for five more minutes
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const a = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50" });
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const standing = loginState(dir);

    const later = readStore(dir); // six minutes on
    later.client.registered_at -= 6 * 60_000;
    writeFileSync(storeFile(dir), JSON.stringify(later));
    const b = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50" });
    const again = authorizeUrlIn((await b.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.equal(again, url, "the standing login must be joined, not replaced");
    assert.equal(loginState(dir), standing, "and it is the same login, not a new one on that link");
  });
});

// A refresh refused as invalid_client drops the registration it presented. It
// must present the grant's own client, and drop only that one — never the
// registration a login was just published on, which would make the next call
// publish a second login, and the one after a third.
test("a refusal that drops a client does not make the bridge publish a second login", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_client", revoke_access: true });

    const a = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50" });
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const standing = loginState(dir);
    const second = await a.call("tools/call", 2, { name: "nks_orient", arguments: {} });
    assert.equal(authorizeUrlIn(second.error?.message), url, "the next call joins the same login");

    // Five minutes on the machine knocks the grant again — and hears the same refusal.
    const gsPath = storeFile(dir) + ".grant-state";
    const gs = JSON.parse(readFileSync(gsPath, "utf8"));
    gs.refused_at = Date.now() - 6 * 60_000;
    writeFileSync(gsPath, JSON.stringify(gs));
    const third = await a.call("tools/call", 3, { name: "nks_orient", arguments: {} });
    assert.equal(
      authorizeUrlIn(third.error?.message),
      url,
      "a later knock must not unseat the login",
    );
    assert.equal(loginState(dir), standing, "the same login, not a new one on the same link");
  });
});

test("while a login is out, a grant already judged dead is not knocked on every call", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const a = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50,50" });
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const knocks = fake.state.counts.refresh;
    for (const id of [2, 3, 4]) {
      const answer = await a.call("tools/call", id, { name: "nks_orient", arguments: {} });
      assert.equal(authorizeUrlIn(answer.error?.message), url);
    }
    assert.equal(
      fake.state.counts.refresh,
      knocks,
      "one verdict per stretch, not one knock per call",
    );
  });
});

test("a login that closes clears only its own record, never a newer login's", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const a = spawnBridge();
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const lockPath = lockFile(dir);
    const newer = {
      ...JSON.parse(readFileSync(lockPath, "utf8")),
      pid: process.pid,
      state: "a-newer-login",
      authorize_url: "http://127.0.0.1:9/authorize?state=a-newer-login",
    };
    writeFileSync(lockPath, JSON.stringify(newer));
    const res = await fetch(url, { redirect: "follow" });
    await res.text();
    await grantLanded(dir);
    await pause(300);
    assert.deepEqual(
      JSON.parse(readFileSync(lockPath, "utf8")),
      newer,
      "the landed login erased another login's record",
    );
  });
});

test("a live port under a dead publisher is a stranger's — its link is not handed out", async (t) => {
  await withFake(t, {}, async ({ spawnBridge }) => {
    const a = spawnBridge();
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const port = callbackPortOf(url);
    await a.stop(); // SIGKILL: the record survives, the port frees
    const stranger = createServer(() => {});
    await new Promise((r) => stranger.listen(port, "127.0.0.1", r));
    try {
      const b = spawnBridge();
      const again = authorizeUrlIn((await b.call("initialize", 1, INIT_PARAMS)).error?.message);
      assert.ok(again, "a login must be offered");
      assert.notEqual(again, url, "a link a stranger listens on must not be handed out");
    } finally {
      stranger.close();
    }
  });
});

// The loopback port is open to every local user. The sign-in page carries the
// login's state, and a stranger holding it could slip the bridge a code for an
// account that is not the human's — so only the link itself, with its key, mints.
test("the login link opens only with its own key — the bare port mints nothing", async (t) => {
  await withFake(t, {}, async ({ spawnBridge }) => {
    const a = spawnBridge();
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const res = await fetch(`http://127.0.0.1:${callbackPortOf(url)}/login`, {
      redirect: "manual",
    });
    await res.text();
    assert.equal(
      res.headers.get("location"),
      null,
      "a link without the key must not be sent on to the sign-in page",
    );
    assert.ok(await mintedFrom(url), "the link itself does mint the sign-in page");
  });
});

// The link is the bridge's own address and mints the sign-in page as it is
// opened, so no registration ageing out under an unattended login makes a new
// login: the same one stands for as long as nobody clicks it (#4794). Declared
// dead every forty-five minutes, it used to pile logins, tabs and listeners up
// until the ports ran out and no link was left at all.
test("a login nobody opens for hours stays the one login — ageing registrations make no new ones", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    const s = readStore(dir);
    const dead = s.tokens.access_token;
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const a = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50" });
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const standing = loginState(dir);
    for (const id of [2, 3, 4]) {
      const aged = readStore(dir); // another forty-six minutes on
      if (aged.client?.registered_at) aged.client.registered_at -= 46 * 60_000;
      writeFileSync(storeFile(dir), JSON.stringify(aged));
      const answer = await a.call("tools/call", id, { name: "nks_orient", arguments: {} });
      assert.equal(authorizeUrlIn(answer.error?.message), url, "the same link, however late");
      assert.equal(loginState(dir), standing, "the same login — no new one beside it");
    }
    const res = await fetch(url, { redirect: "follow" }); // opened at last: minted now, and it lands
    await res.text();
    assert.equal(res.status, 200);
    await waitFor(() => readStore(dir).tokens?.access_token !== dead, "the new grant to land");
  });
});

// A grant written by an older bridge carries no client of its own; its refusal
// must not cost the login the machine has out a second login (#4809).
test("a grant with no client of its own, refused, does not unseat the login that is out", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    delete s.tokens.client_id; // written by a bridge that did not record it
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_client", revoke_access: true });

    const a = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50" });
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const standing = loginState(dir);
    await mintedFrom(url); // the human opened it: a registration is made for the login
    const gsPath = storeFile(dir) + ".grant-state";
    const gs = JSON.parse(readFileSync(gsPath, "utf8"));
    gs.refused_at = Date.now() - 6 * 60_000; // five minutes on, the grant is knocked again
    writeFileSync(gsPath, JSON.stringify(gs));
    const again = await a.call("tools/call", 2, { name: "nks_orient", arguments: {} });
    assert.equal(authorizeUrlIn(again.error?.message), url);
    assert.equal(loginState(dir), standing, "the refusal must not make a second login");
  });
});

test("a login that already landed is never taken over later — the next need publishes a new one", async (t) => {
  // A bridge killed between saving the tokens and dropping the login's record
  // leaves the record of a login that has landed. Taken over later, it would
  // hand the human a link and no tab — the one they had is long closed —
  // and it would skip the bridge's own second knock on a refused grant.
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    const url = authorizeUrlIn((await first.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const lockPath = lockFile(dir);
    const leftover = readFileSync(lockPath, "utf8");
    const res = await fetch(url, { redirect: "follow" });
    await res.text();
    await grantLanded(dir);
    await first.stop();
    writeFileSync(lockPath, leftover); // killed before the record was dropped

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const next = spawnBridge({ ISKRON_BRIDGE_DEAD_RECHECK_MS: "50,50" });
    const again = authorizeUrlIn((await next.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(again, "a login must be offered");
    assert.notEqual(
      loginState(dir),
      JSON.parse(leftover).state,
      "a login that landed is not handed out again",
    );
    assert.ok(fake.state.counts.refresh >= 2, "and its leftover does not skip the second knock");
  });
});

test("a login waiting longer than five and a half minutes is still joined, not published again", async (t) => {
  // The published login once carried a clock of its own — the old five-minute
  // flow timeout. The flow no longer times out, and a clock-dead lock sent the
  // next call to publish a second login, a second tab, while the first listened.
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const first = spawnBridge();
    const url = authorizeUrlIn((await first.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    const lock = lockFile(dir);
    const held = JSON.parse(readFileSync(lock, "utf8"));
    writeFileSync(lock, JSON.stringify({ ...held, started_at: Date.now() - 400_000 }));

    const other = spawnBridge();
    const again = authorizeUrlIn((await other.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.equal(again, url, "a later call must join the standing login");
  });
});

test("however many bridges need the login, the browser opens once", async (t) => {
  if (process.platform === "win32") return t.skip("the opener is PowerShell there");
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const root = mkdtempSync(join(tmpdir(), "iskron-opener-"));
    const record = join(root, "opened.txt");
    for (const name of ["open", "xdg-open"]) {
      writeFileSync(join(root, name), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${record}"\n`, {
        mode: 0o755,
      });
    }
    const env = { PATH: `${root}:${process.env.PATH}` };
    const opened = () => {
      try {
        return readFileSync(record, "utf8").trim().split("\n").filter(Boolean);
      } catch {
        return [];
      }
    };

    const a = spawnBridge(env, { browser: true });
    const url = authorizeUrlIn((await a.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.ok(url, "a login must be pending");
    await waitFor(() => opened().length === 1, "the first bridge to open the browser");
    await a.stop(); // killed under the login, as an ephemeral run is

    const b = spawnBridge(env, { browser: true });
    assert.equal(authorizeUrlIn((await b.call("initialize", 1, INIT_PARAMS)).error?.message), url);
    const c = spawnBridge(env, { browser: true });
    assert.equal(authorizeUrlIn((await c.call("initialize", 1, INIT_PARAMS)).error?.message), url);
    await pause(500);
    assert.deepEqual(opened(), [url], "one login, one tab — however many bridges asked");

    const res = await fetch(url, { redirect: "follow" });
    await res.text();
    assert.equal(res.status, 200);
    await grantLanded(dir);
  });
});

test("two bridges starting a login at once share one registration and one link", async (t) => {
  // The first bridge claims the login before it registers the client, so the
  // second finds the claim and waits for its link rather than registering a
  // second client for a second tab (graph @nks/nks-dev, node #4793).
  await withFake(t, { registerDelayMs: 1000 }, async ({ fake, spawnBridge }) => {
    const [a, b] = [spawnBridge(), spawnBridge()];
    const answers = await Promise.all([
      a.call("initialize", 1, INIT_PARAMS),
      b.call("initialize", 1, INIT_PARAMS),
    ]);
    const urls = answers.map((x) => authorizeUrlIn(x.error?.message));
    assert.ok(urls[0] && urls[1], `both must be offered a login: ${JSON.stringify(answers)}`);
    assert.equal(urls[1], urls[0], "one login for both");
    await mintedFrom(urls[0]);
    assert.equal(fake.state.counts.register, 1, "one client registration for one login");
  });
});

// A corporate proxy the runtime will not read sends every call around it, and
// the failure then says nothing about why (graph @nks/nks-dev, nodes #4717,
// #4718). Node reads HTTP(S)_PROXY only from 24.5 and only under
// NODE_USE_ENV_PROXY=1; Bun reads it itself, so under Bun there is nothing to say.
test("a proxy the runtime will not read is named at start, with its lever", async (t) => {
  if (process.env.ISKRON_NODE) return t.skip("the runtime under test may read the proxy itself");
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "iskron-bridge-test-"));
  const bridge = startBridge(`http://127.0.0.1:${port}/mcp`, dir, {
    HTTPS_PROXY: "http://127.0.0.1:9",
    NODE_USE_ENV_PROXY: "",
  });
  try {
    await waitFor(() => /proxy is set/.test(bridge.stderr), "the proxy word on stderr", 5000);
    assert.match(bridge.stderr, /NODE_USE_ENV_PROXY=1/, "the word must name the lever");
  } finally {
    await bridge.stop();
  }
});

// --- a login that does not expire under the human ---------------------------
// A login used to expire five minutes after it was published: the next call
// opened a second tab, and the first tab — where the human came back — led to a
// refused connection (graph @nks/nks-dev, node #4721). Now the login lives as
// long as the bridge holding it; only a bridge its harness has left bounds the
// wait, so nothing hangs forever.

test("a bridge left by its harness mid-login waits for the click only so long, then goes", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge({ ISKRON_BRIDGE_ORPHAN_FLOW_MS: "800" });
    const pending = await bridge.call("initialize", 1, INIT_PARAMS);
    const first = authorizeUrlIn(pending.error?.message);
    assert.ok(first, "a login must be pending");
    const gone = exited(bridge);
    bridge.proc.stdin.end(); // the harness is gone
    await Promise.race([gone, pause(4000)]);
    assert.notEqual(
      bridge.proc.exitCode,
      null,
      "an orphaned bridge must not hang on a login nobody is waiting for",
    );

    // The login outlives the bridge that published it: the next one listens on
    // the same link, so the tab the human already has still lands (#4794).
    const next = spawnBridge();
    const again = authorizeUrlIn((await next.call("initialize", 1, INIT_PARAMS)).error?.message);
    assert.equal(again, first, "the next bridge must take the login over, not publish a new one");
    const res = await fetch(first, { redirect: "follow" });
    await res.text();
    assert.equal(res.status, 200, "the old tab's link must land");
    await grantLanded(dir);
  });
});

// Five real minutes: run with ISKRON_SLOW_PROBES=1 (against a past bridge too,
// through ISKRON_BRIDGE_PATH, to see it red).
test(
  "a login is not taken back after five minutes: a later call joins it, and the old link lands",
  { skip: !process.env.ISKRON_SLOW_PROBES && "five real minutes — set ISKRON_SLOW_PROBES=1" },
  async (t) => {
    await withFake(t, {}, async ({ dir, spawnBridge }) => {
      const bridge = spawnBridge();
      const first = authorizeUrlIn(
        (await bridge.call("initialize", 1, INIT_PARAMS)).error?.message,
      );
      assert.ok(first, "a login must be pending");
      await pause(310_000);
      const again = authorizeUrlIn(
        (await bridge.call("initialize", 2, INIT_PARAMS)).error?.message,
      );
      // A second login carries a new state, so a different link is a second tab.
      assert.equal(again, first, "past five minutes a call must join the standing login");
      const res = await fetch(first, { redirect: "follow" });
      await res.text();
      assert.equal(res.status, 200, "the first link, clicked late, must still land");
      await grantLanded(dir);
    });
  },
);

// --- a certificate the machine does not trust --------------------------------
// A corporate TLS inspection shows the bridge a certificate the machine does
// not trust. The handshake fails before the request leaves, and it fails the
// same way every time: «not sent», no knock again, and the lever named
// (graph @nks/nks-dev, node #4716). The pair in fixtures/ is test-only.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("a certificate the machine does not trust is «not sent», is not knocked again, and names the lever", async () => {
  const srv = createHttpsServer(
    {
      key: readFileSync(join(FIXTURES, "test-only-self-signed.key")),
      cert: readFileSync(join(FIXTURES, "test-only-self-signed.crt")),
    },
    (_q, s) => s.end("{}"),
  );
  let handshakes = 0;
  srv.on("tlsClientError", () => handshakes++);
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const dir = mkdtempSync(join(tmpdir(), "iskron-bridge-test-"));
  const bridge = startBridge(`https://127.0.0.1:${srv.address().port}/mcp`, dir, {
    ISKRON_BRIDGE_NET_BACKOFF_MS: "50,50,50",
  });
  try {
    const text = (await bridge.call("initialize", 1, INIT_PARAMS)).error?.message ?? "";
    assert.match(text, /DEPTH_ZERO_SELF_SIGNED_CERT/, `the cause must ride the text: ${text}`);
    assert.match(text, /never reached the server/, "a refused handshake applied nothing");
    assert.match(text, /NODE_EXTRA_CA_CERTS/, "the text must name the lever");
    await pause(400);
    assert.equal(
      handshakes,
      1,
      "a certificate refusal is the same every time — no knock repeats it",
    );
  } finally {
    await bridge.stop();
    srv.close();
  }
});

test("a proxy switched on through NODE_OPTIONS is not reported as ignored", async (t) => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (process.env.ISKRON_NODE || major < 24 || (major === 24 && minor < 5)) {
    return t.skip("NODE_OPTIONS=--use-env-proxy needs Node 24.5+");
  }
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), "iskron-bridge-test-"));
  const bridge = startBridge(`http://127.0.0.1:${port}/mcp`, dir, {
    HTTPS_PROXY: "http://127.0.0.1:9",
    NODE_USE_ENV_PROXY: "",
    NODE_OPTIONS: "--use-env-proxy",
  });
  try {
    await waitFor(() => / -> http:\/\/127\.0\.0\.1/.test(bridge.stderr), "the start line", 5000);
    await pause(300);
    assert.doesNotMatch(
      bridge.stderr,
      /proxy is set/,
      "the runtime reads the proxy — warning that it does not is a lie the human acts on",
    );
  } finally {
    await bridge.stop();
  }
});
