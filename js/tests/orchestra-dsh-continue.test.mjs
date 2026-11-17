// The dormancy and continuation of a raised dsh agent (graph @nks/nks-dev, #10995): a clean exit
// with the call's case still open does not end the run — it sleeps, tree and session kept, until a
// word in the case wakes the continuation `dsh --session-id`; a closed case, a passed window or a
// word to another seat does not. A new daemon over the same registry keeps the sleep.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { invite, leadingDsh, ROOM } from "./dsh-kit.mjs";

const SEAT = "11111111-1111-4111-8111-111111111111";
const OTHER_SEAT = "44444444-4444-4444-8444-444444444444";
const KARTA = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const SESSION = "session-0b6f1c2e-probe";

const said = (n, to) => ({
  id: n,
  kind: "said",
  to_standing_id: to,
  to_karta_node_id: null,
  in_reply_to: null,
  author_standing_id: LEAD,
  author: "@tester:lead",
  payload: { text: "your turn" },
});
const inviteEntry = (n) => ({
  id: n,
  kind: "invite",
  to_standing_id: null,
  to_karta_node_id: KARTA,
  in_reply_to: null,
  author_standing_id: LEAD,
  author: "@tester:lead",
  payload: {},
});
/** The seat signal folds the run's standing id in before the process exits. */
const seatSignal = (n) => ({
  cursor: `s-${n}`,
  spawned_for: { invite: n, room: ROOM },
  standing: SEAT,
});

/** Raised, seated, exited cleanly, asleep: the registry row in dormancy. */
async function asleep(t, n, extra = {}) {
  const o = await leadingDsh(t, {
    env: { FAKE_DSH_HOLD_MS: "6000", ...extra.env },
    caseRoom: { status: "open", entries: [inviteEntry(n)] },
    ...extra.options,
  });
  await o.queue([invite(n)]);
  assert.match((await o.step()).out, new RegExp(`invite ${n}: launched`));
  await o.queue([], [seatSignal(n)]);
  await o.step();
  const row = await o.until(n, (r) => r.state === "dormant", 30_000);
  assert.equal(row.dsh.exit, "0");
  assert.equal(row.dsh.final, "completed");
  assert.equal(row.dormant.cursor, n, "the cursor lies on the journal's last entry");
  assert.deepEqual(row.dormant.seats, [SEAT]);
  assert.equal(row.dormant.karta, KARTA, "the invited role's uuid comes from the invite entry");
  assert.equal(row.tree.state, "ready", "the tree sleeps with the run");
  assert.ok(existsSync(row.worktree));
  return { o, row };
}

test("dsh: a clean exit sleeps while the case is open; a said to the call's seat wakes the same session", async (t) => {
  const { o } = await asleep(t, 31);
  await o.room("open", [inviteEntry(31), said(32, SEAT)]);
  assert.match((await o.step()).out, /invite 31: dormant_woken_32/, (await o.status()).out);
  const calls = o.dshCalls();
  assert.equal(calls.length, 2, "exactly one continuation");
  const at = calls[1].argv.indexOf("--session-id");
  assert.ok(at > 0, "the continuation names the session");
  assert.equal(calls[1].argv[at + 1], SESSION);
  assert.equal(calls[1].cwd, calls[0].cwd, "the continuation runs in the same tree");
  const brief = calls[1].argv.at(-1);
  assert.ok(brief.includes("[32]"), brief);
  assert.ok(!brief.startsWith("start "), "the continuation brief is not the first brief");
  // The continuation exits cleanly in its turn: the sleep re-arms on the new last entry.
  const again = await o.until(31, (r) => r.state === "dormant" && r.dormant.cursor === 32, 30_000);
  assert.deepEqual(again.dormant.seats, [SEAT]);
  assert.equal(again.tree.state, "ready");
});

test("dsh: a closed case ends the sleep, no continuation, the tree goes", async (t) => {
  const { o } = await asleep(t, 41);
  await o.room("closed", [inviteEntry(41)]);
  await o.step();
  const ended = await o.until(41, (r) => r.state === "ended");
  assert.equal(ended.why, "dormant_case_closed");
  await o.until(41, (r) => r.tree?.state === "removed");
  assert.equal(existsSync(ended.worktree), false);
  assert.equal(o.dshCalls().length, 1, "no continuation was launched");
});

