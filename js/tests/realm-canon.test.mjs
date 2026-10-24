// Адрес графа места — @owner/slug до register и в записи держания (граф @nks/nks-dev:
// решение #8200, спека #8201, вопрос #8677, дело №1571). После выпуска резолвера имя без
// префикса доходит только до своего графа учётки: место графа организации, занятое голым
// слагом, на register вернулось бы 404. Фейк с bareOwnOnly отвечает так, как api после выпуска.
//
// ISKRON_BRIDGE_PATH наводит пробу на любую копию моста.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { holdFilePathOf } from "../shared/standings.ts";
import { channel, FILE, NODE, setup, stand, textOf, until } from "./ownseat-kit.mjs";

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

// The graph list is read once, when a name is not resolved yet: the aliases it gave serve the
// next stand, register and raw channel move of the session; a full address reads no list.
test("the graph list is read only for a name not yet resolved — not on every stand or register", async (t) => {
  const { fake, up } = await setup(t);
  const lists = () => fake.state.counts.realm_list ?? 0;
  const b = await up();
  assert.ok(
    !(await stand(b, { realm: "@nks/nks-dev", karta: 931, name: "proba" })).result?.isError,
  );
  assert.equal(lists(), 0, "a full address needs no list");
  const c = await up();
  assert.ok(!(await stand(c, { realm: "nks-dev", karta: 932, name: "vtoroy" })).result?.isError);
  assert.equal(lists(), 1, "a bare slug: one list");
  assert.ok(!(await stand(c, { realm: "nks-dev", karta: 932, name: "vtoroy" })).result?.isError);
  assert.ok(!(await stand(c, { realm: "r5", karta: 932, name: "vtoroy" })).result?.isError);
  const reg = await channel(c, {
    realm: "nks-dev",
    action: "register",
    karta: 932,
    name: "vtoroy",
  });
  assert.ok(!reg.result?.isError, textOf(reg));
  assert.equal(lists(), 1, "the learnt aliases serve the next moves");
  assert.deepEqual([...new Set(sent(fake, "register"))], ["@nks/nks-dev"]);
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

// The daemon updates under live sessions: an earlier build's thin bridge and watchdog live on
// with the keys of that build. The moved seat answers them by those keys too — the seat
// beside is said back by its earlier key (that thin bridge lifts its loss only so), and the
// door listens at the earlier key's socket (that watchdog attaches only there).
test("a seat moved from an earlier build's key: its watchdog of that key attaches, and the seat beside is said back by its earlier key too", async (t) => {
  const { fake, dir, up } = await setup(t);
  const first = await up();
  const main = { realm: "@nks/nks-dev", karta: 931, name: "proba" };
  assert.ok(!(await stand(first, main)).result?.isError, first.stderr);
  const side = await stand(first, { realm: "@nks/drugoy", karta: 48, name: "proba-b" });
  assert.ok(!side.result?.isError, `${textOf(side)}\n${first.stderr}`);
  await until(() => records(dir).length === 2, "both records");
  first.kill();
  await until(() => fake.state.ws.size === 0, "the socket to close");
  // Both records as an earlier build wrote them: graphs and keys as the agent named them.
  const bare = { "@nks/nks-dev": "nks-dev", "@nks/drugoy": "drugoy" };
  const oldKeys = {};
  for (const { f, rec } of records(dir)) {
    const realm = bare[rec.realm];
    const key = `${rec.name}--${rec.karta}--${realm}`;
    oldKeys[rec.realm] = key;
    unlinkSync(join(dir, "standings", f));
    writeFileSync(
      holdFilePathOf(dir, key),
      JSON.stringify({ ...rec, realm, key, at: Date.now() }) + "\n",
    );
  }
  await fake.control({ bareOwnOnly: true });
  const next = await up();
  const back = await next.call("iskron/resume", { key: oldKeys["@nks/nks-dev"] });
  assert.equal(back.result?.resumed, true, `${JSON.stringify(back)}\n${next.stderr}`);
  const besideKeys = () =>
    next.notifications
      .filter((n) => n.params?.data?.kind === "beside")
      .map((n) => n.params.data.key);
  await until(() => besideKeys().length >= 2, `the beside words:\n${next.stderr}`);
  assert.deepEqual(besideKeys().sort(), ["proba-b--48--_nks_drugoy", oldKeys["@nks/drugoy"]]);
  assert.equal(fake.state.counts.bare_refused ?? 0, 0, "no bare name reached the server");
  const wd = spawn(NODE, [FILE, "watchdog", oldKeys["@nks/nks-dev"], "--auth-dir", dir], {
    env: { ...process.env, ISKRON_BRIDGE_NO_UPDATE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => wd.kill("SIGKILL"));
  let out = "";
  wd.stdout.on("data", (c) => (out += c));
  await until(() => /слушаю стояние/.test(out), `the earlier key's watchdog:\n${out}`);
  await fake.control({ ws_say: { name: "proba", text: "слово после переезда" } });
  await until(() => out.includes("слово после переезда"), `the word at that watchdog:\n${out}`);
});
