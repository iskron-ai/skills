// PR #498: cold-entry retries, account-wide negative cache and conservative list evidence.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GLOBAL_PREFIX, ONBOARD_START, OPENCODE } from "../delivery/index.ts";
import { setup, until } from "./ownseat-kit.mjs";
import { rootPlugin } from "./rootseat-kit.mjs";

const due = (value) => ({ structuredContent: { wizard_due: value }, content: [] });
const actions = (fake) => fake.state.calls.filter((c) => c.name === "iskron_me").length;

test("review P2-1: transport unknown can become true on the next prompt, then is exhausted", async (t) => {
  const s = await setup(t);
  s.fake.state.readinessDelayMs = 500;
  const oc = await rootPlugin(s, realpathSync(s.cwd), { ISKRON_ONBOARD_START_MS: "150" });
  try {
    oc.create("retry");
    assert.equal(await oc.promptOnly("retry", "first"), "first");
    await until(() => oc.tools().has("iskron_stand"), "cold bridge ready");
    s.fake.state.readinessDelayMs = 0;
    s.fake.state.readinessResult = due(true);
    assert.equal(await oc.promptOnly("retry", "second"), `second\n${ONBOARD_START.ru.start()}`);
    const count = actions(s.fake);
    assert.equal(await oc.promptOnly("retry", "third"), "third");
    assert.equal(actions(s.fake), count);
  } finally {
    await oc.stop();
  }
});

test("review P2-1: transport retry budget is three", async (t) => {
  const s = await setup(t);
  s.fake.state.readinessDelayMs = 500;
  const oc = await rootPlugin(s, realpathSync(s.cwd), { ISKRON_ONBOARD_START_MS: "150" });
  try {
    oc.create("budget");
    await until(() => oc.tools().has("iskron_stand"), "bridge ready for timeout probes");
    for (let i = 0; i < 5; i++) assert.equal(await oc.promptOnly("budget", "hello"), "hello");
    assert.equal(actions(s.fake), 3);
  } finally {
    await oc.stop();
  }
});

test("review P2-2: false skips a new root, then survives a new instance from disk without a slot", async (t) => {
  const s = await setup(t);
  const project = realpathSync(s.cwd);
  s.fake.state.readinessResult = due(false);
  let oc = await rootPlugin(s, project);
  try {
    oc.create("account-first");
    await oc.promptOnly("account-first", "first");
    assert.equal(actions(s.fake), 1);
    assert.equal(await oc.promptOnly("account-first", "again"), "again");
    assert.equal(actions(s.fake), 1, "known false exhausts the session");
    oc.create("account-second");
    const started = Date.now();
    assert.equal(await oc.promptOnly("account-second", "second"), "second");
    assert.equal(actions(s.fake), 1, "the same account is not probed for every root");
    assert.ok(Date.now() - started < 250);
    await oc.stop();
    delete globalThis[`${GLOBAL_PREFIX}WorkGraphs`];
    const files = readdirSync(s.dir).filter((f) => f.startsWith("opencode-work-graphs."));
    assert.equal(files.length, 1, "negative cache is on disk");
    assert.ok(
      !readFileSync(join(s.dir, files[0]), "utf8").includes("nks_pat"),
      "no token in marker",
    );
    s.fake.state.readinessDelayMs = 2000;
    oc = await rootPlugin(s, project);
    oc.create("account-reloaded");
    const before = Date.now();
    assert.equal(await oc.promptOnly("account-reloaded", "reloaded"), "reloaded");
    assert.ok(Date.now() - before < 250, "disk hit does not wait for readiness");
    assert.equal(actions(s.fake), 1);
    const status = await oc.tools().get("iskron_bridge").execute();
    assert.ok(status.content.includes(OPENCODE.ru.statusBridges(1, 0)), status.content);
  } finally {
    await oc.stop();
  }
});

for (const [name, result] of [
  ["unknown structured list", { structuredContent: { realms: [] }, content: [] }],
  [
    "English list has no observed complete parser",
    { content: [{ type: "text", text: "Available graphs (0) — no graphs:" }] },
  ],
]) {
  test(`review P2-3: ${name} is unknown, not an invitation`, async (t) => {
    const s = await setup(t);
    s.fake.state.realmResult = result;
    const oc = await rootPlugin(s, realpathSync(s.cwd));
    try {
      oc.create("list-unknown");
      assert.equal(await oc.promptOnly("list-unknown", "hello"), "hello");
      const count = actions(s.fake);
      s.fake.state.readinessResult = due(true);
      assert.equal(await oc.promptOnly("list-unknown", "retry"), "retry");
      assert.equal(actions(s.fake), count, "answered unsupported schema is exhausted");
    } finally {
      await oc.stop();
    }
  });
}

test("review P3: English invitation names only the confirmed skill", () => {
  assert.ok(ONBOARD_START.en.start().includes("onboarding"));
  assert.ok(!ONBOARD_START.en.start().includes("First graph"));
});
