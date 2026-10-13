import assert from "node:assert/strict";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  fixture,
  refreshSkills,
  runUsage,
  skillsRoot,
  state,
  withPlaceFields,
} from "./skillrefresh-kit.mjs";

for (const checked of [false, true])
  test(`changed usage keeps settled skills during installation (${checked ? "refresh" : "usage"})`, async () => {
    await fixture(async ({ root, calls }) => {
      state.initParams = { clientInfo: { name: "pi-iskron" } };
      const now = Date.now;
      let clock = now();
      Date.now = () => clock;
      try {
        if (checked) await refreshSkills();
        else await runUsage({ id: 1, method: "iskron/usage", params: { tokens: 100 } });
        const previous = calls.at(-1).attrs.skills;
        const before = calls.length;
        renameSync(join(root, "establish-mcp"), join(root, "establish-mcp.away"));
        clock += 120_000;
        await runUsage({ id: 2, method: "iskron/usage", params: { tokens: 10_000 } });
        assert.equal(calls.length, before + 1, "changed usage must still publish");
        assert.deepEqual(calls.at(-1).attrs.skills, previous);
      } finally {
        Date.now = now;
      }
    });
  });

for (const action of ["connect", "mint", "register"])
  test(`${action} keeps an accepted declaration before the first check of an incomplete set`, async () => {
    await fixture(async ({ root }) => {
      assert.equal(skillsRoot(), root);
      renameSync(join(root, "establish-mcp"), join(root, "establish-mcp.away"));
      assert.deepEqual(withPlaceFields({ ...state.standing, action }).attrs.skills, {
        name: "iskron-ai/skills",
        version: "7.9.0",
        stamp: "before",
      });
    });
  });

for (const missing of ["file", "skill"])
  test(`two consecutive checks of removed bridge ${missing} declare unknown once`, async () => {
    await fixture(async ({ root, calls }) => {
      const now = Date.now;
      let clock = now();
      Date.now = () => clock;
      try {
        await refreshSkills();
        const before = calls.length;
        const path =
          missing === "skill"
            ? join(root, "establish-mcp")
            : join(root, "establish-mcp", "scripts", "iskron.mjs");
        renameSync(path, `${path}.away`);
        clock += 120_000;
        await refreshSkills();
        assert.equal(calls.length, before);
        clock += 120_000;
        await refreshSkills();
        assert.equal(calls.length, before + 1);
        assert.equal(calls.at(-1).attrs.skills.version, "unknown");
        clock += 120_000;
        await refreshSkills();
        assert.equal(calls.length, before + 1);
      } finally {
        Date.now = now;
      }
    });
  });
