// №4557 [11]: file-only regression of the full stale-tact cycle. No subprocess or signal.
import "./built.mjs";

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { readRuns, recordRunClosed, syncClosed, writeRuns } from "../bridge/orchestra-runs.ts";

const row = {
  realm: "r5",
  room: "room",
  invite: 1,
  standing_id: "seat",
  terminal: "handle",
  runtime: "runtime",
  harness: "opencode",
  at: "generation1",
  state: "raised",
  rooms: 1,
};
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "runs-delta-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeRuns(dir, { own: { ...row } });
  return dir;
}

test("stale tact preserves parallel neighbour and fields through sync, transition and write", (t) => {
  const dir = fixture(t),
    stale = readRuns(dir);
  writeRuns(dir, { own: { ...stale.own, rooms: 7 }, neighbour: { ...row, terminal: "other" } });
  assert.equal(recordRunClosed(dir, "own", stale.own), true);
  syncClosed(stale, readRuns(dir));
  stale.own.state = "ended";
  writeRuns(dir, stale);
  const latest = readRuns(dir);
  assert.deepEqual(
    {
      rooms: latest.own.rooms,
      neighbour: latest.neighbour?.terminal,
      closed: latest.own.closed,
      state: latest.own.state,
    },
    { rooms: 7, neighbour: "other", closed: "client_exited", state: "ended" },
  );
});

for (const change of ["addition", "unrelated_fields", "replacement", "deletion"]) {
  test(`independent concurrent ${change} survives a stale transition`, (t) => {
    const dir = fixture(t),
      stale = readRuns(dir),
      concurrent = readRuns(dir);
    if (change === "addition") concurrent.neighbour = { ...row, terminal: "other" };
    if (change === "unrelated_fields") {
      concurrent.own.rooms = 7;
      concurrent.own.why = "latest";
    }
    if (change === "replacement")
      concurrent.own = { ...row, terminal: "replacement", at: "generation2" };
    if (change === "deletion") delete concurrent.own;
    writeRuns(dir, concurrent);
    stale.own.state = "ended";
    stale.own.closed = "client_exited";
    writeRuns(dir, stale);
    const latest = readRuns(dir);
    if (change === "addition") assert.equal(latest.neighbour?.terminal, "other");
    if (change === "unrelated_fields")
      assert.deepEqual([latest.own.rooms, latest.own.why], [7, "latest"]);
    if (change === "replacement") assert.deepEqual(latest.own, concurrent.own);
    if (change === "deletion") assert.equal(latest.own, undefined);
    if (["addition", "unrelated_fields"].includes(change)) assert.equal(latest.own.state, "ended");
  });
}

test("intentional snapshot deletion deletes its row but not a parallel addition", (t) => {
  const dir = fixture(t),
    stale = readRuns(dir),
    concurrent = readRuns(dir);
  concurrent.neighbour = { ...row, terminal: "other" };
  writeRuns(dir, concurrent);
  delete stale.own;
  writeRuns(dir, stale);
  assert.deepEqual(Object.keys(readRuns(dir)), ["neighbour"]);
});

test("intentional field deletion and identity update preserve unrelated latest fields", (t) => {
  const dir = fixture(t),
    stale = readRuns(dir),
    concurrent = readRuns(dir);
  concurrent.own.rooms = 7;
  writeRuns(dir, concurrent);
  assert.equal(recordRunClosed(dir, "own", concurrent.own), true);
  delete stale.own.standing_id;
  stale.own.terminal = "new-local-handle";
  writeRuns(dir, stale);
  const latest = readRuns(dir).own;
  assert.equal(latest.rooms, 7);
  assert.equal(latest.standing_id, undefined);
  assert.equal(latest.terminal, "new-local-handle");
  assert.equal(latest.closed, undefined, "a new local identity does not inherit the old close");
});

test("repeated writes of one snapshot do not replay stale untouched fields", (t) => {
  const dir = fixture(t),
    stale = readRuns(dir),
    concurrent = readRuns(dir);
  concurrent.own.rooms = 7;
  writeRuns(dir, concurrent);
  stale.own.state = "stopping";
  writeRuns(dir, stale);
  stale.own.state = "ended";
  writeRuns(dir, stale);
  assert.deepEqual([readRuns(dir).own.state, readRuns(dir).own.rooms], ["ended", 7]);
});

test("local addition preserves a parallel addition and is writable after its first commit", (t) => {
  const dir = fixture(t),
    stale = readRuns(dir),
    concurrent = readRuns(dir);
  stale.local = { ...row, terminal: "local" };
  concurrent.neighbour = { ...row, terminal: "other" };
  writeRuns(dir, concurrent);
  writeRuns(dir, stale);
  stale.local.runtime = "new-runtime";
  writeRuns(dir, stale);
  assert.deepEqual(Object.keys(readRuns(dir)).sort(), ["local", "neighbour", "own"]);
  assert.equal(readRuns(dir).local.runtime, "new-runtime");
});

test("conflicting new key and stale deletion do not overwrite a replacement", (t) => {
  const dir = fixture(t),
    stale = readRuns(dir),
    concurrent = readRuns(dir);
  concurrent.own = { ...row, at: "replacement" };
  concurrent.new = { ...row, terminal: "parallel" };
  writeRuns(dir, concurrent);
  delete stale.own;
  stale.new = { ...row, terminal: "stale" };
  writeRuns(dir, stale);
  assert.deepEqual(readRuns(dir), concurrent);
});

test("explicit untracked replacement still supports intentional whole-registry deletion", (t) => {
  const dir = fixture(t);
  const replacement = { own: { ...row } };
  writeRuns(dir, replacement);
  const concurrent = readRuns(dir);
  concurrent.neighbour = { ...row, terminal: "parallel" };
  writeRuns(dir, concurrent);
  delete replacement.own;
  writeRuns(dir, replacement);
  assert.deepEqual(readRuns(dir), {});
});
