// The register receipt on a channel the machine shares (graph @nks/nks-dev, #9959, #8640): the
// answer lists every seat of the channel, and the name still picks exactly one.
import assert from "node:assert/strict";
import { test } from "node:test";

import { spawnReceipt } from "../shared/spawned-for.ts";

const ROOM = "201b813e-a41d-42c7-b869-a70e032c85e8";
const pair = { invite: 12, room: ROOM };
const seat = (name, id, spawned_for) => ({
  seat_id: id,
  standing: `@alari:${name}`,
  ...(spawned_for && { spawned_for }),
});
const answer = (seats) => ({ action: "register", seats });

test("receipt: a name picks its own seat among the channel's many", () => {
  const got = spawnReceipt(
    answer([seat("a.root-x", "s1"), seat("a.root-y", "s2", pair), seat("b.sub-1", "s3")]),
    pair,
    { name: "a.root-y" },
  );
  assert.deepEqual(got, { seat_id: "s2", standing: "@alari:a.root-y", spawned_for: pair });
});

test("receipt: a name matching none, two, or a seat without the pair confirms nothing", () => {
  const many = [seat("a.root-x", "s1", pair), seat("a.root-y", "s2", pair)];
  assert.equal(spawnReceipt(answer(many), pair, { name: "a.root-z" }), null);
  assert.equal(
    spawnReceipt(answer([...many, seat("a.root-y", "s4", pair)]), pair, { name: "a.root-y" }),
    null,
  );
  assert.equal(
    spawnReceipt(answer([seat("a.root-y", "s2"), seat("b", "s3")]), pair, { name: "a.root-y" }),
    null,
  );
  assert.equal(spawnReceipt(answer(many), pair, {}), null, "no identity — no receipt");
});
