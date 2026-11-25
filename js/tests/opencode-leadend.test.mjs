// The end of a lead subagent carries the errand's outcome — №1225 [38]/[45], the live
// distinguisher of №1237: the parent's folder and the child's folder are different locations,
// the deciding instance missed the turn's execution.started, and the end sealed while the
// child's turn was still streaming — «КОНЧЕН» carried a stale intermediate word, and a late
// callback 16 s later revived the lead and told the parent «сдал ход — продолжает» past the
// sealed end. Probes: the end waits for the live turn's final text; a late held, a marker's
// back() and late lifecycle events wake no one over a sealed end; a new session under the same
// place name stands freely (the seal is keyed by session, not by name); a dispatch-marked turn
// is released by interrupted/failed — no eternal wait for text that never comes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  alive,
  callsIn,
  CHILD_DIR,
  ends,
  event,
  leadChild,
  PARENT_DIR,
  pidsOf,
  SUB,
  SUB_PLACE,
  turn,
  turnWords,
} from "./lead-kit.mjs";
import { delay, plugin, SANDBOX, stopMarks, until } from "./opencode-kit.mjs";

// №1237 (1): the child's last turn was live — its leave call returned while the model kept
// streaming — but the deciding instance had missed the turn's execution.started. The end of
// the last case must wait for that turn's end and carry its FINAL text, not the intermediate
// word of a part that had ended earlier; the bridge goes down, the end record is laid, and the
// late events of the ended session tell nothing more («продолжает» does not come).
test("the end waits for a live turn it had not seen started: «КОНЧЕН» carries the turn's final word", async () => {
  const { _b, rec, childPid } = await leadChild("endword-live-turn");
  try {
    await rec.call("iskron_case", { realm: "nks-dev", action: "join", room: "#77" }, "child");
    turn(rec, "первый ход: осмотр"); // noted — the turn word, one
    await until(() => turnWords(rec).length === 1, "the first turn's word");
    // The second turn is live but its started never reached this instance (another location's):
    // a text part has ended — an intermediate word — and the model keeps streaming.
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 1, text: "EN-голова закреплена" },
    });
    // The leave call returns inside that live turn; the end must not seal on its answer alone.
    await rec.call("iskron_case", { realm: "nks-dev", action: "leave", room: "№77" }, "child");
    await delay(300); // the platform's word about the last case settles
    // The turn settles in view: its final text, then its end.
    rec.emit({
      type: "session.text.ended",
      data: {
        sessionID: "child",
        ordinal: 2,
        text: "Вердикт: CHANGES_REQUESTED — правки по всем пунктам",
      },
    });
    rec.emit({ type: "session.execution.succeeded", data: { sessionID: "child" } });
    await until(() => ends(rec).length === 1, "the end in the parent");
    assert.match(ends(rec)[0].text, /вышел из дела №77 по исходу/);
    assert.match(ends(rec)[0].text, /CHANGES_REQUESTED/, "the outcome carries the final verdict");
    assert.doesNotMatch(ends(rec)[0].text, /EN-голова закреплена/, "not the intermediate word");
    await until(() => !alive(childPid), "the child's bridge to go");
    assert.ok(
      stopMarks().some((f) => /opencode-ended\./.test(f)),
      "the end record is laid for every instance",
    );
    // A late callback of the ended session wakes no one and tells nothing.
    const heard = rec.synthetics.length;
    rec.emit({ type: "session.execution.succeeded", data: { sessionID: "child" } });
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 3, text: "ещё слово" },
    });
    await delay(400);
    assert.equal(rec.synthetics.length, heard, "no late «продолжает» past the sealed end");
  } finally {
    await rec.stop();
  }
});

