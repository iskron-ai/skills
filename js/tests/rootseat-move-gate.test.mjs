// A root moved by `session.move` is served by the new folder's instance (graph @nks/nks-dev, node
// #11463), and a call of its running turn may still reach the old folder's instance: there the
// root's bridge consumers — the context gate's skill loads (context-gate.ts, #10121), the usage
// feed, the pulse, the rules — see the holder's bridge, as the writes do. After a fill collapse
// the write lock lifts by the door skill loaded through EITHER instance.
//
// Стенд — rootseat-move-kit.mjs (настоящий плагин, настоящие мосты, подставной сервер).
// Не гоняется: какой экземпляр хост на деле получает хуки идущего хода — проба задаёт.
import assert from "node:assert/strict";
import { test } from "node:test";

import { call, liveIn, moved, seated, sleep, WRITE } from "./rootseat-move-kit.mjs";

const T = { timeout: 90_000 };
const LOCKED = /контекст сжат|context.*compact/i;
const MODEL = { providerID: "p", id: "m1" };
const step = (sessionID, input) => ({
  type: "session.step.ended",
  data: { sessionID, tokens: { input } },
});

test(
  "A → B, B holding: the door skill loaded through the old folder's instance lifts the write lock of the holder's bridge",
  T,
  async (t) => {
    const x = await seated(t);
    await liveIn(x);
    await moved(x);
    // The fill collapses in the new folder's instance: its bridge locks the session's writes.
    x.ocB.emit({ type: "session.step.started", data: { sessionID: "root", model: MODEL } });
    x.ocB.emit(step("root", 160_000));
    await sleep(300);
    x.ocB.emit(step("root", 40_000));
    await sleep(300);
    const locked = await call(x, x.ocB, WRITE);
    assert.match(locked.error ?? "", LOCKED, `the collapse locks writes: ${locked.content}`);
    // The running turn's skill load reaches the old folder's instance.
    await x.ocA.skill("root", "iskron");
    const after = await call(x, x.ocB, WRITE);
    assert.ok(!after.error, `the door's load through A lifts the lock: ${after.error}`);
  },
);
