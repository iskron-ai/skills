// The orchestrator refuses a raise on a nearly full volume (graph @nks/nks-dev, node #11288): the
// free space of the checkout's volume is read before the tree; below the floor the call is
// refused with the code and the word naming the cleanup, not spent — the next tact tries again.
// The floor is moved by its variable (above the real free space — refused; 0 — raised as before);
// the real disk is never filled. Orca and dsh: a real daemon against the fake NKS and substitutes.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { invite as dshInvite, leadingDsh } from "./dsh-kit.mjs";
import { cli, describe, GOOD, invite, leading, REALM, REPO, ROOM } from "./orchestra-raise-kit.mjs";

const FULL = { ISKRON_DISK_FLOOR_PCT: "100" };
const NONE = { ISKRON_DISK_FLOOR_PCT: "0" };
const REFUSED =
  /invite 9: disk_floor — the volume of \S+ has [\d.]+ GB free of \d+ \([\d.]+%\) — below the 100% floor: the agent was not raised\. First clear your own: target\/ and node_modules of your merged trees, git worktree remove the merged ones; leave others' alone\. Then retry\./;

const noTree = (checkout) =>
  !existsSync(join(checkout, ".worktrees")) ||
  readdirSync(join(checkout, ".worktrees")).length === 0;

test("orca: below the floor the raise is refused with the word, unspent, and said in status", async (t) => {
  const o = await leading(t, { env: FULL });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, REFUSED, r.out);
  assert.equal(o.launches().length, 0, "nothing launched");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`], undefined, "the call is not spent");
  assert.ok(noTree(o.checkout), "no tree was made");
  const status = await cli(o.dir, ["status"]);
  assert.match(status.out, REFUSED, status.out);
  const again = await o.step();
  assert.match(again.out, REFUSED, "the next tact tries again");
});

test("orca: with the floor at 0 the raise goes as before", async (t) => {
  const o = await leading(t, { env: NONE });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches().length, 1);
});

// Off until the owner accepts it (#11288): the daemon's volume reads 1% free (statfs-full.cjs —
// a covered checkout cannot live on a real full volume); without the variable the raise goes,
// with the recommended 10 it is refused — the substitute is seen to bite.
const AT_1PCT = {
  NODE_OPTIONS: `--require "${fileURLToPath(new URL("./statfs-full.cjs", import.meta.url))}"`,
};

test("orca: without the variable a volume at 1% free raises as before", async (t) => {
  delete process.env.ISKRON_DISK_FLOOR_PCT;
  const o = await leading(t, { env: AT_1PCT });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.doesNotMatch(r.out, /disk_floor/, r.out);
  assert.equal(o.launches().length, 1);
});

test("orca: with the variable at 10 a volume at 1% free is refused", async (t) => {
  const o = await leading(t, { env: { ...AT_1PCT, ISKRON_DISK_FLOOR_PCT: "10" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: disk_floor — .*\(1\.0%\) — below the 10% floor/, r.out);
  assert.equal(o.launches().length, 0);
});

test("dry run: below the floor the plan says the refusal where the checkout is known", async (t) => {
  const o = await leading(t, {
    env: FULL,
    descriptions: (checkout) => [describe({ body: { checkouts: { [REPO]: checkout } } })],
  });
  await o.queue([invite(9, GOOD)]);
  const r = await cli(o.dir, ["step", "--dry-run"]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: would refuse: disk_floor — the volume of /, r.out);
});

test("dsh: below the floor the raise is refused before the tree, the call unspent", async (t) => {
  const o = await leadingDsh(t, { env: FULL, caseRoom: { status: "closed", entries: [] } });
  await o.queue([dshInvite(9)]);
  const r = await o.step();
  assert.match(r.out, REFUSED, r.out);
  assert.equal(o.dshCalls().length, 0, "no dsh process");
  assert.equal(o.run(9), undefined, "the call is not spent");
  assert.ok(noTree(o.checkout), "no tree was made");
});
