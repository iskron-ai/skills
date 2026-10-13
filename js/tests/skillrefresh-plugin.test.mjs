import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fixture, refreshSkills, skillsAttr, skillsRoot } from "./skillrefresh-kit.mjs";

test("plugin refresh is explicitly excluded, not an old-version disk watcher", async () => {
  await fixture(async ({ dir, root, scope, calls }) => {
    scope.origin.env.CLAUDE_PLUGIN_ROOT = dir;
    writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after");
    await refreshSkills();
    assert.equal(calls.length, 0);
  });
});

test("removed plugin root cannot switch to a flat set and reports the missing root", async () => {
  await fixture(async ({ dir, root, scope }) => {
    scope.origin.env.CLAUDE_PLUGIN_ROOT = dir;
    skillsAttr();
    const logs = [];
    scope.log = (line) => logs.push(line);
    rmSync(root, { recursive: true });
    assert.equal(skillsRoot(), null);
    assert.equal(skillsAttr().version, "unknown");
    assert.ok(logs.some((line) => /skills.*missing|missing.*skills/.test(line)));
  });
});
