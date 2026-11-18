// A dsh call raised in its role's home (graph @nks/nks-dev, #10096, #11076): the task opens with
// the pair line carrying the role — the line OpenCode's prompt opens with (orchestra-raise.test.mjs
// "homes") — so the dsh plugin seats the call's role, not the cover's; raised from a plain
// checkout, the task carries no line and the pair rides the environment alone (#10777).
import assert from "node:assert/strict";
import { test } from "node:test";

import { invite, leadingDsh, REALM, ROOM } from "./dsh-kit.mjs";

test("dsh: a call raised in its role's home opens the task with the pair and the role", async (t) => {
  const o = await leadingDsh(t, {
    limit: 1,
    caseRoom: { status: "closed", entries: [] },
    homes: (checkout) => ({ [`${REALM}#931`]: checkout }),
  });
  await o.queue([invite(9)]);
  const r = await o.step();
  assert.match(r.out, /invite 9: launched/, r.out);
  const task = o.dshCalls()[0].argv.at(-1);
  const line = `iskron/spawned_for: {"invite":9,"room":"${ROOM}","karta":931} `;
  assert.ok(task.startsWith(`${line}start ${REALM} #931 `), task);
  assert.deepEqual(JSON.parse(o.dshCalls()[0].spawned_for), { invite: 9, room: ROOM });
});
