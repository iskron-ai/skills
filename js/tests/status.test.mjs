import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE, rpc, status } from "./status-kit.mjs";

test("status snapshots a real daemon without opening a session", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-daemon-"));
  const fake = await startFakeNks({ pat: "status-pat" });
  const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], { env, stdio: "ignore" });
  let link;
  let satellite;
  try {
    (await entrance(dir)).close();
    link = await connectSeam(
      seamSocketPath(dir),
      helloFrame({
        build: "v7.9.0+test",
        path: BRIDGE,
        argv: [fake.mcpUrl, "--auth-dir", dir],
        patSha: patShaOf("status-pat"),
      }),
      3000,
    );
    await rpc(
      link,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pi-iskron", version: "0" },
      },
      1,
    );
    const stood = await rpc(
      link,
      "tools/call",
      { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name: "status-place" } },
      2,
    );
    assert.ok(!stood.result?.isError);
    const r = status(dir, ["--json"]);
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout);
    assert.equal(s.daemon.pid, d.pid);
    assert.equal(s.sessions.length, 1);
    assert.equal(s.sessions[0].local_id, link.welcome.session);
    assert.equal(s.sessions[0].thin_pid, process.pid);
    assert.equal(s.sessions[0].attached, true);
    assert.equal(s.sessions[0].build, "v7.9.0+test");
    assert.equal(s.sessions[0].harness, "pi-iskron");
    assert.equal(s.sessions[0].cwd, process.cwd());
    const p = s.sessions[0].places[0];
    assert.equal(p.name, "status-place");
    assert.equal(p.primary, true);
    assert.equal(p.listening, true);
    assert.ok(Date.parse(p.last_work_at) > 0);
    for (const k of ["turn_at", "read_at", "pending", "state", "usage"])
      assert.equal(p[k], undefined);
    assert.deepEqual(s.disk_only, []);
    const probe = await entrance(dir);
    assert.equal(probe.welcome.sessions, 1);
    probe.close();
    const human = status(dir);
    assert.equal(human.status, 0);
    assert.match(human.stdout, /status-place/);
    assert.match(human.stdout, /последний вызов графа/);
    await rpc(link, "iskron/usage", { tokens: 42, context: 20, window: 100 }, 3);
    const withUsage = JSON.parse(status(dir, ["--json"]).stdout);
    assert.equal(withUsage.sessions[0].places[0].usage.tokens, 42);
    assert.equal(withUsage.sessions[0].places[0].last_work_at, p.last_work_at);
    satellite = await connectSeam(
      seamSocketPath(dir),
      helloFrame({
        build: "v7.9.0+sat",
        path: BRIDGE,
        argv: [fake.mcpUrl, "--auth-dir", dir, "--satellite"],
        patSha: patShaOf("status-pat"),
      }),
      3000,
    );
    await rpc(
      satellite,
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "claude-code", version: "0" },
      },
      1,
    );
    const sat = await rpc(
      satellite,
      "tools/call",
      {
        name: "iskron_stand",
        arguments: { realm: "nks-dev", karta: 931, satellite_of: "@tester:status-place" },
      },
      2,
    );
    assert.ok(!sat.result?.isError, JSON.stringify(sat));
    const both = JSON.parse(status(dir, ["--json"]).stdout);
    assert.equal(both.sessions.length, 2);
    const child = both.sessions.find((s) => s.local_id === satellite.welcome.session);
    assert.equal(child.places[0].satellite_of, "@tester:status-place");
    assert.equal(child.places[0].listening, false);
    assert.equal(child.places[0].usage, undefined);
    const snapshotOnly = await connectSeam(
      seamSocketPath(dir),
      {
        ...helloFrame({ build: "test", path: "", argv: [] }),
        snapshot: true,
      },
      3000,
    );
    assert.equal(snapshotOnly.welcome.session, null);
    assert.equal(snapshotOnly.welcome.snapshot.sessions.length, 2);
    snapshotOnly.close();
  } finally {
    link?.close();
    satellite?.close();
    const exited = new Promise((r) => d.once("exit", r));
    d.kill("SIGKILL");
    await exited;
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
