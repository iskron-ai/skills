import assert from "node:assert/strict";
import { test } from "node:test";

import { graphInboxKey } from "../shared/graph-inbox.ts";
import { deliveryKeys, splitBatch } from "../shared/seen.ts";
import { separateGraphBatch } from "../shared/softbatch.ts";
import { graphPosed, progress } from "./room-frames.mjs";

test("graph inbox identity is structural, graph-scoped and rejects prose and unknown events", () => {
  const f = graphPosed();
  assert.ok(graphInboxKey(f));
  assert.equal(graphInboxKey({ ...f, provenance: { via: "direct" } }), null);
  assert.equal(graphInboxKey({ ...f, body: JSON.stringify(f.body) }), null);
  assert.equal(graphInboxKey({ ...f, body: { ...f.body, event_kind: "node.updated" } }), null);
  assert.equal(graphInboxKey({ ...f, body: { ...f.body, vimarsha_seq: 0 } }), null);
  assert.equal(graphInboxKey({ ...f, body: { ...f.body, realm_slug: "" } }), null);
});

test("graph folding keeps distinct realms and questions and only replaces an unhanded update", () => {
  const first = graphPosed("first", 1);
  const otherRealm = graphPosed("other-realm", 2);
  otherRealm.body.realm_slug = "other";
  const otherQuestion = graphPosed("other-question", 3);
  otherQuestion.body.vimarsha_seq++;
  const last = graphPosed("last", 4);
  const out = splitBatch([first, otherRealm, otherQuestion, last], Infinity, () => false);
  assert.deepEqual(out.kept, [otherRealm, otherQuestion, last]);
  const marks = new Set(out.keys);
  assert.equal(splitBatch([last], Infinity, (k) => marks.has(k)).kept.length, 0);
  const newer = graphPosed("newer", 5);
  assert.deepEqual(splitBatch([newer], Infinity, (k) => marks.has(k)).kept, [newer]);
});

test("event dedup never lets an early room count swallow graph text", () => {
  const graph = graphPosed("graph", 7);
  const room = { ...progress(7), event_id: 7 };
  for (const frames of [
    [room, graph],
    [graph, room],
  ])
    assert.deepEqual(splitBatch(frames, Infinity, () => false).kept, [graph]);
  const marks = new Set(deliveryKeys(room));
  assert.deepEqual(splitBatch([graph], Infinity, (k) => marks.has(k)).kept, [graph]);
  for (const key of deliveryKeys(graph)) marks.add(key);
  assert.deepEqual(splitBatch([room, graph], Infinity, (k) => marks.has(k)).kept, []);
});

test("graph inbox in a legacy batch stays soft, with no counted room copy", () => {
  const graph = graphPosed("graph", 7);
  const room = { ...progress(7), event_id: 7 };
  for (const kind of ["stale", "backlog"]) {
    const parts = separateGraphBatch({
      kind,
      frames: [room, graph],
      marks: [...deliveryKeys(room), ...deliveryKeys(graph)],
      text: "old batch rendering",
    });
    assert.deepEqual(parts.graph, [graph]);
    assert.deepEqual(parts.rest.frames, []);
    assert.equal(parts.rest.text, "");
    assert.ok(!parts.rest.marks.includes("ev:7"), "graph is not marked before context");
  }
  const unknown = { kind: "backlog", frames: [], text: "unknown" };
  assert.equal(separateGraphBatch(unknown).rest, unknown, "unrelated batches are untouched");
});
