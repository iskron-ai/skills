import assert from "node:assert/strict";
import { test } from "node:test";

import { execPending, observeExec } from "../bridge/exec-exit.ts";
import { launchExec } from "../bridge/exec-launch.ts";
import { quench } from "../bridge/orchestra-quench.ts";
import { LIVE, readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { execFixture } from "./exec-fixture.mjs";

async function emptySeat(f, exec = true) {
  if (exec)
    assert.equal(
      await launchExec(f.auth, f.runs, f.key, f.host, f.spec, "brief", f.bridge),
      "exec_launched",
    );
  const runs = readRuns(f.auth);
  Object.assign(runs[f.key], { state: "raised", standing_id: "seat", rooms: 0, sat: true });
  runs.neighbor = {
    ...structuredClone(runs[f.key]),
    invite: 2,
    standing_id: "neighbor",
    terminal: "term_neighbor",
    rooms: 1,
  };
  delete runs.neighbor.exec;
  writeRuns(f.auth, runs);
  return runs;
}

test("composition 410 preserves the live exec slot and exact-client observation until verified stop", async (t) => {
  const f = await execFixture(t);
  const runs = await emptySeat(f);
  const neighbor = structuredClone(runs.neighbor);
  f.set({ gone: true, waitError: true });
  await quench(f.url, "synthetic", runs, async () => []);
  const r = runs[f.key];
  assert.notEqual(r.state, "ended", "410 is not an observed process exit");
  assert.equal(r.closed, undefined);
  assert.equal(r.exec.exit, undefined);
  assert.equal(LIVE.includes(r.state), true, "the concurrency slot remains occupied");
  assert.deepEqual(runs.neighbor, neighbor);
  writeRuns(f.auth, runs);
  assert.equal(execPending(f.auth), true);

  await observeExec(f.auth, "", null);
  assert.equal(readRuns(f.auth)[f.key].exec.exit, undefined, "failed wait is not exit");
  assert.ok(f.orcaCalls().some((c) => c[0] === "terminal" && c[1] === "wait"));

  f.set({ waitError: false, incarnation: "replacement" });
  await observeExec(f.auth, "", null);
  assert.equal(readRuns(f.auth)[f.key].exec.exit, undefined, "replacement cannot prove exit");

  // The fixture records HTTP attempts as orders too; a 410 created no actual order.
  f.orders.length = 0;
  f.set({ gone: false, incarnation: "incarnation" });
  await observeExec(f.auth, f.url, "synthetic");
  let observed = readRuns(f.auth)[f.key];
  assert.ok(observed.exec.exit, "the retained Run remains observable after 410");
  assert.equal(observed.closed, "client_exited");
  assert.equal(observed.state, "stopping", "exit still needs durable stop confirmation");
  assert.equal(f.orders.at(-1).payload.reason_code, "client_exited");
  f.set({ stopped: true });
  await observeExec(f.auth, f.url, "synthetic");
  observed = readRuns(f.auth)[f.key];
  assert.equal(observed.state, "ended", "verified exit and stop are not blocked forever");
  assert.deepEqual(readRuns(f.auth).neighbor, neighbor);
  assert.equal(f.orcaCalls().filter((c) => c[0] === "terminal" && c[1] === "close").length, 0);
});

test("composition 410 keeps legacy non-exec completion unchanged", async (t) => {
  const f = await execFixture(t);
  const runs = await emptySeat(f, false);
  const neighbor = structuredClone(runs.neighbor);
  f.set({ gone: true });
  await quench(f.url, "synthetic", runs, async () => []);
  assert.equal(runs[f.key].state, "ended");
  assert.equal(runs[f.key].closed, undefined);
  assert.deepEqual(runs.neighbor, neighbor);
});
