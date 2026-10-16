import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { COVER, frontmatter } from "./rootseat-kit.mjs";

const root = process.env.ISKRON_CORE_SOURCE_ROOT
  ? pathToFileURL(process.env.ISKRON_CORE_SOURCE_ROOT + "/")
  : new URL("../../", import.meta.url);
const { createSeatLife } = await import(new URL("js/opencode/rootseat-tools.ts", root));
const { createRootSeats } = await import(new URL("js/opencode/rootseat.ts", root));
const defer = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "round3-seat-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "AGENTS.md"), frontmatter(COVER));
  const gate = defer(),
    entered = defer(),
    revokes = [],
    explicitHolds = [];
  const slot = {
    session: "root",
    holding: true,
    stood: true,
    provisional: false,
    busy: 0,
    lastCall: 0,
    dir,
    key: "explicit--931--_nks_nks-dev",
    place: { name: "explicit", karta: "931", realm: "@nks/nks-dev" },
    bridge: {
      stop() {},
      request: async (...a) => {
        revokes.push(a);
        return {};
      },
    },
  };
  const life = createSeatLife({
    slots: new Map([["root", slot]]),
    authDir: () => dir,
    stopped: () => false,
    slotFor: async () => slot,
    awaitReady: async () => {
      entered.resolve();
      await gate.promise;
    },
    modelOf: async () => null,
    callThrough: async () => assert.fail("restored explicit seat"),
    stood: (s) => {
      s.holding = true;
    },
    forgot() {},
    held: (s) => explicitHolds.push(s),
    failed: assert.fail,
    ...extra,
  });
  return { dir, slot, gate, entered, revokes, explicitHolds, life };
}

test("round3 P2-1: unloading marks a restored explicit seat even with a live attempt", async (t) => {
  const f = fixture(t);
  const p = f.life.half.seatRoot("root", "@nks/nks-dev", "931", () => false);
  await f.entered.promise;
  f.life.half.cancelSeat("root");
  const marked = f.life.stopSlots({ directory: f.dir }, null);
  f.gate.resolve();
  await p;
  assert.equal(marked.length, 1);
  assert.equal(marked[0].key, f.slot.key);
});

test("round3 P2-1: cancellation never revokes a returned explicit seat", async (t) => {
  const f = fixture(t);
  const p = f.life.half.seatRoot("root", "@nks/nks-dev", "931", () => false);
  await f.entered.promise;
  f.life.half.cancelSeat("root");
  f.gate.resolve();
  await p;
  await f.life.half.releaseSeat("root");
  assert.deepEqual(f.revokes, []);
});

test("round3 P2-2: service cancellation is not a guard against explicit work", async (t) => {
  const f = fixture(t);
  let halted = false;
  const p = f.life.half.seatRoot("root", "@nks/nks-dev", "931", () => halted);
  await f.entered.promise;
  halted = true;
  try {
    assert.doesNotThrow(() => f.life.guard("root"));
  } finally {
    f.gate.resolve();
    await p;
  }
});

test("round3 P2-2: a live attempt does not turn an explicit held into automatic", async (t) => {
  const f = fixture(t);
  const p = f.life.half.seatRoot("root", "@nks/nks-dev", "931", () => false);
  await f.entered.promise;
  const automatic = f.life.observe(f.slot, "held", {
    place: f.slot.place,
    key: f.slot.key,
    provisional: false,
    automatic: false,
  });
  f.gate.resolve();
  await p;
  assert.equal(automatic, false);
});

test("round3 P3a: the provisional comment requires proof from the serving bridge", () => {
  const text = readFileSync(new URL("js/opencode/rootseat.ts", root), "utf8").split("import ")[0];
  assert.match(text, /only proof from (?:the )?serving bridge/i);
});

test("P2-2 late answer: a service answer cannot turn the same explicit seat provisional again", (t) => {
  const f = fixture(t);
  const epoch = f.life.epoch("root");
  f.life.observe(f.slot, "held", {
    key: f.slot.key,
    place: f.slot.place,
    provisional: false,
    automatic: false,
  });
  f.life.answer(
    f.slot,
    "iskron_stand",
    { content: [], structuredContent: { key: f.slot.key, place: f.slot.place, provisional: true } },
    true,
    true,
    "root",
    epoch,
  );
  assert.equal(f.slot.provisional, false);
});

test("P2-2 answer: bare register success is not an explicit stand that lifts the stop", (t) => {
  const f = fixture(t);
  f.life.answer(
    f.slot,
    "iskron_channel",
    { content: [] },
    false,
    true,
    "root",
    f.life.epoch("root"),
  );
  assert.deepEqual(f.explicitHolds, []);
});

test("P2-1 lost answer: without ownership proof cleanup reports the transport failure and does not revoke", async (t) => {
  const failed = [];
  const f = fixture(t, {
    callThrough: async () => {
      throw new Error("lost connect response");
    },
    failed: (word) => failed.push(word),
  });
  f.slot.holding = false;
  f.gate.resolve();
  await f.life.half.seatRoot("root", "@nks/nks-dev", "931", () => false);
  await f.life.half.releaseSeat("root");
  assert.match(failed[0], /lost connect response/);
  assert.deepEqual(f.revokes, []);
});

test("round3 P3c: a stopped first prompt consumes the one automatic seating opportunity", async (t) => {
  const f = fixture(t);
  let halted = true;
  const calls = [];
  const seats = createRootSeats({
    directoryOf: async () => f.dir,
    halted: () => halted,
    seat: async (s) => (calls.push(s), { place: "fresh" }),
    cancel() {},
    release: async () => {},
    finished() {},
    tell() {},
  });
  assert.equal(await seats.word("root"), null);
  halted = false;
  assert.equal(await seats.word("root"), null);
  assert.deepEqual(calls, []);
});
