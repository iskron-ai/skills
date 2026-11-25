// The satellite seat of a lead that ended with no bridge of its own — №1237's live shape: the
// plugin stopped with a child mid-turn, and the child ended meanwhile, or its leave had been
// accepted before the stop. The next instance raises no bridge for it (opencode-leadend.test.mjs),
// so nothing of its own is left to take its seat off: its launcher's bridge takes it off —
// the plugin's own move (a service call), never a bridge for an ended child. The parent hears
// what is its due and no more: the errand's end when the end is this instance's (it wakes, as
// any end does), and then one word that does not wake it — «место снято на платформе», a seat
// already gone counting as off, or the loud «НЕ снято» with the platform's reason. The end
// stays the session's until its own explicit stand: then the record goes and it stands again.
// Aims at an old build: ISKRON_OPENCODE_PLUGIN.
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  callsIn,
  endMark,
  ends,
  event,
  leadChild,
  pidsOf,
  ROOT_PLACE,
  SESSIONS,
  SUB,
  SUB_PLACE,
  turn,
  turnWords,
} from "./lead-kit.mjs";
import { delay, plugin, SANDBOX, stopMarks, until } from "./opencode-kit.mjs";

/** The seat is off — the word the launcher's own revoke answers too (leads.ts, release.ts). */
const OFF = /место снято на платформе/;
/** The platform refused: the seat stays on the board, and the word says why. */
const NOT_OFF = /место НЕ снято — платформа ответила: /;
/** Ended, not sealed for good: the refusal names the launcher's seat to stand under again. */
const BY_NAME = /дочерняя сессия кончена[^\n]*satellite_of="host\.repo\.opus-5"/;

/** The bridges an instance raised since `from`: their start lines of the fake's log. */
const raisedIn = (b, from) =>
  readFileSync(b.log, "utf8").trim().split("\n").filter(Boolean).slice(from);
const pidsIn = (lines) => lines.map((l) => Number(l.split(/\s+/)[1]));

/** No bridge for the ended child — only what the root's marker entry raised. */
function noBridgeForTheChild(b, from) {
  const lines = raisedIn(b, from);
  assert.ok(lines.length >= 1, "the root's own marker entry raises its bridge");
  assert.ok(
    !lines.some((l) => /--satellite/.test(l)),
    `no bridge is raised for an ended child: ${lines.join(" | ")}`,
  );
  return pidsIn(lines);
}

/** The one call that takes the seat off — the launcher's bridge, the plugin's own move. */
function oneRevoke(went, roots) {
  const all = went.filter((c) => c.name === "iskron_channel");
  assert.equal(all.length, 1, `one call by the launcher's bridge: ${JSON.stringify(all)}`);
  const [call] = all;
  assert.deepEqual(call.arguments, {
    action: "revoke",
    standing: SUB,
    realm: "@nks/nks-dev",
    karta: "931",
  });
  assert.match(String(call.id), /^iskron-service-/, "the plugin's own move, not agent work");
  assert.ok(roots.includes(call.pid), "spoken by a bridge raised for the root, not a satellite");
  return call;
}

/** The root's seat returns after the reload — by its own key, so no word about a failed return. */
const rootBack = (name) => {
  const file = join(SANDBOX, `${name}.resume`);
  writeFileSync(file, JSON.stringify({ bySession: { root: { resumed: true, key: "k-root" } } }));
  return file;
};

/** The child stands again by its own explicit call: its satellite comes up, the end record goes. */
async function stoodAgain(b, second, rootPid) {
  // The new instance's root bridge holds the seat; the place comes with its «held».
  appendFileSync(`${b.events}.${rootPid}`, event("held", { key: "k-root", place: ROOT_PLACE }));
  await until(() => second.said().includes("мост держит место k-root"), "the root's held word");
  const raised = pidsOf(b.log).length;
  await second.call("iskron_stand", { realm: "nks-dev" }, "child");
  const childPid = pidsOf(b.log).at(-1);
  assert.ok(pidsOf(b.log).length > raised && childPid !== rootPid, "a bridge of the child's own");
  appendFileSync(`${b.events}.${childPid}`, event("held", { key: "k-sub", place: SUB_PLACE }));
  await until(() => second.said().includes("мост держит место k-sub"), "the child's held word");
  assert.ok(
    !stopMarks().some((f) => /opencode-ended\./.test(f)),
    "the explicit stand lifts the end record",
  );
}

