import "./built.mjs";

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { settleStops } from "../bridge/orchestra-run-ends.ts";
import { readRuns, runIdentity, writeRuns } from "../bridge/orchestra-runs.ts";
import { orchestraStatus } from "../bridge/orchestra-status.ts";
import { prepareTree } from "../bridge/orchestra-tree.ts";
import { git } from "../bridge/orchestra-tree-check.ts";
import { cleanupTree } from "../bridge/orchestra-tree-clean.ts";
import { command, fixture, stopped } from "./tree-fixture.mjs";

test("tree: unknown stop never becomes ended or frees its slot on a legacy timeout", () => {
  const r = {
    state: "stopping",
    at: "2000-01-01T00:00:00Z",
    stopping_at: "2000-01-01T00:00:00Z",
    stop_outcome: "failed",
    tree: { state: "ready" },
  };
  settleStops({ own: r }, []);
  assert.equal(r.state, "stopping");
  r.stop_outcome = "stopped";
  settleStops({ own: r }, []);
  assert.equal(r.state, "stopping");
});
test("tree: a replacement tree identity rejects a stale closure", () => {
  const r = {
    realm: "r5",
    room: "room",
    invite: 1,
    at: "same",
    tree: { operation: "one", path: "/one" },
  };
  assert.notEqual(runIdentity(r), runIdentity({ ...r, tree: { ...r.tree, operation: "two" } }));
});
test("tree: HEAD lock prevents a new detached commit racing removal", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  stopped(f);
  let attempted = false;
  const execute = async (cwd, args, timeout) => {
    if (args[0] === "worktree" && args[1] === "remove") {
      attempted = true;
      assert.throws(
        () =>
          command(
            f.row.worktree,
            "-c",
            "user.name=probe",
            "-c",
            "user.email=probe@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "racing",
          ),
        /HEAD.lock|cannot lock ref/,
      );
      assert.equal(command(f.row.worktree, "rev-parse", "HEAD"), f.base);
    }
    return git(cwd, args, timeout);
  };
  assert.equal(await cleanupTree(f.auth, f.runs, "own", execute), null);
  assert.equal(attempted, true);
});
test("tree: a preexisting HEAD lock is foreign and never removed", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  stopped(f);
  const lock = join(f.row.tree.identity.gitDir, "HEAD.lock");
  writeFileSync(lock, "foreign");
  assert.equal(await cleanupTree(f.auth, f.runs, "own"), "tree_head_locked");
  assert.equal(readFileSync(lock, "utf8"), "foreign");
  assert.equal(existsSync(f.row.worktree), true);
});
test("tree: superseded durable intent cannot create an unregistered tree", async (t) => {
  const f = fixture(t),
    snapshot = readRuns(f.auth);
  let adds = 0;
  const execute = async (cwd, args, timeout) => {
    const got = await git(cwd, args, timeout);
    if (args.includes("refs/remotes/origin/main^{commit}"))
      writeRuns(f.auth, { own: { ...f.row, at: "replacement" } });
    if (args[0] === "worktree" && args[1] === "add") adds++;
    return got;
  };
  assert.equal(
    await prepareTree(f.auth, snapshot, "own", f.source, execute),
    "tree_intent_superseded",
  );
  assert.equal(adds, 0);
  assert.equal(readRuns(f.auth).own.at, "replacement");
});

test("tree: an unknown ref backend cannot rely on a files-backend HEAD lock", async (t) => {
  const f = fixture(t);
  let adds = 0;
  const execute = async (cwd, args, timeout) => {
    if (args.includes("extensions.refStorage")) return { code: 0, out: "reftable\n" };
    if (args[0] === "worktree" && args[1] === "add") adds++;
    return git(cwd, args, timeout);
  };
  assert.equal(
    await prepareTree(f.auth, f.runs, "own", f.source, execute),
    "tree_ref_storage_unverified",
  );
  assert.equal(adds, 0);
  assert.equal(f.row.tree, undefined);
});

test("tree: status exposes a named retained residue without its private path", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  stopped(f);
  writeFileSync(join(f.row.worktree, "private-work"), "retain");
  assert.equal(await cleanupTree(f.auth, f.runs, "own"), "tree_dirty_retained");
  const status = orchestraStatus(f.auth, []);
  assert.match(status.said, /tree_dirty_retained/);
  assert.equal(status.said.includes(f.row.worktree), false);
});
