// Behavioural probe for the root seating of the dsh plugin (graph @nks/nks-dev, node #11076): on
// the root's agent/created (startup, resume) the plugin seats the session on the cover's role in
// its graph through the session's own bridge, and the root's first model request waits for it.
//
// The stand-in surface, by the installed dsh 0.2.2-rc.1, NOT observed from a plugin: the tool
// registry is the service `tools` (ctx.get, as headless.ts reads `headlessStartup` — observed),
// ToolsService.get(name) (dsh-tools/lib/types/index.d.ts); an MCP tool's definition is
// {name, execute(args, exec)} — dsh-mcp-client lib/index.js:180-254, execute calls the server's
// tool and throws a refusal's text; its name mcp__<serverName>__<tool> with serverName of
// references/dsh-profile.yml (the prefix observed, #10657); agent/request is a waterfall
// (payload {agent, turn, step, signal}, next) — dsh-agent/lib/types/runtime-types.d.ts:362-367;
// agent.model.current() → {provider, model} — dsh-agent/lib/types/model-selection.d.ts:37. The
// bridge's answer is played by the stand-in: it writes the hold record the session's bridge
// writes (client dsh-mcp-client, this directory, now).
//
// ISKRON_DSH_PLUGIN points the probe at any copy (a past revision) so it can be shown red
// before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { envName, ROOT_SEAT } from "../delivery/index.ts";
import { holdFilePathOf, keyFilePathOf } from "../shared/standings.ts";
import { BUILT } from "./built.mjs";

const SOURCE =
  process.env.ISKRON_DSH_PLUGIN ||
  join(BUILT, "skills", "establish-mcp", "references", "dsh-plugin", "index.js");
const PLUGIN = (await import(`${SOURCE}?rootseat`)).apply;

process.env.ISKRON_BRIDGE_LANG = "ru";

const STAND = "mcp__iskron__iskron_stand";
const COVER = "---\niskron:\n  graph: '@probe/seat'\n  holon: 4057\n  agent_role: 931\n---\n# p\n";
const W = ROOT_SEAT.ru;

/** A repository root with the cover, the process standing in it, its own auth directory. */
function repo(t) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "iskron-dsh-seat-")));
  const auth = join(dir, "auth");
  mkdirSync(join(dir, ".git"));
  mkdirSync(join(auth, "standings"), { recursive: true });
  writeFileSync(join(dir, "AGENTS.md"), COVER);
  const was = { cwd: process.cwd(), auth: process.env.ISKRON_BRIDGE_AUTH_DIR };
  process.env.ISKRON_BRIDGE_AUTH_DIR = auth;
  process.chdir(dir);
  t.after(() => {
    process.chdir(was.cwd);
    if (was.auth === undefined) delete process.env.ISKRON_BRIDGE_AUTH_DIR;
    else process.env.ISKRON_BRIDGE_AUTH_DIR = was.auth;
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, auth };
}

/** The hold record the session's bridge writes on a stand. */
function holdRecord(auth, { realm, karta, name }) {
  const key = `${name}--${karta}--probe`;
  writeFileSync(keyFilePathOf(auth, key), key + "\n");
  writeFileSync(
    holdFilePathOf(auth, key),
    JSON.stringify({
      realm,
      karta: Number(karta),
      name,
      url: "https://example.invalid/",
      at: Date.now(),
      cwd: process.cwd(),
      client: "dsh-mcp-client",
    }) + "\n",
  );
}

