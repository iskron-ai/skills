import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fixture } from "./demands-fixture.mjs";

// Wire sources: graph @nks/nks-dev #4951/#7509; API 0.162, case 3798[26].
// Invites is a full list; orders ends on an empty page after next_since.
const invite = {
  room_id: "room-one",
  entry_id: 7,
  karta_seq: 9,
  payload: { holon: { seq: 3, repository: "github.com/probe/one" } },
  attrs: { model: "example", token: "MUST-NOT-ESCAPE" },
};
const order = {
  id: "order-one",
  seq: 1,
  standing_id: "seat-one",
  realm: "@probe/one",
  karta_seq: 9,
  repository: null,
  state: "issued",
  hook_token: "MUST-NOT-ESCAPE",
};
const empty = { body: { items: [] } };

test("demands: reads both queues with flag off, repeats without consuming or stopping", async () => {
  const f = await fixture((path) => {
    if (path.startsWith("/api/realms/")) return { body: { items: [invite], numbering: "realm" } };
    if (path.includes("since=1")) return empty;
    return {
      body: { items: [order, { ...order, id: "other", realm: "@outside/realm" }], next_since: 1 },
    };
  });
  try {
    const a = await f.read("@probe/one");
    assert.equal(a.code, 0, a.err);
    const first = JSON.parse(a.out);
    assert.equal(first.schema_version, 1);
    assert.equal(first.complete, true);
    assert.equal(first.start.length, 1);
    assert.equal(first.stop.length, 1);
    assert.equal(first.start[0].repository, "github.com/probe/one");
    assert.equal(first.stop[0].repository, null);
    assert.equal(first.stop[0].order_id, "order-one");
    assert.doesNotMatch(a.out, /MUST-NOT-ESCAPE|hook_token/);
    const b = await f.read("@probe/one");
    assert.equal(b.code, 0, b.err);
    assert.deepEqual(JSON.parse(b.out).start, first.start);
    assert.deepEqual(JSON.parse(b.out).stop, first.stop);
    assert.ok(f.calls.every((c) => c.method === "GET" && !c.path.includes("raised")));
    for (const name of ["orchestra.json", "orchestra-cursors.json", "order-since.json"])
      assert.equal(existsSync(join(f.dir, "run", name)), false);
  } finally {
    await f.close();
  }
});

test("demands: failure is not an empty success; stop survives a failed invite source", async () => {
  const f = await fixture((path) => {
    if (path.includes("/invites")) return { status: 403, body: { secret: "MUST-NOT-ESCAPE" } };
    return path.includes("since=1") ? empty : { body: { items: [order], next_since: 1 } };
  });
  try {
    const r = await f.read("@probe/one");
    assert.equal(r.code, 1, r.err);
    const body = JSON.parse(r.out);
    assert.equal(body.complete, false);
    assert.equal(body.stop.length, 1);
    assert.equal(body.errors[0].source, "invites");
    assert.doesNotMatch(r.out + r.err, /MUST-NOT-ESCAPE/);
  } finally {
    await f.close();
  }
});

test("demands: absent or foreign scope never expands the machine boundary", async () => {
  const f = await fixture(() => empty);
  try {
    const none = await f.read();
    const other = await f.read("@outside/realm");
    assert.equal(none.code, 1);
    assert.equal(other.code, 1);
    assert.equal(JSON.parse(none.out).errors[0].source, "scope");
    assert.equal(JSON.parse(other.out).errors[0].code, "outside_boundary");
    assert.equal(f.calls.length, 0, "scope refused before network");
  } finally {
    await f.close();
  }
});

test("demands: nonadvancing order page is explicitly incomplete", async () => {
  const f = await fixture((path) =>
    path.includes("/invites") ? empty : { body: { items: [order], next_since: 0 } },
  );
  try {
    const r = await f.read("@probe/one");
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out).complete, false);
  } finally {
    await f.close();
  }
});