// №1317 [19], находка 2 ревью PR #542 (регрессия начатого пути): принятый pending leave —
// выход из дела, ждущий конца живого хода, — не должен теряться при остановке плагина:
// следующий экземпляр заканчивает поручение с последним известным текстом. Случай «событие
// конца вовсе не приходит» — открытый риск, не политика конца: без события хода конец всё
// равно приходит, потому что leave уже был принят.
test("a pending leave accepted before the stop survives the reload: the end still comes", async () => {
  const { b, rec } = await leadChild("endword-pending-reload");
  try {
    await rec.call("iskron_case", { realm: "nks-dev", action: "join", room: "#77" }, "child");
    turn(rec, "первый ход: осмотр");
    await until(() => turnWords(rec).length === 1, "the first turn's word");
    // Живой ход, начала этот экземпляр не видел; выход из дела в нём — pending до конца хода.
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 1, text: "EN-голова закреплена" },
    });
    await rec.call("iskron_case", { realm: "nks-dev", action: "leave", room: "№77" }, "child");
    await delay(300); // слово платформы о последнем деле улеглось — leave принят и ждёт
  } finally {
    await rec.stop(); // маркер уходит вниз вместе с держащим мостом
  }
  const answer = join(SANDBOX, "endword-pending-reload.answer");
  writeFileSync(answer, JSON.stringify({ resumed: true, key: "k-sub" }));
  const second = await plugin(
    { ...b.env, FB_RESUME: answer },
    {
      keepMarker: true,
      sessions: [
        { id: "root", location: { directory: PARENT_DIR } },
        { id: "child", parentID: "root", location: { directory: CHILD_DIR } },
      ],
    },
  );
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    // Принятый pending продолжается сам: конец приходит родителю без нового события хода.
    await until(() => ends(second).length === 1, "the end after the reload", 8000);
    assert.match(ends(second)[0].text, /вышел из дела №77/);
    assert.match(
      ends(second)[0].text,
      /EN-голова закреплена/,
      "the end carries the freshest text the marker had",
    );
  } finally {
    await second.stop();
  }
});

// №1237 (3): a late «held» of the child's bridge in the window where the sealed end still
// ends its run revived the lead — a fresh one, its first turn not yet told — and the queued
// execution.succeeded woke the parent with «сдал ход — продолжает». The marker shape: the
// plugin stopped with the child holding mid-turn, the child ended meanwhile (the end record
// lies next to the grant), and the next instance takes the marker while the seat returns by
// key. A sealed end stays: neither the marker's back() nor the returned bridge's «held» nor
// the late turn end raises a lead — «сдал ход» does not come past the seal.
test("over a sealed end, a marker does not return the child or announce its late turn", async () => {
  const calls = join(SANDBOX, "endword-late-held.calls");
  writeFileSync(calls, "");
  const { b, rec } = await leadChild("endword-late-held", { FB_CALLS: calls });
  try {
    // Mid-turn at the stop: the marker carries the intermediate word with its turn untold.
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 0, text: "EN-голова закреплена" },
    });
    await delay(150);
  } finally {
    await rec.stop(); // the marker goes down with the holding bridge
  }
  const mark = join(
    process.env.ISKRON_BRIDGE_AUTH_DIR,
    `opencode-ended.${createHash("sha256").update("child").digest("hex").slice(0, 16)}.json`,
  );
  writeFileSync(mark, JSON.stringify({ session: "child", at: new Date().toISOString() }), {
    mode: 0o600,
  });
  const answer = join(SANDBOX, "endword-late-held.answer");
  writeFileSync(answer, JSON.stringify({ resumed: true, key: "k-sub" }));
  const backFrom = callsIn(calls).length;
  const second = await plugin(
    { ...b.env, FB_RESUME: answer },
    {
      keepMarker: true,
      sessions: [
        { id: "root", location: { directory: PARENT_DIR } },
        { id: "child", parentID: "root", location: { directory: CHILD_DIR } },
      ],
    },
  );
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    await delay(600);
    assert.ok(
      !callsIn(calls)
        .slice(backFrom)
        .some((c) => c.name === "iskron/resume" && c.arguments.session === "child"),
      "an ended child is not automatically resumed",
    );
    // The turn's late end must tell nothing.
    second.emit({ type: "session.execution.succeeded", data: { sessionID: "child" } });
    await delay(500);
    assert.ok(
      !turnWords(second).length && !second.synthetics.some((s) => /сдал ход/.test(s.text)),
      "no «сдал ход — продолжает» past the seal",
    );
    assert.equal(ends(second).length, 0, "no second end");
    assert.ok(stopMarks().includes(mark), "the seal is not lifted");
  } finally {
    await second.stop();
    rmSync(mark, { force: true });
  }
});

