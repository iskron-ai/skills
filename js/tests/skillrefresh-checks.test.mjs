import assert from "node:assert/strict";
import fs, { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  fixture,
  refreshSkills,
  runUsage,
  skillsAttr,
  skillsRoot,
  state,
} from "./skillrefresh-kit.mjs";

const source = process.env.ISKRON_REFRESH_SOURCE || resolve("js");
const { sessionSnapshot } = await import(join(source, "bridge/snapshot.ts"));
const { H } = await import(join(source, "bridge/holdstate.ts"));

test("a session without a declaration has no skills mismatch", async () => {
  await fixture(async () => {
    state.standing = null;
    const snapshot = sessionSnapshot("test", { lastWork: () => 0 }, 1, true, "test");
    assert.equal(snapshot.skills_mismatch, false);
  });
});

test("own layout precedes plugin and disappears without selecting the plugin", async () => {
  await fixture(async ({ dir, root, scope }) => {
    const plugin = join(dir, "plugin");
    mkdirSync(join(plugin, "skills", "establish-mcp", "scripts"), { recursive: true });
    writeFileSync(join(plugin, "skills", "establish-mcp", "scripts", "iskron.mjs"), "plugin");
    delete scope.origin.env.ISKRON_SKILLS_ROOT;
    scope.origin.env.CLAUDE_PLUGIN_ROOT = plugin;
    scope.origin.path = join(root, "establish-mcp", "scripts", "iskron.mjs");
    assert.equal(skillsRoot(), root);
    rmSync(root, { recursive: true });
    assert.equal(skillsRoot(), null);
    assert.equal(skillsAttr().version, "unknown");
  });
});

for (const mode of ["tree", "lock", "missing"])
  test(`unchanged usage shares disk checks (${mode})`, async () => {
    await fixture(async ({ root, scope }) => {
      const missing = mode === "missing";
      if (mode === "lock")
        writeFileSync(
          join(root, "..", ".skill-lock.json"),
          JSON.stringify({
            skills: { "establish-mcp": { source: "iskron-ai/skills", skillFolderHash: "before" } },
          }),
        );
      state.initParams = { clientInfo: { name: "pi-iskron" } };
      const msg = { id: 1, method: "iskron/usage", params: { tokens: 100 } };
      await runUsage(msg);
      if (missing) rmSync(root, { recursive: true });
      const logs = [];
      scope.log = (line) => logs.push(line);
      const now = Date.now;
      const read = fs.readFileSync;
      let clock = now() + 120_000;
      let reads = 0;
      Date.now = () => clock;
      fs.readFileSync = (...args) => {
        if (String(args[0]).startsWith(root) || String(args[0]).endsWith(".skill-lock.json"))
          reads++;
        return read(...args);
      };
      syncBuiltinESMExports();
      try {
        await runUsage(msg);
        const first = reads;
        for (let i = 0; i < 5; i++) {
          clock += 120_000;
          await runUsage(msg);
          await refreshSkills();
        }
        assert.equal(reads, first, "no fingerprint or lock reads after the first check");
        assert.equal(
          logs.filter((line) => /skills.*missing|missing.*skills/.test(line)).length,
          missing ? 1 : 0,
        );
      } finally {
        Date.now = now;
        fs.readFileSync = read;
        syncBuiltinESMExports();
      }
    });
  });

test("a deaf seat retries refresh after hearing returns without another disk change", async () => {
  await fixture(async ({ calls }) => {
    const before = H.unheard;
    const now = Date.now;
    let clock = now();
    Date.now = () => clock;
    try {
      H.unheard = true;
      await refreshSkills(); // the unreadable board must prevent register
      assert.equal(calls.filter((a) => a.action === "register").length, 0);
      H.unheard = false;
      clock += 120_000;
      await refreshSkills();
      assert.equal(calls.filter((a) => a.action === "register").length, 1);
    } finally {
      H.unheard = before;
      Date.now = now;
    }
  });
});
