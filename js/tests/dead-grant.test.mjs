// A dead grant is judged once on every path, and the login goes out at once
// (graph @nks/nks-dev, node #11291). Witnessed on a machine's daemon: the server
// refused the refresh with 404 NotFound "Refresh Token not found" at an endpoint
// discovery still named; the background knock judged it and published nothing,
// and for fifty minutes the next knocks read the same 404 as a moved endpoint
// whenever discovery flickered — the login went out only when a call happened to
// land between flickers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

import {
  ageRefusal,
  grantLog,
  INIT,
  linkIn,
  lock,
  pause,
  published,
  readStore,
  storeFile,
  waitFor,
  withGrant,
} from "./grant-kit.mjs";

const DEAD = {
  refreshStatus: 404,
  refreshError: "NotFound",
  refreshMessage: "Refresh Token not found",
};

test("a caller hears a dead grant once: one knock, one login at once, no rediscovery after", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    const knocks = fake.state.counts.refresh;
    const logins = published(dir);
    await fake.control({ ...DEAD, revoke_access: true });
    const b = spawnBridge();
    const url = linkIn((await b.call("initialize", 2, INIT)).error?.message);
    assert.ok(url, "the verdict must answer with the login");
    assert.equal(fake.state.counts.refresh - knocks, 1, "one knock judges the grant");

    // Discovery flickers and the stretch of the refusal has passed: the same 404
    // must not be read as a moved endpoint, and the grant is not knocked again.
    await fake.control({ discoveryStatus: 503 });
    ageRefusal(dir);
    const again = await b.call("tools/call", 3, { name: "nks_orient", arguments: {} });
    assert.equal(linkIn(again.error?.message), url, `the same login: ${again.error?.message}`);
    assert.equal(fake.state.counts.refresh - knocks, 1, "a dead grant is not knocked again");
    assert.doesNotMatch(grantLog(dir), /token endpoint is gone/);
    assert.equal(published(dir) - logins, 1, "one login");
  });
});

test("the background hears a dead grant once and publishes the login at once, without a call", async () => {
  const device = { interval: 1, client: "iskron-bridge" };
  await withGrant({ device }, async ({ fake, dir, spawnBridge }) => {
    const knocks = fake.state.counts.refresh;
    const logins = published(dir);
    await fake.control({ ...DEAD, revoke_access: true });
    spawnBridge(); // its keepalive knocks on startup: the store is expired
    await waitFor(() => !!lock(dir)?.authorize_url, "the background to publish the login");
    await waitFor(() => !!lock(dir)?.device, "the login's code from another device");
    assert.equal(fake.state.counts.refresh - knocks, 1, "one knock judges the grant");

    // Another background on the machine, after the stretch: nothing to knock.
    await fake.control({ discoveryStatus: 503 });
    ageRefusal(dir);
    spawnBridge();
    await pause(1500);
    assert.equal(fake.state.counts.refresh - knocks, 1, "no background knocks a dead grant");
    assert.doesNotMatch(grantLog(dir), /token endpoint is gone/);
    assert.equal(published(dir) - logins, 1, "one login");
  });
});

// A verdict heard before a restart: the machine's mark stands in the grant state,
// and no login is out — the process that judged it died before it published one.
const markDead = (dir) => {
  const print = createHash("sha256")
    .update(readStore(dir).tokens.refresh_token)
    .digest("base64url")
    .slice(0, 16);
  const path = storeFile(dir) + ".grant-state";
  writeFileSync(path, JSON.stringify({ dead_refresh: print, refused_at: Date.now() }));
};
const QUICK_TICK = { ISKRON_BRIDGE_KEEPALIVE_MS: "300" };

test("a grant judged dead before a restart: the background publishes its login at once, no knock", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    await fake.control({ ...DEAD, revoke_access: true });
    markDead(dir);
    const knocks = fake.state.counts.refresh;
    const logins = published(dir);
    spawnBridge(QUICK_TICK); // no call: only its keepalive
    await waitFor(() => !!lock(dir)?.authorize_url, "the login, without a call", 3000);
    await pause(1000); // ticks go on: the login went out once
    assert.equal(published(dir) - logins, 1, "one login");
    assert.equal(fake.state.counts.refresh - knocks, 0, "a dead grant is not knocked");
  });
});

test("a login the background could not publish is published on its next tick", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    await fake.control({ ...DEAD, revoke_access: true, discoveryStatus: 503 });
    markDead(dir);
    const s = readStore(dir);
    writeFileSync(storeFile(dir), JSON.stringify({ ...s, meta: null })); // discovery must be walked
    const logins = published(dir);
    spawnBridge(QUICK_TICK);
    await pause(1000);
    assert.equal(published(dir) - logins, 0, "nothing to publish with while discovery is down");
    await fake.control({ discoveryStatus: null });
    // The bridge writes the login's record, then its line in the grant log: both are the login.
    const out = () => !!lock(dir)?.authorize_url && published(dir) > logins;
    await waitFor(out, "the login, once discovery answers", 3000);
    assert.equal(published(dir) - logins, 1, "one login");
  });
});

test("an endpoint that moved is still rediscovered with the grant kept", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    await fake.control({ tokenPath: "/token-v2", revoke_access: true });
    const b = spawnBridge();
    const served = await b
      .call("initialize", 2, INIT)
      .then((a) => (a.result ? a : b.call("initialize", 3, INIT)));
    assert.ok(served.result, `the moved endpoint must serve: ${JSON.stringify(served.error)}`);
    assert.match(grantLog(dir), /token endpoint is gone/, "the move is read as a move");
    assert.equal(lock(dir), null, "and costs no login");
  });
});
