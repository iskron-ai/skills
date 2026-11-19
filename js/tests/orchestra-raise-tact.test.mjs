// Behavioural probes of the orchestrator's tact around the launch (bridge/orchestra-lead.ts and
// its halves — graph @nks/nks-dev, nodes #7513, #5042, #7517, #7518, #8203, #10078; decisions of
// case №4050): Orca showing the new tree, the daemon's timer, the machine's consent, the
// description written by on --launcher, the dry run and the clone of an unknown repository — a
// real daemon against the fake NKS and a substitute `orca` on its PATH (orchestra-raise-kit.mjs).
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  orcaCalls,
  REALM,
  REPO,
  ROOM,
  signal,
} from "./orchestra-raise-kit.mjs";

// #10598: right after `git worktree add` Orca does not yet show the tree (1.4.258 answered
// selector_not_found, then the tree two seconds later) — a launch in that gap was refused.
const shows = (o) => {
  const f = join(o.dir, "orca.log.shows");
  return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map(JSON.parse) : [];
};

test("raise: the launch waits until Orca shows the new tree", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_TREE_UNSEEN: "2" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  const asked = shows(o);
  assert.equal(asked.length, 3, "asked until Orca showed the tree");
  const path = o.runs()[`${REALM}|${ROOM}|9`].worktree;
  assert.deepEqual(asked[2], ["worktree", "show", "--worktree", `path:${path}`, "--json"]);
  assert.equal(o.launches().length, 1);
});

// The clean review of PR #754: an unseen tree held its call and a limit slot for good.
test("raise: a tree Orca never shows is not launched in, freed, and the call is raised later", async (t) => {
  const hide = join(mkdtempSync(join(tmpdir(), "iskron-hide-")), "hide");
  writeFileSync(hide, "");
  t.after(() => rmSync(dirname(hide), { recursive: true, force: true }));
  const o = await leading(t, {
    env: { FAKE_ORCA_TREE_HIDE: hide, ISKRON_ORCA_TREE_WAIT_MS: "800" },
  });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: orca_tree_unseen, retry/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`], undefined, "no row holds the slot");
  assert.ok(shows(o).length >= 2, "asked more than once");
  assert.equal(o.launches().length, 0, "nothing launched");
  assert.ok(
    !existsSync(join(o.checkout, ".worktrees")) ||
      readdirSync(join(o.checkout, ".worktrees")).length === 0,
    "the tree is gone",
  );
  rmSync(hide);
  const again = await o.step();
  assert.match(again.out, /invite 9: launched/, again.out);
  assert.equal(o.launches().length, 1);
});

test("raise: a slow Orca does not stretch the wait for the tree past its budget", async (t) => {
  const o = await leading(t, {
    env: {
      FAKE_ORCA_TREE_UNSEEN: "never",
      FAKE_ORCA_TREE_SHOW_DELAY_MS: "20000",
      ISKRON_ORCA_TREE_WAIT_MS: "1500",
    },
  });
  await o.queue([invite(9, GOOD)]);
  const at = Date.now();
  const r = await o.step();
  assert.match(r.out, /invite 9: orca_tree_unseen/, r.out);
  assert.ok(Date.now() - at < 8_000, `waited ${Date.now() - at} ms`);
  assert.equal(o.launches().length, 0);
});

test("raise: Orca's refusal of a launch is kept by its code", async (t) => {
  const o = await leading(t, { env: { FAKE_ORCA_REFUSE: "selector_not_found" } });
  await o.queue([invite(9, GOOD)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launch_refused_selector_not_found/, r.out);
  assert.equal(o.runs()[`${REALM}|${ROOM}|9`].why, "launch_refused_selector_not_found");
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
