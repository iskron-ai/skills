// Окно смерти прежнего экземпляра и возврат места новым (граф @nks/nks-dev, узел #7493; дело
// №677, круг 6): A кончился без метки, B той же сессии вернул место внутри окна A тем же
// токеном, объявил отлучку и ушёл до конца окна A. Окно A не снимает место — его держал живой
// мост после смерти A (запись держания новее той, что A оставил); на прежней сборке A видел
// мёртвый локальный сокет и снимал место, объявленно ждущее свою сессию.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { holdFilePathOf } from "../shared/standings.ts";
import {
  closed,
  connectsOf,
  DEATH_MS,
  delay,
  journalOf,
  stood,
  waitFor,
  withFake,
} from "./lifeend-kit.mjs";

/** The key of the seat the bridge said it holds (its `held` notice): the probe reads, not derives it. */
async function heldKey(b) {
  const key = () => b.notifications.find((n) => n.params?.data?.kind === "held")?.params.data.key;
  await waitFor("the held notice", () => !!key());
  return key();
}

/** A stands under a named session and dies without a mark; B of the same session takes the seat back within A's window. */
async function diedAndTakenBack(bridge, dir, name, session) {
  const a = await bridge();
  await a.request("iskron/resume", { session }); // the plugin names the session
  await stood(a, name);
  const key = await heldKey(a);
  a.proc.kill("SIGKILL");
  await a.gone();
  // A's window starts with the daemon's end of its session (after the seam's grace).
  await waitFor("A's session ended", () => / session s1-\S+ ended: /.test(journalOf(dir)));
  const b = await bridge();
  const back = await b.request("iskron/resume", { key, session });
  assert.equal(back.result?.resumed, true, `${JSON.stringify(back)}\n${journalOf(dir)}`);
  assert.ok(back.result?.own, "returned as the session's own seat");
  return { b, key };
}

test("a seat taken back within the dead instance's window and left on an announced absence: that window does not close it", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const { b, key } = await diedAndTakenBack(bridge, dir, "die-v", "ses-v");
    const away = await b.request("iskron/away");
    assert.equal(away.result?.away, true, `away is taken: ${JSON.stringify(away)}`);
    b.proc.stdin.end(); // B leaves before A's window ends
    await b.gone();
    await delay(DEATH_MS + 2_000);
    assert.ok(!closed(fake, "die-v"), `the absent seat is not closed:\n${journalOf(dir)}`);
    assert.equal(fake.state.counts.stops, 0, `no stop by token:\n${journalOf(dir)}`);
    assert.ok(existsSync(holdFilePathOf(dir, key)), "its hold record waits");
    assert.match(journalOf(dir), new RegExp(`${key}: held again after this run's end`));
    const c = await bridge();
    const again = await c.request("iskron/resume", { key, session: "ses-v" });
    assert.equal(again.result?.resumed, true, `${JSON.stringify(again)}\n${journalOf(dir)}`);
    assert.equal(connectsOf(fake), 1, "returned by the record, not a new connect");
  });
});

test("a seat taken back within the dead instance's window by a bridge that then dies too: the later window closes it", async () => {
  await withFake(async ({ fake, dir, bridge }) => {
    const { b } = await diedAndTakenBack(bridge, dir, "die-w", "ses-w");
    b.proc.kill("SIGKILL"); // B dies without a mark: its own window closes the seat
    await b.gone();
    await waitFor("the seat closed by B's window", () => closed(fake, "die-w"), 15_000).catch(
      (e) => {
        throw new Error(`${e.message}\n${journalOf(dir)}`);
      },
    );
    await delay(DEATH_MS);
    assert.equal(fake.state.counts.stops, 1, `one stop:\n${journalOf(dir)}`);
  });
});
