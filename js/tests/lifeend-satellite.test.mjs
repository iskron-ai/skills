// A satellite's end (graph @nks/nks-dev, nodes #11362, #6593; review №5823 [97] п.4): reported by
// the end event by its own token; the revoke by name is ONLY the one fallback on an api without
// the route (404 with no rule, 405). A refusal (403, 422), a network error, and a seat the
// event's ended[] does not name (another holder's now) revoke nothing — a revoke by name there
// would bypass the server's word and could take off a new holder of the name. On the former
// build each of those fell into a revoke by name.
import assert from "node:assert/strict";
import { test } from "node:test";

import { closed, delay, journalOf, waitFor, withFake } from "./lifeend-kit.mjs";

const CALLER = "host.repo.opus-5";
const NAME = `${CALLER}.sub-1`;
const revokes = (fake) =>
  fake.state.calls.filter((c) => c.name === "iskron_channel" && c.arguments.action === "revoke")
    .length;

/** A satellite standing and listening by its own socket. */
async function satellite(fake, dir, bridge) {
  await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
  const s = await bridge(dir, ["--satellite"]);
  const st = await s.request("tools/call", {
    name: "iskron_stand",
    arguments: { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` },
  });
  assert.ok(!st.result?.isError, JSON.stringify(st));
  await waitFor("the satellite listens", () =>
    [...fake.state.ws].some((w) => fake.state.wsNames.get(w) === NAME),
  ).catch((e) => {
    throw new Error(`${e.message}\n${journalOf(dir)}`);
  });
  return s;
}

for (const [what, endEvent, keeps] of [
  ["403 human_seat_needs_front", { status: 403, rule: "human_seat_needs_front" }, false],
  ["422 event_unknown", { status: 422, rule: "event_unknown" }, false],
  ["a network error", "drop", false],
  ["a 200 whose ended[] does not name it", true, true],
])
  test(`a satellite's end answered by ${what}: no revoke by name`, async () => {
    await withFake(
      async ({ fake, dir, bridge }) => {
        const s = await satellite(fake, dir, bridge);
        if (keeps) fake.state.stopKeeps.add(`931:${NAME}`);
        const before = revokes(fake);
        const r = await s.request("iskron/end", { event: "subagent_ended" });
        assert.equal(r.result?.ended, true, JSON.stringify(r));
        await delay(500);
        assert.equal(fake.state.endEvents.length, 1, `the event once:\n${journalOf(dir)}`);
        assert.equal(revokes(fake) - before, 0, `no revoke by name:\n${journalOf(dir)}`);
        assert.equal(fake.state.counts.stops, 0, "no stop by token either");
        assert.ok(!closed(fake, NAME), "the seat is left to the server's word");
      },
      { endEvent },
    );
  });

for (const absent of [404, 405])
  test(`a satellite's end on an api without the route (${absent}): the one fallback — a revoke by name`, async () => {
    await withFake(
      async ({ fake, dir, bridge }) => {
        const s = await satellite(fake, dir, bridge);
        const before = revokes(fake);
        const r = await s.request("iskron/end", { event: "subagent_ended" });
        assert.equal(r.result?.ended, true, JSON.stringify(r));
        assert.equal(revokes(fake) - before, 1, `one revoke by name:\n${journalOf(dir)}`);
      },
      { endEvent: absent },
    );
  });
