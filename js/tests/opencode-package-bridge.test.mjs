import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { plugin, SANDBOX, until } from "./opencode-kit.mjs";

const fake = new URL("./fake-bridge.mjs", import.meta.url);
const adjacent = join(realpathSync(SANDBOX), "iskron.mjs");
const home = join(SANDBOX, ".iskron-bridge", "iskron-bridge.mjs");

test("package bridge: env precedes adjacent, adjacent precedes home; missing candidates refuse", async () => {
  mkdirSync(join(SANDBOX, ".iskron-bridge"), { recursive: true });
  const env = join(SANDBOX, "explicit.mjs");
  copyFileSync(fake, env);
  copyFileSync(fake, adjacent);
  copyFileSync(fake, home);
  const chosen = async (override, expected) => {
    const rec = await plugin({ ISKRON_BRIDGE_PATH: override });
    try {
      await until(() => rec.tools().size > 1, "selected bridge tools", 8000);
      const result = await rec.tools().get("iskron_bridge").execute({}, { sessionID: "package" });
      assert.ok(JSON.stringify(result).includes(expected), JSON.stringify(result));
    } finally {
      await rec.stop();
    }
  };
  try {
    await chosen(env, env);
    await chosen("", adjacent);
    await chosen(join(SANDBOX, "absent.mjs"), adjacent);
    await chosen(SANDBOX, adjacent);
    rmSync(adjacent);
    mkdirSync(adjacent);
    await chosen("", home);
    rmSync(adjacent, { recursive: true });
    await chosen("", home);
    rmSync(home);
    const rec = await plugin({ ISKRON_BRIDGE_PATH: "" });
    try {
      assert.deepEqual([...rec.tools().keys()], []);
      assert.ok(rec.said().includes(adjacent), rec.said());
      assert.ok(rec.said().includes(home), rec.said());
    } finally {
      await rec.stop();
    }
  } finally {
    for (const p of [env, adjacent, home]) rmSync(p, { recursive: true, force: true });
  }
});
