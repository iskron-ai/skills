// The daemon's own close of its OpenCode terminal (graph @nks/nks-dev, #11099, #9256): the
// observed exit is recorded, but an exec run whose halt/drop is not confirmed stays observed —
// its order expired, its session on the shared server may still be woken. Orca is injected.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { execApi } from "../bridge/exec-prepare.ts";
import { reapOwn } from "../bridge/orchestra-reap.ts";
import { heldBy, terminalOf } from "../bridge/orchestra-reap-held.ts";
import { LIVE, readRuns, writeRuns } from "../bridge/orchestra-runs.ts";
import { prepareTree } from "../bridge/orchestra-tree.ts";
import { cleanupEndedTrees } from "../bridge/orchestra-tree-clean.ts";
import { fixture } from "./tree-fixture.mjs";

/** An ended row of an older bridge — its end confirmed, its terminal never seen to exit. */
async function endedTree(t, dirty) {
  const f = fixture(t);
  assert.equal(await prepareTree(f.auth, f.runs, "own", f.source), null);
  Object.assign(f.row, {
    state: "ended",
    harness: "opencode",
    standing_id: "seat",
    terminal: "term_own",
    runtime: "rt",
  });
  f.row.tree.incarnation = "inc";
  if (dirty) writeFileSync(join(f.row.worktree, "unsaved.txt"), "work\n");
  writeRuns(f.auth, f.runs);
  return f;
}

for (const dirty of [false, true])
  test(`reap: an ended row's terminal closed by the daemon frees its ${dirty ? "dirty" : "clean"} tree by the cleanup`, async (t) => {
    const f = await endedTree(t, dirty);
    const runs = readRuns(f.auth);
    const said = await reapOwn(f.auth, runs, undefined, async () => null);
    assert.match(said.join(), /ended, client_exited/);
    writeRuns(f.auth, runs);
    await cleanupEndedTrees(f.auth, runs);
    const r = readRuns(f.auth).own;
    assert.equal(r.tree.state, dirty ? "retained" : "removed", JSON.stringify(r));
    if (dirty) assert.equal(r.tree.why, "tree_dirty_retained");
    assert.equal(existsSync(join(f.row.worktree, "unsaved.txt")), dirty);
  });

/** A native exec launch whose seat never stood: its prompt went to the shared server first. */
async function noSeatExec(t) {
  const f = await endedTree(t, false);
  Object.assign(f.row, { state: "ambiguity", why: "exec_no_seat_unverified" });
  delete f.row.standing_id;
  f.row.exec = {
    attempt: "a",
    receipt: "r",
    server: "http://127.0.0.1:1",
    model: {},
    session: "ses_live",
    incarnation: "inc",
  };
  writeRuns(f.auth, f.runs);
  return f;
}
/** The shared server as `opencode api` answered it on OpenCode 2.2.7 (18.11, isolated serve,
 * API-only session): interrupt — bare `{"interrupted":false}`; PATCH archived — 204, no output,
 * exit 0 (execApi: undefined); read-back — wrapped in `data`, `time.archived` once archived.
 * `archives` — whether the archive holds. */
const server = (archives, calls) => async (srv, method, path, body) => {
  calls.push([method, path, body]);
  if (path.endsWith("/interrupt?resume=false")) return { interrupted: false };
  if (method === "patch") return undefined;
  const time = { created: 1795023652877, updated: 1795023657762 };
  return {
    data: {
      id: "ses_live",
      cost: 0,
      time: archives ? { ...time, archived: 1795023657762 } : time,
      location: { directory: "/tmp/proj" },
    },
  };
};
const tactOf = async (f, api) => {
  const runs = readRuns(f.auth);
  const said = await reapOwn(f.auth, runs, undefined, async () => null, api);
  writeRuns(f.auth, runs);
  await cleanupEndedTrees(f.auth, runs);
  return { said: said.join(), r: readRuns(f.auth).own };
};

// The review's counter-case: a session live on the shared server, no stop — no end, tree kept.
test("reap: a no-seat exec launch with a live session is not ended until its session is halted", async (t) => {
  const f = await noSeatExec(t);
  const calls = [];
  let got = await tactOf(f, server(false, calls));
  assert.match(got.said, /no_seat, client_exited/);
  assert.match(got.said, /no_seat, session_archive_unconfirmed/);
  assert.notEqual(got.r.state, "ended", JSON.stringify(got.r));
  assert.equal(got.r.tree.state, "ready");
  assert.deepEqual(calls.slice(0, 2), [
    ["post", "/api/session/ses_live/interrupt?resume=false", undefined],
    ["patch", "/api/session/ses_live", { archived: true }],
  ]);
  assert.match((await tactOf(f, server(false, calls))).said, /no_seat, session_archive/);
  got = await tactOf(f, server(false, calls));
  assert.match(got.said, /no_seat, reap_exhausted \(session_archive_unconfirmed\)/);
  assert.notEqual(got.r.state, "ended");
  assert.equal(got.r.tree.state, "ready");
  const before = calls.length;
  await tactOf(f, server(true, calls));
  assert.equal(calls.length, before, "exhausted — no more tries");
});

test("reap: a no-seat exec launch whose session halted ends and frees its tree", async (t) => {
  const f = await noSeatExec(t);
  let got = await tactOf(f, async () => {
    throw new Error("exec_api_failed_or_unknown");
  });
  assert.match(got.said, /no_seat, session_halt_unknown/);
  assert.notEqual(got.r.state, "ended");
  got = await tactOf(f, server(true, []));
  assert.equal(got.r.state, "ended", JSON.stringify(got.r));
  assert.equal(got.r.tree.state, "removed");
});

