import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BUILT_BRIDGE } from "./built.mjs";
import { command } from "./demands-fixture.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const realm = "@nks/nks-dev";
const room = "725414c2-7078-4dfa-a5b9-140adb3b3422";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("orchestra session: direct reads share one process UUID across tacts; control stays untagged", async () => {
  const fake = await startFakeNks({ pat: "probe-pat", mind: { orchestra: [] } });
  const calls = [];
  fake.state.requestHook = (req, _res, url) => {
    calls.push({ path: url.pathname, session: req.headers["x-nks-session-id"] });
    return false;
  };
  const dir = mkdtempSync(join(tmpdir(), "orch-session-"));
  writeFileSync(join(dir, "server"), `${fake.base}/mcp\n`);
  writeFileSync(join(dir, "token"), "probe-pat");
  mkdirSync(join(dir, "standings"));
  writeFileSync(
    join(dir, "standings", "probe.hold"),
    JSON.stringify({
      realm: "r5",
      karta: 931,
      name: "probe",
      url: `${fake.base}/channel/ws/probe`,
      at: Date.now(),
    }),
  );
  mkdirSync(join(dir, "run"), { mode: 0o700 });
  writeFileSync(join(dir, "run", "orchestra.json"), JSON.stringify({ on: true, realms: [realm] }));
  writeFileSync(
    join(dir, "run", "orchestra-runs.json"),
    JSON.stringify({
      runs: {
        [`${realm}|${room}|1`]: {
          realm,
          room,
          invite: 1,
          state: "raised",
          at: new Date().toISOString(),
          standing_id: "old-seat",
          rooms: 0,
          sat: true,
        },
        [`@probe/off|${room}|2`]: {
          realm: "@probe/off",
          room,
          invite: 2,
          state: "ambiguity",
          tree: {},
          at: new Date().toISOString(),
        },
      },
    }),
  );
  await fake.control({
    orchestra: {
      realms: {
        [realm]: {
          invites: [
            {
              entry_id: 9,
              room_id: room,
              karta_seq: 931,
              author: "@tester:lead",
              payload: { holon: { seq: 4057, repository: "github.com/probe/one" } },
              attrs: {},
            },
          ],
          signals: [],
        },
      },
    },
  });
  const daemon = spawn(
    process.env.ISKRON_NODE || process.execPath,
    [process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE, "daemon", "--auth-dir", dir],
    {
      env: {
        ...process.env,
        ISKRON_BRIDGE_NO_UPDATE: "1",
        ISKRON_ORCHESTRA: "1",
        ISKRON_ORCHESTRA_TACT_MS: "3600000",
        ISKRON_BRIDGE_DAEMON_IDLE_MS: "60000",
      },
      stdio: "ignore",
    },
  );
  try {
    for (let i = 0; ; i++) {
      const ready = await command(dir, ["status"]);
      if (ready.code === 0) break;
      assert.ok(i < 50, ready.err);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (let i = 0; i < 2; i++) {
      const step = await command(dir, ["step"]);
      assert.equal(step.code, 0, step.err + step.out);
    }
    const demands = await command(dir, ["demands", "--realm", realm]);
    assert.equal(demands.code, 0, demands.err + demands.out);
    const execPath = `/api/realms/${encodeURIComponent("@probe/off")}/raised`;
    const until = Date.now() + 10_000;
    while (!calls.some((c) => c.path === execPath) && Date.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      calls.some((c) => c.path === execPath),
      "exec observer reads its own realm outside the tact",
    );
    const reads = calls.filter(
      (c) =>
        c.path === "/api/realms" ||
        /\/(invites|raised)$/.test(c.path) ||
        c.path === "/api/nodes/931",
    );
    for (const path of [
      "/api/realms",
      `/api/realms/${encodeURIComponent(realm)}/invites`,
      `/api/realms/${encodeURIComponent(realm)}/raised`,
      "/api/nodes/931",
    ])
      assert.ok(
        reads.some((c) => c.path === path),
        `exercised ${path}`,
      );
    assert.ok(
      reads.filter((c) => c.path.endsWith("/raised")).length >= 3,
      "includes pre-stop reread",
    );
    for (const read of reads) assert.match(read.session ?? "", uuid, `${read.path} carries a UUID`);
    assert.equal(
      new Set(reads.map((c) => c.session)).size,
      1,
      "same daemon across calls and tacts",
    );
    const control = calls.filter((c) => c.path === "/api/me/orders" || c.path.endsWith("/stop"));
    assert.ok(
      control.some((c) => c.path.endsWith("/stop")),
      "exercised stop door",
    );
    assert.ok(
      control.some((c) => c.path === "/api/me/orders"),
      "exercised orders door",
    );
    assert.ok(
      control.every((c) => c.session === undefined),
      "control has no session header",
    );
  } finally {
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const ended = new Promise((resolve) => daemon.once("exit", resolve));
      daemon.kill("SIGKILL");
      await ended;
    }
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
