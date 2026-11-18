// The entry into a dsh call's sleep (graph @nks/nks-dev, #10995; full review of the 8.14.0
// candidate): a waking word whose body has not landed holds the entry cursor before it.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { goDormant, stepDormant } from "../bridge/orchestra-dsh-dormant.ts";

const SEAT = "11111111-1111-4111-8111-111111111111";
const KARTA = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const entry = (id, kind, fields = {}) => ({
  id,
  kind,
  to_standing_id: null,
  to_karta_node_id: null,
  in_reply_to: null,
  author_standing_id: LEAD,
  author: "@tester:lead",
  payload: {},
  ...fields,
});

/** A stand-in case door counting every request it answers. */
async function caseApi(t, entries) {
  const state = { entries, requests: 0 };
  const server = createServer((req, res) => {
    state.requests++;
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/nodes/"))
      return res.end(
        JSON.stringify({
          seq: 931,
          node_type: "karta",
          is_active: true,
          manifested_as: "adhikarin",
        }),
      );
    if (!req.url.includes("/history")) return res.end(JSON.stringify({ status: "open" }));
    const since = Number(new URL(req.url, "http://x").searchParams.get("since"));
    const items = state.entries.filter((e) => e.id > since);
    res.end(JSON.stringify({ items, cursor: items.at(-1)?.id ?? since, numbering: "case" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, state };
}

const exited = (over = {}) => ({
  realm: "@nks/test",
  author: "@tester:lead",
  room: "room-1",
  invite: 900,
  karta: 931,
  launcher: "l",
  harness: "dsh",
  model: "m",
  repository: "r",
  worktree: "/tree",
  state: "ended",
  at: "2026-11-01T00:00:00Z",
  standing_id: SEAT,
  why: "seat_gone_after_exit",
  tree: { state: "ready" },
  dsh: { pid: 1, events: "/e", final: "completed", exit: "0", session: "s-1" },
  ...over,
});

const launchers = {
  account: "tester",
  own: new Map([
    [
      "l",
      {
        launcher: "l",
        adapter: "bridge",
        callers: [],
        limit: 1,
        harnesses: { dsh: { models: ["m"], dsh: { bin: null, patch: null } } },
      },
    ],
  ]),
  elsewhere: new Map(),
  refused: [],
};

test("entry: a said still waiting for its body before the seat's partial wakes once its body lands", async (t) => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { writeRuns } = await import("../bridge/orchestra-runs.ts");
  // The reviewer's scenario: said[902] body_pending, then the seat's progress[903] partial.
  const pending = entry(902, "said", { to_standing_id: SEAT, body_pending: true });
  const partial = entry(903, "progress", {
    author_standing_id: SEAT,
    line: { key: "share", verdict: "partial" },
  });
  const api = await caseApi(t, [
    entry(900, "invite", { to_karta_node_id: KARTA }),
    entry(901, "said", { to_standing_id: SEAT }),
    pending,
    partial,
  ]);
  const r = exited();
  assert.equal(await goDormant(api.base, "key", r), true);
  assert.equal(r.dormant.cursor, 901, "the cursor stays before the word without its body");
  const runs = { k: r };
  const dir = mkdtempSync(join(tmpdir(), "dsh-entry-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeRuns(dir, runs);
  const calls = [];
  const launch = async (_a, rs, key, _s, brief) => {
    calls.push(brief);
    rs[key].state = "launched";
    return "launched";
  };
  const now = Date.now();
  await stepDormant(dir, api.base, "key", runs, launchers, undefined, now, launch);
  assert.equal(calls.length, 0, "no body yet — no wake");
  api.state.entries[2] = { ...pending, body_pending: false };
  const out = await stepDormant(dir, api.base, "key", runs, launchers, undefined, now, launch);
  assert.equal(calls.length, 1, out.join("; "));
  assert.ok(calls[0].includes("[902]"), calls[0]);
  // Back to sleep on the same cursor: the same word never wakes twice.
  r.state = "dormant";
  writeRuns(dir, runs);
  await stepDormant(dir, api.base, "key", runs, launchers, undefined, now, launch);
  assert.equal(calls.length, 1, "exactly one continuation");
});

test("entry: words the agent had behind the pending one do not wake again", async (t) => {
  const pending = entry(902, "said", { to_standing_id: SEAT, body_pending: true });
  const api = await caseApi(t, [
    entry(900, "invite", { to_karta_node_id: KARTA }),
    pending,
    entry(903, "said", { to_standing_id: SEAT }),
    entry(904, "progress", { author_standing_id: SEAT, line: { key: "s", verdict: "partial" } }),
  ]);
  const r = exited();
  assert.equal(await goDormant(api.base, "key", r), true);
  assert.equal(r.dormant.cursor, 901);
  assert.deepEqual(r.dormant.seen, [903], "the had word is kept as seen");
});
