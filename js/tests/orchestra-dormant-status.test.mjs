import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { LIVE, readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { orchestraStatus } from "../bridge/orchestra-status.ts";

test("dormant run survives registry reload, frees the limit and appears in status with its cursor", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dormant-status-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = {
    realm: "@nks/test",
    room: "room-1",
    invite: 9,
    karta: 931,
    launcher: "local",
    harness: "dsh",
    model: "local/model",
    repository: "repo",
    worktree: "/tree",
    state: "dormant",
    at: "2026-11-01T00:00:00Z",
    dormant: { since: "2026-11-01T01:00:00Z", cursor: "cursor-42" },
  };
  writeRuns(dir, { key: run });
  assert.deepEqual(readRuns(dir).key.dormant, run.dormant);
  assert.equal(LIVE.includes("dormant"), false);
  const status = orchestraStatus(dir, []);
  assert.match(status.said, /dormant/);
  assert.match(status.said, /room-1/);
  assert.match(status.said, /cursor-42/);
});