// №1237 (3), the bridge: the same marker over the same seal — the ended child gets no bridge
// at all. The previous build raised a satellite for it that could return nothing (the end
// refuses the return) and sat without a seat until the reaper; its calls went by that bridge.
// Now its write is the plugin's refusal before any bridge — never the launcher's seat — and
// its read goes by the root's.
test("a marker of a child that ended raises no bridge for it: its write is refused before any bridge, its read goes by the root's", async () => {
  const calls = join(SANDBOX, "endword-no-bridge.calls");
  writeFileSync(calls, "");
  const { b, rec } = await leadChild("endword-no-bridge", { FB_CALLS: calls });
  try {
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 0, text: "EN-голова закреплена" },
    });
    await delay(150);
  } finally {
    await rec.stop(); // the marker goes down with the holding bridge
  }
  // The child ended meanwhile — the end record, as any instance would lay it.
  const mark = join(
    process.env.ISKRON_BRIDGE_AUTH_DIR,
    `opencode-ended.${createHash("sha256").update("child").digest("hex").slice(0, 16)}.json`,
  );
  writeFileSync(mark, JSON.stringify({ session: "child", at: new Date().toISOString() }), {
    mode: 0o600,
  });
  const raised = pidsOf(b.log).length;
  const sent = callsIn(calls).length;
  const second = await plugin(b.env, {
    keepMarker: true,
    sessions: [
      { id: "root", location: { directory: PARENT_DIR } },
      { id: "child", parentID: "root", location: { directory: CHILD_DIR } },
    ],
  });
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    await delay(600);
    const lines = readFileSync(b.log, "utf8").trim().split("\n").filter(Boolean).slice(raised);
    assert.ok(lines.length >= 1, "the root's own marker entry raises its bridge");
    assert.ok(
      !lines.some((l) => /--satellite/.test(l)),
      `no bridge is raised for an ended child: ${lines.join(" | ")}`,
    );
    await assert.rejects(
      second.call("iskron_case", { realm: "nks-dev", action: "join", room: "#5" }, "child"),
      /дочерняя сессия кончена[^\n]*satellite_of="host\.repo\.opus-5"/,
    );
    const went = callsIn(calls).slice(sent);
    assert.ok(!went.some((c) => c.name === "iskron_case"), "the write reached no bridge");
    await second.call("iskron_look", { node_id: "#1" }, "child");
    const read = callsIn(calls)
      .slice(sent)
      .filter((c) => c.name === "iskron_look");
    assert.equal(read.length, 1, "the read goes through");
    const roots = lines.map((l) => Number(l.split(/\s+/)[1]));
    assert.ok(
      roots.includes(read[0].pid),
      "the read goes by a bridge raised for the root, not by a satellite",
    );
  } finally {
    await second.stop();
    rmSync(mark, { force: true });
  }
});

// №1237 [45]: the ended review agent's successor stood under the SAME place name …sub-5. The
// seal is keyed by the session, not by the seat name: the new session stands freely, its first
// turn is heard, and the old session's late events stay silent.
test("a new session under the same place name as an ended lead stands freely; the old one's late events stay silent", async () => {
  const sessions = [
    { id: "root", location: { directory: PARENT_DIR } },
    { id: "child", parentID: "root", location: { directory: CHILD_DIR } },
    { id: "child2", parentID: "root", location: { directory: CHILD_DIR } },
  ];
  const { b, rec, childPid } = await leadChild("endword-same-name", {}, sessions);
  try {
    turn(rec, "ход старого");
    await until(() => turnWords(rec).length === 1, "the old child's turn word");
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    // The leave rode in a live turn (its dispatch is the evidence): the turn settles, then the end.
    rec.emit({ type: "session.execution.succeeded", data: { sessionID: "child" } });
    await until(() => !alive(childPid), "the old child's bridge to go");
    await until(() => ends(rec).length === 1, "the end in the parent");
    // The successor: a new session stands under the same name — no refusal from the old end.
    await rec.call("iskron_stand", { realm: "nks-dev" }, "child2");
    const child2Pid = pidsOf(b.log).at(-1);
    appendFileSync(`${b.events}.${child2Pid}`, event("held", { key: "k-sub2", place: SUB_PLACE }));
    await until(() => rec.said().includes("мост держит место k-sub2"), "the new child's held word");
    turn(rec, "новое поручение", "child2");
    await until(() => turnWords(rec).length === 2, "the new child's turn word");
    assert.match(turnWords(rec)[1].text, new RegExp(`standing="${SUB}"`));
    // The old session's late events tell nothing more.
    const heard = rec.synthetics.length;
    rec.emit({ type: "session.execution.succeeded", data: { sessionID: "child" } });
    await delay(400);
    assert.equal(rec.synthetics.length, heard, "the old session's late callback is silent");
    assert.equal(ends(rec).length, 1, "no second end");
    assert.ok(alive(child2Pid), "the new child's bridge lives");
  } finally {
    await rec.stop();
  }
});

