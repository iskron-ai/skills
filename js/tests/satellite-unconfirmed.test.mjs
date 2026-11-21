import assert from "node:assert/strict";
import { test } from "node:test";

import { boardLine, placeOf, setup, stand, textOf } from "./ownseat-kit.mjs";

const caller = "host.repo.opus-5";
const args = { realm: "nks-dev", karta: 931, satellite_of: `@tester:${caller}` };
process.env.ISKRON_BRIDGE_SATELLITE_TTL = "3";

for (const [scenario, failed, expiry, expected] of [
  ["unconfirmed", true, false, 2],
  ["confirmed", false, false, 1],
  ["expired", true, true, 1],
]) {
  test(`new satellite after ${scenario} release`, async (t) => {
    const { fake, up } = await setup(t);
    await fake.control({ places: [{ karta: "931", name: caller, listening: true }] });
    const first = await up(undefined, undefined, ["--satellite"]);
    const initial = await stand(first, args);
    assert.equal(placeOf(initial), `${caller}.sub-1`, textOf(initial));
    if (failed) await fake.control({ mcpDrop: 2, mcpDropAction: "iskron_channel:revoke" });
    const end = (await first.call("iskron/end", {})).result;
    assert.equal(end.failed.length, failed ? 1 : 0, JSON.stringify(end));
    await first.stop();
    await fake.control({ boardText: boardLine(caller) });
    if (expiry) await new Promise((r) => setTimeout(r, 3300));
    const second = await up(undefined, undefined, ["--satellite"]);
    const next = await stand(second, args);
    assert.equal(placeOf(next), `${caller}.sub-${expected}`, `${textOf(next)}\n${second.stderr}`);
  });
}
