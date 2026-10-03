// Sign-in from another device (graph nks-dev: #6570, #6619): through which
// client the code is asked for, and what the answer tells the human of its
// code's end. Rauthy puts no resource in a device grant's audience, so only a
// client the operator set up with the mcp audience yields a token mcp accepts;
// where the server knows no such client, no code is offered — registration
// only by the operator's switch.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  grantLanded,
  INIT,
  killAll,
  linksIn,
  readStore,
  startBridge,
  waitFor,
  withFake,
} from "./device-harness.mjs";

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

// The client the human named is refused: no other one stands in for it, the
// word names it and where it was set — the default and a registration only
// stand in when nothing was named.
for (const [why, env] of [
  ["", {}],
  [" even with ISKRON_BRIDGE_DEVICE_REGISTER=1", { ISKRON_BRIDGE_DEVICE_REGISTER: "1" }],
]) {
  test(`ISKRON_BRIDGE_DEVICE_CLIENT refused: no code, no stand-in, the word names it${why}`, async () => {
    await withFake(
      { device: { interval: 1, client: "iskron-bridge" } },
      async ({ fake, bridge }) => {
        const message = (await bridge.call("initialize", 1, INIT)).error?.message ?? "";
        assert.equal(linksIn(message).device, null, `no sign-in page with a code: ${message}`);
        assert.match(message, /operator-made/);
        assert.match(message, /ISKRON_BRIDGE_DEVICE_CLIENT/);
        assert.match(message, /invalid_client/);
        assert.deepEqual(fake.state.device.asked, [
          { client_id: "operator-made", answer: "invalid_client" },
        ]);
        assert.equal(fake.state.counts.register, 0, "no dynamic registration");
      },
      { ISKRON_BRIDGE_DEVICE_CLIENT: "operator-made", ...env },
    );
  });
}

// A login taken over from a bridge gone holds a dead code through the client
// of the past login; refused, the client the human named is asked next — a
// registration never stands in for it.
test("the past login's client refused on takeover: the named client is asked, not a registration", async () => {
  await withFake(
    { device: { interval: 1, expiresIn: 1, client: "iskron-bridge" } },
    async ({ fake, dir, bridge }) => {
      codeIn(await bridge.call("initialize", 1, INIT));
      await killAll(dir);
      await sleep(1_500);
      fake.state.device.client = "operator-made";
      const next = startBridge(fake.mcpUrl, dir, {
        ISKRON_BRIDGE_DEVICE_CLIENT: "operator-made",
        ISKRON_BRIDGE_DEVICE_REGISTER: "1",
      });
      try {
        codeIn(await next.call("initialize", 1, INIT));
        assert.deepEqual(fake.state.device.asked.slice(1), [
          { client_id: "iskron-bridge", answer: "invalid_client" },
          { client_id: "operator-made", answer: "code" },
        ]);
        assert.equal(fake.state.counts.register, 0, "no dynamic registration");
      } finally {
        await next.stop();
      }
    },
  );
});

// A refusal with no OAuth word to read is said, not asked again on a pause.
test("a code request refused 401 with no body: no code, the word names the status, not asked again", async () => {
  await withFake(
    { device: { interval: 1, bare: 401 } },
    async ({ fake, bridge }) => {
      const message = (await bridge.call("initialize", 1, INIT)).error?.message ?? "";
      assert.equal(linksIn(message).device, null, `no sign-in page with a code: ${message}`);
      assert.match(message, /401/);
      assert.match(message, /iskron-bridge/);
      await sleep(1_500);
      assert.deepEqual(fake.state.device.asked, [{ client_id: "iskron-bridge", answer: 401 }]);
    },
    { ISKRON_BRIDGE_DEVICE_REISSUE_MS: "300" },
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
