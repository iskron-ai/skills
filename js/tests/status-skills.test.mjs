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
