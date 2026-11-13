// The stop after an observed exit of a tree run (graph @nks/nks-dev, #9256, #9969): the API
// knows no client_exited reason (422 stop_reason_unknown) and answers an ended seat with 410
// standing_already_ended. Real local Git; the API is a fixture.
import "./built.mjs";

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { observeExec } from "../bridge/exec-exit.ts";
import { LIVE, readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { prepareTree } from "../bridge/orchestra-tree.ts";
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

async function exited(t) {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  Object.assign(f.row, { state: "raised", standing_id: "seat", closed: "client_exited" });
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

test("exit stop: any other refusal keeps the slot and names its status", async (t) => {
  const f = await exited(t);
  const a = await api(t, () => [404, { errors: [{ rule: "standing_not_found" }] }]);
  await observeExec(f.auth, a.url, "synthetic");
  const own = readRuns(f.auth).own;
  assert.equal(own.state, "raised");
  assert.equal(own.why, "exec_stop_unconfirmed_404");
});
