// Проба потребительского прогона сырых кадров (scripts/frames-consumer-run.mjs, дело №1249):
// матрица проб A и B, выгруженная файлами мест, проходит через собранный мост и сторожа —
// каждая ветвь pass; судья различает отказ моста, повтор и устаревший кадр.
// ISKRON_BRIDGE_PATH=<мост до #540> — ветви краснеют, как красны пробы A и B.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  addressHint,
  branchOutcome,
  intentFor,
  judge,
  readSegment,
  textsOf,
} from "../../scripts/frames-consumer-judge.mjs";
import { loadSeats } from "../../scripts/frames-consumer-scenarios.mjs";
import { REPO } from "./built.mjs";
import {
  ask,
  ME,
  ME_ID,
  PLATFORM,
  progress,
  roleOnlyAsk,
  roomFrame,
  SIB,
  siblingMatrix,
} from "./room-frames.mjs";

const me = { standing_id: ME_ID, standing: ME };
const sib = { standing_id: SIB.id, standing: SIB.standing };
const deliver = (seat, frames) =>
  frames.map((f) => ({ ...f, to_standing_id: seat.standing_id, to_standing: seat.standing }));
const BRANCHES = {
  sibling: siblingMatrix().frames,
  "role-only": [
    roleOnlyAsk(72, SIB),
    roleOnlyAsk(73),
    roleOnlyAsk(74, { id: ME_ID, standing: ME, name: "proba" }),
  ],
};

test("the api's intent is read from the frame's address fields, per seat", () => {
  const [toSib, , , , invite, joined, inFlight, bodyOf] = BRANCHES.sibling;
  const refs = BRANCHES.sibling;
  for (const f of [toSib, invite, inFlight, bodyOf]) {
    assert.equal(intentFor(f, me, refs), "theirs", f.id);
    assert.equal(intentFor(f, sib, refs), "mine", f.id);
  }
  assert.equal(intentFor(joined, me, refs), null);
  assert.equal(intentFor(roleOnlyAsk(73), sib), "nobody");
  assert.equal(intentFor({ ...ask(80), room: "broken" }, me), null);
  // Ответ без явного to — автору отвечаемой записи (#6574, #6867); answer — только по fields.to.
  const reply = { ...progress(81), in_reply_to: 6, in_reply_to_from: SIB };
  assert.equal(intentFor(reply, sib), "mine");
  assert.equal(intentFor(reply, me), "theirs");
  assert.equal(intentFor({ ...progress(82), in_reply_to: 6 }, sib), "nobody");
  const answered = ask(83);
  answered.line.kind = "answer";
  answered.event_kind = "room.answer";
  delete answered.line.fields.to;
  assert.equal(intentFor({ ...answered, in_reply_to: 6, in_reply_to_from: SIB }, sib), "nobody");
});

