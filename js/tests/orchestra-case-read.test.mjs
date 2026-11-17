import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { readCaseHistory } from "../bridge/orchestra-case-read.ts";

test("case history uses the orchestrator identity without advancing the platform cursor", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization, session: req.headers["x-nks-session-id"] });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ entry_id: 12, kind: "said" }]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const entries = await readCaseHistory(base, "secret", "room/id", 11);
  assert.equal(entries[0].entry_id, 12);
  assert.equal(requests[0].url, "/rooms/room%2Fid/history?advance=false&since=11");
  assert.equal(requests[0].auth, "Bearer secret");
  assert.ok(requests[0].session);
});

test("case history refuses an entry without a usable journal number", async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify([{ kind: "said" }]));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  await assert.rejects(readCaseHistory(`http://127.0.0.1:${server.address().port}`, "key", "id"));
});
