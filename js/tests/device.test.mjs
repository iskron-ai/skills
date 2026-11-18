// Sign-in from another device (RFC 8628; graph nks-dev: #6570): on a machine
// without a browser the loopback link opens nowhere, so the same login is also
// offered as the sign-in server's page with a code. Black box, as in
// bridge.test.mjs: what a harness reads, what the fake server saw, the store.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  grantLanded,
  INIT,
  linksIn,
  portListening,
  readStore,
  waitFor,
  withFake,
} from "./device-harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const offered = (answer) => {
  const links = linksIn(answer.error?.message);
  assert.ok(links.local, `the local link stays: ${JSON.stringify(answer)}`);
  assert.ok(
    links.device,
    `the sign-in page with the code must ride beside the local link: ${answer.error?.message}`,
  );
  return links;
};

test("the login is offered from another device too: approved there, the grant lands and tools answer", async () => {
  await withFake(
    { device: { interval: 1, client: "iskron-bridge" } },
    async ({ fake, dir, bridge }) => {
      const links = offered(await bridge.call("initialize", 1, INIT));
      assert.match(bridge.stderr, /another device: \S+device-page\?code=/, "stderr names it too");
      const again = linksIn((await bridge.call("initialize", 2, INIT)).error?.message);
      assert.equal(
        again.userCode,
        links.userCode,
        "one login: the next call hands out the same code",
      );
      await fake.control({ device_approve: links.userCode });
      await grantLanded(dir);
      assert.ok((await bridge.call("initialize", 3, INIT)).result, "the handshake goes through");
      assert.ok((await bridge.call("tools/list", 4)).result?.tools?.length, "the tools answer");
      assert.equal(fake.state.device.grants, 1);
      assert.equal(fake.state.counts.code_exchange, 0, "no loopback exchange beside it");
      assert.equal(fake.state.device.tooFast, 0, "no poll came before its interval");
      assert.ok(readStore(dir).tokens.refresh_token, "the grant is kept for the next process");
      const port = Number(new URL(links.local).port);
      await waitFor(async () => !(await portListening(port)), "the loopback side to close with it");
    },
  );
});

// The field (RU, Rauthy): a published login nobody came to polled the token
// endpoint every interval and took a new code by itself at each expiry, all night.
test("a code dead with nobody to call: the poll stops and asks for no new code", async () => {
  await withFake(
    { device: { interval: 1, expiresIn: 2, client: "iskron-bridge" } },
    async ({ fake, dir, bridge }) => {
      const first = offered(await bridge.call("initialize", 1, INIT));
      const dev = fake.state.device;
      await waitFor(() => dev.polls.length >= 1, "the first poll");
      const end = [...dev.codes.values()][0].expires_at;
      await sleep(end - Date.now() + 4_000); // past the code's end, then four intervals more
      const late = dev.polls.filter((p) => p.at >= end);
      assert.deepEqual(late, [], "no poll of the token endpoint once the code is dead");
      assert.deepEqual(dev.issued, [first.userCode], "no code issued without a caller");
      const res = await fetch(first.local, { redirect: "follow" });
      assert.equal(res.status, 200, "the local link of the same login still waits");
      await res.text();
      await grantLanded(dir);
      assert.ok((await bridge.call("tools/list", 2)).result?.tools?.length);
    },
  );
});

test("a caller after the code's end gets one new code, and the poll goes on with it", async () => {
  await withFake(
    { device: { interval: 1, client: "iskron-bridge" } },
    async ({ fake, dir, bridge }) => {
      const first = offered(await bridge.call("initialize", 1, INIT));
      const dev = fake.state.device;
      await fake.control({ device_expire: true });
      await waitFor(
        () => dev.polls.some((p) => p.answer === "expired_token"),
        "the server to refuse the code",
      );
      const refused = dev.polls.length;
      await sleep(3_000);
      assert.equal(dev.polls.length, refused, "no poll after the refusal, while nobody calls");
      assert.equal(dev.issued.length, 1, "no new code while nobody calls");
      const next = linksIn((await bridge.call("initialize", 2, INIT)).error?.message);
      assert.notEqual(next.userCode, first.userCode, "the caller hands out a new code");
      assert.deepEqual(dev.issued, [first.userCode, next.userCode], "exactly one new code");
      await waitFor(
        () => dev.polls.slice(refused).some((p) => p.user_code === next.userCode),
        "the poll to go on with the new code",
      );
      await fake.control({ device_approve: next.userCode });
      await grantLanded(dir);
      assert.ok((await bridge.call("tools/list", 3)).result?.tools?.length);
      assert.equal(dev.issued.length, 2);
    },
  );
});

test("slow_down widens the pace for good, and no poll comes early", async () => {
  const step = 600;
  await withFake(
    { device: { interval: 1, client: "iskron-bridge" } },
    async ({ fake, bridge }) => {
      offered(await bridge.call("initialize", 1, INIT));
      await waitFor(() => fake.state.device.polls.length >= 1, "the first poll");
      await fake.control({ device_slow_down: 1 });
      const polls = fake.state.device.polls;
      const slowed = () => polls.findIndex((p) => p.answer === "slow_down");
      await waitFor(
        () => slowed() >= 0 && polls.length >= slowed() + 3,
        "two polls after slow_down",
      );
      const i = slowed();
      for (const k of [i + 1, i + 2]) {
        const gap = polls[k].at - polls[k - 1].at;
        assert.ok(gap >= 1000 + step - 50, `poll ${k} came ${gap}ms after the one before it`);
      }
      assert.equal(fake.state.device.tooFast, 0, "no poll came before its interval");
    },
    { ISKRON_BRIDGE_DEVICE_SLOW_DOWN_MS: String(step) },
  );
});

test("a login landed through the local link first stops the device side quietly", async () => {
  await withFake(
    { device: { interval: 1, client: "iskron-bridge" } },
    async ({ fake, dir, bridge }) => {
      const links = offered(await bridge.call("initialize", 1, INIT));
      const res = await fetch(links.local, { redirect: "follow" });
      assert.equal(res.status, 200);
      await res.text();
      await grantLanded(dir);
      const polled = fake.state.device.polls.length;
      await fake.control({ device_approve: links.userCode });
      await sleep(2_500);
      assert.equal(fake.state.device.polls.length, polled, "no device poll after the login landed");
      assert.equal(fake.state.device.grants, 0, "the device side stored nothing");
      assert.equal(fake.state.counts.code_exchange, 1);
      assert.ok((await bridge.call("tools/list", 2)).result?.tools?.length);
    },
  );
});

test("a server without the device grant: only the local link, as before", async () => {
  await withFake({}, async ({ bridge }) => {
    const answer = await bridge.call("initialize", 1, INIT);
    const links = linksIn(answer.error?.message);
    assert.ok(links.local, JSON.stringify(answer));
    assert.equal(links.device, null);
    assert.doesNotMatch(answer.error.message, /another device/);
    assert.doesNotMatch(bridge.stderr, /another device/);
  });
});