test("dsh: the dormant window lapses into an ended run and the ordinary tree cleanup", async (t) => {
  const { o } = await asleep(t, 51, { env: { ISKRON_ORCHESTRA_DORMANT_WINDOW_MS: "100" } });
  await new Promise((d) => setTimeout(d, 300));
  await o.room("open", [inviteEntry(51), said(52, SEAT)]);
  await o.step();
  const ended = await o.until(51, (r) => r.state === "ended");
  assert.equal(ended.why, "dormant_window");
  await o.until(51, (r) => r.tree?.state === "removed");
  assert.equal(o.dshCalls().length, 1, "a word past the window does not wake");
});

test("dsh: a said to another seat does not wake; the cursor moves past it", async (t) => {
  const { o } = await asleep(t, 61);
  await o.room("open", [inviteEntry(61), said(62, OTHER_SEAT)]);
  await o.step();
  const row = o.run(61);
  assert.equal(row.state, "dormant");
  assert.equal(row.dormant.cursor, 62, "the read is taken in, the run sleeps on");
  assert.equal(o.dshCalls().length, 1);
  // The next word to the call's own seat still wakes after the passed-by one.
  await o.room("open", [inviteEntry(61), said(62, OTHER_SEAT), said(63, SEAT)]);
  assert.match((await o.step()).out, /invite 61: dormant_woken_63/);
  assert.equal(o.dshCalls().length, 2);
});

test("dsh: a new daemon over the same registry keeps the sleep and wakes the same session", async (t) => {
  const { o } = await asleep(t, 71);
  await o.restart();
  const kept = o.run(71);
  assert.equal(kept.state, "dormant");
  assert.equal(kept.dormant.cursor, 71);
  assert.deepEqual(kept.dormant.seats, [SEAT]);
  await o.room("open", [inviteEntry(71), said(72, SEAT)]);
  assert.match((await o.step()).out, /invite 71: dormant_woken_72/);
  const calls = o.dshCalls();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].argv[calls[1].argv.indexOf("--session-id") + 1], SESSION);
});

test("dsh: a stop order naming the sleeping seat ends the sleep and the tree goes", async (t) => {
  const { o, row } = await asleep(t, 81);
  await o.stopOrder(SEAT);
  await o.step();
  const ended = await o.until(81, (r) => r.state === "ended");
  assert.equal(ended.why, "stop_ordered_elsewhere");
  await o.until(81, (r) => r.tree?.state === "removed");
  assert.equal(existsSync(row.worktree), false);
  assert.equal(o.dshCalls().length, 1, "a stop order does not wake a continuation");
});

test("dsh: a new invite raises a fresh call and never wakes the sleeping one", async (t) => {
  const { o } = await asleep(t, 101, { options: { limit: 2 } });
  // A new invite for the same role: the ordinary raising takes it — the sleeping run must
  // not take it as its own wake word (#10995 review 3).
  await o.room("open", [inviteEntry(101), inviteEntry(102)]);
  await o.queue([invite(102)]);
  assert.match((await o.step()).out, /invite 102: launched/);
  const calls = o.dshCalls();
  assert.equal(calls.length, 2, "the first life plus one fresh launch — no continuation");
  assert.ok(!calls[1].argv.includes("--session-id"), "the fresh call is not a continuation");
  const sleeping = o.run(101);
  assert.equal(sleeping.state, "dormant");
  assert.equal(sleeping.dormant.cursor, 102, "the new invite's entry only moves the cursor");
  const fresh = o.run(102);
  assert.equal(fresh.state, "launched");
});

test("dsh: the continuation is a new launch for the raise windows", async (t) => {
  const { o, row } = await asleep(t, 91);
  const since = row.dormant.since;
  await o.room("open", [inviteEntry(91), said(92, SEAT)]);
  await o.step();
  const woken = o.run(91);
  assert.equal(woken.state, "launched");
  assert.ok(
    Date.parse(woken.at) >= Date.parse(since),
    "at moves to the continuation's own launch — expireLaunches must not see the first launch's age",
  );
  assert.equal(woken.sat, undefined, "the no-join window starts over");
  assert.equal(woken.rooms, undefined);
  assert.equal(woken.n, undefined);
  assert.equal(
    woken.idle_due,
    undefined,
    "the first life's idle marker does not stop the continuation",
  );
});
