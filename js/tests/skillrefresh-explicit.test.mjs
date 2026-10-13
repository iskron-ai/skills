import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { fixture, skillsAttr, state, withPlaceFields } from "./skillrefresh-kit.mjs";

const source = process.env.ISKRON_REFRESH_SOURCE || resolve("js");
const { sessionSnapshot } = await import(join(source, "bridge/snapshot.ts"));
const { H } = await import(join(source, "bridge/holdstate.ts"));
const { placeFields, rememberUsage, noteSatelliteOf } = await import(
  join(source, "bridge/placefields.ts")
);
const { skillsNeedRegister } = await import(join(source, "bridge/skillwatch.ts"));

for (const action of ["connect", "mint", "register"])
  test(`explicit ${action} reads changed skills inside the background window`, async () => {
    await fixture(async ({ root }) => {
      const args = { ...state.standing, action };
      const before = withPlaceFields(args).attrs.skills;
      writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after");
      const after = withPlaceFields(args).attrs.skills;
      assert.notEqual(after.stamp, before.stamp);
      assert.deepEqual(after, skillsAttr());
      rmSync(join(root, "establish-mcp", "scripts", "iskron.mjs"));
      assert.deepEqual(
        withPlaceFields(args).attrs.skills,
        after,
        "first missing check keeps settled set",
      );
    });
  });

test("stand fields read changed skills inside the background window", async () => {
  await fixture(async ({ root }) => {
    const before = placeFields(state.standing).attrs.skills;
    writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after");
    assert.notEqual(placeFields(state.standing).attrs.skills.stamp, before.stamp);
  });
});

for (const missing of [false, true])
  test(`status leaves the skills observer unchanged; missing=${missing}`, async () => {
    await fixture(async ({ root, scope }) => {
      placeFields(state.standing);
      rememberUsage({ tokens: 123 });
      noteSatelliteOf("parent", null);
      H.holder = { alive: true };
      H.currentKey = "test";
      H.door = { key: "test", clients: new Set([{}]) };
      const watcher = [...scope.slots.values()].find((s) => s?.announced instanceof Map);
      const now = Date.now;
      Date.now = () => now() + 120_000;
      try {
        if (missing) rmSync(root, { recursive: true });
        else writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after");
        const before = structuredClone(watcher);
        const snapshot = sessionSnapshot("test", { lastWork: () => 0 }, 1, true, "test");
        assert.deepEqual(
          watcher,
          before,
          "status must not check, consume pending, or count absence",
        );
        assert.equal(snapshot.places[0].usage.tokens, 123);
        assert.equal(snapshot.places[0].satellite_of, "parent");
        assert.equal(
          skillsNeedRegister(state.standing),
          !missing,
          "the next tool still checks disk",
        );
      } finally {
        Date.now = now;
      }
    });
  });
