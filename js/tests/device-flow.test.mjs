// Sign-in from another device (graph nks-dev: #6570, #6619), the rest of its
// life: refused on the other device, taken over by another bridge, the
// resource the grant asks for, and the refresh of a grant born of a code.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  grantLanded,
  INIT,
  linksIn,
  readStore,
  reap,
  startBridge,
  waitFor,
  withFake,
} from "./device-harness.mjs";
import { startFakeNks } from "./fake-nks.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeIn = (answer) => {
  const links = linksIn(answer.error?.message);
  assert.ok(links.device, `the sign-in page with the code: ${answer.error?.message}`);
  return links.userCode;
};
const NAMED = { interval: 1, client: "iskron-bridge" };

test("refused on the other device: polling stops, and the next call offers a new login", async () => {
  await withFake({ device: NAMED }, async ({ fake, bridge }) => {
    const first = codeIn(await bridge.call("initialize", 1, INIT));
    await fake.control({ device_deny: first });
    const polls = fake.state.device.polls;
    await waitFor(() => polls.some((p) => p.answer === "access_denied"), "the refusal");
    const seen = polls.length;
    await sleep(2_500);
    assert.equal(polls.length, seen, "no poll after the refusal");
    assert.match(bridge.stderr, /refused on the other device/);
    const next = codeIn(await bridge.call("initialize", 2, INIT));
    assert.notEqual(next, first, "a new login, a new code");
    assert.equal(fake.state.device.grants, 0);
  });
});

// Two full bridges, no daemon: the login lives in the first one's process, and
// only its death hands it to the second — a daemon would hold it for both.
test("a login taken over from a bridge gone keeps its code, and the code still lands", async () => {
  const fake = await startFakeNks({ device: NAMED });
  const dir = mkdtempSync(join(tmpdir(), "iskron-device-test-"));
  const full = { ISKRON_BRIDGE_DAEMON: "0" };
  const first = startBridge(fake.mcpUrl, dir, full);
  const second = startBridge(fake.mcpUrl, dir, full);
  try {
    const code = codeIn(await first.call("initialize", 1, INIT));
    await first.stop();
    const again = codeIn(await second.call("initialize", 1, INIT));
    assert.equal(again, code, "the human's code stays good");
    assert.equal(fake.state.device.issued.length, 1, "no second code");
    await fake.control({ device_approve: code });
    await grantLanded(dir);
    assert.ok((await second.call("tools/list", 2)).result?.tools?.length);
  } finally {
    await first.stop();
    await second.stop();
    await reap(dir);
    await fake.stop();
  }
});

// Live 06.10: a bridge polling for a code did not go on SIGTERM — it sat out
// the wait for a click on a link nobody had opened, and only kill -9 took it.
// The code lives in the login's record, so leaving loses nothing.
for (const [how, stopIt] of [
  ["SIGTERM", (p) => p.kill("SIGTERM")],
  ["SIGINT", (p) => p.kill("SIGINT")],
  ["stdin closed", (p) => p.stdin.end()],
]) {
  test(`a bridge waiting for a code leaves within a second on ${how}, and the next one keeps the code`, async () => {
    const fake = await startFakeNks({ device: NAMED });
    const dir = mkdtempSync(join(tmpdir(), "iskron-device-test-"));
    const full = { ISKRON_BRIDGE_DAEMON: "0" };
    const first = startBridge(fake.mcpUrl, dir, full);
    let second;
    try {
      const code = codeIn(await first.call("initialize", 1, INIT));
      await waitFor(() => fake.state.device.polls.length >= 1, "the code to be polled");
      const gone = new Promise((r) => first.proc.once("exit", r));
      const at = Date.now();
      stopIt(first.proc);
      await Promise.race([gone, sleep(3_000)]);
      const took = Date.now() - at;
      assert.notEqual(first.proc.exitCode ?? first.proc.signalCode, null, `still up after ${how}`);
      assert.ok(took <= 1_000, `left ${took} ms after ${how}`);
      second = startBridge(fake.mcpUrl, dir, full);
      assert.equal(codeIn(await second.call("initialize", 1, INIT)), code, "the code stays good");
      assert.equal(fake.state.device.issued.length, 1, "no second code");
    } finally {
      await first.stop();
      await second?.stop();
      await reap(dir);
      await fake.stop();
    }
  });
}

test("the device poll asks for the resource the loopback login asks for", async () => {
  await withFake({ device: NAMED }, async ({ fake, dir, bridge }) => {
    await fake.control({ device_approve: codeIn(await bridge.call("initialize", 1, INIT)) });
    await grantLanded(dir);
    assert.equal(fake.state.resources.device, fake.mcpUrl, "the resource the server publishes");
  });
});

test("a grant born of a code refreshes through the device client, with the overridden resource", async () => {
  const resource = "https://mcp.example/";
  await withFake(
    { device: NAMED },
    async ({ fake, dir, bridge }) => {
      await fake.control({ device_approve: codeIn(await bridge.call("initialize", 1, INIT)) });
      await grantLanded(dir);
      assert.equal(fake.state.resources.device, resource, "ISKRON_BRIDGE_RESOURCE in the poll");
      await fake.control({ revoke_access: true });
      assert.ok((await bridge.call("tools/list", 2)).result?.tools?.length, "tools after refresh");
      assert.equal(fake.state.counts.refresh, 1);
      assert.equal(fake.state.refreshClientId, "iskron-bridge");
      assert.equal(fake.state.resources.refresh, resource);
      assert.equal(readStore(dir).tokens.client_id, "iskron-bridge");
    },
    { ISKRON_BRIDGE_RESOURCE: resource },
  );
});

// Rauthy mints a grant by code with the client's default audience, whatever
// resource was asked for (#6619): a token refused twice names that client and
// its operator, not a resource lever that does not reach this grant.
test("a grant by code refused twice: the client's audience is named, not ISKRON_BRIDGE_RESOURCE", async () => {
  await withFake({ device: NAMED }, async ({ fake, dir, bridge }) => {
    await fake.control({ device_approve: codeIn(await bridge.call("initialize", 1, INIT)) });
    await grantLanded(dir);
    await fake.control({ mcpStatus: 401 });
    const message = (await bridge.call("tools/list", 2)).error?.message ?? "";
    assert.match(message, /client iskron-bridge/, message);
    assert.match(message, /default audience on the sign-in server/);
    assert.ok(message.includes(fake.mcpUrl), "the address the audience must be");
    assert.doesNotMatch(message, /operator lever: ISKRON_BRIDGE_RESOURCE/);
  });
});
