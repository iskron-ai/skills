// The taken word of a raised root (graph @nks/nks-dev, #10043): it names only a graph the claim
// was made in — a claim without a realm string leaves no word naming «undefined».
import assert from "node:assert/strict";
import { test } from "node:test";

import { createSpawnStarts } from "../opencode/spawned-for.ts";

const pair = { invite: 7, room: "70efab85-1f3b-46a2-a279-c9e806a9b371" };
const receipt = {
  structuredContent: {
    action: "register",
    seats: [{ seat_id: "seat-1", standing: "@alari:proba", spawned_for: pair }],
  },
};

async function claimed(args) {
  const starts = createSpawnStarts(async () => []);
  await starts.prompt("s", `spawned_for: ${JSON.stringify(pair)}\nhello`, "m1");
  starts.verify("s", { action: "register", name: "proba", spawned_for: pair, ...args }, receipt);
  return starts;
}

test("a claim without a realm string: no taken word, never «undefined»", async () => {
  for (const realm of [undefined, 5, ""]) {
    const word = (await claimed(realm === undefined ? {} : { realm })).taken("s");
    assert.equal(word, null, `realm ${JSON.stringify(realm)}: ${word}`);
  }
});

test("a claim with its realm names that graph", async () => {
  const word = (await claimed({ realm: "@nks/nks-dev" })).taken("s");
  assert.ok(word?.includes("@nks/nks-dev") && word.includes(pair.room), word ?? "(none)");
});
