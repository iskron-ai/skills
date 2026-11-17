// The dormancy's arming and tact (graph @nks/nks-dev, #10995): a cleanly exited dsh run whose
// case is still open sleeps — the whole journal read once for the cursor, the seat ids, the
// invited role's uuid and the seat's own asks; the tact then reads from the cursor and wakes,
// ends or advances it by the journal's words. The REST form is a local stand-in; the
// daemon-level probes walk the real bridge (orchestra-dsh-continue.test.mjs).
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import {
  dormantFromEnds,
  dshSleepable,
  goDormant,
  stepDormant,
} from "../bridge/orchestra-dsh-dormant.ts";

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

/** A stand-in case server whose status and entries the probe may switch mid-flight;
 * refuse: true — both doors, "status" / "history" — one of them (a transient 5xx). */
async function caseApi(t, { status = "open", entries = [], refuse = 0 } = {}) {
  const state = { status, entries, refuse };
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const history = req.url.includes("/history");
    if (
      state.refuse === true ||
      (state.refuse === "history" && history) ||
      (state.refuse === "status" && !history)
    )
      return res.writeHead(503).end("{}");
    if (!history) return res.end(JSON.stringify({ status: state.status }));
    const since = Number(new URL(req.url, "http://x").searchParams.get("since"));
    const items = state.entries.filter((e) => e.id > since);
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
  return { base: `http://127.0.0.1:${server.address().port}`, state };
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

const sleepingRow = (over = {}) => ({
  ...exitedRun(),
  state: "dormant",
  dormant: { since: "2026-11-01T01:00:00Z", cursor: 9, seats: [SEAT], karta: KARTA, asks: {} },
  ...over,
});

/** The launcher of the tact: one dsh offer, limit 1; launch records and stays a stub. */
const launchers = (limit = 1) => ({
  own: new Map([
    [
      "l",
      {
        launcher: "l",
        limit,
        harnesses: { dsh: { models: ["m"], dsh: { bin: null, patch: null } } },
      },
    ],
  ]),
  elsewhere: new Map(),
  refused: [],
});

const launchStub = () => {
  const calls = [];
  return {
    calls,
    run: async (_authDir, runs, key, spec, brief) => {
      calls.push({ key, spec, brief, row: runs[key] });
      runs[key].state = "launched";
      return "launched";
    },
  };
};

/** Inside the sleep's window: the rows lie down at 01:00, the window is three hours. */
const AWAKE_NOW = Date.parse("2026-11-01T02:00:00Z");

test("dormancy: a clean exit with the case open sleeps on the seat's own last word", async (t) => {
  const api = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(10, "ask", { author_standing_id: SEAT, to_standing_id: OTHER }),
      entry(11, "said", { to_standing_id: SEAT }),
    ],
  });
  const r = exitedRun();
  assert.equal(await goDormant(api.base, "key", r), true);
  assert.equal(r.state, "dormant");
  assert.equal(r.dormant.cursor, 10, "the cursor lands on the seat's own last word, not the journal's end");
  assert.deepEqual(r.dormant.seats, [SEAT]);
  assert.equal(r.dormant.karta, KARTA, "the invited role's uuid comes from the invite entry");
  assert.deepEqual(r.dormant.asks, { 10: SEAT }, "the seat's own asks are kept for answers");
});

test("dormancy: the cursor keeps a said that came after the seat's last word, and it wakes", async (t) => {
  const api = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(10, "line", { author_standing_id: SEAT }),
      entry(11, "said", { to_standing_id: SEAT }),
    ],
  });
  const r = exitedRun();
  assert.equal(await goDormant(api.base, "key", r), true);
  assert.equal(r.dormant.cursor, 10, "a word past the seat's last move is not swallowed by the arming read");
  // The next tact reads from that cursor and the said still wakes the continuation.
  const runs = { k: r };
  const launch = launchStub();
  await stepDormant("/tmp/unused", api.base, "key", runs, launchers(), undefined, AWAKE_NOW, launch.run);
  assert.equal(r.state, "launched", "the said after the seat's last word wakes");
  assert.equal(r.dormant.cursor, 11);
  assert.equal(launch.calls.length, 1);
});

