// #10121: built bridge, isolated local MCP; never a production endpoint.
import assert from "node:assert/strict";
import { test } from "node:test";

import { loaded, recovery, seated, usage } from "./context-gate-kit.mjs";
import { setup, stand, textOf, until, write } from "./ownseat-kit.mjs";

test("context gate: a fill collapse refuses writes, not reads or help, until recovery", async (t) => {
  const { up, fake } = await setup(t);
  const b = await up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  assert.ok((await stand(b, { realm: "nks-dev", karta: "931", name: "context-gate" })).result);
  await usage(b, 150000);
  assert.ok(!(await write(b)).result?.isError, "before a collapse writing is unchanged");
  await usage(b, 30000);
  const refused = await write(b);
  assert.equal(refused.result?.isError, true, "the first write is refused");
  assert.match(textOf(refused), /контекст сжат|context.*compact/i);
  assert.equal((await write(b)).result?.isError, true, "blind retry is not recovery");
  for (const [name, args] of [
    ["iskron_look", { realm: "nks-dev", node_id: "931" }],
    ["iskron_case", { action: "read", room: "1", realm: "nks-dev" }],
    ["iskron_case", { action: "?" }],
  ]) {
    const read = await b.call("tools/call", { name, arguments: args });
    assert.doesNotMatch(textOf(read), /контекст сжат|context.*compact/i);
  }
  assert.equal((await write(b)).result?.isError, true, "reading did not lift the mark");
  const registers = () => fake.state.placeArgs.filter((p) => p.action === "register").length;
  const beforeConfirmation = registers();
  const confirmed = await stand(b, { realm: "nks-dev", context_restored: true });
  assert.ok(!confirmed.result?.isError, textOf(confirmed));
  assert.equal(registers(), beforeConfirmation, "confirmation is local, without register");
  assert.ok(!(await write(b)).result?.isError, "explicit confirmation permits the retry");
});

test("context gate: all role skills and the door belong to one generation and seat", async (t) => {
  const { b, up } = await seated(t, "iskron,writing,reconcile");
  await usage(b, 160000);
  await usage(b, 40000);
  await loaded(b, "failed", "iskron", false);
  await loaded(b, "w", "writing");
  await loaded(b, "r", "reconcile");
  assert.equal((await write(b)).result?.isError, true, "failed door did not count");
  await recovery(b, "begin", "old", "iskron");
  await usage(b, 10000);
  await recovery(b, "end", "old", "iskron");
  await loaded(b, "d", "iskron");
  assert.equal((await write(b)).result?.isError, true, "old generation lost its role loads");
  const other = await up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  await loaded(other, "foreign", "writing");
  assert.equal((await write(b)).result?.isError, true, "another bridge cannot release this one");
  await loaded(b, "new-w", "writing");
  assert.equal((await write(b)).result?.isError, true, "one role skill is not the whole list");
  await loaded(b, "new-r", "reconcile");
  assert.ok(!(await write(b)).result?.isError);
});

test("context gate: unknown role list never means empty; confirmed empty needs the door", async (t) => {
  const { b, fake } = await seated(t);
  await usage(b, 160000);
  await usage(b, 40000);
  await loaded(b, "d", "iskron");
  await loaded(b, "w", "writing");
  assert.equal((await write(b)).result?.isError, true);
  fake.state.kartaSkills = { 931: "" };
  await usage(b, 10000);
  assert.equal((await write(b)).result?.isError, true);
  await loaded(b, "d2", "iskron");
  assert.ok(!(await write(b)).result?.isError);
});

test("context gate: late usage cannot veto a write already sent; a model/window change is not a collapse", async (t) => {
  const { b } = await seated(t);
  await usage(b, 160000);
  assert.ok(!(await write(b)).result?.isError, "no low report yet: no early-signal promise");
  await b.call("iskron/usage", { context: 10000, window: 100000, model: "other" });
  assert.ok(!(await write(b)).result?.isError, "changed model/window is not compaction evidence");
  await usage(b, 160000);
  await usage(b, 40000);
  for (const [name, args] of [
    ["iskron_update", { action: "?" }],
    ["iskron_future_tool", { action: "read" }],
    ["iskron_case", { action: "line" }],
  ])
    assert.equal((await b.call("tools/call", { name, arguments: args })).result?.isError, true);
  const foreign = await stand(b, { realm: "nks-dev", karta: "932", context_restored: true });
  assert.equal(foreign.result?.isError, true);
  assert.equal((await write(b)).result?.isError, true, "foreign confirmation changed nothing");
});

test("context gate: exact half is a collapse, half plus one is not; missing/zero samples are not evidence", async (t) => {
  const { b } = await seated(t);
  await usage(b, 100000);
  await usage(b, 50001);
  assert.ok(!(await write(b)).result?.isError);
  await usage(b, 100000);
  await usage(b, 50000);
  assert.equal((await write(b)).result?.isError, true);
  await stand(b, { realm: "nks-dev", context_restored: true });
  for (const params of [
    { context: 10000, model: "probe" },
    { context: 10000, window: 200000 },
    { context: 0, window: 200000, model: "probe" },
    { context: -1, window: 200000, model: "probe" },
  ]) {
    await usage(b, 100000);
    await b.call("iskron/usage", params);
    assert.ok(!(await write(b)).result?.isError, JSON.stringify(params));
  }
});

test("context gate: confirmation awaiting realm resolution cannot clear a newer collapse", async (t) => {
  const { b, fake } = await seated(t);
  await usage(b, 160000);
  await usage(b, 40000);
  fake.state.realms.push({ short: "r777", canon: "@nks/nks-dev", ownerKind: "organization" });
  fake.state.realmDelayMs = 300;
  const before = fake.state.counts.realm_list;
  const confirming = stand(b, { realm: "r777", context_restored: true });
  await until(() => fake.state.counts.realm_list > before, "confirmation resolving fresh alias");
  await usage(b, 10000);
  assert.equal((await confirming).result?.isError, true, "old confirmation was stale");
  assert.equal((await write(b)).result?.isError, true, "new generation remains gated");
});

test("context gate: other harnesses do not silently acquire the OpenCode gate", async (t) => {
  const { up } = await setup(t);
  for (const name of ["pi-iskron", "claude-code", "codex"]) {
    const b = await up(undefined, {}, [], { name, version: "probe" });
    const held = await stand(b, { realm: "nks-dev", karta: "931", name: `gate-${name}` });
    assert.ok(!held.result?.isError, textOf(held));
    await usage(b, 100000);
    await usage(b, 10000);
    assert.ok(!(await write(b)).result?.isError, name);
  }
});

test("context gate: a known pending mark survives bridge restart; old loads do not", async (t) => {
  const { b, up } = await seated(t, "iskron,writing");
  await usage(b, 100000);
  await usage(b, 10000);
  await loaded(b, "old-door", "iskron");
  assert.equal((await write(b)).result?.isError, true);
  b.kill();
  await b.stop();
  const back = await up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  await stand(back, { realm: "nks-dev", karta: "931", name: "context-gate" });
  assert.equal(
    (await write(back)).result?.isError,
    true,
    "known pending was restored before writing",
  );
  await loaded(back, "writing", "writing");
  assert.equal((await write(back)).result?.isError, true, "pre-restart door load is not reused");
  await stand(back, { realm: "nks-dev", context_restored: true });
  assert.ok(!(await write(back)).result?.isError);
});
