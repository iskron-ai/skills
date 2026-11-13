// The stop after an observed exit of a tree run (graph @nks/nks-dev, #9256, #9969): the API
// knows no client_exited reason (422 stop_reason_unknown) and answers an ended seat with 410
// standing_already_ended. Real local Git; the API is a fixture.
import "./built.mjs";

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { test } from "node:test";

import { observeExec } from "../bridge/exec-exit.ts";
import { LIVE, readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { BRIEF_MAX, startRun } from "../bridge/orchestra-start.ts";
import { prepareTree } from "../bridge/orchestra-tree.ts";
import { ORCHESTRA, SPAWN_LINE } from "../delivery/index.ts";
import { words } from "../shared/lang.ts";
import { fixture } from "./tree-fixture.mjs";

async function api(t, answer) {
  const stops = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    let status = 200,
      out = {};
    if (req.url.includes("/raised?")) out = { cursor: "c", items: [] };
    else if (req.url.startsWith("/me/orders")) out = { items: [], next_since: 1 };
    else if (req.url === "/standings/seat/stop") {
      const payload = JSON.parse(body || "{}");
      stops.push(payload);
      [status, out] = answer(payload, stops.length);
    } else status = 404;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${server.address().port}`, stops };
}

async function exited(t, closed = "client_exited") {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  Object.assign(f.row, {
    state: "raised",
    standing_id: "seat",
    harness: "opencode",
    ...(closed && { closed }),
  });
  f.row.tree.exit = "observed-exit";
  writeRuns(f.auth, f.runs);
  return f;
}

const unknownReason = [
  422,
  {
    errors: [
      {
        rule: "stop_reason_unknown",
        data: { allowed: ["person_request", "composition_empty", "other"] },
      },
    ],
  },
];

test("exit stop: an unknown client_exited reason is retried once as other and takes the order", async (t) => {
  const f = await exited(t);
  const a = await api(t, (p) =>
    p.reason_code === "client_exited" ? unknownReason : [201, { id: "order-1" }],
  );
  await observeExec(f.auth, a.url, "synthetic");
  assert.deepEqual(
    a.stops.map((s) => s.reason_code),
    ["client_exited", "other"],
  );
  assert.equal(a.stops[0].client_id, a.stops[1].client_id, "one idempotent order, not two");
  const own = readRuns(f.auth).own;
  assert.equal(own.state, "stopping");
  assert.equal(own.order_id, "order-1");
});

test("exit stop: an ended seat (410 standing_already_ended) ends the exited tree run and frees its slot", async (t) => {
  const f = await exited(t);
  const a = await api(t, () => [410, { errors: [{ rule: "standing_already_ended" }] }]);
  await observeExec(f.auth, a.url, "synthetic");
  const own = readRuns(f.auth).own;
  assert.equal(own.state, "ended");
  assert.equal(own.why, "seat_gone_after_exit");
  assert.equal(LIVE.includes(own.state), false);
});

test("exit stop: a failed order after the exit stops once more and ends only on an ended seat", async (t) => {
  const f = await exited(t);
  const a = await api(t, () => [410, { errors: [{ rule: "standing_already_ended" }] }]);
  Object.assign(f.row, { state: "stopping", order_id: "order", stop_outcome: "failed" });
  writeRuns(f.auth, f.runs);
  await observeExec(f.auth, a.url, "synthetic");
  assert.equal(a.stops.length, 1, "one stop by the exit reason replaces the failed order");
  assert.equal(readRuns(f.auth).own.state, "ended");
  assert.equal(readRuns(f.auth).own.why, "seat_gone_after_exit");
  assert.equal(readRuns(f.auth).own.tree.state, "removed", "the clean tree of a gone client goes");
  assert.equal(existsSync(f.row.worktree), false);

  // The seat is not proven over: the slot and the tree stay.
  const h = await exited(t);
  const b = await api(t, () => [500, {}]);
  Object.assign(h.row, { state: "stopping", order_id: "order", stop_outcome: "failed" });
  writeRuns(h.auth, h.runs);
  await observeExec(h.auth, b.url, "synthetic");
  assert.equal(readRuns(h.auth).own.state, "stopping");
  assert.equal(readRuns(h.auth).own.tree.state, "ready");

  const g = await exited(t, null);
  Object.assign(g.row, { state: "stopping", order_id: "order", stop_outcome: "failed" });
  writeRuns(g.auth, g.runs);
  await observeExec(g.auth, a.url, "synthetic");
  assert.equal(readRuns(g.auth).own.state, "stopping");
});

test("exit stop: another harness's exited tree run does not end on a 410", async (t) => {
  const f = await exited(t);
  f.row.harness = "claude";
  writeRuns(f.auth, f.runs);
  const a = await api(t, () => [410, { errors: [{ rule: "standing_already_ended" }] }]);
  await observeExec(f.auth, a.url, "synthetic");
  const own = readRuns(f.auth).own;
  assert.notEqual(own.state, "ended");
  assert.equal(own.why, "exec_suppression_unverified");
});

test("exit stop: an ended seat after exit frees the slot and the clean tree goes", async (t) => {
  const f = await exited(t);
  const a = await api(t, () => [410, { errors: [{ rule: "standing_already_ended" }] }]);
  await observeExec(f.auth, a.url, "synthetic");
  const own = readRuns(f.auth).own;
  assert.equal(own.why, "seat_gone_after_exit");
  assert.equal(own.tree.state, "removed", "no endless cleanup of a ready tree");
  assert.equal(existsSync(f.row.worktree), false);
});

test("brief: a line past the paste limit is refused before any tree or run", async () => {
  const runs = {};
  const own = { launcher: "orca", harnesses: { opencode: { models: ["m"] } }, homes: {} };
  const row = {
    realm: `@${"x".repeat(200)}/graph`,
    room: "201b813e-a41d-42c7-b869-a70e032c85e8",
    invite: 1,
    karta: 931,
    harness: "opencode",
    model: "m",
  };
  const why = await startRun("/nonexistent", row, own, "repo", "/nonexistent", runs, "k", null);
  assert.equal(why, "brief_too_long");
  assert.deepEqual(runs, {});
});

test("brief: a long graph and a large invite still fit the limit", () => {
  const line =
    `${SPAWN_LINE} ${JSON.stringify({ invite: 999999, room: "201b813e-a41d-42c7-b869-a70e032c85e8" })} ` +
    words(ORCHESTRA).brief(
      `@${"o".repeat(20)}/${"g".repeat(20)}`,
      931,
      "201b813e-a41d-42c7-b869-a70e032c85e8",
      999999,
    );
  assert.ok(line.length <= BRIEF_MAX, `${line.length}: ${line}`);
});

test("exit stop: any other refusal keeps the slot and names its status", async (t) => {
  const f = await exited(t);
  const a = await api(t, () => [404, { errors: [{ rule: "standing_not_found" }] }]);
  await observeExec(f.auth, a.url, "synthetic");
  const own = readRuns(f.auth).own;
  assert.equal(own.state, "raised");
  assert.equal(own.why, "exec_stop_unconfirmed_404");
});
