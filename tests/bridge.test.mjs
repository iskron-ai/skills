// Behavioural tests for iskron-bridge, run against the local fake in
// tests/fake-nks.mjs. Black box on purpose: the bridge is spawned exactly as a
// harness spawns it, driven over stdio, and every claim is read off what a
// harness or a browser would actually see — a JSON-RPC answer, an open port,
// the token store on disk. Nothing here reaches the network or the real store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeNks } from "./fake-nks.mjs";

// Defaults to the source of truth; ISKRON_BRIDGE_PATH points the same suite at
// another copy — a built bundle, an installed one, or a past revision when you
// want to see a test fail on the defect it was written for.
const BRIDGE = process.env.ISKRON_BRIDGE_PATH
  || join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "establish-mcp", "scripts", "iskron-bridge.mjs");
const INIT_PARAMS = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test-harness", version: "0" } };

// --- driving the bridge the way a harness does -----------------------------

function startBridge(serverUrl, authDir, extraEnv = {}) {
  const proc = spawn(process.execPath, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_BROWSER: "1", ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
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
      if (w) { waiters.delete(msg.id); w(msg); }
    }
  });
  proc.stderr.on("data", (c) => { stderr += c; });

  return {
    proc,
    get stderr() { return stderr; },
    send: (msg) => proc.stdin.write(JSON.stringify(msg) + "\n"),
    // Every request must be answered — that is the bridge's core promise, so
    // the timeout here is a failure, never a skip.
    call(method, id, params = {}) {
      const p = new Promise((res, rej) => {
        waiters.set(id, res);
        setTimeout(() => rej(new Error(`no answer for ${method} (id ${id}) — the bridge went silent`)), 15_000).unref();
      });
      this.send({ jsonrpc: "2.0", id, method, params });
      return p;
    },
    // Idempotent: a bridge the test already killed must not be waited on again.
    stop: () => (proc.exitCode !== null || proc.signalCode !== null)
      ? Promise.resolve()
      : new Promise((r) => { proc.once("exit", r); proc.kill("SIGKILL"); }),
  };
}

const authorizeUrlIn = (text) => /(https?:\/\/\S*\/authorize\?\S+)/.exec(text || "")?.[1] ?? null;
const callbackPortOf = (authorizeUrl) =>
  Number(new URL(new URL(authorizeUrl).searchParams.get("redirect_uri")).port);

function portListening(port) {
  return new Promise((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    const done = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(1000, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

const storeFile = (dir) => join(dir, readdirSync(dir).find((f) => f.endsWith(".json")));
// The machine's memory of a refused grant. Aging it is how a test stands where
// a refusal has already persisted, without spending the grace window in real time.
const ageRefusal = (dir) => writeFileSync(
  storeFile(dir) + ".grant-state", JSON.stringify({ refused_since: Date.now() - 600_000, reason: "aged by the test" }));
const lockFile = (dir) => join(dir, readdirSync(dir).find((f) => f.endsWith(".auth-pending")));
const readStore = (dir) => JSON.parse(readFileSync(storeFile(dir), "utf8"));

// The bridge answers the harness at once and finishes the flow in the
// background, so the click landing is not yet the grant being on disk. Tests
// that go on to depend on the grant wait for it rather than racing it.
async function waitFor(check, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if (await check()) return; } catch { /* not there yet */ }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
const grantLanded = (dir) => waitFor(
  () => !!readStore(dir).tokens?.access_token, "the exchanged tokens to reach the store");

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
  const spawnBridge = (env) => { const b = startBridge(fake.mcpUrl, dir, env); bridges.push(b); return b; };
  try {
    await fn({ fake, dir, spawnBridge });
  } finally {
    await Promise.all(bridges.map((b) => b.stop()));
    await fake.stop();
  }
}

// --- the promise the bridge is built on ------------------------------------

test("a call made with no tokens is answered, not swallowed, and carries the authorize URL", async (t) => {
  await withFake(t, {}, async ({ spawnBridge }) => {
    const bridge = spawnBridge();
    const answer = await bridge.call("initialize", 1, INIT_PARAMS);
    assert.equal(answer.id, 1);
    assert.ok(answer.error, "a call that cannot be served must come back as an error for its id");
    assert.ok(authorizeUrlIn(answer.error.message), "the error must carry the URL the human has to open");
  });
});

test("the callback listener is up BEFORE the authorize URL is published", async (t) => {
  await withFake(t, {}, async ({ spawnBridge }) => {
    const bridge = spawnBridge();
    const answer = await bridge.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error.message);
    assert.equal(await portListening(callbackPortOf(url)), true,
      "the URL was handed out while nothing was listening on its redirect port");
  });
});

test("the full flow authenticates and the next call goes through", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    const answer = await bridge.call("tools/list", 2);
    assert.deepEqual(answer.result.tools, [{ name: "nks_orient" }]);
    assert.equal(fake.state.counts.code_exchange, 1);
    assert.ok(readStore(dir).tokens.refresh_token, "the grant must be persisted for the next process");
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
    assert.equal(await portListening(stalePort), false, "precondition: the dead owner's port is closed");

    const second = spawnBridge();
    const answer = await second.call("initialize", 2, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error.message);
    assert.ok(url, "the fresh bridge must publish a URL of its own");
    assert.equal(await portListening(callbackPortOf(url)), true,
      "the fresh bridge re-published a URL with no listener behind it");
    // And the taken-over flow really completes.
    const res = await fetch(url, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await grantLanded(dir);
    assert.deepEqual((await second.call("tools/list", 3)).result.tools, [{ name: "nks_orient" }]);
  });
});

