// #10121: help authority comes from the observed list, including cached lists.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { seated, usage } from "./context-gate-kit.mjs";
import { stand, textOf, write } from "./ownseat-kit.mjs";

const tool = (name, action = true) => ({
  name,
  inputSchema: { type: "object", properties: action ? { action: { type: "string" } } : {} },
});
const help = (b, name) => b.call("tools/call", { name, arguments: { action: "?" } });
const gated = (r) => /контекст сжат|context.*compact/i.test(textOf(r));

test("context gate: a new OpenCode bridge takes its own initialization snapshot of cached schemas", async (t) => {
  const { b, fake, up } = await seated(t);
  fake.state.tools = [tool("iskron_arrow")];
  await b.call("tools/list");
  await usage(b, 100000);
  await usage(b, 10000);
  b.kill();
  await b.stop();
  const next = await up(undefined, {}, [], { name: "opencode-iskron", version: "2.0.4" });
  await stand(next, { realm: "nks-dev", karta: "931", name: "context-gate" });
  // Like an additional plugin slot: initialized, using an existing tool catalogue,
  // not fetching a new list as a side effect of a gated call.
  assert.ok(!gated(await help(next, "iskron_arrow")), "known cached schema at initialization");
  assert.equal((await write(next)).result?.isError, true, "cached schema is not recovery");
  fake.state.tools = [tool("iskron_arrow", false), tool("iskron_new_help")];
  await fake.control({ kill_session: true });
  await next.call("tools/call", {
    name: "iskron_look",
    arguments: { realm: "nks-dev", node_id: "931" },
  });
  assert.ok(gated(await help(next, "iskron_arrow")), "recheck replaces initialization cache");
  assert.ok(!gated(await help(next, "iskron_new_help")), "cached catalogue is rechecked on reopen");
});

test("context gate: changed schemas replace help authority; unknown and spoofed help stay gated", async (t) => {
  const { b, fake } = await seated(t);
  await usage(b, 100000);
  await usage(b, 10000);
  for (const name of ["iskron_arrow", "iskron_future_tool", "iskron_update", "iskron_case"])
    assert.ok(gated(await help(b, name)), `unknown schema ${name}`);
  fake.state.tools = [tool("iskron_arrow"), tool("iskron_update", false)];
  await b.call("tools/list");
  assert.ok(!gated(await help(b, "iskron_arrow")), "declared help on a write-capable tool");
  assert.ok(gated(await help(b, "iskron_update")), "action spoof on known schema without action");
  assert.ok(gated(await help(b, "iskron_future_tool")), "unknown tool");
  assert.equal((await write(b)).result?.isError, true, "help cannot lift pending");
  await fake.control({ list_changed: true });
  await b.call("tools/call", {
    name: "iskron_look",
    arguments: { realm: "nks-dev", node_id: "931" },
  });
  assert.ok(
    gated(await help(b, "iskron_arrow")),
    "announced surface change invalidates old authority",
  );
  fake.state.tools = [tool("iskron_arrow", false), tool("iskron_new_help")];
  await b.call("tools/list");
  assert.ok(gated(await help(b, "iskron_arrow")), "removed action is no longer help");
  assert.ok(!gated(await help(b, "iskron_new_help")), "new declared help needs no static list");
  fake.state.tools = [];
  await b.call("tools/list");
  assert.ok(gated(await help(b, "iskron_new_help")), "removed tool loses authority");
});

test("context gate: a reopened session uses its newly observed schemas before harness reload", async (t) => {
  const { b, fake } = await seated(t);
  fake.state.tools = [tool("iskron_arrow")];
  await b.call("tools/list");
  await usage(b, 100000);
  await usage(b, 10000);
  fake.state.tools = [tool("iskron_arrow", false), tool("iskron_new_help")];
  await fake.control({ kill_session: true });
  await b.call("tools/call", {
    name: "iskron_look",
    arguments: { realm: "nks-dev", node_id: "931" },
  });
  assert.ok(gated(await help(b, "iskron_arrow")), "recheck removed action");
  assert.ok(!gated(await help(b, "iskron_new_help")), "recheck supplied new declared help");
  assert.equal((await write(b)).result?.isError, true, "reopen is not recovery");
});

test("context gate: help uses a list actually served from cache, not an unrelated disk schema", async (t) => {
  const { b, fake, dir } = await seated(t);
  fake.state.tools = [tool("iskron_update", false)];
  await b.call("tools/list");
  await usage(b, 100000);
  await usage(b, 10000);
  const path = join(
    dir,
    readdirSync(dir).find((f) => f.endsWith(".server-answers")),
  );
  const cache = JSON.parse(readFileSync(path, "utf8"));
  cache.tools.tools.push(tool("iskron_arrow"));
  writeFileSync(path, JSON.stringify(cache));
  assert.ok(gated(await help(b, "iskron_arrow")), "unserved cache cannot authorize help");
  fake.state.mcpDrop = 20; // lose HTTP answers, not the seat's independent channel
  assert.ok((await b.call("tools/list")).result?.tools, "network refusal serves cached list");
  fake.state.mcpDrop = 0;
  assert.ok(!gated(await help(b, "iskron_arrow")), "served cached schema authorizes help");
  assert.ok(
    gated(await help(b, "iskron_update")),
    "cached schema without action cannot authorize spoof",
  );
  assert.equal((await write(b)).result?.isError, true, "cached help does not lift pending");
});
