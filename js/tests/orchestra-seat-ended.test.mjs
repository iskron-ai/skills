import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { quench } from "../bridge/orchestra-quench.ts";
import { reapOwn } from "../bridge/orchestra-reap.ts";
import { LIVE, readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { fixture } from "./tree-fixture.mjs";

for (const mode of [
  "ended",
  "live",
  "failure",
  "404",
  "410",
  "empty",
  "malformed",
  "foreign",
  "bad-date",
]) {
  test(`seat ${mode}: reap only a proven ended seat`, async (t) => {
    const f = fixture(t);
    Object.assign(f.row, {
      state: "raised",
      harness: "opencode",
      standing_id: "seat",
      rooms: 0,
      sat: true,
      terminal: "term",
      runtime: "runtime",
      tree: { incarnation: "inc" },
      ...(mode === "410" ? { idle_due: true } : {}),
    });
    writeRuns(f.auth, f.runs);
    const requests = [];
    const server = createServer((req, res) => {
      requests.push({ url: req.url, method: req.method, auth: req.headers.authorization });
      if (mode === "failure") return req.socket.destroy();
      if (mode === "404") {
        res.writeHead(404);
        return res.end("{}");
      }
      if (mode === "410") {
        res.writeHead(410);
        return res.end("{}");
      }
      if (mode === "malformed") return res.end("not json");
      const items =
        mode === "empty"
          ? []
          : [
              {
                id: mode === "foreign" ? "other" : "seat",
                ended_at:
                  mode === "live" ? null : mode === "bad-date" ? "invalid" : "2026-11-24T00:00:00Z",
              },
            ];
      res.end(JSON.stringify({ items }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const runs = readRuns(f.auth);
    const said = await quench(
      `http://127.0.0.1:${server.address().port}`,
      "machine",
      runs,
      async () => [],
    );
    assert.equal(LIVE.includes(runs.own.state), true, "slot held before client exit");
    const calls = [];
    const reaped = await reapOwn(f.auth, runs, undefined, async (...args) => {
      calls.push([args[0], args[1], args[2](), args[3]]);
      return null;
    });
    const ended = mode === "ended" || mode === "410";
    assert.equal(calls.length, ended ? 1 : 0);
    if (ended) {
      assert.deepEqual(calls[0], [
        "term",
        "runtime",
        true,
        { incarnation: "inc", worktree: f.row.worktree },
      ]);
      assert.ok(runs.own.tree.exit);
      assert.equal(runs.own.closed, "client_exited");
      assert.match([...said, ...reaped].join(), /seat_ended/);
    }
    assert.equal(requests.length, 1);
    assert.equal(requests[0].auth, "Bearer machine");
    assert.equal(requests[0].method, mode === "410" ? "POST" : "GET");
    if (mode !== "410") assert.equal(requests[0].url, "/me/standings?standing=seat");
  });
}
