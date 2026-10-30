// Конец по слову харнеса (удалённая сессия) снимает свои места по имени после ожиданий конца
// (граф @nks/nks-dev, узел #7493): последний снимок расхода держит его открытым. Взял имя за это
// время другой мост этого дома — место держат снова, и конец его не снимает и его записи не
// трогает, как окно смерти; на прежней сборке revoke по имени снимал живое место нового держателя.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  closed,
  journalOf,
  recordOf,
  stand,
  stood,
  textOf,
  waitFor,
  withFake,
} from "./lifeend-kit.mjs";

// The gap holds the second snapshot back: the end flushes it by a register before its revoke.
process.env.ISKRON_USAGE_GAP_MS = "600000";
process.env.ISKRON_CASE_LEAVE_MS = "6000";

const registersOf = (fake) =>
  fake.state.calls.filter((c) => c.name === "iskron_channel" && c.arguments.action === "register")
    .length;

/** A stood seat with a held-back usage snapshot: the end's flush has one to send. */
async function withHeldUsage(a, name) {
  await stood(a, name);
  const first = await a.request("iskron/usage", { tokens: 1000, model: "m1" });
  assert.equal(first.result?.pushed, true, JSON.stringify(first));
  const held = await a.request("iskron/usage", { tokens: 9000, model: "m2" });
  assert.equal(held.result?.pushed, false, "the gap holds the second snapshot back");
}

test("the name taken by another bridge of this home while the end awaits its flush: the end does not revoke it", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await withHeldUsage(a, "die-w");
    const before = registersOf(fake);
    fake.state.registerToolDelayMs = 3_000;
    const ending = a.request("iskron/end");
    await waitFor("the end's flush in flight", () => registersOf(fake) > before);
    fake.state.registerToolDelayMs = 0;
    const b = await bridge(); // a new bridge of the same home
    const r = await stand(b, "die-w");
    assert.ok(!r.result?.isError, textOf(r));
    const theirs = readFileSync(recordOf(dir, "die-w"), "utf8");
    const end = await ending;
    assert.equal(end.result?.ended, true, JSON.stringify(end));
    assert.ok(
      !end.result.revoked.some((s) => s.name === "die-w"),
      `not revoked by the end: ${JSON.stringify(end)}\n${journalOf(dir)}`,
    );
    assert.ok(!closed(fake, "die-w"), `the new holder's seat lives:\n${journalOf(dir)}`);
    assert.ok(fake.state.places.has("931:die-w"), "the seat is on the board");
    assert.match(journalOf(dir), /die-w--931--_nks_nks-dev (is held again|: held again)/);
    assert.ok(existsSync(recordOf(dir, "die-w")), "the new holder's record lives");
    assert.equal(readFileSync(recordOf(dir, "die-w"), "utf8"), theirs, "its record untouched");
  });
});

// The control: the same flush with nobody taking the name — the end revokes the seat at once.
test("an end that flushes a held-back snapshot and finds the name untaken revokes it at once", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await withHeldUsage(a, "die-u");
    const end = await a.request("iskron/end");
    assert.ok(
      end.result?.revoked?.some((s) => s.name === "die-u"),
      `revoked by the end: ${JSON.stringify(end)}\n${journalOf(dir)}`,
    );
    assert.ok(closed(fake, "die-u"), "the seat is off the board at once");
    assert.ok(!existsSync(recordOf(dir, "die-u")), "its record dropped");
  });
});
