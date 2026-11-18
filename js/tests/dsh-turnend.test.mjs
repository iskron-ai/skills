// Behavioural probe for the turn's end of the dsh plugin (graph @nks/nks-dev, nodes #9342, #9345,
// #11071), the pattern of opencode-turnend.test.mjs: a turn a frame of the hearing entered, with
// no human word, that ended with a long text and laid no word where the human sees it, gets the
// wake word as one next-turn message; the turn the wake word itself entered does not repeat it.
// Out of headless the word goes at the root's idle (agent/status idle), when a followup opens a
// driver of its own — not on turn/end. The stand-in session and its sources — dsh-session.mjs;
// the headless hold — dsh-hold.test.mjs. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { hearingSession, isWake, LONG, text } from "./dsh-session.mjs";

const say = (id, action = "say") => ({
  type: "tool-call",
  id,
  name: "mcp__iskron__iskron_case",
  arguments: JSON.stringify({ action, room: "1" }),
});
const human = (t) => ({ id: "h1", role: "user", content: [text(t)], source: { kind: "user" } });

test("a frame's turn that lost its word in the console gets the wake word, once", async (t) => {
  const s = await hearingSession(t);
  const laid = await s.frame("turn-1");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.sent.length, 2);
  const wake = s.sent[1];
  assert.ok(isWake(wake), wake.content[0].text);
  // The turn the wake word itself entered ends with text too: no second word.
  await s.turn({ entered: [wake], steps: [[text(LONG)]] });
  assert.equal(s.sent.length, 2);
});

test("a word laid by a speaking call, a human's word, a receipt — no wake", async (t) => {
  const s = await hearingSession(t);
  let laid = await s.frame("turn-2");
  await s.turn({
    entered: [laid],
    steps: [[text("иду"), say("c1")], { toolCallId: "c1", isError: false }, [text(LONG)]],
  });
  laid = await s.frame("turn-3");
  await s.turn({ entered: [laid, human("как дела?")], steps: [[text(LONG)]] });
  laid = await s.frame("turn-3r");
  await s.turn({ entered: [laid], steps: [[text("готово")]] });
  assert.equal(s.sent.filter(isWake).length, 0);
});

test("a failed speaking call, an aborted turn, a turn without a frame", async (t) => {
  const s = await hearingSession(t);
  let laid = await s.frame("turn-4");
  await s.turn({
    entered: [laid],
    steps: [[say("c2")], { toolCallId: "c2", isError: true }, [text(LONG)]],
  });
  assert.equal(s.sent.filter(isWake).length, 1, "a speaking call that failed laid no word");
  laid = await s.frame("turn-5");
  await s.turn({ entered: [laid], steps: [[text(LONG)]], end: "aborted" });
  await s.turn({ steps: [[text(LONG)]] });
  assert.equal(s.sent.filter(isWake).length, 1);
});

test("a cover whose rituals leave the turn out keeps it silent", async (t) => {
  const cover =
    "---\niskron:\n  graph: r7\n  holon: 12\n  agent_role: 34\n  contract: 44\n  rituals: start push merge\n---\n# x\n";
  const s = await hearingSession(t, cover);
  const laid = await s.frame("turn-6");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.sent.filter(isWake).length, 0);
});

// (д) Out of headless no task holds the idle — it would hold a human's input; the wake word waits
// for the root's idle, not for turn/end: until the driver retires the phase is running, and a
// followup then is neither latched (index.js:618-620) nor seen by a turn that has already checked
// its inbox (index.js:827) — at idle the followup starts a driver of its own. Read from the code,
// not observed live in an interactive or web session.
test("out of headless: no task, the wake word at the idle and not before", async (t) => {
  const s = await hearingSession(t);
  const laid = await s.frame("turn-9");
  await s.turn({ entered: [laid], steps: [[text(LONG)]], idle: false });
  assert.equal(s.sent.filter(isWake).length, 0, "no word on turn/end itself");
  s.idle();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(s.sent.filter(isWake).length, 1);
  assert.equal(s.jobs.length, 0, "no maintenance task out of headless");
});

test("another profile (web) keeps the wake word and takes no task", async (t) => {
  const was = process.argv;
  process.argv = [was[0], "/opt/dsh/lib/bin.js", "web", "--port", "1"];
  t.after(() => (process.argv = was));
  const s = await hearingSession(t);
  const laid = await s.frame("turn-10");
  await s.turn({ entered: [laid], steps: [[text(LONG)]] });
  assert.equal(s.sent.filter(isWake).length, 1);
  assert.equal(s.jobs.length, 0);
});
