// Built plugin + built bridge over isolated fake MCP and OpenCode hooks (#10121).
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";

import { delay, plugin, REAL_BRIDGE, SANDBOX, until } from "./opencode-kit.mjs";
import { setup } from "./ownseat-kit.mjs";

process.on("exit", () => rmSync(SANDBOX, { recursive: true, force: true }));

test("context gate: OpenCode preserves adjacent fill samples and observes successful own skill loads", async (t) => {
  const { fake, cwd } = await setup(t);
  fake.state.richTools = true;
  fake.state.kartaSkills = { 931: "iskron,writing" };
  const rec = await plugin(
    {
      ISKRON_BRIDGE_PATH: REAL_BRIDGE,
      ISKRON_BRIDGE_URL: fake.mcpUrl,
      ISKRON_BRIDGE_TOKEN: "nks_pat_stand",
      ISKRON_BRIDGE_DAEMON: "0",
      ISKRON_BRIDGE_NO_UPDATE: "1",
    },
    { location: { directory: cwd }, sessions: [{ id: "s", location: { directory: cwd } }] },
  );
  try {
    await until(() => rec.tools().has("iskron_stand"), "stand tool");
    await rec.call("iskron_stand", { realm: "nks-dev", karta: "931", name: "fill-probe" }, "s");
    const listModels = rec.ctx.model.list;
    let releaseWindows;
    rec.ctx.model.list = () =>
      new Promise((r) => {
        releaseWindows = r;
      });
    rec.emit({
      type: "session.step.started",
      data: { sessionID: "s", model: { id: "m1", providerID: "p" } },
    });
    const steps = (input) =>
      rec.emit({
        type: "session.step.ended",
        data: {
          sessionID: "s",
          tokens: { input, cache: { read: 0, write: 0 } },
        },
      });
    const before = fake.state.counts.look ?? 0;
    steps(160000);
    steps(30000);
    await until(() => releaseWindows, "model metadata read held");
    assert.equal(
      await Promise.race([
        rec.call("iskron_orient", { realm: "nks-dev" }, "s").then(() => true),
        delay(1000).then(() => false),
      ]),
      true,
      "graph reads do not wait for the fill queue/model metadata",
    );
    releaseWindows(await listModels());
    await until(
      () => (fake.state.counts.look ?? 0) > before,
      "collapse reaches bridge without debounce",
    );
    const write = () => rec.call("iskron_add_vimarsha", { realm: "nks-dev", name: "probe" }, "s");
    await assert.rejects(write(), /контекст сжат|context.*compact/i);
    await rec.context("s");
    await assert.rejects(
      write(),
      /контекст сжат|context.*compact/i,
      "system injection is not recovery",
    );
    const skill = async (id, name, sessionID = "s", status = "completed") => {
      const call = {
        tool: "skill",
        sessionID,
        agent: "build",
        messageID: "m",
        id,
        input: { id: name },
      };
      for (const cb of rec.hooks["tool.execute.before"] ?? []) await cb(call);
      for (const cb of rec.hooks["tool.execute.after"] ?? [])
        await cb({ ...call, status, result: { content: "loaded" } });
    };
    await skill("foreign", "iskron", "other");
    await skill("failed", "iskron", "s", "error");
    await skill("w", "writing");
    await assert.rejects(write(), /контекст сжат|context.*compact/i);
    await skill("door", "iskron");
    await write();
    const looked = fake.state.counts.look;
    steps(1000);
    await until(() => fake.state.counts.look > looked, "another collapse");
    await assert.rejects(write(), /контекст сжат|context.*compact/i);
    fake.state.realms.push({ short: "r888", canon: "@nks/nks-dev", ownerKind: "organization" });
    fake.state.realmDelayMs = 300;
    const listings = fake.state.counts.realm_list;
    const confirming = rec
      .call("iskron_stand", { realm: "r888", context_restored: true }, "s")
      .then(
        () => null,
        (e) => e,
      );
    await until(() => fake.state.counts.realm_list > listings, "confirmation awaiting alias");
    const previousGeneration = fake.state.counts.look;
    steps(100);
    await until(
      () => fake.state.counts.look > previousGeneration,
      "new generation during confirmation",
    );
    assert.ok(
      (await confirming) instanceof Error,
      "old confirmation cannot clear the new generation",
    );
    await assert.rejects(write(), /контекст сжат|context.*compact/i);
    fake.state.realmDelayMs = 0;
    const registers = fake.state.placeArgs.filter((p) => p.action === "register").length;
    await rec.call("iskron_stand", { realm: "nks-dev", context_restored: true }, "s");
    await write();
    assert.equal(
      fake.state.placeArgs.filter((p) => p.action === "register").length,
      registers,
      "plugin confirmation is local too, not a new stand",
    );
  } finally {
    await rec.stop();
    await until(() => fake.state.sessions.size === 0, "isolated bridge closed its MCP session");
  }
});
