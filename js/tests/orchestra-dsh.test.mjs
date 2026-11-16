// The orchestrator raises dsh itself (graph @nks/nks-dev, #10777): a real daemon of the built
// bridge, the fake NKS, a substitute dsh on PATH. Orca is never asked for a dsh call.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { invite, leadingDsh, MODEL, REALM, ROOM } from "./dsh-kit.mjs";

test("dsh: a call is raised as the bridge's own dsh process in its own tree, the pair in the environment", async (t) => {
  const o = await leadingDsh(t, { limit: 1 });
  await o.queue([invite(9), invite(10)]);
  const first = await o.step();
  assert.equal(first.code, 0, first.err + first.out);
  assert.match(first.out, new RegExp(`case ${ROOM} invite 9: launched`), first.out);
  assert.match(first.out, /invite 10: limit_reached/, first.out);
  const run = o.run(9);
  assert.equal(run.harness, "dsh");
  assert.equal(run.dsh.session, "session-0b6f1c2e-probe", "the session id is the first event's");
  assert.match(run.worktree, new RegExp(`^${o.checkout}/\\.worktrees/orchestra-[a-f0-9-]+$`));
  const [call, ...more] = o.dshCalls();
  assert.equal(more.length, 0, "exactly one dsh process");
  assert.equal(call.cwd, run.worktree);
  assert.deepEqual(JSON.parse(call.spawned_for), { invite: 9, room: ROOM });
  assert.equal(call.orchestra, null, "the raised agent gets no raising consent");
  // --patch is a launcher option: before --json, which the app takes (real dsh refuses it after).
  assert.deepEqual(call.argv.slice(0, 3), ["headless", "--patch", o.patch]);
  assert.equal(call.argv[3], "--patch");
  assert.ok(!call.argv[4].startsWith(run.worktree), "the model patch lies outside the tree");
  assert.equal(call.argv[5], "--json");
  assert.match(call.model, /provider: "local-probe"\n {4}model: "mock"/);
  const brief = call.argv.at(-1);
  assert.equal(call.argv.length, 7);
  assert.doesNotMatch(brief, /spawned_for/, brief);
  assert.ok(brief.startsWith(`start ${REALM} #931 `), brief);
  assert.ok(brief.includes(`room="${ROOM}"`), brief);
  assert.ok(!call.argv.includes("--model"), "dsh headless has no --model");
  // final and the exit: the slot is free, the tree goes by the ordinary cleanup.
  const ended = await o.until(9, (r) => r.state === "ended" && r.tree?.state === "removed");
  assert.equal(ended.dsh.final, "completed");
  assert.equal(ended.dsh.exit, "0");
  assert.equal(ended.why, "dsh_ended_completed");
  assert.equal(existsSync(run.worktree), false);
  const second = await o.step();
  assert.match(second.out, /invite 10: launched/, second.out);
  assert.equal(o.orcaCalls().length, 0, "orca is never asked for a dsh call");
});

test("dsh: a non-zero exit before the session is a refused launch, never repeated", async (t) => {
  const o = await leadingDsh(t, { env: { FAKE_DSH_MODE: "fail" } });
  await o.queue([invite(11)]);
  const first = await o.step();
  assert.match(first.out, /invite 11: dsh_exit_3/, first.out);
  const run = o.run(11);
  assert.equal(run.state, "refused");
  assert.equal(run.dsh.session, undefined);
  await o.until(11, (r) => r.tree?.state === "removed");
  const again = await o.step();
  assert.equal(again.code, 0, again.err);
  assert.equal(o.dshCalls().length, 1, "a refused launch is not retried");
  assert.equal(o.orcaCalls().length, 0);
});

test("dsh: a non-zero exit after the session, no final — dsh_exit_N in the row and in status after the tree goes", async (t) => {
  const o = await leadingDsh(t, { env: { FAKE_DSH_MODE: "crash" } });
  await o.queue([invite(16)]);
  assert.match((await o.step()).out, /invite 16: launched/);
  const ended = await o.until(16, (r) => r.state === "ended" && r.tree?.state === "removed");
  assert.equal(ended.dsh.exit, "5");
  assert.equal(ended.why, "dsh_exit_5");
  assert.match((await o.status()).out, /invite 16: dsh_exit_5/);
});

test("dsh: no dsh binary or no patch — refused by code in status, no tree, no process", async (t) => {
  const o = await leadingDsh(t, { offer: { bin: "/nonexistent/dsh" } });
  await o.queue([invite(12)]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 12: dsh_missing/, r.out);
  assert.equal(o.run(12), undefined);
  assert.match((await o.status()).out, /invite 12: dsh_missing/);
  const p = await leadingDsh(t, { offer: { patch: "/nonexistent/dsh-profile.yml" } });
  await p.queue([invite(13)]);
  assert.match((await p.step()).out, /invite 13: dsh_patch_missing/);
  assert.equal(p.dshCalls().length + o.dshCalls().length, 0);
  assert.equal(p.orcaCalls().length + o.orcaCalls().length, 0);
});

// A server without the raw read (#10962): the description's body comes from the card's fences,
// and the orchestrator still raises; an older server's raw read still works (every other probe).
test("dsh: a server without raw — the description is read from the card's fences and raises", async (t) => {
  const o = await leadingDsh(t, { fenced: true });
  await o.queue([invite(19)]);
  const r = await o.step();
  assert.match(r.out, /invite 19: launched/, r.out);
  assert.doesNotMatch((await o.status()).out, /refused/);
});

test("dsh: no seat within the window — the bridge ends its own process, and the exit frees the slot", async (t) => {
  const o = await leadingDsh(t, {
    env: { FAKE_DSH_MODE: "hang", ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "500" },
  });
  await o.queue([invite(15)]);
  assert.match((await o.step()).out, /invite 15: launched/);
  await new Promise((d) => setTimeout(d, 700));
  const r = await o.step();
  assert.match(r.out, /invite 15: dsh_no_seat_terminated/, r.out);
  const ended = await o.until(15, (x) => x.state === "ended" && x.tree?.state === "removed");
  assert.equal(ended.dsh.terminated, "no_seat");
  assert.equal(ended.dsh.final, undefined);
  assert.equal(o.orcaCalls().length, 0);
});

test("dsh: the dry run says the dsh command, launching nothing", async (t) => {
  const o = await leadingDsh(t);
  await o.queue([invite(14)]);
  const { cli } = await import("./dsh-kit.mjs");
  const r = await cli(o.dir, ["step", "--dry-run"]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(
    r.out,
    new RegExp(`would launch: \\S+ headless --patch ${o.patch} --patch .+ --json `),
    r.out,
  );
  assert.match(r.out, new RegExp(`model ${MODEL}`), r.out);
  assert.equal(o.dshCalls().length, 0);
  assert.equal(o.orcaCalls().length, 0);
});
