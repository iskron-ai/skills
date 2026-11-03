// The turn's end on a watch in Claude Code (graph @nks/nks-dev, node #9342): the plugin's Stop
// hook (hooks/hooks.json → hooks/rituals.mjs) reads the last turn of the transcript; a turn a
// watchdog's frame started, with no human word, that ended with text and laid no ask, say or
// send, is told to go on with the wake word — once: stop_hook_active keeps it from repeating.
// Stand-in transcripts in temporary repositories; ISKRON_RITUALS_HOOK aims it at a past release.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { claudeRaw, repo, ritesOf } from "./rites-kit.mjs";

const WAKE = /человека в консоли нет/;
const CASE = "mcp__plugin_iskron_iskron__iskron_case";

const said = (text, stop = "end_turn") => ({
  type: "assistant",
  message: { content: [{ type: "text", text }], stop_reason: stop },
});
const called = (id, name, input) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" },
});
const result = (id, content, toolUseResult) => ({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, content }] },
  ...(toolUseResult ? { toolUseResult } : {}),
});
const human = (text) => ({ type: "user", origin: { kind: "human" }, message: { content: text } });
const notice = (task, event) => ({
  type: "user",
  origin: { kind: "task-notification" },
  message: {
    content: `<task-notification>\n<task-id>${task}</task-id>\n<summary>Monitor event</summary>\n<event>${event}</event>\n</task-notification>`,
  },
});
/** A session that armed its watchdog under Monitor (task bx1) and ended that turn. */
const armed = [
  human("заступай на вахту"),
  called("tu1", "Monitor", { command: 'node "/h/iskron.mjs" watchdog k--931--r5' }),
  result("tu1", "Monitor started (task bx1, expires in 30m)", { taskId: "bx1" }),
  said("встал на вахту"),
];

let n = 0;
function stop(entries, extra = {}, dir = repo({ agents: null })) {
  const transcript = join(dir, `t${n++}.jsonl`);
  writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return claudeRaw(dir, { hook_event_name: "Stop", transcript_path: transcript, ...extra });
}

test("hooks.json: the rituals entry on Stop", () => {
  assert.equal(ritesOf("Stop").length, 1);
});

test("a frame's turn ending with text and no word laid: go on with the wake word, once", () => {
  const turn = [...armed, notice("bx1", "Дело №5: слово [3]"), said("Владелец, вопрос: брать?")];
  const out = stop(turn);
  assert.equal(out?.decision, "block", JSON.stringify(out));
  assert.match(out.reason, WAKE);
  assert.match(out.reason, /iskron_case ask/);
  assert.equal(stop(turn, { stop_hook_active: true }), null, "the turn it woke is not woken again");
});

test("the legacy watchdog under a background shell is a frame's source too", () => {
  const out = stop([
    called("tu2", "Bash", { command: "node watchdog-exit.mjs k", run_in_background: true }),
    result("tu2", "Command running in background with ID: b77", { backgroundTaskId: "b77" }),
    said("слушаю"),
    notice("b77", "кадр"),
    said("ответ в консоль"),
  ]);
  assert.equal(out?.decision, "block");
});

test("no wake word: the turn spoke, a human spoke, another task woke it, no text", () => {
  const frame = notice("bx1", "кадр");
  for (const action of ["ask", "say", "answer"])
    assert.equal(
      stop([...armed, frame, called("c", CASE, { action }), result("c", "ok"), said("готово")]),
      null,
      action,
    );
  const send = called("s", "mcp__iskron-bridge__iskron_channel", { action: "send" });
  assert.equal(stop([...armed, frame, send, result("s", "ok"), said("отправил")]), null, "send");
  assert.equal(stop([...armed, human("как дела?"), said("хорошо")]), null, "a human's turn");
  assert.equal(
    stop([...armed, human("проверь"), frame, said("проверил")]),
    null,
    "a frame entered a human's turn",
  );
  assert.equal(
    stop([...armed, notice("agent-1", "Agent finished"), said("субагент закончил")]),
    null,
    "another task's notice is no frame",
  );
  const hello = 'слушаю стояние k--931--r5\n{"type":"hello","pending":0}';
  assert.equal(stop([...armed, notice("bx1", hello), said("слушаю")]), null, "hello");
  const expired = "[Monitor expired after 30m with 9 events delivered. Re-arm it]";
  assert.equal(stop([...armed, notice("bx1", expired), said("перевзвёл")]), null, "expiry");
  const backfill = `${hello}\nДело №5: слово [3]`;
  assert.equal(stop([...armed, notice("bx1", backfill), said("вопрос")])?.decision, "block");
  const tail = [...armed, frame, called("r", "Read", { file_path: "x" })];
  assert.equal(stop(tail), null, "the turn ended on a call, not text");
  const limit = { ...said("You've hit your limit", "stop_sequence"), isApiErrorMessage: true };
  assert.equal(stop([...armed, frame, limit]), null, "the harness's error is no word");
});

test("the turn is judged alone: a word laid in an earlier turn does not count", () => {
  const earlier = [called("c", CASE, { action: "say" }), result("c", "ok"), said("сказал")];
  const out = stop([...armed, ...earlier, notice("bx1", "кадр"), said("в консоль")]);
  assert.equal(out?.decision, "block");
});
