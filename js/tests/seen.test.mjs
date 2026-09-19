// Память доставленного (js/shared/seen.ts): писателей у файла несколько —
// сторож, сторож выхода, мост, — и обрезка до хвоста у одного не должна
// выбрасывать пометки другого (граф nks-dev: #5428). Исходник импортируется
// напрямую (Node снимает типы); старую копию подставляй правкой импорта.
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { noteSeen, seenIds } from "../shared/seen.ts";

test("trimming a full memory merges the file: another writer's mark survives", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  const mine = Array.from({ length: 200 }, (_, i) => `mine-${i}`);
  writeFileSync(path, mine.join("\n") + "\n");
  const memory = seenIds(path); // this writer's memory: full
  appendFileSync(path, "other\n"); // another writer marks a frame it delivered
  noteSeen(path, "new", memory); // over the limit: this writer trims
  const after = seenIds(path);
  assert.ok(after.has("other"), "the other writer's mark is kept");
  assert.ok(after.has("new"));
  assert.ok(after.size <= 200, `trimmed to the tail: ${after.size}`);
});

test("a trim leaves the writer's memory at the tail and no temporary file behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "iskron-seen-"));
  const path = join(dir, "k.seen");
  writeFileSync(path, Array.from({ length: 200 }, (_, i) => `m-${i}`).join("\n") + "\n");
  const memory = seenIds(path);
  noteSeen(path, "a", memory);
  noteSeen(path, "b", memory);
  assert.ok(memory.size <= 200, `the memory is trimmed with the file: ${memory.size}`);
  assert.deepEqual(readdirSync(dir), ["k.seen"], "no temporary file is left");
});
