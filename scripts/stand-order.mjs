// The stop order's trace of the live bridge run (graph @nks/nks-dev, nodes #7510, #7614): the
// accepted on disk before the stop; the stop after an answer within the bridge's cap on waiting
// for it, or not before the cap and before a late answer — the order, not the cap's upper end;
// the outcome after the answer or the answer's timeout. The bridge's journal
// <auth>/orders/<id>.json keeps the accepted's time (`at`) under the outcome; the stand's /api
// proxy logs every ack it carries (--ack-log, JSONL {t, done | aborted, order, state, status,
// disk}); standings.log stamps the stop and the outcome. Shared by stand-run.mjs and
// stand-run-opencode.mjs.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The bridge's wait for the accepted's answer before the stop (js/bridge/stoporder.ts) and before
// the outcome (its timeout, js/bridge/orderack.ts), counted from the accepted's sending (#7614).
// The send is not stamped, but lies between the journal's `at` (written first) and the accepted's
// coming to the proxy (`t`): a wait is certainly kept when its end is MS after `t`, certainly cut
// when before MS after `at`; between them the measure cannot tell, and that is not a pass. The
// 2 ms are the precision of the millisecond stamps of two processes, not a stop allowed early; the
// same 2 ms bound the stop and the outcome against the answer's `done`. The answer itself is
// within the cap, late, or unsure by the same bounds. A late answer (or none) is the only witness
// that the stop did not wait past the cap: the stop before it passes, at or after it fails. How
// far past the cap a stop before a late answer came is printed, not judged — the measure bounds
// the bridge's wait only by the answer's delay (case №1645).
const ACCEPT_CAP_MS = 2000;
const ACCEPT_TIMEOUT_MS = 5000;
const STAMP_MS = 2;

const stampOf = (line) => Date.parse(line.slice(0, 24));

/** Checks one order by `check(ok, name, detail)`; ackLog — the proxy's --ack-log, or null. */
export function orderTrace(check, ackLog, label, id, authDir, logText) {
  const lines = logText.split("\n").filter((l) => l.includes(`stop order ${id}`));
  const outcome = lines.find((l) => l.includes(`stop order ${id} for `));
  const action = lines.find((l) => !l.includes(`stop order ${id} for `));
  const jf = join(authDir, "orders", `${id}.json`);
  const j = existsSync(jf) ? JSON.parse(readFileSync(jf, "utf8")) : null;
  check(!!j && j.state === "stopped" && typeof j.at === "number", `order (${label}): the journal holds it, stopped, with the accepted's time`, j ? `${j.state} at ${new Date(j.at).toISOString()} acked ${j.acked}` : "no journal entry");
  const acks = ackLog ? (existsSync(ackLog) ? readFileSync(ackLog, "utf8") : "").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.order === id) : [];
  const acc = acks.find((a) => a.state === "accepted");
  const out = acks.find((a) => a.state !== "accepted");
  check(!!acc && acc.status < 300, `order (${label}): accepted reached the api`, acc ? `${acc.status} at ${new Date(acc.t).toISOString()}` : `acks: ${JSON.stringify(acks).slice(0, 160)}`);
  // The accepted's answer as the bridge got it; none — the bridge gave up at its timeout (case №1622).
  const got = !!acc && typeof acc.done === "number";
  const waited = (at) => (j ? at - j.at : NaN);
  // Whether `ms` passed from the send to `at`: "kept", "cut", or "unsure" between the bounds.
  const kept = (at, ms) => (!acc || !j || Number.isNaN(at) ? "cut" : at >= acc.t + ms - STAMP_MS ? "kept" : at < j.at + ms - STAMP_MS ? "cut" : "unsure");
  const span = (at) => (acc && j ? `${at - acc.t}–${at - j.at} ms after the send` : "");
  const answer = !acc ? "" : got ? `accepted answered ${new Date(acc.done).toISOString()}` : `accepted unanswered, given up ${waited(acc.aborted)} ms after it`;
  const afterAnswer = (at) => (got ? at >= acc.done - STAMP_MS : kept(at, ACCEPT_TIMEOUT_MS) === "kept");
  const outcomeWord = (at) => (got ? "" : ` (timeout ${kept(at, ACCEPT_TIMEOUT_MS)})`);
  check(!!acc && !!out && out.state === "stopped" && out.status < 300 && afterAnswer(out.t), `order (${label}): the outcome went after the accepted's answer or its timeout`, acc && out ? `${answer}, ${out.state} sent ${new Date(out.t).toISOString()}, ${span(out.t)}${outcomeWord(out.t)}` : "");
  // The stop action: the main seat's line names the order; a seat beside's does not — it is its
  // "released <key>" line (places.ts) between the accepted on disk and the outcome. Not seen — the
  // run fails, no stand-in.
  const stopLine =
    action ??
    logText.split("\n").find((l) => / (?:stopped|released) /.test(l) && !l.includes(`stop order ${id} for `) && !!j && stampOf(l) >= j.at && (!outcome || stampOf(l) <= stampOf(outcome)));
  check(!!stopLine, `order (${label}): the stop action is in standings.log`, stopLine?.slice(0, 140) ?? "none");
  const stopAt = stopLine ? stampOf(stopLine) : NaN;
  // The stop waits for the accepted's answer up to the cap, no longer: an answer within it comes
  // before the stop; a later one or none — the stop not before the cap and before that answer.
  const inCap = !acc || !j ? "late" : !got ? "late" : acc.done <= j.at + ACCEPT_CAP_MS - STAMP_MS ? "within" : acc.done > acc.t + ACCEPT_CAP_MS + STAMP_MS ? "late" : "unsure";
  const answerAt = got ? acc.done : (acc?.aborted ?? Infinity);
  const first = inCap === "within" && acc.done - STAMP_MS <= stopAt;
  const cap = kept(stopAt, ACCEPT_CAP_MS);
  const capped = inCap === "late" && cap === "kept" && stopAt < answerAt - STAMP_MS;
  // Order only, not the cap's upper end: after an in-cap answer a stop is not bounded from above.
  const verdict = first ? "after the in-cap answer" : capped ? "not before the cap, before the late answer" : inCap === "unsure" ? "answer at the cap's edge — unsure" : inCap === "late" && stopAt >= answerAt - STAMP_MS ? "waited for the late answer" : `cap ${cap}`;
  // On disk before the stop: the proxy read the journal while the accepted was still in its hands
  // (--journal-root) — the final file's `at` alone is stamped before the write and proves nothing.
  // The read ended before the stop: timed (`walk`), or — after an in-cap answer — before forwarding it.
  const snapped = !!acc && (first || (typeof acc.walk === "number" && acc.t + acc.walk <= stopAt));
  check(acc?.disk === "accepted" && !!j && stopAt >= j.at && snapped, `order (${label}): accepted on disk before the stop`, `journal at the accepted: ${acc?.disk ?? "not read (proxy without --journal-root)"}, read ${typeof acc?.walk === "number" ? `by ${new Date(acc.t + acc.walk).toISOString()}` : "untimed"} · ${stopLine?.slice(0, 100) ?? "no stop line"}`);
  check(first || capped, `order (${label}): the stop after an in-cap answer, or not before the cap and before a late one`, acc ? `${answer} · stop ${Number.isNaN(stopAt) ? "unseen" : `${new Date(stopAt).toISOString()}, ${span(stopAt)}`} (${verdict})` : "");
  check(!!acc && !!outcome && afterAnswer(stampOf(outcome)), `order (${label}): the outcome line after the accepted's answer or its timeout`, `${outcome?.slice(0, 60)}${outcome ? outcomeWord(stampOf(outcome)) : ""}`);
}
