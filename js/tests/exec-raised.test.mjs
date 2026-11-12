import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { launchExec } from "../bridge/exec-launch.ts";
import { bindExecRaised } from "../bridge/exec-raised.ts";
import { readRuns } from "../bridge/orchestra-runs.ts";
import { execFixture } from "./exec-fixture.mjs";

test("owned raised cursor advances after durable binding and never reads invitations", async (t) => {
  const f = await execFixture(t);
  assert.equal(
    await launchExec(f.auth, f.runs, f.key, f.host, f.spec, "owned brief", f.bridge),
    "exec_launched",
  );
  await bindExecRaised(f.auth, f.url, "synthetic", ["@x/one"]);
  assert.equal(readRuns(f.auth)[f.key].standing_id, "seat");
  assert.equal(
    JSON.parse(readFileSync(join(f.auth, "run", "exec-raised-cursors.json")))["@x/one"],
    "exec-page-1",
  );
  await bindExecRaised(f.auth, f.url, "synthetic", ["@x/one"]);
  assert.ok(f.calls.some((c) => c.path.includes("since=exec-page-1")));
  assert.equal(
    f.calls.some((c) => c.path.includes("/invites")),
    false,
  );
  writeFileSync(join(f.auth, "run", "exec-raised-cursors.json"), "{broken");
  const count = f.calls.length;
  await assert.rejects(bindExecRaised(f.auth, f.url, "synthetic", ["@x/one"]));
  assert.equal(f.calls.length, count, "unreadable cursor cannot restart from the beginning");
});
