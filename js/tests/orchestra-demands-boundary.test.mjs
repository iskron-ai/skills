import assert from "node:assert/strict";
import { test } from "node:test";

import { fixture } from "./demands-fixture.mjs";

// GET /realms shape: nks-api 0.130, graph #8202; realmindex.ts.
const realms = { items: [{ short_id: 5, owner_handle: "probe", slug: "one" }] };
const empty = { body: { items: [] } };

test("demands: canonical request recognizes the short spelling of its held boundary", async () => {
  const order = {
    id: "stop-one",
    seq: 1,
    karta_seq: 1,
    standing_id: "seat-one",
    realm: "@probe/one",
    state: "issued",
  };
  const f = await fixture(
    (path) => {
      if (path.includes("/realms?")) return { body: realms };
      if (path.includes("/orders?") && !path.includes("since="))
        return { body: { items: [order], next_since: 1 } };
      return empty;
    },
    ["r5"],
  );
  try {
    const r = await f.read("@probe/one");
    assert.equal(r.code, 0, r.out + r.err + JSON.stringify(f.calls));
    const data = JSON.parse(r.out);
    assert.equal(data.complete, true);
    assert.deepEqual(data.scope.realms, ["@probe/one"]);
    assert.equal(data.stop[0].order_id, "stop-one");
    assert.ok(f.calls.some((c) => c.path.includes("invites")));
    assert.ok(f.calls.every((c) => c.method === "GET"));
  } finally {
    await f.close();
  }
});

test("demands: resolution never adds unheld graphs from the same account", async () => {
  const f = await fixture(() => ({ body: realms }), ["r6"]);
  try {
    const r = await f.read("@probe/one");
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out).complete, false);
    assert.ok(!f.calls.some((c) => c.path.includes("invites") || c.path.includes("orders")));
  } finally {
    await f.close();
  }
});

test("demands: failed or unresolved boundary aliases cannot admit another graph", async () => {
  for (const listed of [{ status: 503, body: {} }, empty, { body: { items: "bad" } }]) {
    const f = await fixture((path) => (path.includes("/realms?") ? listed : empty), ["r5"]);
    try {
      const r = await f.read("@probe/one");
      assert.equal(r.code, 1);
      assert.equal(JSON.parse(r.out).complete, false);
      assert.ok(!f.calls.some((c) => c.path.includes("invites") || c.path.includes("orders")));
    } finally {
      await f.close();
    }
  }
});