// №1237 [38]/[45] and №1317 [19]: the leave of the last case was accepted inside a live turn,
// the plugin stopped before the turn's end reached it. The next instance ends the errand with
// no bridge of its own to end the run — and the satellite seat does not stay on the board:
// the launcher's bridge takes it off, the parent hears the end (it wakes) and then the seat's
// word once, unwoken. The child's write is refused by its launcher's seat's name, not sealed
// for good: its own stand still passes.
test("a pending leave ended after the reload takes the child's satellite seat off by the launcher's bridge: no bridge for the child, the end wakes the parent once, the seat's word does not wake it", async () => {
  const calls = join(SANDBOX, "seatoff-pending.calls");
  writeFileSync(calls, "");
  const { b, rec } = await leadChild("seatoff-pending", { FB_CALLS: calls });
  try {
    await rec.call("iskron_case", { realm: "nks-dev", action: "join", room: "#77" }, "child");
    turn(rec, "первый ход: осмотр");
    await until(() => turnWords(rec).length === 1, "the first turn's word");
    // A live turn this instance never saw started; the leave in it waits for the turn's end.
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 1, text: "EN-голова закреплена" },
    });
    await rec.call("iskron_case", { realm: "nks-dev", action: "leave", room: "№77" }, "child");
    await delay(300); // the platform's word about the last case settles
  } finally {
    await rec.stop(); // the marker goes down with the holding bridge
  }
  const raised = pidsOf(b.log).length;
  const sent = callsIn(calls).length;
  const second = await plugin(
    { ...b.env, FB_RESUME: rootBack("seatoff-pending") },
    { keepMarker: true, sessions: SESSIONS },
  );
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    await until(() => second.synthetics.some((s) => OFF.test(s.text)), "the seat's word", 8000);
    const roots = noBridgeForTheChild(b, raised);
    const went = callsIn(calls).slice(sent);
    assert.ok(
      !went.some((c) => c.name === "iskron/resume" && c.arguments.session === "child"),
      "an ended child is not resumed",
    );
    assert.ok(
      !went.some((c) => c.name === "iskron/end"),
      "no run ends by a bridge of the child's — it has none",
    );
    oneRevoke(went, roots);
    // The end is this instance's — it wakes the parent, as any end of an errand does; then
    // the seat's word, once, unwoken; nothing else is laid into any session.
    assert.equal(ends(second).length, 1, "one end");
    const [end, seat] = second.synthetics;
    assert.equal(second.synthetics.length, 2, JSON.stringify(second.synthetics));
    assert.match(end.text, new RegExp(`субагент ${SUB} КОНЧЕН — вышел из дела №77 по исходу`));
    assert.equal(end.sessionID, "root");
    assert.equal(end.resume, true, "the end wakes the parent");
    assert.match(seat.text, new RegExp(`субагент ${SUB} отпущен — `));
    assert.equal(seat.sessionID, "root");
    assert.equal(seat.resume, false, "the seat's word does not wake it");
    assert.ok(
      !second.said().includes("снял ли он место") && !NOT_OFF.test(second.said()),
      "the seat's outcome is known: neither «не ответил» nor «НЕ снято»",
    );
    assert.ok(stopMarks().includes(endMark("child")), "the end record is laid for every instance");
    await assert.rejects(
      second.call("iskron_case", { realm: "nks-dev", action: "join", room: "#5" }, "child"),
      BY_NAME,
    );
    assert.ok(
      !callsIn(calls)
        .slice(sent)
        .some((c) => c.name === "iskron_case"),
      "the refused write reached no bridge",
    );
    await stoodAgain(b, second, pidsIn(raisedIn(b, raised))[0]);
  } finally {
    await second.stop();
  }
});

