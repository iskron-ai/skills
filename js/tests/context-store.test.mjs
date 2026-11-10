import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { seenFilePathOf } from "../shared/standings.ts";
import { seated, usage } from "./context-gate-kit.mjs";
import { stand, textOf, write } from "./ownseat-kit.mjs";

const marker = (dir, fake) =>
  `${seenFilePathOf(
    dir,
    JSON.stringify(["@nks/nks-dev", "931", "context-gate"]),
    fake.mcpUrl,
  )}.context-gate.json`;
const read = (b) =>
  b.call("tools/call", { name: "iskron_look", arguments: { realm: "nks-dev", node_id: "931" } });

test("context gate storage: a corrupt marker refuses writes but leaves reads available", async (t) => {
  const { b, dir, fake } = await seated(t);
  for (const text of ["", "{bad", "null", '{"version":2}', '{"version":1,"pending":false}']) {
    writeFileSync(marker(dir, fake), text, { mode: 0o600 });
    const got = await write(b);
    assert.equal(got.result?.isError, true, text);
    assert.match(textOf(got), /хранен|сохранен|metadata/i);
    assert.ok(!(await read(b)).result?.isError);
    assert.equal(
      (await stand(b, { realm: "nks-dev", context_restored: true })).result?.isError,
      true,
    );
  }
});

test("context gate storage: a failed save cannot release writing", async (t) => {
  const { b, dir, fake } = await seated(t);
  const path = marker(dir, fake);
  mkdirSync(path);
  await usage(b, 100000);
  const failed = await usage(b, 10000);
  assert.ok(failed.error || failed.result?.isError, "the save failure is not reported as success");
  assert.equal((await write(b)).result?.isError, true);
  assert.ok(!(await read(b)).result?.isError);
  assert.equal(
    (await stand(b, { realm: "nks-dev", context_restored: true })).result?.isError,
    true,
  );
  rmdirSync(path);
  const fixed = await stand(b, { realm: "nks-dev", context_restored: true });
  assert.ok(!fixed.result?.isError, textOf(fixed));
  assert.ok(!(await write(b)).result?.isError);
});

test("context gate storage: clearing must persist before the mark is released", async (t) => {
  const { b, dir, fake } = await seated(t);
  await usage(b, 100000);
  await usage(b, 10000);
  const path = marker(dir, fake);
  const pending = JSON.parse(readFileSync(path, "utf8"));
  const proof = `${path}.${pending.generation}.confirmed`;
  assert.equal(statSync(path).mode & 0o777, 0o600);
  mkdirSync(proof);
  assert.equal(
    (await stand(b, { realm: "nks-dev", context_restored: true })).result?.isError,
    true,
  );
  assert.equal((await write(b)).result?.isError, true);
  rmdirSync(proof);
  const fixed = await stand(b, { realm: "nks-dev", context_restored: true });
  assert.ok(!fixed.result?.isError, textOf(fixed));
  assert.equal(JSON.parse(readFileSync(proof, "utf8")).pending, false);
  assert.ok(!(await write(b)).result?.isError);
});

test("context gate storage: a late proof of an old generation cannot clear a newer mark", async (t) => {
  const { b, dir, fake, up } = await seated(t);
  await usage(b, 100000);
  await usage(b, 10000);
  const path = marker(dir, fake);
  const old = JSON.parse(readFileSync(path, "utf8"));
  await usage(b, 2000);
  const newer = JSON.parse(readFileSync(path, "utf8"));
  assert.notEqual(newer.generation, old.generation);
  writeFileSync(`${path}.${old.generation}.confirmed`, JSON.stringify({ ...old, pending: false }), {
    mode: 0o600,
  });
  assert.equal((await write(b)).result?.isError, true);
  await stand(b, { realm: "nks-dev", context_restored: true });
  assert.ok(!(await write(b)).result?.isError);
  b.kill();
  await b.stop();
  const back = await up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  await stand(back, { realm: "nks-dev", karta: "931", name: "context-gate" });
  assert.ok(
    !(await write(back)).result?.isError,
    "confirmed generation remains confirmed after restart",
  );
});
