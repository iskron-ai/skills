// The harness's word line to its bridge (js/shared/pulseword.ts, graph nks-dev #7529): one
// iskron/pulse in flight, the words told meanwhile folded into the latest, a refused word told
// again after the retry, and a dropped line silent — its late outcome included.
import assert from "node:assert/strict";
import { test } from "node:test";

import { wordLine } from "../shared/pulseword.ts";

const flushed = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function fakeBridge() {
  const sent = [];
  return {
    sent,
    request(method, params) {
      let settle;
      const p = new Promise((resolve, reject) => (settle = { resolve, reject }));
      sent.push({ method, params, ...settle });
      return p;
    },
  };
}

test("one request in flight; changes behind it fold into one latest word with state and clocks", async () => {
  const b = fakeBridge();
  const line = wordLine(() => b);
  line.tell({ state: "busy" });
  for (let i = 0; i < 10; i++) line.tell({ act_at: `2026-10-29T00:00:0${i % 10}.000Z` });
  line.tell({ state: "idle", turn_at: "2026-10-29T00:00:10.000Z" });
  assert.equal(b.sent.length, 1);
  assert.equal(b.sent[0].method, "iskron/pulse");
  b.sent[0].resolve({ taken: true });
  await flushed();
  assert.equal(b.sent.length, 2);
  assert.deepEqual(b.sent[1].params, {
    state: "idle",
    act_at: "2026-10-29T00:00:09.000Z",
    turn_at: "2026-10-29T00:00:10.000Z",
  });
  b.sent[1].resolve({ taken: true });
  await flushed();
  line.tell({ state: "idle" });
  assert.equal(b.sent.length, 2, "a word the bridge has goes nowhere");
});

test("a refused word goes again after the retry; a change before it goes at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const b = fakeBridge();
  const line = wordLine(() => b);
  line.tell({ state: "busy" });
  b.sent[0].reject(new Error("refused"));
  await flushed();
  t.mock.timers.tick(1_999);
  assert.equal(b.sent.length, 1);
  t.mock.timers.tick(1);
  await flushed();
  assert.equal(b.sent.length, 2);
  assert.deepEqual(b.sent[1].params, { state: "busy" });
  b.sent[1].reject(new Error("refused"));
  await flushed();
  line.tell({ state: "idle" });
  assert.equal(b.sent.length, 3, "the change goes without waiting for the retry");
  b.sent[2].resolve({});
  await flushed();
  t.mock.timers.tick(5_000);
  await flushed();
  assert.equal(b.sent.length, 3, "the retry is gone with the taken word");
});

test("no bridge: the word waits for again(); a dropped line sends nothing, its late outcome neither", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let bridge = null;
  const b = fakeBridge();
  const line = wordLine(() => bridge);
  line.tell({ state: "busy" });
  bridge = b;
  assert.equal(b.sent.length, 0);
  line.again();
  assert.equal(b.sent.length, 1);
  line.tell({ act_at: "2026-10-29T00:00:01.000Z" });
  line.drop();
  b.sent[0].resolve({});
  await flushed();
  assert.equal(b.sent.length, 1, "the folded word of a dropped line stays unsent");

  const refused = wordLine(() => b);
  refused.tell({ state: "busy" });
  refused.drop();
  b.sent[1].reject(new Error("closed"));
  await flushed();
  t.mock.timers.tick(5_000);
  await flushed();
  refused.tell({ state: "idle" });
  refused.again();
  assert.equal(b.sent.length, 2, "no retry, no word after the drop");
});
