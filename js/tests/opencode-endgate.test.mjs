// The end gate of the plugin's channel half (endgate.ts; graph @nks/nks-dev, nodes #11360, #11359):
// once a session is ended nothing opens a turn in it; before the end nothing changes — a direct
// word steers, a wake-up batch queues, both into the live session. The host's word decides
// (host.ts accepting): "ended" — archived or no such session; "unknown" — the host did not answer.
// Both hold the frame: a word to stderr, no prompt, no synthetic.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { delay, plugin, SANDBOX, until } from "./opencode-kit.mjs";

const FAKE_BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "fake-bridge.mjs");

function bridgeEnv(name, extra = {}) {
  const log = join(SANDBOX, `${name}.log`);
  const reply = join(SANDBOX, `${name}.reply`);
  const events = join(SANDBOX, `${name}.events`);
  writeFileSync(reply, "");
  writeFileSync(events, "");
  return {
    log,
    reply,
    events,
    env: {
      ISKRON_BRIDGE_PATH: FAKE_BRIDGE,
      FB_LOG: log,
      FB_REPLY: reply,
      FB_EVENTS: events,
      ...extra,
    },
  };
}

const pidOf = (log) => Number(readFileSync(log, "utf8").trim().split("\n")[0].split(/\s+/)[1]);
const pulsesIn = (calls) =>
  readFileSync(calls, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((c) => c.name === "iskron/pulse")
    .map((c) => c.arguments);

// Synthetic held events here model an explicit caller.
const event = (kind, extra) =>
  JSON.stringify({ kind, ...(kind === "held" ? { automatic: false } : {}), ...extra }) + "\n";
const frame = (body) => ({
  type: "message",
  id: "msg-1",
  body,
  provenance: {
    from_standing: "@alari:telegram-bot",
    from_karta_seq: 1226,
    auth: "pat",
    via: "hook",
  },
});

const names = (rec) => [...rec.tools().keys()].sort();
const serverTools = (rec) => until(() => names(rec).length === 3, "the server's tools", 8000);

/** A session `s` with a seat (the fake bridge up, its events file named). */
async function seated(name, ctxOpts, extra = {}) {
  const b = bridgeEnv(name, extra);
  const rec = await plugin(b.env, ctxOpts);
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s");
    const events = `${b.events}.${pidOf(b.log)}`;
    appendFileSync(events, event("held", { key: "gate--931--nks-dev" }));
    await until(() => rec.said().includes("мост держит место gate--931--nks-dev"), "the held word");
    return { rec, events };
  } catch (e) {
    await rec.stop();
    throw e;
  }
}

/** Everything the bridge may say about a session: each one a prompt into a live session. */
const everything = () =>
  [
    event("frame", { frame: frame("слово"), raw: "" }),
    event("stale", { pending: 1, frames: [{ id: "msg-1" }], text: "хвост: слово" }),
    event("backlog", { pending: 1, frames: [{ id: "w1" }], text: "Побудка: кадров 1\n\nпервое" }),
    // The platform's old life-check wake (lifecheck.ts) — it stays, behind the same gate.
    event("frame", {
      frame: { type: "message", id: "lc-1", body: "жив?", provenance: { wake: "life_check" } },
      raw: "",
    }),
    event("alive", { version: "9" }),
    event("dead", { code: "4001" }),
    event("evicted", { code: "4002" }),
  ].join("");

test("before the end nothing changes: a direct word steers and a wake-up batch queues, both into the live session", async () => {
  const calls = join(SANDBOX, "gate-live.calls");
  writeFileSync(calls, "");
  const b = bridgeEnv("gate-live", { FB_CALLS: calls });
  const rec = await plugin(b.env, { sessions: [{ id: "s", time: { updated: 1 } }] });
  try {
    await serverTools(rec);
    await rec.call("iskron_channel", { action: "connect" }, "s");
    const events = `${b.events}.${pidOf(b.log)}`;
    appendFileSync(events, event("held", { key: "gate--931--nks-dev" }));
    await until(() => rec.said().includes("мост держит место gate--931--nks-dev"), "the held word");
    // Idle: a wake-up batch queues — it wakes the session, it cuts no turn.
    appendFileSync(
      events,
      event("backlog", { pending: 1, frames: [{ id: "w1" }], text: "Побудка: кадров 1\n\nпервое" }),
    );
    await until(() => rec.prompts.length === 1, "the backlog prompt");
    assert.equal(rec.prompts[0].sessionID, "s");
    assert.equal(rec.prompts[0].delivery, "queue");
    // Running: a direct word enters the turn.
    rec.emit({ type: "session.status", data: { sessionID: "s", status: { type: "busy" } } });
    await until(() => pulsesIn(calls).some((p) => p.state === "busy"), "the busy word");
    appendFileSync(events, event("frame", { frame: frame("слово в ход"), raw: "" }));
    await until(() => rec.prompts.length === 2, "the frame prompted");
    assert.equal(rec.prompts[1].sessionID, "s");
    assert.equal(rec.prompts[1].delivery, "steer");
    assert.match(rec.prompts[1].text, /слово в ход/);
    assert.doesNotMatch(rec.said(), /не доставлен|НЕКУДА|которой больше нет/, "nothing was held");
  } finally {
    await rec.stop();
  }
});

