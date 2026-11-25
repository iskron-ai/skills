import assert from "node:assert/strict";
import { test } from "node:test";

import { batchLine, batchText, frameToText } from "../shared/frame-text.ts";
import { setLang } from "../shared/lang.ts";
import { cardFrame } from "../shared/open-cards.ts";
import { clockNotice } from "./clock-notices.mjs";

for (const kind of ["card_unanswered", "line_due"])
  test(`${kind} retains server references and facts in direct and batch rendering`, () => {
    const f = clockNotice(kind);
    for (const text of [frameToText(f, ""), batchLine(f), batchText([f])]) {
      for (const fact of [
        "4330",
        "case-id",
        "@o/s",
        "[41]",
        "clock-key",
        "@h:recipient",
        "seat-id",
        "163",
      ])
        assert.ok(text.includes(fact), `${fact} missing: ${text}`);
      assert.match(text, kind === "line_due" ? /2026-11-10T12:05:00Z/ : /2026-11-10T12:00:00Z/);
      assert.doesNotMatch(text, /SERVER-BODY|notice_data|\[object Object\]/);
    }
  });

test("a card to a person names the person and no seat fact; a seat's null flag is unknown, never no", () => {
  const person = { standing_id: null, standing: null, karta_seq: 163 };
  for (const flags of [
    {},
    { listening: true, role_called: true },
    { listening: null, role_called: null },
  ]) {
    const f = clockNotice("card_unanswered", { to: person, last_act_at: null, ...flags });
    for (const text of [frameToText(f, ""), batchLine(f), batchText([f])]) {
      const line = text.split("\n")[0];
      assert.match(
        line,
        /^карточка без ответа: дело №4330 \(id: case-id, граф: @o\/s\) \[41\], ключ: clock-key/,
        line,
      );
      assert.match(
        line,
        /; адресат — человек \(роль: 163\); доставка человеку мосту не видна; последний ход: неизвестно$/,
        line,
      );
      assert.doesNotMatch(line, /слушает|роль позвана|адресат: /, line);
      assert.doesNotMatch(text, /SERVER-BODY|notice_data|\[object Object\]/);
    }
    // The details carry the same: a person's card has no seat facts to read as «no».
    const { to, listening, role_called } = cardFrame(f).provenance.notice_data;
    assert.deepEqual(
      { to, listening, role_called },
      { to: person, listening: null, role_called: null },
    );
  }
  // A seat is a seat with or without its id; a null flag of a seat is unknown, never no.
  for (const to of [
    { standing_id: "seat-id", standing: "@h:recipient", karta_seq: 163 },
    { standing_id: null, standing: "@h:recipient", karta_seq: 163 },
    { standing_id: "seat-id", standing: "@h:recipient", karta_seq: null },
  ]) {
    const text = batchLine(
      clockNotice("card_unanswered", { to, listening: null, last_act_at: null, role_called: null }),
    );
    assert.match(text, /адресат: @h:recipient \(/, text);
    assert.match(
      text,
      /слушает: неизвестно; последний ход: неизвестно; роль позвана: неизвестно$/,
      text,
    );
    assert.doesNotMatch(text, /человек|доставка|: нет|: да/, text);
  }
});

test("English person card names the person and no seat fact", () => {
  setLang("en");
  try {
    const f = clockNotice("card_unanswered", {
      to: { standing_id: null, standing: null, karta_seq: 163 },
      listening: false,
      last_act_at: null,
      role_called: false,
    });
    assert.match(
      batchLine(f),
      /; recipient is a person \(role: 163\); delivery to the person is not visible to the bridge; last action: unknown$/,
    );
    assert.doesNotMatch(batchLine(f), /listening|role called|recipient: unknown/);
    assert.match(
      batchLine(clockNotice()),
      /listening: no; last action: 2026-11-10T12:00:00Z; role called: yes/,
    );
  } finally {
    setLang("ru");
  }
});

test("line_due distinguishes server escalation false and true", () => {
  assert.match(batchLine(clockNotice("line_due")), /передано постановщику: нет/);
  assert.match(
    batchLine(clockNotice("line_due", { escalated: true })),
    /передано постановщику: да/,
  );
});

test("English clock facts preserve null and server booleans without instructions", () => {
  setLang("en");
  try {
    assert.match(
      batchLine(clockNotice()),
      /listening: no; last action: 2026-11-10T12:00:00Z; role called: yes/,
    );
    assert.match(batchLine(clockNotice("line_due", { escalated: true })), /escalated: yes/);
    assert.match(batchLine(clockNotice("line_due", { escalated: null })), /escalated: unknown/);
  } finally {
    setLang("ru");
  }
});

test("invalid scalar types, arrays and timestamps stay unknown, not coerced", () => {
  for (const value of [
    undefined,
    null,
    [],
    {},
    true,
    false,
    -1,
    0,
    1.5,
    "SECRET",
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const f = clockNotice("line_due", { entry_id: value, due_at: value, escalated: value });
    assert.match(batchLine(f), /\[неизвестно\]/);
    assert.match(batchLine(f), /срок: неизвестно/);
    assert.doesNotMatch(batchLine(f), /SECRET|\[object Object\]/);
  }
  for (const due_at of [
    "2026-02-31T00:00:00Z",
    "2026-11-10",
    "2026-11-10T25:00:00Z",
    "2026-11-10T12:00:00Z\nSECRET",
  ])
    assert.match(batchLine(clockNotice("line_due", { due_at })), /срок: неизвестно/);
  for (const notice_data of [undefined, null, [], "SECRET"]) {
    const f = clockNotice();
    f.provenance.notice_data = notice_data;
    assert.doesNotMatch(frameToText(f, ""), /SECRET|SERVER-BODY|\[object Object\]/);
    assert.match(batchLine(f), /слушает: неизвестно/);
  }
});

test("malformed clock fields and bodies never leak as raw objects in text or details", () => {
  for (const notice of ["card_unanswered", "line_due"]) {
    const secret = { secret: "SECRET" };
    const f = clockNotice(
      notice,
      Object.fromEntries(
        [
          "room",
          "entry_id",
          "key",
          "to",
          "holder",
          "listening",
          "last_act_at",
          "role_called",
          "due_at",
          "escalated",
          "extra",
        ].map((k) => [k, secret]),
      ),
    );
    f.body = secret;
    assert.doesNotMatch(frameToText(f, ""), /SECRET|\[object Object\]/);
    assert.doesNotMatch(batchLine(f), /SECRET|\[object Object\]/);
    assert.doesNotMatch(JSON.stringify(cardFrame(f)), /SECRET/);
  }
});

test("other provenance and unknown notices keep the general path; an ordinary neighbour survives", () => {
  for (const p of [{ via: "room" }, { auth: "token" }, { notice: "future_notice" }]) {
    const f = clockNotice();
    Object.assign(f.provenance, p);
    assert.match(frameToText(f, ""), /SERVER-BODY/);
  }
  const f = clockNotice();
  const other = { type: "message", id: "ordinary", body: "ORDINARY-NEIGHBOUR" };
  assert.match(batchText([f, other]), /ORDINARY-NEIGHBOUR/);
});
