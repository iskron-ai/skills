// The dormancy's arming (graph @nks/nks-dev, #10995): a cleanly exited dsh run whose case is
// still open sleeps — the whole journal read once for the cursor, the seat ids, the invited
// role's uuid and the seat's own asks; a closed case or a failed read keeps the end. The REST
// form is a local stand-in; the daemon-level probes walk the real bridge.
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { dshSleepable, goDormant } from "../bridge/orchestra-dsh-dormant.ts";

const SEAT = "11111111-1111-4111-8111-111111111111";
const OTHER = "44444444-4444-4444-8444-444444444444";
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

/** A stand-in case server: status "open" unless refused, the entries after the cursor. */
async function caseApi(t, { status = "open", entries = [], refuse = 0 } = {}) {
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (refuse) return res.writeHead(503).end("{}");
    if (!req.url.includes("/history")) return res.end(JSON.stringify({ status }));
    const since = Number(new URL(req.url, "http://x").searchParams.get("since"));
    const items = entries.filter((e) => e.id > since);
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
  return `http://127.0.0.1:${server.address().port}`;
}

const exitedRun = (over = {}) => ({
  realm: "@nks/test",
  room: "room-1",
  invite: 9,
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

test("dormancy: a clean exit with the case open sleeps on the journal's last entry", async (t) => {
  const base = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(10, "ask", { author_standing_id: SEAT, to_standing_id: OTHER }),
      entry(11, "said", { to_standing_id: SEAT }),
    ],
  });
  const r = exitedRun();
  assert.equal(await goDormant(base, "key", r), true);
  assert.equal(r.state, "dormant");
  assert.equal(r.dormant.cursor, 11);
  assert.deepEqual(r.dormant.seats, [SEAT]);
  assert.equal(r.dormant.karta, KARTA, "the invited role's uuid comes from the invite entry");
  assert.deepEqual(r.dormant.asks, { 10: SEAT }, "the seat's own asks are kept for answers");
});

test("dormancy: the seats collect the row's own id and every earlier one", async (t) => {
  const base = await caseApi(t, { entries: [entry(9, "invite")] });
  const r = exitedRun({ dormant: { since: "2026-11-01T00:00:00Z", cursor: 3, seats: [OTHER] } });
  assert.equal(await goDormant(base, "key", r), true);
  assert.deepEqual(r.dormant.seats, [OTHER, SEAT]);
});

test("dormancy: a closed case, a refused read and an unclean exit keep the end", async (t) => {
  const closed = exitedRun();
  assert.equal(await goDormant(await caseApi(t, { status: "closed" }), "key", closed), false);
  assert.equal(closed.state, "ended");
  const refused = exitedRun();
  assert.equal(await goDormant(await caseApi(t, { refuse: 1 }), "key", refused), false);
  assert.equal(refused.state, "ended");
  assert.equal(
    dshSleepable(
      exitedRun({ dsh: { pid: 1, events: "/e", final: "stopped", exit: "0", session: "s" } }),
    ),
    false,
  );
  assert.equal(
    dshSleepable(
      exitedRun({ dsh: { pid: 1, events: "/e", final: "completed", exit: "5", session: "s" } }),
    ),
    false,
  );
  assert.equal(
    dshSleepable(exitedRun({ dsh: { pid: 1, events: "/e", final: "completed", exit: "0" } })),
    false,
    "no session to continue — no sleep",
  );
  const noTree = exitedRun({ tree: { state: "removed" } });
  assert.equal(await goDormant(await caseApi(t), "key", noTree), false, "a gone tree cannot sleep");
});
