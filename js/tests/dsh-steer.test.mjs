// Behavioural probe: where a word of the dsh hearing goes (graph @nks/nks-dev, nodes #10776,
// #11071; js/dsh/steer.ts). Observed live on LAB (candidate f1ff1e3a, dsh 0.2.2-rc.1, glm-5.3,
// probe #8419): a continued session's stale word, laid as next-turn while turn 2 already ran
// from the task, became a message only at turn 3, after the model's whole Start. Now: a word
// before the root's first step joins that step; a word during a turn is steered into it; a word
// at idle is a followup turn as before; a subagent hears nothing.
//
// The stand-in root agent, by the installed @deepseek-ai/dsh-agent-loop 0.2.2-rc.1: status
// "running"/"idle" (lib/index.js:554-556); send(message, target, wakeup), followup — next-turn,
// steer — next-step with a wake, inject — next-step without (index.js:564-578). agent/pre-step is
// a waterfall (payload {agent, messages, turn, step, signal}, next) whose decision {kind: "enter",
// messages} replaces the step's messages (dsh-agent lib/types/runtime-types.d.ts:321-339; agent
// fused into the payload — dsh-agent lib/index.js:358-387); the inbox is claimed before it
// (agent-loop index.js:670). Observed live (#10657 v6 and the brief of this change): agent/pre-step
// plus steer gives step 2 of the same turn and the model sees it. The rest is not observed.
//
// ISKRON_DSH_PLUGIN points the probe at any copy (a past revision) so it can be shown red
// before a fix. Run with `make test-dsh`.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { test } from "node:test";

import { holdFilePathOf, seenFilePathOf } from "../shared/standings.ts";
import { BUILT } from "./built.mjs";
import { KEY, sandbox, SESSION, until } from "./dsh-session.mjs";
import { directWord } from "./room-frames.mjs";

const SOURCE =
  process.env.ISKRON_DSH_PLUGIN || `${BUILT}/skills/establish-mcp/references/dsh-plugin/index.js`;
const PLUGIN = (await import(`${SOURCE}?steer`)).apply;

process.env.ISKRON_BRIDGE_LANG = "ru";
process.env.ISKRON_DSH_FIRST_MS = "3000";

const COVER = "---\niskron:\n  graph: '@nks/nks-dev'\n  holon: 4057\n  agent_role: 931\n---\n# p\n";
const TASK = {
  id: "task-1",
  role: "user",
  content: [{ type: "text", text: "Продолжаем." }],
  source: { kind: "user" },
};

/** The stand-in root (or child) agent; got — each send with its target. */
function agentOf(session = SESSION) {
  const got = [];
  const agent = {
    session,
    status: "idle",
    ctx: { systemPrompt: { section: () => undefined } },
    send(m, target, wakeup) {
      got.push({ target, wakeup, m });
    },
    followup(m) {
      this.send(m, "next-turn", true);
    },
    steer(m) {
      this.send(m, "next-step", true);
    },
    inject(m) {
      this.send(m, "next-step", false);
    },
  };
  return { agent, got };
}

/** The plugin over a stand-in dsh; the session's own seat (the cover's role) already holds. */
async function session(t, source) {
  const box = await sandbox(t, COVER);
  const handlers = new Map();
  const logs = [];
  PLUGIN({ on: (n, fn) => handlers.set(n, fn), logger: { info: (l) => logs.push(String(l)) } });
  t.after(() => handlers.get("session/disposed")?.(SESSION));
  writeFileSync(
    holdFilePathOf(box.authDir, KEY),
    JSON.stringify({
      realm: "@nks/nks-dev",
      karta: 931,
      name: "proba",
      url: "https://example.invalid/",
      at: Date.now(),
      cwd: process.cwd(),
      client: "dsh-mcp-client",
    }) + "\n",
  );
  const root = agentOf();
  handlers.get("agent/created")?.({ agent: root.agent, source });
  root.agent.status = "running"; // the task's turn drives
  const attach = async () => {
    assert(await until(() => box.conns.size === 1));
    box.send({ kind: "attached", key: KEY, seen: seenFilePathOf(box.authDir, KEY), buffered: 0 });
    assert(await until(() => logs.some((l) => l.includes("слушаю стояние"))));
  };
  /** One agent/pre-step of agent: the decision that enters the step. */
  const preStep = (agent, messages, step = 1) => {
    const next = async () => ({ kind: "enter", messages });
    const h = handlers.get("agent/pre-step");
    const payload = { agent, messages, turn: 3, step, signal: new AbortController().signal };
    return h ? h(payload, next) : next();
  };
  const frame = (id) => {
    const f = directWord(id);
    box.send({ kind: "frame", frame: f, raw: JSON.stringify(f) });
  };
  return { box, handlers, logs, root, attach, preStep, frame };
}

