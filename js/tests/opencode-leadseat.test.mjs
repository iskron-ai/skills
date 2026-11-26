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
import { delay, lostMarkers, plugin, SANDBOX, stopMarks, until } from "./opencode-kit.mjs";

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

/**
 * The one move that takes the seat off — the launcher's bridge, the plugin's own move: the stop
 * by the child's own socket's token, named by its seat key (#7621) — never a revoke by name.
 */
function oneRevoke(went, roots) {
  const byName = went.filter(
    (c) => c.name === "iskron_channel" && c.arguments?.action === "revoke",
  );
  assert.deepEqual(byName, [], "no revoke by name");
  const all = went.filter((c) => c.name === "iskron/stopseat");
  assert.equal(all.length, 1, `one stop by the launcher's bridge: ${JSON.stringify(all)}`);
  const [call] = all;
  assert.deepEqual(call.arguments, { key: "k-sub" }, "the child's own seat key");
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
// bridge, by the child's own socket's token — and the parent hears that one word, unwoken.
// Stopped — «место снято»; the token no longer current (another holder took the name) — the
// other's seat is left alone, and the word says so; any other answer — the loud «НЕ снято»
// with its reason, never «отпущен». The fake's start log keeps its lines across tests: each
// case takes a name of its own, or the first pid read off the log would be a bridge of an
// earlier case.
for (const [n, [what, answer, word]] of [
  ["taken off", "stopped", OFF],
  [
    "held by another now (the token not current) and left alone",
    "moved 404 ws_token_not_current",
    /имя держит другой держатель, его место не тронуто/,
  ],
  [
    "NOT taken off — the loud word carries the reason",
    "unknown 503 сервер недоступен",
    /место НЕ снято — платформа ответила: 503 сервер недоступен\. /,
  ],
].entries()) {
  const name = `seatoff-ended-${n}`;
  test(`a child that ended while the plugin was down: its satellite seat is ${what}; no second end, one word to the parent that does not wake it`, async () => {
    const calls = join(SANDBOX, `${name}.calls`);
    writeFileSync(calls, "");
    const { b, rec } = await leadChild(name, { FB_CALLS: calls });
    const mark = endMark("child");
    // The launcher's bridge's answer to the stop — that move alone; the rest answer as before.
    const platform = `${b.reply}.stopseat`;
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

// The deferred revoke waits for its launcher (rootOf); the child stands again meanwhile by its own
// explicit call — the seat is its own now: the revoke, asked right before it leaves, does not go,
// and the parent hears nothing about a seat taken off.
test("a child that stands again while its deferred revoke waits for the launcher: the new seat is not revoked", async () => {
  const name = "seatoff-restood";
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const { b, rec } = await leadChild(name, { FB_CALLS: calls });
  const mark = endMark("child");
  try {
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 0, text: "EN-голова закреплена" },
    });
    await delay(150);
  } finally {
    await rec.stop();
  }
  writeFileSync(mark, JSON.stringify({ session: "child", at: new Date().toISOString() }), {
    mode: 0o600,
  });
  const raised = pidsOf(b.log).length;
  const sent = callsIn(calls).length;
  const faults = { getDelays: { child: [4000] } }; // the revoke's launcher lookup answers late
  const second = await plugin(
    { ...b.env, FB_RESUME: rootBack(name) },
    { keepMarker: true, sessions: SESSIONS, faults },
  );
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    await until(() => raisedIn(b, raised).length >= 1, "the root's bridge", 8000);
    await stoodAgain(b, second, pidsIn(raisedIn(b, raised))[0]);
    await delay(5000); // past the late lookup: the revoke would have gone by now
    const revokes = callsIn(calls)
      .slice(sent)
      .filter(
        (c) =>
          c.name === "iskron/stopseat" ||
          (c.name === "iskron_channel" && c.arguments?.action === "revoke"),
      );
    assert.deepEqual(revokes, [], "the child's new seat is neither stopped nor revoked");
    assert.ok(
      !second.synthetics.some((s) => OFF.test(s.text) || NOT_OFF.test(s.text)),
      `no word about a seat taken off: ${JSON.stringify(second.synthetics)}`,
    );
  } finally {
    await second.stop();
    rmSync(mark, { force: true });
  }
});

