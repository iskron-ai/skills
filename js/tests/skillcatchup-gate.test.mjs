import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { autoFixture } from "./skillcatchup-auto-kit.mjs";
import { rpc } from "./status-kit.mjs";

test("skills catchup gate: the single writer gate covers source lookup too", async () => {
  await autoFixture("lookup-gate", async ({ text, gateDuringLookup }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED/);
    assert.equal(
      gateDuringLookup,
      true,
      "parallel sessions must not all spend the GitHub quota before taking the gate",
    );
  });
});

test("skills catchup gate: unknown orphan is retained and retry is not a repair", async () => {
  await autoFixture("busy", async ({ text, calls, root }) => {
    assert.match(text.split("\n")[0], /writer gate exists.*confirm.*repeat.*not repair/i);
    assert.match(text, /only after a complete pinned post-read/);
    assert.ok(text.includes(join(root, "..", ".skill-catchup.lock")));
    assert.deepEqual(calls(), []);
    assert.equal(
      readFileSync(join(root, "..", ".skill-catchup.lock", "sentinel"), "utf8"),
      "another writer",
    );
  });
});

test("skills catchup gate: a second live session cannot start a second updater", async () => {
  await autoFixture("concurrent", async ({ text, secondText, calls }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED/);
    assert.match(secondText.split("\n")[0], /writer gate exists.*confirm.*repeat.*not repair/i);
    assert.equal(calls().filter((a) => a.includes("add")).length, 1);
  });
});

for (const mode of ["stale-file", "missing-bridge"])
  test(`skills catchup gate: fresh bridge.VERSION cannot hide a failed partial copy (${mode})`, async () => {
    await autoFixture(mode, async ({ text, link }) => {
      assert.match(text.split("\n")[0], /not updated/);
      const again = await rpc(
        link,
        "tools/call",
        { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name: "auto-probe" } },
        4,
      );
      const first = again.result.content
        .map((c) => c.text ?? "")
        .join("\n")
        .split("\n")[0];
      assert.match(first, /writer gate exists/);
      assert.doesNotMatch(
        first,
        /v([0-9.]+) < bridge v\1/,
        "equal versions do not prove a complete copy",
      );
    });
  });

test("skills catchup gate: a dangling gate blocks even an equal installed version", async () => {
  await autoFixture("fresh-dangling", async ({ text, root, calls }) => {
    assert.match(text.split("\n")[0], /writer gate exists/);
    assert.deepEqual(calls(), []);
    assert.equal(lstatSync(join(root, "..", ".skill-catchup.lock")).isSymbolicLink(), true);
  });
});

test("skills catchup gate: failure before add is repeatable without a retained gate", async () => {
  await autoFixture("network", async ({ text, root, link, calls, paths }) => {
    assert.match(text.split("\n")[0], /manifest_http_503/);
    assert.equal(existsSync(join(root, "..", ".skill-catchup.lock")), false);
    const again = await rpc(
      link,
      "tools/call",
      { name: "iskron_stand", arguments: { realm: "nks-dev", karta: 931, name: "auto-probe" } },
      4,
    );
    assert.match(again.result.content.map((c) => c.text ?? "").join("\n"), /manifest_http_503/);
    assert.equal(paths.filter((p) => p.includes("/git/trees/")).length, 2);
    assert.deepEqual(calls(), []);
    assert.equal(existsSync(join(root, "..", ".skill-catchup.lock")), false);
  });
});
