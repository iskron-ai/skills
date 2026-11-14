import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { newAttempt } from "../bridge/exec-receipt.ts";
import { writeRuns } from "../bridge/orchestra-runs.ts";

export function receiptFixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "attempt-test-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "checkout"));
  writeRuns(root, {});
  const row = {
    realm: "@x/one",
    room: "room",
    invite: 1,
    karta: 3,
    launcher: "own",
    harness: "opencode",
    model: "opaque",
    repository: "example.test/org/repo",
    worktree: join(root, "checkout"),
    state: "preparing",
    at: "now",
  };
  newAttempt(
    root,
    row,
    "http://127.0.0.1:1234",
    { providerID: "fake", id: "fake" },
    'iskron/spawned_for: {"room":"room","invite":1}\nbrief',
  );
  return { root, row, path: row.exec.receipt };
}
