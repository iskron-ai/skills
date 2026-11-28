// The stand of a root session moved by `session.move` (graph @nks/nks-dev, node #11463): two
// folders of one repository with the same cover, a plugin instance per folder, the probe's
// session "root". Shared by rootseat-move.test.mjs and rootseat-reserve.test.mjs.
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { forgetSessions } from "./opencode-kit.mjs";
import { setup, until } from "./ownseat-kit.mjs";
import { heardSeats, heldBy, rootPlugin, writeAgents } from "./rootseat-kit.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const R = "@nks/nks-dev";
export const A = "the old folder's instance";
export const B = "the new folder's instance";
/** A write of the session: the server signs it by the caller's seat in the realm. */
export const WRITE = {
  tool: "iskron_add_phenomenon",
  input: { realm: R, name: "x", given_as: "ding" },
};
/** The session's explicit stand — the start ritual's shape: the graph, the role, the model, no name. */
export const STAND = { tool: "iskron_stand", input: { realm: R, karta: "931", model: "m1" } };
/** The status stand: the busy line of the seat the instance's bridge leads. */
export const BUSY = { tool: STAND.tool, input: { realm: R, karta: "931", status: "перенос" } };
/** A call through an instance's wrapper — as the model's tool call of a running turn goes. */
const CALLER = { sessionID: "root", agent: "build", messageID: "msg-move", id: "call-move" };
/** The new folder's instance said its bridge returned the seat from disk. */
const RETURNED = /возврат места с диска|standing resumed from disk/;
/** The departure's marker in the grant directory (marker.ts): laid — a file; taken — gone. */
export const markers = (dir) =>
  readdirSync(dir).filter((f) => f.startsWith("opencode-lost.") && f.endsWith(".json"));

/** The stand: A — the main copy of a repository, B — a worktree of it, both with the cover. */
export async function stand(t, env = {}) {
  const up = []; // the plugin instances, stopped before setup's cleanup looks for bridges
  t.after(async () => {
    for (const p of up.reverse()) await p.stop();
  });
  // the move's timings are the code's defaults here, whatever the machine's environment holds
  for (const k of ["ISKRON_MOVE_ADOPT_MS", "ISKRON_RESUME_PATIENCE_MS", "ISKRON_ROOT_WAIT_MS"])
    delete process.env[k];
  Object.assign(process.env, env);
  forgetSessions(true);
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
export async function seated(t, env) {
  const x = await stand(t, env);
  x.ocA = await rootPlugin(x.s, x.a);
  x.up.push(x.ocA);
  x.ocA.create("root");
  await x.ocA.turn("root", "привет");
  await until(() => heardSeats(x.s.fake).length === 1, "the root seated in A", 20_000);
  const [old] = heardSeats(x.s.fake);
  if (heldBy(x.s.dir, "root").join() !== old) throw new Error("the root's record in A");
  return Object.assign(x, { old, mark: x.s.fake.state.placeArgs.length });
}

/** The new folder's instance, live before the marker: it reads the session — still in A. */
export async function liveIn(x) {
  x.ocB = await rootPlugin(x.s, x.b);
  x.up.push(x.ocB);
  x.ocB.create("root", { emit: false, directory: x.a });
}

/**
 * The move as the host orders it: A — session.moved to B — lays the marker and puts the root's
 * bridge down "away"; B, session.moved here, returns the seat — its bridge holds the socket.
 */
export async function moved(x) {
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
export async function underway(t) {
  const x = await stand(t);
  await x.s.fake.control({ connect_delay_ms: 2_500 });
  x.ocA = await rootPlugin(x.s, x.a);
  x.up.push(x.ocA);
  x.ocA.create("root");
  const first = x.ocA.turn("root", "привет");
  await until(() => x.s.fake.state.counts.connect_asked > 0, "the root's connect on the wire");
  if (heardSeats(x.s.fake).length) throw new Error("the root holds no seat when the move lands");
  return Object.assign(x, { first, mark: x.s.fake.state.placeArgs.length });
}

/** The server lists the tool in the instance. */
export const listed = (oc, c) =>
  until(() => oc.tools().get(c.tool), `the server lists ${c.tool} in the instance`, 15_000);

/** A call of the session through an instance's own wrapper: its answer, or the refusal. */
export async function call(x, oc, c) {
  await listed(oc, c);
  try {
    const out = await oc.tools().get(c.tool).execute(c.input, CALLER);
    return { ...c, content: out?.content };
  } catch (e) {
    return { ...c, error: e.message };
  }
}

/** The names the session's bridges stood after the move — register and connect alike, in order. */
export const stood = (x) =>
  x.s.fake.state.placeArgs
    .slice(x.mark)
    .filter((p) => p.action === "register" || p.action === "connect")
    .map((p) => p.name);
