// Real detached Git tree across startRun; Orca/runtime/API are stubs, not native readiness.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { launchExec } from "../bridge/exec-launch.ts";
import { readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { startRun } from "../bridge/orchestra-start.ts";
import { execFixture } from "./exec-fixture.mjs";

async function startFixture(t, change = () => {}) {
  const f = await execFixture(t);
  const source = f.runs[f.key].worktree;
  const git = (...args) =>
    execFileSync("git", ["-C", source, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  writeFileSync(join(source, "AGENTS.md"), "---\niskron:\n  graph: r5\n  agent_role: 3\n---\n");
  git("add", "AGENTS.md");
  git("-c", "user.name=probe", "-c", "user.email=probe@example.invalid", "commit", "-m", "fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const row = { ...f.runs[f.key] };
  const own = { launcher: "own", host: f.host, harnesses: { opencode: { exec: f.spec } } };
  const previousBridge = process.argv[1];
  let outcome;
  try {
    process.argv[1] = f.bridge;
    outcome = await startRun(f.auth, row, own, row.repository, source, f.runs, f.key, async () => {
      await change(f, source, git);
      return row.realm;
    });
  } finally {
    process.argv[1] = previousBridge;
  }
  return { ...f, outcome, source, git };
}

test("legacy launchExec without tree still rejects a path other than Orca setup", async (t) => {
  const f = await execFixture(t);
  f.runs[f.key].worktree = f.root;
  assert.equal(
    await launchExec(f.auth, f.runs, f.key, f.host, f.spec, "brief", f.bridge),
    "exec_checkout_unverified",
  );
  assert.equal(f.runs[f.key].exec, undefined);
  assert.equal(f.calls.length, 0);
  assert.equal(
    f.orcaCalls().some((a) => a[0] === "terminal"),
    false,
  );
});

test("startRun → prepareTree → launchExec uses its own ready detached tree, not Orca source", async (t) => {
  const f = await startFixture(t);
  assert.equal(f.outcome, "exec_launched");
  const r = readRuns(f.auth)[f.key];
  assert.equal(r.tree.state, "ready");
  assert.notEqual(r.worktree, f.source);
  assert.equal(r.worktree, r.tree.path);
  assert.equal(r.exec.session, "ses_fake");
  assert.equal(f.git("symbolic-ref", "--short", "HEAD"), "main");
  const create = f.orcaCalls().filter((a) => a[0] === "terminal" && a[1] === "create");
  assert.equal(create.length, 1);
  assert.equal(create[0][create[0].indexOf("--worktree") + 1], `path:${r.tree.path}`);
  assert.equal(JSON.parse(readFileSync(join(f.root, "tui.json"))).at(-1), r.tree.path);
  assert.equal(f.calls.filter((c) => c.path === "/api/session" && c.method === "POST").length, 1);
});

for (const fault of [
  "foreign",
  "source",
  "common-dir",
  "path",
  "inode",
  "stale-record",
  "not-ready",
  "read-back",
]) {
  test(`startRun rejects ${fault} tree before prepare/create`, async (t) => {
    const f = await startFixture(t, (f, source, git) => {
      const r = f.runs[f.key];
      if (fault === "foreign") r.tree.invite++;
      if (fault === "source") r.tree.source = f.root;
      if (fault === "common-dir") r.tree.commonDir = source;
      if (fault === "path") r.worktree = source;
      if (fault === "inode") {
        renameSync(r.tree.path, `${r.tree.path}.moved`);
        mkdirSync(r.tree.path);
        copyFileSync(join(`${r.tree.path}.moved`, ".git"), join(r.tree.path, ".git"));
      }
      if (fault === "not-ready") r.tree.state = "creating";
      if (fault === "read-back") {
        const back = join(r.tree.identity.gitDir, "gitdir");
        writeFileSync(back, join(source, ".git"));
      }
      if (fault === "stale-record") {
        const latest = readRuns(f.auth);
        latest[f.key].tree.operation = "00000000-0000-0000-0000-000000000000";
        writeRuns(f.auth, latest);
      } else writeRuns(f.auth, f.runs);
      assert.equal(git("rev-parse", "--show-toplevel"), source);
    });
    assert.equal(f.outcome, "exec_checkout_unverified");
    assert.equal(f.runs[f.key].exec, undefined);
    assert.equal(f.calls.length, 0);
    assert.equal(
      f.orcaCalls().some((a) => a[0] === "terminal" && a[1] === "create"),
      false,
    );
    assert.equal(existsSync(f.runs[f.key].tree.path), true);
  });
}
