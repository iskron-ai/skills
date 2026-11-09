// #9654: в тексте кадра каждый факт один раз — место одним адресом, дело одной строкой счёта.
import assert from "node:assert/strict";
import { test } from "node:test";

import { frameToText } from "../shared/frame-text.ts";
import { addresseeOf } from "../shared/room-fields.ts";
import { roomKind } from "../shared/room-kinds.ts";
import { heldText } from "../watchdog/client.ts";
import { addressed, BORIS, ME, ME_ID, progress } from "./room-frames.mjs";

const LABEL = "№7 «Стенд»";
const occurrences = (text, value) => text.split(value).length - 1;

test("a seat object is named by its address alone", () => {
  assert.equal(addresseeOf({ id: ME_ID, standing: ME, name: "proba" }).label, ME);
  assert.equal(addresseeOf({ id: "b-1", handle: "boris", name: "probe" }).label, BORIS);
});

test("a word to another seat named by an object carries its address once", () => {
  const words = roomKind(addressed(80, { id: "b-1", standing: BORIS, name: "boris" })).words;
  assert.equal(occurrences(words, BORIS), 1, words);
  assert.doesNotMatch(words, /boris \(/, words);
});

test("a held count and a lone record not to the seat of one case are one count line", () => {
  const lone = addressed(82);
  const shown = [{ frame: lone, text: (w) => frameToText(lone, "", w) }];
  const text = heldText([[progress(81)]], () => false, shown).join("\n");
  assert.equal(occurrences(text, LABEL), 1, text);
  assert.match(text, /^№7 «Стенд»: записей 2, тебе 0; /, text);
});
