import assert from "node:assert/strict";
import { test } from "node:test";

import { graphInboxKey } from "../shared/graph-inbox.ts";
import { carryGraphMarks, deliveryKeys, eventIn, splitBatch } from "../shared/seen.ts";
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

test("graph retirement keys follow the latest carrier transitively and only at delivery", () => {
  const old = graphPosed("old", 9);
  const latest = graphPosed("latest", 10);
  const other = graphPosed("other", 12);
  other.body.realm_slug = "other";
  const marks = new Set();
  const has = (k) => marks.has(k);
  assert.deepEqual(splitBatch([old, other, latest], Infinity, has).kept, [other, latest]);
  assert.equal(eventIn(old, has), false, "folding is not a receipt");
  assert.ok(deliveryKeys(latest).includes("ev:9"));
  assert.ok(!deliveryKeys(latest).includes("ev:12"), "another graph is not retired");
  const newest = graphPosed("newest", 11);
  splitBatch([latest, newest], Infinity, () => false);
  for (const key of deliveryKeys(newest)) marks.add(key);
  for (const f of [old, latest, newest]) {
    const replay = { ...f, id: `replayed-${f.id}` };
    assert.equal(eventIn(replay, has), true);
  }
});

test("graph retirement crosses JSON only through our event marks, never server frame fields", () => {
  const old = graphPosed("old", 9);
  const latest = graphPosed("latest", 10);
  latest.marks = ["ev:666"];
  latest.retired = ["ev:667"];
  splitBatch([old, latest], Infinity, () => false);
  const ev = JSON.parse(
    JSON.stringify({ kind: "frame", frame: latest, marks: deliveryKeys(latest) }),
  );
  assert.ok(
    !deliveryKeys(ev.frame).includes("ev:9"),
    "private carrier state is not a server field",
  );
  carryGraphMarks(ev.frame, ev.marks);
  assert.ok(deliveryKeys(ev.frame).includes("ev:9"), "local event restores retirement");
  assert.ok(!deliveryKeys(ev.frame).includes("ev:666"));
  assert.ok(!deliveryKeys(ev.frame).includes("ev:667"));
});

test("same-event folding never extinguishes the pending last carrier before delivery", () => {
  const original = graphPosed("original", 7);
  const replayed = graphPosed("replayed", 7);
  const marks = new Set([original.id]);
  const out = splitBatch([original, replayed], Infinity, (k) => marks.has(k));
  assert.deepEqual(out.kept, [replayed]);
  assert.equal(marks.has("ev:7"), false);
  assert.equal(deliveryKeys(replayed).filter((k) => k === "ev:7").length, 1);
});

test("graph folding preserves a higher pending version when an old event replays before delivery", () => {
  const old = graphPosed("old", 9);
  const latest = graphPosed("latest", 10);
  latest.body.vimarsha_version = 2;
  const replayed = { ...old, id: "old-replayed", body: { ...old.body } };
  const out = splitBatch([old, latest, replayed], Infinity, () => false);
  assert.deepEqual(out.kept, [latest]);
  assert.ok(deliveryKeys(latest).includes("ev:9"));
});

test("graph retirement from a stale latest preserves separate stale and live receipts", () => {
  const old = graphPosed("stale-old", 9);
  const latest = graphPosed("stale-latest", 10);
  latest.stale = true;
  latest.body.vimarsha_version = 2;
  splitBatch([old, latest], Infinity, () => false);
  const keys = new Set(deliveryKeys(latest));
  assert.ok(keys.has("evs:9"));
  assert.ok(keys.has("evs:10"));
  assert.ok(!keys.has("ev:9"));
  assert.ok(!keys.has("ev:10"));
  assert.equal(
    eventIn(old, (k) => keys.has(k)),
    false,
    "stale delivery is not live receipt",
  );
});
