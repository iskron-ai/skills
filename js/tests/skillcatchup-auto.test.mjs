import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { autoFixture } from "./skillcatchup-auto-kit.mjs";

test("skills catchup auto: all explicit owned names at exact SHA, never all agents", async () => {
  await autoFixture("ok", async ({ text, calls, root, sha, names, lockPath, dir }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED/);
    const add = calls().find((a) => a.includes("add"));
    assert.ok(add, JSON.stringify(calls()));
    assert.ok(add.includes(`https://github.com/iskron-ai/skills/tree/${sha}`));
    assert.deepEqual(add.slice(add.indexOf("--skill") + 1, add.indexOf("--agent")), names);
    assert.equal(add[add.indexOf("--agent") + 1], "opencode");
    assert.ok(!add.includes("--all") && !add.includes("*"));
    assert.equal(
      readFileSync(join(dir, "token-present"), "utf8"),
      "false",
      "NKS bearer must not be inherited by the npm updater",
    );
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    for (const name of names) assert.equal(lock.skills[name].ref, sha);
    assert.equal(readFileSync(join(root, "stranger", "SKILL.md"), "utf8"), "before");
  });
});

test("skills catchup auto: SKILL.md outside skills never enters the delivery inventory", async () => {
  await autoFixture("outside-skills", async ({ text, calls, names }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED/);
    const add = calls().find((args) => args.includes("add"));
    assert.ok(add, JSON.stringify(calls()));
    assert.deepEqual(add.slice(add.indexOf("--skill") + 1, add.indexOf("--agent")), names);
  });
});

for (const mode of [
  "foreign",
  "symlink",
  "truncated",
  "unsafe",
  "network",
  "fork-url",
  "new-name-collision",
  "unowned",
  "duplicate",
  "missing-active-lock",
  "malformed-lock",
  "hardlink",
  "lock-hardlink",
])
  test(`skills catchup auto: ${mode} refuses before any installer`, async () => {
    await autoFixture(mode, async ({ text, calls, root }) => {
      assert.match(text.split("\n")[0], /SKILLS BEHIND.*not updated/);
      assert.equal(calls().length, 0, JSON.stringify(calls()));
      assert.equal(readFileSync(join(root, "stranger", "SKILL.md"), "utf8"), "before");
    });
  });

for (const mode of [
  "exit1",
  "noop",
  "bad-ref",
  "bad-hash",
  "missing-skill",
  "stale-file",
  "missing-bridge",
])
  test(`skills catchup auto: ${mode} is not a successful delivery`, async () => {
    await autoFixture(mode, async ({ text, calls, root }) => {
      assert.match(text.split("\n")[0], /SKILLS DELIVERY BLOCKED.*not updated/);
      assert.equal(existsSync(join(root, "..", ".skill-catchup.lock")), true);
      assert.doesNotMatch(text, /SKILLS UPDATED/);
      assert.ok(
        calls().some((a) => a.includes("add")),
        JSON.stringify(calls()),
      );
    });
  });

test("skills catchup auto: retired own names are reported, never removed", async () => {
  await autoFixture("retired", async ({ text, root }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED.*retired/);
    assert.equal(readFileSync(join(root, "retired", "SKILL.md"), "utf8"), "retired-own");
  });
});

test("skills catchup auto: a cached older tag does not hide the running release", async () => {
  await autoFixture("cached-tag", async ({ text, calls }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED/);
    assert.ok(calls().some((a) => a.includes("add")));
  });
});

test("skills catchup auto: enabled updates still do not write for patch-only lag", async () => {
  await autoFixture("patch", async ({ text, calls, paths }) => {
    assert.match(text.split("\n")[0], /patch-only.*not updated/);
    assert.deepEqual(calls(), []);
    assert.deepEqual(paths, []);
  });
});

test("skills catchup auto: minor lag catches up even with a larger installed patch", async () => {
  await autoFixture("minor", async ({ text }) =>
    assert.match(text.split("\n")[0], /SKILLS UPDATED/),
  );
});

test("skills catchup auto: XDG lock is reread and existing metadata refresh publishes the new stamp", async () => {
  await autoFixture("xdg", async ({ text, lockPath, sha, names, fake, version }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED/);
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    for (const name of names) assert.equal(lock.skills[name].ref, sha);
    const declared = () =>
      fake.state.placeArgs.filter((a) => a.action === "register").at(-1)?.attrs?.skills;
    for (let i = 0; i < 100 && declared()?.version !== version; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(declared()?.version, version);
    assert.equal(declared()?.name, "iskron-ai/skills");
    assert.match(declared()?.stamp, /^[a-f0-9]{8}$/);
  });
});

test("skills catchup auto: timeout kills the updater child group, never success", async () => {
  await autoFixture("timeout", async ({ text, dir, calls }) => {
    assert.match(text.split("\n")[0], /SKILLS DELIVERY BLOCKED.*updater_timeout.*not updated/);
    assert.ok(calls().some((a) => a.includes("add")));
    await new Promise((r) => setTimeout(r, 3300));
    assert.equal(existsSync(join(dir, "escaped-child")), false, "a child survived updater timeout");
  });
});

test("skills catchup auto: return catches up without connect and publishes the reread stamp", async () => {
  await autoFixture("resume", async ({ text, fake, connectsBefore }) => {
    assert.match(text.split("\n")[0], /SKILLS UPDATED/);
    const stamp = /stamp ([a-f0-9]{8})/.exec(text)?.[1];
    const declared = () =>
      fake.state.placeArgs.filter((a) => a.action === "register").at(-1)?.attrs?.skills?.stamp;
    for (let i = 0; i < 100 && declared() !== stamp; i++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(declared(), stamp);
    assert.equal(fake.state.placeArgs.filter((a) => a.action === "connect").length, connectsBefore);
  });
});

test("skills catchup auto: an owner's stop during source lookup starts no updater", async () => {
  await autoFixture("stop-before", async ({ text, calls }) => {
    assert.doesNotMatch(text, /SKILLS UPDATED/);
    assert.equal(calls().length, 0);
    assert.match(text, /stop/i);
  });
});

test("skills catchup auto: an owner's stop aborts the updater child group", async () => {
  await autoFixture("stop-during", async ({ text, calls, dir }) => {
    assert.ok(calls().some((a) => a.includes("add")));
    assert.doesNotMatch(text, /SKILLS UPDATED/);
    assert.match(text, /stop/i);
    await new Promise((r) => setTimeout(r, 3300));
    assert.equal(existsSync(join(dir, "escaped-child")), false);
  });
});
