// Адрес графа места — @owner/slug до register и в записи держания (граф @nks/nks-dev:
// решение #8200, спека #8201, вопрос #8677, дело №1571). После выпуска резолвера имя без
// префикса доходит только до своего графа учётки: место графа организации, занятое голым
// слагом, на register вернулось бы 404. Фейк с bareOwnOnly отвечает так, как api после выпуска.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { holdFilePathOf } from "../shared/standings.ts";
import { setup, stand, textOf, until } from "./ownseat-kit.mjs";

const sent = (fake, action) =>
  fake.state.calls
    .filter((c) => c.name === "iskron_channel" && c.arguments?.action === action)
    .map((c) => c.arguments.realm);
const records = (dir) =>
  readdirSync(join(dir, "standings"))
    .filter((f) => f.endsWith(".hold"))
    .map((f) => ({ f, rec: JSON.parse(readFileSync(join(dir, "standings", f), "utf8")) }));

for (const given of ["nks-dev", "r5"])
  test(`iskron_stand(realm="${given}") of an organization's graph goes to connect and register as @nks/nks-dev, and the hold record keeps @nks/nks-dev`, async (t) => {
    const { fake, dir, up } = await setup(t);
    await fake.control({ bareOwnOnly: true });
    const b = await up();
    const r = await stand(b, { realm: given, karta: 931, name: "proba" });
    assert.ok(!r.result?.isError, `${textOf(r)}\n${b.stderr}`);
    assert.deepEqual(sent(fake, "connect"), ["@nks/nks-dev"]);
    assert.deepEqual(sent(fake, "register"), ["@nks/nks-dev"]);
    assert.equal(fake.state.counts.bare_refused ?? 0, 0, "no bare name reached the server");
    assert.deepEqual(
      records(dir).map((x) => x.rec.realm),
      ["@nks/nks-dev"],
    );
  });

test('iskron_stand(realm="mind") goes as is — the own personal graph', async (t) => {
  const { fake, dir, up } = await setup(t);
  await fake.control({ bareOwnOnly: true });
  const b = await up();
  const r = await stand(b, { realm: "mind", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, `${textOf(r)}\n${b.stderr}`);
  assert.deepEqual(sent(fake, "register"), ["mind"]);
  assert.deepEqual(
    records(dir).map((x) => x.rec.realm),
    ["mind"],
  );
});

test("an earlier build's hold record of a bare slug: the return by its key after a daemon change registers @nks/nks-dev and rewrites the record", async (t) => {
  const { fake, dir, up } = await setup(t);
  const first = await up();
  const r = await stand(first, { realm: "@nks/nks-dev", karta: 931, name: "proba" });
  assert.ok(!r.result?.isError, `${textOf(r)}\n${first.stderr}`);
  await until(() => fake.state.ws.size === 1, "the socket");
  first.kill(); // the daemon gone without goodbye: the record stays
  await until(() => fake.state.ws.size === 0, "the socket to close");
  // The record as an earlier build wrote it: the graph and the key as the agent named it.
  const [{ f, rec }] = records(dir);
  const oldKey = "proba--931--nks-dev";
  unlinkSync(join(dir, "standings", f));
  writeFileSync(
    holdFilePathOf(dir, oldKey),
    JSON.stringify({ ...rec, realm: "nks-dev", key: oldKey, at: Date.now() }) + "\n",
  );
  await fake.control({ bareOwnOnly: true }); // the resolver after the release
  const before = sent(fake, "register").length;
  const next = await up();
  const back = await next.call("iskron/resume", { key: oldKey });
  assert.equal(back.result?.resumed, true, `${JSON.stringify(back)}\n${next.stderr}`);
  assert.deepEqual(sent(fake, "register").slice(before), ["@nks/nks-dev"]);
  assert.equal(fake.state.counts.bare_refused ?? 0, 0, "no bare name reached the server");
  assert.doesNotMatch(back.result.word, /register.*(отказ|refused)/i, back.result.word);
  assert.deepEqual(
    records(dir).map((x) => x.rec.realm),
    ["@nks/nks-dev"],
    "the record is rewritten to @owner/slug",
  );
});
