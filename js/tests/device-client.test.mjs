// Sign-in from another device (graph nks-dev: #6570, #6619): through which
// client the code is asked for, and what the answer tells the human of its
// code's end. Rauthy puts no resource in a device grant's audience, so only a
// client the operator set up with the mcp audience yields a token mcp accepts;
// registration is the fallback where the server knows no such client.

import assert from "node:assert/strict";
import { test } from "node:test";

import { grantLanded, INIT, linksIn, readStore, waitFor, withFake } from "./device-harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeIn = (answer) => {
  const links = linksIn(answer.error?.message);
  assert.ok(links.device, `the sign-in page with the code: ${answer.error?.message}`);
  return links.userCode;
};

test("the code is asked for through the named client, with no registration", async () => {
  await withFake(
    { device: { interval: 1, client: "iskron-bridge" } },
    async ({ fake, dir, bridge }) => {
      const code = codeIn(await bridge.call("initialize", 1, INIT));
      await fake.control({ device_approve: code });
      await grantLanded(dir);
      assert.deepEqual(fake.state.device.asked, [{ client_id: "iskron-bridge", answer: "code" }]);
      assert.equal(fake.state.counts.register, 0, "no dynamic registration");
      assert.equal(readStore(dir).tokens.client_id, "iskron-bridge", "the refresh presents it too");
    },
  );
});

test("ISKRON_BRIDGE_DEVICE_CLIENT names another client", async () => {
  await withFake(
    { device: { interval: 1, client: "operator-made" } },
    async ({ fake, bridge }) => {
      codeIn(await bridge.call("initialize", 1, INIT));
      assert.deepEqual(fake.state.device.asked, [{ client_id: "operator-made", answer: "code" }]);
      assert.equal(fake.state.counts.register, 0);
    },
    { ISKRON_BRIDGE_DEVICE_CLIENT: "operator-made" },
  );
});

test("the named client refused: a registered one is the fallback, and the login lands", async () => {
  await withFake({ device: { interval: 1 } }, async ({ fake, dir, bridge }) => {
    const code = codeIn(await bridge.call("initialize", 1, INIT));
    const [named, registered] = fake.state.device.asked;
    assert.deepEqual(named, { client_id: "iskron-bridge", answer: "invalid_client" });
    assert.equal(registered?.answer, "code");
    assert.equal(fake.state.counts.register, 1);
    await fake.control({ device_approve: code });
    await grantLanded(dir);
    assert.equal(readStore(dir).tokens.client_id, registered.client_id);
  });
});

test("the answer names the moment the code dies, in UTC", async () => {
  await withFake({ device: { interval: 1 } }, async ({ bridge }) => {
    const before = Date.now();
    const message = (await bridge.call("initialize", 1, INIT)).error?.message ?? "";
    const after = Date.now();
    const until = /valid until (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) UTC/.exec(message)?.[1];
    assert.ok(until, `no end of the code in: ${message}`);
    const end = Date.parse(`${until.replace(" ", "T")}Z`);
    assert.ok(end >= before + 299_000 && end <= after + 301_000, `${until} for a 300 s code`);
    assert.doesNotMatch(message, /about \d+ min/);
  });
});

test("a call that finds the code dead hands out a fresh one", async () => {
  await withFake({ device: { interval: 5, expiresIn: 1 } }, async ({ fake, bridge }) => {
    const first = codeIn(await bridge.call("initialize", 1, INIT));
    await sleep(1_500);
    const next = codeIn(await bridge.call("initialize", 2, INIT));
    assert.notEqual(next, first);
    assert.equal(next, fake.state.device.issued.at(-1));
  });
});

test("a call that finds under a minute left hands out a fresh code, and that one is polled", async () => {
  await withFake({ device: { interval: 1, expiresIn: 30 } }, async ({ fake, dir, bridge }) => {
    const first = codeIn(await bridge.call("initialize", 1, INIT));
    const next = codeIn(await bridge.call("initialize", 2, INIT));
    assert.notEqual(next, first, "a code with 30 s left is not handed out");
    const polls = fake.state.device.polls;
    await waitFor(() => polls.some((p) => p.user_code === next), "the fresh code to be polled");
    const from = polls.findIndex((p) => p.user_code === next);
    await fake.control({ device_approve: next });
    await grantLanded(dir);
    assert.ok(!polls.slice(from).some((p) => p.user_code === first), "the old code is dropped");
    assert.equal(fake.state.device.grants, 1);
  });
});
