// #10121: built bridge, isolated local MCP; never a production endpoint.
import assert from "node:assert/strict";
import { test } from "node:test";

import { loaded, recovery, seated, usage } from "./context-gate-kit.mjs";
import { setup, stand, textOf, write } from "./ownseat-kit.mjs";

test("context gate: a fill collapse refuses writes, not reads or help, until recovery", async (t) => {
  const { up, fake } = await setup(t);
  fake.state.tools = ["iskron_case", "iskron_arrow"].map((name) => ({
    name,
    inputSchema: { type: "object", properties: { action: { type: "string" } } },
  }));
  const b = await up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  await b.call("tools/list");
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
    ["iskron_arrow", { action: "?" }],
  ]) {
    const read = await b.call("tools/call", { name, arguments: args });
    assert.doesNotMatch(textOf(read), /контекст сжат|context.*compact/i);
  }
  assert.equal((await write(b)).result?.isError, true, "reading did not lift the mark");
  assert.ok(
    fake.state.calls.some((c) => c.name === "iskron_arrow"),
    "declared help reached MCP",
  );
  const registers = () => fake.state.placeArgs.filter((p) => p.action === "register").length;
  const beforeConfirmation = registers();
  const confirmed = await stand(b, { realm: "nks-dev", context_restored: true });
  assert.ok(!confirmed.result?.isError, textOf(confirmed));
  assert.equal(registers(), beforeConfirmation, "confirmation is local, without register");
  assert.ok(!(await write(b)).result?.isError, "explicit confirmation permits the retry");
});

test("context gate: the door skill releases a generation, a role skill does not", async (t) => {
  const { b, up } = await seated(t, "iskron,writing,reconcile");
  await usage(b, 160000);
  await usage(b, 40000);
  await loaded(b, "w", "writing");
  await loaded(b, "r", "reconcile");
  assert.equal((await write(b)).result?.isError, true, "role skills are not the door");
  await loaded(b, "failed", "iskron", false);
  assert.equal((await write(b)).result?.isError, true, "a failed load of the door did not count");
  await recovery(b, "begin", "old", "iskron");
  await usage(b, 10000);
  await recovery(b, "end", "old", "iskron");
  assert.equal(
    (await write(b)).result?.isError,
    true,
    "a load of the old generation does not count",
  );
  const other = await up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  await loaded(other, "foreign", "iskron");
  assert.equal((await write(b)).result?.isError, true, "another bridge cannot release this one");
  const refused = await write(b);
  assert.equal(refused.result?.isError, true, "a blind retry is no recovery");
  const word = textOf(refused);
  assert.match(word, /Загрузи скилл iskron|Load the iskron skill/, "the word names the load");
  assert.doesNotMatch(word, /скиллы роли|role skills/, "the word asks for no role skills");
  await loaded(b, "d", "iskron");
  assert.ok(!(await write(b)).result?.isError, "the door's load ends the recovery: no loop");
});

test("context gate: the role's skill list decides nothing: unknown or empty, the door alone releases", async (t) => {
  const { b, fake } = await seated(t);
  await usage(b, 160000);
  await usage(b, 40000);
  await loaded(b, "w", "writing");
  assert.equal((await write(b)).result?.isError, true, "a role skill is not the door");
  fake.state.kartaSkills = { 931: "" };
  assert.equal((await write(b)).result?.isError, true, "an empty role list is no recovery");
  await loaded(b, "d", "iskron");
  assert.ok(!(await write(b)).result?.isError, "the door releases whatever the role lists");
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

test("context gate: an unknown alias cannot clear a collapse or trigger graph resolution", async (t) => {
  const { b, fake } = await seated(t);
  await usage(b, 160000);
  await usage(b, 40000);
  const before = fake.state.counts.realm_list;
  const confirming = await stand(b, { realm: "r777", context_restored: true });
  assert.equal(fake.state.counts.realm_list, before);
  await usage(b, 10000);
  assert.equal(confirming.result?.isError, true, "unknown alias is not confirmed");
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

test("context gate: a known pending mark survives bridge restart; the door's load after it releases", async (t) => {
  const { b, up } = await seated(t, "iskron,writing");
  await usage(b, 100000);
  await usage(b, 10000);
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
  assert.equal((await write(back)).result?.isError, true, "a role skill is not the door");
  await loaded(back, "door", "iskron");
  assert.ok(!(await write(back)).result?.isError, "the door's load after the restart releases");
});
