import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { importAttempt } from "../bridge/exec-launch.ts";
import { readReceipt, receiptFor } from "../bridge/exec-receipt.ts";
import { receiptFixture } from "./exec-receipt-fixture.mjs";
for (const attack of [
  "file-mode",
  "dir-mode",
  "symlink",
  "hardlink",
  "schema",
  "attempt",
  "identity",
  "foreign-parent",
]) {
  test(`receipt import refuses ${attack}`, (t) => {
    const f = receiptFixture(t),
      path = f.path;
    if (attack === "file-mode") chmodSync(path, 0o644);
    if (attack === "dir-mode") chmodSync(join(path, ".."), 0o755);
    if (attack === "symlink") {
      renameSync(path, path + ".saved");
      symlinkSync(path + ".saved", path);
    }
    if (attack === "hardlink") linkSync(path, path + ".linked");
    if (["schema", "attempt", "identity"].includes(attack)) {
      const v = JSON.parse(readFileSync(path));
      v[attack] = "wrong";
      writeFileSync(path, JSON.stringify(v));
    }
    if (attack === "foreign-parent") {
      const foreign = realpathSync(mkdtempSync(join(tmpdir(), "foreign-attempt-")));
      t.after(() => rmSync(foreign, { recursive: true, force: true }));
      mkdirSync(join(foreign, `exec-${f.row.exec.attempt}`), { mode: 0o700 });
      f.row.exec.receipt = join(foreign, `exec-${f.row.exec.attempt}`, "receipt.json");
      writeFileSync(f.row.exec.receipt, readFileSync(path), { mode: 0o600 });
    }
    assert.throws(() => receiptFor(f.row, f.root));
    importAttempt(f.row, f.root);
    assert.equal(f.row.state, "ambiguity");
    assert.equal(f.row.exec.session, undefined);
  });
}
test("fresh receipt is private, exact and still planned", (t) => {
  const f = receiptFixture(t);
  assert.equal(readReceipt(f.path).phase, "planned");
  assert.equal(receiptFor(f.row, f.root).attempt, f.row.exec.attempt);
});
