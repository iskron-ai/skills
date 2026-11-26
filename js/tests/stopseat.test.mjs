// The deferred end of a lead subagent by its own socket's token (graph @nks/nks-dev, nodes #7621,
// #7505): a satellite writes its socket address beside the grant at its hold; the launcher's
// bridge, asked `iskron/stopseat {key}`, stops by that token — it ends only seats that socket
// still holds, so a holder who re-took the name meanwhile keeps its seat. No record — nothing is
// stopped. Real thin bridges through a real daemon on the fake NKS; ISKRON_BRIDGE_PATH — another
// copy (an older one revokes by name and knows no stopseat).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { closed, journalOf, withFake } from "./lifeend-kit.mjs";

const CALLER = "host.repo.opus-5";
const NAME = `${CALLER}.sub-1`;

/** A satellite stood and paused (a plugin reload: its seat waits), its bridge gone; its stop record. */
async function pausedSatellite(fake, dir, bridge) {
  await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
  const s = await bridge(dir, ["--satellite"]);
  const r = await s.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` },
  });
  assert.ok(!r.result?.isError, JSON.stringify(r));
  const stops = readdirSync(join(dir, "standings")).filter((f) => f.endsWith(".stop"));
  assert.equal(stops.length, 1, `the satellite wrote its stop record:\n${journalOf(dir)}`);
  const rec = JSON.parse(readFileSync(join(dir, "standings", stops[0]), "utf8"));
  assert.match(rec.url, /\/channel\/ws\//, "the record carries the socket address");
  assert.equal((await s.request("iskron/suspend")).result?.suspended, true);
  s.proc.stdin.end();
  await s.gone();
  assert.ok(!closed(fake, NAME), "the paused seat waits");
  return rec.key;
}

test("the child's name re-taken by another holder before the deferred end: the other's seat stays", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const key = await pausedSatellite(fake, dir, bridge);
    const launcher = await bridge();
    fake.state.takeInWindow = `931:${NAME}`; // another holder takes the name right before the stop
    const got = await launcher.request("iskron/stopseat", { key });
    assert.equal(got.result?.how, "moved", JSON.stringify(got));
    assert.ok(!closed(fake, NAME), "the other holder's seat is not ended");
    const revokes = fake.state.calls.filter(
      (c) => c.name === "iskron_channel" && c.arguments?.action === "revoke",
    );
    assert.deepEqual(revokes, [], "no revoke by name");
  });
});

test("the plain deferred end: the child's own socket's token ends its seat", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const key = await pausedSatellite(fake, dir, bridge);
    const launcher = await bridge();
    const got = await launcher.request("iskron/stopseat", { key });
    assert.equal(got.result?.how, "stopped", JSON.stringify(got));
    assert.ok(closed(fake, NAME), "the child's seat is ended");
  });
});

test("no stop record for the key: nothing stopped, nothing revoked", async () => {
  await withFake(async ({ fake, bridge }) => {
    const launcher = await bridge();
    const before = fake.state.counts.stops;
    const got = await launcher.request("iskron/stopseat", { key: "nobody--931--_nks_nks-dev" });
    assert.equal(got.result?.how, "none", JSON.stringify(got));
    assert.equal(fake.state.counts.stops, before, "no stop request");
  });
});
