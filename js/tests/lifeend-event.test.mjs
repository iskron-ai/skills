// The end of an agent's session reported by one call (graph @nks/nks-dev, node #11362): POST
// <api>/channel/ws/{token}/event {event} — the api ends the session's seats, its ended[] is the
// authority. Every way of ending goes through it: the harness's word (a deleted OpenCode session —
// session_deleted, a lead subagent's end — subagent_ended) and the death window (process_died).
// An api without the route (404 with no rule, 405 — the shape deployed today) falls back once to
// the stop by the same token. On the former build (ISKRON_BRIDGE_PATH) no end event was sent.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import {
  closed,
  DEATH_MS,
  delay,
  journalOf,
  recordOf,
  stood,
  waitFor,
  withFake,
} from "./lifeend-kit.mjs";

const revokesOf = (fake, name) =>
  fake.state.calls.filter(
    (c) =>
      c.name === "iskron_channel" &&
      c.arguments.action === "revoke" &&
      String(c.arguments.standing ?? "").startsWith(name),
  ).length;

const fail = (dir) => (e) => {
  throw new Error(`${e.message}\n${journalOf(dir)}`);
};

test("a deleted session's end goes as one end event, session_deleted — no stop, no revoke", async () => {
  await withFake(
    async ({ fake, dir, bridge }) => {
      const a = await bridge();
      await stood(a, "ev-del");
      const r = await a.request("iskron/end", { event: "session_deleted" });
      assert.equal(r.result?.ended, true, JSON.stringify(r));
      assert.ok(
        r.result.revoked.some((s) => s.name === "ev-del"),
        JSON.stringify(r),
      );
      assert.deepEqual(fake.state.endEvents, [{ event: "session_deleted" }]);
      assert.equal(fake.state.counts.stops, 0, `no stop by token:\n${journalOf(dir)}`);
      assert.equal(revokesOf(fake, "ev-del"), 0, "no revoke by name");
      assert.ok(closed(fake, "ev-del"), "the seat is off the board");
      assert.ok(!existsSync(recordOf(dir, "ev-del")), "its hold record dropped");
    },
    { endEvent: true },
  );
});

test("a dead agent's end after the window goes as one end event, process_died", async () => {
  await withFake(
    async ({ fake, dir, bridge }) => {
      const a = await bridge();
      await stood(a, "ev-die");
      a.proc.kill("SIGKILL");
      await a.gone();
      await waitFor("the seat closed", () => closed(fake, "ev-die"), 15_000).catch(fail(dir));
      assert.deepEqual(fake.state.endEvents, [{ event: "process_died" }]);
      assert.equal(fake.state.counts.stops, 0, `no stop by token:\n${journalOf(dir)}`);
      assert.equal(revokesOf(fake, "ev-die"), 0, "no revoke by name");
      await waitFor("the hold record dropped", () => !existsSync(recordOf(dir, "ev-die")));
    },
    { endEvent: true },
  );
});

for (const absent of [404, 405])
  test(`an api without the end-event route (${absent}): one try, then the stop by token once, logged`, async () => {
    await withFake(
      async ({ fake, dir, bridge }) => {
        const a = await bridge();
        await stood(a, "ev-old");
        const r = await a.request("iskron/end", { event: "session_deleted" });
        assert.equal(r.result?.ended, true, JSON.stringify(r));
        assert.equal(fake.state.endEvents.length, 1, "the end event tried once");
        assert.equal(fake.state.counts.stops, 1, `the stop by token once:\n${journalOf(dir)}`);
        assert.ok(closed(fake, "ev-old"), "the seat is off the board");
        assert.match(journalOf(dir), /no end-event route on this api \((404|405)/);
      },
      { endEvent: absent },
    );
  });

// The api's refusals of the event itself, and a token not current: nothing ended, no fallback
// stop, no revoke by name, and no repeat — not even by a death window.
for (const [status, rule] of [
  [404, "ws_token_not_current"],
  [403, "human_seat_needs_front"],
  [422, "event_unknown"],
  [422, "session_id_invalid"],
])
  test(`an end event answered ${status} ${rule}: no fallback, no repeat`, async () => {
    await withFake(
      async ({ fake, dir, bridge }) => {
        const a = await bridge();
        await stood(a, "ev-no");
        const r = await a.request("iskron/end", { event: "session_deleted" });
        assert.equal(r.result?.ended, true, JSON.stringify(r));
        a.proc.kill("SIGKILL"); // the session ends: a death window would repeat the end now
        await a.gone();
        await delay(DEATH_MS + 1000);
        assert.equal(fake.state.endEvents.length, 1, `the event once:\n${journalOf(dir)}`);
        assert.equal(fake.state.counts.stops, 0, `no fallback stop:\n${journalOf(dir)}`);
        assert.equal(revokesOf(fake, "ev-no"), 0, "no revoke by name");
        assert.ok(!closed(fake, "ev-no"), "nothing ended by the bridge");
        assert.doesNotMatch(journalOf(dir), /no end-event route/);
        if (status !== 404)
          assert.match(journalOf(dir), new RegExp(`refused by the api \\(${rule}\\)`));
      },
      { endEvent: { status, rule } },
    );
  });

test("a lead subagent's end goes as one end event by its own token, subagent_ended — no revoke", async () => {
  await withFake(
    async ({ fake, dir, bridge }) => {
      const CALLER = "host.repo.opus-5";
      await fake.control({ places: [{ karta: "931", name: CALLER, listening: true }] });
      const s = await bridge(dir, ["--satellite"]);
      const st = await s.request("tools/call", {
        name: "iskron_stand",
        arguments: { realm: "nks-dev", karta: 931, satellite_of: `@tester:${CALLER}` },
      });
      assert.ok(!st.result?.isError, JSON.stringify(st));
      const name = `${CALLER}.sub-1`;
      await waitFor("the satellite listens", () =>
        [...fake.state.ws].some((w) => fake.state.wsNames.get(w) === name),
      ).catch(fail(dir));
      const id = [...fake.state.channels.values()]
        .flatMap((c) => [...c.places.values()])
        .find((p) => p.name === name)?.standing_id;
      const r = await s.request("iskron/end", { event: "subagent_ended" });
      assert.equal(r.result?.ended, true, JSON.stringify(r));
      // The plugin names the child by them in the parent's child_ended (childended.ts).
      assert.deepEqual(r.result.ids, [id], `the end answers its seat's id: ${JSON.stringify(r)}`);
      assert.deepEqual(fake.state.endEvents, [{ event: "subagent_ended" }], journalOf(dir));
      assert.equal(revokesOf(fake, name), 0, `no revoke by name:\n${journalOf(dir)}`);
      assert.ok(closed(fake, name), "the satellite's seat is off the board");
    },
    { endEvent: true },
  );
});
