import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { carryGraphReceipt, receiptGraph } from "../shared/graph-receipt.ts";
import { carryGraphMarks, seenIds } from "../shared/seen.ts";
import { seenFilePathOf } from "../shared/standings.ts";
import { graphPosed } from "./room-frames.mjs";

test("graph receipt trusts local metadata only and stays inside its auth directory", (t) => {
  const root = mkdtempSync(join(tmpdir(), "graph-receipt-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "standings"));
  const seen = seenFilePathOf(root, "seat", "http://127.0.0.1:1");
  const f = graphPosed("latest", 10);
  f.seen = seen;
  f.marks = ["ev:666"];
  receiptGraph([f]);
  assert.equal(existsSync(seen), false, "server fields and legacy notifications are not receipts");
  carryGraphMarks(f, ["ev:9"]);
  carryGraphReceipt(f, seen, root);
  assert.equal(existsSync(seen), false, "binding/selection is not handoff");
  receiptGraph([f]);
  assert.ok(seenIds(seen).has("ev:10"));
  assert.ok(seenIds(seen).has("ev:9"));
  assert.ok(!seenIds(seen).has("ev:666"));
  carryGraphReceipt(f, join(root, "outside.seen"), root);
  assert.throws(() => receiptGraph([f]), /outside/);
  const linkedRoot = join(root, "another-auth");
  mkdirSync(linkedRoot);
  symlinkSync(join(root, "standings"), join(linkedRoot, "standings"));
  carryGraphReceipt(f, seenFilePathOf(linkedRoot, "seat", "http://127.0.0.1:1"), linkedRoot);
  assert.throws(() => receiptGraph([f]), /outside/, "a linked parent cannot escape authdir");
});
