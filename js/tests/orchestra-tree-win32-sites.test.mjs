import "./built.mjs";
import "./tree-win-hooks.mjs";

import assert from "node:assert/strict";
import { test } from "node:test";

import { fixture } from "./tree-fixture.mjs";
import { toNative, toWindows } from "./tree-win-fs.mjs";

const { prepareTree } = await import("../bridge/orchestra-tree.ts");
const { git, inspectTree, readyTree } = await import("../bridge/orchestra-tree-check.ts");
const { cleanupTree } = await import("../bridge/orchestra-tree-clean.ts");
const { runKey, writeRuns } = await import("../bridge/orchestra-runs.ts");

function setup(t) {
  const f = fixture(t);
  globalThis.treeWinRoot = f.root;
  delete globalThis.treeWinGitdir;
  const key = runKey(f.row.realm, f.row.room, f.row.invite);
  const runs = { [key]: f.row };
  writeRuns(f.auth, runs);
  const source = toWindows(f.source);
  const execute = async (cwd, args, timeout) => {
    const result = await git(toNative(cwd), args.map(toNative), timeout);
    if (
      args[0] === "rev-parse" &&
      (args.includes("--show-toplevel") ||
        args.includes("--git-common-dir") ||
        args.includes("--absolute-git-dir"))
    )
      result.out = toWindows(result.out.trim()).replaceAll("\\", "/") + "\n";
    return result;
  };
  return { ...f, source, key, runs, execute };
}

test("Windows paths traverse preparation, identity, ready and cleanup comparisons", async (t) => {
  const f = setup(t);
  assert.equal(await prepareTree(f.auth, f.runs, f.key, f.source, f.execute), null);
  assert.deepEqual(await inspectTree(f.row.tree, f.execute), f.row.tree.identity);
  assert.equal(await readyTree(f.auth, f.key, f.row, f.source, f.execute), true);
  f.row.state = "ended";
  f.row.stop_outcome = "stopped";
  f.row.closed = "client_exited";
  f.row.tree.exit = "observed-exit";
  f.row.worktree = f.row.worktree.replaceAll("\\", "/");
  writeRuns(f.auth, f.runs);
  assert.equal(await cleanupTree(f.auth, f.runs, f.key, f.execute, "linux"), null);
  assert.equal(f.row.tree.state, "removed");
});

test("Windows paths refuse other directories, disks and metadata", async (t) => {
  const f = setup(t);
  const wrongTop = async (cwd, args, timeout) => {
    const result = await f.execute(cwd, args, timeout);
    if (args.includes("--show-toplevel")) result.out = "D:/foreign\n";
    return result;
  };
  assert.equal(
    await prepareTree(f.auth, f.runs, f.key, f.source, wrongTop),
    "tree_source_unverified",
  );
  assert.equal(await prepareTree(f.auth, f.runs, f.key, f.source, f.execute), null);
  for (const foreign of ["C:/win/foreign", "D:/win/foreign"]) {
    const wrongCommon = async (cwd, args, timeout) => {
      const result = await f.execute(cwd, args, timeout);
      if (args.includes("--git-common-dir")) result.out = foreign;
      return result;
    };
    await assert.rejects(inspectTree(f.row.tree, wrongCommon), /tree_identity_unverified/);
    assert.equal(await readyTree(f.auth, f.key, f.row, f.source, wrongCommon), false);
    const wrongMetadata = async (cwd, args, timeout) => {
      const result = await f.execute(cwd, args, timeout);
      if (args.includes("--absolute-git-dir")) result.out = foreign;
      return result;
    };
    await assert.rejects(inspectTree(f.row.tree, wrongMetadata), /tree_identity_unverified/);
    const wrongTree = async (cwd, args, timeout) => {
      const result = await f.execute(cwd, args, timeout);
      if (args.includes("--show-toplevel")) result.out = foreign;
      return result;
    };
    await assert.rejects(inspectTree(f.row.tree, wrongTree), /tree_identity_unverified/);
  }
  for (const foreign of ["C:\\win\\foreign\\.git", "D:\\win\\foreign\\.git"]) {
    globalThis.treeWinGitdir = foreign;
    await assert.rejects(inspectTree(f.row.tree, f.execute), /tree_identity_unverified/);
  }
  delete globalThis.treeWinGitdir;
  f.row.state = "ended";
  f.row.stop_outcome = "stopped";
  f.row.closed = "client_exited";
  f.row.tree.exit = "observed-exit";
  f.row.worktree = "D:\\foreign";
  writeRuns(f.auth, f.runs);
  assert.equal(
    await cleanupTree(f.auth, f.runs, f.key, f.execute, "linux"),
    "tree_identity_unverified",
  );
});
