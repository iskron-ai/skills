// №677: ответ connect, пришедший после конца прогона, сокета не открывает никогда (граф
// @nks/nks-dev, узел #7493). Здесь — конец, держащий места: объявленная отлучка. Место ложится
// в запись держания, и та же сессия нового экземпляра возвращает его по записи; на прежней
// сборке поздний ответ открывал сокет кончившейся сессии, и возврат упирался в него.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import {
  closed,
  connectsOf,
  DEATH_MS,
  delay,
  journalOf,
  recordOf,
  stand,
  stood,
  waitFor,
  withFake,
} from "./lifeend-kit.mjs";

test("an announced absence while the first connect is in flight: no socket, the record waits, the same session takes the seat back", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await a.request("iskron/resume", { session: "ses-late" }); // the plugin names the session
    fake.state.connectReplyDelayMs = 1_500;
    void stand(a, "late-a").catch(() => {});
    await waitFor("the connect sent", () => connectsOf(fake) > 0);
    const away = await a.request("iskron/away");
    assert.equal(away.result?.away, true, `away is taken: ${JSON.stringify(away)}`);
    a.proc.stdin.end();
    await a.gone();
    const listens = () => [...fake.state.ws].some((w) => fake.state.wsNames.get(w) === "late-a");
    // The session ends when its stand in flight has answered.
    await waitFor("the session's end", () => / session \S+ ended: /.test(journalOf(dir))).catch(
      (e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      },
    );
    await delay(300);
    assert.ok(!listens(), `the late reply opened no socket:\n${journalOf(dir)}`);
    assert.match(journalOf(dir), /late-a--931--_nks_nks-dev: connect answered after the run's end/);
    assert.ok(existsSync(recordOf(dir, "late-a")), "its hold record waits");
    fake.state.connectReplyDelayMs = 0;
    await delay(DEATH_MS + 1_000);
    assert.ok(!closed(fake, "late-a"), `the absent seat is not closed:\n${journalOf(dir)}`);
    const b = await bridge();
    const back = await b.request("iskron/resume", {
      key: "late-a--931--_nks_nks-dev",
      session: "ses-late",
    });
    assert.equal(back.result?.resumed, true, `${JSON.stringify(back)}\n${journalOf(dir)}`);
    assert.ok(back.result?.own, "returned as the session's own seat");
    assert.equal(connectsOf(fake), 1, "returned by the record, not a new connect");
  });
});

// The run's end awaits its revoke while a connect answers (case №2264): the seat that connect
// stood on keeps its place and token among the seats to end — the end's own snapshot, taken
// before, must not overwrite it; on the prior build the late seat was dropped and lived on.
test("a connect answered while the end awaits its revoke: the late seat still ends by its token", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    await stood(a, "late-x");
    fake.state.revokeRefuseNext = [
      { text: "Отказано (503): сбой", status: 503, rule: "x", delayMs: 2_000 },
    ];
    fake.state.connectReplyDelayMs = 1_000;
    void a
      .request("tools/call", {
        name: "iskron_stand",
        arguments: { realm: "nks-dev", karta: 931, name: "late-y", take: true },
      })
      .catch(() => {});
    await waitFor("the second connect sent", () => connectsOf(fake) > 1);
    const r = await a.request("iskron/end");
    assert.ok(r.result?.failed?.includes("late-x"), `the revoke refused: ${JSON.stringify(r)}`);
    assert.match(journalOf(dir), /late-y--931--_nks_nks-dev: connect answered after the run's end/);
    fake.state.connectReplyDelayMs = 0;
    a.proc.stdin.end();
    await a.gone();
    await waitFor("the late seat closed", () => closed(fake, "late-y"), 15_000).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    assert.match(
      journalOf(dir),
      /late-y--931--_nks_nks-dev ended by its dead socket's token \(200/,
    );
  });
});

// The harness's word ends the agent while its first connect is in flight (a deleted session):
// the late seat goes at once by that reply's token, not after the death window.
test("an end while the first connect is in flight: the late seat ends at once, not with the window", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const a = await bridge();
    fake.state.connectReplyDelayMs = 1_500;
    void stand(a, "late-e").catch(() => {});
    await waitFor("the connect sent", () => connectsOf(fake) > 0);
    const r = await a.request("iskron/end");
    assert.equal(r.result?.ended, true, JSON.stringify(r));
    a.proc.stdin.end();
    await a.gone();
    await waitFor("the late reply", () =>
      /late-e--931--_nks_nks-dev: connect answered after the run's end/.test(journalOf(dir)),
    );
    const since = Date.now();
    await waitFor("the seat closed", () => closed(fake, "late-e"), 15_000).catch((e) => {
      throw new Error(`${e.message}\n${journalOf(dir)}`);
    });
    assert.ok(Date.now() - since < DEATH_MS, `at once, not after a window:\n${journalOf(dir)}`);
    assert.match(journalOf(dir), /it ends at once/);
  });
});