test("dormancy: no word of the call's own seats — the invite's number is the cursor floor", async (t) => {
  const api = await caseApi(t, { entries: [entry(9, "invite", { to_karta_node_id: KARTA })] });
  const r = exitedRun();
  assert.equal(await goDormant(api.base, "key", r), true);
  assert.equal(r.dormant.cursor, 9);
});


test("dormancy: the seats collect the row's own id and every earlier one", async (t) => {
  const api = await caseApi(t, { entries: [entry(9, "invite")] });
  const r = exitedRun({ dormant: { since: "2026-11-01T00:00:00Z", cursor: 3, seats: [OTHER] } });
  assert.equal(await goDormant(api.base, "key", r), true);
  assert.deepEqual(r.dormant.seats, [OTHER, SEAT]);
});

test("dormancy: a definitively closed case and an unclean exit keep the end", async (t) => {
  const closed = exitedRun();
  assert.equal(
    await goDormant((await caseApi(t, { status: "closed" })).base, "key", closed),
    false,
  );
  assert.equal(closed.state, "ended");
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
  assert.equal(
    await goDormant((await caseApi(t)).base, "key", noTree),
    false,
    "a gone tree cannot sleep",
  );
});

test("dormancy: a transient read refusal sleeps the row on the invite floor, not the end", async (t) => {
  // A 5xx names neither open nor closed: only a definitive closed|abandoned may end the run —
  // the row sleeps with the error named, the tree stays, and the tact retries the read.
  const status = exitedRun();
  assert.equal(
    await goDormant((await caseApi(t, { refuse: "status" })).base, "key", status),
    true,
  );
  assert.equal(status.state, "dormant");
  assert.equal(status.why, "dormant_read_error");
  assert.equal(status.dormant.cursor, 9, "the invite's number is the floor");
  assert.deepEqual(status.dormant.seats, [SEAT]);
  const history = exitedRun();
  assert.equal(
    await goDormant((await caseApi(t, { refuse: "history" })).base, "key", history),
    true,
  );
  assert.equal(history.state, "dormant");
  assert.equal(history.why, "dormant_read_error");
  assert.equal(history.dormant.cursor, 9);
  // The window still counts on an error-armed row: the sleep cannot outlive it on a dead api.
  const api = await caseApi(t, { refuse: true });
  const aged = sleepingRow({
    dormant: { ...sleepingRow().dormant, since: "2026-10-01T00:00:00Z" },
  });
  aged.why = "dormant_read_error";
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: aged },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(aged.state, "ended");
  assert.equal(aged.why, "dormant_window");
});

test("dormant tact: a said to the seat, an ask to the role and an answer to the seat's ask wake", async (t) => {  const api = await caseApi(t, { entries: [entry(9, "invite", { to_karta_node_id: KARTA })] });
  const launch = launchStub();
  const cases = [
    [entry(10, "said", { to_standing_id: SEAT }), "a said to the call's seat"],
    [entry(10, "ask", { to_karta_node_id: KARTA }), "an ask to the invited role"],
    [
      entry(10, "answer", { in_reply_to: 7 }),
      "an answer to the seat's own ask",
      { asks: { 7: SEAT } },
    ],
  ];
  for (const [e, name, over] of cases) {
    const r = sleepingRow(over ? { dormant: { ...sleepingRow().dormant, ...over } } : {});
    api.state.entries = [entry(9, "invite", { to_karta_node_id: KARTA }), e];
    const runs = { k: r };
    const said = await stepDormant(
      "/tmp/unused",
      api.base,
      "key",
      runs,
      launchers(),
      undefined,
      AWAKE_NOW,
      launch.run,
    );
    assert.equal(r.state, "launched", name);
    assert.equal(r.dormant.cursor, 10, `${name}: the cursor lands on the waking entry`);
    assert.ok(said.join("; ").includes("dormant_woken_10"), name);
    assert.equal(
      launch.calls.at(-1).brief.includes("[10]"),
      true,
      `${name}: the brief names the entry`,
    );
  }
});

