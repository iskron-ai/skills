// Компактный последний рендер конверта #4939/#6867, требование владельца #9654.
// Форма roomFrame — наблюдения провода рядом с фабриками room-frames.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import { FRAME_TEXT, STALE } from "../delivery/index.ts";
import { batchHead, batchLine, caseCountLines, frameToText } from "../shared/frame-text.ts";
import { setLang } from "../shared/lang.ts";
import { quiet } from "../shared/quietframe.ts";
import { roomKind } from "../shared/room-kinds.ts";
import { staleBatch } from "../shared/stalebatch.ts";
import { graphPosed, HUMAN, ME, roomFrame } from "./room-frames.mjs";

const occurrences = (text, value) => text.split(value).length - 1;
const reply = (kind = "answer", body = "Feeds") => ({
  ...roomFrame(kind, {
    entry_id: 778,
    author: HUMAN,
    line: { refers_to: 762, done: body },
    fields: { to: { standing: ME } },
    envelope: { addressee: ME, in_reply_to: 762 },
    body,
  }),
  provenance: {
    via: "room",
    auth: "pat",
    from_person: true,
    user: "alari",
    from_standing: HUMAN.standing,
  },
});

test("a batch without case records does not point to case history or mine", () => {
  const frame = graphPosed();
  assert.deepEqual(caseCountLines([frame]), []);
  assert(!staleBatch([frame], () => false).text.includes("iskron_case("));
});

test("a human word and its body share an aside key without repeating provenance", () => {
  const said = roomFrame("said", {
    author: HUMAN,
    fields: { to: { standing: "@other:seat" } },
    envelope: { body_withheld: true },
  });
  said.provenance.from_person = true;
  const body = {
    ...said,
    event_kind: "room.body",
    line: { ...said.line, kind: "body" },
    provenance: { ...said.provenance, from_person: undefined },
  };
  assert.equal(roomKind(said).aside.pair, roomKind(body).aside.pair);
  assert.match(roomKind(said).words, /человек/);
});

test("a person's answer names its author, reference and body once", () => {
  const frame = reply();
  for (const render of [frameToText(frame, ""), batchLine(frame)]) {
    assert.equal(occurrences(render, "[762]"), 1, render);
    assert.equal(occurrences(render, "Feeds"), 1, render);
    assert(!render.includes(" — человек"), render);
    assert(!render.includes(`(${HUMAN.standing})`), render);
    assert.equal(render.split("\n").length, 1, render);
  }
});

test("answer and acceptance do not reprint a multiline body in their batch preview", () => {
  for (const kind of ["answer", "ack"]) {
    const render = batchLine(reply(kind, "unique_first\nunique_second"));
    assert.equal(occurrences(render, "unique_first"), 1, render);
    assert.equal(occurrences(render, "unique_second"), 1, render);
    assert.equal(occurrences(render, "[762]"), 1, render);
    assert.equal(render.split("\n").length, 1, render);
  }
});

test("a question names the target role and seat once, without a second seat name", () => {
  const frame = reply("ask");
  frame.line.fields.to = {
    karta: { seq: 4, name: "Target role" },
    standing: { standing: ME, name: "Repeated seat name" },
  };
  for (const render of [frameToText(frame, ""), batchLine(frame)]) {
    assert.equal(occurrences(render, "Target role"), 1, render);
    assert.equal(occurrences(render, ME), 1, render);
    assert(!render.includes("Repeated seat name"), render);
  }
});

test("a batch has one history hint, while retaining each case's cursor and realm", () => {
  const a = reply();
  const b = { ...reply(), room: { ...a.room, seq: 8, realm: "@other/run" }, entry_id: 90 };
  const render = batchHead([a, b]);
  assert.equal(occurrences(render, "iskron_case("), 1, render);
  for (const value of ["№7", "№8", "nks-dev", "@other/run", "777", "89"])
    assert(render.includes(value), `${value}: ${render}`);
  assert(!render.includes("адресованные строками ниже"), render);
});

test("equal case numbers in different graphs keep separate counts and cursors", () => {
  const a = reply();
  const b = { ...reply(), room: { ...a.room, realm: "@other/run" }, entry_id: 90 };
  const render = batchHead([a, b, { ...a, entry_id: 700 }]);
  assert.equal(occurrences(render, "№7"), 2, render);
  assert.equal(occurrences(render, "iskron_case("), 1, render);
  assert.match(render, /realm="nks-dev", since=699/);
  assert.match(render, /realm="@other\/run", since=89/);
});

test("compact counts remain quiet in both languages, but addressed records never do", () => {
  try {
    for (const lang of ["ru", "en"]) {
      setLang(lang);
      const a = roomFrame("progress", { entry_id: 4 });
      const b = { ...a, room: { ...a.room, seq: 8 }, entry_id: 12 };
      for (const frames of [[a], [a, b]]) {
        const render = batchHead(frames);
        assert(quiet(render), render);
      }
      for (const frames of [[reply()], [reply(), b], [a, reply()], [a, b, reply()]]) {
        const render = batchHead(frames);
        assert(!quiet(render), render);
      }
      assert(!quiet(`${batchHead([a, b])}\n${frameToText(reply(), "")}`));
    }
  } finally {
    setLang("ru");
  }
});

test("a clipped stale batch has one mine hint, with shown cursors but no repeated calls", () => {
  try {
    for (const lang of ["ru", "en"]) {
      setLang(lang);
      const frames = Array.from({ length: 21 }, (_, i) =>
        roomFrame("progress", { entry_id: i + 1 }),
      );
      const text = staleBatch(frames, () => false).text;
      assert.equal(occurrences(text, "iskron_case("), 1, text);
      assert(text.includes('action="mine"'), text);
      assert(text.includes('realm="nks-dev", since=0'), text);
      assert(quiet(text), text);
      const b = { ...frames[0], room: { ...frames[0].room, seq: 8 } };
      assert(quiet(caseCountLines([frames[0], b], true).join("\n")));
    }
  } finally {
    setLang("ru");
  }
});

test("queued legacy count-only frames remain quiet, including the old stale head", () => {
  for (const lang of ["ru", "en"]) {
    const T = FRAME_TEXT[lang];
    const old =
      T.count("№7 «Стенд»", 1, 0) +
      T.noneYours() +
      T.inFull(T.caseHistory('realm="nks-dev", action="history", room=7', 0)) +
      ".";
    assert(quiet(old), old);
    assert(quiet(`${STALE[lang].head(1, 1, true)}\n${old}`), old);
  }
});
