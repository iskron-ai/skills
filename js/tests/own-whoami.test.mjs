// The bridge's own whoami (graph @nks/nks-dev, #9817; REALITY.md, the mind cache's row): the
// plugin asks `iskron/whoami` of its bridge on every rules read, and the bridge keeps the answer
// per the fingerprint of the token it presents at that moment. A personal token — one whoami
// per credential however often it is asked; a new login in the store under a live bridge (OAuth:
// the token is read on every request) — the next ask goes to the server again and names the new
// account. Real bridges on the fake NKS; ISKRON_BRIDGE_PATH — another copy.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

import { INIT, readStore, storeFile, withGrant } from "./grant-kit.mjs";
import { withFake } from "./lifeend-kit.mjs";

const whoamis = (fake) =>
  fake.state.calls.filter((c) => c.name === "iskron_me" && c.arguments?.action === "whoami");
const as = (who) => `Вызывающая идентичность: @${who} · handle @${who} (${who}@probe.example)`;

test("a personal token: the bridge asks the server whoami once, however often the plugin asks it", async () => {
  await withFake(async ({ fake, bridge }) => {
    const b = await bridge();
    for (let i = 0; i < 3; i++) {
      const got = await b.request("iskron/whoami", {});
      assert.equal(got.result?.handle, "tester", JSON.stringify(got));
    }
    assert.equal(whoamis(fake).length, 1, "one whoami for the credential");
  });
});

test("a new login in the store under a live bridge: the next whoami goes to the server and names the new account", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    const b = spawnBridge();
    assert.ok((await b.call("initialize", 1, INIT)).result, "the bridge is up");
    fake.state.whoami = as("alice");
    assert.equal((await b.call("iskron/whoami", 2)).result?.handle, "alice");
    assert.equal((await b.call("iskron/whoami", 3)).result?.handle, "alice", "kept");
    assert.equal(whoamis(fake).length, 1);
    // Bob signs in under the same grant directory: the store carries his access token now.
    const s = readStore(dir);
    s.tokens.access_token = "bob-access";
    s.tokens.expires_at = Date.now() + 3_600_000;
    writeFileSync(storeFile(dir), JSON.stringify(s));
    fake.state.access = "bob-access";
    fake.state.whoami = as("bob");
    assert.equal((await b.call("iskron/whoami", 4)).result?.handle, "bob", "the new account");
    assert.equal(whoamis(fake).length, 2, "asked anew for the new token");
  });
});
