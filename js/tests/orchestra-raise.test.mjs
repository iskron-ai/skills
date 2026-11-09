// Behavioural probes of the orchestrator's leading (bridge/orchestra-lead.ts and its halves —
// graph @nks/nks-dev, nodes #7513, #5042, #7517, #7518, #8203; decisions of case №4050): a real
// daemon against the fake NKS, the human's launcher description in the fake mind and a
// substitute `orca` on the daemon's PATH that records argv instead of launching.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const NODE = process.env.ISKRON_NODE || process.execPath;
const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
const FAKE_ORCA = join(dirname(fileURLToPath(import.meta.url)), "fake-orca.mjs");
const REALM = "@nks/nks-dev";
const ROOM = "725414c2-7078-4dfa-a5b9-140adb3b3422";
const REPO = "github.com/probe/one";

function cli(dir, args, env = {}) {
  const proc = spawn(NODE, [BRIDGE, "orchestra", ...args, "--auth-dir", dir, "--lang", "en"], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (err += c));
  return new Promise((resolve) => {
    proc.once("exit", (code) => resolve({ code, out, err }));
    setTimeout(() => proc.kill("SIGKILL"), 30_000).unref();
  });
}

const describe = (over = {}) => ({
  seq: over.seq ?? 77,
  body: JSON.stringify({
    launcher: "probe-mac",
    host: hostname(),
    adapter: "orca",
    limit: 2,
    harnesses: { opencode: { models: ["anthropic/claude-opus-5-5"] } },
    ...over.body,
  }),
});

/** Orca's own projects as 1.4.242 prints them: the probe repository has one ready local setup. */
const orcaProjects = (checkout) => ({
  projects: [
    {
      id: "p-one",
      name: "one",
      gitRemoteIdentity: { canonicalKey: REPO, remoteUrl: `git@github.com:probe/one.git` },
    },
    {
      id: "p-two",
      name: "one", // the same name, another repository: names never decide
      gitRemoteIdentity: {
        canonicalKey: "github.com/other/one",
        remoteUrl: "https://github.com/other/one.git",
      },
    },
  ],
  setups: [
    { projectId: "p-one", path: checkout, setupState: "ready", hostId: "local" },
    { projectId: "p-one", path: "/remote/one", setupState: "ready", hostId: "ssh-box" },
    { projectId: "p-two", path: "/elsewhere/one", setupState: "ready", hostId: "local" },
  ],
});

const invite = (entry, attrs, repository = REPO) => ({
  entry_id: entry,
  room_id: ROOM,
  karta_seq: 931,
  author: "@alari:lead",
  at: "2026-11-09T10:00:00Z",
  payload: { holon: { seq: 4057, repository } },
  attrs,
});
const GOOD = { launcher: "probe-mac", harness: "opencode", model: "anthropic/claude-opus-5-5" };

const signal = (i, entry, rooms, seat = "seat-raised") => ({
  id: `s${i}`,
  standing: { id: seat, standing: `@tester:${seat}` },
  n: i,
  spawned_for: { invite: entry, room: ROOM },
  cause: rooms.length ? "joined" : "left",
  room: { id: ROOM },
  rooms: rooms.map((id) => ({ id })),
  at: `2026-11-09T10:00:0${i}Z`,
  cursor: `c${i}`,
});

