// A root session moved by `session.move` into a worktree of its repository (graph @nks/nks-dev,
// node #11463; the contract of #6550: a session speaks with at most one seat): two folders, one
// cover — the same graph and role in A and in B —, two plugin instances, one per folder; the
// root seated in A by its first prompt. The move (event session.moved, moves.ts) lays the marker
// in A and puts the root's bridge down "away"; B returns the seat. The contract after it: ONE
// seat of the role, heard under the name the root stood; no other name stood by the session's
// bridges; one record of the session; every write signed by it. A first prompt's seat is
// provisional (js/bridge/provisional.ts): the explicit stand replaces it by the code's design —
// the contract is the explicit seat's from there.
//
// Beyond the code's model of the host (moves.ts: a session's tools go through the instance of
// its location; the root's own call passes its guard) a call of the running turn is driven
// through the OLD instance too, and the move is landed while the old instance is still seating
// the root (a seating in flight is not put down — rootseat-tools.ts, `forget`). A failing
// assertion says what was seen, read from the state.
//
// Стенд — rootseat-kit.mjs: настоящий плагин и настоящие мосты, подставной сервер ownseat-kit,
// ход сессии хуками OpenCode. ISKRON_OPENCODE_PLUGIN и ISKRON_BRIDGE_PATH наводят пробу на
// другие копии. Не гоняется: демон машины (здесь ISKRON_BRIDGE_DAEMON=0); какой экземпляр хост
// на деле получает вызовы идущего хода — проба задаёт, а не наблюдает.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { setup, until } from "./ownseat-kit.mjs";
import { heardSeats, heldBy, rootPlugin, writeAgents } from "./rootseat-kit.mjs";