test("unknown: a session the host did not answer about gets no turn from anything — every word of the bridge is held", async () => {
  const { rec, events } = await seated("gate-unknown", {
    sessions: [{ id: "s", time: { updated: 1 } }],
    faults: { getFails: 1000 },
  });
  try {
    appendFileSync(events, everything());
    await delay(700);
    assert.equal(rec.prompts.length, 0, "no turn in a session not known to be live");
    assert.equal(rec.synthetics.length, 0, "no synthetic either");
    // Frame, stale tail and wake-up carry the held word each; alive, dead and evicted say their own.
    assert.ok(
      (rec.said().match(/сессия s — неизвестно, жива ли/g) ?? []).length >= 3,
      "every path names the session it held the word for",
    );
    assert.doesNotMatch(rec.said(), /закрыта или в архиве/, "no answer is not read as an end");
    assert.doesNotMatch(rec.said(), /вложен в сессию/, "nothing was delivered");
  } finally {
    await rec.stop();
  }
});

// The bridge marked the frame seen when it notified (hold.ts): a refusal of an unknown session
// would lose it. The plugin holds it and asks again — on a backoff and on the session's next event.
const directAndWake = () =>
  event("frame", { frame: frame("слово в ход"), raw: "" }) +
  event("backlog", { pending: 1, frames: [{ id: "w1" }], text: "Побудка: кадров 1\n\nпервое" });

test("unknown, then live: the held words go once each, a direct word steering and a wake-up queueing as they would have", async () => {
  const faults = { getFails: 1000 };
  const { rec, events } = await seated(
    "gate-unknown-live",
    { sessions: [{ id: "s", time: { updated: 1 } }], faults },
    { ISKRON_OPENCODE_HOLD_MS: 150 },
  );
  try {
    appendFileSync(events, directAndWake());
    await until(
      () => (rec.said().match(/сессия s — неизвестно, жива ли/g) ?? []).length >= 2,
      "both words held",
    );
    await delay(100);
    assert.equal(rec.prompts.length, 0, "no turn while the host is silent");
    faults.getFails = 0; // the host answers again: the session is live
    await until(() => rec.prompts.length === 2, "the held words delivered", 8000);
    await delay(1500); // every backoff check has passed
    assert.equal(rec.prompts.length, 2, "each held word exactly once");
    const [direct, wake] = rec.prompts;
    assert.equal(direct.sessionID, "s");
    assert.equal(direct.delivery, "steer");
    assert.match(direct.text, /слово в ход/);
    assert.equal(wake.sessionID, "s");
    assert.equal(wake.delivery, "queue");
    assert.match(wake.text, /первое/);
  } finally {
    await rec.stop();
  }
});

test("unknown, then ended: the held words are never delivered — the session's next event asks the host again", async () => {
  const faults = { getFails: 1000 };
  const gone = new Set();
  const { rec, events } = await seated(
    "gate-unknown-ended",
    { sessions: [{ id: "s", time: { updated: 1 } }], faults, gone },
    { ISKRON_OPENCODE_HOLD_MS: 600_000 }, // no backoff check inside the probe: the event asks
  );
  try {
    appendFileSync(events, directAndWake());
    await until(
      () => (rec.said().match(/сессия s — неизвестно, жива ли/g) ?? []).length >= 2,
      "both words held",
    );
    faults.getFails = 0;
    gone.add("s"); // the host answers now — no such session
    rec.emit({ type: "session.status", data: { sessionID: "s", status: { type: "idle" } } });
    await until(
      () => (rec.said().match(/сессия s закрыта или в архиве/g) ?? []).length >= 2,
      "the held words dropped",
    );
    await delay(500);
    assert.equal(rec.prompts.length, 0, "an ended agent gets nothing");
    assert.equal(rec.synthetics.length, 0, "no synthetic either");
  } finally {
    await rec.stop();
  }
});

test("ended: a session the host knows of no more gets no turn from anything — every word of the bridge is held", async () => {
  const gone = new Set();
  const { rec, events } = await seated("gate-ended", {
    sessions: [{ id: "s", time: { updated: 1 } }],
    gone,
  });
  try {
    gone.add("s"); // the harness deleted the session behind the agent's back
    appendFileSync(events, everything());
    await until(
      () => (rec.said().match(/сессия s закрыта или в архиве/g) ?? []).length >= 3,
      "the closed words",
    );
    await delay(700);
    assert.equal(rec.prompts.length, 0, "no turn in an ended session");
    assert.equal(rec.synthetics.length, 0, "no synthetic either");
    assert.doesNotMatch(rec.said(), /вложен в сессию/, "nothing was delivered");
  } finally {
    await rec.stop();
  }
});
