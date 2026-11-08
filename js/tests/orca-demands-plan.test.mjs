import assert from "node:assert/strict";
import { test } from "node:test";

import { plan } from "../../scripts/orca-demands-plan.mjs";

const schema = {
  commands: [{ command: "agent launch", flags: ["agent", "worktree", "prompt", "model", "json"] }],
};
const row = {
  realm: "@probe/one",
  room: "room-one",
  invite: 7,
  karta: 9,
  repository: "github.com/probe/one",
};
const mapping = [
  {
    repository: row.repository,
    worktree: "/probe/path with spaces",
    agent: "opencode",
    model: "example",
  },
];
const snapshot = { schema_version: 1, complete: true, start: [row] };

test("Orca recipe only plans argv and never claims a launch or a spawned_for binding", () => {
  const out = plan(snapshot, mapping, schema);
  assert.equal(out.executed, false);
  assert.equal(out.launch_verified, false);
  assert.equal(out.dry_run, true);
  assert.deepEqual(out.plans[0].spawned_for, { invite: 7, room: "room-one" });
  assert.equal(out.plans[0].argv[5], "path:/probe/path with spaces");
  assert.ok(!out.plans[0].argv.includes("--dry-run"), "Orca launch has no such flag");
});

test("Orca recipe refuses incomplete, ambiguous, unmapped and schema-incompatible plans", () => {
  for (const [s, m, c] of [
    [{ ...snapshot, complete: false }, mapping, schema],
    [snapshot, [], schema],
    [snapshot, [...mapping, ...mapping], schema],
    [snapshot, [{ ...mapping[0], worktree: "relative" }], schema],
    [snapshot, mapping, { commands: [] }],
    [{ ...snapshot, start: [row, row] }, mapping, schema],
  ])
    assert.throws(() => plan(s, m, c));
});
