// Behavioural probes of the orchestrator's leading (bridge/orchestra-lead.ts and its halves —
// graph @nks/nks-dev, nodes #7513, #5042, #7517, #7518, #8203; decisions of case №4050): a real
// daemon against the fake NKS, the human's launcher description in the fake mind and a
// substitute `orca` on the daemon's PATH that records argv instead of launching.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BUILT_BRIDGE } from "./built.mjs";
import { startFakeNks } from "./fake-nks.mjs";
import { initCheckout } from "./git-checkout.mjs";

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

/** A caller that gives up after 5 s — a manual step otherwise waits for the tact's outcome. */
const GIVE_UP = { ISKRON_ORCHESTRA_STEP_WAIT_MS: "5000" };

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

/** author — the caller's seat address, a string, as the invites door carries it (#4951; LOCAL
 * 0.169.0 answered "author":"@skills-probe:lead", 09.11.2026); the fake's account is @tester, so
 * the default call is the machine's own. */
const invite = (entry, attrs, repository = REPO, author = "@tester:lead") => ({
  entry_id: entry,
  room_id: ROOM,
  karta_seq: 931,
  author,
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

const orcaCalls = (log) =>
  existsSync(log)
    ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];

async function waitEnded(o, invite = 9) {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const r = o.runs()[`${REALM}|${ROOM}|${invite}`];
    if (r?.state === "ended" && r.tree?.state === "removed") return r;
    await new Promise((done) => setTimeout(done, 50));
  }
  assert.fail(`exit/stop/cleanup not observed: ${JSON.stringify(o.runs())}`);
}

/** The checkout's cover: the raised agent's root seats itself by it (opencode/rootseat.ts). */
const coverOf = (graph = REALM, role = 931) =>
  `---\niskron:\n  graph: ${graph}\n  holon: 4057\n  agent_role: ${role}\n---\n# probe\n`;
const cover = (dir, text = coverOf()) => {
  writeFileSync(join(dir, "AGENTS.md"), text);
  initCheckout(dir);
};

/** A leading daemon: flag on, the fake's api beside a hold record, a substitute orca on PATH. */
async function leading(
  t,
  { descriptions, projects, env = {}, admitted = true, whoami, covered = coverOf(), holons } = {},
) {
  // Short: the daemon's sockets live under it, and a Unix socket path is capped near 104 bytes.
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "iskron-or-")));
  const checkout = join(dir, "checkout");
  mkdirSync(checkout);
  if (covered) cover(checkout, covered);
  const fake = await startFakeNks({
    pat: "probe-pat",
    mind: { orchestra: descriptions?.(checkout) ?? [describe()], holons },
    whoami,
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
  writeFileSync(
    join(bin, "ssh"),
    `#!${NODE}\nconst fs = require('node:fs');\nfs.appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify(process.argv.slice(2))+'\\n');\nprocess.stdout.write(process.env.FAKE_SSH_OUT || 'hostname github.com\\nidentityfile SECRET\\n');\nprocess.exit(Number(process.env.FAKE_SSH_EXIT || 0));\n`,
    { mode: 0o755 },
  );
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
    FAKE_SSH_LOG: join(dir, "ssh.log"),
    FAKE_ORCA_PROJECTS: laid,
    FAKE_ORCA_RUNTIME_FILE: join(dir, "orca-runtime"),
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
    rmSync(dir, { recursive: true, force: true });
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
    launches: () => orcaCalls(log).filter((a) => a[0] === "agent"),
    closes: () => orcaCalls(log).filter((a) => a[0] === "terminal" && a[1] === "close"),
    terminals: () => orcaCalls(log).filter((a) => a[0] === "terminal"),
    /** A restarted Orca: its answers carry this runtime id from now on. */
    restartOrca: (runtime) => writeFileSync(join(dir, "orca-runtime"), runtime),
    runs: () => {
      const f = join(dir, "run", "orchestra-runs.json");
      return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).runs : {};
    },
    /** The registry's clone rows by repository. */
    cloneRows: () => {
      const f = join(dir, "run", "orchestra-runs.json");
      return (existsSync(f) && JSON.parse(readFileSync(f, "utf8")).clones) || {};
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
  // Calls of different cases share their numbers: the row names its case (№4050 [74] (г)).
  assert.match(first.out, new RegExp(`case ${ROOM} invite 9: launched`), first.out);
  const [argv, ...more] = o.launches();
  assert.equal(more.length, 0, "exactly one launch");
  assert.deepEqual(argv.slice(0, 8), [
    "agent",
    "launch",
    "--agent",
    "opencode",
    "--worktree",
    `path:${o.runs()[`${REALM}|${ROOM}|9`].worktree}`,
    "--model",
    "anthropic/claude-opus-5-5",
  ]);
  const prompt = argv[argv.indexOf("--prompt") + 1];
  // One line (#9969 v12): the pair opens the line, the brief follows through a space — a
  // multi-line --prompt the terminal turns into a paste that is never sent (#9966 v18).
  assert.ok(prompt.startsWith(`iskron/spawned_for: {"invite":9,"room":"${ROOM}"} `), prompt);
  assert.ok(!/[\r\n]/.test(prompt), `the brief is one line: ${JSON.stringify(prompt)}`);
  // The brief is the join before work (#10043); the plugin tells the taken word itself.
  assert.ok(
    prompt.includes(`iskron_case(action="join", realm="${REALM}", room="${ROOM}")`),
    prompt,
  );
  // The root took the seat by the spawned_for pair (№4050 [55]): no start line, no word to
  // stand or confirm the claim again — a second registration of the same pair.
  assert.doesNotMatch(prompt, /(^|\s)start /);
  assert.doesNotMatch(prompt, /confirm the claim|iskron_stand/, prompt);
  // A 439-character line arrived as an unsent paste, ~230 were sent (#9966): keep it short.
  assert.ok(prompt.length <= 220, `${prompt.length}: ${prompt}`);
  assert.equal(argv.at(-1), "--json");
  const run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.state, "launched");
  // The launch answer's own words, a safe short projection (#9966 v18, #9969 v12).
  assert.deepEqual(run.prompt, { delivery: "submit", outcome: "handed-to-terminal" });
  assert.deepEqual(run.receipt, { mode: "terminal", reason: "requested" });
  // The invite still stands (the agent has not joined yet): no second agent for it.
  const again = await o.step();
  assert.equal(again.code, 0, again.err);
  assert.equal(o.launches().length, 1, "a registered invite is never launched again");
});

// #9966 v18, #9969 v12: a launch is accepted only when the answer says the one-line prompt
// was submitted (delivery "submit", outcome "handed-to-terminal" — the only pair observed).
// Anything else is ambiguity with the observed words kept in the Run — never a second agent.
for (const [name, env, prompt] of [
  ["no prompt field", { FAKE_ORCA_PROMPT_DELIVERY: "none" }, undefined],
  [
    "delivery not submit",
    { FAKE_ORCA_PROMPT_DELIVERY: "queue" },
    { delivery: "queue", outcome: "handed-to-terminal" },
  ],
])
  test(`raise: a launch answer without a submit receipt stays ambiguous: ${name}`, async (t) => {
    const o = await leading(t, { env });
    await o.queue([invite(10, GOOD)]);
    const first = await o.step();
    assert.equal(first.code, 0, first.err + first.out);
    assert.match(first.out, /invite 10: prompt_not_submitted/, first.out);
    const run = o.runs()[`${REALM}|${ROOM}|10`];
    assert.equal(run.state, "ambiguity", JSON.stringify(run));
    assert.equal(run.why, "prompt_not_submitted");
    assert.deepEqual(run.prompt, prompt);
    // The ambiguous launch keeps its occupied limit: no ended, no tree removal, no repeat.
    const again = await o.step();
    assert.equal(again.code, 0, again.err);
    assert.equal(o.launches().length, 1, "an ambiguous launch is never repeated");
    assert.equal(o.runs()[`${REALM}|${ROOM}|10`].state, "ambiguity");
  });

