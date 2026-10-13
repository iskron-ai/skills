import assert from "node:assert/strict";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { serverProtocol } from "../delivery/index.ts";
import { fixture, refreshSkills, runUsage, state } from "./skillrefresh-kit.mjs";

const gone = () => ({
  isError: true,
  _meta: { [serverProtocol.refusal]: { rule: "standing_not_held", status: 422 } },
  content: [],
});

for (const beside of [false, true])
  test(`gone register cannot forget a replacement ${beside ? "beside" : "primary"}`, async () => {
    await fixture(async (kit) => {
      const old = { realm: "r6", karta: "931", name: "beside" };
      if (beside) state.places = [old];
      let replacement;
      kit.answer = async (msg) => {
        if (beside && msg.params.arguments.name !== old.name) return { content: [] };
        replacement = { ...(beside ? old : state.standing) };
        if (beside) state.places = [replacement];
        else state.standing = replacement;
        return gone();
      };
      await refreshSkills();
      assert.equal(beside ? state.places[0] : state.standing, replacement);
    });
  });

for (const missing of ["file", "skill", "root"])
  test(`refresh defers transient missing ${missing} and retries the restored set`, async () => {
    await fixture(async ({ root, calls }) => {
      const now = Date.now;
      let clock = now();
      Date.now = () => clock;
      const path =
        missing === "root"
          ? root
          : missing === "skill"
            ? join(root, "establish-mcp")
            : join(root, "establish-mcp", "scripts", "iskron.mjs");
      try {
        await refreshSkills();
        const before = calls.length;
        renameSync(path, `${path}.away`);
        clock += 120_000;
        await refreshSkills();
        assert.equal(calls.length, before, "transient disappearance must not register unknown");
        if (missing !== "root") {
          clock += 120_000;
          await refreshSkills();
          assert.equal(calls.length, before, "a surviving root is still an incomplete update");
        }
        renameSync(`${path}.away`, path);
        writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after");
        clock += 120_000;
        await refreshSkills();
        assert.equal(calls.length, before + 1, "the restored changed set is retried");
        assert.ok(calls.every((c) => c.attrs.skills.version !== "unknown"));
      } finally {
        Date.now = now;
      }
    });
  });

test("two consecutive checks of a removed root declare unknown once", async () => {
  await fixture(async ({ root, calls }) => {
    const now = Date.now;
    let clock = now();
    Date.now = () => clock;
    try {
      await refreshSkills();
      const before = calls.length;
      renameSync(root, `${root}.away`);
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

test("usage does not register unknown when the first disk check finds an incomplete update", async () => {
  await fixture(async ({ root, calls }) => {
    state.initParams = { clientInfo: { name: "pi-iskron" } };
    const msg = { id: 1, method: "iskron/usage", params: { tokens: 100 } };
    await runUsage(msg); // Changed usage sends before the watcher's first disk check.
    const before = calls.length;
    renameSync(join(root, "establish-mcp"), join(root, "establish-mcp.away"));
    const now = Date.now;
    Date.now = () => now() + 120_000;
    try {
      await runUsage(msg);
      assert.ok(calls.every((c) => c.attrs?.skills?.version !== "unknown"));
      assert.equal(calls.length, before);
    } finally {
      Date.now = now;
    }
  });
});