test("a scenario directory: subdirectories are branches, rows become socket frames, the seat's address is learnt", () => {
  const dir = mkdtempSync(join(tmpdir(), "frames-scenarios-"));
  try {
    const { room, ...envelope } = { ...ask(60), room: { id: "<room_1>", seq: 1 } };
    envelope.line.fields.to.standing = { id: "<seat_B>", standing: "@b:beta" };
    const row = { id: "<uuid_1>", channel_id: "<seat_B>", standing_id: "<seat_B>", body: "" };
    const seatB = { standing_id: "<seat_B>", standing: "seat_B", verdict_on_main: "red" };
    mkdirSync(join(dir, "s1"));
    writeFileSync(join(dir, "manifest.json"), "{}");
    writeFileSync(join(dir, "s1", "_scenario.json"), JSON.stringify({ verdict_on_main: "red" }));
    const messages = [{ ...row, room: { ...envelope, room } }];
    writeFileSync(join(dir, "s1", "seat_B.json"), JSON.stringify({ ...seatB, messages }));
    const person = { standing_id: "<person_window>", standing: "person_window", messages };
    writeFileSync(join(dir, "s1", "person_window.json"), JSON.stringify(person));
    const named = loadSeats(dir, ["seat_B"]).seats.map((s) => [s.label, !!s.outside]);
    assert.deepEqual(named, [
      ["person_window", true],
      ["seat_B", true],
    ]);
    const { seats: both, scenarios } = loadSeats(dir);
    assert.deepEqual(
      both.map((s) => !!s.outside),
      [true, false],
    );
    const seats = both.slice(1);
    assert.equal(scenarios.get("s1").verdict_on_main, "red");
    const [f] = seats[0].messages;
    assert.equal(f.type, "message");
    assert.equal(f.event_kind, "room.ask");
    assert.equal(f.to_standing_id, "<seat_B>");
    assert.equal(f.to_standing, "@b:beta");
    assert.deepEqual(f.room, room);
    assert.equal(intentFor(f, seats[0], seats[0].messages), "mine");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the full set's seat files: a seat object names no label, a person is told by its role, the unmanned share has no seat", () => {
  const dir = mkdtempSync(join(tmpdir(), "frames-full-"));
  try {
    mkdirSync(join(dir, "s1"));
    const file = (name, s) => writeFileSync(join(dir, "s1", `${name}.json`), JSON.stringify(s));
    const seat = (id, karta, prose) => ({
      standing_id: id,
      standing: { id, karta, name: null, status: "active" },
      seat: prose,
      expected: "ожидание API",
      messages: [],
    });
    file("A", seat("<seat_A>", "<role_A>", "seat A (alpha) — opened the case"));
    file("window", seat("<seat_window>", "<role_person>", "person's seat, outside"));
    file("R_unmanned_share", {
      standing_id: null,
      standing: { unmanned_share_of_role: "<r>" },
      messages: [],
    });
    const got = loadSeats(dir).seats.map((s) => [s.label, s.outside || "", s.expected]);
    assert.deepEqual(got, [
      ["A", "", "ожидание API"],
      ["R_unmanned_share", "unmanned share: no seat holds it", null],
      ["window", "a person's seat: its window or bot delivers it", "ожидание API"],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withdraw with no author and an invite to a former seat by fields.standing.id are judged by the seat they name", () => {
  const former = { standing_id: "<seat_R1>", standing: "" };
  const invite = roomFrame("invite", {
    entry_id: 13,
    key: "invite:<seat_R1>",
    author: PLATFORM,
    fields: { cause: "asked", standing: { id: "<seat_R1>" } },
  });
  assert.equal(intentFor(invite, former), "mine");
  assert.equal(intentFor(invite, sib), "theirs");
  const withdraw = roomFrame("withdraw", { entry_id: 16, key: "invite:<seat_R1>" });
  withdraw.line.author = null;
  withdraw.line.fields = { standing: { id: "<seat_R1>" } };
  assert.equal(intentFor(withdraw, former), "mine");
  assert.deepEqual(textsOf(withdraw), []);
  // Зов роли: место не названо, названа роль — её места по роли из файла места.
  const call = roomFrame("invite", {
    entry_id: 6,
    key: "invite:<role_R>",
    author: PLATFORM,
    fields: { cause: "asked", karta: { id: "<role_R>", seq: 4 } },
  });
  assert.equal(intentFor(call, { standing_id: "<seat_R2>", role: "<role_R>" }), "mine");
  assert.equal(intentFor(call, { standing_id: "<seat_B>", role: "<role_B>" }), "theirs");
  assert.equal(intentFor(call, { standing_id: "<seat_B>" }), null);
  assert.equal(judge(null, { delivered: true, hint: addressHint(call) }).verdict, "unparsed");
});

test("a kind the judge was not checked against is not covered, not passed", () => {
  const seen = { delivered: true, texts: [], shown: [], recordLine: false, yours: 0 };
  assert.equal(judge("theirs", { ...seen, kind: "handover" }).verdict, "not-covered");
  assert.equal(judge(null, { ...seen, kind: "joined" }).verdict, "unjudged");
  assert.equal(branchOutcome([{ verdict: "pass" }, { verdict: "not-covered" }]), "not-covered");
});

test("verdicts: a handed-over frame is judged, a dropped one is rejected, a repeat and a stale one are not judged", () => {
  const seen = { delivered: true, texts: ["Т"], shown: [], recordLine: false, yours: 0 };
  assert.equal(judge("theirs", seen).verdict, "pass");
  assert.equal(judge("theirs", { ...seen, shown: ["Т"] }).verdict, "fail");
  assert.equal(judge("theirs", { ...seen, addressed: true }).verdict, "fail");
  assert.equal(judge("mine", seen).verdict, "fail");
  assert.equal(judge("mine", { ...seen, shown: ["Т"], yours: 1 }).verdict, "pass");
  assert.equal(judge("mine", { ...seen, delivered: false }).verdict, "rejected");
  assert.equal(judge("mine", { ...seen, delivered: false, repeat: true }).verdict, "unjudged");
  assert.equal(judge("theirs", { ...seen, shown: ["Т"], stale: true }).verdict, "unjudged");
  // Адрес, которого судья не прочёл, — не pass ветви.
  assert.equal(judge(null, { ...seen, hint: true }).verdict, "unparsed");
  // Место человека — вне моста: ни pass, ни fail; ветвь из одних таких — не pass.
  assert.equal(judge("theirs", { ...seen, shown: ["Т"], outside: true }).verdict, "outside-bridge");
  assert.equal(branchOutcome([{ verdict: "outside-bridge" }]), "outside-bridge");
  assert.equal(branchOutcome([{ verdict: "pass" }, { verdict: "unparsed" }]), "unparsed");
  // Строка записи без текста — и со стрелкой.
  assert.equal(readSegment("Алексей → proba.1: [64]", 64).recordLine, true);
  assert.equal(readSegment("№7 «Стенд»: записей 1, тебе 0 … since=63", 64).recordLine, false);
});

/** Подставной дом с домашним мостом новее: сторож с настоящим HOME перезапустился бы в него. */
function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "frames-home-"));
  mkdirSync(join(home, ".iskron-bridge"));
  const stub = `const VERSION = "99.0.0";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(process.env.HOME + "/REEXEC", "x");\nprocess.exit(3);\n`;
  writeFileSync(join(home, ".iskron-bridge", "iskron-bridge.mjs"), stub);
  const list = () => readdirSync(home, { recursive: true }).sort().join("\n");
  return { home, stub, list, before: list() };
}

test("the matrix of probes A and B through the built bridge and watchdog: every branch passes, the home untouched", () => {
  const dir = mkdtempSync(join(tmpdir(), "frames-consumer-"));
  const h = fakeHome();
  try {
    for (const [branch, frames] of Object.entries(BRANCHES))
      for (const [name, seat] of [
        ["me", me],
        ["sib", sib],
      ]) {
        const file = { ...seat, branch, messages: deliver(seat, frames) };
        writeFileSync(join(dir, `${branch}-${name}.json`), JSON.stringify(file));
      }
    const out = join(tmpdir(), `frames-consumer-${process.pid}.json`);
    // Выключатель обновлений make test скрипту не передаётся: его ставит сам скрипт.
    const { ISKRON_BRIDGE_NO_UPDATE: _off, ...env } = process.env;
    const run = spawnSync(
      process.execPath,
      [join(REPO, "scripts/frames-consumer-run.mjs"), dir, "--json", out],
      {
        encoding: "utf8",
        timeout: 120_000,
        env: {
          ...env,
          HOME: h.home,
          USERPROFILE: h.home,
          XDG_CONFIG_HOME: join(h.home, ".config"),
        },
      },
    );
    assert.equal(h.list(), h.before, "the run wrote into HOME");
    assert.equal(readFileSync(join(h.home, ".iskron-bridge", "iskron-bridge.mjs"), "utf8"), h.stub);
    assert.ok(run.status === 0 || run.status === 1, `setup: ${run.status} ${run.stderr}`);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    rmSync(out, { force: true });
    const outcomes = Object.fromEntries(summary.branches.map((b) => [b.branch, b.outcome]));
    assert.deepEqual(outcomes, { "role-only": "pass", sibling: "pass" }, run.stdout);
    // Судимых записей по месту: pass ветви не держится на одних unjudged.
    const judged = {};
    for (const b of summary.branches)
      for (const r of b.records)
        if (r.verdict === "pass" || r.verdict === "fail")
          judged[`${b.branch} ${r.seat}`] = (judged[`${b.branch} ${r.seat}`] ?? 0) + 1;
    assert.deepEqual(judged, {
      "role-only @tester:proba": 3,
      "role-only @tester:proba.1": 3,
      "sibling @tester:proba": 7,
      "sibling @tester:proba.1": 7,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(h.home, { recursive: true, force: true });
  }
});