test("a bridge told to stop mid-flow outlives it, so the human's click still lands", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    const url = authorizeUrlIn((await bridge.call("initialize", 1, INIT_PARAMS)).error.message);
    bridge.proc.kill("SIGTERM"); // what a harness does when its session ends
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(bridge.proc.exitCode, null, "the bridge left while a human was mid-login");
    assert.equal(await portListening(callbackPortOf(url)), true, "the redirect had nowhere to land");

    const res = await fetch(url, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await grantLanded(dir);
    await waitFor(() => bridge.proc.exitCode !== null, "the bridge to leave once the flow is done");
  });
});

test("a finished flow leaves no pending lock behind", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    await waitFor(() => !readdirSync(dir).some((f) => f.endsWith(".auth-pending")),
      "the pending lock to be dropped");
  });
});

test("a live flow is joined: every instance shows the same URL, one click serves them all", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const winner = spawnBridge();
    const joiner = spawnBridge();
    const winnerUrl = authorizeUrlIn((await winner.call("initialize", 1, INIT_PARAMS)).error.message);
    const joinerUrl = authorizeUrlIn((await joiner.call("initialize", 1, INIT_PARAMS)).error.message);
    assert.equal(joinerUrl, winnerUrl, "a second bridge must surface the standing flow, not start a rival one");

    const res = await fetch(winnerUrl, { redirect: "follow" });
    assert.equal(res.status, 200);
    await res.text();
    await grantLanded(dir);
    // The joiner never ran a flow of its own; it reads the grant off disk.
    const answer = await joiner.call("tools/list", 2);
    assert.deepEqual(answer.result.tools, [{ name: "nks_orient" }]);
  });
});

test("a fresh process reuses the stored grant with no browser trip at all", async (t) => {
  await withFake(t, { accessTtl: 3600 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const second = spawnBridge();
    const answer = await second.call("initialize", 1, INIT_PARAMS);
    assert.ok(answer.result, `the second process should have been served straight away: ${JSON.stringify(answer.error)}`);
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
    assert.equal(fake.state.counts.authorize, 1, "a refresh must not drag the user into the browser");
    assert.notEqual(readStore(dir).tokens.refresh_token, s.tokens.refresh_token, "the rotated refresh token must be stored");
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
    await fake.control({ refreshStatus: 503, refreshError: "temporarily_unavailable", revoke_access: true });

    const second = spawnBridge();
    const answer = await second.call("initialize", 1, INIT_PARAMS);
    assert.ok(answer.error, "the call cannot be served while the token endpoint is down");
    assert.equal(authorizeUrlIn(answer.error.message), null, "a 503 must not send the human to a login screen");
    assert.equal(readStore(dir).tokens.refresh_token, before, "the grant must survive a transient failure");
    assert.equal(fake.state.counts.authorize, 1);
  });
});

// A login is the one repair that spends a human's attention, so the bridge is
// slow to ask and slower to ask twice.

