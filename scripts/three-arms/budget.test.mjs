import assert from "node:assert/strict";
import { test } from "node:test";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { Budget } from "./guard.mjs";

// Fixture evidence only. This is NOT confirmation of any provider's actual window.
const window = { route: "fixture-route", model: "fixture-model", inputWindow: 60,
  evidence: "fixture: hard inclusive input window, independently checked without inference" };
const cap = { input: 150, output: 30, totalInput: 300 };
const budget = (caps = cap) => new Budget(caps, { confirmedWindows: [window] });
const request = (attemptId, extra = {}) => ({ attemptId, route: window.route, model: window.model,
  max_tokens: 10, basis: "confirmed-route-window", ...extra });
const usage = (input = 20, output = 3) => ({ input_tokens: input, output_tokens: output,
  cache_read_input_tokens: 2, cache_creation_input_tokens: 3 });

test("confirmed route reserves full window and max_tokens, never caller's smaller estimate", () => {
  const b = budget();
  const id = b.before("parent", request("a", { inputUpper: 1, outputUpper: 1 }));
  assert.equal(id, "a");
  assert.equal(b.totalInput, 60);
  assert.deepEqual(b.runs.get("parent"), { input: 60, output: 10 });
  b.settle(id, usage(), { success: true });
  assert.equal(b.totalInput, 25);
  assert.deepEqual(b.runs.get("parent"), { input: 25, output: 3 });
  b.settle(id, usage(), { success: true });
  assert.equal(b.totalInput, 25);
});

test("missing basis, route/model mismatch, bad carrier and max_tokens fail closed", () => {
  for (const windows of [[], [{ ...window, evidence: "" }], [{ ...window, inputWindow: -1 }]]) {
    assert.throws(() => new Budget(cap, { confirmedWindows: windows }).before("p", request("a")));
  }
  for (const extra of [{ route: "other" }, { model: "other" }, { max_tokens: 0 },
    { max_tokens: -1 }, { max_tokens: NaN }, { attemptId: undefined }]) {
    assert.throws(() => budget().before("p", request("a", extra)));
  }
});

test("invalid/absent usage spends reservation permanently, even if later receipt looks valid", () => {
  for (const raw of [undefined, null, {}, usage(-1), usage(20, -1), usage(20, NaN),
    { ...usage(), cache_read_input_tokens: undefined }, { ...usage(), input_tokens: "20" }]) {
    const b = budget();
    b.before("p", request("a"));
    b.settle("a", raw, { success: true });
    b.settle("a", usage(), { success: true });
    assert.equal(b.totalInput, 60);
    assert.deepEqual(b.runs.get("p"), { input: 60, output: 10 });
  }
});

test("settlement preserves other inflight and failed HTTP usage never frees a retry", () => {
  const b = budget();
  b.before("p", request("a"));
  b.before("p", request("b"));
  b.settle("a", usage(), { success: true });
  assert.equal(b.totalInput, 85);
  assert.deepEqual(b.runs.get("p"), { input: 85, output: 13 });
  b.before("p", request("retry"));
  b.settle("b", usage(), { success: false });
  b.settle("b", usage(), { success: true });
  assert.equal(b.totalInput, 145);
  assert.throws(() => b.before("p", request("next")), /budget limit/);
});

test("inflight plus spent caps include parent, satellites, reader and judge", () => {
  const b = budget({ ...cap, totalInput: 240 });
  for (const name of ["parent", "satellite", "reader", "judge"]) b.before(name, request(name));
  assert.equal(b.totalInput, 240);
  assert.throws(() => b.before("satellite2", request("fifth")), /budget limit/);
  assert.equal(b.totalInput, 240);
  const p = budget();
  p.before("p", request("one"));
  p.before("p", request("two"));
  assert.throws(() => p.before("p", request("three")), /budget limit/);
});

test("output cap is separate; retry is a fresh reservation, duplicate id cannot grant twice", () => {
  const b = budget({ input: 1000, output: 15, totalInput: 1000 });
  b.before("p", request("http-1"));
  b.settle("http-1", undefined);
  assert.throws(() => b.before("p", request("http-retry")), /budget limit/);
  const d = budget();
  d.before("p", request("same"));
  assert.throws(() => d.before("p", request("same")), /duplicate/);
  assert.equal(d.totalInput, 60);
});

test("over-bound usage charges actual and stops loudly, never reports success", () => {
  for (const raw of [usage(60), usage(20, 11)]) {
    const b = budget();
    b.before("p", request("a"));
    assert.throws(() => b.settle("a", raw, { success: true }), /upper bound exceeded/);
    assert.equal(b.stopped, true);
    assert.ok(b.totalInput >= 25);
    assert.throws(() => b.before("p", request("b")), /already stopped/);
  }
  const b = budget();
  b.before("p", request("a"));
  assert.throws(() => b.settle("unknown", usage()), /unknown attempt/);
  assert.equal(b.totalInput, 60);
});

test("overflow and external snapshots cannot erase inflight charges", () => {
  const b = budget();
  b.before("p", request("a"));
  b.runs.get("p").input = 0;
  assert.equal(b.runs.get("p").input, 60);
  b.settle("a", { ...usage(), input_tokens: Number.MAX_SAFE_INTEGER }, { success: true });
  assert.equal(b.totalInput, 60);
  const max = Number.MAX_SAFE_INTEGER;
  const s = new Budget({ input: max, output: max, totalInput: max });
  s.before("p", { inputUpper: max, outputUpper: 1, basis: "synthetic-byte-contract" });
  assert.throws(() => s.before("p", { inputUpper: 1, outputUpper: 1, basis: "synthetic-byte-contract" }), /budget limit/);
});

test("IPC supervisor kills stub before third POST with confirmed-window reservation", { timeout: 10_000 }, async (t) => {
  let posts = 0;
  const server = createServer((req, res) => { posts++; req.resume(); res.end("fixture"); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const child = fork(new URL("stub-child.mjs", import.meta.url), [String(server.address().port)],
    { env: {}, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => child.kill("SIGKILL"));
  const b = budget();
  child.on("message", ({ sequence }) => {
    try { b.before("stub", request(`http-${sequence}`)); child.send("permit"); }
    catch { child.kill("SIGKILL"); }
  });
  const [code, signal] = await once(child, "exit");
  assert.equal(code, null);
  assert.equal(signal, "SIGKILL");
  assert.equal(posts, 2);
});
