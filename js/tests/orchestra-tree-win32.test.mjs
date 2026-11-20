import "./built.mjs";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { prepareTree } from "../bridge/orchestra-tree.ts";
import * as check from "../bridge/orchestra-tree-check.ts";
import { cleanupTree } from "../bridge/orchestra-tree-clean.ts";
import { dropUnlaunched } from "../bridge/orchestra-tree-drop.ts";
import { fixture, stopped } from "./tree-fixture.mjs";

test("Windows preparation reaches Git instead of refusing the platform", (t) => {
  const f = fixture(t);
  const root = process.env.TREE_PROBE_ROOT ?? process.cwd();
  const program = `
    import { prepareTree } from ${JSON.stringify(pathToFileURL(path.join(root, "js/bridge/orchestra-tree.ts")).href)};
    const runs = { own: {} };
    let calls = 0;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    const reason = await prepareTree('', runs, 'own', ${JSON.stringify(f.source)}, async () => {
      calls++; return { code: 1, out: '' };
    });
    if (!calls || reason === 'tree_source_unverified') process.exit(1);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Windows Git paths identify only the exact tree", () => {
  assert.equal(check.sameTreePath("C:/Users/a/r", "c:\\Users\\a\\r", path.win32), true);
  assert.equal(check.sameTreePath("C:/Users/a/r2", "C:\\Users\\a\\r", path.win32), false);
  assert.equal(check.sameTreePath("D:/Users/a/r", "C:\\Users\\a\\r", path.win32), false);
  assert.equal(check.sameTreePath("C:/Users/A/r", "C:\\Users\\a\\r", path.win32), false);
  assert.equal(check.sameTreePath("/a/b", "/a/b", path.posix), true);
  assert.equal(check.sameTreePath("/a/b", "/a\\b", path.posix), false);
  assert.equal(check.treeMetadataPath("C:/r/.git", "c:\\r\\.git\\worktrees\\x", path.win32), true);
  assert.equal(check.treeMetadataPath("C:/r/.git", "C:/r/.git/worktrees/x/y", path.win32), false);
  assert.equal(check.treeMetadataPath("C:/R/.git", "C:/r/.git/worktrees/x", path.win32), false);
});

test("Windows cleanup retains the tree without calling Git", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  stopped(f);
  const calls = [];
  const execute = async (_cwd, args) => {
    calls.push(args);
    return { code: 1, out: "" };
  };
  assert.equal(
    await cleanupTree(f.auth, f.runs, "own", execute, "win32"),
    "tree_clean_win32_unverified",
  );
  assert.equal(f.row.tree.state, "retained");
  assert.equal(existsSync(f.row.worktree), true);
  assert.deepEqual(calls, []);
});

test("Windows unlaunched tree is also retained without Git", async (t) => {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  const calls = [];
  const execute = async (_cwd, args) => {
    calls.push(args);
    return { code: 1, out: "" };
  };
  assert.equal(
    await dropUnlaunched(f.auth, f.runs, "own", execute, "win32"),
    "tree_clean_win32_unverified",
  );
  assert.equal(f.row.tree.state, "retained");
  assert.equal(existsSync(f.row.worktree), true);
  assert.deepEqual(calls, []);
});
