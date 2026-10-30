// Конец по слову харнеса (iskron/end, удалённая сессия) снимает места токеном своего сокета, как
// окно смерти (граф @nks/nks-dev, узлы #7493, #9232): мост другой машины, взявший имя, пока конец
// ждал выходов из дел и снимка расхода, держит место — проверка токена и снятие у сервера разом.
// Прежний revoke по имени — только на api без этой ручки. На прежней сборке
// (ISKRON_BRIDGE_PATH) конец снимал по имени: место нового держателя снято, стопа нет.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { closed, journalOf, recordOf, stood, withFake } from "./lifeend-kit.mjs";

const revokesOf = (fake, name) =>
  fake.state.calls.filter(
    (c) =>
      c.name === "iskron_channel" &&
      c.arguments.action === "revoke" &&
      c.arguments.standing === name,
  ).length;

test("the harness's word ends the seat by its socket's token, no revoke by name", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "word-s");
    const r = await a.request("iskron/end");
    assert.equal(r.result?.ended, true, JSON.stringify(r));
    assert.ok(
      r.result.revoked.some((s) => s.name === "word-s"),
      `ended by the bridge itself: ${JSON.stringify(r)}`,
    );
    assert.equal(fake.state.counts.stops, 1, `one stop by token:\n${journalOf(dir)}`);
    assert.equal(revokesOf(fake, "word-s"), 0, "no revoke by name");
    assert.ok(closed(fake, "word-s"), "the seat is off the board at once");
    assert.ok(!existsSync(recordOf(dir, "word-s")), "its hold record dropped");
    assert.match(
      journalOf(dir),
      /word-s--931--_nks_nks-dev ended by its dead socket's token \(200/,
    );
  });
});

// Another machine's bridge takes the name between the end's last check and its stop: the token
// is no longer current, the server ends nothing, and the new holder keeps its seat.
test("the name taken by another machine before the word's stop: not current, the new holder's seat lives", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "word-g");
    fake.state.takeInWindow = "931:word-g";
    const r = await a.request("iskron/end");
    assert.equal(r.result?.ended, true, JSON.stringify(r));
    assert.ok(!closed(fake, "word-g"), `the new holder's seat lives:\n${journalOf(dir)}`);
    assert.ok(fake.state.places.has("931:word-g"), "the seat is on the board");
    assert.equal(revokesOf(fake, "word-g"), 0, "no revoke by name");
    assert.ok(!r.result.revoked.some((s) => s.name === "word-g"), JSON.stringify(r));
    assert.deepEqual(r.result.failed, [], "not a failure: the seat is another holder's");
    assert.match(
      journalOf(dir),
      /word-g--931--_nks_nks-dev: its dead socket's token is not current/,
    );
    assert.ok(!existsSync(recordOf(dir, "word-g")), "the dead run's own record dropped");
  });
});

// An api without the stop (404 without a rule, 405): the end asks it first, then revokes by name.
for (const absent of [404, 405])
  test(`an api without the stop by token (${absent}): the word's end falls back to a revoke by name`, async () => {
    await withFake(
      async ({ fake, dir, bridge }) => {
        const a = await bridge();
        await stood(a, "word-o");
        const r = await a.request("iskron/end");
        assert.ok(
          r.result?.revoked?.some((s) => s.name === "word-o"),
          JSON.stringify(r),
        );
        assert.equal(fake.state.counts.stops, 1, "the stop asked first");
        assert.equal(revokesOf(fake, "word-o"), 1, "then the revoke by name");
        assert.ok(closed(fake, "word-o"), "the seat is off the board");
        assert.ok(!existsSync(recordOf(dir, "word-o")), "its hold record dropped");
        assert.match(journalOf(dir), new RegExp(`no stop by token on this api \\(${absent}`));
      },
      { stopAbsent: absent },
    );
  });
