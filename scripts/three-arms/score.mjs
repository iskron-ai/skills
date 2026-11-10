#!/usr/bin/env node
// Offline scoring, not a collector or live judge (graph @nks/nks-dev #10139).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validate } from "./score-schema.mjs";

function median(values, lower = false) {
  const sorted = [...values].sort((a, b) => a - b);
  // With two whole runs use the worse: lower survival, higher secondary cost.
  return sorted[lower ? Math.floor((sorted.length - 1) / 2) : Math.floor(sorted.length / 2)];
}
function measure(arm) {
  const runs = arm.runs.map((run) => {
    const missing = run.decisions.filter((d) => d.occurrence === null).length;
    return { id: run.id, status: run.status, missing,
      k: run.decisions.filter((d) => d.occurrence !== null && d.judgement?.label === "found-with-node").length,
      whole: run.status === "completed" && missing <= 2,
      calls: run.calls.length, callsPerDecision: run.calls.length / 12, traversals: run.traversals.length };
  });
  const whole = runs.filter((r) => r.whole);
  return { label: arm.label, runs, whole: whole.length,
    k: whole.length ? median(whole.map((r) => r.k), true) : null,
    spread: whole.length ? Math.max(...whole.map((r) => r.k)) - Math.min(...whole.map((r) => r.k)) : null,
    calls: whole.length ? median(whole.map((r) => r.calls)) : null,
    callsPerDecision: whole.length ? median(whole.map((r) => r.calls)) / 12 : null,
    traversals: whole.length ? median(whole.map((r) => r.traversals)) : null };
}
function compare(a, b) {
  const result = { labels: [a.label, b.label], delta: null, r: null, winner: null, reason: "insufficient-whole-runs" };
  if (a.whole < 2 || b.whole < 2) return result;
  result.delta = Math.abs(a.k - b.k);
  result.r = Math.max(a.spread, b.spread);
  if (result.r > result.delta) return { ...result, reason: "spread-exceeds-delta" };
  if (result.delta >= 3 && result.r <= 1) {
    return { ...result, winner: a.k > b.k ? a.label : b.label, reason: "survival" };
  }
  const better = (x, y) => x.k >= y.k && x.calls <= y.calls && x.traversals <= y.traversals &&
    ((x.calls < y.calls && (y.calls - x.calls) * 5 >= y.calls) || x.traversals < y.traversals);
  const winner = better(a, b) ? a.label : better(b, a) ? b.label : null;
  return { ...result, winner, reason: winner ? "secondary" : "secondary-equal-conflicting-or-lower-survival" };
}
export function score(packet) {
  validate(packet);
  const arms = packet.arms.map(measure);
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => compare(arms[a], arms[b]));
  const winner = arms.find((arm) => pairs.filter((p) => p.winner === arm.label).length === 2)?.label ?? null;
  return { schema: 1, arms, pairs, winner, liveReady: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error("use score.mjs PACKET.json (offline only)");
    process.stdout.write(JSON.stringify(score(JSON.parse(readFileSync(process.argv[2], "utf8"))), null, 2) + "\n");
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
