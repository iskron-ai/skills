// #10603: a raised agent removed the tree its own terminal lived in; Orca closed the terminal and
// shows it orphaned with an empty path. The exact exit is still the run's own — its slot frees.
// The answers below are the shape Orca 1.4.258 printed for such a terminal (13.11.2026).
import "./built.mjs";

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { execExited } from "../bridge/exec-client-exit.ts";

const RUNTIME = "rt-1";
const HANDLE = "term_1";
const INCARNATION = "inc-1";

function fakeOrca(t, terminal) {
  const dir = mkdtempSync(join(tmpdir(), "iskron-gone-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const show = { ok: true, result: { terminal }, _meta: { runtimeId: RUNTIME } };
  const wait = {
    ok: true,
    result: { wait: { handle: HANDLE, condition: "exit", satisfied: true, status: "exited" } },
    _meta: { runtimeId: RUNTIME },
  };
  writeFileSync(
    join(bin, "orca"),
    `#!${process.execPath}\nconst a = process.argv.slice(2);\n` +
      `process.stdout.write(JSON.stringify(a[1] === "wait" ? ${JSON.stringify(wait)} : ${JSON.stringify(show)}));\n`,
    { mode: 0o755 },
  );
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  t.after(() => (process.env.PATH = path));
  return dir;
}

const run = (worktree) => ({
  terminal: HANDLE,
  runtime: RUNTIME,
  worktree,
  tree: { incarnation: INCARNATION },
});

const orphan = (worktree, over = {}) => ({
  handle: HANDLE,
  incarnationId: INCARNATION,
  executionHostId: "local",
  worktreePath: "",
  worktreeId: `repo-id::${worktree}`,
  orphaned: true,
  connected: false,
  writable: false,
  ...over,
});

test("tree gone: the orphaned exact terminal of a removed tree is the run's exit", async (t) => {
  const worktree = join(tmpdir(), "iskron-gone-removed", "orchestra-x");
  fakeOrca(t, orphan(worktree));
  assert.equal(await execExited(run(worktree)), true);
});

test("tree gone: an empty path while the tree still stands proves nothing", async (t) => {
  const dir = fakeOrca(t, {});
  const worktree = join(dir, "orchestra-x");
  mkdirSync(worktree);
  fakeOrca(t, orphan(worktree));
  assert.equal(await execExited(run(worktree)), false);
});

for (const [why, over] of [
  ["another tree's id", { worktreeId: "repo-id::/elsewhere/orchestra-y" }],
  ["not orphaned", { orphaned: false }],
  ["another incarnation", { incarnationId: "inc-2" }],
])
  test(`tree gone: ${why} is not the run's exit`, async (t) => {
    const worktree = join(tmpdir(), "iskron-gone-removed", "orchestra-x");
    fakeOrca(t, orphan(worktree, over));
    assert.equal(await execExited(run(worktree)), false);
  });