/** A leading daemon: flag on, the fake's api beside a hold record, a substitute orca on PATH. */
async function leading(t, { descriptions, projects, env = {}, admitted = true } = {}) {
  // Short: the daemon's sockets live under it, and a Unix socket path is capped near 104 bytes.
  const dir = mkdtempSync(join(tmpdir(), "iskron-or-"));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout);
  const fake = await startFakeNks({
    pat: "probe-pat",
    mind: { orchestra: descriptions?.(checkout) ?? [describe()] },
  });
  writeFileSync(join(dir, "server"), `${fake.base}/mcp\n`);
  writeFileSync(join(dir, "token"), "probe-pat");
  mkdirSync(join(dir, "standings"), { recursive: true });
  writeFileSync(
    join(dir, "standings", "probe-1.hold"),
    JSON.stringify({
      realm: REALM,
      karta: 931,
      name: "probe-1",
      url: `${fake.base}/channel/ws/probe-1`,
      at: Date.now(),
    }) + "\n",
  );
  mkdirSync(join(dir, "run"), { recursive: true, mode: 0o700 }); // the seam refuses a shared dir
  writeFileSync(join(dir, "run", "orchestra.json"), JSON.stringify({ on: true, realms: [REALM] }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "orca"), `#!/bin/sh\nexec "${NODE}" "${FAKE_ORCA}" "$@"\n`, {
    mode: 0o755,
  });
  const log = join(dir, "orca.log");
  const laid = join(dir, "orca-projects.json");
  writeFileSync(laid, JSON.stringify((projects ?? orcaProjects)(checkout)));
  const denv = {
    ...process.env,
    ISKRON_BRIDGE_NO_UPDATE: "1",
    ISKRON_BRIDGE_DAEMON_IDLE_MS: "15000",
    ISKRON_ORCHESTRA_TACT_MS: "3600000",
    ISKRON_BRIDGE_LANG: "en", // the tact's words are the daemon's
    PATH: `${bin}:${process.env.PATH}`,
    FAKE_ORCA_LOG: log,
    FAKE_ORCA_PROJECTS: laid,
    ...(admitted ? { ISKRON_ORCHESTRA: "1" } : {}),
    ...env,
  };
  if (!admitted) delete denv.ISKRON_ORCHESTRA;
  const daemon = spawn(NODE, [BRIDGE, "daemon", "--auth-dir", dir], {
    env: denv,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let derr = "";
  daemon.stderr.on("data", (c) => (derr += c));
  t.after(async () => {
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const ended = new Promise((r) => daemon.once("exit", r));
      daemon.kill("SIGKILL");
      await ended;
    }
    await fake.stop();
  });
  for (let i = 0; ; i++) {
    const r = await cli(dir, ["status"]);
    if (r.code === 0) break;
    if (i > 100) throw new Error(`daemon not ready: ${r.err}\n${derr.slice(-1500)}`);
    await new Promise((r2) => setTimeout(r2, 100));
  }
  return {
    dir,
    fake,
    checkout,
    step: () => cli(dir, ["step"]),
    launches: () =>
      existsSync(log)
        ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
        : [],
    runs: () => {
      const f = join(dir, "run", "orchestra-runs.json");
      return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).runs : {};
    },
    queue: (invites, signals = []) =>
      fake.control({ orchestra: { realms: { [REALM]: { invites, signals } } } }),
  };
}

test("raise: an invite naming this machine's launcher is launched once through orca, with spawned_for first", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  const first = await o.step();
  assert.equal(first.code, 0, first.err + first.out);
  assert.match(first.out, /invite 9: launched/, first.out);
  const [argv, ...more] = o.launches();
  assert.equal(more.length, 0, "exactly one launch");
  assert.deepEqual(argv.slice(0, 8), [
    "agent",
    "launch",
    "--agent",
    "opencode",
    "--worktree",
    `path:${o.checkout}`,
    "--model",
    "anthropic/claude-opus-5-5",
  ]);
  const prompt = argv[argv.indexOf("--prompt") + 1];
  assert.equal(prompt.split("\n")[0], `spawned_for: {"invite":9,"room":"${ROOM}"}`);
  assert.match(prompt, new RegExp(`start ${REALM} 931`));
  assert.equal(argv.at(-1), "--json");
  const run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.state, "launched");
  // The invite still stands (the agent has not joined yet): no second agent for it.
  const again = await o.step();
  assert.equal(again.code, 0, again.err);
  assert.equal(o.launches().length, 1, "a registered invite is never launched again");
});

