// Built OpenCode plugin exclusion of blocking questionnaires (#10397).
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, test } from "node:test";

import { plugin, SANDBOX } from "./opencode-kit.mjs";

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

test("OpenCode: removes question on registry replay and denies direct permission checks; graph ask survives", async () => {
  const rec = await plugin(
    { ISKRON_ROOT_SEAT: "0" },
    { initialTools: [{ name: "question" }, { name: "iskron_case" }, { name: "read" }] },
  );
  try {
    assert.equal(rec.tools().has("question"), false);
    await rec.ctx.tool.reload();
    assert.equal(rec.tools().has("question"), false);
    assert.equal(rec.tools().has("iskron_case"), true);
    for (const effect of ["allow", "ask"])
      assert.equal(await rec.ask("question", {}, "question", ["*"], effect), "deny");
    assert.equal(await rec.ask("iskron_case", {}, "iskron_case", ["*"], "allow"), "allow");
  } finally {
    await rec.stop();
  }
});
