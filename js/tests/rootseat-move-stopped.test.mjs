// A moved root served through its holder (graph @nks/nks-dev, node #11463): the old folder's
// instance answers a bare explicit stand «already standing» only while the holder's slot holds
// that seat. A platform stop leaves the slot its place and takes its holding: the stand then
// goes to the holder's bridge to be judged — a stand, or the bridge's own refusal.
//
// Стенд — rootseat-move-kit.mjs (настоящий плагин, настоящие мосты, подставной сервер; приказ
// останова — fake-orders.mjs). Не гоняется: какой экземпляр получает вызовы хода — задаёт проба.
import assert from "node:assert/strict";
import { test } from "node:test";

import { until } from "./ownseat-kit.mjs";
import { heardSeats } from "./rootseat-kit.mjs";
import { call, liveIn, moved, seated, sleep, STAND } from "./rootseat-move-kit.mjs";

const T = { timeout: 90_000 };
const ALREADY = /уже стоит как|already stands as/;

/** The standing id of the seat named `name` on the fake server's board. */
function idOf(fake, name) {
  for (const c of fake.state.channels.values())
    for (const p of c.places.values()) if (p.name === name) return p.standing_id;
  return null;
}

test(
  "A → B, B's seat stopped by the platform: a bare stand through the old folder's instance reaches the holder's bridge, never «already standing»",
  T,
  async (t) => {
    const x = await seated(t);
    await liveIn(x);
    await moved(x);
    const id = idOf(x.s.fake, x.old);
    assert.ok(id, `the seat ${x.old} is on the board`);
    await x.s.fake.control({ stop_order: { id: "ord-moved", standing_id: id } });
    await until(() => !heardSeats(x.s.fake).includes(x.old), "the platform stopped the seat");
    await sleep(500); // the holder's bridge reports the stop to its slot
    const calls = x.s.fake.state.calls.length;
    const r = await call(x, x.ocA, STAND);
    const said = r.error ?? r.content ?? "";
    assert.doesNotMatch(said, ALREADY, `a stopped seat is not "already standing": ${said}`);
    assert.ok(
      r.error || x.s.fake.state.calls.length > calls,
      `the stand reached the holder's bridge: ${said}`,
    );
  },
);