test("raise: without a matching launcher, harness, model or checkout nothing is launched and the refusal is said", async (t) => {
  const o = await leading(t);
  await o.queue([
    invite(1, { ...GOOD, launcher: "" }),
    invite(2, { ...GOOD, launcher: "nobody" }),
    invite(3, { ...GOOD, harness: "claude" }),
    invite(4, { ...GOOD, model: "other/model" }),
    invite(5, GOOD, "github.com/probe/unmapped"),
    invite(6, GOOD, null),
    invite(7, { ...GOOD, harness: "" }),
  ]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  for (const [n, code] of [
    [1, "launcher_unknown"],
    [2, "launcher_unknown"],
    [3, "harness_not_offered"],
    [4, "model_not_offered"],
    [5, "no_checkout"],
    [6, "no_checkout"],
    [7, "harness_not_offered"],
  ])
    assert.match(r.out, new RegExp(`invite ${n}: ${code}`), r.out);
  assert.equal(o.launches().length, 0, "nothing was launched");
  const st = await cli(o.dir, ["status"]);
  assert.match(st.out, /leading: .*launcher_unknown/, st.out);
});

test("defaults: plain and partial invites resolve identically in dry-run and actual registry without writes to mind", async (t) => {
  const o = await leading(t, {
    descriptions: (checkout) => [describe({ body: { limit: 8, checkouts: { [REPO]: checkout } } })],
  });
  const attrs = [
    {},
    { launcher: null, harness: null, model: null },
    { launcher: GOOD.launcher },
    { harness: GOOD.harness },
    { model: GOOD.model },
    { launcher: GOOD.launcher, model: GOOD.model },
  ];
  await o.queue(attrs.map((a, n) => invite(n + 1, a)));
  const dry = await cli(o.dir, ["step", "--dry-run"]);
  for (let n = 1; n <= attrs.length; n++)
    assert.match(
      dry.out,
      new RegExp(`invite ${n}: would launch: .*--agent opencode .*--model ${GOOD.model}`),
      dry.out,
    );
  assert.equal(o.launches().length, 0);
  assert.deepEqual(o.runs(), {});
  const actual = await o.step();
  for (let n = 1; n <= attrs.length; n++) {
    assert.match(actual.out, new RegExp(`invite ${n}: launched`), actual.out);
    const run = o.runs()[`${REALM}|${ROOM}|${n}`];
    for (const k of ["launcher", "harness", "model"]) assert.equal(run[k], GOOD[k]);
  }
  assert.equal(o.launches().length, attrs.length);
  assert.equal(adds(o).length, 0);
  assert.doesNotMatch(dry.out + actual.out, /callers|checkouts|identityfile|SECRET/);
});

test("detached tree: ordinary launch never uses the source checkout and records its immutable base", async (t) => {
  const o = await leading(t);
  await o.queue([invite(1, {})]);
  const r = await o.step();
  assert.match(r.out, /invite 1: launched/, r.out);
  const run = o.runs()[`${REALM}|${ROOM}|1`];
  assert.notEqual(run.worktree, o.checkout);
  assert.equal(o.launches()[0][5], `path:${run.worktree}`);
  assert.match(run.worktree, new RegExp(`^${o.checkout}/\\.worktrees/orchestra-[a-f0-9-]+$`));
  assert.equal(run.tree.state, "ready");
  assert.match(run.tree.baseOID, /^[a-f0-9]{40,64}$/);
  assert.equal(run.tree.source, o.checkout);
  assert.equal(run.tree.room, ROOM);
  assert.equal(run.tree.invite, 1);
});

test("role gate: flat authoritative NodeView permits only adhikarin before any default or launch", async (t) => {
  const node = {
    seq: 931,
    node_type: "karta",
    is_active: true,
    manifested_as: "adhikarin",
    edges: [],
    neighbors: [],
  };
  for (const [over, status, code] of [
    [{ manifested_as: "svatantra" }, 0, "human_role_not_executable"],
    [{ manifested_as: "pratibimba" }, 0, "role_not_executable"],
    [{ manifested_as: "agantuka" }, 0, "role_not_executable"],
    [{ manifested_as: null }, 0, "role_kind_unknown"],
    [{ manifested_as: undefined }, 0, "role_kind_unknown"],
    [{ manifested_as: "future" }, 0, "role_kind_unknown"],
    [{ node_type: "phenomenon" }, 0, "role_not_karta"],
    [{ seq: 932 }, 0, "role_unverified"],
    [{ is_active: false }, 0, "role_inactive"],
    [{}, 404, "role_unreadable"],
    [{}, 503, "role_unreadable"],
  ]) {
    const o = await leading(t);
    o.fake.state.roleNode = { ...node, ...over };
    o.fake.state.roleStatus = status;
    await o.queue([invite(1, {}), invite(2, GOOD)]);
    for (const args of [["step", "--dry-run"], ["step"]]) {
      const r = await cli(o.dir, args);
      assert.match(r.out, new RegExp(`invite 1: (would refuse: )?${code}`), r.out);
      assert.match(r.out, new RegExp(`invite 2: (would refuse: )?${code}`), r.out);
    }
    assert.equal(
      o.fake.state.roleReads,
      4,
      "one authoritative node read per considered invite per tact",
    );
    assert.equal(o.launches().length, 0);
    assert.deepEqual(o.runs(), {});
    assert.equal(existsSync(join(o.dir, "orca.log")), false);
  }
});

test("only selector: exactly one open invite, no neighbour stops/cleanup/cursors; same dry filtering", async (t) => {
  const o = await leading(t);
  const neighbour = {
    realm: REALM,
    room: ROOM,
    invite: 99,
    state: "launched",
    at: "2000-01-01T00:00:00Z",
    terminal: "neighbour",
    runtime: "rt_fake",
  };
  writeFileSync(join(o.dir, "run", "orchestra-runs.json"), JSON.stringify({ runs: { neighbour } }));
  const cursor = join(o.dir, "run", "orchestra-cursors.json");
  writeFileSync(cursor, JSON.stringify({ realms: { [REALM]: { cursor: "do-not-move" } } }));
  const before = readFileSync(cursor, "utf8");
  await o.queue([invite(1, {}), invite(2, GOOD)], [signal(1, 99, [])]);
  const args = ["step", "--realm", REALM, "--only", `${ROOM}/2`];
  const dry = await cli(o.dir, [...args, "--dry-run"]);
  assert.equal(dry.code, 0, dry.err + dry.out);
  assert.match(dry.out, /invite 2: would launch:/);
  assert.doesNotMatch(dry.out, /invite 1:/);
  assert.equal(o.fake.state.roleReads, 1);
  const real = await cli(o.dir, args);
  assert.equal(real.code, 0, real.err + real.out);
  assert.match(real.out, /invite 2: launched/);
  assert.equal(o.launches().length, 1);
  assert.equal(o.fake.state.roleReads, 2);
  assert.deepEqual(o.runs().neighbour, neighbour);
  assert.equal(o.runs()[`${REALM}|${ROOM}|1`], undefined);
  assert.equal(readFileSync(cursor, "utf8"), before);
  assert.equal(o.closes().length, 0);
  assert.equal(o.fake.state.orders.human.length, 0);
});

test("only selector: malformed, duplicate, missing, wrong scope and incomplete snapshot never fall back", async (t) => {
  const o = await leading(t);
  await o.queue([invite(1, {})]);
  for (const args of [
    ["step", "--realm", REALM, "--only"],
    ["step", "--realm", REALM, "--only", "4867/6"],
    ["step", "--realm", REALM, "--only", `${ROOM}/0`],
    ["step", "--realm", REALM, "--only-unknown", `${ROOM}/1`],
    ["step", "--realm", REALM, "--only", `${ROOM}/1`, "unexpected"],
    ["step", "--realm", REALM, "--only", `${ROOM}/1`, "--only", `${ROOM}/1`],
    ["step", "--only", `${ROOM}/1`],
    ["on", "--realm", REALM, "--only", `${ROOM}/1`],
    ["step", "--realm", "@nks/foreign", "--only", `${ROOM}/1`],
    ["step", "--realm", REALM, "--only", `${ROOM}/9`],
  ]) {
    const r = await cli(o.dir, args);
    assert.notEqual(r.code, 0, r.out + r.err);
  }
  const args = ["step", "--realm", REALM, "--only", `${ROOM}/1`];
  await o.queue([invite(1, {}), invite(1, {})]);
  const duplicate = await cli(o.dir, args);
  assert.notEqual(duplicate.code, 0);
  assert.match(duplicate.err, /ambiguous/);
  await o.queue([]); // closed or withdrawn invites are absent from the authoritative queue
  assert.notEqual((await cli(o.dir, args)).code, 0);
  await o.queue([invite(1, {}), { ...invite(2, {}), room_id: null }]);
  assert.notEqual(
    (await cli(o.dir, args)).code,
    0,
    "a malformed unselected row still makes the full snapshot incomplete",
  );
  assert.equal(o.launches().length, 0);
  assert.deepEqual(o.runs(), {});
  assert.equal(o.fake.state.roleReads ?? 0, 0);
});

test("only selector: OFF permits one-shot machine consent only, never persists ON or widens scope", async (t) => {
  for (const by of ["env", "terminal"]) {
    const o = await leading(t, { admitted: false });
    assert.equal((await cli(o.dir, ["off"])).code, 0);
    await o.queue([invite(1, {}), invite(2, {})]);
    const args = ["step", "--realm", REALM, "--only", `${ROOM}/1`];
    const denied = await cli(o.dir, args, { ISKRON_ORCHESTRA: "0" });
    assert.notEqual(denied.code, 0);
    assert.equal(o.launches().length, 0);
    assert.equal(o.fake.state.roleReads ?? 0, 0);
    const before = readFileSync(join(o.dir, "run", "orchestra.json"), "utf8");
    const yes =
      by === "env"
        ? await cli(o.dir, args, { ISKRON_ORCHESTRA: "1" })
        : await atTerminal(o.dir, args);
    assert.equal(yes.code, 0, yes.err + yes.out);
    assert.equal(o.launches().length, 1);
    assert.equal(o.launches()[0][o.launches()[0].indexOf("--surface") + 1], "terminal");
    assert.equal(readFileSync(join(o.dir, "run", "orchestra.json"), "utf8"), before);
    assert.equal((await cli(o.dir, ["step"])).code, 0, "ordinary OFF step remains idle");
    assert.equal(o.launches().length, 1);
  }
});

test("terminal surface: an Orca schema without surface refuses before creating a tree", async (t) => {
  const o = await leading(t, {
    env: { FAKE_ORCA_LAUNCH_FLAGS: "agent,worktree,model,prompt,json" },
  });
  await o.queue([invite(1, {})]);
  const r = await o.step();
  assert.match(r.out, /orca_schema_unverified/, r.out);
  assert.equal(o.launches().length, 0);
  assert.equal(existsSync(join(o.checkout, ".worktrees")), false);
});

test("defaults: ambiguity, explicit unknown, forbidden caller and foreign host fail closed", async (t) => {
  for (const [descriptions, attrs, author, code] of [
    [
      [describe(), describe({ seq: 78, body: { launcher: "other" } })],
      {},
      "@tester",
      "launcher_ambiguous",
    ],
    [
      [describe({ body: { harnesses: { opencode: { models: [GOOD.model, "other"] } } } })],
      {},
      "@tester",
      "model_ambiguous",
    ],
    [[describe()], { launcher: "unknown" }, "@tester", "launcher_unknown"],
    [[describe()], { harness: "unknown" }, "@tester", "harness_not_offered"],
    [[describe()], { model: "unknown" }, "@tester", "model_not_offered"],
    [[describe()], { ...GOOD, launcher: "unknown" }, "@tester", "launcher_unknown"],
    [[describe()], { ...GOOD, harness: "unknown" }, "@tester", "harness_not_offered"],
    [[describe()], { ...GOOD, model: "unknown" }, "@tester", "model_not_offered"],
    [[describe({ body: { limit: 0 } })], {}, "@tester", "limit_reached"],
    [[describe()], {}, "@stranger", "caller_not_allowed"],
    [[describe({ body: { host: "foreign-host" } })], {}, "@tester", "launcher_missing"],
  ]) {
    const o = await leading(t, { descriptions: () => descriptions });
    await o.queue([invite(1, attrs, REPO, author)]);
    for (const args of [["step", "--dry-run"], ["step"]]) {
      const r = await cli(o.dir, args);
      assert.match(r.out, new RegExp(`invite 1: (would refuse: )?${code}`), r.out);
    }
    assert.equal(o.launches().length, 0);
  }
});

test("defaults: caller permission and explicit model narrow launchers without bypassing the local host or limit", async (t) => {
  const o = await leading(t, {
    descriptions: () => [
      describe({
        body: {
          limit: 1,
          callers: ["@friend"],
          harnesses: { opencode: { models: [GOOD.model] }, codex: { models: [GOOD.model] } },
        },
      }),
      describe({
        seq: 78,
        body: { launcher: "other", harnesses: { opencode: { models: ["other/model"] } } },
      }),
      describe({ seq: 79, body: { launcher: "foreign", host: "foreign-host" } }),
    ],
  });
  await o.queue([
    invite(1, {}, REPO, "@friend"),
    invite(2, { model: GOOD.model }),
    invite(3, { launcher: "foreign" }),
  ]);
  for (const args of [["step", "--dry-run"], ["step"]]) {
    const r = await cli(o.dir, args);
    assert.match(r.out, /invite 1: (would launch:|launched)/, r.out);
    assert.match(r.out, /invite 2: (would refuse: )?limit_reached/, r.out);
    assert.match(r.out, /invite 3: (would refuse: )?host_elsewhere/, r.out);
    assert.doesNotMatch(r.out, /foreign-host|callers|SECRET/);
  }
  assert.equal(o.launches().length, 1);
});

test("SSH alias: actual remote hostname comes only from ssh -G; repository path and failures stay closed", async (t) => {
  for (const [remoteUrl, sshOut, sshExit, succeeds] of [
    ["git@github-probe:probe/one.git", "hostname github.com\nidentityfile SECRET\n", "0", true],
    ["ssh://another-user@github-probe/probe/one.git", "hostname github.com\n", "0", true],
    ["git@github-probe:other/one.git", "hostname github.com\n", "0", false],
    ["git@github-probe:probe/one.git", "hostname other.example\n", "0", false],
    ["git@github-probe:probe/one.git", "hostname github.com\n", "1", false],
    ["git@github-probe:probe/one.git", "identityfile SECRET\n", "0", false],
    ["git@github-probe:probe/one.git", "hostname github.com\nhostname other.example\n", "0", false],
    ["https://github-probe/probe/one.git", "hostname github.com\n", "0", false],
  ]) {
    const o = await leading(t, {
      env: { FAKE_SSH_OUT: sshOut, FAKE_SSH_EXIT: sshExit },
      projects: (checkout) => ({
        projects: [
          {
            id: "alias",
            gitRemoteIdentity: {
              canonicalKey: "github-probe/probe/one",
              remoteUrl,
            },
          },
        ],
        setups: [{ projectId: "alias", path: checkout, setupState: "ready", hostId: "local" }],
      }),
    });
    await o.queue([invite(1, GOOD)]);
    const r = await o.step();
    assert.equal(o.launches().length, succeeds ? 1 : 0, r.out);
    assert.doesNotMatch(r.out, /identityfile|SECRET/);
    const log = join(o.dir, "ssh.log");
    if (remoteUrl.startsWith("https:")) assert.equal(existsSync(log), false);
    else {
      const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], "-G");
      assert.ok(calls[0].includes("github-probe"), JSON.stringify(calls));
    }
  }
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
  assert.equal(o.launches()[0][5], `path:${o.runs()[`${REALM}|${ROOM}|9`].worktree}`);
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
  cover(own);
  const o = await leading(t, {
    descriptions: () => [describe({ body: { host: undefined, checkouts: { [REPO]: own } } })],
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches()[0][5], `path:${o.runs()[`${REALM}|${ROOM}|9`].worktree}`);
});

