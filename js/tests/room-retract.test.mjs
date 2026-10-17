// Род записи дела retract (api, #7472, #8074): ответ взят назад. in_reply_to называет
// ответ, data.after_ack — уже после принятия; будит того, кому ответ был дан, а отзыв
// человека чужому месту — не слово мне, как и его ответ (дело №902).
import assert from "node:assert/strict";
import { test } from "node:test";

import { addressedToMine } from "../shared/addressed.ts";
import { roomKind } from "../shared/room-kinds.ts";
import { HUMAN, ME, roomFrame } from "./room-frames.mjs";

/** Отзыв ответа [347] (форма №734 [352]); автор — человек, как там. */
const retract = (afterAck, addressee = ME) => ({
  ...roomFrame("retract", {
    entry_id: 352,
    key: "проба Телеграма",
    author: HUMAN,
    line: {
      refers_to: 347,
      verdict: "partial",
      ...(afterAck ? { data: { after_ack: true } } : {}),
    },
    envelope: { addressee, in_reply_to: 347 },
  }),
  provenance: {
    from_standing: HUMAN.standing,
    from_karta_seq: HUMAN.karta.seq,
    user_karta_seq: HUMAN.karta.seq,
    auth: "pat",
    via: "room",
  },
});

test("retract: a known kind — the answer and «после принятия» are named", () => {
  const rk = roomKind(retract(true));
  assert.ok(rk?.known, JSON.stringify(rk));
  assert.match(rk.words, /ответ \[347\] отозван после принятия, отзывает/);
  assert.doesNotMatch(rk.words, /неизвестен/);
  const plain = roomKind(retract(false));
  assert.match(plain.words, /ответ \[347\] отозван, отзывает/);
  assert.doesNotMatch(plain.words, /после принятия/);
});

test("retract: wakes only the seat the answer was given to", () => {
  assert.equal(roomKind(retract(true, ME)).rule, "interrupt");
  assert.equal(roomKind(retract(true, "@other:x")).rule, "batch");
});

test("retract: a person's retract to another seat is not a word to me", () => {
  assert.equal(addressedToMine(retract(true, "@other:x")), false);
});
