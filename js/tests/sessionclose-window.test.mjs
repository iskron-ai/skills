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
