// One owner per ROOT session across the process's plugin instances (graph @nks/nks-dev, node
// #11463; the contract of #6550: a session speaks with at most one seat). An instance takes the
// root's slot only under the process's reservation of the root (twins.ts), taken synchronously
// before any wait: two instances that receive the root's calls in the same tick open ONE bridge
// and stand ONE seat; an instance waiting for a reservation that does not become ready answers
// with a refusal aloud and opens no bridge of its own.
//
// Стенд — rootseat-move-kit.mjs (настоящий плагин, настоящие мосты, подставной сервер).
// Не гоняется: какой экземпляр хост на деле получает вызовы идущего хода — проба задаёт.
import assert from "node:assert/strict";
import { test } from "node:test";

import { until } from "./ownseat-kit.mjs";
import { heardSeats, rootPlugin } from "./rootseat-kit.mjs";
import {
  call,
  listed,
  liveIn,
  markers,
  seated,
  sleep,
  STAND,
  stand,
  stood,
} from "./rootseat-move-kit.mjs";

const T = { timeout: 90_000 };
const REFUSED = /держит другой экземпляр плагина|held by another instance of the plugin/;
const bridges = () => globalThis.__iskronProbeBridges?.size ?? 0;

test(
  "two instances receive the root's explicit stand in the same tick, no holder yet — one bridge stands one seat",
  T,
  async (t) => {
    const x = await stand(t);
    x.ocA = await rootPlugin(x.s, x.a);
    x.up.push(x.ocA);
    x.ocA.create("root", { emit: false });
    await liveIn(x);
    x.mark = 0;
    await Promise.all([listed(x.ocA, STAND), listed(x.ocB, STAND)]);
    const sockets = x.s.fake.state.counts.ws_upgrades;
    const [a, b] = await Promise.all([call(x, x.ocA, STAND), call(x, x.ocB, STAND)]);
    await sleep(1_500);
    const names = [...new Set(stood(x))];
    const seats = heardSeats(x.s.fake);
    // A second bridge standing the same seat takes its socket from the first: one more socket.
    const opened = x.s.fake.state.counts.ws_upgrades - sockets;
    assert.deepEqual(
      { seats: seats.length, names: names.length, sockets: opened },
      { seats: 1, names: 1, sockets: 1 },
      `seats heard: ${seats.join(", ") || "none"}; names stood: ${names.join(" → ") || "none"}; standing sockets opened: ${opened}; A: ${a.error ?? a.content}; B: ${b.error ?? b.content}`,
    );
  },
);

test(
  "the root handed to a live folder's instance that has not taken it yet: the old instance's call waits, then refuses aloud — no bridge, no seat of its own",
  T,
  async (t) => {
    const x = await seated(t, { ISKRON_ROOT_WAIT_MS: "1500" });
    await liveIn(x);
    x.ocA.move("root", x.b); // the new folder's instance gets no session.moved of its own yet
    await until(() => markers(x.s.dir).length === 1, "the old folder's instance laid the marker");
    await until(() => heardSeats(x.s.fake).length === 0, "the old folder's seat put down away");
    await listed(x.ocA, STAND);
    const before = bridges();
    const r = await call(x, x.ocA, STAND);
    await sleep(1_000);
    assert.ok(r.error && REFUSED.test(r.error), `a refusal aloud: ${r.error ?? r.content}`);
    assert.deepEqual(stood(x), [], "no seat stood by the refused call");
    assert.equal(bridges(), before, "no bridge raised by the refused call");
  },
);