// OpenCode 2.2.7's `opencode api` prints nothing for a 204 and exits 0 — no content, not a
// refusal; any output is still read as JSON.
test("reap: execApi reads an empty answer of opencode api as no content", async (t) => {
  const bin = mkdtempSync(join(tmpdir(), "reap-bin-"));
  const path = process.env.PATH;
  t.after(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
  });
  writeFileSync(join(bin, "opencode"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  process.env.PATH = `${bin}:${path}`;
  assert.equal(await execApi("http://127.0.0.1:1", "patch", "/api/session/ses_x", {}), undefined);
});

const row = {
  realm: "@x/one",
  room: "r",
  invite: 1,
  karta: 3,
  harness: "opencode",
  launcher: "own",
  model: "m",
  repository: "example.test/org/repo",
  worktree: "/nowhere/.worktrees/orchestra-x",
  state: "stopping",
  at: "2026-11-18T00:00:00Z",
  stopping_at: "2026-11-18T00:00:00Z",
  standing_id: "seat",
  order_id: "ord",
  orders: ["ord"],
  stop_outcome: "expired",
  terminal: "term_own",
  runtime: "rt",
  exec: { attempt: "a", receipt: "r", server: "s", model: {}, session: "ses", incarnation: "inc" },
  tree: { state: "ready", path: "/nowhere/.worktrees/orchestra-x", incarnation: "inc" },
};

test("reap: a transient refusal is tried again across a daemon restart; ours unproven — never", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "reap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeRuns(dir, { own: structuredClone(row), other: { ...structuredClone(row), invite: 2 } });
  const calls = [];
  const close = (answer) => async (handle, runtime, current, expected) => {
    calls.push(expected.incarnation);
    return typeof answer === "function" ? answer(calls.length) : answer;
  };
  // Each tact reads the registry anew — as a restarted daemon does.
  const tact = async (answer) => {
    const runs = readRuns(dir);
    await reapOwn(dir, runs, undefined, close(answer));
    writeRuns(dir, runs);
    return readRuns(dir);
  };
  let got = await tact((n) =>
    n === 1 ? "terminal_binding_unconfirmed" : "terminal_binding_changed",
  );
  assert.equal(got.own.reaped, undefined, "a transient refusal is not final");
  assert.equal(got.other.reaped, "terminal_binding_changed", "a failed proof of ours is final");
  got = await tact(null);
  assert.equal(got.own.reaped, "client_exited");
  assert.equal(got.own.closed, "client_exited");
  assert.equal(calls.length, 3, "the unproven one is not asked again");
});

test("reap: a client holding a live seat is not closed and no try is counted", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "reap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const runs = { own: structuredClone(row) };
  let closes = 0;
  const close = async () => (closes++, null);
  const held = async (terminal) => (terminal === "term_own" ? "16-m3.infra.opus-5-5" : null);
  for (let i = 0; i < 4; i++) {
    const said = await reapOwn(dir, runs, undefined, close, undefined, undefined, held);
    assert.match(said.join(), /stop_expired, client_holds_seat 16-m3\.infra\.opus-5-5/);
  }
  assert.equal(closes, 0);
  assert.equal(runs.own.reaped, undefined);
  assert.equal(runs.own.reap_tries, undefined);
  assert.match((await reapOwn(dir, runs, undefined, close)).join(), /stop_expired, client_exited/);
  assert.equal(closes, 1);
});

test("reap: a process's Orca terminal is read from its own environment", async (t) => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
    env: { ...process.env, ORCA_TERMINAL_HANDLE: "term_probe" },
    stdio: "ignore",
  });
  t.after(() => child.kill("SIGKILL"));
  await new Promise((r) => child.once("spawn", r));
  assert.equal(await terminalOf(child.pid), "term_probe");
  const holders = () => [
    { pid: process.pid, seats: ["elsewhere"] },
    { pid: child.pid, seats: [] },
  ];
  assert.equal(await heldBy(holders)("term_probe"), null, "no seat, or another terminal");
  assert.equal(await heldBy(() => [{ pid: child.pid, seats: ["s"] }])("term_probe"), "s");
});

test("reap: an expired exec run whose terminal closed is not ended — halt unconfirmed (#9256)", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "reap-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeRuns(dir, { own: structuredClone(row) });
  const runs = readRuns(dir);
  const asked = [];
  const said = await reapOwn(dir, runs, undefined, async (handle, runtime, current, expected) => {
    asked.push({ handle, runtime, current: current(), expected });
    return null;
  });
  assert.deepEqual(asked, [
    {
      handle: "term_own",
      runtime: "rt",
      current: true,
      expected: { incarnation: "inc", worktree: row.worktree },
    },
  ]);
  assert.match(said.join(), /stop_expired, client_exited/);
  const r = runs.own;
  assert.equal(r.closed, "client_exited");
  assert.ok(r.exec.exit, "the observed exit is recorded");
  assert.notEqual(r.state, "ended", "the session's halt/drop is not confirmed");
  assert.equal(LIVE.includes(r.state), true, "the run stays under observation");
  writeRuns(dir, runs);
  await cleanupEndedTrees(dir, runs);
  assert.equal(readRuns(dir).own.tree.state, "ready", "its tree is not removed");
});
