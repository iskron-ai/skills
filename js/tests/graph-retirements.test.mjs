import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { writeRetirements } from "../bridge/graph-retirement-store.ts";
import { GraphRetirements } from "../bridge/graph-retirements.ts";
import { sweepStale } from "../bridge/sweep.ts";
import { deliveryKeys, eventIn, SEEN_KEEP, seenIds } from "../shared/seen.ts";
import { graphPosed } from "./room-frames.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "graph-retirements-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seen = join(dir, "seat.seen");
  const path = `${seen}.graph-retirements.json`;
  return { seen, path, store: () => new GraphRetirements(seen) };
}
const version = (id, event, v) => {
  const f = graphPosed(id, event);
  f.body.vimarsha_version = v;
  return f;
};

test("graph retirement registry: restart before and after actual old-reader receipt", (t) => {
  const { seen, path, store } = fixture(t);
  const old = version("old", 9, 1);
  const latest = version("latest", 10, 2);
  assert.equal(store().accept(old), true);
  assert.equal(store().accept(latest), true);
  assert.equal(store().accept({ ...old, id: "late-old" }), false);
  assert.equal(seenIds(seen).has("ev:9"), false);
  writeFileSync(seen, "latest\ncev:10\nevs:10\n");
  store().reconcile();
  assert.equal(seenIds(seen).has("ev:9"), false, "id/count/stale are not live receipt");
  writeFileSync(seen, "latest\nev:10\n");
  store().reconcile();
  assert.equal(seenIds(seen).has("ev:9"), true);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).entries, []);
  assert.equal(store().accept({ ...old, id: "after-restart" }), false);
});

test("graph retirement registry: transitive latest, isolation, stop without receipt", (t) => {
  const { seen, path, store } = fixture(t);
  const s = store();
  const other = version("other", 12, 1);
  other.body.realm_slug = "other";
  for (const f of [version("a", 9, 1), other, version("b", 10, 2), version("c", 11, 3)])
    s.accept(f);
  writeFileSync(seen, "ev:11\n");
  s.reconcile();
  assert.ok(seenIds(seen).has("ev:9"));
  assert.ok(seenIds(seen).has("ev:10"));
  assert.ok(!seenIds(seen).has("ev:12"));
  s.clear();
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).entries, []);
  assert.ok(!seenIds(seen).has("ev:12"));
});

test("graph retirement registry: stale carrier leaves live retirement waiting for ev latest", (t) => {
  const { seen, path, store } = fixture(t);
  const old = version("old", 9, 1);
  const latest = { ...version("latest", 10, 2), stale: true };
  store().accept(old);
  store().accept(latest);
  writeFileSync(seen, deliveryKeys(latest).join("\n") + "\n");
  const has = (k) => seenIds(seen).has(k);
  assert.ok(has("evs:9"));
  assert.equal(eventIn(old, has), false);
  store().reconcile();
  assert.equal(JSON.parse(readFileSync(path, "utf8")).entries.length, 1);
  assert.equal(has("ev:9"), false);
  writeFileSync(seen, readFileSync(seen, "utf8") + "ev:10\n");
  store().reconcile();
  assert.ok(has("ev:9"));
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).entries, []);
});

test("graph retirement registry: corrupt, unknown schema and atomic failure never mark delivery", (t) => {
  const { seen, path, store } = fixture(t);
  for (const data of ["{broken", '{"version":2,"entries":[]}', '{"version":1,"entries":[{}]}']) {
    writeFileSync(path, data);
    assert.throws(() => store().accept(version("latest", 10, 2)));
    assert.equal(readFileSync(path, "utf8"), data);
    assert.equal(seenIds(seen).size, 0);
  }
  rmSync(path);
  mkdirSync(path);
  assert.throws(() => writeRetirements(path, []), /EISDIR|EPERM/);
  assert.throws(() => store().accept(version("latest", 10, 2)));
  assert.equal(seenIds(seen).size, 0);
});

test("graph retirement registry: independent owners' reads preserve new links and client receipts", (t) => {
  const { seen, store } = fixture(t);
  // Sequential Door owners (not concurrent multi-machine sidecar writers).
  const first = store();
  const successor = store();
  first.accept(version("first", 9, 1));
  successor.accept(version("second", 10, 2));
  writeFileSync(seen, "ev:10\nforeign-client-mark\n");
  first.reconcile();
  assert.ok(seenIds(seen).has("ev:9"));
  assert.ok(seenIds(seen).has("ev:10"));
  assert.ok(seenIds(seen).has("foreign-client-mark"));
});

test("graph retirement registry: stop keeps already delivered retirement, clears only pending", (t) => {
  const { seen, path, store } = fixture(t);
  const s = store();
  s.accept(version("old", 9, 1));
  s.accept(version("latest", 10, 2));
  writeFileSync(seen, "ev:10\n");
  s.clear();
  assert.ok(seenIds(seen).has("ev:9"));
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).entries, []);
});

test("graph retirement registry: bounded keys fail closed without trimming undelivered", (t) => {
  const { seen, path, store } = fixture(t);
  const s = store();
  s.accept(version("first", 1, 1));
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.entries[0].retiredKeys = Array.from({ length: SEEN_KEEP - 1 }, (_, i) => `ev:${i + 2}`);
  writeFileSync(path, JSON.stringify(data));
  const before = readFileSync(path, "utf8");
  assert.throws(() => store().accept(version("overflow", SEEN_KEEP + 1, 2)), /limit/);
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(seenIds(seen).size, 0);
});

test("graph retirement registry: pending without first receipt shares the unheld seen lifetime", (t) => {
  const root = mkdtempSync(join(tmpdir(), "graph-retirement-sweep-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "standings");
  mkdirSync(dir);
  const pending = join(dir, "other.server.seen.graph-retirements.json");
  const stale = join(dir, "stale.server.seen.graph-retirements.json");
  writeFileSync(pending, '{"version":1,"entries":[]}');
  writeFileSync(stale, '{"version":1,"entries":[]}');
  const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(stale, old, old);
  sweepStale(root, "mine");
  assert.ok(existsSync(pending), "missing .seen is not a reason to forget pending");
  assert.ok(!existsSync(stale), "expired unheld metadata does not live forever");
});
