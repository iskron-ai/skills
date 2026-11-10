// The turn's end on a watch in Claude Code (graph @nks/nks-dev, node #9342): the plugin's Stop
// hook (hooks/hooks.json → hooks/rituals.mjs) reads the last turn of the transcript; a turn a
// watchdog's frame started, with no human word, that ended with text and laid no ask, say or
// send, is told to go on with the wake word — once: stop_hook_active keeps it from repeating.
// Stand-in transcripts in temporary repositories; ISKRON_RITUALS_HOOK aims it at a past release.
//
// The entries' form is taken from watch sessions' transcripts of Claude Code 2.1.273–2.1.277
// (~/.claude/projects/*/*.jsonl, September 2026) — fields and types, no content:
// - Monitor call (2026-09-16T11:19Z): assistant, content [tool_use {id, name "Monitor", input
//   {command, description, timeout_ms}}], stop_reason "tool_use"; its result — user, content
//   [tool_result {tool_use_id, content: string}], toolUseResult {taskId, timeoutMs, persistent}.
// - Monitor event (11:21Z): user, origin {kind "task-notification", producer? "session-task"},
//   content a string <task-notification> with <task-id>, <summary>, <event>; no <status>.
// - Background shell (17:23Z): Bash input {command, description, run_in_background: true}; result
//   toolUseResult {stdout, stderr, interrupted, isImage, noOutputExpected, backgroundTaskId}.
// - Its exit (21:44Z): the same notice with <task-id>, <tool-use-id>, <output-file>, <status>
//   completed|failed, <summary> «… completed (exit code 0)» — and no <event>: the frame the
//   exit-on-frame watchdog printed is in the output file, its exit 0 is the frame's sign.
// - One content block per assistant entry: a thinking entry carries the message's stop_reason
//   (end_turn) before its text entry; a human prompt — origin {kind "human"}, content a string.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { frameToText } from "../shared/frame-text.ts";
import { claudeRaw, COVER, repo, ritesOf } from "./rites-kit.mjs";
import { ask, said as roomSaid } from "./room-frames.mjs";

const WAKE = /человека в консоли нет/;
const CASE = "mcp__plugin_iskron_iskron__iskron_case";

