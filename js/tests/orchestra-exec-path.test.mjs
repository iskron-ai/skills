import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { exitClientId, observeExec } from "../bridge/exec-exit.ts";
import { launchExec } from "../bridge/exec-launch.ts";
import { readRuns } from "../bridge/orchestra-runs.ts";
import { execFixture } from "./exec-fixture.mjs";

const brief =
  'iskron/spawned_for: {"room":"room","invite":1}\nquotes: \' " $HOME `not-a-command`\nsecond line';
const launch = (f) => launchExec(f.auth, f.runs, f.key, f.host, f.spec, brief, f.bridge);
test("one integrated API brief → exec session → durable exit → ordinary stop, no close", async (t) => {
  const f = await execFixture(t);
  assert.equal(await launch(f), "exec_launched");
  const r = readRuns(f.auth)[f.key];
  assert.equal(r.exec.session, "ses_fake");
  assert.equal(r.exec.incarnation, "incarnation");
  assert.deepEqual(JSON.parse(readFileSync(`${f.root}/tui.json`)), [
    "--server",
    f.url,
    "--session",
    "ses_fake",
    `${f.root}/checkout`,
  ]);
  assert.equal(
    f.calls.find((c) => c.path === "/api/session" && c.method === "POST").phase,
    "create-sent",
  );
  const prompt = f.calls.find((c) => c.path.endsWith("/prompt"));
  assert.equal(prompt.phase, "prompt-sent");
  assert.deepEqual(prompt.payload, { text: brief });
  await observeExec(f.auth, f.url, "synthetic");
  assert.equal(f.orders.length, 1);
  assert.equal(f.orders[0].payload.reason_code, "client_exited");
  assert.equal(f.orders[0].row.closed, "client_exited");
  assert.ok(f.orders[0].row.exec.exit);
  assert.equal(f.orders[0].payload.client_id, exitClientId(readRuns(f.auth)[f.key]));
  assert.equal(readRuns(f.auth)[f.key].state, "stopping", "exit alone is not suppression");
  f.set({ stopped: true });
  await observeExec(f.auth, f.url, "synthetic");
  assert.equal(readRuns(f.auth)[f.key].state, "ended");
  assert.equal(f.orcaCalls().filter((c) => c[0] === "terminal" && c[1] === "close").length, 0);
  assert.equal(f.orcaCalls().filter((c) => c[0] === "terminal" && c[1] === "create").length, 1);
});
for (const controls of [{ target: "remote" }, { hostMismatch: true }]) {
  test(`preflight rejects ${JSON.stringify(controls)} before create`, async (t) => {
    const f = await execFixture(t);
    f.set(controls);
    assert.equal(await launch(f), "exec_runtime_unverified");
    assert.equal(
      f.orcaCalls().some((c) => c[0] === "terminal"),
      false,
    );
    assert.equal(f.calls.length, 0);
  });
}
for (const [control, phase] of [
  ["createApiUnknown", "create-sent"],
  ["promptUnknown", "prompt-sent"],
  ["createUnknown", "planned"],
]) {
  test(`unknown ${control} occupies the key without any retry`, async (t) => {
    const f = await execFixture(t);
    f.set({ [control]: true });
    assert.equal(await launch(f), "exec_ambiguity");
    await observeExec(f.auth, "", null);
    const r = readRuns(f.auth)[f.key];
    assert.equal(r.state, "ambiguity");
    const receipt = JSON.parse(readFileSync(r.exec.receipt));
    assert.equal(receipt.phase, phase === "planned" ? "planned" : "ambiguity");
    assert.equal(f.orcaCalls().filter((c) => c[0] === "terminal" && c[1] === "create").length, 1);
    assert.ok(f.calls.filter((c) => c.method === "POST" && c.path === "/api/session").length <= 1);
  });
}
for (const controls of [{ waitError: true }, { showError: true }, { incarnation: "replacement" }]) {
  test(`unverified exit ${JSON.stringify(controls)} cannot issue stop`, async (t) => {
    const f = await execFixture(t);
    await launch(f);
    f.set(controls);
    await observeExec(f.auth, f.url, "synthetic");
    assert.equal(f.orders.length, 0);
    assert.equal(readRuns(f.auth)[f.key].exec.exit, undefined);
  });
}
test("410 without durable halt is not completed quit and stop retry keeps its client_id", async (t) => {
  const f = await execFixture(t);
  await launch(f);
  f.set({ gone: true });
  await observeExec(f.auth, f.url, "synthetic");
  await observeExec(f.auth, f.url, "synthetic");
  assert.equal(f.orders.length, 2);
  assert.equal(f.orders[0].payload.client_id, f.orders[1].payload.client_id);
  assert.notEqual(readRuns(f.auth)[f.key].state, "ended");
});
