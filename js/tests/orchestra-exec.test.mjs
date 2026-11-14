import assert from "node:assert/strict";
import { test } from "node:test";

import { parseLauncher } from "../bridge/orchestra-launchers.ts";
import { LIVE } from "../bridge/orchestra-runs.ts";
import { runIdentity } from "../bridge/orchestra-runs-delta.ts";

const description = (exec) =>
  JSON.stringify({
    launcher: "own",
    host: "local-host",
    adapter: "orca",
    limit: 1,
    harnesses: {
      opencode: { models: ["opaque/token#value"], ...(exec === undefined ? {} : { exec }) },
    },
  });
const spec = {
  server: "http://127.0.0.1:3210",
  modelRefs: {
    "opaque/token#value": { providerID: "provider", id: "model/opaque", variant: "high" },
  },
};

test("explicit exec survives parsing without splitting the model token", () => {
  const parsed = parseLauncher(description(spec));
  assert.deepEqual(parsed.harnesses.opencode.exec, spec);
});
for (const exec of [
  null,
  {},
  { ...spec, server: "https://127.0.0.1:3210" },
  { ...spec, server: "http://user:password@127.0.0.1:3210" },
  { ...spec, server: "http://remote.invalid:3210" },
  { ...spec, server: "http://127.0.0.1:3210/api" },
  { ...spec, modelRefs: {} },
  { ...spec, modelRefs: { "opaque/token#value": "provider/model" } },
]) {
  test(`invalid explicit exec cannot silently use legacy: ${JSON.stringify(exec)}`, () => {
    assert.equal(parseLauncher(description(exec)).code, "exec_invalid");
  });
}
test("absent exec remains legacy", () => {
  assert.equal(parseLauncher(description(undefined)).harnesses.opencode.exec, undefined);
});
test("preparing and ambiguity keep the launcher limit occupied", () => {
  assert.ok(LIVE.includes("preparing"));
  assert.ok(LIVE.includes("ambiguity"));
});
test("replacement incarnation/session/attempt does not inherit prior close", () => {
  const r = {
    realm: "r5",
    room: "r",
    invite: 1,
    at: "now",
    terminal: "t",
    runtime: "rt",
    harness: "opencode",
    exec: { attempt: "a", session: "ses_a", incarnation: "i" },
  };
  for (const field of ["attempt", "session", "incarnation"]) {
    assert.notEqual(
      runIdentity(r),
      runIdentity({ ...r, exec: { ...r.exec, [field]: "replacement" } }),
    );
  }
});
