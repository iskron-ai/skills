// A kept tree of an ended run is looked at again (graph @nks/nks-dev, #11189): its reason gone —
// commits a trunk took later — it goes by the first cleanup's own path; still there, it stays
// said as before; ignored dirt is unsaved work by the abandoned-tree rule and keeps it. Real Git.
import "./built.mjs";

import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
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
// Saved means ancestry only — the squash stays kept, said, for the human to decide.
test("tree recheck: a commit squashed into main keeps the tree, said", async (t) => {
  const f = await kept(t, "commit");
  command(f.source, "merge", "--squash", f.head);
  command(f.source, ...ID, "commit", "-m", "squashed (#1)");
  assert.throws(() => command(f.source, "merge-base", "--is-ancestor", f.head, "main"));
  const r = await tact(f, T0 + RECHECK_MS);
  assert.equal(r.tree.state, "retained", JSON.stringify(r));
  assert.equal(r.tree.why, "tree_commits_retained");
  assert.equal(existsSync(join(f.tree, "work.txt")), true);
});

// The review's counter-case: every ordinary commit's patch is in main, but a merge in the tree
// brings a file of its own — patch equivalence does not see it; the tree and the file stay.
test("tree recheck: a merge commit's own file keeps the tree though every patch is in main", async (t) => {
  const f = await kept(t, "commit");
  command(f.tree, "switch", "-q", "-c", "side", f.base);
  writeFileSync(join(f.tree, "side.txt"), "side\n");
  command(f.tree, "add", "side.txt");
  command(f.tree, ...ID, "commit", "-m", "side");
  const side = command(f.tree, "rev-parse", "HEAD");
  command(f.tree, "switch", "-q", "--detach", f.head);
  command(f.tree, ...ID, "merge", "-q", "--no-ff", "--no-commit", "side");
  writeFileSync(join(f.tree, "unique.txt"), "only in the merge\n");
  command(f.tree, "add", "unique.txt");
  command(f.tree, ...ID, "commit", "-q", "-m", "merge side");
  command(f.tree, "branch", "-q", "-D", "side");
  for (const c of [f.head, side]) command(f.source, ...ID, "cherry-pick", "-x", c);
  const cherry = command(f.tree, "cherry", "main", "HEAD", f.base);
  assert.ok(!/^\+/m.test(cherry), `every ordinary patch is in main: ${cherry}`);
  const r = await tact(f, T0 + RECHECK_MS);
  assert.equal(r.tree.state, "retained", JSON.stringify(r));
  assert.equal(existsSync(join(f.tree, "unique.txt")), true, "the merge's own work stays");
});

// The review's second case: the client's end proven only by `why` (the stop answered 410 after
// the exact exit, exec-exit.ts), which the kept tree's reason overwrites as orchestra-lead
// writes the registry; the next look must still see the end.
test("tree recheck: an end proven by seat_gone_after_exit survives the kept reason", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  Object.assign(f.row, { state: "ended", why: "seat_gone_after_exit", closed: "client_exited" });
  f.row.tree.exit = "observed-exit";
  writeRuns(f.auth, f.runs);
  const tree = f.row.worktree;
  writeFileSync(join(tree, "work.txt"), "work\n");
  command(tree, "add", "work.txt");
  command(tree, ...ID, "commit", "-m", "work");
  const leadTact = async (at) => {
    const runs = readRuns(f.auth);
    await cleanupEndedTrees(f.auth, runs, at);
    writeRuns(f.auth, runs);
    return readRuns(f.auth).own;
  };
  let r = await leadTact(T0);
  assert.equal(r.tree.state, "retained", JSON.stringify(r));
  assert.equal(r.why, "tree_commits_retained", "the kept reason took the why");
  command(f.source, "merge", "--ff-only", command(tree, "rev-parse", "HEAD"));
  r = await leadTact(T0 + RECHECK_MS);
  assert.equal(r.tree.state, "removed", JSON.stringify(r));
  assert.equal(existsSync(tree), false);
});

// No proof, or a kept proof of another run (a continuation, another seat): the tree is not touched.
test("tree recheck: a kept proof of another run proves nothing", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  Object.assign(f.row, {
    state: "ended",
    why: "tree_commits_retained",
    closed: "client_exited",
    client_gone: { proof: "seat_gone_after_exit", identity: "another run" },
  });
  f.row.tree.exit = "observed-exit";
  writeRuns(f.auth, f.runs);
  assert.equal(await clean.cleanupTree(f.auth, readRuns(f.auth), "own"), "tree_client_unverified");
  assert.equal(existsSync(f.row.worktree), true);
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