/** A child that ended while the plugin was down; `marker` — rewrites the marker before the reload. */
async function endedChild(name, own = SUB_PLACE, marker = null) {
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const { b, rec } = await leadChild(name, { FB_CALLS: calls }, undefined, own);
  const mark = endMark("child");
  try {
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 0, text: "EN-голова закреплена" },
    });
    await delay(150);
  } finally {
    await rec.stop();
  }
  writeFileSync(mark, JSON.stringify({ session: "child", at: new Date().toISOString() }), {
    mode: 0o600,
  });
  if (marker)
    for (const f of lostMarkers())
      writeFileSync(f, JSON.stringify(marker(JSON.parse(readFileSync(f, "utf8")))));
  const sent = callsIn(calls).length;
  const second = await plugin(
    { ...b.env, FB_RESUME: rootBack(name) },
    { keepMarker: true, sessions: SESSIONS },
  );
  await until(() => second.tools().has("iskron_case"), "the tools", 8000);
  return { second, mark, went: () => callsIn(calls).slice(sent) };
}

// An older build's marker names no seat key: the stop record cannot be found — no stop, and no
// revoke by name either: the seat lapses by its term, and the parent is told so.
test("an older marker without the child's key: no stop and no revoke by name — the seat lapses by its term", async () => {
  const { second, mark, went } = await endedChild("seatoff-nokey", SUB_PLACE, (m) => ({
    ...m,
    entries: m.entries.map((e) => (e.child ? { ...e, key: null } : e)),
  }));
  try {
    await until(
      () => second.synthetics.some((s) => /уйдёт по сроку канала/.test(s.text)),
      "the word that the seat lapses by its term",
      8000,
    );
    const moves = went().filter(
      (c) =>
        c.name === "iskron/stopseat" ||
        (c.name === "iskron_channel" && c.arguments?.action === "revoke"),
    );
    assert.deepEqual(moves, [], "nothing stopped, nothing revoked by name");
  } finally {
    await second.stop();
    rmSync(mark, { force: true });
  }
});

// The child stood on another role than its parent (#1172 under a root on #931): its seat goes by
// its own socket's token, named by its own seat key — no revoke under the launcher's role.
test("a child on another role than its parent: its own seat is stopped by its key, never revoked by the launcher's role", async () => {
  const name = "seatoff-own-role";
  const calls = join(SANDBOX, `${name}.calls`);
  writeFileSync(calls, "");
  const own = { ...SUB_PLACE, karta: "1172" };
  const { b, rec } = await leadChild(name, { FB_CALLS: calls }, undefined, own);
  const mark = endMark("child");
  try {
    rec.emit({
      type: "session.text.ended",
      data: { sessionID: "child", ordinal: 0, text: "EN-голова закреплена" },
    });
    await delay(150);
  } finally {
    await rec.stop();
  }
  writeFileSync(mark, JSON.stringify({ session: "child", at: new Date().toISOString() }), {
    mode: 0o600,
  });
  const sent = callsIn(calls).length;
  const second = await plugin(
    { ...b.env, FB_RESUME: rootBack(name) },
    { keepMarker: true, sessions: SESSIONS },
  );
  try {
    await until(() => second.tools().has("iskron_case"), "the tools", 8000);
    await until(() => second.synthetics.some((s) => OFF.test(s.text)), "the seat's word", 8000);
    const went = callsIn(calls).slice(sent);
    assert.deepEqual(
      went.filter((c) => c.name === "iskron/stopseat").map((c) => c.arguments),
      [{ key: "k-sub" }],
      "the child's own seat, by its key",
    );
    assert.deepEqual(
      went.filter((c) => c.name === "iskron_channel" && c.arguments?.action === "revoke"),
      [],
      "no revoke under the launcher's role",
    );
  } finally {
    await second.stop();
    rmSync(mark, { force: true });
  }
});
