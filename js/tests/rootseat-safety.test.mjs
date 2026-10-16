// Cancellation and stop are checked at the same root-seat boundary as the prompt hook.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createHalts } from "../opencode/halts.ts";
import { COVER, frontmatter } from "./rootseat-kit.mjs";

const ROOT =
  process.env.ISKRON_ROOTSEAT_MODULE || new URL("../opencode/rootseat.ts", import.meta.url).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

async function fixture(t, extra = {}) {
  const { createRootSeats } = await import(ROOT);
  const dir = mkdtempSync(join(tmpdir(), "root-safety-"));
  writeFileSync(join(dir, "AGENTS.md"), frontmatter(COVER));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [],
    released = [],
    told = [];
  const roots = createRootSeats({
    directoryOf: async () => dir,
    halted: () => false,
    seat: async (s) => (calls.push(s), { place: s, realm: "@nks/nks-dev", provisional: true }),
    release: async (s) => released.push(s),
    cancel: () => {},
    finished: () => {},
    tell: (s, text) => told.push([s, text]),
    ...extra,
  });
  return { roots, calls, released, told, dir };
}

test("P1-1: a halted root (including an ancestor's halt) gets no stand or seating word", async (t) => {
  const f = await fixture(t, { halted: () => true });
  assert.equal(await f.roots.word("root"), null);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.told, []);
});

test("P1-1: an ancestor's disk stop gates the seat through the same halts door", async (t) => {
  let halts;
  const f = await fixture(t, { halted: (s) => halts.halted(s) });
  const parent = "p1-disk-parent",
    child = "p1-disk-child";
  const key = createHash("sha256").update(parent).digest("hex").slice(0, 16);
  writeFileSync(
    join(f.dir, `opencode-stopped.${key}.json`),
    JSON.stringify({
      session: parent,
      id: "p1-ancestor",
      at: new Date().toISOString(),
      word: "stop",
    }),
  );
  halts = createHalts(
    (s) => (s === child ? parent : undefined),
    () => f.dir,
    () => {},
    () => {},
  );
  assert.equal(await f.roots.word(child), null);
  assert.deepEqual(f.calls, []);
  assert.ok(halts.halted(child));
});

test("P1-2: forget in the queue never calls seat, and does not give a word", async (t) => {
  const gate = deferred(),
    entered = deferred(),
    calls = [];
  const f = await fixture(t, {
    seat: async (s) => {
      calls.push(s);
      if (s === "first") {
        entered.resolve();
        await gate.promise;
      }
      return { place: s, provisional: true };
    },
  });
  const first = f.roots.word("first");
  await entered.promise;
  const second = f.roots.word("deleted");
  await sleep(10);
  f.roots.forget("deleted");
  gate.resolve();
  await first;
  assert.equal(await second, null);
  assert.deepEqual(calls, ["first"]);
});

test("P1-2: unloading while a second root is queued skips it and releases the first", async (t) => {
  const gate = deferred(),
    entered = deferred(),
    calls = [];
  const f = await fixture(t, {
    seat: async (s) => {
      calls.push(s);
      entered.resolve();
      await gate.promise;
      return { place: s, provisional: true };
    },
  });
  const first = f.roots.word("first");
  await entered.promise;
  const second = f.roots.word("second");
  await sleep(10);
  f.roots.stop();
  gate.resolve();
  assert.equal(await first, null);
  assert.equal(await second, null);
  for (let i = 0; !f.released.length && i < 100; i++) await sleep(5);
  assert.deepEqual(calls, ["first"]);
  assert.deepEqual(f.released, ["first"]);
});

test("P1-2: forget after the prompt ceiling suppresses the late tell and releases the seat", async (t) => {
  const was = process.env.ISKRON_ROOT_SEAT_MS;
  process.env.ISKRON_ROOT_SEAT_MS = "20";
  t.after(() => {
    if (was === undefined) delete process.env.ISKRON_ROOT_SEAT_MS;
    else process.env.ISKRON_ROOT_SEAT_MS = was;
  });
  const gate = deferred();
  const f = await fixture(t, {
    seat: async () => {
      await gate.promise;
      return { place: "late", provisional: true };
    },
  });
  // The implementation's timers do not keep a process alive; this probe does.
  const keep = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keep));
  assert.match(await f.roots.word("root"), /не посажена|not seated/);
  f.roots.forget("root");
  gate.resolve();
  for (let i = 0; !f.released.length && i < 100; i++) await sleep(5);
  assert.deepEqual(f.released, ["root"]);
  assert.deepEqual(f.told, []);
});

for (const end of ["forget", "stop"])
  test(`P1-2: ${end} during seat releases a late seat and gives neither word nor tell`, async (t) => {
    const gate = deferred(),
      entered = deferred();
    const f = await fixture(t, {
      seat: async () => {
        entered.resolve();
        await gate.promise;
        return { place: "late", provisional: true };
      },
    });
    const word = f.roots.word("root");
    await entered.promise;
    if (end === "forget") f.roots.forget("root");
    else f.roots.stop();
    gate.resolve();
    assert.equal(await word, null);
    for (let i = 0; !f.released.length && i < 100; i++) await sleep(5);
    assert.deepEqual(f.released, ["root"]);
    assert.deepEqual(f.told, []);
    assert.equal(await f.roots.word("root"), null);
  });