const texts = (ms) => ms.map((m) => m.content?.[0]?.text ?? "");

// (a) LAB #8419: the continued session's first step started from the task while its hearing had
// not yet attached; the stale word came 3 s later as next-turn and the model met it a turn late.
test("continued: the stale word that waited for the seat enters the first step of the first turn", async (t) => {
  const s = await session(t, "resume");
  const decision = s.preStep(s.root.agent, [TASK]); // the inbox claimed the task already
  await s.attach();
  s.box.send({ kind: "stale", frames: [directWord("stale-1")] });
  const d = await decision;
  const said = texts(d.messages);
  assert.equal(d.messages[0], TASK, "the task stays");
  assert.equal(d.messages.length, 2, said.join("\n---\n"));
  assert.match(said[1], /прямое слово соседа/);
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(s.root.got, [], "not one more message to the inbox — no next turn");
});

test("continued with nothing waiting: the first step waits for the hearing, not the whole window", async (t) => {
  const s = await session(t, "resume");
  const began = Date.now();
  const decision = s.preStep(s.root.agent, [TASK]);
  await s.attach();
  const d = await decision;
  assert.deepEqual(d.messages, [TASK]);
  assert.ok(Date.now() - began < 3000, `waited ${Date.now() - began} ms`);
});

// (b) A word said to the seat while the root's turn runs goes into that turn, at its next step.
test("a frame during the turn is steered into the same turn, not queued for the next one", async (t) => {
  const s = await session(t, "startup");
  await s.attach();
  await s.preStep(s.root.agent, [TASK]); // the turn's first step is under way
  s.frame("direct-during");
  assert(await until(() => s.root.got.length === 1));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.root.got.length, 1, "exactly one message");
  const [{ target, wakeup, m }] = s.root.got;
  assert.equal(target, "next-step", "steered: the same turn's next step");
  assert.equal(wakeup, true, "steer wakes; inject does not and is not used");
  assert.match(m.content[0].text, /прямое слово соседа/);
});

// (c) At idle — as before: one followup turn.
test("a frame at idle is one followup turn, as before", async (t) => {
  const s = await session(t, "startup");
  await s.attach();
  await s.preStep(s.root.agent, [TASK]);
  s.root.agent.status = "idle";
  s.handlers.get("agent/status")?.({ agent: s.root.agent, status: "idle" });
  s.frame("direct-idle");
  assert(await until(() => s.root.got.length === 1));
  assert.equal(s.root.got[0].target, "next-turn");
  assert.equal(s.root.got[0].wakeup, true);
});

// (d) A subagent spawned in the process (header by the types of the installed dsh-session
// 0.2.2-rc.1, not observed): its steps take no frames, the root's running turn does.
test("a subagent's step takes no frame; the root's turn does", async (t) => {
  const s = await session(t, "startup");
  await s.attach();
  await s.preStep(s.root.agent, [TASK]);
  const sub = agentOf({
    id: "session-dsh-sub",
    header: { parentSession: SESSION.id, origin: "subagent", delegationDepth: 1 },
  });
  sub.agent.status = "running";
  s.handlers.get("agent/created")?.({ agent: sub.agent, source: "startup" });
  const subTask = { ...TASK, id: "sub-task" };
  const d = await s.preStep(sub.agent, [subTask]);
  assert.deepEqual(d.messages, [subTask], "the subagent's step is its own");
  s.frame("direct-sub");
  assert(await until(() => s.root.got.length === 1));
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(sub.got.length, 0, "the subagent hears nothing of the root's seat");
  assert.equal(s.root.got[0].target, "next-step");
});
