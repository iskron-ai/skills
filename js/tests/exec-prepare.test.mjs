import assert from "node:assert/strict";
import { hostname } from "node:os";
import { test } from "node:test";

import { prepareExec } from "../bridge/exec-prepare.ts";
import { readReceipt } from "../bridge/exec-receipt.ts";
import { receiptFixture } from "./exec-receipt-fixture.mjs";

function apiFor(f, fail) {
  const calls = [];
  const api = async (_server, method, path, body) => {
    calls.push({ method, path, phase: readReceipt(f.path).phase, body });
    if (fail === path && method === "post") throw new Error("uncertain");
    if (path === "/api/info") return { hostname: hostname(), version: "2.2.7" };
    if (path === "/api/session" || path === "/api/session/ses_fake")
      return {
        data: {
          id: "ses_fake",
          model: { ...f.row.exec.model, variant: "default" },
          location: { directory: f.row.worktree },
        },
      };
    if (path.endsWith("/context")) return { data: [] };
    if (path.endsWith("/prompt")) return { data: { id: "msg_fake", sessionID: "ses_fake" } };
    throw new Error("unexpected api");
  };
  return { api, calls };
}
for (const failure of ["/api/session", "/api/session/ses_fake/prompt"]) {
  test(`unknown ${failure} is durably ambiguous and cannot be retried`, async (t) => {
    const f = receiptFixture(t),
      { api, calls } = apiFor(f, failure);
    await assert.rejects(prepareExec(f.path, api));
    assert.equal(readReceipt(f.path).phase, "ambiguity");
    const count = calls.length;
    await assert.rejects(prepareExec(f.path, api));
    assert.equal(calls.length, count);
    assert.equal(
      calls.find((c) => c.path === failure && c.method === "post").phase,
      failure === "/api/session" ? "create-sent" : "prompt-sent",
    );
  });
}
test("concurrent helpers share no create: exclusive durable claim fences the second", async (t) => {
  const f = receiptFixture(t),
    { api, calls } = apiFor(f);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const first = prepareExec(f.path, async (...args) => {
    if (args[2] === "/api/info") await gate;
    return api(...args);
  });
  await assert.rejects(prepareExec(f.path, api));
  release();
  assert.deepEqual(await first, [
    "opencode",
    "--server",
    f.row.exec.server,
    "--session",
    "ses_fake",
    f.row.worktree,
  ]);
  assert.equal(calls.filter((c) => c.path === "/api/session" && c.method === "post").length, 1);
  assert.equal(readReceipt(f.path).phase, "ready");
  await assert.rejects(prepareExec(f.path, api));
});