// №1237 (3), the natural fail: the same marker, but the seat does not return — the end took
// it down. The next instance's back() must not raise a lead over the seal either: the failed
// return is no «снят —» word to the parent (the end already spoke), and the seal stays.
test("a loss marker of a session that ended while the plugin was down raises no lead: the failed return tells nothing over the seal", async () => {
  const calls = join(SANDBOX, "endword-marker.calls");
  writeFileSync(calls, "");
  const { b, rec } = await leadChild("endword-marker", {
    FB_CALLS: calls,
    ISKRON_CHILD_BACK_MS: 100,
    ISKRON_CHILD_BACK_PAUSE_MS: 50,
  });
  try {
    // Mid-turn at the stop: a text part has ended, the turn itself has not — noted stays
    // untold in the marker, exactly the shape №1237 left behind.
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 0, text: "EN-голова закреплена" },
    });
    await delay(150);
  } finally {
    await rec.stop(); // the marker goes down with the holding bridge
  }
  // The child ended meanwhile — the end record, as any instance would lay it.
  const mark = join(
    process.env.ISKRON_BRIDGE_AUTH_DIR,
    `opencode-ended.${createHash("sha256").update("child").digest("hex").slice(0, 16)}.json`,
  );
  writeFileSync(mark, JSON.stringify({ session: "child", at: new Date().toISOString() }), {
    mode: 0o600,
  });
  const resumed = callsIn(calls).length;
  const second = await plugin(b.env, {
    keepMarker: true,
    sessions: [
      { id: "root", location: { directory: PARENT_DIR } },
      { id: "child", parentID: "root", location: { directory: CHILD_DIR } },
    ],
  });
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    await delay(600);
    assert.ok(
      !callsIn(calls)
        .slice(resumed)
        .some((c) => c.name === "iskron/resume" && c.arguments.session === "child"),
      "an ended child is not automatically resumed",
    );
    assert.ok(
      !second.synthetics.some((s) => /субагент .* снят —/.test(s.text)),
      "no «снят» word over the seal",
    );
    assert.ok(!turnWords(second).length, "no «сдал ход» over the seal");
    assert.equal(ends(second).length, 0, "no second end");
    assert.ok(stopMarks().includes(mark), "the seal is not lifted");
  } finally {
    await second.stop();
    rmSync(mark, { force: true });
  }
});

// [45]: a turn marked live at its tool dispatch must not wait forever when the turn never
// comes to its text — interrupted and failed release it, and the leave that follows ends at
// once. A guard for the fix, not a red probe.
test("a dispatch-marked turn is released by an interruption: the leave after it ends without waiting for text", async () => {
  const { rec, childPid } = await leadChild("endword-release");
  try {
    await rec.call("iskron_case", { realm: "nks-dev", action: "say", room: "#7" }, "child"); // dispatch marks the turn live
    rec.emit({ type: "session.execution.failed", data: { sessionID: "child" } }); // the turn dies before any text
    await rec.call("iskron_channel", { realm: "nks-dev", action: "leave" }, "child");
    await delay(300); // the last-word question settles
    rec.emit({
      type: "session.execution.interrupted",
      data: { sessionID: "child", reason: "user" },
    });
    await until(() => ends(rec).length === 1, "the end without any turn text");
    await until(() => !alive(childPid), "the child's bridge to go");
  } finally {
    await rec.stop();
  }
});