// №4050 [56]: a checkout without the cover raised a harness that could not stand — nor be stopped.
test("raise: a checkout without the cover of the call's graph and role launches nothing", async (t) => {
  for (const [covered, code] of [
    [null, "checkout_uncovered"],
    ["# no front matter\n", "checkout_uncovered"],
    [coverOf(REALM, 932), "checkout_other_seat"],
    [coverOf("@nks/drugoy"), "checkout_other_seat"],
    [coverOf("r7"), "checkout_other_seat"],
    [coverOf("r999"), "checkout_cover_unresolved"],
  ]) {
    const o = await leading(t, { covered });
    await o.queue([invite(9, GOOD)]);
    const r = await o.step();
    assert.equal(r.code, 0, r.err + r.out);
    assert.match(r.out, new RegExp(`invite 9: ${code}`), `${covered}\n${r.out}`);
    assert.equal(o.launches().length, 0, `${covered}: nothing launched`);
    assert.equal(o.runs()[`${REALM}|${ROOM}|9`], undefined, "no registry row");
  }
});

test("raise: a cover naming the graph by its short form is the call's graph", async (t) => {
  const o = await leading(t, { covered: coverOf("r5") });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches().length, 1);
});

// №4050 [56]: no seat within the window — the terminal the orchestrator opened is closed by its
// own handle from the launch answer; the cause the harness refused with is not the daemon's to see.
test("raise: no seat within the window retains an ambiguous tree and occupied runtime", async (t) => {
  const o = await leading(t, {
    env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500", FAKE_ORCA_HANDLE: "term_probe1" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].terminal, "term_probe1");
  await new Promise((done) => setTimeout(done, 2_000));
  await o.queue([]);
  const r = await o.step();
  assert.match(r.out, /invite 9: tree_no_seat_unverified/, r.out);
  assert.deepEqual(o.closes(), []);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ambiguity");
  await o.step();
  assert.equal(o.closes().length, 0, "no unverified close");
});

// №4050 [71] item 2: an incomplete snapshot acts on nothing — not even the expiry's close.
test("raise: incomplete snapshot does not expire; complete snapshot names unknown exit without closing", async (t) => {
  const o = await leading(t, {
    env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500", FAKE_ORCA_HANDLE: "term_probe2" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await new Promise((done) => setTimeout(done, 2_000));
  const { room_id: _gone, ...broken } = invite(10, GOOD);
  await o.queue([broken]);
  const r = await o.step();
  assert.match(r.out, /incomplete/, r.out);
  assert.equal(o.closes().length, 0, "nothing closed by an incomplete snapshot");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "launched");
  await o.queue([]);
  const after = await o.step();
  assert.match(after.out, /invite 9: tree_no_seat_unverified/, after.out);
  assert.equal(o.closes().length, 0);
});

test("raise: no seat and no handle in the launch answer — said, nothing closed", async (t) => {
  const o = await leading(t, {
    env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500", FAKE_ORCA_HANDLE: "" },
  });
  await o.queue([invite(9, GOOD)]);
  const first = await o.step();
  assert.match(first.out, /tree_client_binding_unverified/, first.out);
  await new Promise((done) => setTimeout(done, 2_000));
  const r = await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ambiguity", r.out);
  assert.equal(o.closes().length, 0);
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

test("raise: a description of another machine is refused without its private host; a broken one too", async (t) => {
  const o = await leading(t, {
    descriptions: () => [
      describe({ body: { launcher: "elsewhere", host: "another-host" } }),
      { seq: 78, body: "not json at all" },
    ],
  });
  await o.queue([invite(1, { ...GOOD, launcher: "elsewhere" })]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 1: host_elsewhere/, r.out);
  assert.doesNotMatch(r.out, /another-host/);
  assert.match(r.out, /#78 in mind: description_not_json/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: only the machine's own account calls — a foreign or authorless call is refused aloud", async (t) => {
  const o = await leading(t);
  await o.queue([
    invite(1, GOOD),
    invite(2, GOOD, REPO, "@tester"),
    invite(3, GOOD, REPO, "@stranger:lead"),
    invite(4, GOOD, REPO, null),
    invite(5, GOOD, REPO, "tester:lead"),
  ]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 1: launched/, r.out);
  assert.match(r.out, /invite 2: launched/, r.out);
  assert.match(r.out, /invite 3: caller_not_allowed/, r.out);
  assert.match(r.out, /invite 4: caller_unknown/, r.out);
  assert.match(r.out, /invite 5: caller_unknown/, r.out);
  assert.equal(o.launches().length, 2);
});

test("raise: a caller named in the description's callers is raised, others still refused", async (t) => {
  const o = await leading(t, {
    descriptions: () => [describe({ body: { callers: ["@Stranger"] } })],
  });
  await o.queue([invite(1, GOOD, REPO, "@stranger:lead"), invite(2, GOOD, REPO, "@other:lead")]);
  const r = await o.step();
  assert.match(r.out, /invite 1: launched/, r.out);
  assert.match(r.out, /invite 2: caller_not_allowed/, r.out);
  assert.equal(o.launches().length, 1);
});

test("raise: a malformed callers list is a broken description, raising nothing", async (t) => {
  const o = await leading(t, {
    descriptions: () => [describe({ body: { callers: "@stranger" } })],
  });
  await o.queue([invite(1, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /probe-mac in mind: callers_invalid/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: the machine's account unknown — nothing is raised, said aloud", async (t) => {
  const o = await leading(t, { whoami: "Вызывающая идентичность: неизвестна" });
  await o.queue([invite(1, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /account_unknown/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: the account from an English whoami, a hyphenated handle — own calls only", async (t) => {
  // The en form as LOCAL 0.169.0 answers it (09.11.2026, №4050).
  const o = await leading(t, {
    whoami: "You are @skills-probe · handle @skills-probe (skills-probe@example.com)",
  });
  await o.queue([
    invite(1, GOOD, REPO, "@skills-probe:lead"),
    invite(2, GOOD, REPO, "@tester:lead"),
  ]);
  const r = await o.step();
  assert.match(r.out, /invite 1: launched/, r.out);
  assert.match(r.out, /invite 2: caller_not_allowed/, r.out);
  assert.equal(o.launches().length, 1);
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
  const r = await cli(o.dir, ["step"], GIVE_UP);
  assert.notEqual(r.code, 0, "the client gave up inside its ceiling — a refusal");
  // Past the first launch's answer and what a second launch would take.
  await new Promise((done) => setTimeout(done, 9_000));
  assert.equal(o.launches().length, 1, "no launch after the caller left");
  assert.equal(
    o.runs()[`${REALM}|${ROOM}|1`].state,
    "ambiguity",
    "slow binding reply is unknown, never retried",
  );
  const cursors = JSON.parse(readFileSync(join(o.dir, "run", "orchestra-cursors.json"), "utf8"));
  assert.equal(cursors.realms[REALM], undefined, "no cursor moved after the caller left");
});

test("raise: another orca version with the required capabilities launches", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_VERSION: "1.5.0" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.match(r.out, /Orca 1\.5\.0/, r.out);
  assert.equal(o.launches().length, 1);
});

test("raise: another orca version without a required flag launches nothing", async (t) => {
  const o = await leading(t, {
    env: { FAKE_ORCA_VERSION: "1.5.0", FAKE_ORCA_LAUNCH_FLAGS: "agent,worktree,model,json" },
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: orca_schema_unverified/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: unreadable version metadata does not override supported capabilities", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_VERSION_EXIT: "1" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches().length, 1);
});

test("raise: a failed launch is a refused run, not retried", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_EXIT: "3" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launch_exit_3/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ambiguity");
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

test("raise: the timer skips its tact while the last one runs — no chain of tacts behind a slow one", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-hold-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hold = join(dir, "hold");
  writeFileSync(hold, "");
  const o = await leading(t, { env: { ISKRON_ORCHESTRA_TACT_MS: "100", FAKE_ORCA_HOLD: hold } });
  await o.queue([invite(9, GOOD)]);
  const until = Date.now() + 15_000;
  while (!o.launches().length && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  assert.equal(o.launches().length, 1, "the timer's tact reached the launch");
  // The tact is held at the launch while the timer ticks many times over.
  await new Promise((r) => setTimeout(r, 1_500));
  // Off: no tact begins after the hold; then the held tact goes on and ends.
  assert.equal((await cli(o.dir, ["off"])).code, 0);
  rmSync(hold);
  // A step queues behind every tact begun before it: its answer — they all ended.
  const step = await o.step();
  assert.equal(step.code, 0, step.err);
  assert.match(step.out, /the tact is empty/, step.out);
  const journal = readFileSync(join(o.dir, "run", "daemon.log"), "utf8").split("\n");
  const at = journal.findIndex((l) => /orchestra tact: .*invite 9: launched/.test(l));
  assert.ok(at >= 0, journal.join("\n"));
  const behind = journal.slice(at + 1).filter((l) => /orchestra tact/.test(l));
  // Only automatic tacts are journalled: the explicit barrier step above is not one.
  assert.deepEqual(behind, [], "tacts were queued behind the held one");
  await new Promise((r) => setTimeout(r, 500));
  const later = readFileSync(join(o.dir, "run", "daemon.log"), "utf8").split("\n");
  assert.deepEqual(
    later.filter((l) => /orchestra tact/.test(l)),
    journal.filter((l) => /orchestra tact/.test(l)),
    "OFF must not schedule new automatic tacts for a pending client",
  );
});

/** The CLI as a human types it at a terminal: under a pseudo-terminal of `script`, its words
 * and its refusals on the one output. */
function atTerminal(dir, args) {
  const argv = [NODE, BRIDGE, "orchestra", ...args, "--auth-dir", dir, "--lang", "en"];
  const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const [cmd, cargs] =
    process.platform === "darwin"
      ? ["script", ["-q", "/dev/null", ...argv]]
      : ["script", ["-qec", argv.map(q).join(" "), "/dev/null"]];
  const proc = spawn(cmd, cargs, {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1" },
    // A socket for stdin makes script refuse (tcgetattr on a socket): /dev/null it is.
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  proc.stdout.on("data", (c) => (out += c));
  proc.stderr.on("data", (c) => (out += c));
  return new Promise((resolve) => {
    proc.once("exit", (code) => resolve({ code, out }));
    setTimeout(() => proc.kill("SIGKILL"), 30_000).unref();
  });
}

test("consent: on typed at a terminal admits the orchestrator in the living daemon, no variable, no restart; off takes it back", async (t) => {
  const o = await leading(t, { admitted: false });
  await o.queue([invite(9, GOOD)]);
  const refused = await cli(o.dir, ["on", "--realm", REALM]);
  assert.equal(refused.code, 1, "a piped on — an agent's shell — gives no consent");
  assert.match(refused.err, /terminal/, refused.err);
  const on = await atTerminal(o.dir, ["on", "--realm", REALM]);
  assert.equal(on.code, 0, on.out);
  assert.match(on.out, /the orchestrator is on/, on.out);
  const flag = JSON.parse(readFileSync(join(o.dir, "run", "orchestra.json"), "utf8"));
  assert.equal(flag.consent?.by, "terminal", JSON.stringify(flag));
  const r = await o.step();
  assert.doesNotMatch(r.out, /has not admitted/, r.out);
  assert.match(r.out, /invite 9: launched/, r.out);
  // A later piped on adding a graph is enabling there: refused (#7514); the consent given at
  // the terminal stays, and a piped on of the graph already named keeps it.
  const more = await cli(o.dir, ["on", "--realm", "@probe/more"]);
  assert.equal(more.code, 1, more.out);
  const same = await cli(o.dir, ["on", "--realm", REALM]);
  assert.equal(same.code, 0, same.err);
  assert.equal(
    JSON.parse(readFileSync(join(o.dir, "run", "orchestra.json"), "utf8")).consent?.by,
    "terminal",
  );
  const off = await cli(o.dir, ["off"]);
  assert.equal(off.code, 0, off.err);
  assert.equal(
    JSON.parse(readFileSync(join(o.dir, "run", "orchestra.json"), "utf8")).consent,
    undefined,
  );
  const again = await cli(o.dir, ["on", "--realm", REALM]);
  assert.equal(again.code, 1, "after off the consent is asked again");
});

const adds = (o) => o.fake.state.calls.filter((c) => c.name === "iskron_add_phenomenon");

test("on --launcher: the description is written once in mind; the next on takes it as it lies", async (t) => {
  const o = await leading(t, { descriptions: () => [] });
  const on = (more) => cli(o.dir, ["on", "--realm", REALM, "--launcher", "probe-new", ...more]);
  const first = await on(["--model", "m/one", "--model", "m/two", "--limit", "3", "--host", "box"]);
  assert.equal(first.code, 0, first.err + first.out);
  assert.match(first.out, /description of launcher probe-new written/, first.out);
  const [add, ...more] = adds(o);
  assert.equal(more.length, 0, "one write");
  assert.equal(add.arguments.realm, "mind");
  assert.deepEqual(add.arguments.attrs, { slice: "orchestra" });
  assert.deepEqual(JSON.parse(add.arguments.description), {
    launcher: "probe-new",
    host: "box",
    adapter: "orca",
    limit: 3,
    harnesses: { opencode: { models: ["m/one", "m/two"] } },
  });
  const again = await on(["--model", "m/other"]);
  assert.equal(again.code, 0, again.err + again.out);
  assert.match(again.out, /launcher probe-new: the existing description is taken/, again.out);
  assert.equal(adds(o).length, 1, "an existing description is never written again");
});

test("on --launcher: an existing description is not touched; a new one without --model is refused, the flag unmoved", async (t) => {
  const o = await leading(t);
  const kept = await cli(o.dir, ["on", "--launcher", "probe-mac", "--model", "x/y"]);
  assert.equal(kept.code, 0, kept.err + kept.out);
  assert.match(kept.out, /launcher probe-mac: the existing description is taken/, kept.out);
  assert.equal(adds(o).length, 0);
  await cli(o.dir, ["off"]);
  const bare = await cli(o.dir, ["on", "--launcher", "probe-bare"]);
  assert.equal(bare.code, 1, bare.out);
  assert.match(bare.err, /--model/, bare.err);
  assert.equal(adds(o).length, 0);
  assert.equal(JSON.parse(readFileSync(join(o.dir, "run", "orchestra.json"), "utf8")).on, false);
});

test("dry run: says what one tact would raise or refuse, and touches nothing — no orca, no cursor, no registry, no order", async (t) => {
  const o = await leading(t, {
    descriptions: (checkout) => [describe({ body: { checkouts: { [REPO]: checkout } } })],
  });
  await o.queue(
    [
      invite(9, GOOD),
      invite(2, { ...GOOD, launcher: "nobody" }),
      invite(5, GOOD, "github.com/probe/two"),
    ],
    [signal(1, 42, [ROOM], "seat-foreign")],
  );
  const run = join(o.dir, "run");
  const before = ["orchestra-cursors.json", "orchestra-runs.json", "orchestra-orders.json"].map(
    (f) => existsSync(join(run, f)),
  );
  const r = await cli(o.dir, ["step", "--dry-run"]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /dry run/i, r.out);
  assert.match(
    r.out,
    new RegExp(
      `invite 9: would launch: orca agent launch --agent opencode --worktree path:<own detached tree of ${REPO}> --model anthropic/claude-opus-5-5 --surface terminal --prompt <brief> --json`,
    ),
    r.out,
  );
  assert.match(r.out, /invite 2: would refuse: launcher_unknown/, r.out);
  // No map for this repository: Orca would name the checkout at launch — not asked now.
  assert.match(
    r.out,
    /invite 5: would launch: .*--worktree path:<own detached tree of github\.com\/probe\/two>/,
    r.out,
  );
  assert.equal(o.launches().length + o.closes().length, 0, "orca was not called");
  assert.ok(!existsSync(join(o.dir, "orca.log")), "not even for its version");
  assert.deepEqual(
    ["orchestra-cursors.json", "orchestra-runs.json", "orchestra-orders.json"].map((f) =>
      existsSync(join(run, f)),
    ),
    before,
    "no cursor, registry or orders cursor written",
  );
  assert.equal(o.fake.state.orders.human.length, 0, "no stop order");
  // The real tact after it starts from the same place: invite 9 is launched now.
  const real = await o.step();
  assert.match(real.out, /invite 9: launched/, real.out);
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
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
  assert.equal(o.closes().length, 0, "410 is neither runtime exit nor completed stop");
  await o.step();
  assert.equal(o.closes().length, 0, "unknown runtime is never closed or cleaned");
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

test("quench: the caller gone during the re-check — no stop order after it (#8202)", async (t) => {
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
          // The tact's read answers; the re-check is held until released — past the client's ceiling.
          raised_holds: [false, true],
        },
      },
    },
  });
  const r = await cli(o.dir, ["step"], GIVE_UP);
  assert.notEqual(r.code, 0, "the client gave up inside its ceiling — a refusal");
  assert.equal(o.fake.state.raisedHeld, 1, "the re-check was on hold when the client left");
  // The daemon has served a later ask: the closed socket of the gone caller is seen by now.
  assert.equal((await cli(o.dir, ["status"])).code, 0);
  // The held re-check answers with the tape unchanged — the end still stands; then the tape is
  // shut, so the next step, queued behind the gone tact, orders nothing of its own.
  await o.fake.control({ raised_release: true });
  await o.fake.control({ orchestra: { realms: { [REALM]: { refuse: 503 } } } });
  await o.step();
  assert.equal(o.fake.state.orders.human.length, 0, "no stop order after the caller left");
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "raised");
});

test("quench: a raised seat that never joined within the window is a failed launch — stopped (#9970)", async (t) => {
  const o = await leading(t, {
    env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500", FAKE_ORCA_WAIT_EXIT: "0" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  // Cross the independent client's exit-observer tick as well as the join window.
  await new Promise((done) => setTimeout(done, 6_000));
  const run = o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run.tree?.exit, undefined, `no_join needs a live client: ${JSON.stringify(run)}`);
  await o.queue([], [signal(1, 9, [])]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /invite 9: no_join/, `${r.out}\n${JSON.stringify(o.runs())}`);
  const stops = o.fake.state.orders.human.filter((h) => h.method === "POST");
  assert.equal(stops.length, 1, JSON.stringify(o.fake.state.orders.human));
  assert.equal(stops[0].id, "seat-raised");
  assert.equal(stops[0].body.reason_code, "composition_empty");
  assert.ok(
    o.terminals().some((a) => a[1] === "wait"),
    "the independent exit observer ran",
  );
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].tree?.exit, undefined, "no fabricated client exit");
});

/** Our seat sat and its composition emptied; the stop answers `answer`, an open order lies. */
async function stopping(t, answer, order, env = {}) {
  const o = await leading(t, { env });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({ orders_stop_answer: answer });
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, [])]);
  const r = await o.step();
  assert.match(r.out, /invite 9: stop_ordered(?!_elsewhere)/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  // The order our stop put, as the account's orders read it from now on.
  await o.fake.control({
    stop_order: { id: order, standing_id: "seat-raised", realm: REALM, frame: false },
  });
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
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
});

/** The agent's bridge answers the order with `state`, as it closes it. */
const ack = (o, order, state) =>
  fetch(`${o.fake.base}/api/me/orders/${order}/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state }),
  });

// A closed order that did not carry the stop out (#7522): the agent may still live — the run
// stays stopping and its tab open until the window passes, then frees its slot, tab untouched.
test("quench: a failed stop retains its runtime and tree past the window", async (t) => {
  const window = 6000;
  // The agent may live: its terminal is not seen to exit (an exited one ends on a failed stop).
  const o = await stopping(t, { status: 201, body: { id: "ord-f" } }, "ord-f", {
    ISKRON_ORCHESTRA_RAISE_WINDOW_MS: String(window),
    FAKE_ORCA_WAIT_EXIT: "0",
  });
  const since = Date.now();
  assert.equal((await ack(o, "ord-f", "failed")).status, 200);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", r.out);
  assert.equal(o.closes().length, 0, "a failed stop closes no tab");
  await new Promise((done) => setTimeout(done, Math.max(0, window + 500 - (Date.now() - since))));
  const late = await o.step();
  assert.equal(late.code, 0, late.err + late.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", late.out);
  assert.notEqual(o.runs()[`${REALM}|${ROOM}|9`].tree.state, "removed");
  assert.equal(o.closes().length, 0, "the tab of an agent that may live is never closed");
});

// Review of PR #724 п.3: an order left issued for good holds neither the slot nor the orders
// cursor past the window — the run ends said so, its tab untouched (#7522).
test("quench: an open stop past the window keeps its runtime, tree and held cursor", async (t) => {
  const window = 6000;
  const o = await stopping(t, { status: 201, body: { id: "ord-i" } }, "ord-i", {
    ISKRON_ORCHESTRA_RAISE_WINDOW_MS: String(window),
  });
  const since = Date.now();
  const cursor = () =>
    JSON.parse(readFileSync(join(o.dir, "run", "orchestra-orders.json"), "utf8")).since;
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", r.out);
  assert.equal(cursor(), 0, "within the window the open order is read again");
  await new Promise((done) => setTimeout(done, Math.max(0, window + 500 - (Date.now() - since))));
  const late = await o.step();
  assert.equal(late.code, 0, late.err + late.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", late.out);
  assert.equal(o.closes().length, 0, "the tab of an agent that may live is never closed");
  assert.equal(cursor(), 0, "an unknown stop still holds its cursor");
});

// Review of PR #724 п.4: a stop answered without an id is matched by its seat — never by an
// older closed order of that seat read again behind a held cursor.
test("quench: a stop without an id is not matched by an older closed order of its seat", async (t) => {
  const o = await stopping(t, { status: 201, body: {} }, "ord-y");
  await o.fake.control({
    stop_order: { id: "ord-old", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const old = o.fake.state.orders.list.get("ord-old");
  old.state = "failed";
  old.issued_at = new Date(Date.now() - 3_600_000).toISOString();
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  const run = () => o.runs()[`${REALM}|${ROOM}|9`];
  assert.equal(run().state, "stopping", r.out);
  assert.equal(run().order_id, undefined, "the old order is not the run's");
  assert.equal(run().stop_outcome, undefined, "nor its outcome");
  assert.equal((await ack(o, "ord-y", "stopped")).status, 200);
  const after = await o.step();
  assert.equal(after.code, 0, after.err + after.out);
  await waitEnded(o);
  assert.equal(run().state, "ended", after.out);
});

test("quench: someone else's stop closed refused does not end our run nor close its tab", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    stop_order: { id: "ord-n", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  o.fake.state.orders.list.get("ord-n").state = "refused";
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_refused_elsewhere/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0);
});

test("quench: a stopping run whose graph left the boundary ends when its order closes, not before", async (t) => {
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
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping", "its order is still open");
  // The account's open orders are read whole, whatever the boundary: the closed order frees
  // the run — and its limit slot (№4050 [32] п.3).
  const closed = await fetch(`${o.fake.base}/api/me/orders/ord-b/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state: "stopped" }),
  });
  assert.equal(closed.status, 200);
  const after = await o.step();
  assert.equal(after.code, 0, after.err + after.out);
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
});

test("quench: a stop on demand of our seat by someone else ends the run, closes its tab and frees its slot", async (t) => {
  const o = await leading(t, { descriptions: () => [describe({ body: { limit: 1 } })] });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([invite(9, GOOD), invite(10, GOOD)], [signal(1, 9, [ROOM])]);
  const full = await o.step();
  assert.match(full.out, /invite 10: limit_reached/, full.out);
  // A person (or the chief of staff) orders our raised seat to stop — not the orchestrator.
  await o.fake.control({
    stop_order: { id: "ord-h", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const open = await o.step();
  assert.equal(open.code, 0, open.err + open.out);
  assert.match(open.out, /invite 9: stop_ordered_elsewhere/, open.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0, "the seat still holds its order: the tab stays");
  // The agent's bridge carried the order out.
  const acked = await fetch(`${o.fake.base}/api/me/orders/ord-h/ack`, {
    method: "POST",
    headers: {
      authorization: "Bearer probe-pat",
      "content-type": "application/json",
      "user-agent": "iskron-bridge/0.0.0",
    },
    body: JSON.stringify({ state: "stopped" }),
  });
  assert.equal(acked.status, 200);
  const after = await o.step();
  assert.equal(after.code, 0, after.err + after.out);
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
  assert.deepEqual(o.closes(), [], "observed natural exit needs no extra close");
  const next = await o.step();
  assert.match(next.out, /invite 10: launched/, next.out);
  assert.equal(o.launches().length, 2);
  // The orchestrator itself ordered nothing.
  assert.equal(o.fake.state.orders.human.filter((h) => h.method === "POST").length, 0);
});

test("quench: a stop on demand already carried out before the tact ends the run at once", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    stop_order: { id: "ord-q", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  o.fake.state.orders.list.get("ord-q").state = "stopped"; // closed between two tacts
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_stopped_elsewhere/, r.out);
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
});

// Review of №4050 [105] п.2: the order lands between the open-orders read of demands and the
// read of every state — the run it marks stopping is not ended by the same tact's settle.
test("quench: a stop on demand put inside the tact keeps the run stopping and its tab open", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  await o.fake.control({
    orders_on_read: { id: "ord-r", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 9: stop_ordered_elsewhere/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0, "the agent's bridge has not carried the order out yet");
  // The next tact sees the order open among the account's orders: still stopping.
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  assert.equal(o.closes().length, 0);
});

// Review of №4050 [105] п.3: the order reaches the account before the raised tape names the seat.
test("quench: a stop on demand of a seat not yet in the registry is read again once the seat is known", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await o.fake.control({
    stop_order: { id: "ord-e", standing_id: "seat-raised", realm: REALM, frame: false },
  });
  const early = await o.step();
  assert.equal(early.code, 0, early.err + early.out);
  assert.doesNotMatch(early.out, /elsewhere/, early.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "launched");
  await o.queue([], [signal(1, 9, [ROOM])]);
  const known = await o.step();
  assert.match(known.out, /invite 9: stop_ordered_elsewhere/, known.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "stopping");
  const cursor = () =>
    JSON.parse(readFileSync(join(o.dir, "run", "orchestra-orders.json"), "utf8")).since;
  // No unseated run is left, but the order is still open: it is read again for its outcome.
  assert.equal(cursor(), 0, "an open order of our stopping run holds the cursor");
  assert.equal((await ack(o, "ord-e", "stopped")).status, 200);
  await o.step();
  await waitEnded(o);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
  assert.equal(cursor(), 1, "the order closed: the cursor passes it");
});

// Review of №4050 [105] п.4: a tab is closed only by the handle of the Orca runtime the launch
// kept — not a run ended before this code, not after Orca restarted; and once.
test("close: an ended run with no Orca runtime kept — a registry from before — is never closed", async (t) => {
  const o = await leading(t);
  const old = {
    realm: REALM,
    room: ROOM,
    invite: 7,
    karta: 931,
    launcher: "probe-mac",
    harness: "opencode",
    model: "m",
    repository: REPO,
    worktree: o.checkout,
    terminal: "term_old",
    state: "ended",
    at: "2026-11-09T10:00:00Z",
  };
  writeFileSync(
    join(o.dir, "run", "orchestra-runs.json"),
    JSON.stringify({ runs: { [`${REALM}|${ROOM}|7`]: old } }),
  );
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(o.terminals().length, 0, JSON.stringify(o.terminals()));
  assert.doesNotMatch(r.out, /invite 7/, r.out);
});

test("close: after Orca restarted, the old runtime's handle is not closed — said once", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD)]);
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].runtime, "rt_fake");
  await o.queue([], [signal(1, 9, [ROOM])]);
  await o.step();
  o.restartOrca("rt_new");
  await o.queue([], [signal(1, 9, [ROOM]), signal(2, 9, [])]);
  const r = await o.step();
  assert.match(r.out, /invite 9: seat_gone/, r.out);
  assert.notEqual(o.runs()[`${REALM}|${ROOM}|9`].state, "ended");
  assert.equal(o.closes().length, 0);
  const shows = o.terminals().length;
  const again = await o.step();
  assert.doesNotMatch(again.out, /invite 9: ended/, again.out);
  assert.equal(o.terminals().length, shows, "no close attempt for another runtime");
});

