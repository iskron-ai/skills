// Real local Git; no real Orca/API/model. The stop receipt in cleanup probes is a fixture.
import "./built.mjs";

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { prepareTree } from "../bridge/orchestra-tree.ts";
import { git } from "../bridge/orchestra-tree-check.ts";
import { cleanupTree } from "../bridge/orchestra-tree-clean.ts";
import { command, fixture, stopped } from "./tree-fixture.mjs";

test("tree: durable intent precedes detached add; source refs and dirty files never change; exact clean remove has no force", async (t) => {
  const f = fixture(t),
    calls = [];
  writeFileSync(join(f.source, "dirty-source"), "must survive");
  const hookMarker = join(f.source, "hook-ran");
  writeFileSync(
    join(f.source, ".git", "hooks", "post-checkout"),
    `#!/bin/sh\necho ran > '${hookMarker}'\n`,
    { mode: 0o755 },
  );
  const execute = async (cwd, args, timeout) => {
    calls.push(args);
    if (args[0] === "worktree" && args[1] === "add") {
      const intent = readRuns(f.auth).own.tree;
      assert.equal(intent.state, "creating");
      assert.equal(intent.baseOID, f.base);
      assert.deepEqual(args, ["worktree", "add", "--detach", intent.path, f.base]);
    }
    return git(cwd, args, timeout);
  };
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source, execute), null);
  assert.equal(command(f.row.worktree, "rev-parse", "HEAD"), f.base);
  assert.notEqual(f.row.worktree, f.source);
  assert.equal(readFileSync(join(f.source, "dirty-source"), "utf8"), "must survive");
  for (const ref of ["HEAD", "refs/heads/main", "refs/remotes/origin/main"])
    assert.equal(command(f.source, "rev-parse", ref), f.base);
  stopped(f);
  assert.equal(await cleanupTree(f.auth, f.runs, "own", execute), null);
  assert.equal(existsSync(f.row.worktree), false);
  assert.equal(f.row.tree.state, "removed");
  assert.deepEqual(
    calls.find((a) => a[0] === "worktree" && a[1] === "remove"),
    ["worktree", "remove", "--", f.row.worktree],
  );
  assert.equal(
    calls.some((a) => a.includes("--force")),
    false,
  );
  assert.equal(command(f.source, "rev-parse", "HEAD"), f.base);
  assert.equal(existsSync(hookMarker), false, "repository checkout hooks cannot mutate the source");
});

test("tree: an add with unknown outcome never repeats or permits cleanup", async (t) => {
  const f = fixture(t);
  let adds = 0;
  const execute = async (cwd, args, timeout) => {
    const result = await git(cwd, args, timeout);
    if (args[0] === "worktree" && args[1] === "add") {
      adds++;
      return { code: "timeout", out: "SECRET" };
    }
    return result;
  };
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source, execute), "tree_add_unverified");
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source, execute), "tree_intent_exists");
  assert.equal(adds, 1);
  assert.equal(f.row.state, "ambiguity");
  assert.equal(existsSync(f.row.worktree), true);
  stopped(f);
  assert.equal(await cleanupTree(f.auth, f.runs, "own"), "tree_add_unverified");
  assert.equal(existsSync(f.row.worktree), true);
});

for (const dirty of ["untracked", "ignored", "commit", "foreign", "unknown-stop"]) {
  test(`tree: ${dirty} is retained, never deleted`, async (t) => {
    const f = fixture(t);
    assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
    stopped(f);
    if (dirty === "untracked" || dirty === "ignored")
      writeFileSync(join(f.row.worktree, dirty === "ignored" ? "ignored" : "work"), "user data");
    if (dirty === "commit") {
      writeFileSync(join(f.row.worktree, "work"), "committed user work");
      command(f.row.worktree, "add", "work");
      command(
        f.row.worktree,
        "-c",
        "user.name=probe",
        "-c",
        "user.email=probe@example.invalid",
        "commit",
        "-m",
        "preserve",
      );
    }
    if (dirty === "foreign") f.row.tree.identity.gitIno++;
    if (dirty === "unknown-stop") f.row.stop_outcome = "failed";
    writeRuns(f.auth, f.runs);
    assert.notEqual(await cleanupTree(f.auth, f.runs, "own"), null);
    assert.equal(existsSync(f.row.worktree), true);
    assert.notEqual(f.row.tree.state, "removed");
  });
}

test("tree: missing origin/main refuses before any intent or add", async (t) => {
  const f = fixture(t);
  command(f.source, "update-ref", "-d", "refs/remotes/origin/main");
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), "tree_base_unverified");
  assert.equal(f.row.tree, undefined);
  assert.equal(existsSync(join(f.source, ".worktrees")), false);
});

test("tree: first seat preserves exact exit, replacement incarnation cannot inherit it", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  f.row.tree.incarnation = "first";
  writeRuns(f.auth, f.runs);
  const initial = readRuns(f.auth);
  initial.own.tree.exit = "observed";
  initial.own.closed = "client_exited";
  writeRuns(f.auth, initial);
  const seat = readRuns(f.auth);
  seat.own.standing_id = "seat";
  writeRuns(f.auth, seat);
  assert.equal(readRuns(f.auth).own.closed, "client_exited");
  const replaced = readRuns(f.auth);
  replaced.own.tree.incarnation = "second";
  writeRuns(f.auth, replaced);
  assert.equal(readRuns(f.auth).own.closed, undefined);
  assert.equal(readRuns(f.auth).own.tree.exit, undefined);
});
