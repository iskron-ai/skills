// The deferred end of a lead subagent by its own socket's token (graph @nks/nks-dev, nodes #7621,
// #7505): a satellite writes its socket address beside the grant at its hold, with that hold's
// incarnation; the launcher's bridge, asked `iskron/stopseat {key, incarnation}`, stops by that
// token only if the record is still of that incarnation — the seat key is reused by the next
// satellite of the same name, the incarnation never — and the stop ends only seats that socket
// still holds, so a holder who re-took the name meanwhile keeps its seat. No record, or no
// incarnation asked — nothing is stopped. A satellite that ends by itself drops its record.
// Real thin bridges through a real daemon on the fake NKS; ISKRON_BRIDGE_PATH — another copy (an
// older one keys the record by the seat key alone, or knows no stopseat).
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { closed, journalOf, withFake } from "./lifeend-kit.mjs";

const CALLER = "host.repo.opus-5";
const NAME = `${CALLER}.sub-1`;

const stopFiles = (dir) =>
  readdirSync(join(dir, "standings"))
    .filter((f) => f.endsWith(".stop"))
    .map((f) => join(dir, "standings", f));

/** A satellite stood; its stop record (path and content). */
async function stoodSatellite(fake, dir, bridge) {
  await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
  const s = await bridge(dir, ["--satellite"]);
  const r = await s.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` },
  });
  assert.ok(!r.result?.isError, JSON.stringify(r));
  const files = stopFiles(dir);
  assert.equal(files.length, 1, `the satellite wrote its stop record:\n${journalOf(dir)}`);
  const rec = JSON.parse(readFileSync(files[0], "utf8"));
  assert.match(rec.url, /\/channel\/ws\//, "the record carries the socket address");
  return { s, path: files[0], rec };
}

/** A satellite stood and paused (a plugin reload: its seat waits), its bridge gone. */
async function pausedSatellite(fake, dir, bridge) {
  const { s, path, rec } = await stoodSatellite(fake, dir, bridge);
  assert.equal((await s.request("iskron/suspend")).result?.suspended, true);
  s.proc.stdin.end();
  await s.gone();
  assert.ok(!closed(fake, NAME), "the paused seat waits");
  return { path, rec };
}

// The reviewer's scene (№5817 [567]): the old child's stop is prepared; a newer satellite of the
// same seat key writes its own record over it — its live socket, its incarnation; the old stop
// then runs: another incarnation — moved, no POST, the newer record intact, its seat lives.
test("a newer holder of the same seat key rewrote the record: the old child's stop is moved — no POST, the new record stays", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const { path, rec } = await pausedSatellite(fake, dir, bridge);
    assert.equal(
      typeof rec.incarnation,
      "string",
      `the record names its incarnation: ${JSON.stringify(rec)}`,
    );
    const old = { key: rec.key, incarnation: rec.incarnation };
    const newer = { ...rec, incarnation: "newer-satellite", at: Date.now() };
    writeFileSync(path, JSON.stringify(newer) + "\n", { mode: 0o600 });
    const launcher = await bridge();
    const before = fake.state.counts.stops;
    const got = await launcher.request("iskron/stopseat", old);
    assert.equal(got.result?.how, "moved", JSON.stringify(got));
    assert.equal(fake.state.counts.stops, before, "no stop request");
    assert.ok(!closed(fake, NAME), "the newer holder's seat is not ended");
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), newer, "the newer record is intact");
  });
});

test("the child's name re-taken by another holder before the deferred end: the other's seat stays", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const { rec } = await pausedSatellite(fake, dir, bridge);
    const launcher = await bridge();
    fake.state.takeInWindow = `931:${NAME}`; // another holder takes the name right before the stop
    const got = await launcher.request("iskron/stopseat", {
      key: rec.key,
      incarnation: rec.incarnation,
    });
    assert.equal(got.result?.how, "moved", JSON.stringify(got));
    assert.ok(!closed(fake, NAME), "the other holder's seat is not ended");
    const revokes = fake.state.calls.filter(
      (c) => c.name === "iskron_channel" && c.arguments?.action === "revoke",
    );
    assert.deepEqual(revokes, [], "no revoke by name");
  });
});

test("the plain deferred end: the child's own socket's token ends its seat, its record goes", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const { path, rec } = await pausedSatellite(fake, dir, bridge);
    const launcher = await bridge();
    const got = await launcher.request("iskron/stopseat", {
      key: rec.key,
      incarnation: rec.incarnation,
    });
    assert.equal(got.result?.how, "stopped", JSON.stringify(got));
    assert.ok(closed(fake, NAME), "the child's seat is ended");
    assert.ok(!existsSync(path), "the record of the ended incarnation goes");
  });
});

test("no incarnation asked (an older marker), or no record: nothing stopped", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const { path, rec } = await pausedSatellite(fake, dir, bridge);
    const launcher = await bridge();
    const before = fake.state.counts.stops;
    const bare = await launcher.request("iskron/stopseat", { key: rec.key });
    assert.equal(bare.result?.how, "none", JSON.stringify(bare));
    const none = await launcher.request("iskron/stopseat", {
      key: "nobody--931--_nks_nks-dev",
      incarnation: rec.incarnation,
    });
    assert.equal(none.result?.how, "none", JSON.stringify(none));
    assert.equal(fake.state.counts.stops, before, "no stop request");
    assert.ok(!closed(fake, NAME) && existsSync(path), "the seat and its record stay");
  });
});

test("a satellite that ends by itself drops its own stop record", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const { s, path } = await stoodSatellite(fake, dir, bridge);
    s.proc.stdin.end();
    await s.gone();
    assert.ok(!existsSync(path), `the record is gone:\n${journalOf(dir)}`);
  });
});
