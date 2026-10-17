// Род записи дела retract (api, #7472): ответ взят назад. in_reply_to называет ответ,
// after_ack — уже после принятия; будит того, кому ответ был дан (дело №902).
import assert from "node:assert/strict";
import { test } from "node:test";

import { roomKind } from "../shared/room-kinds.ts";
import { ME, roomFrame } from "./room-frames.mjs";

const retract = (afterAck, addressee = ME) =>
  roomFrame("retract", {
    entry_id: 352,
    key: "проба Телеграма",
    line: { refers_to: 319, verdict: "partial" },
    fields: afterAck ? { after_ack: true } : {},
    envelope: { addressee, in_reply_to: 319 },
  });

test("retract: a known kind — the answer and «после принятия» are named", () => {
  const rk = roomKind(retract(true));
  assert.ok(rk?.known, JSON.stringify(rk));
  assert.match(rk.words, /ответ \[319\] отозван после принятия, отзывает/);
  assert.doesNotMatch(rk.words, /неизвестен/);
  const plain = roomKind(retract(false));
  assert.match(plain.words, /ответ \[319\] отозван, отзывает/);
  assert.doesNotMatch(plain.words, /после принятия/);
});

test("retract: wakes only the seat the answer was given to", () => {
  assert.equal(roomKind(retract(true, ME)).rule, "interrupt");
  assert.equal(roomKind(retract(true, "@other:x")).rule, "batch");
});
