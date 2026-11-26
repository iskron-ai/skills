// Closing upstream sessions under the machine's down window (graph @nks/nks-dev, nodes #9174,
// #11375; №5817 [600]): a live bridge's repeated initialize lets go of the session it holds —
// and the DELETE went out at once while the initialize itself answered «not sent». Now a refused
// initialize lets nothing go, and every close goes through the window: while it stands — kept,
// one per session id; after it lapses and its probe is answered — each kept session gets one
// DELETE, behind the probe and at most two in flight. Probed on the source; ISKRON_REFRESH_SOURCE
// — another copy.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const SOURCE = resolve(process.env.ISKRON_REFRESH_SOURCE || "js");
const from = (path) => import(pathToFileURL(join(SOURCE, path)).href);
const PAT = "sessionclose-window-pat";
const N = 4;
const INIT = {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "t", version: "0" },
};

async function until(what, check, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("live bridges re-initialize under a down window: no DELETE while it stands; after its probe, one each, at most two in flight", async (t) => {
  const fake = await startFakeNks({ pat: PAT });
  const dir = mkdtempSync(join(tmpdir(), "iskron-close-window-"));
  const realNow = Date.now;
  const was = process.env.ISKRON_BRIDGE_TOKEN;
  process.env.ISKRON_BRIDGE_TOKEN = PAT;
  t.after(async () => {
    Date.now = realNow;
    if (was === undefined) delete process.env.ISKRON_BRIDGE_TOKEN;
    else process.env.ISKRON_BRIDGE_TOKEN = was;
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const { readArgs, setConfig } = await from("bridge/config.ts");
  setConfig(readArgs([fake.mcpUrl, "--auth-dir", dir]));
  const { post, state } = await from("bridge/transport.ts");
  const { newScope, runIn } = await from("shared/scope.ts");
  const { admit, failed } = await from("bridge/downwindow.ts");

  // The reviewer's scene: N sessions of one machine, each holding an old session id.
  const scopes = Array.from({ length: N }, (_, i) =>
    newScope(`s${i}`, { env: {}, cwd: dir, pid: process.pid, path: "" }, () => false),
  );
  scopes.forEach((s, i) => {
    runIn(s, () => {
      setConfig(readArgs([fake.mcpUrl, "--auth-dir", dir])); // one grant directory for all
      state.sessionId = `old-${i}`;
    });
    fake.state.sessions.add(`old-${i}`);
  });
  const init = (i) =>
    runIn(scopes[i], () =>
      post({ jsonrpc: "2.0", id: i + 1, method: "initialize", params: INIT }, () => {}),
    );
  failed(admit().knock, 60_000); // the window, saved for 60 s

  const refused = await Promise.allSettled(scopes.map((_, i) => init(i)));
  assert.ok(
    refused.every((r) => r.status === "rejected"),
    "every initialize answers «not sent»",
  );
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(fake.state.deletes, [], "no DELETE while the window stands");

  Date.now = () => realNow() + 61_000; // the window's time is up
  fake.state.deleteHangMs = 200; // each DELETE lies this long: overlaps are seen
  fake.state.deletePeak = 0;
  await init(0); // the machine's probe — answered, the window closes
  await Promise.all([1, 2, 3].map(init));
  await until("a DELETE for every old session", () => fake.state.deletes.length >= N);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(
    fake.state.deletes.map((d) => d.sid).sort(),
    Array.from({ length: N }, (_, i) => `old-${i}`),
    "each old session closed once",
  );
  assert.ok(fake.state.deletePeak <= 2, `at most two DELETEs in flight: ${fake.state.deletePeak}`);
});

// The reviewer's scene (№5817 [610]): one daemon, two sessions on two servers. A's server is
// down — A's close is kept under A's 60 s window; B's server answers B. B's answer releases
// nothing of A's: A's credential never goes to B. After A's window lapses and A's probe is
// answered, A's DELETE goes to A's server with A's token.
test("a close kept on one server is never released by another server's answer, nor sent there", async (t) => {
  const [TOKEN_A, TOKEN_B] = ["token-of-a", "token-of-b"];
  const [fa, fb] = [await startFakeNks({ pat: TOKEN_A }), await startFakeNks({ pat: TOKEN_B })];
  const toB = [];
  fb.state.requestHook = (req) => void toB.push(String(req.headers.authorization ?? ""));
  const dir = mkdtempSync(join(tmpdir(), "iskron-close-servers-"));
  const realNow = Date.now;
  const was = process.env.ISKRON_BRIDGE_TOKEN;
  t.after(async () => {
    Date.now = realNow;
    if (was === undefined) delete process.env.ISKRON_BRIDGE_TOKEN;
    else process.env.ISKRON_BRIDGE_TOKEN = was;
    await Promise.all([fa.stop(), fb.stop()]);
    rmSync(dir, { recursive: true, force: true });
  });
  const { readArgs, setConfig } = await from("bridge/config.ts");
  const { letGo, post, state } = await from("bridge/transport.ts");
  const { newScope, runIn } = await from("shared/scope.ts");
  const { admit, failed } = await from("bridge/downwindow.ts");
  const scopeOf = (id, url, token) => {
    const s = newScope(id, { env: {}, cwd: dir, pid: process.pid, path: "" }, () => false);
    process.env.ISKRON_BRIDGE_TOKEN = token;
    runIn(s, () => setConfig(readArgs([url, "--auth-dir", dir]))); // one daemon, one grant directory
    return s;
  };
  const A = scopeOf("A", fa.mcpUrl, TOKEN_A);
  const B = scopeOf("B", fb.mcpUrl, TOKEN_B);
  const init = (s, id) =>
    runIn(s, () => post({ jsonrpc: "2.0", id, method: "initialize", params: INIT }, () => {}));

  fa.state.sessions.add("session-A");
  await runIn(A, async () => {
    failed(admit().knock, 60_000); // A's server is down for 60 s
    state.sessionId = "session-A";
    await letGo("the session ends"); // kept under A's window
  });
  await init(B, 1); // B's server answers B
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(fb.state.deletes, [], "B's answer sends nothing of A's to B");
  assert.ok(!toB.some((h) => h.includes(TOKEN_A)), "A's token never reaches B's server");
  assert.deepEqual(fa.state.deletes, [], "A's window still stands: nothing to A either");

  Date.now = () => realNow() + 61_000; // A's window lapses
  await init(A, 2); // A's probe, answered: A's own closes go
  await until("A's close on A's server", () => fa.state.deletes.length >= 1);
  assert.deepEqual(
    fa.state.deletes.map((d) => [d.sid, d.bearer]),
    [["session-A", TOKEN_A]],
    "A's DELETE to A's server with A's token",
  );
  assert.ok(!toB.some((h) => h.includes(TOKEN_A)), "A's token never reaches B's server");
  assert.ok(!fb.state.deletes.some((d) => d.sid === "session-A"), "no close of A on B");
});
