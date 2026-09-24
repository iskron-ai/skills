// Память доставленного (js/shared/seen.ts): писателей у файла несколько —
// сторож, сторож выхода, мост, — и обрезка до хвоста у одного не должна
// выбрасывать пометки другого (граф nks-dev: #5428). Память держит день
// трафика места, а файл остаётся ограниченным (#5831). Исходник импортируется
// напрямую (Node снимает типы); старую копию подставляй правкой импорта.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { noteSeen, SEEN_KEEP, SEEN_SLACK, seenIds } from "../shared/seen.ts";

const FULL = SEEN_KEEP + SEEN_SLACK; // past this the writer rewrites the file with its tail
const lines = (path) => seenIds(path).size;

test("trimming a full memory merges the file: another writer's mark survives", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  const mine = Array.from({ length: FULL }, (_, i) => `mine-${i}`);
  writeFileSync(path, mine.join("\n") + "\n");
  const memory = seenIds(path); // this writer's memory: full
  appendFileSync(path, "other\n"); // another writer marks a frame it delivered
  noteSeen(path, "new", memory); // over the limit: this writer trims
  const after = seenIds(path);
  assert.ok(after.has("other"), "the other writer's mark is kept");
  assert.ok(after.has("new"));
  assert.ok(after.size <= SEEN_KEEP, `trimmed to the tail: ${after.size}`);
});

test("a trim leaves the writer's memory at the tail and no temporary file behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  writeFileSync(path, Array.from({ length: FULL }, (_, i) => `m-${i}`).join("\n") + "\n");
  const memory = seenIds(path);
  noteSeen(path, "a", memory);
  noteSeen(path, "b", memory);
  assert.ok(memory.size <= SEEN_KEEP + 1, `the memory is trimmed with the file: ${memory.size}`);
  assert.ok(memory.has("a") && memory.has("b"));
  assert.deepEqual(readdirSync(dir), ["k.seen"], "no temporary file is left");
});

test("a long-lived writer's stale memory does not push another writer's fresh mark out of the tail", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  const memory = new Set(Array.from({ length: FULL }, (_, i) => `stale-${i}`)); // old memory, file moved on
  writeFileSync(
    path,
    Array.from({ length: 199 }, (_, i) => `f-${i}`)
      .concat("fresh")
      .join("\n") + "\n",
  );
  noteSeen(path, "mine", memory);
  const after = seenIds(path);
  assert.ok(after.has("fresh"), "the other writer's fresh mark stays");
  assert.ok(after.has("mine"), "and this writer's new mark too");
});

// A day's queue the platform hands again after a reconnect (#5831: 190 frames,
// each an id and an event mark) must still be in memory when it comes back.
test("a day's traffic fits: 2500 frames' ids and event marks are all remembered", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  const memory = seenIds(path);
  for (let i = 0; i < 2500; i++) {
    noteSeen(path, `id-${i}`, memory);
    noteSeen(path, `ev:${i}`, memory);
  }
  const after = seenIds(path);
  assert.ok(after.has("id-0") && after.has("ev:0"), "the first frame of the day is remembered");
  assert.equal(after.size, 5000);
});

test("the file stays bounded and the oldest marks go first", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  const memory = seenIds(path);
  for (let i = 0; i < 20_000; i++) noteSeen(path, `x-${i}`, memory);
  const after = seenIds(path);
  assert.ok(after.size <= FULL, `bounded: ${after.size}`);
  assert.ok(!after.has("x-0"), "the oldest mark is gone");
  assert.ok(after.has("x-19999") && after.has(`x-${20_000 - SEEN_KEEP}`), "the newest are kept");
});

test("below the compaction threshold a mark is one append — the file is not rewritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  writeFileSync(path, Array.from({ length: SEEN_KEEP + 1 }, (_, i) => `m-${i}`).join("\n") + "\n");
  const memory = seenIds(path);
  const before = statSync(path);
  noteSeen(path, "one-more", memory);
  const after = statSync(path);
  assert.equal(after.ino, before.ino, "the same file, not a rename over it");
  assert.equal(after.size, before.size + "one-more\n".length, "one line appended");
  assert.equal(lines(path), SEEN_KEEP + 2);
});
