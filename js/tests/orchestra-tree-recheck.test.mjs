// A kept tree of an ended run is looked at again (graph @nks/nks-dev, #11189): its reason gone —
// commits a trunk took later — it goes by the first cleanup's own path; still there, it stays
// said as before; ignored dirt is unsaved work by the abandoned-tree rule and keeps it. Real Git.
import "./built.mjs";

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readRuns } from "../bridge/orchestra-runs.ts";
import { prepareTree } from "../bridge/orchestra-tree.ts";
import * as clean from "../bridge/orchestra-tree-clean.ts";
import { command, fixture, stopped } from "./tree-fixture.mjs";

const ID = ["-c", "user.name=probe", "-c", "user.email=probe@example.invalid"];
const T0 = Date.parse("2026-11-19T10:00:00Z");
// The interval named here, not imported: against a cleanup without it the probes fail on
// behaviour, not on a missing module.
const { cleanupEndedTrees } = clean;
const RECHECK_MS = 10 * 60_000;

/** An ended run's tree kept by the first cleanup: a commit past the base, or ignored dirt. */
async function kept(t, how) {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  stopped(f);
  const tree = f.row.worktree;
  if (how === "commit") {
    writeFileSync(join(tree, "work.txt"), "work\n");
    command(tree, "add", "work.txt");
    command(tree, ...ID, "commit", "-m", "work");
  } else writeFileSync(join(tree, "ignored"), "build output\n");
  await cleanupEndedTrees(f.auth, readRuns(f.auth), T0);
  const r = readRuns(f.auth).own;
  assert.equal(r.tree.state, "retained", JSON.stringify(r));
  return { ...f, tree, head: command(tree, "rev-parse", "HEAD") };
}
const tact = async (f, at) => {
  await cleanupEndedTrees(f.auth, readRuns(f.auth), at);
  return readRuns(f.auth).own;
};

test("tree recheck: a commit fast-forwarded into main lets the next look remove the tree", async (t) => {
  const f = await kept(t, "commit");
  assert.equal((await tact(f, T0)).tree.why, "tree_commits_retained");
  command(f.source, "merge", "--ff-only", f.head);
  const soon = await tact(f, T0 + RECHECK_MS / 2);
  assert.equal(soon.tree.state, "retained", "not looked at again before the interval");
  const r = await tact(f, T0 + RECHECK_MS);
  assert.equal(r.tree.state, "removed", JSON.stringify(r));
  assert.equal(existsSync(f.tree), false);
  assert.notEqual(r.why, "tree_commits_retained");
});

// A squash merge: another commit in main carries the same patch, the tree's own is no ancestor.
test("tree recheck: a commit squashed into main lets the next look remove the tree", async (t) => {
  const f = await kept(t, "commit");
  command(f.source, "merge", "--squash", f.head);
  command(f.source, ...ID, "commit", "-m", "squashed (#1)");
  const main = command(f.source, "rev-parse", "main");
  assert.notEqual(main, f.head);
  assert.throws(() => command(f.source, "merge-base", "--is-ancestor", f.head, "main"));
  const r = await tact(f, T0 + RECHECK_MS);
  assert.equal(r.tree.state, "removed", JSON.stringify(r));
  assert.equal(existsSync(f.tree), false);
});

test("tree recheck: an unmerged commit keeps the tree, said as before", async (t) => {
  const f = await kept(t, "commit");
  for (const at of [T0, T0 + RECHECK_MS, T0 + 2 * RECHECK_MS]) {
    const r = await tact(f, at);
    assert.equal(r.tree.state, "retained");
    assert.equal(r.tree.why, "tree_commits_retained");
  }
  assert.equal(existsSync(join(f.tree, "work.txt")), true);
});

test("tree recheck: dirt only in ignored files keeps the tree", async (t) => {
  const f = await kept(t, "ignored");
  const r = await tact(f, T0 + RECHECK_MS);
  assert.equal(r.tree.state, "retained");
  assert.equal(r.tree.why, "tree_dirty_retained");
  assert.equal(existsSync(join(f.tree, "ignored")), true);
});
