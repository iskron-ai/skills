// Изоляция пишущих проб: граф @nks/nks-dev, #10310.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const built = new URL("./built.mjs", import.meta.url).href;

test("built probe admission refuses a TMPDIR inside a repository before any writer", (t) => {
  const root = mkdtempSync(join(tmpdir(), "tmp-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".git"));
  const scratch = join(root, "scratch");
  mkdirSync(scratch);
  const cover = join(root, "AGENTS.md");
  writeFileSync(cover, "parent must remain unchanged\n");
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(built)}); console.log("ADMITTED");`,
    ],
    {
      env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0, "an in-repository scratch must not admit a writer");
  assert.match(result.stderr, /TMPDIR.*repository/i);
  assert.doesNotMatch(result.stdout, /ADMITTED/);
  assert.equal(readFileSync(cover, "utf8"), "parent must remain unchanged\n");
});

test("built probe admission accepts an external TMPDIR", () => {
  const scratch = realpathSync(tmpdir());
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(built)}); console.log("ADMITTED");`,
    ],
    {
      env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ADMITTED/);
});
