// A stale call that asks nothing wakes no turn (opencode/quiet-calls.ts; case №4050 [74] (в)):
// the batch the live run saw — withdrawn calls of other cases and the session's own taken call.
import assert from "node:assert/strict";
import { test } from "node:test";

import { quietCalls } from "../opencode/quiet-calls.ts";

const room = (seq) => ({ id: `c0ffee00-0000-4000-8000-00000000000${seq}`, seq, realm: "@p/q" });
const frame = (seq, entry_id, kind, key = "invite:role-1") => ({
  type: "message",
  id: `f${seq}-${entry_id}`,
  room: room(seq),
  event_kind: `room.${kind}`,
  line: { entry_id, kind, key, fields: {} },
});
const stale = (frames) => ({ kind: "stale", frames, marks: ["m"], text: "старый текст" });

test("withdrawals and the invites they withdraw are quiet; an open invite still wakes", () => {
  const open = frame(4, 5, "invite");
  const ev = quietCalls(
    stale([frame(2, 5, "invite"), frame(2, 8, "withdraw"), frame(3, 8, "withdraw"), open]),
    false,
  );
  assert.deepEqual(ev.frames, [open]);
  assert.notEqual(ev.text, "старый текст", "the text is composed again of what is left");
  assert.match(ev.text, /№4/);
  assert.doesNotMatch(ev.text, /№2|№3/);
  assert.deepEqual(ev.marks, ["m"], "the marks stay: the frames were delivered");
});

test("a session raised for an invite hears no invite at all: its own is taken, another's is the orchestrator's", () => {
  const said = frame(6, 9, "said", "said");
  const ev = quietCalls(stale([frame(4, 5, "invite"), frame(6, 5, "invite"), said]), true);
  assert.deepEqual(ev.frames, [said]);
  const none = quietCalls(stale([frame(6, 5, "invite")]), true);
  assert.equal(none.text, "", "nothing left — an empty text wakes nothing");
});

test("a batch without quiet calls and a backlog batch pass as they are", () => {
  const said = stale([frame(6, 9, "said", "said")]);
  assert.equal(quietCalls(said, true), said);
  const backlog = { ...stale([frame(2, 8, "withdraw")]), kind: "backlog" };
  assert.equal(quietCalls(backlog, false), backlog);
});