// №1237 (3), the seat: the child ended while the plugin was down — the end record lies next
// to the grant, and the end had spoken before the reload. The next instance raises no bridge
// for it and does not end it again: only its satellite seat is taken off — by the launcher's
// bridge — and the parent hears that one word, unwoken. Off, or already gone — «место снято»;
// any other refusal of the platform — the loud «НЕ снято» with its reason, never «отпущен».
// The fake's start log keeps its lines across tests: each case takes a name of its own, or
// the first pid read off the log would be a bridge of an earlier case.
for (const [n, [what, answer, word]] of [
  ["taken off", "", OFF],
  [
    "already gone (404 standing_not_found) and so off",
    "__REFUSAL__404 standing_not_found места на доске нет",
    OFF,
  ],
  [
    "NOT taken off — the loud word carries the platform's reason",
    "__REFUSAL__403 standing_held место держит другой процесс",
    /место НЕ снято — платформа ответила: место держит другой процесс\. /,
  ],
].entries()) {
  const name = `seatoff-ended-${n}`;
  test(`a child that ended while the plugin was down: its satellite seat is ${what}; no second end, one word to the parent that does not wake it`, async () => {
    const calls = join(SANDBOX, `${name}.calls`);
    writeFileSync(calls, "");
    const { b, rec } = await leadChild(name, { FB_CALLS: calls });
    const mark = endMark("child");
    // The platform's answer to the launcher's revoke — that call alone; the rest answer as before.
    const platform = `${b.reply}.iskron_channel`;
    try {
      rec.emit({
        type: "session.text.ended",
        data: { sessionID: "child", ordinal: 0, text: "EN-голова закреплена" },
      });
      await delay(150);
    } finally {
      await rec.stop(); // the marker goes down with the holding bridge
    }
    writeFileSync(mark, JSON.stringify({ session: "child", at: new Date().toISOString() }), {
      mode: 0o600,
    });
    writeFileSync(platform, answer);
    const raised = pidsOf(b.log).length;
    const sent = callsIn(calls).length;
    const second = await plugin(
      { ...b.env, FB_RESUME: rootBack(name) },
      { keepMarker: true, sessions: SESSIONS },
    );
    try {
      await until(() => second.tools().has("iskron_case"), "the tools", 8000);
      await until(() => second.synthetics.some((s) => word.test(s.text)), "the seat's word", 8000);
      const roots = noBridgeForTheChild(b, raised);
      const went = callsIn(calls).slice(sent);
      const revoke = oneRevoke(went, roots);
      assert.ok(
        !went.some((c) => c.name === "iskron/resume" && c.arguments.session === "child"),
        "an ended child is not resumed",
      );
      // The end had spoken before the reload: no second end — only the seat's word, unwoken.
      assert.equal(ends(second).length, 0, "no second end");
      const [seat] = second.synthetics;
      assert.equal(second.synthetics.length, 1, JSON.stringify(second.synthetics));
      assert.match(seat.text, new RegExp(`субагент ${SUB} `));
      assert.equal(seat.sessionID, "root");
      assert.equal(seat.resume, false, "the seat's word does not wake the parent");
      assert.ok(!second.said().includes("снял ли он место"), "the seat's outcome is known");
      assert.ok(stopMarks().includes(mark), "the end record stays");
      await assert.rejects(
        second.call("iskron_case", { realm: "nks-dev", action: "join", room: "#5" }, "child"),
        BY_NAME,
      );
      assert.ok(
        !callsIn(calls)
          .slice(sent)
          .some((c) => c.name === "iskron_case"),
        "the refused write reached no bridge",
      );
      await stoodAgain(b, second, revoke.pid);
    } finally {
      await second.stop();
      rmSync(mark, { force: true });
    }
  });
}