test("on --launcher: the description lies under the holon of the work with agents; a launcher too long is refused", async (t) => {
  const o = await leading(t, {
    descriptions: () => [],
    holons: [
      { seq: 30, name: "Работа с агентами", agents: true },
      { seq: 44, name: "Способы" },
    ],
  });
  const on = await cli(o.dir, ["on", "--launcher", "probe-new", "--model", "m/one"]);
  assert.equal(on.code, 0, on.err + on.out);
  assert.match(on.out, /under the holon of the work with agents #30/, on.out);
  assert.deepEqual(adds(o)[0].arguments.arrows, [
    { arrow_type: "context", target: "#30", volitive_mode: "adhimoksha" },
  ]);
  await cli(o.dir, ["off"]);
  const long = await cli(o.dir, ["on", "--launcher", "x".repeat(65), "--model", "m/one"]);
  assert.equal(long.code, 1, long.out);
  assert.match(long.err, /longer than 64/, long.err);
  assert.equal(adds(o).length, 1, "nothing written for it");
  assert.equal(JSON.parse(readFileSync(join(o.dir, "run", "orchestra.json"), "utf8")).on, false);
});

test("on --launcher: no single holon of the work with agents — the description lies at the root, said so", async (t) => {
  const o = await leading(t, {
    descriptions: () => [],
    holons: [
      { seq: 30, name: "Работа с агентами", agents: true },
      { seq: 31, name: "Ещё агенты", agents: true },
    ],
  });
  const on = await cli(o.dir, ["on", "--launcher", "probe-new", "--model", "m/one"]);
  assert.equal(on.code, 0, on.err + on.out);
  assert.match(on.out, /at the root/, on.out);
  assert.equal(adds(o)[0].arguments.arrows, undefined);
});

test("quench: a seat the orchestrator did not launch is never stopped", async (t) => {
  const o = await leading(t);
  await o.queue([], [signal(1, 42, [ROOM], "seat-foreign"), signal(2, 42, [], "seat-foreign")]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err);
  assert.equal(o.fake.state.orders.human.length, 0);
});

// #10078, case №4206: a repository Orca does not know is cloned only by the description's leave.
/** A leading daemon whose Orca knows no project and whose description allows the clone; its
 * clone_root is a symlink — Orca keeps a path as given, and agent launch finds only git's. */
const cloning = (t, { body = {}, env = {} } = {}) =>
  leading(t, {
    descriptions: (checkout) => {
      mkdirSync(join(dirname(checkout), "real-clones"));
      symlinkSync(join(dirname(checkout), "real-clones"), join(dirname(checkout), "clones"));
      return [
        describe({
          body: {
            clone: true,
            clone_root: join(dirname(checkout), "clones"),
            allow: ["GitHub.com/probe"],
            ...body,
          },
        }),
      ];
    },
    projects: () => ({ projects: [], setups: [] }),
    env: { FAKE_ORCA_CLONE_COVER: coverOf(), ...env },
  });
const clones = (o) => orcaCalls(join(o.dir, "orca.log")).filter((a) => a[1] === "setup-clone");
/** The parent Orca is given — canonical — and the clone in it. */
const cloneParent = (o) => join(realpathSync.native(join(o.dir, "real-clones")), "probe");
const cloneDir = (o) => join(cloneParent(o), "one");
const cloneCall = (o, project = "github:probe/one", url = "https://github.com/probe/one.git") => [
  "project",
  "setup-clone",
  "--project",
  project,
  "--host",
  "local",
  "--url",
  url,
  "--destination",
  cloneParent(o),
  "--json",
];

/** Until no clone runs in the daemon's background — its registry row says so. */
async function settled(o, ms = 20_000) {
  const until = Date.now() + ms;
  while (Object.values(o.cloneRows()).some((r) => r.state === "cloning") && Date.now() < until)
    await new Promise((r) => setTimeout(r, 100));
}
/** A step, the clone it may start in the background, and the step that takes up its outcome. */
async function stepThrough(o) {
  const first = await o.step();
  await settled(o);
  const second = await o.step();
  return {
    code: first.code || second.code,
    out: first.out + second.out,
    err: first.err + second.err,
  };
}

test("clone: no checkout and an allowed repository — Orca clones it over https, then it is launched there", async (t) => {
  const o = await cloning(t);
  await o.queue([invite(9, GOOD)]);
  const r = await stepThrough(o);
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(clones(o), [cloneCall(o)]);
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.equal(o.launches()[0][5], `path:${o.runs()[`${REALM}|${ROOM}|9`].worktree}`);
});

test("clone: the project id is Orca's own — github.com in lower case, another host as git:", async (t) => {
  const o = await cloning(t, { body: { allow: ["GitHub.com/Probe", "git.example.org/probe"] } });
  await o.queue([invite(9, GOOD, "github.com/Probe/One")]);
  const r = await stepThrough(o);
  assert.match(r.out, /invite 9: launched/, r.out);
  const parent = join(realpathSync.native(join(o.dir, "real-clones")), "Probe");
  assert.deepEqual(clones(o)[0].slice(2, 9), [
    "--project",
    "github:probe/one",
    "--host",
    "local",
    "--url",
    "https://github.com/Probe/One.git",
    "--destination",
  ]);
  assert.equal(clones(o)[0][9], parent);
  await o.queue([invite(10, GOOD, "git.example.org/probe/two")]);
  const other = await stepThrough(o);
  assert.match(other.out, /invite 10: launched/, other.out);
  assert.equal(clones(o)[1][3], "git:git.example.org/probe/two");
});

test("clone: an Orca whose setup-clone lacks a flag the clone needs is not asked to clone", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_FLAGS: "json,url,destination,project" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: clone_failed \(orca_schema_unverified\)/, r.out);
  assert.equal(clones(o).length, 0);
});

