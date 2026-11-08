import assert from "node:assert/strict";
import { test } from "node:test";

import { fixture } from "./demands-fixture.mjs";

const empty = { body: { items: [] } };

test("demands: a short graph alias in hold metadata cannot hide canonical stop orders", async () => {
  const f = await fixture(() => empty, ["r5"]);
  try {
    const r = await f.read("r5");
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out).complete, false);
    assert.equal(f.calls.length, 0, "aliases are refused before reading incomparable rows");
  } finally {
    await f.close();
  }
});

test("demands: empty queues are complete only after both sources answered", async () => {
  const f = await fixture(() => empty);
  try {
    const r = await f.read("@probe/one", "@probe/two");
    assert.equal(r.code, 0, r.err);
    const data = JSON.parse(r.out);
    assert.equal(data.complete, true);
    assert.deepEqual(data.start, []);
    assert.deepEqual(data.stop, []);
    assert.equal(f.calls.filter((c) => c.path.includes("invites")).length, 2);
    assert.equal(f.calls.filter((c) => c.path.includes("orders")).length, 1);
  } finally {
    await f.close();
  }
});

test("demands: malformed source is not silently coerced to an empty list", async () => {
  const f = await fixture((path) =>
    path.includes("invites") ? empty : { body: { items: "not-a-list" } },
  );
  try {
    const r = await f.read("@probe/one");
    assert.equal(r.code, 1);
    const data = JSON.parse(r.out);
    assert.equal(data.complete, false);
    assert.deepEqual(data.errors, [{ source: "orders", code: "invalid_items" }]);
  } finally {
    await f.close();
  }
});

test("demands: redirects are not followed, even with a valid bearer", async () => {
  const f = await fixture((path) =>
    path.includes("invites")
      ? empty
      : {
          status: 302,
          headers: { location: "/exfiltrate" },
          body: {},
        },
  );
  try {
    const r = await f.read("@probe/one");
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.out).complete, false);
    assert.ok(!f.calls.some((c) => c.path.includes("exfiltrate")));
  } finally {
    await f.close();
  }
});

test("demands: a malformed invite makes its realm incomplete without discarding another realm", async () => {
  const invite = { room_id: "one", entry_id: 1, karta_seq: 2, payload: {} };
  const f = await fixture((path) => {
    if (path.includes("%40probe%2Fone")) return { body: { items: [invite] } };
    if (path.includes("invites")) return { body: { items: [{ ...invite, entry_id: "bad" }] } };
    return empty;
  });
  try {
    const r = await f.read("@probe/one", "@probe/two");
    assert.equal(r.code, 1);
    const data = JSON.parse(r.out);
    assert.equal(data.complete, false);
    assert.equal(data.start.length, 1);
    assert.equal(data.start[0].repository, null);
    assert.equal(data.errors[0].realm, "@probe/two");
  } finally {
    await f.close();
  }
});