const T = { timeout: 90_000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = "@nks/nks-dev";
const A = "the old folder's instance";
const B = "the new folder's instance";
/** A write of the session: the server signs it by the caller's seat in the realm. */
const WRITE = { tool: "iskron_add_phenomenon", input: { realm: R, name: "x", given_as: "ding" } };
/** The session's explicit stand — the start ritual's shape: the graph, the role, the model, no name. */
const STAND = { tool: "iskron_stand", input: { realm: R, karta: "931", model: "m1" } };
/** The status stand: the busy line of the seat the instance's bridge leads. */
const BUSY = { tool: STAND.tool, input: { realm: R, karta: "931", status: "перенос" } };
/** A call through an instance's wrapper — as the model's tool call of a running turn goes. */
const CALLER = { sessionID: "root", agent: "build", messageID: "msg-move", id: "call-move" };
/** The new folder's instance said its bridge returned the seat from disk. */
const RETURNED = /возврат места с диска|standing resumed from disk/;
/** The departure's marker in the grant directory (marker.ts): laid — a file; taken — gone. */
const markers = (dir) =>
  readdirSync(dir).filter((f) => f.startsWith("opencode-lost.") && f.endsWith(".json"));
const KEPT =
  "the contract after the move — one seat of the role under the name the root stood, no other name stood, one record of the session, every write signed by it";

/**
 * The process's registries by session id (opencode/halts.ts, twins.ts, …) are shared by the
 * live plugin instances by design, and every test's session is "root": a former test's stop
 * must not ban the next (opencode-kit.mjs clears ten of them before each of its probes).
 */
const SHARED = [
  "Ended",
  "EndLiftedAt",
  "Halts",
  "LiftedAt",
  "StopIds",
  "StopWords",
  "StopAlone",
  "StopFull",
  "ArchivedStops",
  "ReplyNotes",
  "Handing",
  "Twins",
];
const forgetSessions = () => {
  for (const k of SHARED) globalThis[`__iskron${k}`]?.clear?.();
  globalThis.__iskronArchiveQueue?.turns.clear();
  globalThis.__iskronArchiveQueue?.updating.clear();
};

/** The stand: A — the main copy of a repository, B — a worktree of it, both with the cover. */
async function stand(t) {
  const up = []; // the plugin instances, stopped before setup's cleanup looks for bridges
  t.after(async () => {
    for (const p of up.reverse()) await p.stop();
  });
  // the move's timings are the code's defaults here, whatever the machine's environment holds
  for (const k of ["ISKRON_MOVE_ADOPT_MS", "ISKRON_RESUME_PATIENCE_MS"]) delete process.env[k];
  forgetSessions();
  const s = await setup(t);
  s.fake.state.tools = ["iskron_orient", WRITE.tool, "iskron_channel", STAND.tool].map((name) => ({
    name,
    description: name,
    inputSchema: { type: "object" },
  }));
  const a = realpathSync(s.cwd);
  const git = (...args) => execFileSync("git", args, { cwd: a, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Probe");
  git("config", "user.email", "probe@example.invalid");
  git("commit", "--allow-empty", "-qm", "probe");
  const b = join(a, "work");
  git("worktree", "add", "--detach", b, "HEAD");
  writeAgents(a);
  writeAgents(b);
  return { s, a, b, up };
}

/** The root seated in A by its first prompt: its seat, and the server's board index before the move. */
async function seated(t) {
  const x = await stand(t);
  x.ocA = await rootPlugin(x.s, x.a);
  x.up.push(x.ocA);
  x.ocA.create("root");
  await x.ocA.turn("root", "привет");
  await until(() => heardSeats(x.s.fake).length === 1, "the root seated in A", 20_000);
  const [old] = heardSeats(x.s.fake);
  assert.deepEqual(heldBy(x.s.dir, "root"), [old], "the root's record in A");
  return Object.assign(x, { old, mark: x.s.fake.state.placeArgs.length });
}

/** The new folder's instance, live before the marker: it reads the session — still in A. */
async function liveIn(x) {
  x.ocB = await rootPlugin(x.s, x.b);
  x.up.push(x.ocB);
  x.ocB.create("root", { emit: false, directory: x.a });
}

/**
 * The move as the host orders it: A — session.moved to B — lays the marker and puts the root's
 * bridge down "away"; B, session.moved here, returns the seat — its bridge holds the socket.
 */
async function moved(x) {
  x.ocA.move("root", x.b);
  await until(() => markers(x.s.dir).length === 1, "the old folder's instance laid the marker");
  x.ocB.move("root", x.b);
  await until(() => RETURNED.test(x.ocB.said()), "the new folder's instance returned the seat");
}

/**
 * The move lands while the root's first prompt is out and its seating on the wire (slow
 * connects): the old folder's instance has a seating in flight and no seat; `first` — the
 * prompt to await.
 */
async function underway(t) {
  const x = await stand(t);
  await x.s.fake.control({ connect_delay_ms: 2_500 });
  x.ocA = await rootPlugin(x.s, x.a);
  x.up.push(x.ocA);
  x.ocA.create("root");
  const first = x.ocA.turn("root", "привет");
  await until(() => x.s.fake.state.counts.connect_asked > 0, "the root's connect on the wire");
  assert.deepEqual(heardSeats(x.s.fake), [], "the root holds no seat when the move lands");
  return Object.assign(x, { first, mark: x.s.fake.state.placeArgs.length });
}

/** A call of the session through an instance's own wrapper: its answer, or the refusal. */
async function call(x, oc, c) {
  await until(() => oc.tools().get(c.tool), `the server lists ${c.tool} in the instance`, 15_000);
  try {
    const out = await oc.tools().get(c.tool).execute(c.input, CALLER);
    return { ...c, content: out?.content };
  } catch (e) {
    return { ...c, error: e.message };
  }
}

/** The names the session's bridges stood after the move — register and connect alike, in order. */
const stood = (x) =>
  x.s.fake.state.placeArgs
    .slice(x.mark)
    .filter((p) => p.action === "register" || p.action === "connect")
    .map((p) => p.name);
const same = (l, r) => [...new Set(l)].sort().join() === [...new Set(r)].sort().join();
const flat = (s) =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const none = (l) => l.join(", ") || "none";

/**
 * The contract for the session's seat `name` — `allowed`: the names the session's bridges may
 * have stood after the move —, `write` — the call that just wrote through the instance `home`;
 * read from the state once the seat is heard (twenty seconds at most). The faults, a line each;
 * none when the contract holds.
 */
async function faults(x, home, name, allowed, write) {
  const { fake } = x.s;
  for (const end = Date.now() + 20_000; !heardSeats(fake).includes(name) && Date.now() < end;)
    await sleep(50);
  const heard = heardSeats(fake);
  const records = heldBy(x.s.dir, "root");
  const names = [...new Set(stood(x))];
  const author = fake.state.writes.at(-1)?.author;
  const out = [];
  if (heard.length !== 1 || heard[0] !== name)
    out.push(
      `${heard.length} seat(s) of the role heard: ${none(heard)} — the session's one: ${name}`,
    );
  if (records.length !== 1 || records[0] !== name)
    out.push(`${records.length} record(s) of the session lie: ${none(records)} — the one: ${name}`);
  if (!same(names, allowed))
    out.push(
      `names stood after the move, in the order of first standing: ${names.join(" → ") || "none"} — the session's bridges may have stood: ${none(allowed)}`,
    );
  if (write?.error) out.push(`the write through ${home} was refused: ${flat(write.error)}`);
  else if (write && author !== name)
    out.push(
      `the write through ${home} carried ${author ? `the author ${author}` : "no author"} — the server answered: ${flat(write.content)}`,
    );
  return out;
}

/**
 * The new folder's instance serving the session — a prompt with a write, the status stand, a
 * prompt with a write —: the contract's faults after each step, the step named.
 */
async function serving(x, name, allowed) {
  const oc = x.ocB;
  const bad = [];
  for (const [step, make] of [
    ["a prompt with a write", () => oc.turn("root", "после переноса", () => [WRITE])],
    ["the status stand", () => call(x, oc, BUSY)],
    ["a prompt with a write again", () => oc.turn("root", "ещё", () => [WRITE])],
  ]) {
    const r = await make();
    bad.push(
      ...(await faults(x, B, name, allowed, r.calls?.[0])).map((f) => `after ${step}: ${f}`),
    );
  }
  return bad;
}

test(
  "A → B, B live and holding: the new folder's instance serves the session — one seat, the name the root stood in A, every write by it",
  T,
  async (t) => {
    const x = await seated(t);
    await liveIn(x);
    await moved(x);
    assert.deepEqual(await serving(x, x.old, [x.old]), [], KEPT);
  },
);

test(
  "A → B, B live and holding: the running turn's full stand goes through the old folder's instance, then the new folder's instance serves the session — one seat, the explicit stand's, every write by it",
  T,
  async (t) => {
    const x = await seated(t);
    await liveIn(x);
    await moved(x);
    const { error } = await call(x, x.ocA, STAND);
    const own = stood(x).at(-1); // the explicit stand's seat: the last the session's bridges stood
    assert.ok(
      !error && own !== x.old,
      `the explicit stand through the old folder's instance stood a seat of its own\n${error ?? ""}`,
    );
    await sleep(1_000); // the new folder's instance takes the news of its seat; then it serves the session
    assert.deepEqual(await serving(x, own, [x.old, own]), [], KEPT);
  },
);

for (const live of [false, true])
  test(
    `A → B while the old folder's instance is still seating the root, ${live ? "the new folder's instance live" : "without the new folder's instance"} — one seat under the name the root's seating stood, every write by it`,
    T,
    async (t) => {
      const x = await underway(t);
      if (live) await liveIn(x);
      x.ocA.move("root", x.b);
      if (live) x.ocB.move("root", x.b);
      await x.s.fake.control({ connect_delay_ms: 0 });
      await x.first;
      await sleep(3_500); // the delayed connect answers, the forgotten attempt cleans up
      const r = await x[live ? "ocB" : "ocA"].turn("root", "после переноса", () => [WRITE]);
      const [old] = stood(x); // the name the root's seating in flight stood
      assert.ok(old, "the root's seating in flight stood a seat");
      assert.deepEqual(await faults(x, live ? B : A, old, [old], r.calls[0]), [], KEPT);
    },
  );
