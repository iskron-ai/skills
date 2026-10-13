import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

import { fixture, state, withPlaceFields } from "./skillrefresh-kit.mjs";

const source = process.env.ISKRON_REFRESH_SOURCE || resolve("js");
const { placeFields } = await import(join(source, "bridge/placefields.ts"));
const { replayRegister } = await import(join(source, "bridge/standing.ts"));

for (const removedBeforeConnect of [false, true])
  test(`connect/register absence waits a full window; removed before connect=${removedBeforeConnect}`, async () => {
    await fixture(async ({ root }) => {
      const now = Date.now;
      let clock = now();
      Date.now = () => clock;
      try {
        const args = { ...state.standing, action: "connect" };
        const settled = withPlaceFields(args).attrs.skills;
        const remove = () => rmSync(join(root, "establish-mcp", "scripts", "iskron.mjs"));
        if (removedBeforeConnect) remove();
        assert.deepEqual(withPlaceFields(args).attrs.skills, settled);
        if (!removedBeforeConnect) remove();
        args.action = "register";
        assert.deepEqual(withPlaceFields(args).attrs.skills, settled);
        clock += 59_999;
        assert.deepEqual(withPlaceFields(args).attrs.skills, settled);
        clock += 1;
        assert.equal(withPlaceFields(args).attrs.skills.version, "unknown");
      } finally {
        Date.now = now;
      }
    });
  });

for (const path of ["fields", "replay"])
  test(`automatic ${path} respects the background window`, async () => {
    await fixture(async ({ root, calls }) => {
      const now = Date.now;
      let clock = now();
      Date.now = () => clock;
      try {
        const settled = withPlaceFields({ ...state.standing, action: "connect" }).attrs.skills;
        writeFileSync(join(root, "establish-mcp", "SKILL.md"), "after");
        const read = async () => {
          if (path === "fields") return placeFields(state.standing).attrs.skills;
          await replayRegister(state.standing);
          return calls.at(-1).attrs.skills;
        };
        assert.deepEqual(await read(), settled);
        clock += 60_000;
        assert.notEqual((await read()).stamp, settled.stamp);
      } finally {
        Date.now = now;
      }
    });
  });
