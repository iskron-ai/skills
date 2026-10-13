import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { status } from "./status-kit.mjs";

test("disk status distinguishes a left record from a not-left record in both languages", () => {
  const dir = mkdtempSync(join(tmpdir(), "status-left-"));
  mkdirSync(join(dir, "standings"));
  try {
    for (const left of [true, false])
      writeFileSync(
        join(dir, "standings", `${left}.hold`),
        JSON.stringify({ name: `seat-${left}`, realm: "r5", karta: 931, left }),
      );
    for (const [lang, gone, present] of [
      ["en", "left", "not left"],
      ["ru", "ушла", "не ушла"],
    ]) {
      const out = status(dir, ["--lang", lang]).stdout;
      assert.match(
        out.split("\n").find((s) => s.includes("seat-true")),
        new RegExp(` · ${gone}$`),
      );
      assert.match(
        out.split("\n").find((s) => s.includes("seat-false")),
        new RegExp(` · ${present}$`),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
