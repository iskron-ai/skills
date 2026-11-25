// The machine's down window (bridge/downwindow.ts): the api restarts, and every bridge
// used to hand its agent «retry freely — the server side needs attention» and knock
// again by itself (graph @nks/nks-dev, nodes #7700, #8144) — the retries were the storm.
// A front door between the bridges and the fake plays the server's front line: `down`
// answers 503 to every knock, `gone` answers 404 to every knock that rides a session
// (the api restarted and forgot them) and to initialize while `initDown` stands, `drop`
// closes the connection under so many knocks without an answer, else the bytes are
// forwarded. Two bridges on one grant directory stand for the machine.
// ISKRON_BRIDGE_PATH points the bridge at a past build to see these fail on the defect.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

// The arithmetic is probed on the source; imported inside the probes so that this file
// still loads — and the black-box probes above still run — against a build that has no
// window at all.
const window_ = () => import("../bridge/downwindow.ts");

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "test-harness", version: "0" },
};
const ORIENT = { name: "iskron_orient", arguments: {} };
const ENV = { ISKRON_BRIDGE_TOKEN: "nks_pat_probe", ISKRON_BRIDGE_NET_BACKOFF_MS: "300,300,300" };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (reply) => reply.error?.message ?? JSON.stringify(reply);

function startBridge(serverUrl, authDir) {
  const proc = spawn(NODE, [BRIDGE, serverUrl, "--no-browser", "--auth-dir", authDir], {
    env: { ...process.env, ISKRON_BRIDGE_DAEMON: "0", ISKRON_BRIDGE_NO_BROWSER: "1", ...ENV },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiters = new Map();
  let out = "";
  proc.stdout.on("data", (c) => {
    out += c;
    let nl;
    while ((nl = out.indexOf("\n")) >= 0) {
      const line = out.slice(0, nl).trim();
      out = out.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      waiters.get(msg.id)?.(msg);
      waiters.delete(msg.id);
    }
  });
  return {
    send: (msg) => proc.stdin.write(JSON.stringify(msg) + "\n"),
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
    stop: () =>
      proc.exitCode !== null || proc.signalCode !== null
        ? Promise.resolve()
        : new Promise((r) => {
            proc.once("exit", r);
            proc.kill("SIGKILL");
          }),
  };
}

/** The front line of the server, on a port of its own; every knock is counted. */
async function frontDoor(targetUrl) {
  const target = new URL(targetUrl);
  const door = {
    url: "",
    knocks: [],
    session: [],
    mode: "open",
    retryAfter: null,
    initDown: false,
    drops: 1,
  };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      let method = null;
      try {
        method = JSON.parse(body.toString()).method ?? null;
      } catch {}
      door.knocks.push(method);
      door.session.push(!!req.headers["mcp-session-id"]);
      // So many knocks are read and their connection closed without an answer — an idle
      // keep-alive the server closed (#6630); then the door is open again for whoever knocks.
      if (door.mode === "drop") {
        if (--door.drops <= 0) door.mode = "open";
        return res.destroy();
      }
      const json = (status, payload, headers = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers });
        res.end(JSON.stringify(payload));
      };
      if (
        door.mode === "down" ||
        (door.mode === "gone" && method === "initialize" && door.initDown)
      )
        return json(
          503,
          { error: "service unavailable" },
          door.retryAfter ? { "retry-after": String(door.retryAfter) } : {},
        );
      if (door.mode === "gone" && req.headers["mcp-session-id"])
        return json(404, { error: "unknown_session" });
      const up = httpRequest(
        target,
        { method: req.method, headers: { ...req.headers, host: target.host } },
        (r) => {
          res.writeHead(r.statusCode, r.headers);
          r.pipe(res);
        },
      );
      up.on("error", () => res.destroy());
      res.on("close", () => up.destroy());
      up.end(body);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  door.url = `http://127.0.0.1:${server.address().port}${target.pathname}`;
  door.set = (mode, { retryAfter = null, initDown = false, drops = 1 } = {}) => {
    door.mode = mode;
    door.retryAfter = retryAfter;
    door.initDown = initDown;
    door.drops = drops;
  };
  door.close = () => new Promise((r) => server.close(() => r()));
  return door;
}

