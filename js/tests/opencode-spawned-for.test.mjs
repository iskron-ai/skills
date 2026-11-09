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

// №4050 [55]: a failed re-registration after the confirmed claim refuses that call only.
test("after the confirmed claim a failed register again does not shut the session", async () => {
  const starts = await claimed({ realm: "@nks/nks-dev" });
  assert.throws(() =>
    starts.verify("s", { action: "register", name: "other", spawned_for: pair }, { isError: true }),
  );
  assert.doesNotThrow(() => starts.guard("s"));
  assert.doesNotThrow(() => starts.apply("s", "iskron_case", { action: "join" }));
});

// The same pair asked again by the session that holds it: answered without the wire.
test("a stand again with the held pair is answered by the session's own seat", async () => {
  const starts = await claimed({ realm: "@nks/nks-dev", karta: "931" });
  const args = { realm: "@nks/nks-dev", karta: "931", spawned_for: pair };
  const word = starts.apply("s", "iskron_stand", args);
  assert.ok(typeof word === "string" && word.includes("@alari:proba"), String(word));
  assert.ok(word.includes(pair.room), word);
  const inherited = starts.apply("s", "iskron_stand", { realm: "@nks/nks-dev", karta: "931" });
  assert.equal(inherited, word);
  const other = { invite: 8, room: pair.room };
  assert.throws(() =>
    starts.apply("s", "iskron_stand", { realm: "@nks/nks-dev", karta: "931", spawned_for: other }),
  );
});

test("a claim with its realm names that graph", async () => {
  const word = (await claimed({ realm: "@nks/nks-dev" })).taken("s");
  assert.ok(word?.includes("@nks/nks-dev") && word.includes(pair.room), word ?? "(none)");
});