test("a refused grant costs a login only once the refusal has stood", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });

    const second = spawnBridge();
    const held = await second.call("initialize", 1, INIT_PARAMS);
    assert.ok(held.error, "a refused grant cannot serve the call");
    assert.equal(authorizeUrlIn(held.error.message), null,
      "one refusal can be a server mid-restart — it must not cost a login yet");
    assert.equal(fake.state.counts.authorize, 1, "and no second flow may be started");
    // Whatever happens next, the reason must survive the process that saw it.
    assert.match(readFileSync(join(dir, "grant.log"), "utf8"), /invalid_grant/,
      "the grant log must carry the server's own words");
    await second.stop();

    ageRefusal(dir);
    const third = spawnBridge();
    const answer = await third.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(answer.error?.message);
    assert.ok(url, `a refusal that persists must lead to a new authorization: ${JSON.stringify(answer)}`);
    assert.equal(await portListening(callbackPortOf(url)), true);
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
    assert.ok((await bridge.call("initialize", 1, INIT_PARAMS)).result, "the token in hand still serves");
    assert.equal(fake.state.counts.refresh, 0, "the speculative refresh must wait for the hour");
    assert.equal(fake.state.counts.authorize, 1, "and nobody may be sent to a browser over it");
  });
});

test("a refresh the caller needs knocks even before the hour, and never walls the call", async (t) => {
  await withFake(t, { refreshNotBeforeMs: 2000 }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    // Upstream refuses the access token we hold while the refresh token is not
    // yet in force — witnessed live, minutes after a rotation. Declining to ask
    // would leave the harness with nothing for as long as the hour lasts.
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    const grant = s.tokens.refresh_token;
    await fake.control({ revoke_access: true });

    const early = spawnBridge();
    const held = await early.call("initialize", 1, INIT_PARAMS);
    assert.ok(held.error, "the server did refuse — there is nothing to serve with yet");
    assert.ok(fake.state.counts.refresh >= 1, "but the bridge must have ASKED, not decided for the server");
    assert.equal(authorizeUrlIn(held.error.message), null, "a refusal this early is no proof of a dead grant");
    assert.equal(readStore(dir).tokens.refresh_token, grant, "and the grant must survive it");
    await early.stop();

    await new Promise((r) => setTimeout(r, Math.max(0, fake.state.refreshValidFrom - Date.now()) + 150));
    const late = spawnBridge();
    const answer = await late.call("initialize", 1, INIT_PARAMS);
    assert.ok(answer.result, `once in force the same grant must serve: ${JSON.stringify(answer.error)}`);
    assert.equal(fake.state.counts.authorize, 1, "and no human was ever asked");
  });
});

test("the access token's own exp outranks the expires_in the server advertised", async (t) => {
  // A server may advertise one lifetime and stamp another; the resource server
  // checks the stamp. Half an hour of imagined validity is half an hour of 401s.
  await withFake(t, { accessTtl: 3600, accessExpSkewSec: 1800 }, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);

    const claimed = JSON.parse(Buffer.from(readStore(dir).tokens.access_token.split(".")[1], "base64url")).exp * 1000;
    const held = readStore(dir).tokens.expires_at;
    assert.ok(held <= claimed, "the bridge must not hold a token as good past its own exp");
    assert.ok(claimed - held <= 120_000, `the margin should be a skew, not a guess: ${claimed - held}ms`);
  });
});

test("a short-lived access token is not stale the moment it arrives", async (t) => {
  // The caution taken off a token's life is a skew, not a fixed minute: a
  // twenty-second token minus a minute is dead on arrival, and every call
  // would then buy a refresh it does not need.
  await withFake(t, { accessTtl: 20 }, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    assert.ok(readStore(dir).tokens.expires_at > Date.now(), "a token just issued must count as usable");

    assert.ok((await bridge.call("tools/list", 2)).result);
    assert.equal(fake.state.counts.refresh, 0, "and must not be topped up before it has been used once");
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
    assert.ok((await bridge.call("initialize", 1, INIT_PARAMS)).result, "the token in hand still serves");
    assert.equal(fake.state.counts.refresh, 0, "the token's own nbf must be honoured with no field to help");
  });
});

test("a login the human declines is not offered again on the next call", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ refreshStatus: 400, refreshError: "invalid_grant", revoke_access: true });
    ageRefusal(dir);

    const bridge = spawnBridge();
    const offered = await bridge.call("initialize", 1, INIT_PARAMS);
    const url = authorizeUrlIn(offered.error?.message);
    assert.ok(url, `the standing refusal should have led to a login: ${JSON.stringify(offered)}`);

    // The human says no: the consent screen comes back with a refusal.
    const back = new URL(new URL(url).searchParams.get("redirect_uri"));
    back.searchParams.set("error", "access_denied");
    back.searchParams.set("state", new URL(url).searchParams.get("state"));
    await (await fetch(back)).text();
    await waitFor(async () => !(await portListening(callbackPortOf(url))), "the declined flow to close");

    const again = await bridge.call("initialize", 2, INIT_PARAMS);
    assert.ok(again.error, "there is still nothing to serve with");
    assert.equal(authorizeUrlIn(again.error.message), null,
      "someone who just declined must not be asked again on the next tool call");
    assert.match(again.error.message, /not asking again/);
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
    answers.forEach((a, i) => assert.ok(a.result, `bridge ${i} went unserved: ${JSON.stringify(a.error)}`));
    assert.equal(fake.state.counts.stale_refresh, 0,
      "no bridge may present a refresh token the server has already rotated away");
    assert.equal(fake.state.counts.refresh, 1, "one grant, one expiry — one refresh");
    assert.equal(fake.state.counts.authorize, 1, "nobody may be sent back to a login screen");
  });
});

