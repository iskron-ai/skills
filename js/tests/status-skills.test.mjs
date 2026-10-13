import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { connectSeam, helloFrame, patShaOf } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { startFakeNks } from "./fake-nks.mjs";
import { BRIDGE, entrance, env, NODE, rpc, status } from "./status-kit.mjs";

test("changed installed skills ride the next usage register without connect or changed usage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "status-skills-"));
  const root = join(dir, "set", "skills");
  mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
  writeFileSync(join(root, "establish-mcp", "scripts", "iskron.mjs"), 'const VERSION = "7.9.0";');
  const lock = join(root, "..", ".skill-lock.json");
  const change = (hash) =>
    writeFileSync(
      lock,
      JSON.stringify({
        skills: {
          "establish-mcp": { source: "iskron-ai/skills", skillFolderHash: hash },
        },
      }),
    );
  change("before");
  const fake = await startFakeNks({ pat: "status-pat" });
  const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: { ...env, ISKRON_USAGE_GAP_MS: "1000" },
    stdio: "ignore",
  });
  let link;
  try {
    (await entrance(dir)).close();
    const hello = helloFrame({
      build: "v7.9.0+test",
      path: BRIDGE,
      argv: [fake.mcpUrl, "--auth-dir", dir],
      patSha: patShaOf("status-pat"),
    });
    hello.env.ISKRON_SKILLS_ROOT = root;
    link = await connectSeam(seamSocketPath(dir), hello, 3000);
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
      { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name: "skills-place" } },
      2,
    );
    assert.ok(!stood.result?.isError);
    const usage = { tokens: 100, context: 10, window: 100 };
    assert.equal((await rpc(link, "iskron/usage", usage, 3)).result.pushed, true);
    const before = fake.state.placeArgs.filter((a) => a.action === "register").at(-1).attrs.skills;
    const connects = fake.state.counts.connect;
    const registered = fake.state.placeArgs.filter((a) => a.action === "register").length;
    change("after");
    assert.equal(
      (await rpc(link, "iskron/usage", usage, 4)).result.pushed,
      false,
      "cooldown still holds",
    );
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(
      (await rpc(link, "iskron/usage", usage, 5)).result.pushed,
      true,
      "changed skills trigger the register even with identical usage",
    );
    const after = fake.state.placeArgs.filter((a) => a.action === "register").at(-1).attrs.skills;
    assert.notEqual(after.stamp, before.stamp);
    assert.equal(
      fake.state.placeArgs.filter((a) => a.action === "register").length,
      registered + 1,
    );
    assert.equal(fake.state.counts.connect, connects);
    const snapshot = JSON.parse(status(dir, ["--json"]).stdout);
    assert.deepEqual(snapshot.sessions[0].skills, after);
    const human = status(dir);
    assert.match(human.stdout, new RegExp(`skills=iskron-ai/skills 7\\.9\\.0\\+${after.stamp}`));
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal(
      (await rpc(link, "iskron/usage", usage, 6)).result.pushed,
      false,
      "unchanged stamp and usage do not repeat register",
    );
  } finally {
    link?.close();
    const exited = new Promise((r) => d.once("exit", r));
    d.kill("SIGKILL");
    await exited;
    await fake.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const inspectDrift of [false, true])
  test(`Claude Code refreshes skills without usage; inspect drift=${inspectDrift}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "status-skills-cc-"));
    const root = join(dir, "set", "skills");
    mkdirSync(join(root, "establish-mcp", "scripts"), { recursive: true });
    writeFileSync(join(root, "establish-mcp", "scripts", "iskron.mjs"), 'const VERSION = "7.9.0";');
    const lock = join(root, "..", ".skill-lock.json");
    const change = (hash) =>
      writeFileSync(
        lock,
        JSON.stringify({
          skills: {
            "establish-mcp": { source: "iskron-ai/skills", skillFolderHash: hash },
          },
        }),
      );
    change("before");
    const fake = await startFakeNks({ pat: "status-pat" });
    const d = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
      env: { ...env, ISKRON_SKILLS_GAP_MS: "1000" },
      stdio: "ignore",
    });
    let link;
    try {
      (await entrance(dir)).close();
      const hello = helloFrame({
        build: "v7.9.0+test",
        path: BRIDGE,
        argv: [fake.mcpUrl, "--auth-dir", dir],
        patSha: patShaOf("status-pat"),
      });
      hello.env.ISKRON_SKILLS_ROOT = root;
      link = await connectSeam(seamSocketPath(dir), hello, 3000);
      await rpc(
        link,
        "initialize",
        {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "claude-code", version: "2.1" },
        },
        1,
      );
      await rpc(
        link,
        "tools/call",
        {
          name: "iskron_stand",
          arguments: {
            realm: "nks-dev",
            karta: 931,
            name: "cc-skills",
          },
        },
        2,
      );
      const before = fake.state.placeArgs.filter((a) => a.action === "register").at(-1)
        .attrs.skills;
      const beside = await rpc(
        link,
        "tools/call",
        {
          name: "iskron_stand",
          arguments: { realm: "@nks/other", karta: 931, name: "cc-beside" },
        },
        20,
      );
      assert.ok(!beside.result?.isError, JSON.stringify(beside));
      const connects = fake.state.counts.connect;
      change("after");
      if (inspectDrift) {
        const drift = JSON.parse(status(dir, ["--json"]).stdout).sessions[0];
        assert.deepEqual(
          drift.skills,
          before,
          "status reports the accepted declaration, not fresh disk",
        );
        assert.notEqual(drift.installed_skills.stamp, before.stamp);
        assert.equal(drift.skills_mismatch, true);
      }
      await new Promise((r) => setTimeout(r, 1100));
      await rpc(
        link,
        "tools/call",
        { name: "iskron_look", arguments: { realm: "nks-dev", node_id: "1" } },
        3,
      );
      const after = fake.state.placeArgs.filter((a) => a.action === "register").at(-1).attrs.skills;
      assert.notEqual(after.stamp, before.stamp, "non-hosted client refreshes without usage");
      assert.equal(fake.state.counts.connect, connects);
      const fresh = JSON.parse(status(dir, ["--json"]).stdout).sessions[0];
      assert.deepEqual(fresh.skills, after);
      assert.deepEqual(fresh.installed_skills, after);
      assert.equal(fresh.skills_mismatch, false);
      assert.equal(fresh.places.length, 2);
      for (const place of fresh.places) {
        assert.deepEqual(place.skills, after);
        assert.equal(place.skills_mismatch, false);
      }
      const registered = fake.state.placeArgs.filter((a) => a.action === "register").length;
      await new Promise((r) => setTimeout(r, 1100));
      await rpc(
        link,
        "tools/call",
        { name: "iskron_look", arguments: { realm: "nks-dev", node_id: "1" } },
        4,
      );
      assert.equal(
        fake.state.placeArgs.filter((a) => a.action === "register").length,
        registered,
        "unchanged disk does not register again",
      );
      if (inspectDrift) {
        change("third");
        fake.state.standingRefuseNext = 1;
        await new Promise((r) => setTimeout(r, 1100));
        await rpc(
          link,
          "tools/call",
          { name: "iskron_look", arguments: { realm: "nks-dev", node_id: "1" } },
          5,
        );
        const partial = JSON.parse(status(dir, ["--json"]).stdout).sessions[0];
        assert.deepEqual(partial.skills, after, "refused register leaves the declaration intact");
        assert.equal(partial.skills_mismatch, true);
        assert.equal(partial.places.find((p) => !p.primary).skills_mismatch, false);
        await new Promise((r) => setTimeout(r, 1100));
        await rpc(
          link,
          "tools/call",
          { name: "iskron_look", arguments: { realm: "nks-dev", node_id: "1" } },
          6,
        );
        const retried = JSON.parse(status(dir, ["--json"]).stdout).sessions[0];
        assert.equal(retried.skills_mismatch, false, "unchanged disk retries a refused register");
      }
    } finally {
      link?.close();
      const exited = new Promise((r) => d.once("exit", r));
      d.kill("SIGKILL");
      await exited;
      await fake.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
