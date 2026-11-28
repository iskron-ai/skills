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
  sleep,
  stand,
  stood,
  WRITE,
} from "./rootseat-move-kit.mjs";

const T = { timeout: 90_000 };
const ORIENT = { tool: "iskron_orient", input: {} };
const roots = () => globalThis.__iskronRoots ?? new Map();
const reserved = (ids) => ids.filter((id) => roots().has(id));
/** A read of each session through the instance: each root reserved by it. */
async function touch(oc, ids) {
  await listed(oc, ORIENT);
  for (const sessionID of ids)
    await oc.tools().get(ORIENT.tool).execute({}, { sessionID, agent: "build", messageID: "m" });
}
async function one(t, env = {}) {
  const x = await stand(t);
  x.ocA = await rootPlugin(x.s, x.a, env);
  x.up.push(x.ocA);
  const ids = ["life-1", "life-2", "life-3"];
  for (const id of ids) x.ocA.create(id, { emit: false });
  await touch(x.ocA, ids);
  assert.deepEqual(reserved(ids), ids, "each root reserved by its first call");
  return { x, ids };
}

test("the reaper drops idle roots' slots: their reservations go too", T, async (t) => {
  const { ids } = await one(t, { ISKRON_BRIDGE_IDLE_MS: "300", ISKRON_BRIDGE_REAP_MS: "100" });
  await sleep(1_200);
  assert.deepEqual(reserved(ids), [], "no reservation outlives its reaped slot");
});

test("the instance stops: its roots' reservations go with its slots", T, async (t) => {
  const { x, ids } = await one(t);
  await x.ocA.stop();
  assert.deepEqual(reserved(ids), [], "no reservation outlives the stopped instance");
});

test("an old owner's drop leaves a newer owner's reservation intact", T, async (t) => {
  const { x } = await one(t, { ISKRON_BRIDGE_IDLE_MS: "300", ISKRON_BRIDGE_REAP_MS: "100" });
  await sleep(1_200); // A's slot of life-1 reaped
  await liveIn(x);
  x.ocB.create("life-1", { emit: false });
  await touch(x.ocB, ["life-1"]);
  const newer = roots().get("life-1");
  await x.ocA.stop();
  assert.equal(roots().get("life-1"), newer, "the newer owner's reservation stays");
  assert.ok(newer?.slot && !newer.slot.bridge.failure, "with its live slot");
});

test("a hand-over not taken in time, taken late — the session keeps one seat", T, async (t) => {
  const x = await seated(t, { ISKRON_ROOT_WAIT_MS: "300" });
  await liveIn(x);
  x.ocA.move("root", x.b);
  await until(() => markers(x.s.dir).length === 1, "the old folder's instance laid the marker");
  await sleep(1_000); // the hand-over expired untaken
  await call(x, x.ocA, WRITE); // the running turn's write through the old folder's instance
  x.ocB.move("root", x.b); // the new folder's instance adopts late
  await sleep(3_000);
  const r = await x.ocB.turn("root", "после переноса", () => [WRITE]);
  assert.deepEqual(heardSeats(x.s.fake), [x.old], "one seat of the role, the root's");
  assert.deepEqual(
    [...new Set(stood(x))].filter((n) => n !== x.old),
    [],
    "no other name",
  );
  assert.equal(x.s.fake.state.writes.at(-1)?.author, x.old, `signed: ${r.calls[0]?.error}`);
});