test("clone: a dry run judges Orca's checkout as there — the slot follows the launch, the clone is said as conditional", async (t) => {
  const o = await cloning(t, { body: { limit: 1 } });
  await o.queue([invite(2, GOOD, "github.com/stranger/one"), invite(9, GOOD)]);
  const r = await cli(o.dir, ["step", "--dry-run"]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 2: if Orca has no checkout — clone_refused \(not_allowed\)/, r.out);
  // Orca's checkout is only a source; the launch uses its own detached tree (#7517).
  assert.match(
    r.out,
    /invite 2: would launch: .*--worktree path:<own detached tree of github\.com\/stranger\/one>/,
    r.out,
  );
  assert.match(r.out, /invite 9: .*limit_reached/, r.out);
  assert.ok(!existsSync(join(o.dir, "orca.log")), "not even an Orca source read");
  assert.equal(r.out.includes(o.dir), false, "private source paths stay local");
});

test("clone: the repository's host in any case is the copy Orca registered — no clone_unregistered", async (t) => {
  const o = await cloning(t);
  await o.queue([invite(9, GOOD, "GitHub.com/probe/one")]);
  const r = await stepThrough(o);
  assert.equal(r.code, 0, r.err + r.out);
  assert.deepEqual(clones(o), [cloneCall(o)]);
  assert.match(r.out, /invite 9: launched/, r.out);
});

