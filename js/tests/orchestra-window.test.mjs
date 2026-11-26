// The orchestrator's own short MCP session under the machine's down window (graph @nks/nks-dev,
// nodes #7700, #11375; №5817 [594]): its initialize went out by its own fetch, past the window
// that transport.ts `post` keeps — after a failed probe it knocked again at once, ignoring the
// server's Retry-After. Now every request of that session goes through the same admit: while the
// window stands no initialize leaves; after it lapses — one knock, the machine's probe, and its
// answer closes the window. Probed on the source; ISKRON_REFRESH_SOURCE — another copy.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { startFakeNks } from "./fake-nks.mjs";

const SOURCE = resolve(process.env.ISKRON_REFRESH_SOURCE || "js");
const from = (path) => import(pathToFileURL(join(SOURCE, path)).href);
const PAT = "orchestra-window-pat";

test("the orchestrator's session under a down window: no initialize while it stands; after it, one probe", async (t) => {
  const fake = await startFakeNks({ pat: PAT, mind: { orchestra: [] } });
  const dir = mkdtempSync(join(tmpdir(), "iskron-orch-window-"));
  const realNow = Date.now;
  t.after(async () => {
    Date.now = realNow;
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  });
  const was = process.env.ISKRON_BRIDGE_TOKEN;
  process.env.ISKRON_BRIDGE_TOKEN = PAT;
  t.after(() =>
    was === undefined
      ? delete process.env.ISKRON_BRIDGE_TOKEN
      : (process.env.ISKRON_BRIDGE_TOKEN = was),
  );
  const { readArgs, setConfig } = await from("bridge/config.ts");
  setConfig(readArgs([fake.mcpUrl, "--auth-dir", dir]));
  const { post } = await from("bridge/transport.ts");
  const { readLaunchers } = await from("bridge/orchestra-launchers.ts");

  // The reviewer's scene: a real `post` meets 503 with Retry-After: 10 — the window is recorded.
  await fake.control({ initRefuse: { status: 503, retryAfter: 10 } });
  const init = {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "t", version: "0" },
  };
  await assert.rejects(
    post({ jsonrpc: "2.0", id: 1, method: "initialize", params: init }, () => {}),
    /503/,
  );
  assert.ok(
    readdirSync(dir).some((f) => f.endsWith(".down")),
    "the down window is recorded",
  );
  await fake.control({ initRefuse: null }); // the server is back — but the window still stands

  const before = fake.state.initAt.length;
  await assert.rejects(readLaunchers(fake.mcpUrl, PAT), "the read is not sent");
  assert.equal(fake.state.initAt.length, before, "no initialize while the window stands");

  Date.now = () => realNow() + 11_000; // the window's time is up
  await readLaunchers(fake.mcpUrl, PAT).catch(() => {});
  assert.equal(fake.state.initAt.length, before + 1, "one initialize: the machine's probe");
  assert.ok(!readdirSync(dir).some((f) => f.endsWith(".down")), "its answer closes the window");
});
