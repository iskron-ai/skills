import assert from "node:assert/strict";
import { test } from "node:test";

import { serverProtocol } from "../delivery/index.ts";
import { fixture, refreshSkills, serialized, state } from "./skillrefresh-kit.mjs";

test("refresh snapshots places inside the seat-move serialization", async () => {
  await fixture(async ({ calls }) => {
    let release;
    const barrier = new Promise((r) => (release = r));
    const move = serialized(async () => {
      await barrier;
      state.standing = { ...state.standing, name: "new" };
    });
    const refresh = refreshSkills();
    await new Promise((r) => setTimeout(r, 30));
    release();
    await Promise.all([move, refresh]);
    assert.deepEqual(
      calls.map((a) => a.name),
      ["new"],
    );
  });
});

test("refresh forgets a gone primary instead of registering it every minute", async () => {
  await fixture(async (kit) => {
    kit.answer = async () => ({
      isError: true,
      _meta: { [serverProtocol.refusal]: { rule: "standing_not_held", status: 422 } },
      content: [],
    });
    await refreshSkills();
    assert.equal(state.standing, null);
    assert.equal(kit.calls.length, 1);
  });
});

test("refresh forgets a gone beside place without dropping the primary", async () => {
  await fixture(async (kit) => {
    state.places = [{ realm: "r6", karta: "931", name: "beside" }];
    kit.answer = async (msg) =>
      msg.params.arguments.name === "beside"
        ? {
            isError: true,
            _meta: { [serverProtocol.refusal]: { rule: "standing_not_held", status: 422 } },
            content: [],
          }
        : { content: [] };
    await refreshSkills();
    assert.equal(state.standing.name, "old");
    assert.deepEqual(state.places, []);
  });
});