test("clone: without clone in the description nothing is cloned — no_checkout as before", async (t) => {
  const o = await leading(t, { projects: () => ({ projects: [], setups: [] }) });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: no_checkout/, r.out);
  assert.equal(clones(o).length, 0);
});

test("clone: outside allow, no repository, an odd form or a taken folder — clone_refused, no call", async (t) => {
  const o = await cloning(t);
  mkdirSync(join(o.dir, "clones", "probe", "taken"), { recursive: true });
  await o.queue([
    invite(1, GOOD, "github.com/stranger/one"),
    invite(2, GOOD, "github.com/probex/one"),
    invite(3, GOOD, null),
    invite(4, GOOD, "gitlab.com/probe/sub/one"),
    invite(5, GOOD, "github.com/probe/taken"),
    invite(6, GOOD, "github.com/probe/.."),
  ]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  for (const [n, why] of [
    [1, "not_allowed"],
    [2, "not_allowed"],
    [3, "no_repository"],
    [4, "repository_form"],
    [5, "destination_exists"],
    [6, "repository_form"],
  ])
    assert.match(r.out, new RegExp(`invite ${n}: clone_refused \\(${why}\\)`), r.out);
  assert.equal(clones(o).length, 0, "Orca was not asked to clone");
  assert.equal(o.launches().length, 0);
});

test("clone: Orca or git refuse — clone_failed with the exit code only, no output repeated", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_EXIT: "128" } });
  await o.queue([invite(9, GOOD)]);
  const r = await stepThrough(o);
  assert.match(r.out, /invite 9: clone_failed \(clone_exit_128\)/, r.out);
  assert.doesNotMatch(r.out + r.err, /SECRET/, "the clone's output never leaves");
  const st = await cli(o.dir, ["status"]);
  assert.doesNotMatch(st.out + st.err, /SECRET/);
  assert.equal(o.launches().length, 0);
});

