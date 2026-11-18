// Behavioural probe for the headless hold of the dsh plugin (graph @nks/nks-dev, node #11071):
// headless exits at its first idle with no children (dsh-headless/lib/index.js:369-383, 0.2.2-rc.1)
// and a word sent after that never lands — observed live. So the root's idle is taken by a
// maintenance task, in the same synchronous call as agent/status idle; the wake word or a frame
// leaves the task as a followup and the task ends, opening the next turn; the hold window or the
// signal's abort end it without a word. The stand-in agent's maintenance and the session's
// sources — dsh-session.mjs. Headless signs: the service `headlessStartup` through
// ctx.get(name, strict) — observed present on agent/created; the launcher's profile in argv.
// Run with `make test-dsh`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { hearingSession, isWake, LONG, text, until } from "./dsh-session.mjs";

const HEADLESS = { get: (name) => (name === "headlessStartup" ? { task: "brief" } : undefined) };

test("(а) headless: the wake word after the turn leaves the task, once", async (t) => {
  const s = await hearingSession(t, null, HEADLESS);
  const laid = await s.frame("hold-1");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  const wakes = s.sent.filter(isWake);
  assert.equal(wakes.length, 1);
  assert.ok(s.inTask.has(wakes[0]), "the wake word went from inside the task");
  assert.equal(s.jobs.length, 1);
  assert.ok(await until(() => s.jobs[0].settled), "the task ended: the next turn may run");
  // The wake word's own turn: no second word; its idle is held again, the ear lives.
  await s.turn({ entered: [wakes[0]], steps: [[text(LONG)]] });
  assert.equal(s.sent.filter(isWake).length, 1);
  assert.equal(s.jobs.length, 2);
  assert.equal(s.jobs[1].settled, false);
});

test("(б) headless: a frame during the task leaves through it", async (t) => {
  const s = await hearingSession(t, null, HEADLESS);
  await s.turn({ steps: [[text("готово")]] });
  assert.equal(s.jobs.length, 1, "the idle is held while the ear lives");
  assert.equal(s.jobs[0].settled, false);
  const laid = await s.frame("hold-2");
  assert.ok(s.inTask.has(laid), "the frame went from inside the task");
  assert.ok(await until(() => s.jobs[0].settled));
  assert.equal(s.sent.length, 1);
});

test("(в) headless: the hold window ends the task without a word", async (t) => {
  const was = process.env.ISKRON_DSH_HOLD_MS;
  process.env.ISKRON_DSH_HOLD_MS = "150";
  t.after(() =>
    was === undefined
      ? delete process.env.ISKRON_DSH_HOLD_MS
      : (process.env.ISKRON_DSH_HOLD_MS = was),
  );
  const s = await hearingSession(t, null, HEADLESS);
  await s.turn({ steps: [[text("готово")]] });
  assert.equal(s.jobs.length, 1);
  assert.ok(await until(() => s.jobs[0].settled, 2000), "the window closed the task");
  assert.equal(s.sent.length, 0);
});

test("(г) headless: the task's abort ends it without a word", async (t) => {
  const s = await hearingSession(t, null, HEADLESS);
  await s.turn({ steps: [[text("готово")]] });
  assert.equal(s.jobs.length, 1);
  s.jobs[0].ac.abort({ kind: "cancel" });
  assert.ok(await until(() => s.jobs[0].settled, 500));
  assert.equal(s.sent.length, 0);
});

test("(г) headless: a wake word whose task aborts at once is not sent", async (t) => {
  const s = await hearingSession(t, null, HEADLESS, { abortAtStart: true });
  const laid = await s.frame("hold-3");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.jobs.length, 1);
  assert.ok(await until(() => s.jobs[0].settled, 500));
  assert.equal(s.sent.filter(isWake).length, 0);
});

for (const argv of [
  ["headless", "--patch", "p.yml", "--json", "brief"],
  ["--patch", "p.yml", "--profile", "headless", "brief"],
])
  test(`headless by the launcher's profile in argv (${argv.join(" ")}): the idle is held`, async (t) => {
    const was = process.argv;
    process.argv = [was[0], "/opt/dsh/lib/bin.js", ...argv];
    t.after(() => (process.argv = was));
    const s = await hearingSession(t);
    const laid = await s.frame("hold-4");
    await s.turn({ entered: [laid], steps: [[text(LONG)]] });
    const wakes = s.sent.filter(isWake);
    assert.equal(wakes.length, 1);
    assert.ok(s.inTask.has(wakes[0]));
  });
