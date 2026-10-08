// Отпечаток набора скиллов по маске слоя поставки (граф @nks/nks-dev, узел #6806,
// добавка к части 2): `*/SKILL.md` — прежняя мера, `*/**` — каждый файл скилла.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { treeStamp } from "../bridge/skillset.ts";

function set() {
  const root = mkdtempSync(join(tmpdir(), "skillstamp-"));
  for (const [rel, body] of [
    ["a/SKILL.md", "alpha"],
    ["a/references/x.md", "one"],
    ["b/SKILL.md", "beta"],
  ]) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

test("the one-file mask hashes as the earlier stamp and ignores the other files", () => {
  const root = set();
  try {
    const h = createHash("sha256");
    for (const [name, body] of [
      ["a", "alpha"],
      ["b", "beta"],
    ])
      h.update(`${name}\0`).update(body).update("\0");
    assert.equal(treeStamp(root, "*/SKILL.md"), h.digest("hex").slice(0, 8));
    const before = treeStamp(root, "*/SKILL.md");
    writeFileSync(join(root, "a", "references", "x.md"), "two");
    assert.equal(treeStamp(root, "*/SKILL.md"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the every-file mask sees a change in any file of a skill", () => {
  const root = set();
  try {
    const before = treeStamp(root, "*/**");
    assert.match(before, /^[0-9a-f]{8}$/);
    writeFileSync(join(root, "a", "references", "x.md"), "two");
    assert.notEqual(treeStamp(root, "*/**"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the every-file mask follows a file symlink as the one-file mask does", () => {
  const root = set();
  const target = join(root, "..", `${root.split("/").pop()}-target.md`);
  try {
    writeFileSync(target, "one");
    symlinkSync(target, join(root, "a", "linked.md"));
    const before = treeStamp(root, "*/**");
    writeFileSync(target, "two");
    assert.notEqual(treeStamp(root, "*/**"), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(target, { force: true });
  }
});

test("a mask the core does not speak is refused loudly", () => {
  assert.throws(() => treeStamp(tmpdir(), "skills/*.md"), /unsupported skill stamp mask/);
});
