import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { score } from "./score.mjs";
import { loadPackage } from "./protocol.mjs";

function run(id, k, calls = 120, traversals = 10, missing = 0) {
  const ref = (source, entry) => ({ source, entry, version: 1 });
  return { id, status: "completed",
    decisions: Array.from({ length: 12 }, (_, i) => ({ id: `D${String(i + 1).padStart(2, "0")}`,
      occurrence: i >= 12 - missing ? null : ref("case-journal", `occ-${i}`),
      judgement: { label: i < k ? "found-with-node" : "not-found", evidence: ref("cold-judgement", `judge-${i}`),
        node: i < k ? { id: `n${i}`, version: 1 } : null } })),
    calls: Array.from({ length: calls }, (_, i) => ({ ...ref("server", `call-${i}`), decision: `D${String(i % 12 + 1).padStart(2, "0")}` })),
    traversals: Array.from({ length: traversals }, (_, i) => ref("bridge", `walk-${i}`)) };
}
function packet(specs) {
  return { schema: 1, arms: specs.map((runs, i) => ({ label: `P${i}`, runs: runs.map((args, j) => run(`r${i}-${j}`, ...args)) })) };
}
const same = (k, calls = 120, walks = 10) => [[k, calls, walks], [k, calls, walks], [k, calls, walks]];
const pair = (a, b) => score(packet([a, b, same(0)])).pairs[0];

