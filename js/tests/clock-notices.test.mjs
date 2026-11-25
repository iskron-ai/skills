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

// #11372: the bridge infers nothing. A role without a seat is no proof of a person — an agent's
// role card with no seat prints its seat facts (absent — «unknown») and its role_called.
test("an agent role with no seat: the recipient unknown, the seat facts and role_called shown, no person word", () => {
  const to = { standing_id: null, standing: null, karta_seq: 163 };
  const f = clockNotice("card_unanswered", { to, last_act_at: null });
  for (const text of [frameToText(f, ""), batchLine(f), batchText([f])]) {
    const line = text.split("\n")[0];
    assert.match(line, /; адресат: неизвестно \(id: неизвестно, роль: 163\); /, line);
    assert.match(line, /слушает: нет; последний ход: неизвестно; роль позвана: да$/, line);
    assert.doesNotMatch(line, /человек|доставка/, line);
  }
  const absent = batchLine(
    clockNotice("card_unanswered", { to, listening: null, role_called: null }),
  );
  assert.match(absent, /слушает: неизвестно; .*роль позвана: неизвестно$/, absent);
  assert.doesNotMatch(absent, /: нет|человек/, absent);
});

// The api's shape (nks-api, #11372): to.kind "person" | "agent"; for a person delivery =
// {fronts: [{front, taken}], read: "unknown"}; the agent-seat fields stay in the frame and are
// not printed for a person.
const PERSON = { standing_id: null, standing: null, karta_seq: 163, kind: "person" };
const SEAT_FIELDS = { took_text: false, listening: false, role_called: false };

test("a person card with taken and queued fronts: person wording, each front's state, the server's read word, no agent-seat fact", () => {
  const delivery = {
    fronts: [
      { front: "bot", taken: true },
      { front: "pulse", taken: false },
    ],
    read: "unknown",
  };
  const f = clockNotice("card_unanswered", {
    to: PERSON,
    delivery,
    last_act_at: null,
    ...SEAT_FIELDS,
  });
  for (const text of [frameToText(f, ""), batchLine(f), batchText([f])]) {
    const line = text.split("\n")[0];
    assert.match(
      line,
      /; человеку \(роль: 163\); фронты: bot \(взята\), pulse \(в очереди\); прочтение: unknown; последний ход: неизвестно$/,
      line,
    );
    assert.doesNotMatch(line, /слушает|роль позвана|адресат|took_text|: нет/, line);
    assert.doesNotMatch(text, /SERVER-BODY|notice_data|\[object Object\]/);
  }
  // The details carry the server's words, not the bridge's.
  const d = cardFrame(f).provenance.notice_data;
  assert.equal(d.to.kind, "person");
  assert.deepEqual(d.delivery, delivery);
});

test("a person card sent to no front, and one without delivery facts", () => {
  const none = clockNotice("card_unanswered", {
    to: PERSON,
    delivery: { fronts: [], read: "unknown" },
    ...SEAT_FIELDS,
  });
  assert.match(
    batchLine(none),
    /; человеку \(роль: 163\); не отправлена ни одному фронту человека; прочтение: unknown; /,
  );
  assert.doesNotMatch(batchLine(none), /слушает|роль позвана/);
  const bare = batchLine(clockNotice("card_unanswered", { to: PERSON, ...SEAT_FIELDS }));
  assert.match(bare, /; человеку \(роль: 163\); доставка: неизвестно; /, bare);
});

test("kind agent: the seat facts as before, an absent one unknown", () => {
  const to = { standing_id: "seat-id", standing: "@h:recipient", karta_seq: 163, kind: "agent" };
  const line = batchLine(clockNotice("card_unanswered", { to, role_called: null }));
  assert.match(
    line,
    /адресат: @h:recipient \(id: seat-id, роль: 163\); слушает: нет; .*роль позвана: неизвестно$/,
    line,
  );
  assert.doesNotMatch(line, /человек|фронт|доставка/, line);
});

test("a seat's null flag is unknown, never no", () => {
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

test("English: a person card by the server's kind names the person; a seatless role without it does not", () => {
  setLang("en");
  try {
    const to = { standing_id: null, standing: null, karta_seq: 163 };
    const f = clockNotice("card_unanswered", {
      to: { ...to, kind: "person" },
      delivery: {
        fronts: [
          { front: "bot", taken: true },
          { front: "pulse", taken: false },
        ],
        read: "unknown",
      },
      listening: false,
      last_act_at: null,
      role_called: false,
    });
    assert.match(
      batchLine(f),
      /; to a person \(role: 163\); fronts: bot \(taken\), pulse \(queued\); read: unknown; last action: unknown$/,
    );
    assert.doesNotMatch(batchLine(f), /listening|role called|recipient/);
    const none = batchLine(
      clockNotice("card_unanswered", {
        to: { ...to, kind: "person" },
        delivery: { fronts: [], read: "unknown" },
      }),
    );
    assert.match(
      none,
      /; to a person \(role: 163\); sent to no front of the person; read: unknown; /,
    );
    const seatless = batchLine(clockNotice("card_unanswered", { to }));
    assert.match(
      seatless,
      /recipient: unknown \(id: unknown, role: 163\); listening: no; .*role called: yes$/,
    );
    assert.doesNotMatch(seatless, /person/);
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
