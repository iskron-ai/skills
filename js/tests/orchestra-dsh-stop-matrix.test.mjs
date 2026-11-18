// A continuation that exits before session must retain the proof needed to remove its tree.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { invite, leadingDsh, ROOM } from "./dsh-kit.mjs";

process.env.NODE_OPTIONS = `--require ${join(dirname(fileURLToPath(import.meta.url)), "fast-clock.cjs")}`;
process.env.FAST_CLOCK = "10";

const SEAT = "11111111-1111-4111-8111-111111111111";
const KARTA = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const entry = (id, kind, extra = {}) => ({
  id,
  kind,
  to_standing_id: null,
  to_karta_node_id: null,
  in_reply_to: null,
  author_standing_id: LEAD,
  author: "@tester:lead",
  payload: {},
  ...extra,
});

test("continuation exits 7 before session: sleep retains exit proof and closed case removes tree", async (t) => {
  if (process.env.ISKRON_NODE) return t.skip("the probe clock requires NODE_OPTIONS");
  const first = entry(31, "invite", { to_karta_node_id: KARTA });
  const share = entry(30, "progress", {
    author_standing_id: SEAT,
    line: { key: "probe-share", verdict: "partial" },
  });
  const o = await leadingDsh(t, {
    env: { FAKE_DSH_MODE: "fail-continue", FAKE_DSH_HOLD_MS: "1000" },
    caseRoom: { status: "open", entries: [share, first] },
  });
  await o.queue([invite(31)]);
  assert.match((await o.step()).out, /invite 31: launched/);
  await o.queue([], [{ cursor: "s-31", spawned_for: { invite: 31, room: ROOM }, standing: SEAT }]);
  await o.step();
  await o.until(31, (r) => r.state === "dormant", 30_000);
  await o.room("open", [share, first, entry(32, "said", { to_standing_id: SEAT })]);
  assert.match((await o.step()).out, /dormant_woken_32, dsh_exit_7/);
  const slept = o.run(31);
  assert.equal(slept.state, "dormant");
  assert.ok(slept.tree.exit, "the observed client exit is retained");
  assert.equal(slept.closed, "client_exited");
  await o.room("closed", [first]);
  await o.step();
  const ended = await o.until(31, (r) => r.state === "ended" && r.tree?.state === "removed");
  assert.equal(ended.why, "dormant_case_closed");
  assert.equal(existsSync(ended.worktree), false);
});
