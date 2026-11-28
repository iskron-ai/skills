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
import { test } from "node:test";

import { heardSeats, heldBy } from "./rootseat-kit.mjs";
import {
  A,
  B,
  BUSY,
  call,
  liveIn,
  moved,
  seated,
  sleep,
  STAND,
  stood,
  underway,
  WRITE,
} from "./rootseat-move-kit.mjs";

const T = { timeout: 90_000 };
const KEPT =
  "the contract after the move — one seat of the role under the name the root stood, no other name stood, one record of the session, every write signed by it";

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
    const { error, content } = await call(x, x.ocA, STAND);
    assert.ok(
      !error && content.includes(x.old),
      `the holder answers with ${x.old}: ${error ?? content}`,
    );
    await sleep(1_000); // the new folder's instance takes the news of its seat; then it serves the session
    assert.deepEqual(await serving(x, x.old, [x.old]), [], KEPT);
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

test("deletion after move while connect is in flight revokes the late seat", T, async (t) => {
  const x = await underway(t);
  x.ocA.move("root", x.b);
  await sleep(100);
  x.ocA.remove("root");
  await x.s.fake.control({ connect_delay_ms: 0 });
  await x.first.catch(() => {});
  await sleep(3_500);
  assert.ok(stood(x).length, "the delayed connect actually stood a seat");
  assert.deepEqual(heardSeats(x.s.fake), [], "a deleted session leaves no listening seat");
  assert.deepEqual(heldBy(x.s.dir, "root"), [], "a deleted session leaves no record");
});
