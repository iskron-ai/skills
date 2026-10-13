import assert from "node:assert/strict";
import { test } from "node:test";

import { rpc } from "./status-kit.mjs";
import { registers, settled, skillsDaemon, wait } from "./status-skills-kit.mjs";

test("slow refresh registers do not delay the agent tool response", async () => {
  await skillsDaemon("claude-code", async ({ fake, link, change }) => {
    change("after");
    await wait();
    fake.state.standingRegisterDelayMs = 900;
    const before = registers(fake).length;
    const start = Date.now();
    await rpc(
      link,
      "tools/call",
      { name: "iskron_look", arguments: { realm: "nks-dev", node_id: "1" } },
      3,
    );
    assert.ok(Date.now() - start < 600, "the tool waited for a 900ms register");
    await settled(fake, before + 1);
    await wait(950);
  });
});
