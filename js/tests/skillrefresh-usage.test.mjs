import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fixture, refreshSkills, runUsage, state } from "./skillrefresh-kit.mjs";

test("usage does not register skills again after refresh already declared them", async () => {
  await fixture(async ({ root, calls }) => {
    state.initParams = { clientInfo: { name: "pi-iskron" } };
    const msg = {
      id: 1,
      method: "iskron/usage",
      params: { tokens: 100, context: 10, window: 100 },
    };
    await runUsage(msg);
    const now = Date.now;
    Date.now = () => now() + 120_000;
    try {
      writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after");
      await refreshSkills();
      const count = calls.length;
      assert.equal((await runUsage(msg)).result.pushed, false);
      assert.equal(calls.length, count);
    } finally {
      Date.now = now;
    }
  });
});