/** Knocks that ride a session — a call, or the reopen under it; the handshake itself is setup. */
const sessionKnocks = (door) => door.knocks.filter((_, i) => door.session[i]).length;

const downRecord = (dir) => readdirSync(dir).find((f) => f.endsWith(".json.down")) ?? null;

async function machine(t, fn) {
  const fake = await startFakeNks({ pat: "nks_pat_probe" });
  const door = await frontDoor(fake.mcpUrl);
  const dir = mkdtempSync(join(tmpdir(), "iskron-down-test-"));
  const bridges = [];
  t.after(async () => {
    await Promise.all(bridges.map((b) => b.stop()));
    await door.close();
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const seat = async () => {
    const b = startBridge(door.url, dir);
    bridges.push(b);
    assert.ok((await b.call("initialize", 1, INIT)).result, "precondition: a session is open");
    b.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return b;
  };
  await fn({ door, dir, seat });
}

// The Retry-After of the front line (one second) stands in for a window the test can
// wait out; the ladder here draws its jitter under 300 ms, so a refusal after that is
// the server's own word honored, not the jitter.
test("a down server is ONE window for the whole machine: the other bridges answer «not sent» at once and knock nothing", async (t) => {
  await machine(t, async ({ door, dir, seat }) => {
    const [a, b] = [await seat(), await seat()];
    await door.set("down", { retryAfter: 1 });
    const first = await a.call("tools/call", 2, ORIENT);
    assert.match(text(first), /server unavailable/, JSON.stringify(first));
    assert.match(
      text(first),
      /OUTCOME IS UNKNOWN/,
      "a 503 is the front line's word: the api may have seen the call",
    );
    // Nothing repeats the call without a new one: the word names the wait, never a retry (#11375).
    assert.match(text(first), /call again in about \d+ s/, JSON.stringify(first));
    assert.doesNotMatch(text(first), /retries by itself|knocks it again by itself/);
    assert.doesNotMatch(text(first), /retry freely|server side needs attention/);
    // The call was knocked exactly once: with the session, the front line said 503 — a
    // 503 is not retried in-process, so no second knock for it. The handshake the api's
    // turnover may have asked for rides no session and is not counted.
    // No knock rides a session while the window stands: the call is refused at the gate. (What
    // the first failure knocked is the bridge's own business — the 503 it met, and the reopen
    // the api's turnover may have asked for; the claim here is what follows it.)
    assert.ok(
      downRecord(dir),
      "the window is on disk, where every bridge on the grant directory reads it",
    );
    const knocked = sessionKnocks(door);

    const t0 = Date.now();
    const second = await b.call("tools/call", 2, ORIENT);
    const took = Date.now() - t0;
    assert.match(text(second), /server unavailable/, JSON.stringify(second));
    assert.match(text(second), /it is not queued/, "refused by the window: nothing was sent");
    assert.doesNotMatch(text(second), /retry freely|OUTCOME IS UNKNOWN/);
    assert.match(text(second), /about 1 s/, "the wait is named");
    assert.match(text(second), /not sent — server unavailable — call again in about 1 s/);
    assert.ok(took < 900, `answered at once, not after the window: ${took}ms`);
    assert.equal(sessionKnocks(door), knocked, "no bridge knocked while the window stands");
    assert.ok(
      downRecord(dir),
      "the window is on disk, where every bridge on the grant directory reads it",
    );

    await pause(600); // past anything the 300 ms ladder could have drawn
    const still = await b.call("tools/call", 3, ORIENT);
    assert.match(text(still), /it is not queued/, "the server's Retry-After is honored");
    assert.equal(sessionKnocks(door), knocked);

    await door.set("open");
    await pause(450);
    const served = await b.call("tools/call", 4, ORIENT);
    assert.ok(
      served.result && !served.error,
      `once the window has passed the call is the machine's probe and is served: ${JSON.stringify(served)}`,
    );
    assert.equal(downRecord(dir), null, "an answered probe closes the window");
    const free = await a.call("tools/call", 4, ORIENT);
    assert.ok(
      free.result && !free.error,
      `a closed window refuses nothing: ${JSON.stringify(free)}`,
    );
  });
});

test("when the window's time is up exactly ONE knock goes out for the whole machine, and its failure steps the ladder", async (t) => {
  await machine(t, async ({ door, seat }) => {
    const [a, b] = [await seat(), await seat()];
    await door.set("down", { retryAfter: 1 });
    await a.call("tools/call", 2, ORIENT); // opens the window
    await pause(1100); // its time is up
    const knocked = sessionKnocks(door);
    const answers = await Promise.all([
      a.call("tools/call", 3, ORIENT),
      b.call("tools/call", 3, ORIENT),
    ]);
    assert.equal(sessionKnocks(door) - knocked, 1, "one probe, not one per bridge");
    const texts = answers.map(text);
    assert.ok(
      texts.every((s) => /server unavailable/.test(s)),
      JSON.stringify(answers),
    );
    assert.equal(
      texts.filter((s) => /it is not queued/.test(s)).length,
      1,
      "the other call was refused",
    );
    assert.equal(
      texts.filter((s) => /OUTCOME IS UNKNOWN/.test(s)).length,
      1,
      "the probe met the 503",
    );

    const soon = await a.call("tools/call", 4, ORIENT);
    assert.match(text(soon), /it is not queued/, "a failed probe stands the window again");
    assert.equal(sessionKnocks(door) - knocked, 1, "and nothing else is knocked");

    await door.set("open");
    await pause(1100);
    for (const x of [a, b]) {
      const back = await x.call("tools/call", 5, ORIENT);
      assert.ok(
        back.result && !back.error,
        `both bridges are served again: ${JSON.stringify(back)}`,
      );
    }
    assert.equal(sessionKnocks(door) - knocked, 3, "one probe, then every call goes through");
  });
});

test("a session the api forgot is reopened — and a reopen that meets a down server answers «not sent», not a failed recovery", async (t) => {
  await machine(t, async ({ door, seat }) => {
    const a = await seat();
    await door.set("gone", { initDown: true, retryAfter: 1 });
    const reopened = await a.call("tools/call", 2, ORIENT);
    assert.match(text(reopened), /server unavailable/, JSON.stringify(reopened));
    assert.match(
      text(reopened),
      /it is not queued/,
      "the 404 applied nothing, and the reopen was not sent",
    );
    assert.doesNotMatch(text(reopened), /session recovery failed|retry freely/);

    await door.set("open"); // the api is back
    await pause(1100);
    const after = await a.call("tools/call", 3, ORIENT);
    assert.ok(
      after.result && !after.error,
      `the same call then reopens the session and goes through: ${JSON.stringify(after)}`,
    );
  });
});

test("a session the api forgot UNDER an open window: nothing is knocked, neither the call nor its reopen", async (t) => {
  await machine(t, async ({ door, seat }) => {
    const [a, b] = [await seat(), await seat()];
    await door.set("down", { retryAfter: 1 });
    await b.call("tools/call", 2, ORIENT); // the window opens
    await door.set("gone"); // the api is back and has forgotten every session
    const knocked = sessionKnocks(door);
    const t0 = Date.now();
    const refused = await a.call("tools/call", 2, ORIENT);
    assert.equal(sessionKnocks(door), knocked, "no knock at all while the window stands");
    assert.ok(Date.now() - t0 < 900, "answered at once");
    assert.match(text(refused), /server unavailable/, JSON.stringify(refused));
    assert.match(text(refused), /it is not queued/);
    assert.doesNotMatch(text(refused), /session recovery failed|session expired|retry freely/);
  });
});

// --- the window's arithmetic, on the source ---------------------------------

// A guard, green on the build before the window too: a dropped connection keeps the old
// behavior — no window, the next knock goes. The narrowing is held by the existing stand
// probes (a usage snapshot, the revoke at a run's end, a register replayed): they went red
// on the first, too wide family of this window, which opened one on a dropped request. This
// probe alone did not reproduce that red.
test("dropped connections are not a down server: no window opens and the next knock goes", async (t) => {
  await machine(t, async ({ door, dir, seat }) => {
    const a = await seat();
    await door.set("drop", { drops: 2 }); // the write, and its own retry if it makes one
    const dropped = await a.call("tools/call", 2, {
      name: "iskron_stand",
      arguments: { realm: "nks-dev", karta: 931, name: "drop-once" },
    });
    assert.doesNotMatch(
      JSON.stringify(dropped),
      /server unavailable/,
      "a dropped connection is answered as itself, not as a down server",
    );
    assert.equal(downRecord(dir), null, "dropped connections open no window");
    const next = await a.call("tools/call", 3, ORIENT);
    assert.ok(next.result && !next.error, `the next call is served: ${JSON.stringify(next)}`);
  });
});

test("the ladder: a call's own retry pauses, then doubling, never past a minute", async () => {
  const { DOWN_CAP_MS, downStepMs, NET_BACKOFF_MS } = await window_();
  assert.ok(NET_BACKOFF_MS.length >= 3, "precondition: the in-process retry has its pauses");
  const own = NET_BACKOFF_MS.map((_, k) => downStepMs(k));
  assert.deepEqual(own, NET_BACKOFF_MS, "the first steps ARE the call's own retry pauses");
  assert.equal(downStepMs(NET_BACKOFF_MS.length), Math.min(DOWN_CAP_MS, NET_BACKOFF_MS.at(-1) * 2));
  for (let k = 0; k < 40; k++) assert.ok(downStepMs(k) <= DOWN_CAP_MS, `step ${k} past the cap`);
  assert.equal(downStepMs(60), DOWN_CAP_MS, "a minute is the longest pause");
  assert.equal(DOWN_CAP_MS, 60_000);
});

test("the window on disk: one probe at a time, an answer closes it, a failure steps it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-down-unit-"));
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
    rmSync(dir, { recursive: true, force: true });
  });
  const { readArgs, setConfig } = await import("../bridge/config.ts");
  const { admit, answered, downStepMs, failed, PROBE_WAIT_MS } = await window_();
  setConfig(readArgs(["http://127.0.0.1:9/mcp", "--auth-dir", dir]));
  const free = admit();
  assert.equal(free.refused, false);
  assert.equal(free.knock.probe, false, "no window — a free knock");
  const wait = failed(free.knock, 0);
  assert.ok(wait >= 0 && wait <= downStepMs(0), `full jitter under the first step: ${wait}ms`);
  const shut = admit();
  assert.equal(shut.refused, true);
  // A hair of slack: the wall clock may step back between the two calls.
  assert.ok(
    shut.waitMs <= wait + 1,
    `refused for as long as the window stands: waited ${wait}ms, told ${shut.waitMs}ms`,
  );
  assert.equal(downStepMs(1) >= downStepMs(0), true);

  Date.now = () => realNow() + wait + 1; // the window's time is up
  const probe = admit();
  assert.equal(probe.refused, false);
  assert.equal(probe.knock.probe, true, "the first knock after the window is the machine's probe");
  assert.deepEqual(
    admit(),
    { refused: true, waitMs: PROBE_WAIT_MS },
    "a second knock waits for the probe",
  );
  const stepped = failed(probe.knock, 5000); // the front line said Retry-After: 5
  assert.ok(stepped >= 5000, `the server's own word is the floor: ${stepped}ms`);
  assert.ok(downRecord(dir), "the window stands after a failed probe");
  Date.now = () => realNow() + wait + 6000;
  const again = admit();
  assert.equal(again.knock.probe, true, "the next probe after the server's word");
  answered(again.knock);
  assert.equal(downRecord(dir), null, "any answer under 500 closes the window");
  assert.equal(admit().knock.probe, false, "and the next knock is free again");
});
