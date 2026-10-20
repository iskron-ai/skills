// Проба потребительского прогона сырых кадров (scripts/frames-consumer-run.mjs, дело №1249):
// матрица проб A и B, выгруженная файлами мест, проходит через собранный мост и сторожа —
// каждая ветвь pass; судья различает отказ моста, повтор и устаревший кадр.
// ISKRON_BRIDGE_PATH=<мост до #540> — ветви краснеют, как красны пробы A и B.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { intentFor, judge } from "../../scripts/frames-consumer-judge.mjs";
import { REPO } from "./built.mjs";
import { ask, ME, ME_ID, roleOnlyAsk, SIB, siblingMatrix } from "./room-frames.mjs";

const me = { standing_id: ME_ID, standing: ME };
const sib = { standing_id: SIB.id, standing: SIB.standing };
const deliver = (seat, frames) =>
  frames.map((f) => ({ ...f, to_standing_id: seat.standing_id, to_standing: seat.standing }));
const BRANCHES = {
  sibling: siblingMatrix().frames,
  "role-only": [
    roleOnlyAsk(72, SIB),
    roleOnlyAsk(73),
    roleOnlyAsk(74, { id: ME_ID, standing: ME, name: "proba" }),
  ],
};

test("the api's intent is read from the frame's address fields, per seat", () => {
  const [toSib, , , , invite, joined, inFlight, bodyOf] = BRANCHES.sibling;
  const refs = BRANCHES.sibling;
  for (const f of [toSib, invite, inFlight, bodyOf]) {
    assert.equal(intentFor(f, me, refs), "theirs", f.id);
    assert.equal(intentFor(f, sib, refs), "mine", f.id);
  }
  assert.equal(intentFor(joined, me, refs), null);
  assert.equal(intentFor(roleOnlyAsk(73), sib), "nobody");
  assert.equal(intentFor({ ...ask(80), room: "broken" }, me), null);
});

test("verdicts: a handed-over frame is judged, a dropped one is rejected, a repeat and a stale one are not judged", () => {
  const seen = { delivered: true, texts: ["Т"], shown: [], recordLine: false, yours: 0 };
  assert.equal(judge("theirs", seen).verdict, "pass");
  assert.equal(judge("theirs", { ...seen, shown: ["Т"] }).verdict, "fail");
  assert.equal(judge("theirs", { ...seen, addressed: true }).verdict, "fail");
  assert.equal(judge("mine", seen).verdict, "fail");
  assert.equal(judge("mine", { ...seen, shown: ["Т"], yours: 1 }).verdict, "pass");
  assert.equal(judge("mine", { ...seen, delivered: false }).verdict, "rejected");
  assert.equal(judge("mine", { ...seen, delivered: false, repeat: true }).verdict, "unjudged");
  assert.equal(judge("theirs", { ...seen, shown: ["Т"], stale: true }).verdict, "unjudged");
});

test("the matrix of probes A and B through the built bridge and watchdog: every branch passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "frames-consumer-"));
  try {
    for (const [branch, frames] of Object.entries(BRANCHES))
      for (const [name, seat] of [
        ["me", me],
        ["sib", sib],
      ]) {
        const file = { ...seat, branch, messages: deliver(seat, frames) };
        writeFileSync(join(dir, `${branch}-${name}.json`), JSON.stringify(file));
      }
    const out = join(tmpdir(), `frames-consumer-${process.pid}.json`);
    const run = spawnSync(
      process.execPath,
      [join(REPO, "scripts/frames-consumer-run.mjs"), dir, "--json", out],
      { encoding: "utf8", timeout: 120_000 },
    );
    assert.ok(run.status === 0 || run.status === 1, `setup: ${run.status} ${run.stderr}`);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    rmSync(out, { force: true });
    const outcomes = Object.fromEntries(summary.branches.map((b) => [b.branch, b.outcome]));
    assert.deepEqual(outcomes, { "role-only": "pass", sibling: "pass" }, run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
