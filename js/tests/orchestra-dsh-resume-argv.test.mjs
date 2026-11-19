import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { dshArgv, sharedGitDir } from "../bridge/orchestra-dsh.ts";

test("dsh continuation keeps the session and launcher patches before json", () => {
  assert.deepEqual(dshArgv("profile.yml", "model.yml", "continue", "session-123"), [
    "headless",
    "--patch",
    "profile.yml",
    "--patch",
    "model.yml",
    "--session-id",
    "session-123",
    "--json",
    "continue",
  ]);
});

test("dsh argv grants the tree's shared git-dir before json, and nothing without one", () => {
  assert.deepEqual(dshArgv("p.yml", "m.yml", "go", "session-1", "/repo/.git"), [
    "headless",
    "--patch",
    "p.yml",
    "--patch",
    "m.yml",
    "--session-id",
    "session-1",
    "--add-dir",
    "/repo/.git",
    "--json",
    "go",
  ]);
  assert.ok(!dshArgv("p.yml", "m.yml", "go", undefined, null).includes("--add-dir"));
});

test("the shared git-dir is physical; missing, relative or absent — none", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "dsh-gitdir-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(sharedGitDir(dir), realpathSync.native(dir));
  assert.equal(sharedGitDir(join(dir, "gone")), null);
  assert.equal(sharedGitDir("repo/.git"), null);
  assert.equal(sharedGitDir(undefined), null);
});