const said = (text, stop = "end_turn") => ({
  type: "assistant",
  message: { content: [{ type: "text", text }], stop_reason: stop },
});
const thought = (stop = "end_turn") => ({
  type: "assistant",
  message: { content: [{ type: "thinking", thinking: "…", signature: "sig" }], stop_reason: stop },
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
/** A background shell's exit: no <event>, the status and the exit code in the summary. */
const exited = (task, use, status, code) => ({
  type: "user",
  origin: { kind: "task-notification" },
  message: {
    content: `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${use}</tool-use-id>\n<output-file>/t/tasks/${task}.output</output-file>\n<status>${status}</status>\n<summary>Background command "…" ${status === "completed" ? `completed (exit code ${code})` : `failed with exit code ${code}`}</summary>\n</task-notification>`,
  },
});
/** A session that armed its watchdog under Monitor (task bx1) and ended that turn. */
const armed = [
  human("заступай на вахту"),
  called("tu1", "Monitor", {
    command: 'node "/h/iskron.mjs" watchdog k--931--r5',
    description: "сторож",
    timeout_ms: 3600000,
  }),
  result("tu1", "Monitor started (task bx1, expires in 30m)", {
    taskId: "bx1",
    timeoutMs: 1800000,
    persistent: false,
  }),
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
  const frame = notice("bx1", "Дело №5: слово [3]");
  const turn = [...armed, frame, thought(), said("Владелец, вопрос: брать?")];
  const out = stop(turn);
  assert.equal(out?.decision, "block", JSON.stringify(out));
  assert.match(out.reason, WAKE);
  assert.match(out.reason, /iskron_case line/);
  assert.match(out.reason, /человеку ask/);
  assert.equal(stop(turn, { stop_hook_active: true }), null, "the turn it woke is not woken again");
});

test("the exit-on-frame watchdog under a background shell: its exit 0 is a frame, a failure is not", () => {
  const shell = [
    called("tu2", "Bash", {
      command: "node watchdog-exit.mjs k",
      description: "сторож",
      run_in_background: true,
    }),
    result("tu2", "Command running in background with ID: b77. Output is being written to: …", {
      stdout: "",
      stderr: "",
      interrupted: false,
      isImage: false,
      noOutputExpected: false,
      backgroundTaskId: "b77",
    }),
    said("слушаю"),
  ];
  const out = stop([...shell, exited("b77", "tu2", "completed", 0), said("ответ в консоль?")]);
  assert.equal(out?.decision, "block", JSON.stringify(out));
  const dead = [...shell, exited("b77", "tu2", "failed", 1), said("токен умер?")];
  assert.equal(stop(dead), null, "a loud exit is no frame");
});

test("no wake word: the turn spoke, a human spoke, another task woke it, no text", () => {
  const frame = notice("bx1", "кадр");
  for (const action of ["ask", "say", "answer"])
    assert.equal(
      stop([...armed, frame, called("c", CASE, { action }), result("c", "ok"), said("готово?")]),
      null,
      action,
    );
  const send = called("s", "mcp__iskron-bridge__iskron_channel", { action: "send" });
  assert.equal(stop([...armed, frame, send, result("s", "ok"), said("отправил?")]), null, "send");
  assert.equal(stop([...armed, human("как дела?"), said("хорошо?")]), null, "a human's turn");
  assert.equal(
    stop([...armed, human("проверь"), frame, said("проверил?")]),
    null,
    "a frame entered a human's turn",
  );
  assert.equal(
    stop([...armed, notice("agent-1", "Agent finished"), said("субагент закончил?")]),
    null,
    "another task's notice is no frame",
  );
  const hello = 'слушаю стояние k--931--r5\n{"type":"hello","pending":0}';
  assert.equal(stop([...armed, notice("bx1", hello), said("слушаю?")]), null, "hello");
  const expired = "[Monitor expired after 30m with 9 events delivered. Re-arm it]";
  assert.equal(stop([...armed, notice("bx1", expired), said("перевзвёл?")]), null, "expiry");
  const backfill = `${hello}\nДело №5: слово [3]`;
  assert.equal(stop([...armed, notice("bx1", backfill), said("вопрос?")])?.decision, "block");
  const tail = [...armed, frame, called("r", "Read", { file_path: "x" })];
  assert.equal(stop(tail), null, "the turn ended on a call, not text");
  const limit = { ...said("You've hit your limit", "stop_sequence"), isApiErrorMessage: true };
  assert.equal(stop([...armed, frame, limit]), null, "the harness's error is no word");
});

test("a ledger result answers the frame's turn without a duplicate message (#10107)", () => {
  const frame = notice("bx1", "Дело №5: слово [3]");
  const text = `Результат: ${"проверено на носителе. ".repeat(20)}`;
  const line = called("ledger", CASE, {
    action: "line",
    room: "5",
    key: "probe",
    done: "Проверил носитель",
    verdict: "ok",
  });
  assert.equal(stop([...armed, frame, line, result("ledger", "ok"), said(text)]), null);
  const read = called("read", CASE, { action: "read", room: "5" });
  assert.equal(
    stop([...armed, frame, read, result("read", "case"), said(text)])?.decision,
    "block",
    "reading the ledger does not answer the turn",
  );
});

test("the cover's rituals field: without `turn` the word keeps silent, with it or without the field it speaks", () => {
  const turn = [...armed, notice("bx1", "кадр"), said("в консоль?")];
  const field = (rituals) => COVER.replace("  stamp:", `  rituals:${rituals}\n  stamp:`);
  assert.equal(stop(turn, {}, repo({ agents: field(" start push") })), null, "start push");
  assert.equal(stop(turn, {}, repo({ agents: field(" start turn") }))?.decision, "block");
  assert.equal(stop(turn, {}, repo())?.decision, "block", "no field — every ritual");
});

test("the turn is judged alone: a word laid in an earlier turn does not count", () => {
  const earlier = [called("c", CASE, { action: "say" }), result("c", "ok"), said("сказал")];
  const out = stop([...armed, ...earlier, notice("bx1", "кадр"), said("в консоль?")]);
  assert.equal(out?.decision, "block");
});

// Case №2730 [6]: a console the owner sits at, woken after every service frame answered by a line.
test("no wake word (#9345): a human wrote lately, a short line with no question, counts only", () => {
  const at = (e, ms) => ({ ...e, timestamp: new Date(Date.now() - ms).toISOString() });
  const frame = notice("bx1", "Дело №5: слово [3]");
  const long = `Отчёт: ${"сделано, проверено. ".repeat(20)}`;
  const lately = [at(human("заступай на вахту"), 10 * 60_000), ...armed.slice(1)];
  assert.equal(stop([...lately, frame, said("брать?")]), null, "a human wrote 10 min ago");
  const before = [at(human("заступай на вахту"), 40 * 60_000), ...armed.slice(1)];
  assert.equal(stop([...before, frame, said("брать?")])?.decision, "block", "40 min ago");
  assert.equal(stop([...armed, frame, said("принял, жду CI")]), null, "a receipt");
  assert.equal(stop([...armed, frame, said(long)])?.decision, "block", "past 280 characters");
  // The texts the watchdog prints: an unaddressed record's count, wrapped; with a question to me.
  const counts = frameToText(roomSaid("defer", 63), "");
  const wrapped = counts.replace("; ", ";\n");
  assert.equal(stop([...armed, notice("bx1", wrapped), said("брать?")]), null, "counts only");
  const yours = `${counts}\n${frameToText(ask(80), "")}`;
  assert.equal(stop([...armed, notice("bx1", yours), said("брать?")])?.decision, "block", "yours");
});