test("clone: a failed clone is remembered by repository — clone_failed_before until the description changes", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_EXIT: "128" } });
  await o.queue([invite(9, GOOD)]);
  await stepThrough(o);
  // Another invite of the same repository: the memory is the repository's, not the invite's.
  await o.queue([invite(9, GOOD), invite(10, GOOD)]);
  const again = await stepThrough(o);
  assert.match(again.out, /invite 9: clone_failed_before \(clone_exit_128\)/, again.out);
  assert.match(again.out, /invite 10: clone_failed_before \(clone_exit_128\)/, again.out);
  assert.equal(clones(o).length, 1, "not cloned again");
  const st = await cli(o.dir, ["status"]);
  assert.match(st.out, /clone github\.com\/probe\/one: failed \(clone_exit_128\)/, st.out);
  // The human changed the description: the clone is tried once more.
  const d = o.fake.state.mind.orchestra[0];
  d.body = JSON.stringify({ ...JSON.parse(d.body), limit: 3 });
  await stepThrough(o);
  assert.equal(clones(o).length, 2, "a changed description clones again");
});

test("clone: the clone does not hold the tact — it runs in the background, said by step and status", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_DELAY_MS: "6000" } });
  await o.queue([invite(9, GOOD)]);
  const at = Date.now();
  const r = await o.step();
  assert.ok(Date.now() - at < 4000, `the step waited for the clone: ${Date.now() - at} ms`);
  assert.match(r.out, /invite 9: cloning/, r.out);
  const st = await cli(o.dir, ["status"]);
  assert.match(st.out, /clone github\.com\/probe\/one: cloning/, st.out);
  const during = await o.step();
  assert.match(during.out, /invite 9: cloning/, during.out);
  assert.equal(clones(o).length, 1, "one clone in flight, not a second");
  assert.equal(o.launches().length, 0);
  await settled(o);
  const after = await o.step();
  assert.match(after.out, /invite 9: launched/, after.out);
  assert.equal(o.launches()[0][5], `path:${o.runs()[`${REALM}|${ROOM}|9`].worktree}`);
});

test("clone: a timeout is clone_timeout; output beyond any buffer is no failure", async (t) => {
  const o = await cloning(t, {
    env: { FAKE_ORCA_CLONE_HANG: "1", ISKRON_ORCHESTRA_CLONE_MS: "1500" },
  });
  await o.queue([invite(9, GOOD)]);
  const r = await stepThrough(o);
  assert.match(r.out, /invite 9: clone_failed \(clone_timeout\)/, r.out);
  const noisy = await cloning(t, { env: { FAKE_ORCA_CLONE_NOISE: "1" } });
  await noisy.queue([invite(9, GOOD)]);
  const n = await stepThrough(noisy);
  assert.match(n.out, /invite 9: launched/, n.out);
});

/** A file for the pid of the client's heir, killed after the probe. */
function heirFile(t) {
  const heir = join(mkdtempSync(join(tmpdir(), "iskron-heir-")), "pid");
  t.after(() => {
    try {
      process.kill(Number(readFileSync(heir, "utf8")));
    } catch {
      /* gone already */
    }
    rmSync(dirname(heir), { recursive: true, force: true });
  });
  return heir;
}

