// Проба измерителя следа приказа живого прогона (scripts/stand-order.mjs; граф @nks/nks-dev,
// узлы #7510, #7614; дело №1622): три ветви — ответ до стопа, стоп по пределу 2 с, исход по
// таймауту 5 с без ответа. Отправка accepted не штампуется и лежит между записью журнала и приходом
// в прокси: зелёное — только когда срок прошёл и от позднейшей возможной отправки, промежуток —
// «не установлено» (красное), раньше записи — «срезано»; снимок журнала после стопа — красное.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { orderTrace } from "../../scripts/stand-order.mjs";

const ID = "00000000-0000-4000-8000-000000000001";
const AT = Date.parse("2026-10-25T01:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

/**
 * One order on disk and in the logs; times are ms after the accepted's journal `at`. stop — the
 * stop action; outcome — its line and the outcome's ack; answer — the accepted's answer to the
 * bridge (null: the bridge gave up, aborted at 5000); walk — the proxy's journal read.
 */
function trace({ stop, outcome, answer, walk = 1, t = 1, disk = "accepted" }) {
  const dir = mkdtempSync(join(tmpdir(), "stand-order-"));
  mkdirSync(join(dir, "orders"));
  writeFileSync(
    join(dir, "orders", `${ID}.json`),
    JSON.stringify({ id: ID, state: "stopped", at: AT, acked: true }),
  );
  const log = [
    `${iso(AT + stop)} pid=1 v0 stopped seat--2--_x_run: stop order ${ID}`,
    `${iso(AT + outcome)} pid=1 v0 stop order ${ID} for seat-id: stopped (word_given)`,
  ].join("\n");
  const acks = join(dir, "acks.jsonl");
  const accepted = { t: AT + t, order: ID, state: "accepted", status: 200, disk, walk };
  appendFileSync(
    acks,
    JSON.stringify(
      answer === "unseen"
        ? accepted
        : answer === null
          ? { ...accepted, aborted: AT + 5000 }
          : { ...accepted, done: AT + answer },
    ) + "\n",
  );
  appendFileSync(
    acks,
    JSON.stringify({
      t: AT + outcome,
      done: AT + outcome + 1,
      order: ID,
      state: "stopped",
      status: 200,
      disk: "stopped",
      walk: 1,
    }) + "\n",
  );
  const seen = [];
  orderTrace(
    (ok, name, d) => seen.push([ok, name.replace("order (probe): ", ""), d]),
    acks,
    "probe",
    ID,
    dir,
    log,
  );
  rmSync(dir, { recursive: true, force: true });
  return seen;
}
const failed = (seen) => seen.filter(([ok]) => !ok).map(([, n]) => n);
const detail = (seen, name) => String(seen.find(([, n]) => n === name)?.[2] ?? "");

test("in-cap answer: the stop after the answer, the outcome after it", () => {
  assert.deepEqual(failed(trace({ answer: 200, stop: 201, outcome: 203 })), []);
});

test("in-cap answer: a stop before the answer and before the cap is red", () => {
  assert.deepEqual(failed(trace({ answer: 200, stop: 150, outcome: 203 })), [
    "the stop after an in-cap answer, or not before the cap and before a late one or the give-up",
  ]);
});

test("in-cap answer: the stop and the outcome 2 ms before done are green, 3 ms red", () => {
  assert.deepEqual(failed(trace({ answer: 200, stop: 198, outcome: 198 })), []);
  assert.deepEqual(failed(trace({ answer: 200, stop: 197, outcome: 201 })), [
    "the stop after an in-cap answer, or not before the cap and before a late one or the give-up",
  ]);
  assert.deepEqual(failed(trace({ answer: 200, stop: 201, outcome: 197 })), [
    "the outcome went after the accepted's answer or its timeout",
    "the outcome line after the accepted's answer or its timeout",
  ]);
});

test("in-cap answer: a stop 4 ms and an outcome 3 ms before the answer are red (case №1622 [207])", () => {
  assert.deepEqual(failed(trace({ answer: 200, stop: 196, outcome: 197 })), [
    "the outcome went after the accepted's answer or its timeout",
    "the stop after an in-cap answer, or not before the cap and before a late one or the give-up",
    "the outcome line after the accepted's answer or its timeout",
  ]);
});

// The send lies somewhere in the 10 ms between the journal (0) and the proxy (t: 10).
const GAP = { t: 10 };
const STOP =
  "the stop after an in-cap answer, or not before the cap and before a late one or the give-up";
const OUTCOME = [
  "the outcome went after the accepted's answer or its timeout",
  "the outcome line after the accepted's answer or its timeout",
];

test("late answer: green only when 2000 ms passed even from the latest send (t)", () => {
  assert.deepEqual(failed(trace({ ...GAP, answer: 3000, stop: 2010, outcome: 3002 })), []);
  assert.deepEqual(failed(trace({ ...GAP, answer: 3000, stop: 2008, outcome: 3002 })), []);
});

test("late answer: a stop between at+2000 and t+2000 is unsure — red, named so", () => {
  const seen = trace({ ...GAP, answer: 3000, stop: 2007, outcome: 3002 });
  assert.deepEqual(failed(seen), [STOP]);
  assert.match(detail(seen, STOP), /cap unsure/);
  assert.match(
    detail(trace({ ...GAP, answer: 3000, stop: 1999, outcome: 3002 }), STOP),
    /cap unsure/,
  );
});

test("late answer: a stop before at+2000 is cut — red", () => {
  const seen = trace({ ...GAP, answer: 3000, stop: 1997, outcome: 3002 });
  assert.deepEqual(failed(seen), [STOP]);
  assert.match(detail(seen, STOP), /cap cut/);
});

// The late answer is the measure's only witness of the wait's upper end: a stop before it passes
// (how far past the cap is printed, not judged), a stop at or after it fails.
test("late answer: a stop before the late answer is green; 2 ms before it or later — red, waited", () => {
  assert.deepEqual(failed(trace({ ...GAP, answer: 3000, stop: 2997, outcome: 3002 })), []);
  for (const stop of [2998, 3000, 3005]) {
    const seen = trace({ ...GAP, answer: 3000, stop, outcome: 3006 });
    assert.deepEqual(failed(seen), [STOP], `stop ${stop}`);
    assert.match(detail(seen, STOP), /waited for the late answer/);
  }
});

test("a late answer is not an in-cap one: 2400 / stop 2500 is red, waited (case №1645 [49])", () => {
  const seen = trace({ ...GAP, answer: 2400, stop: 2500, outcome: 2502 });
  assert.deepEqual(failed(seen), [STOP]);
  assert.match(detail(seen, STOP), /waited for the late answer/);
});

test("the answer within the cap only by at+1998; to t+2002 unsure — red; past it — late", () => {
  assert.deepEqual(failed(trace({ ...GAP, answer: 1998, stop: 1999, outcome: 2001 })), []);
  for (const answer of [1999, 2012]) {
    const seen = trace({ ...GAP, answer, stop: answer + 1, outcome: answer + 3 });
    assert.deepEqual(failed(seen), [STOP], `answer ${answer}`);
    assert.match(detail(seen, STOP), /unsure/);
  }
  assert.match(
    detail(trace({ ...GAP, answer: 2013, stop: 2014, outcome: 2016 }), STOP),
    /waited for the late answer/,
  );
});

test("late answer: an outcome before the late answer is red", () => {
  assert.deepEqual(failed(trace({ ...GAP, answer: 3000, stop: 2010, outcome: 2900 })), OUTCOME);
});

test("no answer: the outcome green only 5000 ms even from t; between — unsure, before at — cut", () => {
  assert.deepEqual(failed(trace({ ...GAP, answer: null, stop: 2010, outcome: 5008 })), []);
  const unsure = trace({ ...GAP, answer: null, stop: 2010, outcome: 5007 });
  assert.deepEqual(failed(unsure), OUTCOME);
  assert.match(detail(unsure, OUTCOME[0]), /timeout unsure/);
  const cut = trace({ ...GAP, answer: null, stop: 2010, outcome: 4997 });
  assert.deepEqual(failed(cut), OUTCOME);
  assert.match(detail(cut, OUTCOME[0]), /timeout cut/);
});

test("in-cap answer: a very late stop passes — the order only, the upper end is printed, not judged", () => {
  const seen = trace({ answer: 200, stop: 9000, outcome: 9002 });
  assert.deepEqual(failed(seen), []);
  assert.match(detail(seen, STOP), /8999–9000 ms after the send \(after the in-cap answer\)/);
});

test("neither an answer nor a give-up in the ack log: no witness of the wait's end — red", () => {
  const seen = trace({ ...GAP, answer: "unseen", stop: 2100, outcome: 5008 });
  assert.ok(failed(seen).includes(STOP));
  assert.match(detail(seen, STOP), /neither an answer nor a give-up seen/);
});

test("no answer: a stop at or after the give-up is red, waited for it", () => {
  assert.match(
    detail(trace({ ...GAP, answer: null, stop: 5000, outcome: 5008 }), STOP),
    /waited for the give-up/,
  );
});

test("no answer: a stop before the cap is red", () => {
  assert.ok(failed(trace({ ...GAP, answer: null, stop: 1500, outcome: 5008 })).includes(STOP));
});

test("the journal read that ended after the stop, untimed or reading stopped, is red", () => {
  const disk = "accepted on disk before the stop";
  assert.deepEqual(failed(trace({ answer: 3000, stop: 2000, outcome: 3002, walk: 2000 })), [disk]);
  assert.deepEqual(failed(trace({ answer: 3000, stop: 2000, outcome: 3002, walk: null })), [disk]);
  assert.deepEqual(failed(trace({ answer: 200, stop: 201, outcome: 203, disk: "stopped" })), [
    disk,
  ]);
});