test("a server that reads replay as theft keeps the grant through the crowd", async (t) => {
  await withFake(t, { refreshDelayMs: SLOW_TOKEN_MS, reuseDetection: true }, async ({ fake, dir, spawnBridge }) => {
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();

    const answers = await crowdPastExpiry(fake, dir, spawnBridge);
    answers.forEach((a, i) => assert.ok(a.result, `bridge ${i} went unserved: ${JSON.stringify(a.error)}`));
    assert.equal(fake.state.counts.authorize, 1, "a rotation race must not cost the human a re-login");
    assert.ok(readStore(dir).tokens.refresh_token, "the machine must still hold a grant");

    const later = spawnBridge();
    assert.ok((await later.call("initialize", 30, INIT_PARAMS)).result,
      "and the grant it holds must still work");
  });
});

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
      forget_clients: true, refreshStatus: 400, refreshError: "invalid_client", revoke_access: true,
    });
    ageRefusal(dir); // the refusal has stood; the login is due

    // Keeping the dead client_id would publish an authorize URL that the server
    // refuses — a login the human cannot complete however often they click.
    const second = spawnBridge();
    await authorize(second, dir, 5);
    assert.equal(fake.state.counts.register, 2, "the forgotten registration must be replaced, not reused");
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
      setTimeout(() => rej(new Error(`no whole line ever arrived — ${out.length} bytes of it did`)), 8000).unref();
    });
    bridge.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "big" } });
    await new Promise((r) => setTimeout(r, 400)); // the answer is written, and stuck in the pipe
    bridge.proc.kill("SIGTERM");                  // the harness asks the bridge to go away

    bridge.proc.stdout.resume();
    const line = await answer;
    const parsed = JSON.parse(line); // a truncated line does not parse — that is the defect
    assert.equal(parsed.id, 7);
    assert.equal(parsed.result.pad.length, 200_000, "the whole answer must reach the harness");
  });
});

test("a lost upstream session is re-established transparently", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    assert.ok((await bridge.call("initialize", 2, INIT_PARAMS)).result);
    await fake.control({ kill_session: true });

    const answer = await bridge.call("tools/list", 3);
    assert.ok(answer.result, `the bridge should have re-initialized and retried: ${JSON.stringify(answer.error)}`);
    assert.deepEqual(answer.result.tools, [{ name: "nks_orient" }]);
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

test("a notification is never answered", async (t) => {
  await withFake(t, {}, async ({ dir, spawnBridge }) => {
    const bridge = spawnBridge();
    await authorize(bridge, dir);
    let spoke = false;
    bridge.proc.stdout.on("data", () => { spoke = true; });
    bridge.send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(spoke, false, "a message with no id must get no answer");
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
    assert.equal(fake.state.resources.authorize, forced, "the authorize leg asked for another audience");
    assert.equal(fake.state.resources.code_exchange, forced, "the code exchange asked for another audience");
  });
});

test("the override still applies once discovery is cached — the defect it exists for", async (t) => {
  await withFake(t, {}, async ({ fake, dir, spawnBridge }) => {
    // First flow with no override: the store now caches what discovery said.
    const first = spawnBridge();
    await authorize(first, dir);
    await first.stop();
    assert.equal(fake.state.resources.code_exchange, fake.mcpUrl, "precondition: discovery's value was used");

    // Exactly the operator's move: the audience was wrong, so set the override
    // and retry. Nothing clears the store first — nobody would think to.
    const s = readStore(dir);
    s.tokens.expires_at = Date.now() - 1000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    const forced = "https://forced.example/mcp/";
    const second = spawnBridge({ ISKRON_BRIDGE_RESOURCE: forced });
    assert.ok((await second.call("initialize", 1, INIT_PARAMS)).result, "the refreshed call should have been served");
    assert.equal(fake.state.resources.refresh, forced,
      "the override was ignored because discovery had already been cached in the store");
  });
});
