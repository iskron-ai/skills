import assert from "node:assert/strict";
import { test } from "node:test";

import { launchExec } from "../bridge/exec-launch.ts";
import { orchestraServe } from "../bridge/orchestra.ts";
import { readOrchestraFlag } from "../bridge/orchestra-flag.ts";
import { execFixture } from "./exec-fixture.mjs";

test("the service observes its existing exec client while automatic raising is OFF", async (t) => {
  const f = await execFixture(t);
  assert.equal(
    await launchExec(f.auth, f.runs, f.key, f.host, f.spec, "own fake brief", f.bridge),
    "exec_launched",
  );
  const serve = orchestraServe(f.auth, { base: () => f.url, token: () => "synthetic" });
  await serve("off", []);
  let deadline;
  try {
    await Promise.race([
      f.stopped,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("OFF prevented the exit observer")), 11_000);
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
  await serve("step", []); // serialized behind the observer; no write races with fixture cleanup
  assert.equal(readOrchestraFlag(f.auth).on, false);
  assert.equal(
    f.calls.some((call) => call.path.includes("/invites")),
    false,
  );
  assert.equal(f.orders[0].payload.reason_code, "client_exited");
  assert.equal(
    f.orcaCalls().some((args) => args[0] === "agent" && args[1] === "launch"),
    false,
  );
});
