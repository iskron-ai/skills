// Case history shape observed on LAB: line.key, line.verdict, and in_reply_to.
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCasePage } from "../bridge/orchestra-case-read.ts";
import { hasOpenShare } from "../bridge/orchestra-case-share.ts";

const seat = "seat-a";
const role = "role-a";
const e = (id, kind, fields = {}) => ({
  id,
  kind,
  author_standing_id: seat,
  to_standing_id: null,
  to_karta_node_id: null,
  in_reply_to: null,
  line: { entry_id: id, kind },
  payload: {},
  ...fields,
});
const progress = (id, key, verdict) =>
  e(id, "progress", {
    line: { entry_id: id, kind: "progress", key, verdict },
    payload: { verdict },
  });
const share = (items) =>
  hasOpenShare(parseCasePage({ items, cursor: items.at(-1)?.id ?? 0 }).entries, [seat], role);

test("the last progress by key decides whether a share is open", () => {
  assert.equal(share([progress(1, "k1", "partial")]), true);
  assert.equal(share([progress(1, "k1", "partial"), progress(2, "k1", "ok")]), false);
  assert.equal(share([progress(1, "k1", "partial"), progress(2, "k2", "ok")]), true);
});

test("unanswered questions to and from the call hold the share", () => {
  assert.equal(share([e(1, "ask", { author_standing_id: "other", to_standing_id: seat })]), true);
  assert.equal(share([e(1, "ask", { author_standing_id: "other", to_karta_node_id: role })]), true);
  assert.equal(share([e(1, "ask")]), true);
  assert.equal(
    share([e(1, "ask"), e(2, "answer", { author_standing_id: "other", in_reply_to: 1 })]),
    false,
  );
});

test("only an unanswered invitation to the call's seat holds the share", () => {
  assert.equal(share([e(1, "invite", { to_standing_id: seat })]), true);
  assert.equal(
    share([e(1, "invite", { to_standing_id: seat }), e(2, "joined", { in_reply_to: 1 })]),
    false,
  );
  assert.equal(share([e(1, "invite", { to_karta_node_id: role })]), false);
});
