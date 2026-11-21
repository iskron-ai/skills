// A refresh whose answer was lost is presented again at once (graph @nks/nks-dev,
// node #11292): the server rotated the grant and the connection broke before its
// answer came back, so the new pair exists nowhere and the old refresh token
// lives only within the server's grace for it. The fake's grace stands for
// Rauthy's REFRESH_TOKEN_GRACE_TIME at a tenth of the time: 3 s for 30 s, and the
// link returns at 1 s or at 7 s. ISKRON_BRIDGE_PATH points the suite at a past build.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { test } from "node:test";

import {
  grantLog,
  INIT,
  lock,
  published,
  readStore,
  storeFile,
  waitFor,
  withGrant,
} from "./grant-kit.mjs";

const QUICK = { ISKRON_BRIDGE_LOST_RETRY_MS: "200" };
const lostAnswer = (downMs) => ({
  refreshGraceMs: 3000,
  refreshDropNext: 1,
  tokenDownMs: downMs,
  revoke_access: true,
});
// A port nobody listens on any more: a connection there is refused before anything is sent.
const freePort = () =>
  new Promise((resolve) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const grantState = (dir) => {
  try {
    return JSON.parse(readFileSync(storeFile(dir) + ".grant-state", "utf8"));
  } catch {
    return {};
  }
};

test("the link back within the server's grace: the same refresh again, the grant alive, no login", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    const before = readStore(dir).tokens.refresh_token;
    const logins = published(dir);
    await fake.control(lostAnswer(1000));
    spawnBridge(QUICK); // its keepalive knocks on startup: the store is expired
    await waitFor(
      () => readStore(dir).tokens.refresh_token !== before,
      "the grant to come back through the lost rotation",
      6000,
    );
    assert.equal(fake.state.counts.refresh_dropped, 1, "the rotation's answer was lost once");
    assert.equal(
      fake.state.counts.grace_reuse,
      1,
      "the old refresh presented again, once, in time",
    );
    assert.equal(fake.state.counts.grace_refused ?? 0, 0, "and never refused");
    assert.equal(published(dir) - logins, 0, "no login");
    assert.equal(grantState(dir).lost_refresh, undefined, "the outcome is known now");
    assert.match(grantLog(dir), /refresh answer lost/);
  });
});

test("the link back past the server's grace: one login at once, no rediscovery", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    const logins = published(dir);
    await fake.control(lostAnswer(7000));
    spawnBridge(QUICK);
    await waitFor(() => !!lock(dir)?.authorize_url, "the login, as the link comes back", 12_000);
    assert.equal(
      fake.state.counts.grace_refused,
      1,
      "the old refresh refused once, past its grace",
    );
    assert.equal(published(dir) - logins, 1, "one login");
    assert.doesNotMatch(grantLog(dir), /token endpoint is gone/);
  });
});

test("a 200 whose body was cut is a lost answer: nothing stored, the same refresh again, the grant alive", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    const before = readStore(dir).tokens.refresh_token;
    const logins = published(dir);
    await fake.control({ refreshGraceMs: 3000, refreshCutNext: 1, revoke_access: true });
    spawnBridge(QUICK);
    let emptied = false; // a store holding a grant with no access token in it
    await waitFor(
      () => {
        const t = readStore(dir).tokens;
        if (t?.refresh_token && !t.access_token) emptied = true;
        return t?.refresh_token !== before;
      },
      "the grant to come back through the cut answer",
      6000,
    );
    assert.equal(fake.state.counts.refresh_cut, 1, "the rotation's body was cut once");
    assert.equal(fake.state.counts.grace_reuse, 1, "the old refresh presented again, in time");
    assert.equal(emptied, false, "nothing stored from the cut answer");
    assert.ok(readStore(dir).tokens.access_token, "the grant in hand carries its access token");
    assert.equal(published(dir) - logins, 0, "no login");
    assert.equal(grantState(dir).lost_refresh, undefined, "the outcome is known now");
    assert.match(grantLog(dir), /refresh answer lost/);
  });
});

test("a refresh refused before it went out is not a lost answer", async () => {
  await withGrant({}, async ({ fake, dir, spawnBridge }) => {
    const s = readStore(dir);
    s.meta.as.token_endpoint = `http://127.0.0.1:${await freePort()}/token`; // refused at connect
    writeFileSync(storeFile(dir), JSON.stringify(s));
    await fake.control({ revoke_access: true });
    const b = spawnBridge(QUICK);
    const served = await b
      .call("initialize", 2, INIT)
      .then((a) => (a.result ? a : b.call("initialize", 3, INIT)));
    assert.ok(served.result, `rediscovered and served: ${JSON.stringify(served.error)}`);
    assert.match(
      grantLog(dir),
      /token endpoint is gone/,
      "as before: discovery dropped, grant kept",
    );
    assert.doesNotMatch(grantLog(dir), /refresh answer lost/);
    assert.equal(fake.state.counts.grace_reuse ?? 0, 0);
  });
});