test("clone: a timeout ends the clone even while a child of the client holds its stdout", async (t) => {
  const heir = heirFile(t);
  const o = await cloning(t, {
    env: {
      FAKE_ORCA_CLONE_HANG: "1",
      FAKE_ORCA_CLONE_HEIR: heir,
      ISKRON_ORCHESTRA_CLONE_MS: "1500",
    },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await new Promise((r) => setTimeout(r, 3000));
  const r = await o.step();
  assert.match(r.out, /invite 9: clone_failed \(clone_timeout\)/, r.out);
  assert.notEqual(o.cloneRows()[REPO]?.state, "cloning");
});

test("clone: the client exits by itself while its child holds stdout — its exit code, not cloning", async (t) => {
  const heir = heirFile(t);
  const o = await cloning(t, {
    env: {
      FAKE_ORCA_CLONE_EXIT: "128",
      FAKE_ORCA_CLONE_HEIR: heir,
      FAKE_ORCA_CLONE_HEIR_WRITES: "1",
    },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await until(() => o.cloneRows()[REPO]?.state === "failed", 10_000);
  const r = await o.step();
  assert.match(r.out, /invite 9: clone_failed \(clone_exit_128\)/, r.out);
  // The heir writes on after the client's answer was taken: no EPIPE ends it.
  await until(() => existsSync(`${heir}.alive`), 10_000);
  assert.ok(existsSync(`${heir}.alive`), "the client's child died writing to its stdout");
});

test("clone: the client exits in the window's last moments — its exit code, not clone_timeout", async (t) => {
  const heir = heirFile(t);
  const o = await cloning(t, {
    env: {
      FAKE_ORCA_CLONE_EXIT: "128",
      FAKE_ORCA_CLONE_DELAY_MS: "1500",
      FAKE_ORCA_CLONE_HEIR: heir,
      ISKRON_ORCHESTRA_CLONE_MS: "2500",
    },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await until(() => o.cloneRows()[REPO]?.state === "failed", 10_000);
  const r = await o.step();
  assert.match(r.out, /invite 9: clone_failed \(clone_exit_128\)/, r.out);
});

/** Until the clone's client has answered — the fake's setup-clone is logged at its start. */
async function until(check, ms = 20_000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
}
const clientDone = (o) => () => {
  const row = o.cloneRows()[REPO];
  return clones(o).length > 0 && (!row || row.state !== "cloning" || row.runtime === true);
};

test("clone: Orca's client gives up waiting (runtime_timeout) — still cloning, the copy Orca finishes is launched", async (t) => {
  // Orca's runtime finishes the clone once this file is gone.
  const hold = join(mkdtempSync(join(tmpdir(), "iskron-rt-")), "hold");
  writeFileSync(hold, "");
  t.after(() => rmSync(dirname(hold), { recursive: true, force: true }));
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_RUNTIME_TIMEOUT: hold } });
  await o.queue([invite(9, GOOD)]);
  const first = await o.step();
  assert.match(first.out, /invite 9: cloning/, first.out);
  await until(clientDone(o));
  const during = await o.step();
  assert.match(during.out, /invite 9: cloning/, during.out);
  assert.doesNotMatch(during.out, /clone_failed/, during.out);
  const st = await cli(o.dir, ["status"]);
  assert.match(st.out, /clone github\.com\/probe\/one: cloning/, st.out);
  rmSync(hold);
  await until(() => existsSync(join(o.dir, "orca.log.cloned")));
  const after = await o.step();
  assert.match(after.out, /invite 9: launched/, after.out);
  assert.equal(o.launches()[0][5], `path:${o.runs()[`${REALM}|${ROOM}|9`].worktree}`);
  assert.equal(clones(o).length, 1, "cloned once");
  assert.equal(o.cloneRows()[REPO], undefined, "the clone's row is done");
});

test("clone: runtime_timeout and no copy within the clone's window — clone_timeout, remembered", async (t) => {
  const o = await cloning(t, {
    env: { FAKE_ORCA_CLONE_RUNTIME_TIMEOUT: "never", ISKRON_ORCHESTRA_CLONE_MS: "2000" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await until(clientDone(o));
  await new Promise((r) => setTimeout(r, 2500));
  // A dry run says of the row what the tact will.
  const dry = await cli(o.dir, ["step", "--dry-run"], { ISKRON_ORCHESTRA_CLONE_MS: "2000" });
  assert.match(
    dry.out,
    /invite 9: if Orca has no checkout — clone_failed \(clone_timeout\)/,
    dry.out,
  );
  const r = await o.step();
  assert.match(r.out, /invite 9: clone_failed \(clone_timeout\)/, r.out);
  const again = await o.step();
  assert.match(again.out, /invite 9: clone_failed_before \(clone_timeout\)/, again.out);
  assert.equal(clones(o).length, 1, "not cloned again");
  assert.equal(o.launches().length, 0);
});

test("clone: a line that is no JSON before the client's runtime_timeout — still cloning", async (t) => {
  const o = await cloning(t, {
    env: { FAKE_ORCA_CLONE_RUNTIME_TIMEOUT: "never", FAKE_ORCA_CLONE_BANNER: "1" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  await until(clientDone(o));
  assert.equal(o.cloneRows()[REPO]?.runtime, true, JSON.stringify(o.cloneRows()));
  const r = await o.step();
  assert.match(r.out, /invite 9: cloning/, r.out);
});

test("clone: a copy found after a failed clone lifts the repository's remembered failure", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_EXIT: "1" } });
  await o.queue([invite(9, GOOD)]);
  const r = await stepThrough(o);
  assert.match(r.out, /invite 9: clone_failed \(clone_exit_1\)/, r.out);
  // Orca's runtime registered the copy after all.
  mkdirSync(cloneDir(o), { recursive: true });
  cover(cloneDir(o));
  writeFileSync(
    join(o.dir, "orca-projects.json"),
    JSON.stringify({
      projects: [
        {
          id: "github:probe/one",
          gitRemoteIdentity: { remoteUrl: "https://github.com/probe/one.git" },
        },
      ],
      setups: [
        { projectId: "github:probe/one", path: cloneDir(o), setupState: "ready", hostId: "local" },
      ],
    }),
  );
  await o.queue([invite(10, GOOD)]);
  const found = await o.step();
  assert.match(found.out, /invite 10: launched/, found.out);
  assert.doesNotMatch(found.out, /clone_failed/, found.out);
  assert.equal(o.cloneRows()[REPO], undefined, "the remembered failure is lifted");
  const st = await cli(o.dir, ["status"]);
  assert.doesNotMatch(st.out, /clone github\.com\/probe\/one: failed/, st.out);
});

test("clone: the caller gone before the clone starts — no clone after it (#8202)", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CONTEXT_DELAY_MS: "3000" } });
  await o.queue([invite(9, GOOD)]);
  const r = await cli(o.dir, ["step"], GIVE_UP);
  assert.notEqual(r.code, 0, "the client gave up inside its ceiling — a refusal");
  await new Promise((done) => setTimeout(done, 5_000));
  assert.equal(clones(o).length, 0, "no clone started after the caller left");
});

test("clone: an Orca not declaring setup-clone is not asked to clone", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_NO_CLONE: "1" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: clone_failed \(orca_schema_unverified\)/, r.out);
  assert.equal(clones(o).length, 0);
});

test("clone: the cloned repository without the cover is not launched and stays on disk", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_COVER: "" } });
  await o.queue([invite(9, GOOD)]);
  const r = await stepThrough(o);
  assert.match(r.out, /invite 9: checkout_uncovered/, r.out);
  assert.equal(o.launches().length, 0);
  assert.ok(existsSync(cloneDir(o)), "the clone is not removed");
});

test("clone: cloned but not registered by Orca — clone_failed (clone_unregistered), kept; the next tact does not clone over it", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_UNREGISTERED: "1" } });
  await o.queue([invite(9, GOOD)]);
  const r = await stepThrough(o);
  assert.match(r.out, /invite 9: clone_failed \(clone_unregistered\)/, r.out);
  assert.ok(existsSync(cloneDir(o)));
  const again = await o.step();
  assert.match(again.out, /invite 9: clone_failed_before \(clone_unregistered\)/, again.out);
  assert.equal(clones(o).length, 1, "cloned once");
  assert.equal(o.launches().length, 0);
});

test("clone: Orca unreadable right after the clone — the row stays clone_unregistered, not destination_exists", async (t) => {
  const o = await cloning(t, {
    // The tact's first read sees no checkout; the read after the clone's outcome fails.
    env: { FAKE_ORCA_CLONE_UNREGISTERED: "1", FAKE_ORCA_FAIL_AFTER_CLONE: "2" },
  });
  await o.queue([invite(9, GOOD)]);
  const r = await stepThrough(o);
  assert.match(r.out, /invite 9: clone_failed \(clone_unregistered\)/, r.out);
  const again = await o.step();
  assert.match(again.out, /invite 9: clone_failed_before \(clone_unregistered\)/, again.out);
  assert.equal(clones(o).length, 1, "cloned once");
});

test("clone: a cloning row left by a former daemon is clone_interrupted, remembered — no second clone", async (t) => {
  const o = await cloning(t, { env: { FAKE_ORCA_CLONE_EXIT: "128" } });
  await o.queue([invite(9, GOOD)]);
  await stepThrough(o);
  // The row as a daemon gone mid-clone leaves it: cloning, with no clone of this daemon's.
  const f = join(o.dir, "run", "orchestra-runs.json");
  const reg = JSON.parse(readFileSync(f, "utf8"));
  const { spec, at } = reg.clones[REPO];
  reg.clones[REPO] = { state: "cloning", at, spec };
  writeFileSync(f, JSON.stringify(reg));
  const r = await o.step();
  assert.match(r.out, /invite 9: clone_failed \(clone_interrupted\)/, r.out);
  const again = await o.step();
  assert.match(again.out, /invite 9: clone_failed_before \(clone_interrupted\)/, again.out);
  assert.equal(clones(o).length, 1, "not cloned a second time");
});

test("clone: broken clone fields break the description, raising nothing", async (t) => {
  for (const [body, code] of [
    [{ clone: "yes" }, "clone_invalid"],
    [{ clone_root: undefined }, "clone_root_invalid"],
    [{ clone_root: "relative/dir" }, "clone_root_invalid"],
    [{ allow: "github.com/probe" }, "allow_invalid"],
    [{ allow: ["github.com"] }, "allow_invalid"],
    [{ allow: [] }, "allow_invalid"],
  ]) {
    const o = await cloning(t, { body });
    await o.queue([invite(9, GOOD)]);
    const r = await o.step();
    assert.match(
      r.out,
      new RegExp(`probe-mac in mind: ${code}`),
      `${JSON.stringify(body)}\n${r.out}`,
    );
    assert.equal(clones(o).length + o.launches().length, 0);
  }
});

test("clone: dry run says what it would clone, ~ in clone_root expanded, and calls no Orca", async (t) => {
  const home = mkdtempSync(join(tmpdir(), "iskron-home-"));
  const o = await cloning(t, { body: { clone_root: "~/src" }, env: { HOME: home } });
  await o.queue([invite(9, GOOD), invite(2, GOOD, "github.com/stranger/one")]);
  const r = await cli(o.dir, ["step", "--dry-run"]);
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(
    r.out,
    new RegExp(
      `invite 9: if Orca has no checkout — would clone https://github\\.com/probe/one\\.git into ${join(home, "src", "probe", "one")}`,
    ),
    r.out,
  );
  assert.match(r.out, /invite 9: would launch: /, r.out);
  assert.match(r.out, /invite 2: if Orca has no checkout — clone_refused \(not_allowed\)/, r.out);
  assert.ok(!existsSync(join(o.dir, "orca.log")), "orca was not called");
  assert.ok(!existsSync(join(home, "src")), "nothing made on disk");
});