test("lower of two whole k, median of three; spread max-min", () => {
  const p = packet([[[4], [7], [12, 120, 10, 3]], [[7], [8], [9]], same(0)]);
  const a = score(p).arms;
  assert.deepEqual([a[0].k, a[0].spread, a[0].whole], [4, 3, 2]);
  assert.deepEqual([a[1].k, a[1].spread], [8, 2]);
});
test("19.999% is not 20%; exactly 20% wins", () => {
  assert.equal(pair(same(8, 80001), same(8, 100000)).winner, null);
  assert.equal(pair(same(8, 80000), same(8, 100000)).winner, "P0");
});
test("secondary medians, total traversals and survival floor", () => {
  assert.equal(pair([[8, 120], [8, 12], [8, 120]], same(8, 120)).winner, null);
  assert.equal(pair(same(8, 120, 9), same(8, 120, 10)).winner, "P0");
  assert.equal(pair(same(7, 60, 9), same(8, 120, 10)).winner, null);
});
test("equality and conflicting secondaries do not distinguish", () => {
  assert.equal(pair(same(8), same(8)).winner, null);
  assert.equal(pair(same(8, 60, 11), same(8, 120, 10)).winner, null);
});
test("r > delta blocks even dramatic secondary gains; primary requires delta>=3,r<=1", () => {
  assert.equal(pair([[6, 12], [8, 12], [10, 12]], same(7, 120)).winner, null);
  assert.equal(pair([[9, 240], [10, 240], [10, 240]], same(6, 12)).winner, "P0");
  assert.equal(pair([[8, 120], [10, 120], [10, 120]], same(6, 120)).winner, null);
});
test("two missing count as not survived; three exclude, never retry", () => {
  const p = packet([[[12, 120, 10, 2], [12, 120, 10, 2], [12, 120, 10, 3]], same(8), same(0)]);
  const a = score(p).arms[0];
  assert.equal(a.k, 10);
  assert.deepEqual(a.runs.map((r) => [r.k, r.missing, r.whole]), [[10, 2, true], [10, 2, true], [9, 3, false]]);
  p.arms[0].runs[1].status = "guard-stopped";
  assert.equal(score(p).pairs[0].reason, "insufficient-whole-runs");
  p.arms[0].runs.push(run("retry", 12));
  assert.throws(() => score(p), /three slots/);
});
test("winning one pair is not winning both", () => {
  const result = score(packet([same(9), same(6), same(9)]));
  assert.equal(result.pairs[0].winner, "P0");
  assert.equal(result.winner, null);
  assert.equal(score(packet([same(12), same(6), same(8)])).winner, "P0");
});
test("schema refuses reports, missing evidence, duplicate decisions, unversioned nodes", () => {
  for (const mutate of [
    (p) => { p.agentReport = "PASS"; },
    (p) => { p.arms[0].runs[0].decisions.pop(); },
    (p) => { p.arms[0].runs[0].decisions[0].occurrence.source = "graph"; },
    (p) => { delete p.arms[0].runs[0].decisions[0].judgement.node.version; },
    (p) => { p.arms[0].runs[0].decisions[1].id = "D01"; },
    (p) => { p.arms[0].runs[0].calls[0].version = 0; },
  ]) {
    const p = packet([same(8), same(8), same(8)]);
    mutate(p);
    assert.throws(() => score(p), /invalid|twelve/);
  }
});
test("zero calls never yield NaN or Infinity", () => {
  const result = pair(same(8, 0), same(8, 0));
  assert.equal(result.winner, null);
  assert.ok(!JSON.stringify(result).includes("NaN"));
  assert.equal(pair(same(8, 0), same(8, 12)).winner, "P0");
});
test("v8: two whole secondaries take the worse, not arithmetic median; denominator is 12", () => {
  const p = packet([[[8, 12, 1], [8, 120, 10], [8, 120, 10, 3]], same(8, 96, 8), same(0)]);
  const result = score(p);
  assert.deepEqual([result.arms[0].callsPerDecision, result.arms[0].traversals], [10, 10]);
  assert.equal(result.pairs[0].winner, "P1");
  p.arms[0].runs[0] = run("different-k", 10, 120, 10, 2);
  assert.equal(score(p).arms[0].runs[0].callsPerDecision, 10);
});
test("missing/stopped slots excluded, no whole runs cannot compare", () => {
  const p = packet([same(12), same(8), same(0)]);
  p.arms[0].runs.forEach((r) => { r.status = "infrastructure-invalid"; });
  const result = score(p);
  assert.deepEqual([result.arms[0].whole, result.arms[0].k, result.arms[0].spread], [0, null, null]);
  assert.equal(result.winner, null);
});
test("missing decisions and aborted cold reading do not require fabricated judgement evidence", () => {
  const p = packet([[[10, 120, 10, 2], [10, 120, 10, 2], [8]], same(8), same(0)]);
  p.arms[0].runs[0].decisions.slice(10).forEach((d) => { d.judgement = null; });
  assert.equal(score(p).arms[0].runs[0].k, 10);
  p.arms[0].runs[2].status = "guard-stopped";
  p.arms[0].runs[2].decisions.forEach((d) => { d.judgement = null; });
  assert.equal(score(p).arms[0].whole, 2);
  p.arms[0].runs[2].status = "completed";
  assert.throws(() => score(p), /invalid/);
});
test("found without node is not survival; r=delta is not r>delta", () => {
  const p = packet([same(8, 60), same(7, 120), same(0)]);
  p.arms[0].runs[0].decisions[0].judgement.label = "found-without-node";
  p.arms[0].runs[0].decisions[0].judgement.node = null;
  const result = score(p);
  assert.equal(result.arms[0].runs[0].k, 7);
  assert.deepEqual([result.pairs[0].delta, result.pairs[0].r, result.pairs[0].winner], [1, 1, "P0"]);
});
test("rule and executable/schema/tests frozen, allowed choices unchanged", () => {
  const p = loadPackage();
  for (const name of ["outcome-rule.json", "score.mjs", "score-schema.mjs", "score.test.mjs"]) assert.ok(p.files.includes(name));
  assert.deepEqual(p.oracle.decisions[4].expected.allowed, ["id, updated_at, payload", "payload, id, updated_at"]);
  assert.deepEqual(p.oracle.decisions[5].expected.allowed, ["Сохранить в extensions", "Отказать всей записи"]);
  assert.ok(p.oracle.decisions.slice(4, 6).every((d) => d.expected.source.startsWith("case journal:")));
});
test("CLI calculates offline, rejects report and bad args, no oracle in result", (t) => {
  const dir = mkdtempSync(fileURLToPath(new URL(".score-test-", import.meta.url)));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = `${dir}/packet.json`;
  const cli = fileURLToPath(new URL("score.mjs", import.meta.url));
  const exec = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: {} });
  const p = packet([same(12), same(6), same(8)]);
  writeFileSync(path, JSON.stringify(p));
  const out = exec(path);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), score(p));
  assert.ok(!out.stdout.includes("expected") && !out.stdout.includes("oracle"));
  writeFileSync(path, JSON.stringify({ agentReport: "PASS" }));
  assert.equal(exec(path).status, 1);
  assert.equal(exec().status, 1);
  assert.equal(exec("live").status, 1);
});
