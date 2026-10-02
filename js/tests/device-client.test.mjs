// Sign-in from another device (graph nks-dev: #6570, #6619): through which
// client the code is asked for, and what the answer tells the human of its
// code's end. Rauthy puts no resource in a device grant's audience, so only a
// client the operator set up with the mcp audience yields a token mcp accepts;
// where the server knows no such client, no code is offered — registration
// only by the operator's switch.

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

// A registered client has no default audience: its grant is refused by mcp,
// and nothing but wiping the store undoes it. So no code, and the word why.
test("no named client on the server: no code, the word names the operator's move, the local link stays", async () => {
  await withFake({ device: { interval: 1 } }, async ({ fake, bridge }) => {
    const message = (await bridge.call("initialize", 1, INIT)).error?.message ?? "";
    const links = linksIn(message);
    assert.ok(links.local, `the local link stays: ${message}`);
    assert.equal(links.device, null, "no sign-in page with a code");
    assert.match(message, /вход по коду на этом сервере не настроен: нет клиента iskron-bridge/);
    assert.match(message, /ход оператора сервера авторизации/);
    assert.match(message, /personal access token/, "the token stays offered");
    assert.equal(fake.state.counts.register, 0, "no dynamic registration");
    assert.deepEqual(fake.state.device.asked, [
      { client_id: "iskron-bridge", answer: "invalid_client" },
    ]);
    const again = (await bridge.call("initialize", 2, INIT)).error?.message ?? "";
    assert.match(again, /нет клиента iskron-bridge/, "a joining call names it too");
    await sleep(1_500);
    assert.equal(fake.state.device.asked.length, 1, "the server is not asked again");
  });
});

test("ISKRON_BRIDGE_DEVICE_REGISTER=1: the named client refused, a registered one carries the code", async () => {
  await withFake(
    { device: { interval: 1 } },
    async ({ fake, dir, bridge }) => {
      const code = codeIn(await bridge.call("initialize", 1, INIT));
      const [named, registered] = fake.state.device.asked;
      assert.deepEqual(named, { client_id: "iskron-bridge", answer: "invalid_client" });
      assert.equal(registered?.answer, "code");
      assert.equal(fake.state.counts.register, 1);
      await fake.control({ device_approve: code });
      await grantLanded(dir);
      assert.equal(readStore(dir).tokens.client_id, registered.client_id);
    },
    { ISKRON_BRIDGE_DEVICE_REGISTER: "1" },
  );
});

test("the answer names the moment the code dies, in UTC", async () => {
  await withFake({ device: { interval: 1, client: "iskron-bridge" } }, async ({ bridge }) => {
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
  const device = { interval: 5, expiresIn: 1, client: "iskron-bridge" };
  await withFake({ device }, async ({ fake, bridge }) => {
    const first = codeIn(await bridge.call("initialize", 1, INIT));
    await sleep(1_500);
    const next = codeIn(await bridge.call("initialize", 2, INIT));
    assert.notEqual(next, first);
    assert.equal(next, fake.state.device.issued.at(-1));
  });
});

test("a call that finds under a minute left hands out a fresh code, and that one is polled", async () => {
  const device = { interval: 1, expiresIn: 30, client: "iskron-bridge" };
  await withFake({ device }, async ({ fake, dir, bridge }) => {
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
