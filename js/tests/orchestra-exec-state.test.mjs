import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { execPending } from "../bridge/exec-exit.ts";
import { settleStops } from "../bridge/orchestra-quench.ts";
import { resolveInvite } from "../bridge/orchestra-resolve.ts";
import { readRuns, writeRuns } from "../bridge/orchestra-runs.ts";

const row = {
  realm: "@x/one",
  room: "r",
  invite: 1,
  karta: 3,
  harness: "opencode",
  launcher: "own",
  model: "m",
  state: "raised",
  at: "old",
  terminal: "t",
  runtime: "rt",
  exec: { attempt: "a", session: "s", incarnation: "i" },
};
function fixture(t, value = row) {
  const dir = mkdtempSync(join(tmpdir(), "exec-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeRuns(dir, { own: structuredClone(value) });
  return dir;
}
test("stale exec patch preserves a concurrent durable exit and neighbours", (t) => {
  const dir = fixture(t),
    a = readRuns(dir),
    b = readRuns(dir);
  b.own.exec.exit = "observed";
  b.own.closed = "client_exited";
  b.neighbour = { ...row, terminal: "n" };
  writeRuns(dir, b);
  a.own.why = "independent";
  writeRuns(dir, a);
  const got = readRuns(dir);
  assert.equal(got.own.exec.exit, "observed");
  assert.equal(got.own.closed, "client_exited");
  assert.ok(got.neighbour);
});
test("changed exec incarnation cannot inherit another incarnation's exit", (t) => {
  const dir = fixture(t, { ...row, closed: "client_exited", exec: { ...row.exec, exit: "old" } });
  const a = readRuns(dir);
  a.own.exec.incarnation = "replacement";
  writeRuns(dir, a);
  assert.equal(readRuns(dir).own.exec.exit, undefined);
  assert.equal(readRuns(dir).own.closed, undefined);
});
test("first-seat enrichment does not change the legacy close-invalidation rule", (t) => {
  const dir = fixture(t, {
    ...row,
    exec: undefined,
    standing_id: undefined,
    closed: "client_exited",
  });
  const runs = readRuns(dir);
  runs.own.standing_id = "new-seat";
  writeRuns(dir, runs);
  assert.equal(readRuns(dir).own.closed, undefined);
});
test("exec stopping never completes from expiry or exit alone", () => {
  for (const extra of [{}, { stop_outcome: "failed" }, { stop_outcome: "stopped" }]) {
    const r = { ...row, ...extra, state: "stopping", stopping_at: "2000-01-01" };
    settleStops({ own: r }, [], new Set(), Date.now());
    assert.equal(r.state, "stopping");
  }
});
test("preparing and ambiguity both survive reload and occupy the launcher limit", (t) => {
  for (const state of ["preparing", "ambiguity"]) {
    const dir = fixture(t, { ...row, state });
    const ls = {
      account: "me",
      refused: [],
      elsewhere: new Map(),
      own: new Map([
        [
          "own",
          { launcher: "own", limit: 1, callers: [], harnesses: { opencode: { models: ["m"] } } },
        ],
      ]),
    };
    assert.equal(
      resolveInvite(
        {
          launcher: "own",
          author: "@me",
          harness: "opencode",
          model: "m",
          repository: "example.test/o/r",
        },
        ls,
        readRuns(dir),
      ).code,
      "limit_reached",
    );
    assert.equal(execPending(dir), true);
    assert.equal(
      resolveInvite(
        {
          launcher: "own",
          author: "@me",
          harness: "opencode",
          model: "m",
          repository: "example.test/o/r",
        },
        { ...ls, own: new Map(), elsewhere: new Map([["own", "other-machine"]]) },
        readRuns(dir),
      ).code,
      "host_elsewhere",
      "a live local registry must not turn a foreign machine's launcher into a local offer",
    );
  }
});
test("a corrupt durable registry is not an empty registry allowing duplicate launch", (t) => {
  const dir = fixture(t);
  writeFileSync(join(dir, "run", "orchestra-runs.json"), "{broken");
  assert.throws(() => readRuns(dir), /registry_unreadable/);
  assert.equal(execPending(dir), true);
});
