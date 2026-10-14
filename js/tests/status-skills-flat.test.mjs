import assert from "node:assert/strict";
import { test } from "node:test";

import { rpc, status } from "./status-kit.mjs";
import { registers, settled, skillsDaemon, wait } from "./status-skills-kit.mjs";

for (const inspectDrift of [false, true])
  test(`Claude Code flat install refreshes skills without usage; inspect drift=${inspectDrift}`, async () => {
    await skillsDaemon("claude-code", async ({ dir, fake, link, change }) => {
      const snapshot = () => JSON.parse(status(dir, ["--json"]).stdout).sessions[0];
      const look = (id) =>
        rpc(
          link,
          "tools/call",
          { name: "iskron_look", arguments: { realm: "nks-dev", node_id: "1" } },
          id,
        );
      const before = registers(fake).at(-1).attrs.skills;
      const beside = await rpc(
        link,
        "tools/call",
        { name: "iskron_stand", arguments: { realm: "@nks/other", karta: 931, name: "cc-beside" } },
        20,
      );
      assert.ok(!beside.result?.isError, JSON.stringify(beside));
      await wait(50);
      const connects = fake.state.counts.connect;
      let count = registers(fake).length;
      change("after");
      if (inspectDrift) {
        const drift = snapshot();
        assert.deepEqual(
          drift.skills,
          before,
          "status reports accepted declaration, not fresh disk",
        );
        assert.notEqual(drift.installed_skills.stamp, before.stamp);
        assert.equal(drift.skills_mismatch, true);
      }
      await wait();
      await look(3);
      await settled(fake, count + 2);
      const after = registers(fake).at(-1).attrs.skills;
      assert.notEqual(after.stamp, before.stamp, "non-hosted flat install refreshes without usage");
      assert.equal(fake.state.counts.connect, connects);
      const fresh = snapshot();
      assert.deepEqual(fresh.skills, after);
      assert.deepEqual(fresh.installed_skills, after);
      assert.equal(fresh.skills_mismatch, false);
      assert.equal(fresh.places.length, 2);
      for (const place of fresh.places) {
        assert.deepEqual(place.skills, after);
        assert.equal(place.skills_mismatch, false);
      }
      count = registers(fake).length;
      await wait();
      await look(4);
      await wait(100);
      assert.equal(registers(fake).length, count, "unchanged disk does not register again");
      if (inspectDrift) {
        change("third");
        fake.state.standingRefuseNext = 1;
        await wait();
        await look(5);
        await settled(fake, count + 1);
        const partial = snapshot();
        assert.deepEqual(partial.skills, after, "refused register leaves declaration intact");
        assert.equal(partial.skills_mismatch, true);
        assert.equal(partial.places.find((p) => !p.primary).skills_mismatch, false);
        count = registers(fake).length;
        await wait();
        await look(6);
        await settled(fake, count + 1);
        assert.equal(
          snapshot().skills_mismatch,
          false,
          "unchanged disk retries a refused register",
        );
      }
    });
  });
