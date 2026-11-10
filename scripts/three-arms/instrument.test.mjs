import assert from "node:assert/strict";
import { fork, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { Budget, inclusiveInput } from "./guard.mjs";
import { arms, limits, loadPackage, readerCall, verifyModes } from "./protocol.mjs";
import { createReaderLedger } from "./reader.mjs";
import { createLedger } from "../stand-mcp-ledger.mjs";

test("12 premarked decisions, satellite/foreign cases, 3x3 slots and frozen limits", () => {
  const p = loadPackage();
  assert.equal(p.scene.events.length, 12);
  assert.equal(p.oracle.decisions.filter((d) => d.kind === "satellite-born").length, 2);
  assert.equal(p.oracle.decisions.filter((d) => d.kind === "foreign-verdict").length, 2);
  assert.equal(Object.keys(arms).length * limits.runsPerArm, 9);
  assert.equal(p.liveReady, false);
  assert.equal(p.sha256, loadPackage().sha256);
  assert.deepEqual([limits.input, limits.output, limits.totalInput], [3_000_000, 80_000, 30_000_000]);
});

test("unknown or swapped arm flags fail, including current as door", () => {
  for (const arm of Object.keys(arms)) verifyModes(arms[arm], arm);
  assert.throws(() => verifyModes(arms.current, "door"), /mismatched/);
  assert.throws(() => verifyModes({}, "current"), /mismatched/);
  assert.throws(() => verifyModes(arms.door, "other"), /mismatched/);
});

test("cache counts and unknown raw usage never becomes zero", () => {
  assert.equal(inclusiveInput({ input_tokens: 3, cache_read_input_tokens: 7, cache_creation_input_tokens: 11 }), 21);
  assert.throws(() => inclusiveInput({ input_tokens: 3 }), /unknown/);
  assert.throws(() => inclusiveInput({ input_tokens: -1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }), /unknown/);
});

test("unknown real-model bound refuses before any provider callback", () => {
  const guard = new Budget();
  let posts = 0;
  assert.throws(() => {
    guard.before("subject", { inputUpper: 100, outputUpper: 20, basis: "anthropic-estimate" });
    posts++;
  }, /no upper-bound basis/);
  assert.equal(posts, 0);
  assert.throws(() => guard.before("subject", { inputUpper: 1, outputUpper: 1, basis: "synthetic-byte-contract" }), /already stopped/);
});

test("synthetic reserve survives error/missing usage; total and output ceilings refuse", () => {
  for (const cap of [{ input: 9, output: 20, totalInput: 9 }, { input: 20, output: 3, totalInput: 100 }]) {
    const guard = new Budget(cap);
    guard.before("one", { inputUpper: 6, outputUpper: 2, basis: "synthetic-byte-contract" });
    assert.throws(() => guard.before("one", { inputUpper: 6, outputUpper: 2, basis: "synthetic-byte-contract" }), /budget limit/);
    assert.equal(guard.totalInput, 6);
  }
  const guard = new Budget({ input: 10, output: 10, totalInput: 10 });
  guard.before("one", { inputUpper: 6, outputUpper: 1, basis: "synthetic-byte-contract" });
  assert.throws(() => guard.before("two", { inputUpper: 6, outputUpper: 1, basis: "synthetic-byte-contract" }), /budget limit/);
});

test("guard kills its stub child BEFORE third loopback POST (not live isolation)", { timeout: 10_000 }, async (t) => {
  let posts = 0;
  const server = createServer((req, res) => { posts++; req.resume(); res.end("synthetic"); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const child = fork(new URL("stub-child.mjs", import.meta.url), [String(server.address().port)],
    { env: {}, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => child.kill("SIGKILL"));
  const guard = new Budget({ input: 12, output: 10, totalInput: 12 });
  let refused = false;
  child.on("message", (reservation) => {
    try { guard.before("stub", reservation); child.send("permit"); }
    catch { refused = true; child.kill("SIGKILL"); }
  });
  const [code, signal] = await once(child, "exit");
  assert.equal(code, null);
  assert.equal(signal, "SIGKILL");
  assert.equal(refused, true);
  assert.equal(posts, 2);
});

test("reader denies every case action, writes, other realm and malformed RPC", () => {
  const call = (name, args) => ({ method: "tools/call", params: { name, arguments: args } });
  assert.equal(readerCall(call("iskron_look", { realm: "r1", node_id: "2" }), "r1"), true);
  for (const action of ["read", "history", "at", "mine", "say", "join", "?"]) {
    assert.equal(readerCall(call("iskron_case", { realm: "r1", action }), "r1"), false);
  }
  for (const request of [null, [], call("iskron_update", { realm: "r1" }),
    call("iskron_look", { realm: "r2" }), call("iskron_orient", { realm: "r1", action: "?" })]) {
    assert.equal(readerCall(request, "r1"), false);
  }
});

test("actual HTTP reader boundary refuses case BEFORE forwarding; allowed graph forwards", async (t) => {
  let forwarded = 0;
  const ledger = createReaderLedger({ realm: "r1", record() {}, fetchImpl: async () => {
    forwarded++;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }),
      { headers: { "content-type": "application/json" } });
  } });
  ledger.server.listen(0, "127.0.0.1");
  await once(ledger.server, "listening");
  t.after(() => ledger.close());
  const send = (body) => fetch(`http://127.0.0.1:${ledger.server.address().port}/mcp-iskron`,
    { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
  const call = (name, realm = "r1") => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: { realm, action: "read" } } });
  for (const request of [call("iskron_case"), call("iskron_update"), "{", [call("iskron_look")]]) {
    const response = await send(request);
    assert.equal(response.status, 403);
    await response.text();
  }
  assert.equal(forwarded, 0);
  const response = await send({ jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: "iskron_look", arguments: { realm: "r1", node_id: "2" } } });
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(forwarded, 1);
});