/** The plugin over a stand-in dsh whose registry holds the bridge's stand tool. */
function dsh(t, auth) {
  const handlers = new Map();
  const logs = [];
  const order = [];
  const stands = [];
  const stand = {
    name: STAND,
    async execute(args, exec) {
      assert.ok(exec?.signal instanceof AbortSignal, "the call carries a signal");
      order.push("stand");
      stands.push(args);
      holdRecord(auth, { realm: "@probe/seat", karta: String(args.karta), name: "glm.p" });
      return { content: [{ type: "text", text: "стою" }] };
    },
  };
  const tools = { get: (name) => (name === STAND ? stand : undefined) };
  PLUGIN({
    on: (name, fn) => handlers.set(name, fn),
    get: (name) => (name === "tools" ? tools : undefined),
    logger: { info: (l) => logs.push(String(l)) },
  });
  t.after(() => handlers.get("session/disposed")?.({ id: "s-root" }));
  const agent = (header) => ({
    session: { id: header ? "s-child" : "s-root", ...(header ? { header } : {}) },
    followup: () => undefined,
    model: { current: () => ({ provider: "probe", model: "glm-5.3" }) },
    ctx: { systemPrompt: { section: () => undefined } },
  });
  return {
    logs,
    order,
    stands,
    agent,
    created: (a, source) => handlers.get("agent/created")?.({ agent: a, source }),
    /** One model request of the agent: the waterfall, or the request alone without a listener. */
    async request(a) {
      const next = async () => (order.push("request"), { provider: "probe", model: "glm-5.3" });
      const h = handlers.get("agent/request");
      return h
        ? h({ agent: a, turn: 1, step: 1, signal: new AbortController().signal }, next)
        : next();
    },
  };
}

const seatedLine = (logs) => logs.find((l) => l.includes("своим местом glm.p"));

test("startup: the seat stands before the first model request", async (t) => {
  const { auth } = repo(t);
  const d = dsh(t, auth);
  const a = d.agent();
  d.created(a, "startup");
  await d.request(a);
  assert.deepEqual(d.order, ["stand", "request"]);
  assert.deepEqual(d.stands, [{ realm: "@probe/seat", karta: "931", model: "glm-5.3" }]);
  assert.ok(seatedLine(d.logs), d.logs.join("\n"));
  await d.request(a); // later requests go straight
  assert.deepEqual(d.order, ["stand", "request", "request"]);
});

test("resume: a new process seats the continued session again", async (t) => {
  const { auth } = repo(t);
  const first = dsh(t, auth);
  first.created(first.agent(), "startup");
  await first.request(first.agent());
  await new Promise((r) => setTimeout(r, 5)); // the next process starts after the last record
  const again = dsh(t, auth);
  const a = again.agent();
  again.created(a, "resume");
  await again.request(a);
  assert.deepEqual(again.order, ["stand", "request"]);
  assert.equal(again.stands.length, 1);
});

test("a subagent is not seated; the root is", async (t) => {
  const { auth } = repo(t);
  const d = dsh(t, auth);
  const root = d.agent();
  d.created(root, "startup");
  await d.request(root);
  const child = d.agent({ parentSession: "s-root", origin: "subagent", delegationDepth: 1 });
  d.created(child, "startup");
  await d.request(child);
  assert.equal(d.stands.length, 1, "only the root stood");
});

test("the switch off: no seating; on: the seating", async (t) => {
  const { auth } = repo(t);
  const was = process.env[envName("ROOT_SEAT")];
  t.after(() =>
    was === undefined
      ? delete process.env[envName("ROOT_SEAT")]
      : (process.env[envName("ROOT_SEAT")] = was),
  );
  process.env[envName("ROOT_SEAT")] = "1";
  const on = dsh(t, auth);
  on.created(on.agent(), "startup");
  await on.request(on.agent());
  assert.equal(on.stands.length, 1);
  rmSync(holdFilePathOf(auth, "glm.p--931--probe"));
  process.env[envName("ROOT_SEAT")] = "0";
  const off = dsh(t, auth);
  const a = off.agent();
  off.created(a, "startup");
  await off.request(a);
  assert.deepEqual(off.order, ["request"]);
});

test("a seat already held in another graph: refused, not stood over", async (t) => {
  const { auth } = repo(t);
  const d = dsh(t, auth);
  holdRecord(auth, { realm: "@other/graph", karta: "931", name: "held.p" });
  const a = d.agent();
  d.created(a, "startup");
  await d.request(a);
  assert.equal(d.stands.length, 0);
  const said = W.ownOther("held.p", "931", "@other/graph");
  assert.ok(d.logs.includes(said), d.logs.join("\n"));
});
