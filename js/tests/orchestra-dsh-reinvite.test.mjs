// The continuation registers on the call's own ownerless invite (graph @nks/nks-dev, #10995).
// The form is the platform's, seen in the live run of 8.14.0 on LAB (case journal of the dsh
// step, .scratch/live-8140/logs/dsh.log; the api holder's word, case 5608): our exit stop
// revokes the seat — a left with reason revoked — and with the role's lines still open the
// platform invites the role again, author null, payload {cause: "ownerless", gone_standing:
// <the ended seat>, holon: null}. The first pair is closed with it: a continuation on it was
// refused 422 spawned_for_unknown. Another live seat on the ownerless invite — 409
// spawned_for_claimed: the call ends instead of sleeping again.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { invite, leadingDsh, ROOM } from "./dsh-kit.mjs";

const SEAT = "11111111-1111-4111-8111-111111111111";
const NEXT_SEAT = "55555555-5555-4555-8555-555555555555";
const OTHER_SEAT = "44444444-4444-4444-8444-444444444444";
const KARTA = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";

const lead = { author_standing_id: LEAD, author: "@tester:lead" };
const inviteEntry = (n) => ({
  id: n,
  kind: "invite",
  to_standing_id: null,
  to_karta_node_id: KARTA,
  in_reply_to: null,
  ...lead,
  payload: {},
});
const share = (n) => ({
  id: n - 1,
  kind: "progress",
  author_standing_id: SEAT,
  line: { key: "probe-share", verdict: "partial" },
  payload: { verdict: "partial" },
});
/** Our exit stop's trace: the seat revoked by the platform. */
const revoked = (n) => ({
  id: n,
  kind: "left",
  author_standing_id: SEAT,
  author: null,
  payload: { reason: "revoked" },
});
/** The platform's invite of the role after the seat's end, as the journal carries it. */
const ownerless = (n, gone = SEAT) => ({
  id: n,
  kind: "invite",
  to_standing_id: null,
  to_karta_node_id: KARTA,
  in_reply_to: null,
  author_standing_id: null,
  author: null,
  line: { key: "invite:3", verdict: "partial" },
  payload: { cause: "ownerless", gone_standing: gone, holon: null },
});
/** The same invite as GET /realms/{r}/invites serves it (LAB, entry [8]). */
const ownerlessRow = (n, gone = SEAT) => ({
  ...invite(n),
  author: null,
  author_name: null,
  payload: { cause: "ownerless", gone_standing: gone, holon: null },
  attrs: {},
});
const askRole = (n) => ({
  id: n,
  kind: "ask",
  to_standing_id: null,
  to_karta_node_id: KARTA,
  in_reply_to: null,
  ...lead,
  line: { key: "probe-word", verdict: "partial" },
  payload: { text: "2+2?" },
});
const said = (n) => ({ id: n, kind: "said", to_standing_id: SEAT, in_reply_to: null, ...lead });
const joined = (n, seat, via) => ({
  id: n,
  kind: "joined",
  author_standing_id: seat,
  in_reply_to: via,
});
const pairOf = (call) => JSON.parse(call.spawned_for);

async function asleep(t, n, env = {}) {
  const o = await leadingDsh(t, {
    env: { FAKE_DSH_HOLD_MS: "6000", ...env },
    caseRoom: { status: "open", entries: [share(n), inviteEntry(n)] },
  });
  await o.queue([invite(n)]);
  assert.match((await o.step()).out, new RegExp(`invite ${n}: launched`));
  await o.queue([], [{ cursor: `s-${n}`, spawned_for: { invite: n, room: ROOM }, standing: SEAT }]);
  await o.step();
  await o.until(n, (r) => r.state === "dormant", 30_000);
  return o;
}