test("legacy ledger without policy still forwards initialize/delete and records only metadata", async (t) => {
  const records = [];
  const forwarded = [];
  const ledger = createLedger({ record: (r) => records.push(r), fetchImpl: async (_url, init) => {
    forwarded.push(init.method);
    return new Response("{}", { headers: { "mcp-session-id": "synthetic-session" } });
  } });
  ledger.server.listen(0, "127.0.0.1");
  await once(ledger.server, "listening");
  t.after(() => ledger.close());
  const url = `http://127.0.0.1:${ledger.server.address().port}/mcp-iskron`;
  await (await fetch(url, { method: "POST", body: JSON.stringify({ method: "initialize" }) })).text();
  await (await fetch(url, { method: "DELETE", headers: { "mcp-session-id": "synthetic-session" } })).text();
  assert.deepEqual(forwarded, ["POST", "DELETE"]);
  assert.deepEqual(records.map((r) => [r.kind, r.session_id, r.status]),
    [["initialize", "synthetic-session", 200], ["delete", "synthetic-session", 200]]);
  assert.ok(records.every((r) => Object.keys(r).sort().join(",") === "at,kind,session_id,status"));
});

test("freeze commits exact package hash once; no live command and no overwrite", (t) => {
  const dir = mkdtempSync(fileURLToPath(new URL(".freeze-test-", import.meta.url)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = `${dir}/frozen.json`;
  const cli = fileURLToPath(new URL("preflight.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: {} });
  assert.equal(run("freeze", path).status, 0);
  const bytes = readFileSync(path, "utf8");
  const frozen = JSON.parse(bytes);
  assert.equal(frozen.sha256, loadPackage().sha256);
  assert.equal(frozen.modelCalls, 0);
  assert.equal(frozen.liveReady, false);
  assert.notEqual(run("freeze", path).status, 0);
  assert.equal(readFileSync(path, "utf8"), bytes);
  assert.notEqual(run("live").status, 0);
});
