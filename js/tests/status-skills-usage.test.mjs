import assert from "node:assert/strict";
import { test } from "node:test";

import { rpc, status } from "./status-kit.mjs";
import { registers, skillsDaemon, wait } from "./status-skills-kit.mjs";

test("changed installed skills ride the next usage register without connect or changed usage", async () => {
  await skillsDaemon("pi-iskron", async ({ dir, fake, link, change }) => {
    const usage = { tokens: 100, context: 10, window: 100 };
    assert.equal((await rpc(link, "iskron/usage", usage, 3)).result.pushed, true);
    const before = registers(fake).at(-1).attrs.skills;
    const connects = fake.state.counts.connect;
    const registered = registers(fake).length;
    change("after");
    assert.equal(
      (await rpc(link, "iskron/usage", usage, 4)).result.pushed,
      false,
      "cooldown still holds",
    );
    await wait();
    assert.equal(
      (await rpc(link, "iskron/usage", usage, 5)).result.pushed,
      true,
      "changed skills trigger the register even with identical usage",
    );
    const after = registers(fake).at(-1).attrs.skills;
    assert.notEqual(after.stamp, before.stamp);
    assert.equal(registers(fake).length, registered + 1);
    assert.equal(fake.state.counts.connect, connects);
    const snapshot = JSON.parse(status(dir, ["--json"]).stdout);
    assert.deepEqual(snapshot.sessions[0].skills, after);
    assert.match(
      status(dir).stdout,
      new RegExp(`skills=iskron-ai/skills 7\\.9\\.0\\+${after.stamp}`),
    );
    await wait();
    assert.equal(
      (await rpc(link, "iskron/usage", usage, 6)).result.pushed,
      false,
      "unchanged stamp and usage do not repeat register",
    );
  });
});
