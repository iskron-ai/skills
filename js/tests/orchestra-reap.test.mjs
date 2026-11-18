// The daemon's own close of its OpenCode terminal (graph @nks/nks-dev, #11099, #9256): the
// observed exit is recorded, but an exec run whose halt/drop is not confirmed stays observed —
// its order expired, its session on the shared server may still be woken. Orca is injected.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { reapOwn } from "../bridge/orchestra-reap.ts";
import { LIVE, readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { cleanupEndedTrees } from "../bridge/orchestra-tree-clean.ts";

const row = {
  realm: "@x/one",
  room: "r",
  invite: 1,
  karta: 3,
  harness: "opencode",
  launcher: "own",
  model: "m",
  repository: "example.test/org/repo",
  worktree: "/nowhere/.worktrees/orchestra-x",
  state: "stopping",
  at: "2026-11-18T00:00:00Z",
  stopping_at: "2026-11-18T00:00:00Z",
  standing_id: "seat",
  order_id: "ord",
  orders: ["ord"],
  stop_outcome: "expired",
  terminal: "term_own",
  runtime: "rt",
  exec: { attempt: "a", receipt: "r", server: "s", model: {}, session: "ses", incarnation: "inc" },
  tree: { state: "ready", path: "/nowhere/.worktrees/orchestra-x", incarnation: "inc" },
};

test("reap: an expired exec run whose terminal closed is not ended — halt unconfirmed (#9256)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "reap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeRuns(dir, { own: structuredClone(row) });
  const runs = readRuns(dir);
  const asked = [];
  const said = await reapOwn(dir, runs, undefined, async (handle, runtime, current, expected) => {
    asked.push({ handle, runtime, current: current(), expected });
    return null;
  });
  assert.deepEqual(asked, [
    {
      handle: "term_own",
      runtime: "rt",
      current: true,
      expected: { incarnation: "inc", worktree: row.worktree },
    },
  ]);
  assert.match(said.join(), /stop_expired, client_exited/);
  const r = runs.own;
  assert.equal(r.closed, "client_exited");
  assert.ok(r.exec.exit, "the observed exit is recorded");
  assert.notEqual(r.state, "ended", "the session's halt/drop is not confirmed");
  assert.equal(LIVE.includes(r.state), true, "the run stays under observation");
  writeRuns(dir, runs);
  await cleanupEndedTrees(dir, runs);
  assert.equal(readRuns(dir).own.tree.state, "ready", "its tree is not removed");
});