test("raise: without a matching launcher, harness, model or checkout nothing is launched and the refusal is said", async (t) => {
  const o = await leading(t);
  await o.queue([
    invite(1, {}),
    invite(2, { ...GOOD, launcher: "nobody" }),
    invite(3, { ...GOOD, harness: "claude" }),
    invite(4, { ...GOOD, model: "other/model" }),
    invite(5, GOOD, "github.com/probe/unmapped"),
    invite(6, GOOD, null),
    invite(7, { launcher: "probe-mac", model: GOOD.model }),
  ]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  for (const [n, code] of [
    [1, "launcher_missing"],
    [2, "launcher_unknown"],
    [3, "harness_not_offered"],
    [4, "model_not_offered"],
    [5, "no_checkout"],
    [6, "no_checkout"],
    [7, "harness_missing"],
  ])
    assert.match(r.out, new RegExp(`invite ${n}: ${code}`), r.out);
  assert.equal(o.launches().length, 0, "nothing was launched");
  const st = await cli(o.dir, ["status"]);
  assert.match(st.out, /leading: .*launcher_missing/, st.out);
});

test("raise: an offered harness the adapter does not know is refused, not launched", async (t) => {
  const o = await leading(t, {
    descriptions: () => [
      describe({
        body: {
          harnesses: { opencode: { models: [GOOD.model] }, codex: { models: [GOOD.model] } },
        },
      }),
    ],
  });
  await o.queue([invite(3, { ...GOOD, harness: "codex" })]);
  const r = await o.step();
  assert.match(r.out, /invite 3: harness_unsupported/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: the checkout comes from Orca's own projects — the remote decides, the name never", async (t) => {
  const o = await leading(t, {
    projects: (checkout) => ({
      projects: [
        {
          id: "p-url",
          name: "x",
          gitRemoteIdentity: { remoteUrl: "https://github.com/probe/one.git" },
        },
        { id: "p-name", name: "one", gitRemoteIdentity: { canonicalKey: "github.com/x/one" } },
      ],
      setups: [
        { projectId: "p-url", path: checkout, setupState: "ready", hostId: "local" },
        { projectId: "p-url", path: "/half", setupState: "pending", hostId: "local" },
        { projectId: "p-name", path: "/by-name", setupState: "ready", hostId: "local" },
      ],
    }),
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches()[0][5], `path:${o.checkout}`);
});

test("raise: two ready local setups of the repository — ambiguous, nothing launched", async (t) => {
  const o = await leading(t, {
    projects: (checkout) => {
      const p = orcaProjects(checkout);
      p.setups.push({ projectId: "p-one", path: tmpdir(), setupState: "ready", hostId: "local" });
      return p;
    },
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: ambiguous_checkout/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: the description's own checkout overrides Orca for its key; no host answers any machine", async (t) => {
  const own = mkdtempSync(join(tmpdir(), "iskron-co-"));
  const o = await leading(t, {
    descriptions: () => [describe({ body: { host: undefined, checkouts: { [REPO]: own } } })],
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches()[0][5], `path:${own}`);
});

test("raise: the description's limit holds — the second invite waits", async (t) => {
  const o = await leading(t, {
    descriptions: () => [describe({ body: { limit: 1 } })],
  });
  await o.queue([invite(1, GOOD), invite(2, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 1: launched/, r.out);
  assert.match(r.out, /invite 2: limit_reached/, r.out);
  assert.equal(o.launches().length, 1);
});

test("raise: a description of another machine is not raised here, its host said aloud; a broken one too", async (t) => {
  const o = await leading(t, {
    descriptions: () => [
      describe({ body: { launcher: "elsewhere", host: "another-host" } }),
      { seq: 78, body: "not json at all" },
    ],
  });
  await o.queue([invite(1, { ...GOOD, launcher: "elsewhere" })]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  // A host naming no machine would raise nowhere in silence: every machine names the host it read.
  assert.match(r.out, /invite 1: host_elsewhere \(another-host\)/, r.out);
  assert.match(r.out, /#78 in mind: description_not_json/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: the host is this machine's name in any letter case", async (t) => {
  const o = await leading(t, {
    descriptions: () => {
      const h = hostname();
      return [
        describe({ body: { host: h.toLowerCase() !== h ? h.toLowerCase() : h.toUpperCase() } }),
      ];
    },
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches().length, 1);
});

test("raise: the caller gone mid-tact — no further launch, no cursor moves (#8202)", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_DELAY_MS: "6000" } });
  await o.queue([invite(1, GOOD), invite(2, GOOD)]);
  const r = await o.step();
  assert.notEqual(r.code, 0, "the client gave up inside its ceiling — a refusal");
  // Past the first launch's answer and what a second launch would take.
  await new Promise((done) => setTimeout(done, 9_000));
  assert.equal(o.launches().length, 1, "no launch after the caller left");
  assert.equal(o.runs()[`${REALM}|${ROOM}|1`].state, "launched", "the launch done is registered");
  const cursors = JSON.parse(readFileSync(join(o.dir, "run", "orchestra-cursors.json"), "utf8"));
  assert.equal(cursors.realms[REALM], undefined, "no cursor moved after the caller left");
});

test("raise: an unobserved orca version launches nothing", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_VERSION: "1.5.0" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: orca_version_unverified/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: a failed launch is a refused run, not retried", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_EXIT: "3" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launch_exit_3/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "refused");
  await o.step();
  assert.equal(o.launches().length, 1, "no second launch");
});

test("raise: without the machine's consent the flag on disk raises nothing", async (t) => {
  const o = await leading(t, { admitted: false });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /has not admitted/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: the daemon's own timer leads — no step is asked", async (t) => {
  const o = await leading(t, { env: { ISKRON_ORCHESTRA_TACT_MS: "300" } });
  await o.queue([invite(9, GOOD)]);
  const until = Date.now() + 15_000;
  while (!o.launches().length && Date.now() < until) await new Promise((r) => setTimeout(r, 200));
  assert.equal(o.launches().length, 1, "the timer raised the agent by itself");
});

test("quench: our seat's empty composition after it sat gets one composition_empty stop order", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  // The seat registered with our spawned_for and sat in the case: raised, not to be stopped.
  await o.queue([], [signal(1, 9, [ROOM])]);
  const sat = await o.step();
  assert.equal(sat.code, 0, sat.err);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
  assert.equal(o.fake.state.orders.human.length, 0, "a seat in a case is not stopped");
  // Its case closed: the composition is empty — the stop order goes out with the reason.
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, [])]);
  const empty = await o.step();
  assert.equal(empty.code, 0, empty.err);
  const stops = o.fake.state.orders.human.filter((h) => h.method === "POST");
  assert.equal(stops.length, 1, JSON.stringify(o.fake.state.orders.human));
  assert.equal(stops[0].id, "seat-raised");
  assert.equal(stops[0].realm, REALM);
  assert.equal(stops[0].body.reason_code, "composition_empty");
  assert.match(stops[0].body.client_id, /^orchestra-[0-9a-f]{32}$/);
  // The fake knows no such live seat (410): the seat is gone, the run ended, nothing repeats.
  assert.match(empty.out, /invite 9: seat_gone/, empty.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
  await o.step();
  assert.equal(o.fake.state.orders.human.filter((h) => h.method === "POST").length, 1);
});

test("quench: a membership landing after the read cancels the end — the re-check reads the tape again", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orchestra: {
      realms: {
        [REALM]: {
          invites: [],
          signals: [signal(1, 9, [ROOM]), signal(2, 9, [])],
          late: [signal(3, 9, [ROOM])],
        },
      },
    },
  });
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: composition_changed/, r.out);
  assert.equal(o.fake.state.orders.human.length, 0, "no stop order on a fresh membership");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
});