test("dormant tact: the call's own words never wake it", async (t) => {
  const api = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(12, "said", { author_standing_id: SEAT, to_standing_id: SEAT }),
      entry(13, "ask", { author_standing_id: SEAT, to_karta_node_id: KARTA }),
    ],
  });
  const r = sleepingRow();
  const runs = { k: r };
  await stepDormant("/tmp/unused", api.base, "key", runs, launchers(), undefined, AWAKE_NOW, launchStub().run);
  assert.equal(r.state, "dormant", "a said or an ask authored by the seat itself wakes nothing");
  assert.equal(r.dormant.cursor, 13, "the cursor still takes the read in");
});

test("dormant tact: the page is decided whole — an end anywhere beats an earlier waking word", async (t) => {
  const api = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(10, "said", { to_standing_id: SEAT }),
      entry(11, "closed"),
    ],
  });
  const r = sleepingRow();
  const launch = launchStub();
  await stepDormant("/tmp/unused", api.base, "key", { k: r }, launchers(), undefined, AWAKE_NOW, launch.run);
  assert.equal(r.state, "ended", "a closed entry later on the same read ends the sleep");
  assert.equal(r.why, "dormant_case_closed");
  assert.equal(r.dormant.cursor, 11);
  assert.equal(launch.calls.length, 0, "no continuation launches on a read that ends the sleep");
  // Without an end the same waking word still launches.
  api.state.entries = [entry(9, "invite", { to_karta_node_id: KARTA }), entry(10, "said", { to_standing_id: SEAT })];
  const other = sleepingRow();
  await stepDormant("/tmp/unused", api.base, "key", { k: other }, launchers(), undefined, AWAKE_NOW, launch.run);
  assert.equal(other.state, "launched");
});

test("dormant tact: an answer to a stranger's ask, a said to another seat and other kinds only move the cursor", async (t) => {
  const api = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(10, "said", { to_standing_id: OTHER }),
      entry(11, "answer", { in_reply_to: 8 }),
      entry(12, "ack", { to_standing_id: SEAT }),
      entry(13, "line", {}),
    ],
  });
  const r = sleepingRow();
  const runs = { k: r };
  const said = await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    runs,
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(r.state, "dormant");
  assert.equal(r.dormant.cursor, 13, "the read is taken in, nothing wakes");
  assert.equal(said.length, 0);
});

test("dormant tact: a closed entry and a closed or abandoned status end the sleep", async (t) => {
  const api = await caseApi(t, {
    entries: [entry(9, "invite", { to_karta_node_id: KARTA }), entry(10, "closed")],
  });
  const closed = sleepingRow();
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: closed },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(closed.why, "dormant_case_closed");
  api.state.entries = [entry(9, "invite", { to_karta_node_id: KARTA })];
  api.state.status = "abandoned";
  const abandoned = sleepingRow();
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: abandoned },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(abandoned.state, "ended");
  assert.equal(abandoned.why, "dormant_case_closed");
});

test("dormant tact: the seat's left ladder — the first left is our exit stop's, a later one ends", async (t) => {
  const invite = entry(9, "invite", { to_karta_node_id: KARTA });
  const left = (n, reason) => entry(n, "left", { author_standing_id: SEAT, payload: { reason } });
  // The journal cannot tell our own exit-stop's left from the seat's walk-away: the first
  // left of each seat after the cursor is taken as ours, and only a later one ends the sleep.
  const api = await caseApi(t, { entries: [invite, left(10, "leave")] });
  const r = sleepingRow();
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: r },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(r.state, "dormant", "the first left of the seat is our exit stop's own");
  assert.equal(r.dormant.cursor, 10);
  // A said still wakes after that first left.
  api.state.entries = [invite, left(10, "leave"), entry(11, "said", { to_standing_id: SEAT })];
  const wakes = sleepingRow();
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: wakes },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(wakes.state, "launched");
  // The second left ends: revoked by a stop order, leave by the seat itself.
  api.state.entries = [invite, left(10, "revoked"), left(11, "revoked")];
  const revoked = sleepingRow();
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: revoked },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(revoked.state, "ended");
  assert.equal(revoked.why, "dormant_seat_revoked");
  assert.equal(revoked.dormant.cursor, 11);
  api.state.entries = [invite, left(10, "leave"), left(11, "leave")];
  const gone = sleepingRow();
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: gone },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(gone.state, "ended", "the seat's own walk-away ends the sleep");
  assert.equal(gone.why, "dormant_seat_left");
});

