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
  await starts.prompt("s", `iskron/spawned_for: ${JSON.stringify(pair)}\nhello`, "m1");
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

// Only a repeated registration of the held pair is answered locally: a stand that sets status,
// knocks into a room, takes or mutes siblings goes to the bridge (#9959).
test("a stand carrying an act beyond registration reaches the bridge", async () => {
  const acts = [
    { status: "busy" },
    { room: pair.room },
    { room_karta: "1226" },
    { take: true },
    { mute_siblings: true },
    { repeat_knock: true },
  ];
  for (const act of acts) {
    const starts = await claimed({ realm: "@nks/nks-dev", karta: "931" });
    const args = { realm: "@nks/nks-dev", karta: "931", ...act };
    assert.equal(starts.apply("s", "iskron_stand", args), undefined, JSON.stringify(act));
    assert.ok(!Object.hasOwn(args, "spawned_for"), `${JSON.stringify(act)}: pair re-attached`);
  }
});

test("a claim with its realm names that graph", async () => {
  const word = (await claimed({ realm: "@nks/nks-dev" })).taken("s");
  assert.ok(word?.includes("@nks/nks-dev") && word.includes(pair.room), word ?? "(none)");
});

// #9959 v16, #9969 v12: the orchestrator submits the pair and the brief on one line — a
// multi-line --prompt the terminal turns into a paste that is never sent. The plugin of the
// same delivery admits the one-line form exactly as the two-line one.
test("the one-line form seats the pair and hands the session the same-line remainder", async () => {
  const starts = createSpawnStarts(async () => []);
  const one = await starts.prompt(
    "s1",
    `iskron/spawned_for: ${JSON.stringify(pair)} brief after the pair`,
    "m1",
  );
  assert.equal(one, "brief after the pair");
  const two = await starts.prompt(
    "s2",
    `iskron/spawned_for: ${JSON.stringify(pair)}\nbrief line`,
    "m2",
  );
  assert.equal(two, "brief line");
  for (const s of ["s1", "s2"]) assert.ok(starts.has(s), s);
});

// #9959: the line carries this delivery's mark; another delivery's plugin in the same harness
// (its own mark, or the bare line of an older one) leaves it be — and so does this one.
test("a pair line without this delivery's mark is ordinary text: no seat, no refusal", async () => {
  const starts = createSpawnStarts(async () => []);
  for (const [i, text] of [
    `spawned_for: ${JSON.stringify(pair)} brief`,
    `spawned_for: ${JSON.stringify(pair)}\nbrief`,
    `verstak/spawned_for: ${JSON.stringify(pair)} brief`,
  ].entries()) {
    assert.equal(await starts.prompt(`s${i}`, text, `m${i}`), text);
    assert.equal(starts.taken(`s${i}`), null);
  }
});

for (const [why, text] of [
  ["no space after the object", `iskron/spawned_for: ${JSON.stringify(pair)}x`],
  ["space and no remainder", `iskron/spawned_for: ${JSON.stringify(pair)} `],
])
  test(`the one-line form refuses a broken remainder: ${why}`, async () => {
    const starts = createSpawnStarts(async () => []);
    await assert.rejects(starts.prompt("s", text, "m"), /spawned_for/);
    assert.ok(!starts.has("s"));
  });
