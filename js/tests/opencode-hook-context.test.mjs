// The built plugin must not persist its own words as the human's prompt
// (graph @nks/nks-dev, #9341; OpenCode 2.2.5 surface #9867).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createHalts } from "../opencode/halts.ts";
import { createEnds } from "../opencode/leadends.ts";
import { delay, plugin, SANDBOX } from "./opencode-kit.mjs";

const env = {
  ISKRON_BRIDGE_PATH: fileURLToPath(new URL("./fake-bridge.mjs", import.meta.url)),
  FB_TOOLS: JSON.stringify([{ name: "iskron_stand", inputSchema: { type: "object" } }]),
};

test("launch word is in the first primary system, never in the persisted prompt", async () => {
  const rec = await plugin(env, {
    sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
  });
  try {
    const input =
      "You are a subagent spawned by another session.\nstart r5 931 дело №77\n  brief\r\n";
    assert.equal(await rec.promptRaw("child", input), input);
    const request = (sessionID) => ({ sessionID, system: [], messages: rec.messages(sessionID) });
    const compact = request("child");
    for (const cb of rec.hooks.compaction ?? []) await cb(compact);
    assert.equal(compact.system.length, 0, "compaction must not eat the pending launch word");
    const foreign = request("root");
    for (const cb of rec.hooks.context ?? []) await cb(foreign);
    assert.equal(foreign.system.length, 0, "a child's word cannot reach its root");
    const first = request("child");
    for (const cb of rec.hooks.context ?? []) await cb(first);
    assert.match(first.system.map((p) => p.text).join("\n"), /не встал|not seated/);
    const repeat = request("child");
    for (const cb of rec.hooks.context ?? []) await cb(repeat);
    assert.equal(repeat.system.length, 0, "one shot, not every model step");
    assert.deepEqual(rec.prompts, [], "no extra inbox or model step");
  } finally {
    await rec.stop();
  }
});

for (const end of ["deleted", "unload", "stopped", "ended"]) {
  test(`pending launch is suppressed after ${end}`, async () => {
    const rec = await plugin(env, {
      sessions: [{ id: "root" }, { id: "child", parentID: "root" }],
    });
    try {
      const text = "start r5 931 дело №77";
      assert.equal(await rec.promptRaw("child", text), text);
      if (end === "deleted") {
        rec.emit({ type: "session.deleted", data: { sessionID: "child" } });
        await delay(30);
      } else if (end === "unload") await rec.stop();
      else if (end === "ended")
        createEnds(
          () => `${SANDBOX}/.iskron-bridge`,
          () => {},
          () => {},
        ).end("child");
      else
        createHalts(
          () => undefined,
          () => `${SANDBOX}/.iskron-bridge`,
          () => {},
          () => {},
        ).stop("child", "CONTEXT_OWNER_STOP");
      const system = await rec.context("child");
      if (end === "stopped") {
        assert.match(system, /CONTEXT_OWNER_STOP/);
        assert.ok(!system.includes("место родителя неизвестно"), system);
      } else assert.equal(system, "", "closed sessions get no pending word");
      assert.deepEqual(rec.prompts, [], "no extra model turn");
    } finally {
      if (end !== "unload") await rec.stop();
    }
  });
}