test("dsh: the continuation registers on the ownerless invite its seat left, not the revoked pair", async (t) => {
  const o = await asleep(t, 201);
  await o.room("open", [share(201), inviteEntry(201), revoked(202), ownerless(203), askRole(204)]);
  await o.queue([ownerlessRow(203)]);
  const out = (await o.step()).out;
  assert.match(out, /invite 201: dormant_woken_204, launched/, out);
  const calls = o.dshCalls();
  assert.equal(calls.length, 2);
  assert.deepEqual(pairOf(calls[1]), { invite: 203, room: ROOM }, "the open pair of the role");
  assert.deepEqual(pairOf(calls[0]), { invite: 201, room: ROOM });
  // The continuation's seat signals on its own pair: it folds into the call's row.
  await o.queue(
    [],
    [{ cursor: "s-2", spawned_for: { invite: 203, room: ROOM }, standing: NEXT_SEAT }],
  );
  await o.step();
  const row = o.run(201);
  assert.equal(row.standing_id, NEXT_SEAT, "the continuation's seat is the call's");
  assert.equal(o.run(203), undefined, "no second row for the call's share");
});

test("dsh: a continuation whose pair another seat took (409 spawned_for_claimed) ends, not sleeps", async (t) => {
  const o = await asleep(t, 221, { FAKE_DSH_HOLD_MS: "1500" });
  const before = [share(221), inviteEntry(221), revoked(222), ownerless(223), askRole(224)];
  await o.room("open", before);
  assert.match((await o.step()).out, /invite 221: dormant_woken_224, launched/);
  // The continuation's register met another live seat on the pair: only the journal tells.
  await o.room("open", [...before, joined(225, OTHER_SEAT, 223)]);
  let ended;
  for (const end = Date.now() + 30_000; !ended && Date.now() < end;) {
    await o.step();
    const r = o.run(221);
    if (r.state === "ended") ended = r;
    else await new Promise((d) => setTimeout(d, 300));
  }
  assert.ok(ended, JSON.stringify(o.run(221)));
  assert.equal(ended.why, "dormant_share_claimed");
  await o.until(221, (r) => r.tree?.state === "removed");
  assert.equal(o.dshCalls().length, 2, "no further continuation");
});

test("dsh: no ownerless invite — the continuation keeps the call's pair", async (t) => {
  const o = await asleep(t, 251);
  // Another seat's ownerless invite is not the call's.
  await o.room("open", [share(251), inviteEntry(251), ownerless(252, OTHER_SEAT), said(253)]);
  assert.match((await o.step()).out, /invite 251: dormant_woken_253, launched/);
  assert.deepEqual(pairOf(o.dshCalls()[1]), { invite: 251, room: ROOM });
});

test("dsh: the ownerless invite of a sleeping call raises no fresh agent", async (t) => {
  const o = await asleep(t, 301);
  await o.room("open", [share(301), inviteEntry(301), revoked(302), ownerless(303)]);
  await o.queue([ownerlessRow(303)]);
  const out = (await o.step()).out;
  assert.match(out, /invite 303: dormant_share/, out);
  assert.equal(o.dshCalls().length, 1, "nothing launched for the call's share");
  assert.equal(o.run(303), undefined);
  assert.equal(o.run(301).state, "dormant", "the call sleeps on");
});

test("dsh: the ownerless invite claimed by another seat ends the call, the tree goes", async (t) => {
  const o = await asleep(t, 401);
  await o.room("open", [
    share(401),
    inviteEntry(401),
    revoked(402),
    ownerless(403),
    joined(404, OTHER_SEAT, 403),
    askRole(405),
  ]);
  const out = (await o.step()).out;
  assert.match(out, /invite 401: dormant_share_claimed/, out);
  const ended = await o.until(401, (r) => r.state === "ended");
  assert.equal(ended.why, "dormant_share_claimed");
  await o.until(401, (r) => r.tree?.state === "removed");
  assert.equal(existsSync(ended.worktree), false);
  assert.equal(o.dshCalls().length, 1, "no continuation on a claimed pair");
});