test("dormancy: no sleep when the seat left the case before the process exited", async (t) => {
  const api = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(10, "left", { author_standing_id: SEAT, payload: { reason: "leave" } }),
    ],
  });
  // Our exit stop met an already-gone standing (410): the left in the journal is the seat's
  // own walk-away, not our order's — no sleep on it.
  const r = exitedRun();
  assert.equal(await goDormant(api.base, "key", r), false);
  assert.equal(r.state, "ended");
  // Our own completed stop's left is another matter: the stop_outcome says we took the seat
  // out, and the sleep arms on the seat's last word — the left itself.
  const ours = exitedRun({ why: undefined, stop_outcome: "stopped" });
  assert.equal(await goDormant(api.base, "key", ours), true);
  assert.equal(ours.state, "dormant");
  assert.equal(ours.dormant.cursor, 10);
});

test("dormant tact: the window, the taken slot and the gone launcher hold the sleep", async (t) => {
  const api = await caseApi(t, {
    entries: [
      entry(9, "invite", { to_karta_node_id: KARTA }),
      entry(10, "said", { to_standing_id: SEAT }),
    ],
  });
  const past = sleepingRow({
    dormant: { ...sleepingRow().dormant, since: "2026-10-01T00:00:00Z" },
  });
  const said = await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: past },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(past.state, "ended");
  assert.equal(past.why, "dormant_window");
  assert.ok(said.join("; ").includes("dormant_window"));
  // The slot is taken by another live run of the same launcher: the waking word waits.
  const sleeping = sleepingRow();
  const busy = {
    ...sleepingRow(),
    state: "launched",
    dormant: undefined,
    room: "room-2",
    invite: 8,
  };
  const runs = { k: sleeping, other: busy };
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    runs,
    launchers(1),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(sleeping.state, "dormant", "the waking word waits for the slot");
  assert.equal(sleeping.dormant.cursor, 9, "the cursor does not move past an unwoken word");
  assert.equal(sleeping.why, "dormant_limit_reached");
  // The launcher description gone: the word waits as well.
  const gone = sleepingRow();
  await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: gone },
    { own: new Map(), elsewhere: new Map(), refused: [] },
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(gone.state, "dormant");
  assert.equal(gone.why, "dormant_launcher_gone");
  assert.equal(gone.dormant.cursor, 9);
});

test("dormant tact: a failed read leaves the cursor standing and names itself in the row", async (t) => {
  const api = await caseApi(t, { refuse: true });
  const r = sleepingRow();
  const said = await stepDormant(
    "/tmp/unused",
    api.base,
    "key",
    { k: r },
    launchers(),
    undefined,
    AWAKE_NOW,
    launchStub().run,
  );
  assert.equal(r.state, "dormant");
  assert.equal(r.dormant.cursor, 9);
  assert.equal(r.why, "dormant_read_error");
  assert.ok(said.join("; ").includes("dormant_read_error"));
});

test("dormant from ends: an ordinary ended row sleeps, a stop ordered elsewhere stays an end", async (t) => {
  const api = await caseApi(t, { entries: [entry(9, "invite", { to_karta_node_id: KARTA })] });
  const ours = exitedRun();
  await dormantFromEnds(api.base, "key", { ours });
  assert.equal(ours.state, "dormant", "the tact's own ended row sleeps when the case is open");
  const elsewhere = exitedRun({ why: "stopped_elsewhere" });
  await dormantFromEnds(api.base, "key", { elsewhere });
  assert.equal(elsewhere.state, "ended", "a stop ordered elsewhere is a wind-down, not a sleep");
});