test("quench: a raised seat that never joined within the window is a failed launch — stopped (#9970)", async (t) => {
  const o = await leading(t, { env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500" } });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await new Promise((done) => setTimeout(done, 2_000));
  await o.queue([], [signal(1, 9, [])]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: no_join/, r.out);
  const stops = o.fake.state.orders.human.filter((h) => h.method === "POST");
  assert.equal(stops.length, 1, JSON.stringify(o.fake.state.orders.human));
  assert.equal(stops[0].id, "seat-raised");
  assert.equal(stops[0].body.reason_code, "composition_empty");
});

/** Our seat sat and its composition emptied; the stop answers `answer`, an open order lies. */
async function stopping(t, answer, order) {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orders_stop_answer: answer,
    stop_order: { id: order, standing_id: "seat-raised", realm: REALM, frame: false },
  });
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, [])]);
  const r = await o.step();
  assert.match(r.out, /invite 9: stop_ordered/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  return o;
}

test("quench: a stop answered without an id ends when no open order is left for the seat", async (t) => {
  const o = await stopping(t, { status: 201, body: {} }, "ord-x");
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", "its order is still open");
  const closed = await fetch(`${o.fake.base}/api/me/orders/ord-x/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state: "stopped" }),
  });
  assert.equal(closed.status, 200);
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
});

test("quench: a stopping run whose graph left the boundary is not ended by the order's absence", async (t) => {
  const o = await stopping(t, { status: 201, body: { id: "ord-b" } }, "ord-b");
  const other = "@probe/other";
  writeFileSync(
    join(o.dir, "run", "orchestra.json"),
    JSON.stringify({ on: true, realms: [other] }),
  );
  const hold = join(o.dir, "standings", "probe-1.hold");
  writeFileSync(hold, JSON.stringify({ ...JSON.parse(readFileSync(hold, "utf8")), realm: other }));
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", "its order was not read");
});

test("quench: a seat the orchestrator did not launch is never stopped", async (t) => {
  const o = await leading(t);
  await o.queue([], [signal(1, 42, [ROOM], "seat-foreign"), signal(2, 42, [], "seat-foreign")]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.equal(o.fake.state.orders.human.length, 0);
});
