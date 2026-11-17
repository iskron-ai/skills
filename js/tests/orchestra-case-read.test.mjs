import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  parseCasePage,
  parseCaseStatus,
  readCaseHistory,
  readCaseStatus,
} from "../bridge/orchestra-case-read.ts";

test("case history pages by cursor with the orchestrator identity, until a page is empty", async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("content-type", "application/json");
    const q = new URL(req.url, "http://x").searchParams;
    const since = Number(q.get("since"));
    // Two entries per page: the reader must walk to the empty one.
    const items = [
      { id: since + 1, kind: "said", payload: {} },
      { id: since + 2, kind: "said", payload: {} },
    ].filter((e) => e.id <= 4);
    res.end(
      JSON.stringify({
        items,
        cursor: items.length ? items[items.length - 1].id : since,
        numbering: "case",
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const read = await readCaseHistory(base, "secret", "room/id", 0);
  assert.equal(read.entries.length, 4);
  assert.equal(read.cursor, 4);
  assert.deepEqual(
    requests,
    [
      "/rooms/room%2Fid/history?since=0&limit=200&advance=false",
      "/rooms/room%2Fid/history?since=2&limit=200&advance=false",
      "/rooms/room%2Fid/history?since=4&limit=200&advance=false",
    ],
    "the cursor walks page by page, never advancing the platform's own",
  );
});

test("case history names a standing_required refusal by its rule and says it aloud", async (t) => {
  const requests = [];
  const said = [];
  const stderr = process.stderr.write;
  process.stderr.write = (c) => (said.push(String(c)), true);
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.setHeader("content-type", "application/json");
    res.writeHead(409).end(JSON.stringify({ errors: [{ rule: "standing_required" }] }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.close();
    process.stderr.write = stderr;
  });
  await assert.rejects(
    readCaseHistory(`http://127.0.0.1:${server.address().port}`, "secret", "room-1", 0),
    /api_defect_standing_required/,
  );
  assert.ok(requests[0].includes("advance=false"), requests[0]);
  assert.ok(requests[0].includes("since=0"), requests[0]);
  assert.ok(
    said.some((line) => line.includes("case_history_standing_required_under_advance_false")),
    "the api defect is said aloud in the journal",
  );
});

test("case history parses the holder's entry form and keeps the payload's reason", () => {
  const page = parseCasePage({
    items: [
      {
        id: 12,
        kind: "left",
        to_standing_id: null,
        to_karta_node_id: null,
        in_reply_to: null,
        author_standing_id: "11111111-1111-4111-8111-111111111111",
        author: "@tester:seat",
        payload: { reason: "revoked" },
      },
    ],
    cursor: 12,
    numbering: "case",
  });
  assert.equal(page.entries[0].n, 12);
  assert.equal(page.entries[0].reason, "revoked");
  assert.equal(page.entries[0].author_standing_id, "11111111-1111-4111-8111-111111111111");
});

test("case history refuses forms that are not the holder's page", () => {
  assert.throws(() => parseCasePage([{ id: 1 }]), /history_not_page/);
  assert.throws(() => parseCasePage({ items: {} }), /history_not_list/);
  assert.throws(() => parseCasePage({ items: [{ kind: "said" }] }), /invalid_entry/);
  assert.throws(() => parseCasePage({ items: [], cursor: "4" }), /invalid_cursor/);
});

test("case history stalls when pages never advance", async (t) => {
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ items: [{ id: 2, kind: "said" }], cursor: 1 }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  await assert.rejects(
    readCaseHistory(`http://127.0.0.1:${server.address().port}`, "key", "id", 1),
    /history_stalled/,
  );
});

test("case status maps the platform's four states onto open|closed", async (t) => {
  assert.equal(parseCaseStatus({ status: "open" }), "open");
  assert.equal(parseCaseStatus({ status: "closing" }), "open");
  assert.equal(parseCaseStatus({ status: "closed" }), "closed");
  assert.equal(parseCaseStatus({ status: "abandoned" }), "closed");
  assert.throws(() => parseCaseStatus({ status: "wednesday" }), /case_status_unknown/);
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ status: "open" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  assert.equal(
    await readCaseStatus(`http://127.0.0.1:${server.address().port}`, "secret", "room-1"),
    "open",
  );
  assert.equal(requests[0].url, "/rooms/room-1");
  assert.equal(requests[0].auth, "Bearer secret");
});
