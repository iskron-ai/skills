// Перевод записи держания прежней сборки (граф места rN или голым слагом) на ключ @owner/slug
// (граф @nks/nks-dev: решение #8200, вопрос #8677, дело №1571; холодное ревью PR #569):
// отказ списка графов не держится негативом, просроченная запись список не зовёт, прежний
// ключ записи, вытесненной канонической, не теряется.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { holdFilePathOf } from "../shared/standings.ts";
import { setup, stand, textOf, until } from "./ownseat-kit.mjs";

const OLD_KEY = "proba--931--nks-dev";
const CANON_KEY = "proba--931--_nks_nks-dev";
const REFUSED = { isError: true, content: [{ type: "text", text: "list refused" }] };

const records = (dir) =>
  readdirSync(join(dir, "standings"))
    .filter((f) => f.endsWith(".hold"))
    .map((f) => ({ f, rec: JSON.parse(readFileSync(join(dir, "standings", f), "utf8")) }));
const registers = (fake) =>
  fake.state.calls
    .filter((c) => c.name === "iskron_channel" && c.arguments?.action === "register")
    .map((c) => c.arguments.realm);

/** A seat stood and left without goodbye; its record as an earlier build wrote it (bare slug). */
async function earlierRecord(t, { keepCanon = false, age = 0 } = {}) {
  const kit = await setup(t);
  const first = await kit.up();
  const r = await stand(first, { realm: "@nks/nks-dev", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, `${textOf(r)}\n${first.stderr}`);
  await until(() => kit.fake.state.ws.size === 1, "the socket");
  first.kill();
  await until(() => kit.fake.state.ws.size === 0, "the socket to close");
  const [{ f, rec }] = records(kit.dir);
  if (!keepCanon) unlinkSync(join(kit.dir, "standings", f));
  const at = Date.now() - age;
  writeFileSync(
    holdFilePathOf(kit.dir, OLD_KEY),
    JSON.stringify({ ...rec, realm: "nks-dev", key: OLD_KEY, at }) + "\n",
  );
  return kit;
}

/** A stand refused before it takes anything (the owner's role) — the move of records still runs. */
async function touch(b, fake) {
  await fake.control({ kartaTypes: { 1226: "主" } });
  const r = await stand(b, { realm: "@nks/nks-dev", karta: 1226, name: "kasanie" });
  assert.ok(r.result?.isError, textOf(r));
}

test("a refused graph list keeps no negative: the next return asks again, the record moves and registers @owner/slug", async (t) => {
  const { fake, dir, up } = await earlierRecord(t);
  await fake.control({ bareOwnOnly: true });
  fake.state.realmResult = REFUSED;
  const next = await up();
  await touch(next, fake);
  const asked = fake.state.counts.realm_list ?? 0;
  assert.ok(asked >= 1, "the list was asked");
  assert.deepEqual(
    records(dir).map((x) => x.rec.realm),
    ["nks-dev"],
    "not moved without an answer",
  );
  await until(() => /graph list did not answer/.test(next.stderr), `the journal:\n${next.stderr}`);
  assert.doesNotMatch(next.stderr, /is not in the graph list/, "a silent list is not «not in it»");
  fake.state.realmResult = null; // the list answers now
  const before = registers(fake).length;
  const back = await next.call("iskron/resume", { key: OLD_KEY });
  assert.equal(back.result?.resumed, true, `${JSON.stringify(back)}\n${next.stderr}`);
  assert.ok((fake.state.counts.realm_list ?? 0) > asked, "asked again");
  assert.deepEqual(registers(fake).slice(before), ["@nks/nks-dev"]);
  assert.equal(fake.state.counts.bare_refused ?? 0, 0, "no bare name reached the server");
  assert.deepEqual(
    records(dir).map((x) => x.rec.realm),
    ["@nks/nks-dev"],
  );
});

test("an answered list without the graph is said once as «not in the graph list», not as silence", async (t) => {
  const { fake, up } = await earlierRecord(t);
  fake.state.realms = [{ short: "r7", canon: "@nks/drugoy", ownerKind: "organization" }];
  const next = await up();
  await touch(next, fake);
  await until(() => /is not in the graph list/.test(next.stderr), `the journal:\n${next.stderr}`);
  assert.doesNotMatch(next.stderr, /graph list did not answer/);
});

test("an expired record of a bare slug asks no graph list in a new session", async (t) => {
  const { fake, up } = await earlierRecord(t, { age: 7 * 3600_000 });
  const next = await up();
  await touch(next, fake);
  assert.equal(fake.state.counts.realm_list ?? 0, 0, "no return takes it — no list for it");
});

test("a record already under the canonical key keeps the earlier record's key when that one goes", async (t) => {
  const { fake, dir, up } = await earlierRecord(t, { keepCanon: true });
  assert.equal(records(dir).length, 2);
  const next = await up();
  await touch(next, fake);
  await until(() => records(dir).length === 1, `the earlier record gone:\n${next.stderr}`);
  const [{ rec }] = records(dir);
  assert.equal(rec.key, CANON_KEY);
  assert.equal(rec.formerKey, OLD_KEY, JSON.stringify(rec));
});
