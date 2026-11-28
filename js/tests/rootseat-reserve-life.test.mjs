// The process's reservation of a root (graph @nks/nks-dev, node #11463; reserve.ts) lives as long
// as its owner's slot: the reaper's or the instance stop's drop of the slot takes it along — a
// process breeding sessions keeps no stopped slot, bridge or closure per root forever —, and an
// old owner's drop never erases a newer owner's. A hand-over not taken in time and taken late
// still leaves the session one seat.
//
// Стенд — rootseat-move-kit.mjs; таблица резерваций читается с globalThis, как её делит процесс.
import assert from "node:assert/strict";
import { test } from "node:test";

import { until } from "./ownseat-kit.mjs";
import { heardSeats, rootPlugin } from "./rootseat-kit.mjs";
import {
  call,
  listed,
  liveIn,
  markers,
  seated,
  stand,
  stood,
  WRITE,
} from "./rootseat-move-kit.mjs";

const T = { timeout: 90_000 };
const ORIENT = { tool: "iskron_orient", input: {} };
const roots = () => globalThis.__iskronRoots ?? new Map();
const reserved = (ids) => ids.filter((id) => roots().has(id));
/** How long a loaded machine may take the reaper's steps (its interval is 100 ms here). */
const REAPED_MS = 15_000;
/** The reaper's idle term — set per instance: it must not leak into the next probe's instance. */
const REAPER = { ISKRON_BRIDGE_IDLE_MS: "300", ISKRON_BRIDGE_REAP_MS: "100" };
/**
 * A read of each session through the instance: each root reserved by it — seen at the call's
 * end, before the reaper's next step (a slot idles from the call's end; a loaded machine may
 * reap the first before the last call is out).
 */
async function touch(oc, ids) {
  await listed(oc, ORIENT);
  for (const sessionID of ids) {
    await oc.tools().get(ORIENT.tool).execute({}, { sessionID, agent: "build", messageID: "m" });
    assert.ok(roots().has(sessionID), `${sessionID} reserved by its first call`);
  }
}
async function one(t, env = {}) {
  const x = await stand(t);
  x.ocA = await rootPlugin(x.s, x.a, env);
  x.up.push(x.ocA);
  const ids = ["life-1", "life-2", "life-3"];
  for (const id of ids) x.ocA.create(id, { emit: false });
  await touch(x.ocA, ids);
  return { x, ids };
}

test("the reaper drops idle roots' slots: their reservations go too", T, async (t) => {
  const { ids } = await one(t, REAPER);
  const gone = () => reserved(ids).length === 0;
  await until(gone, "no reservation outlives its reaped slot", REAPED_MS);
});

test("the instance stops: its roots' reservations go with its slots", T, async (t) => {
  const { x, ids } = await one(t);
  assert.deepEqual(reserved(ids), ids, "each root reserved, no reaper here");
  await x.ocA.stop();
  assert.deepEqual(reserved(ids), [], "no reservation outlives the stopped instance");
});

test("an old owner's drop leaves a newer owner's reservation intact", T, async (t) => {
  const { x } = await one(t, REAPER);
  await until(() => !roots().has("life-1"), "A's slot of life-1 reaped", REAPED_MS);
  await liveIn(x);
  x.ocB.create("life-1", { emit: false });
  await touch(x.ocB, ["life-1"]);
  const newer = roots().get("life-1");
  await x.ocA.stop();
  assert.equal(roots().get("life-1"), newer, "the newer owner's reservation stays");
  assert.ok(newer?.slot && !newer.slot.bridge.failure, "with its live slot");
});

// A guard: the owner's replacement of its dead bridge drops and puts back the reservation in one
// synchronous step (setSlot) — no other instance's call may take the root in between.
test(
  "the owner's bridge dies and is replaced under concurrent writes — one reservation, one seat, every write the root's",
  T,
  async (t) => {
    const x = await seated(t);
    await liveIn(x);
    const before = roots().get("root");
    const dead = before?.slot;
    assert.ok(dead && !dead.bridge.failure, "the root reserved by A with its live slot");
    dead.bridge.proc.kill("SIGKILL"); // the owner's bridge dies, not by the plugin's stop
    await until(() => dead.bridge.failure, "the owner's bridge is dead");
    const writes = x.s.fake.state.writes.length;
    const [a, b] = await Promise.all([
      x.ocA.turn("root", "после смерти моста", () => [WRITE]),
      call(x, x.ocB, WRITE),
    ]);
    const r = roots().get("root");
    assert.equal(r, before, "the same reservation survives the replacement");
    assert.ok(r.slot !== dead && !r.slot.bridge.failure, "with the owner's new live slot");
    assert.deepEqual(heardSeats(x.s.fake), [x.old], "one seat of the role, the root's");
    assert.deepEqual(
      [...new Set(stood(x))].filter((n) => n !== x.old),
      [],
      "no other name",
    );
    const authors = x.s.fake.state.writes.slice(writes).map((w) => w.author);
    const errors = `A: ${a.calls[0]?.error ?? "ok"}; B: ${b.error ?? "ok"}`;
    assert.deepEqual(authors, [x.old, x.old], `both writes signed by the root: ${errors}`);
  },
);

test("a hand-over not taken in time, taken late — the session keeps one seat", T, async (t) => {
  const x = await seated(t, { ISKRON_ROOT_WAIT_MS: "300" });
  await liveIn(x);
  x.ocA.move("root", x.b);
  await until(() => markers(x.s.dir).length === 1, "the old folder's instance laid the marker");
  const expired = (r = roots().get("root")) => !r || (!r.owner && Date.now() >= r.until);
  await until(expired, "the hand-over expired untaken", REAPED_MS);
  await call(x, x.ocA, WRITE); // the running turn's write through the old folder's instance
  x.ocB.move("root", x.b); // the new folder's instance adopts late
  await until(() => markers(x.s.dir).length === 0, "the late adoption took the marker", REAPED_MS);
  const r = await x.ocB.turn("root", "после переноса", () => [WRITE]);
  assert.deepEqual(heardSeats(x.s.fake), [x.old], "one seat of the role, the root's");
  assert.deepEqual(
    [...new Set(stood(x))].filter((n) => n !== x.old),
    [],
    "no other name",
  );
  assert.equal(x.s.fake.state.writes.at(-1)?.author, x.old, `signed: ${r.calls[0]?.error}`);
});
