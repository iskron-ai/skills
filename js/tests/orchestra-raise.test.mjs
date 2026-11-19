// Behavioural probes of the orchestrator's leading (bridge/orchestra-lead.ts and its halves —
// graph @nks/nks-dev, nodes #7513, #5042, #7517, #7518, #8203; decisions of case №4050): a real
// daemon against the fake NKS, the human's launcher description in the fake mind and a
// substitute `orca` on the daemon's PATH that records argv instead of launching
// (orchestra-raise-kit.mjs). Here — the raise and its gates; quench, stops and reap —
// orchestra-raise-quench.test.mjs; the tact's timer, consent, dry run and clone —
// orchestra-raise-tact.test.mjs.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  adds,
  atTerminal,
  cli,
  cover,
  coverOf,
  describe,
  GIVE_UP,
  GOOD,
  invite,
  leading,
  orcaProjects,
  REALM,
  REPO,
  ROOM,
  runUntil,
  signal,
  waitEnded,
} from "./orchestra-raise-kit.mjs";

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

// #10598: a role whose checkout's cover names another role (the chief of staff in methodology)
// is raised there only by the description's home, and the launch names the role for the seat.
test("raise: a home in the description raises its role in a checkout covered for another", async (t) => {
  const own = mkdtempSync(join(tmpdir(), "iskron-home-"));
  t.after(() => rmSync(own, { recursive: true, force: true }));
  cover(own, coverOf(REALM, 932));
  const o = await leading(t, {
    descriptions: () => [describe({ body: { homes: { [`${REALM}#931`]: own } } })],
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  const argv = o.launches()[0];
  const prompt = argv[argv.indexOf("--prompt") + 1];
  assert.ok(
    prompt.startsWith(`iskron/spawned_for: {"invite":9,"room":"${ROOM}","karta":931} `),
    prompt,
  );
  assert.ok(
    o.runs()[`${REALM}|${ROOM}|9`].worktree.startsWith(join(realpathSync(own), ".worktrees")),
  );
});

// The chief of staff's call carried no repository (its role stewards none): homes was never read.
test("raise: a home raises its role even when the call names no repository", async (t) => {
  const own = mkdtempSync(join(tmpdir(), "iskron-home-"));
  t.after(() => rmSync(own, { recursive: true, force: true }));
  cover(own, coverOf(REALM, 932));
  const o = await leading(t, {
    descriptions: () => [describe({ body: { homes: { [`${REALM}#931`]: own } } })],
  });
  await o.queue([invite(9, GOOD, null)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  assert.ok(
    o.runs()[`${REALM}|${ROOM}|9`].worktree.startsWith(join(realpathSync(own), ".worktrees")),
  );
});

test("raise: a call with no repository and no home is still no_checkout", async (t) => {
  const o = await leading(t);
  await o.queue([invite(9, GOOD, null)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: no_checkout/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: a home of another role leaves the cover's refusal standing", async (t) => {
  const own = mkdtempSync(join(tmpdir(), "iskron-home-"));
  t.after(() => rmSync(own, { recursive: true, force: true }));
  cover(own, coverOf(REALM, 932));
  const o = await leading(t, {
    descriptions: () => [
      describe({ body: { checkouts: { [REPO]: own }, homes: { [`${REALM}#933`]: own } } }),
    ],
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: checkout_other_seat/, r.out);
  assert.equal(o.launches().length, 0);
});

test("raise: a broken home breaks the description", async (t) => {
  const o = await leading(t, {
    descriptions: () => [describe({ body: { homes: { [`${REALM}#931`]: "relative/path" } } })],
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /homes_invalid/, r.out);
  assert.equal(o.launches().length, 0);
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
// #11099: the agent's bridge never sat, so nobody else closes it — the daemon closes its own
// terminal under the exact-client proof. A launch that never sat has no wakes to stop: its
// observed exit ends it, frees the slot, and the tree goes by the ordinary cleanup.
test("raise: no seat within the window — the daemon closes its own terminal by the exact proof", async (t) => {
  const o = await leading(t, {
    env: {
      ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500",
      FAKE_ORCA_HANDLE: "term_probe1",
      FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
    },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].terminal, "term_probe1");
  await new Promise((done) => setTimeout(done, 2_000));
  await o.queue([]);
  const r = await o.step();
  assert.match(r.out, /invite 9: tree_no_seat_unverified/, r.out);
  assert.match(r.out, /invite 9: no_seat, client_exited/, r.out);
  assert.deepEqual(o.closes(), [["terminal", "close", "--terminal", "term_probe1", "--json"]]);
  const run = await waitEnded(o);
  assert.equal(run.closed, "client_exited");
  // The slot is free: the next call of the same description is launched.
  await o.queue([invite(10, GOOD), invite(11, GOOD)]);
  const next = await o.step();
  assert.match(next.out, /invite 10: launched/, next.out);
  assert.match(next.out, /invite 11: launched/, next.out);
  assert.equal(o.closes().length, 1, "closed once");
});

test("raise: no seat within the window — a dirty tree outlives the ended launch, named", async (t) => {
  const o = await leading(t, {
    env: { ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500", FAKE_ORCA_WAIT_AFTER_CLOSE: "1" },
  });
  await o.queue([invite(9, GOOD)]);
  await o.step();
  writeFileSync(join(o.runs()[`${REALM}|${ROOM}|9`].worktree, "unsaved.txt"), "work\n");
  await new Promise((done) => setTimeout(done, 2_000));
  await o.queue([]);
  const r = await o.step();
  assert.match(r.out, /invite 9: no_seat, client_exited/, r.out);
  const run = await runUntil(o, (x) => x.tree?.state === "retained", "the retained tree");
  assert.equal(run.state, "ended");
  assert.equal(run.tree.why, "tree_dirty_retained");
});

// №4050 [71] item 2: an incomplete snapshot acts on nothing — not even the expiry's close.
test("raise: incomplete snapshot does not expire; complete snapshot expires and closes by the proof", async (t) => {
  const o = await leading(t, {
    env: {
      ISKRON_ORCHESTRA_RAISE_WINDOW_MS: "1500",
      FAKE_ORCA_HANDLE: "term_probe2",
      FAKE_ORCA_WAIT_AFTER_CLOSE: "1",
    },
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
  assert.match(after.out, /invite 9: no_seat, client_exited/, after.out);
  assert.equal(o.closes().length, 1);
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

// An account without a handle (#11011): the whoami text names the account by an «id <uuid>»
// line (asked of the MCP server, not yet printed — the form is the request's); an invite carries
// author_user_id, the author's seat is a bare name. Own is a matching id; a whoami and invites
// without ids keep the handle (the probes above).
const ME_ID = "0b6f9a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const FRIEND_ID = "7d8e9f00-1a2b-4c3d-9e4f-5a6b7c8d9e0f";
const byId = (n, id, author) => ({ ...invite(n, GOOD, REPO, author), author_user_id: id });

test("raise: a whoami without a handle names the account by its id line — own calls rise, a foreign id is refused, no basis is said aloud", async (t) => {
  const o = await leading(t, {
    whoami: `Вызывающая идентичность: логин 16-m3 (probe@example.com)\nid ${ME_ID}`,
  });
  await o.queue([
    byId(1, ME_ID, "16-m3.lead"),
    byId(2, FRIEND_ID, "friend.lead"),
    invite(3, GOOD, REPO, "16-m3.lead"),
  ]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.doesNotMatch(r.out, /account_unknown/, r.out);
  assert.match(r.out, /invite 1: launched/, r.out);
  assert.match(r.out, /invite 2: caller_not_allowed/, r.out);
  assert.match(r.out, /invite 3: caller_unknown/, r.out);
  assert.equal(o.launches().length, 1);
});

test("raise: callers take an account id beside @handle; an invite without author_user_id falls back to the handle", async (t) => {
  const o = await leading(t, {
    whoami: `Вызывающая идентичность: логин tester · handle @tester (tester@probe.example)\nid ${ME_ID}`,
    descriptions: () => [
      describe({ body: { callers: [FRIEND_ID.toUpperCase(), "@pal"], limit: 5 } }),
    ],
  });
  await o.queue([
    byId(1, FRIEND_ID, "friend.lead"),
    byId(2, "11111111-2222-4333-8444-555555555555", "other.lead"),
    invite(3, GOOD),
    invite(4, GOOD, REPO, "@pal:lead"),
  ]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 1: launched/, r.out);
  assert.match(r.out, /invite 2: caller_not_allowed/, r.out);
  assert.match(r.out, /invite 3: launched/, r.out);
  assert.match(r.out, /invite 4: launched/, r.out);
  assert.equal(o.launches().length, 3);
});

test("raise: with ids on both sides own is decided by the id, not by the seat's handle", async (t) => {
  const o = await leading(t, {
    whoami: `Вызывающая идентичность: логин tester · handle @tester (tester@probe.example)\nid ${ME_ID}`,
  });
  await o.queue([byId(1, ME_ID, "@renamed:lead"), byId(2, FRIEND_ID, "@tester:lead")]);
  const r = await o.step();
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /invite 1: launched/, r.out);
  assert.match(r.out, /invite 2: caller_not_allowed/, r.out);
  assert.equal(o.launches().length, 1);
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
